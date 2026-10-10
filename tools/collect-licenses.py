"""Collect notices for the two shipped Wasm targets, without vendoring dependencies."""
import argparse
import hashlib
from html import unescape
import json
import os
from pathlib import Path
import re
import subprocess
import tomllib
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [("rogue-layers", "wasm32-unknown-emscripten"),
           ("rogue-browser-display", "wasm32-unknown-unknown")]
MIT_CHOICES = {"MIT", "MIT OR Apache-2.0", "Apache-2.0 OR MIT", "MIT/Apache-2.0",
               "Unlicense OR MIT", "Zlib OR Apache-2.0 OR MIT",
               "MIT OR Apache-2.0 OR Zlib", "Zlib OR MIT OR Apache-2.0",
               "(MIT OR Apache-2.0) AND Unicode-3.0"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(*args, cwd=ROOT, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True, encoding="utf-8")


def graph(manifest, package, target, cwd=ROOT, features=None, env=None):
    args = ["cargo", "tree", "--offline", "--locked", "--manifest-path", str(manifest),
            "-p", package, "--target", target, "--edges", "normal,build", "--prefix", "none",
            "--format", "{p}"]
    if features:
        args += ["--features", features]
    return {(m[1], m[2]) for line in run(*args, cwd=cwd, env=env).splitlines()
            if (m := re.match(r"^(\S+) v(\S+)", line))}


def license_files(directory, declared):
    files = sorted(p for p in directory.iterdir() if p.is_file()
                   and re.match(r"^(LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|AUTHORS)", p.name, re.I))
    chosen = declared
    if declared in MIT_CHOICES and any("MIT" in p.name.upper() for p in files):
        # Only alternate license texts are removed. Copyright and supplementary notices remain.
        files = [p for p in files if not any(x in p.name.upper() for x in ("APACHE", "ZLIB", "UNLICENSE"))
                 and not (p.name == "COPYING" and declared == "Unlicense OR MIT")]
        chosen = "MIT AND Unicode-3.0" if "AND Unicode-3.0" in declared else "MIT"
    if not files:
        raise ValueError(f"No license text for {directory.name}; acquire notices at the exact source revision")
    return chosen, files


def std_attribution(sysroot):
    """Retain in-tree notices; stop if a new exception needs target/license review."""
    document = (sysroot / "share/doc/rust/COPYRIGHT-library.html").read_text(encoding="utf-8")
    in_tree = document.split('<h2 id="in-tree-files">', 1)[1].split('<h2 id="out-of-tree-dependencies">', 1)[0]
    included = {".", "library/core/src/unicode", "mod.rs", "library/backtrace", "library/std/src/sync/mpmc"}
    excluded = {"library/std/src/sys/sync/mutex/fuchsia.rs"}
    current, result = None, []
    for paragraph in re.findall(r"<p>(.*?)</p>", in_tree, re.S):
        value = " ".join(unescape(re.sub(r"<[^>]*>", "", paragraph)).split())
        if value.startswith("File/Directory: "):
            current = value.removeprefix("File/Directory: ")
            if current not in included | excluded:
                raise ValueError(f"Review new Rust in-tree license exception: {current}")
        elif current in included:
            if value.startswith("License: ") and value not in {"License: Apache-2.0 OR MIT", "License: Unicode-3.0"}:
                raise ValueError(f"Review Rust in-tree license: {current}: {value}")
            if value.startswith("Copyright: "):
                result.append(f"{current}: {value}")
    if not result:
        raise ValueError("Rust standard-library copyright metadata missing")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-root", type=Path, default=Path(r"C:\Users\kit\emsdk"))
    parser.add_argument("--asset-notice", type=Path, help="Replace the Lucide notice when its source changes")
    parser.add_argument("--check", action="store_true", help="Compare regenerated files without writing")
    args = parser.parse_args()
    destination = ROOT / "licenses"
    previous = json.loads((destination / "manifest.json").read_text(encoding="utf-8-sig"))
    components, bodies = [], {}

    def add(name, origin, declared, chosen, targets, notices, source_urls, attribution=None):
        record = dict(component=name, origin=origin, declared_license=declared,
                      selected_license=chosen, targets=sorted(targets), source_urls=source_urls, notices=[])
        if attribution:
            record["attribution"] = attribution
        for filename, data in notices:
            notice_id = digest(data)
            bodies[notice_id] = data
            record["notices"].append(dict(name=filename, id=notice_id))
        if not record["notices"]:
            raise ValueError(f"Missing notices: {name}")
        components.append(record)

    metadata = json.loads(run("cargo", "metadata", "--offline", "--locked", "--manifest-path",
                              str(ROOT / "rust/Cargo.toml"), "--format-version", "1"))
    packages = {(p["name"], p["version"]): p for p in metadata["packages"]}
    memberships = {}
    for package, target in TARGETS:
        for key in graph(ROOT / "rust/Cargo.toml", package, target):
            if packages[key]["source"] is not None:
                memberships.setdefault(key, set()).add(target)
    for (name, version), targets in sorted(memberships.items()):
        package = packages[name, version]
        declared = package["license"] or "SEE LICENSE FILE"
        chosen, files = license_files(Path(package["manifest_path"]).parent, declared)
        add(f"{name}-{version}", "cargo", declared, chosen, targets,
            [(p.name, p.read_bytes()) for p in files], [f"https://crates.io/crates/{name}/{version}"])

    # rust-src has the exact std Cargo.lock and vendored sources for this installed toolchain.
    sysroot = Path(run("rustc", "--print", "sysroot").strip())
    rust_version = run("rustc", "--version").split()[1]
    library = sysroot / "lib/rustlib/src/rust/library"
    std_env = dict(os.environ, RUSTC_BOOTSTRAP="1")
    std_memberships = {}
    for _, target in TARGETS:
        for name, version in graph(library / "Cargo.toml", "std", target, cwd=library,
                                   features="backtrace,panic-unwind", env=std_env):
            if (library / "vendor" / f"{name}-{version}").is_dir():
                std_memberships.setdefault((name, version), set()).add(target)
    for (name, version), targets in sorted(std_memberships.items()):
        directory = library / "vendor" / f"{name}-{version}"
        package = tomllib.loads((directory / "Cargo.toml").read_text(encoding="utf-8"))["package"]
        chosen, files = license_files(directory, package["license"])
        add(f"rust-std/{name}-{version}", "rust-std", package["license"], chosen, targets,
            [(p.name, p.read_bytes()) for p in files], [f"https://crates.io/crates/{name}/{version}"])

    all_targets = [target for _, target in TARGETS]
    rust_url = f"https://raw.githubusercontent.com/rust-lang/rust/{rust_version}/LICENSE-MIT"
    # Reuse the verified full text for the same Rust version, making repeated runs offline.
    rust_component = next((p for p in previous.get("components", [])
                           if p["component"] == f"rust-std/{rust_version}"), None) if isinstance(previous, dict) else None

    def previous_notice(component, filename):
        entry = next(n for n in component["notices"] if n["name"] == filename)
        body = next(n for n in previous["notices"] if n["id"] == entry["id"])
        data = (destination / "THIRD-PARTY.txt").read_bytes()[body["byte_offset"]:body["byte_offset"] + body["bytes"]]
        if digest(data) != body["id"]:
            raise ValueError(f"Corrupt retained notice: {filename}")
        return data

    if rust_component:
        rust_mit = previous_notice(rust_component, "LICENSE-MIT")
    else:
        with urlopen(rust_url, timeout=30) as response:
            rust_mit = response.read()
    add(f"rust-std/{rust_version}", "rust-std", "(MIT OR Apache-2.0) AND Unicode-3.0", "MIT AND Unicode-3.0", all_targets,
        [("LICENSE-MIT", rust_mit), ("Unicode-3.0.txt", (sysroot / "share/doc/rust/licenses/Unicode-3.0.txt").read_bytes())],
        [rust_url, f"https://github.com/rust-lang/rust/blob/{rust_version}/COPYRIGHT"],
        std_attribution(sysroot))
    builtins = library / "compiler-builtins"
    builtins_package = tomllib.loads((builtins / "compiler-builtins/Cargo.toml").read_text())["package"]
    add(f"rust-std/compiler_builtins-{builtins_package['version']}", "rust-std", builtins_package["license"],
        builtins_package["license"], all_targets, [("LICENSE.txt", (builtins / "LICENSE.txt").read_bytes())],
        [f"https://github.com/rust-lang/rust/tree/{rust_version}/library/compiler-builtins"],
        builtins_package["authors"])

    emscripten = args.sdk_root / "upstream/emscripten"
    em_version = (emscripten / "emscripten-version.txt").read_text().strip().strip('"')
    for name, declared, filename in [
        ("emscripten-runtime", "MIT OR NCSA", "LICENSE"),
        ("musl", "MIT AND BSD notices", "system/lib/libc/musl/COPYRIGHT"),
        ("compiler-rt", "Apache-2.0 WITH LLVM-exception AND legacy notices", "system/lib/compiler-rt/LICENSE.TXT"),
    ]:
        add(f"{name}/{em_version}", "emscripten-runtime", declared, declared,
            ["wasm32-unknown-emscripten"], [(Path(filename).name, (emscripten / filename).read_bytes())],
            [f"https://github.com/emscripten-core/emscripten/blob/{em_version}/{filename}"])
    if args.asset_notice:
        asset_bytes = args.asset_notice.read_bytes()
    else:
        asset = next(p for p in previous["components"] if p["component"] == "lucide-lab/stairs")
        asset_bytes = previous_notice(asset, "LICENSE")
    add("lucide-lab/stairs", "adapted-asset", "ISC", "ISC", ["wasm32-unknown-unknown"],
        [("LICENSE", asset_bytes)], ["https://github.com/lucide-icons/lucide-lab/blob/main/icons/stairs.svg"],
        ["The stairs icon is adapted as a Rust vector path."])

    components.sort(key=lambda p: p["component"])
    inventory = dict(format=1, scope=dict(targets=[dict(package=p, target=t) for p, t in TARGETS],
        cargo_edges="normal,build", cargo_lock_sha256=digest((ROOT / "rust/Cargo.lock").read_bytes()),
        rust_version=rust_version, rust_std_features=["backtrace", "panic-unwind"],
        rust_std_lock_sha256=digest((library / "Cargo.lock").read_bytes()), emscripten_version=em_version),
        components=components, notices=[])
    text = ["Third-party notices for Rogue 5.4.4 Web\n\n",
            "Original Rogue notices remain in logic/LICENSE.TXT.\n",
            "Cargo runtime and code-generation dependencies cover the two shipped Wasm targets.\n",
            "Rust std covers the installed target libraries, including backtrace/unwind support.\n",
            "Unused lockfile packages, other target runtimes, compiler tools and test libraries are excluded.\n\n"]
    for p in components:
        text += [f"Component: {p['component']}\nDeclared license: {p['declared_license']}\n",
                 f"Selected license: {p['selected_license']}\nTargets: {', '.join(p['targets'])}\n"]
        text += [f"Attribution: {a}\n" for a in p.get("attribution", [])]
        text += [f"Source: {url}\n" for url in p["source_urls"]]
        text += [f"Notice: {n['name']} -> {n['id']}\n" for n in p["notices"]]
        text += ["\n"]
    payload = bytearray("".join(text).encode("utf-8"))
    for notice_id, data in sorted(bodies.items()):
        payload.extend(f"\n===== NOTICE {notice_id} ({len(data)} bytes) =====\n".encode())
        inventory["notices"].append(dict(id=notice_id, byte_offset=len(payload), bytes=len(data)))
        payload.extend(data)
        payload.extend(b"\n===== END NOTICE =====\n")
    outputs = {"THIRD-PARTY.txt": bytes(payload),
               "manifest.json": (json.dumps(inventory, ensure_ascii=False, indent=2) + "\n").encode("utf-8")}
    for name, data in outputs.items():
        if args.check:
            if (destination / name).read_bytes() != data:
                raise ValueError(f"Outdated license inventory: {name}")
        else:
            (destination / name).write_bytes(data)
    print(f"{'Checked' if args.check else 'Collected'} {len(components)} components, "
          f"{len(bodies)} unique notices, {sum(map(len, outputs.values()))} bytes")


if __name__ == "__main__":
    main()

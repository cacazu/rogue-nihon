"""Run supplementary checks with logs and hashes of the tested inputs/outputs.

This runner does not build or run the actual game or launch Chrome. Use --plan
to inspect its commands. C-focused evidence can be supplied with --merge.
Successful results have the schema expected by record-verification.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
sys.dont_write_bytecode = True
from temporary_artifacts import TemporaryArtifacts
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
SCOPES = ("rust_standalone", "entities", "rust_static", "host", "catalog", "localization")
MERGE_SCOPES = {"message_capture", "message_paging", "semantic_capture", "options_utf8", "verification_recorder"}


def utc():
    return datetime.now(timezone.utc).isoformat()


def local(name):
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError(f"Path leaves project: {name}")
    return path


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON key: " + key)
        value[key] = item
    return value


def file_record(path):
    return {"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def records(paths):
    return [file_record(path) for path in sorted(set(paths))]


def snapshot(paths):
    return {item["path"]: item for item in records(paths)}


def inputs(scope):
    paths = [Path(__file__).resolve()]
    if scope in {"rust_standalone", "entities", "rust_static"}:
        paths += list((ROOT / "rust" / "src").rglob("*.rs"))
        paths += [ROOT / "rust" / "Cargo.toml", ROOT / "rust" / "Cargo.lock",
                  ROOT / "tools" / "check-rust-layers.ps1"]
        paths += list((ROOT / "locales").glob("*.json"))
    elif scope == "host":
        paths += list((ROOT / "web").glob("*"))
        paths += [ROOT / name for name in HOST_TESTS]
        paths += [ROOT / "tests" / "compare-traces.mjs"]
        paths += list((ROOT / "locales").glob("ui-web-*.json"))
    else:
        paths += list((ROOT / "locales").glob("*.json"))
        paths += list((ROOT / "logic").glob("*.c")) + list((ROOT / "logic").glob("*.h"))
        paths += list((ROOT / "contract").glob("*.h"))
        if scope == "catalog":
            paths += [ROOT / "tests" / "catalog.test.py", ROOT / "tests" / "ui-game-catalog.test.py"]
            paths += list((ROOT / "tools").glob("generate_*.py"))
        else:
            paths += [ROOT / "tests" / "localization.test.py"]
    return [path for path in paths if path.is_file()]


HOST_TESTS = ["tests/browser-smoke/host.test.mjs", "tests/browser-smoke/localization.test.mjs",
              "tests/event-queue.test.mjs", "tests/compare-traces.test.mjs"]


def structured(text, key):
    values = []
    for line in text.splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and key in value:
            values.append(value)
    if len(values) != 1 or values[0].get("result") != "pass":
        raise ValueError(f"Expected exactly one successful structured result for {key}")
    value = values[0]
    count = value[key]
    if type(count) is not int or count < 1:
        raise ValueError(f"Invalid successful check count: {key}")
    return {"passed": count, "total_checks": count, "failed": 0, "skipped": 0,
            "count_basis": "assertions reported by the standalone executable", "reported": value}


def rust_tests(text):
    results = re.findall(r"test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", text)
    if not results:
        raise ValueError("Missing native cargo test summary")
    passed = sum(int(row[0]) for row in results)
    failed = sum(int(row[1]) for row in results)
    skipped = sum(int(row[2]) + int(row[4]) for row in results)
    if passed < 1 or failed or skipped:
        raise ValueError("Native Cargo checks are empty, failed, or skipped")
    return {"passed": passed, "total_checks": passed, "failed": failed, "skipped": skipped,
            "count_basis": "native Cargo unit tests from --bins (library tests disabled)"}


def native_artifacts(text):
    executables = []
    for line in text.splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if (isinstance(value, dict) and value.get("reason") == "compiler-artifact"
                and value.get("profile", {}).get("test") and value.get("executable")
                and "bin" in value.get("target", {}).get("kind", [])):
            path = Path(value["executable"]).resolve()
            if not path.is_relative_to(ROOT.resolve()) or not path.is_file():
                raise ValueError("Cargo reported a test executable outside the project or missing")
            executables.append(path)
    if len(executables) != 2 or len(set(executables)) != 2:
        raise ValueError("Expected both standalone native bin test executables")
    return executables


def node_tests(text):
    values = {}
    for key in ("tests", "pass", "fail", "skipped"):
        found = re.findall(r"^# " + key + r" (\d+)\s*$", text, re.M)
        if len(found) != 1:
            raise ValueError(f"Missing or ambiguous Node TAP summary: {key}")
        values[key] = int(found[0])
    if values["tests"] < 1 or values["pass"] != values["tests"] or values["fail"] or values["skipped"]:
        raise ValueError("Node host tests failed or skipped")
    return {"passed": values["pass"], "total_checks": values["tests"], "failed": values["fail"],
            "skipped": values["skipped"], "count_basis": "Node TAP test cases; no Chrome or game executable"}


def python_tests(text):
    counts = re.findall(r"^Ran (\d+) tests? in ", text, re.M)
    if len(counts) != 1 or not re.search(r"^OK\s*$", text, re.M):
        raise ValueError("Missing successful Python unittest summary")
    count = int(counts[0])
    if count < 1:
        raise ValueError("Python test run is empty")
    return {"passed": count, "total_checks": count, "failed": 0, "skipped": 0,
            "count_basis": "Python unittest test methods"}


def ui_validator(text):
    values = []
    for line in text.splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and "catalog_ids" in value:
            values.append(value)
    if len(values) != 1 or any(values[0].get(key) != "pass" for key in
        ("english_source_match", "japanese_encoding_and_placeholder_parity", "c_ui_id_coverage")):
        raise ValueError("Missing successful UI catalog validator result")
    return {"passed": 1, "total_checks": 1, "failed": 0, "skipped": 0,
            "count_basis": "one complete UI catalog validator invocation", "reported": values[0]}


def command(args, log_path, environment):
    started = utc()
    start = time.monotonic()
    with log_path.open("w", encoding="utf-8", newline="\n") as log:
        log.write(json.dumps({"command": args, "cwd": str(ROOT), "started_at_utc": started}, ensure_ascii=False) + "\n")
        log.flush()
        try:
            result = subprocess.run(args, cwd=ROOT, env=environment, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, check=False)
            code = result.returncode
            output = result.stdout.decode("utf-8", errors="replace")
        except OSError as error:
            code, output = 127, str(error)
        log.write(output)
        if output and not output.endswith("\n"):
            log.write("\n")
        log.write(json.dumps({"exit_code": code, "finished_at_utc": utc(),
                              "elapsed_seconds": round(time.monotonic() - start, 3)}) + "\n")
    return {"command": args, "exit_code": code, "log": log_path.relative_to(ROOT).as_posix(),
            "started_at_utc": started, "finished_at_utc": utc()}, output


def specifications(args):
    manifest = str(ROOT / "rust" / "Cargo.toml")
    cargo = shutil.which("cargo") or "cargo"
    node = shutil.which("node") or "node"
    sdk = Path(args.sdk_root).resolve()
    linker = str(sdk / "upstream" / "emscripten" / "emcc.exe")
    python = str(sdk / "python" / "3.13.3_64bit" / "python.exe")

    def wasm(binary):
        build = [cargo, "rustc", "--offline", "--locked", "--manifest-path", manifest, "--bin", binary,
                 "--release", "--target", "wasm32-unknown-emscripten", "--", "-C", "linker=" + linker,
                 "-C", "panic=abort", "-C", "link-arg=-sENVIRONMENT=node", "-C", "link-arg=-sEXIT_RUNTIME=1",
                 "-C", "link-arg=-sALLOW_MEMORY_GROWTH=1"]
        base = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "rust" / "target")) / "wasm32-unknown-emscripten" / "release"
        js = base / (binary + ".js")
        output = [js, base / (binary.replace("-", "_") + ".wasm")]
        key = "total_checks" if binary == "layer-check" else "entity_checks"
        return [{"name": "build", "command": build, "build": True},
                {"name": "wasm", "command": [node, str(js)], "outputs": output,
                 "parser": lambda text: structured(text, key)}]

    return {
        "rust_standalone": wasm("layer-check") + [
            {"name": "native-build", "command": [cargo, "test", "--offline", "--locked", "--manifest-path", manifest,
                "--bins", "--no-run", "--message-format=json"], "build": True, "discover_artifacts": native_artifacts},
            {"name": "native-bins", "command": [cargo, "test", "--offline", "--locked", "--manifest-path", manifest,
                "--bins"], "parser": rust_tests, "built_outputs": True}],
        "entities": wasm("entity-check"),
        "rust_static": [
            {"name": "format", "command": [cargo, "fmt", "--manifest-path", manifest, "--all", "--", "--check"]},
            {"name": "clippy", "command": [cargo, "clippy", "--offline", "--locked", "--manifest-path", manifest,
                                           "--all-targets", "--", "-D", "warnings"]}],
        "host": [{"name": "node", "command": [node, "--test", "--test-reporter=tap", *HOST_TESTS], "parser": node_tests}],
        "catalog": [
            {"name": "unit", "command": [python, "tests/catalog.test.py"], "parser": python_tests},
            {"name": "ui", "command": [python, "tests/ui-game-catalog.test.py"], "parser": ui_validator}],
        "localization": [{"name": "unit", "command": [python, "tests/localization.test.py"], "parser": python_tests}],
    }


def run_scope(scope, operations, environment, log_directory, run_id):
    started = utc()
    before = snapshot(inputs(scope))
    executions, output_files, built_outputs = [], [], []
    failures = []
    for operation in operations:
        log_path = log_directory / (scope + "-" + operation["name"] + "-" + run_id + ".log")
        tested_outputs = built_outputs if operation.get("built_outputs") else operation.get("outputs", [])
        try:
            output_before = snapshot(tested_outputs)
        except OSError as error:
            log_path.write_text("Cannot hash compiled artifacts before execution: " + str(error) + "\n", encoding="utf-8")
            output_files.append(log_path)
            failures.append(str(error))
            continue
        execution, text = command(operation["command"], log_path, environment)
        executions.append(execution)
        output_files.append(log_path)
        if execution["exit_code"] != 0:
            failures.append(f"{operation['name']} exited {execution['exit_code']}")
            if operation.get("build"):
                break
            continue
        if "discover_artifacts" in operation:
            try:
                built_outputs = operation["discover_artifacts"](text)
            except ValueError as error:
                failures.append(str(error))
                break
        if output_before:
            output_after = snapshot(tested_outputs)
            execution["artifacts_before_test"] = list(output_before.values())
            execution["artifacts_after_test"] = list(output_after.values())
            output_files += tested_outputs
            if output_before != output_after:
                failures.append(f"{operation['name']} changed its compiled artifacts")
        try:
            if "parser" in operation:
                execution["counts"] = operation["parser"](text)
            elif not operation.get("build"):
                execution["counts"] = {"passed": 1, "total_checks": 1, "failed": 0, "skipped": 0,
                    "count_basis": "one successfully completed static checker invocation"}
        except ValueError as error:
            failures.append(str(error))
    after = snapshot(inputs(scope))
    changed = sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))
    if changed:
        failures.append("Test input inventory or bytes changed during this scope")
    counts = {key: sum(execution.get("counts", {}).get(key, 0) for execution in executions)
              for key in ("passed", "total_checks", "failed", "skipped")}
    if not failures and counts["passed"] < 1:
        failures.append("No actual successful checks were reported")
    return {"status": "failed" if failures else "passed",
            "exit_code": next((run["exit_code"] for run in executions if run["exit_code"]), 1 if failures else 0),
            **counts, "started_at_utc": started, "finished_at_utc": utc(),
            "count_basis": "sum of execution counts; each execution records its own unit",
            "input_hashes_before": list(before.values()), "input_hashes_after": list(after.values()),
            "changed_inputs": changed, "executions": executions, "errors": failures,
            "files": records([local(name) for name in after] + output_files)}


def merge_evidence(tests, name, replace=False):
    path = local(name)
    evidence = json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object)
    if evidence.get("schema") != 1 or not isinstance(evidence.get("tests"), dict):
        raise ValueError(f"Invalid merge evidence: {name}")
    for scope, result in evidence["tests"].items():
        if scope not in MERGE_SCOPES or (scope in tests and not replace):
            raise ValueError(f"Unexpected or duplicate merged scope: {scope}")
        if result.get("status") != "passed" or type(result.get("exit_code")) is not int or result["exit_code"] != 0:
            raise ValueError(f"Unsuccessful merge scope: {scope}")
        for key in ("passed", "checks", "total_checks", "failed", "skipped"):
            if key in result and (type(result[key]) is not int or result[key] < 0):
                raise ValueError(f"Invalid merge count: {scope}/{key}")
        if result.get("failed", 0) or result.get("skipped", 0):
            raise ValueError(f"Merged scope has failures or skips: {scope}")
        files = result.get("files", [])
        if not files:
            raise ValueError(f"Merge scope has no file evidence: {scope}")
        names = set()
        for item in files:
            if item["path"] in names or file_record(local(item["path"]))["sha256"] != item["sha256"]:
                raise ValueError(f"Changed or duplicate merged file: {scope}/{item['path']}")
            names.add(item["path"])
        if not any(name.endswith((".log", ".txt", ".json")) for name in names):
            raise ValueError(f"Merge scope has no result log: {scope}")
        if not any(not name.endswith((".log", ".txt", ".json")) for name in names):
            raise ValueError(f"Merge scope has no tested source or executable: {scope}")
        manifest = file_record(path)
        tests[scope] = {**result, "files": files + ([] if manifest["path"] in names else [manifest]),
                        "merged_from": manifest}


def write_evidence(output, tests, errors=None):
    output.parent.mkdir(parents=True, exist_ok=True)
    value = {"schema": 1, "recorded_at_utc": utc(), "runner": "tools/verify-japanese.py", "tests": tests}
    if errors:
        value["evidence_errors"] = errors
    output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def existing_evidence(output, resolving_merge):
    evidence = json.loads(output.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object)
    tests = evidence.get("tests")
    if evidence.get("schema") != 1 or not isinstance(tests, dict) or not tests:
        raise ValueError("Invalid or empty existing supplementary evidence")
    if evidence.get("evidence_errors") and not resolving_merge:
        raise ValueError("Existing evidence has unresolved merge errors")
    for scope, result in tests.items():
        if scope not in set(SCOPES) | MERGE_SCOPES:
            raise ValueError("Unknown existing evidence scope: " + scope)
        if (not isinstance(result, dict) or result.get("status") != "passed"
                or type(result.get("exit_code")) is not int or result["exit_code"] != 0):
            raise ValueError("Existing scope did not pass: " + scope)
        for key in ("passed", "checks", "total_checks", "failed", "skipped"):
            if key in result and (type(result[key]) is not int or result[key] < 0):
                raise ValueError(f"Invalid existing count: {scope}/{key}")
        if result.get("failed", 0) or result.get("skipped", 0):
            raise ValueError("Existing scope has failures or skips: " + scope)
        files = result.get("files")
        if not isinstance(files, list) or not files:
            raise ValueError("Existing scope has no file evidence: " + scope)
        names = set()
        for item in files:
            path = local(item["path"])
            if item["path"] in names or file_record(path)["sha256"] != item["sha256"]:
                raise ValueError(f"Changed or duplicate existing file: {scope}/{item['path']}")
            names.add(item["path"])
        if (not any(name.endswith((".log", ".txt", ".json")) for name in names)
                or not any(not name.endswith((".log", ".txt", ".json")) for name in names)):
            raise ValueError("Existing scope lacks source/executable or result log: " + scope)
    return tests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-root", default=r"C:\Users\kit\emsdk")
    parser.add_argument("--scopes", nargs="+", choices=SCOPES, default=list(SCOPES))
    parser.add_argument("--output", default="build/supplementary-results.json")
    parser.add_argument("--merge", action="append", default=[])
    parser.add_argument("--merge-only", action="store_true", help="Validate/reuse an existing output and add fresh C evidence without rerunning checks")
    parser.add_argument("--plan", action="store_true", help="Print commands and inputs without executing or writing")
    args = parser.parse_args()
    if len(args.scopes) != len(set(args.scopes)):
        parser.error("Scopes cannot repeat")
    operations = specifications(args)
    if args.plan:
        print(json.dumps({scope: {"commands": [operation["command"] for operation in operations[scope]],
                                 "input_files": len(inputs(scope))} for scope in args.scopes}, indent=2))
        return 0
    with TemporaryArtifacts(ROOT) as artifacts:
        operations = specifications(args)
        sdk = Path(args.sdk_root).resolve()
        environment = os.environ.copy()
        environment.update({"EM_CONFIG": str(sdk / ".emscripten"),
                            "EMSDK_PYTHON": str(sdk / "python" / "3.13.3_64bit" / "python.exe"),
                            "EM_CACHE": os.environ["EM_CACHE"],
                            "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
        log_directory = artifacts.path("build/verification-logs")
        log_directory.mkdir(parents=True, exist_ok=True)
        output = artifacts.path(args.output)
        tests = existing_evidence(output, bool(args.merge)) if args.merge_only else {}
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        for scope in ([] if args.merge_only else args.scopes):
            print(f"Running {scope}", flush=True)
            tests[scope] = run_scope(scope, operations[scope], environment, log_directory, run_id)
            print(json.dumps({"scope": scope, "status": tests[scope]["status"],
                              "passed": tests[scope]["passed"], "errors": tests[scope]["errors"]}), flush=True)
            write_evidence(output, tests)
        evidence_errors = []
        for name in args.merge:
            try:
                merge_evidence(tests, name, replace=args.merge_only)
            except (OSError, ValueError, KeyError) as error:
                evidence_errors.append(str(error))
        # Cross-scope changes invalidate old evidence instead of silently binding
        # a prior run to the current source bytes.
        for scope, result in tests.items():
            for item in result["files"]:
                if file_record(local(item["path"]))["sha256"] != item["sha256"]:
                    result["status"] = "failed"
                    result["exit_code"] = 1
                    result.setdefault("errors", []).append("Evidence changed after scope: " + item["path"])
        write_evidence(output, tests, evidence_errors)
        print(json.dumps({"supplementary_results": output.relative_to(ROOT).as_posix(),
                          "scopes": {name: result["status"] for name, result in tests.items()}}), flush=True)
        return 1 if evidence_errors or any(result["status"] != "passed" for result in tests.values()) else 0


if __name__ == "__main__":
    sys.exit(main())

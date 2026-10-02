"""Check current evidence and record a delivery inventory without running builds.

Counts come from recorded results, never from an expected historical total.
Optional test evidence must have a successful exit and hash-bound input files;
otherwise the recorder marks that scope unrecorded rather than assuming success.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_DIRS = {
    "target", "em-cache", "c-objects", "baseline-c-objects", "save-review",
    "semantic-c-objects", "__pycache__", ".pytest_cache",
}
RECORD_FILES = {"artifacts-manifest.json", "verification.json", "delivery.json"}
ARCHIVE_HASH = "7d37a61fc098bda0e6fac30799da347294067e8e079e4b40d6c781468e08e8a1"
CATALOG_PAIRS = {
    "game": ("en.json", "ja.json", ("messages",)),
    "ui-game": ("ui-game-en.json", "ui-game-ja.json", ("messages",)),
    "runtime": ("runtime-en.json", "runtime-ja.json", ("messages",)),
    "endings": ("endings-en.json", "endings-ja.json", ("messages",)),
    "ui-web": ("ui-web-en.json", "ui-web-ja.json", ("messages",)),
    "entities": ("entities-en.json", "entities-ja.json", ("entries", "forms")),
}
OPTIONAL_TEST_SCOPES = (
    "rust_standalone", "entities", "host", "catalog", "localization",
    "message_capture", "message_paging", "semantic_capture", "options_utf8",
    "rust_static", "verification_recorder",
)


def require(condition: bool, description: str):
    if not condition:
        raise ValueError(description)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_object(pairs):
    value = {}
    for key, entry in pairs:
        require(key not in value, f"Duplicate JSON key: {key}")
        value[key] = entry
    return value


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object)


def local_path(name: str, root: Path = ROOT) -> Path:
    path = (root / name).resolve()
    require(path.is_relative_to(root.resolve()), f"Evidence path leaves its allowed directory: {name}")
    return path


def checked_files(items, root: Path = ROOT, key: str = "file"):
    require(isinstance(items, list) and bool(items), "Evidence file list is empty")
    names = set()
    for item in items:
        name = item[key]
        require(name not in names, f"Duplicate evidence file: {name}")
        names.add(name)
        path = local_path(name, root)
        require(digest(path) == item["sha256"], f"Evidence file changed: {name}")
        if "bytes" in item:
            require(path.stat().st_size == item["bytes"], f"Evidence file size changed: {name}")
    return {item[key]: item for item in items}


def record(path: Path):
    return {"path": path.relative_to(ROOT).as_posix(),
            "bytes": path.stat().st_size, "sha256": digest(path)}


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def module_hashes(outputs):
    wasm = [item for name, item in outputs.items() if name.endswith(".wasm")]
    javascript = [item for name, item in outputs.items() if name.endswith((".js", ".cjs"))]
    require(len(wasm) == len(javascript) == 1, "A game module must have one Wasm and one JavaScript output")
    return {"wasm_sha256": wasm[0]["sha256"], "javascript_sha256": javascript[0]["sha256"]}


def check_browser(browser, outputs, evidence_path="tests/browser-smoke/output-ja/evidence.json"):
    actual = checked_files(browser["actual_build_files"], ROOT / "build")
    require(set(actual) == set(outputs), "Browser artifact inventory differs from the current build")
    for name, item in outputs.items():
        require(actual[name]["sha256"] == item["sha256"] and actual[name]["bytes"] == item["bytes"],
                f"Browser tested a different artifact: {name}")
    checks = browser["checks"]
    require(browser["status"] == "passed" and isinstance(checks, list) and bool(checks),
            "Browser smoke test did not pass recorded checks")
    require(len(checks) == len(set(checks)), "Browser evidence contains duplicate check names")
    return {"status": "passed", "passed": len(checks), "checks": checks,
            "started_at": browser["started_at"], "finished_at": browser["finished_at"],
            "evidence": evidence_path}


def check_game(game, main_module, fixture_module, baseline_module, baseline_fixture_module):
    total, passed, failed, skipped = (game[key] for key in ("game_tests", "passed", "failed", "skipped"))
    require(all(type(n) is int and n >= 0 for n in (total, passed, failed, skipped)),
            "Game regression counts must be nonnegative integers")
    require(total > 0 and total == passed + failed + skipped and failed == skipped == 0,
            "Game regression summary is incomplete or contains failed/skipped tests")
    for field, split, original in (("normal_cases", main_module, baseline_module),
                                    ("fixture_cases", fixture_module, baseline_fixture_module)):
        cases = game[field]
        require(isinstance(cases, list) and bool(cases), f"Game comparison evidence is empty: {field}")
        require(len({str(case["case"]) for case in cases}) == len(cases), f"Duplicate comparison case: {field}")
        for case in cases:
            require(case["split_module"] == split, f"Game comparison used a different product: {field}/{case['case']}")
            require(case["baseline_module"] == original, f"Game comparison used a different baseline: {field}/{case['case']}")
    raw = game["all_raw_results"]
    indexed_raw = checked_files(raw)
    role_modules = {"game": main_module, "baseline": baseline_module,
                    "game-fixtures": fixture_module, "baseline-fixtures": baseline_fixture_module}
    require({item["module_role"] for item in raw} == set(role_modules), "Raw game evidence must include all four module roles")
    for item in raw:
        require(item["module_role"] in role_modules, f"Unknown raw-result module role: {item['module_role']}")
        require(item["module"] == role_modules[item["module_role"]],
                f"Raw game evidence used a different module: {item['file']}")
    japanese = game.get("japanese_cases", [])
    require(isinstance(japanese, list), "Japanese game cases must be a list")
    require(len({str(case["case"]) for case in japanese}) == len(japanese), "Duplicate Japanese comparison case")
    for case in japanese:
        role = case["module_role"]
        require(role in ("main", "fixture"), f"Unknown Japanese module role: {role}")
        require(case["split_module"] == (main_module if role == "main" else fixture_module),
                f"Japanese game comparison used a different product: {case['case']}")
        require(case["comparison"] in ("locale_same_C_state", "split_only_utf8", "original_rule_baseline"),
                f"Unknown Japanese comparison scope: {case['case']}")
        checked_files(case["raw_files"])
        for item in case["raw_files"]:
            joined = indexed_raw.get(item["file"])
            require(joined is not None and joined["sha256"] == item["sha256"] and joined["bytes"] == item["bytes"],
                    f"Japanese raw evidence is absent/different in the complete result inventory: {item['file']}")
        if "baseline_module" in case:
            require(case["baseline_module"] == (baseline_module if role == "main" else baseline_fixture_module),
                    f"Japanese game comparison used a different baseline: {case['case']}")
        if case["comparison"] == "original_rule_baseline":
            require("baseline_module" in case, f"Japanese baseline comparison lacks the baseline artifact: {case['case']}")
    return {"status": "passed", "passed": passed, "failed": failed, "skipped": skipped,
            "normal_cases": len(game["normal_cases"]), "fixture_comparisons": len(game["fixture_cases"]),
            "restore_cases": len(game.get("restore_cases", [])), "raw_results_checked": len(raw),
            "japanese_cases": len(japanese),
            "evidence": "tests/game-results-summary.json", "limitations": game.get("limitations", [])}


def check_saves(saves, raw_runs):
    checked_files(saves["sources"])
    if "artifacts" in saves:
        checked_files(saves["artifacts"])
    require(bool(raw_runs), "Save-adapter raw results are empty")
    results, faults = [], 0
    for text in raw_runs:
        found = []
        for line in text.splitlines():
            if line.startswith("{"):
                item = json.loads(line, object_pairs_hook=unique_object)
                if "save_adapter" in item:
                    found.append(item)
        require(len(found) == 1 and found[0]["save_adapter"] == "pass",
                "A save-adapter run lacks one successful structured result")
        fault_counts = re.findall(r"fault_injections=(\d+)", text)
        require(len(fault_counts) == 1, "A save-adapter run lacks one allocation-fault count")
        require(all(type(found[0][key]) is int and found[0][key] >= 0
                    for key in ("seed", "checks", "repeated_loads")), "Invalid save-adapter result counts")
        results.append(found[0])
        faults += int(fault_counts[0])
    require(len({item["seed"] for item in results}) == len(results), "Save-adapter seed evidence repeats a seed")
    totals = {"checks": sum(item["checks"] for item in results), "seeds": len(results),
              "allocation_faults": faults, "repeated_loads": sum(item["repeated_loads"] for item in results)}
    require(all(totals[key] == saves[key] for key in totals), "Raw save-adapter totals differ from manifest")
    return {"status": "passed", **totals, "source_inputs_checked": len(saves["sources"]),
            "seed_values": [item["seed"] for item in results], "evidence": "build/save-adapter-manifest.json"}


def catalog_inventory():
    families = {}
    for family, (en_name, ja_name, sections) in CATALOG_PAIRS.items():
        en, ja = (read_json(ROOT / "locales" / name) for name in (en_name, ja_name))
        version, language = ("version", "locale") if family == "ui-web" else ("schema", "language")
        require(en[version] == ja[version] == 1 and en[language] == "en" and ja[language] == "ja",
                f"Catalog schema/language mismatch: {family}")
        counts = {}
        for section in sections:
            require(isinstance(en[section], dict) and bool(en[section]) and set(en[section]) == set(ja[section]),
                    f"Catalog ID sets differ or are empty: {family}/{section}")
            counts[section] = len(ja[section])
        families[family] = {"sections": counts, "paired_id_sets": "matched",
                            "files": [record(ROOT / "locales" / name) for name in (en_name, ja_name)]}
    return {"languages": ["en", "ja"], "families": families,
            "validation_note": "ID parity is checked here; translation/signature checks use separately recorded localization test evidence."}


def supplementary_tests(path: Path | None):
    tests = {scope: {"status": "unrecorded", "reason": "No current hash-bound execution evidence supplied"}
             for scope in OPTIONAL_TEST_SCOPES}
    if path is None:
        return tests
    evidence = read_json(path)
    require(evidence["schema"] == 1 and isinstance(evidence["tests"], dict), "Invalid supplementary test evidence schema")
    for scope, result in evidence["tests"].items():
        require(scope in tests, f"Unknown supplementary test scope: {scope}")
        require(result["status"] == "passed" and type(result["exit_code"]) is int and result["exit_code"] == 0,
                f"Supplementary test failed or lacks a successful exit: {scope}")
        checked_files(result["files"], key="path")
        require(any(name.endswith((".log", ".txt", ".json")) for name in (item["path"] for item in result["files"])),
                f"Supplementary test lacks a recorded execution result: {scope}")
        require(any(not name.endswith((".log", ".txt", ".json")) for name in (item["path"] for item in result["files"])),
                f"Supplementary test lacks a bound source or executable: {scope}")
        for key in ("passed", "checks", "total_checks", "failed", "skipped"):
            if key in result:
                require(type(result[key]) is int and result[key] >= 0, f"Invalid supplementary test count: {scope}/{key}")
        require(result.get("failed", 0) == result.get("skipped", 0) == 0, f"Supplementary test has failures/skips: {scope}")
        tests[scope] = {**result, "evidence_record": record(path)}
    return tests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--delivery-target", type=Path, required=True)
    parser.add_argument("--supplementary-results", type=Path,
                        help="Schema-1 JSON with successful test results and SHA256-bound inputs/logs")
    parser.add_argument("--browser-evidence", type=Path,
                        default=ROOT / "tests/browser-smoke/output-ja/evidence.json",
                        help="Final browser evidence JSON (default: Japanese smoke output)")
    parser.add_argument("--remaining", action="append",
                        help="Explicit remaining scope; repeat as needed instead of inferring unfinished translation work")
    args = parser.parse_args()
    original = args.original.resolve()
    source_root = original / "sources" / "rogue5.4.4"
    sources = read_json(original / "source-files.json")
    source_paths = {item["path"] for item in sources}
    actual_paths = {p.relative_to(source_root).as_posix() for p in source_root.rglob("*") if p.is_file()}
    require(actual_paths == source_paths and len(sources) == 55, "Original source inventory changed")
    for item in sources:
        path = local_path(item["path"], source_root)
        require(path.stat().st_size == item["size_bytes"] and digest(path) == item["sha256"],
                f"Original source changed: {item['path']}")
    require(digest(original / "rogue5.4.4-src.tar.gz") == ARCHIVE_HASH, "Original archive changed")

    build = read_json(ROOT / "build" / "build-manifest.json")
    browser_path = args.browser_evidence.resolve()
    require(browser_path.is_relative_to(ROOT), "Browser evidence must be inside the implementation directory")
    browser = read_json(browser_path)
    game = read_json(ROOT / "tests" / "game-results-summary.json")
    saves = read_json(ROOT / "build" / "save-adapter-manifest.json")
    baseline = read_json(ROOT / "tests" / "baseline-source-audit.json")
    outputs = checked_files(build["outputs"], ROOT / "build")
    module_manifests = {}
    for scope, filename in (("fixture", "build-manifest-game-fixtures.json"),
                             ("baseline", "build-manifest-baseline.json"),
                             ("baseline_fixture", "build-manifest-baseline-fixtures.json")):
        manifest = read_json(ROOT / "build" / filename)
        module_manifests[scope] = module_hashes(checked_files(manifest["outputs"], ROOT / "build"))
    tests = {"browser": check_browser(browser, outputs, browser_path.relative_to(ROOT).as_posix()),
             "game_regression": check_game(game, module_hashes(outputs), module_manifests["fixture"],
                                            module_manifests["baseline"], module_manifests["baseline_fixture"])}
    require(baseline["checks_passed"], "Baseline source audit failed")
    audit_files = baseline["files"]
    tests["baseline_source"] = {"status": "passed", "checks": len(audit_files),
                               "byte_identical_c": sum(item["file"].endswith(".c") and item.get("byte_identical", False)
                                                       for item in audit_files),
                               "evidence": "tests/baseline-source-audit.json"}
    seed_runs = read_json(ROOT / "build" / "save-adapter-seeds.json")
    require(all(type(run["exit"]) is int and run["exit"] == 0 for run in seed_runs), "A save-adapter seed failed")
    raw_runs = [run["output"] for run in seed_runs]
    raw_runs.append((ROOT / "build" / "save-adapter-result.txt").read_text(encoding="utf-8-sig"))
    tests["save_adapter"] = check_saves(saves, raw_runs)
    tests.update(supplementary_tests(args.supplementary_results.resolve() if args.supplementary_results else None))
    catalogs = catalog_inventory()
    coverage = read_json(ROOT / "locales" / "coverage.json")
    catalogs["source_scan"] = {key: coverage[key] for key in ("calls", "literal_template_ids", "literal_or_choice_calls")}
    catalogs["source_scan"]["dynamic_calls"] = len(coverage["dynamic_calls"])
    catalogs["source_scan"]["note"] = "Dynamic source calls may use semantic IDs; this count alone does not establish untranslated text."

    records = sorted((record(path) for path in ROOT.rglob("*") if path.is_file()
                      and path.relative_to(ROOT).as_posix() not in RECORD_FILES
                      and not any(part in EXCLUDED_DIRS for part in path.relative_to(ROOT).parts)),
                     key=lambda item: item["path"])
    now = datetime.now(timezone.utc).isoformat()
    inventory = {"schema": 1, "recorded_at_utc": now, "files": records,
                 "excluded_directories": sorted(EXCLUDED_DIRS), "excluded_self_referential_records": sorted(RECORD_FILES),
                 "files_count": len(records), "bytes": sum(item["bytes"] for item in records)}
    write_json(ROOT / "artifacts-manifest.json", inventory)
    verification = {
        "schema": 2, "recorded_at_utc": now, "status": "passed",
        "scope": "Preserved-source integrity and hash-bound recorded test evidence; unrecorded scopes are explicit",
        "delivery_target": str(args.delivery_target.resolve()),
        "original": {"directory": str(original), "source_files_checked": len(sources),
                     "changed_source_files": [], "archive_sha256": ARCHIVE_HASH},
        "existing_brogue": {"edits_made": False, "scope": "Only the new isolated implementation directory is delivered; no clean Git working-tree claim"},
        "product": {"c_sources": build["c_source_files"], "rust_layers": ["display", "platform", "input"],
                    "abi": "contract/rogue_abi.h", "outputs": list(outputs.values()), "build_evidence": "build/build-manifest.json",
                    "transport": "Worker + SharedArrayBuffer; no Asyncify"},
        "tests": tests, "catalog": catalogs,
        "inventory": {"file": "artifacts-manifest.json", "sha256": digest(ROOT / "artifacts-manifest.json"),
                      "files_count": len(records), "bytes": inventory["bytes"]},
        "remaining": args.remaining if args.remaining is not None else ["Smartphone/gamepad controls", "Persistent leaderboard",
                       "Independent native curses and exhaustive gameplay compatibility validation", "Public deployment"],
        "approval_blockers": [],
    }
    write_json(ROOT / "verification.json", verification)
    print(json.dumps({"status": "passed", "original_files": len(sources), "inventory_files": len(records),
                      "product_module": module_hashes(outputs), "catalog_families": len(catalogs["families"]),
                      "unrecorded_test_scopes": [key for key, value in tests.items() if value["status"] == "unrecorded"]}))


if __name__ == "__main__":
    main()

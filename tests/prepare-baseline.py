"""Create the original-source rule baseline without changing the acquisition.

This copies original bytes first. Only the named, reviewed portability/runtime
adaptations are overlaid. Original RN and original English msg/doadd are retained.
Every difference from the acquisition is emitted as a unified diff and hash pair.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
DEFAULT_ORIGINAL = Path(r"C:\Users\kit\gameme\jnethack\jrouge\investigation-20261002-original-rogue\sources\rogue5.4.4")

# These files have only platform startup, observation, typed callback, or state
# access changes. The generated diff is authoritative; no rule algorithm is
# substituted from another work or another Rogue version.
ADAPTED = {
    "armor.c": "completion-counter observation only",
    "command.c": "persistent-static accessors and completion-counter observation only",
    "daemon.c": "Wasm callback signature adapter; scheduling/body unchanged",
    "main.c": "portable entry, outer checkpoint, OS shell/TTY exclusion, outcome observation",
    "mach_dep.c": "replace terminal/platform services with shared host adapter",
    "mdport.c": "replace terminal/platform services with shared host adapter",
    "misc.c": "persistent last direction static accessors only",
    "rip.c": "outcome observation and libc prototype compatibility only",
    "things.c": "persistent pagination static accessors only",
    "save.c": "shared browser checkpoint infrastructure; legacy file path excluded",
    "state.c": "shared hardened serializer; not an independent old-save baseline",
}
SHARED = (
    "core.c", "core.h", "knowledge.c", "knowledge.h", "curses.h",
    "platform_md.h", "platform_system.h", "layer_config.h",
    "save_adapter.c", "state_codec.h", "io_state.h", "message.c", "message.h",
    "message_catalog.inc", "sources.txt",
    "semantic.c", "semantic.h",
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def text(path: Path) -> str:
    return path.read_bytes().decode("utf-8")


def once(body: str, before: str, after: str) -> str:
    if body.count(before) != 1:
        raise ValueError(f"Expected one exact adaptation site: {before!r}")
    return body.replace(before, after, 1)


def extract_block(body: str, start: str, end: str) -> str:
    a = body.index(start)
    b = body.index(end, a)
    return body[a:b]


def strip_new_presentation(body: str, name: str) -> str:
    """Keep the comparison rule body independent of the Japanese observers."""
    body = re.sub(r'#ifdef ROGUE_LAYERED /\* RG_UI_PRESENTATION \*/\n.*?#endif\n', '', body, flags=re.S)
    if name == 'command.c':
        body = once(body, ' */\n\nvoid\nhelp()', ' */\nvoid\nhelp()')
    if name == 'main.c':
        body = once(body, '        {\n            char arguments[128];\n'
                    '            rg_capture_arguments(arguments, sizeof arguments, "%d", purse);\n'
                    '            rg_ui_line("score", LINES - 2, 0, "ui.quit_gold", arguments, "");\n'
                    '        }\n', '')
    if name == 'misc.c':
        body = once(body, "\t\twhen ESCAPE: last_dir = '\\0'; reset_last();\n            return FALSE;",
                    "\t\twhen ESCAPE: last_dir = '\\0'; reset_last(); return FALSE;")
    if name == 'things.c':
        body = once(body, '#include "semantic.h"\n', '')
        body = once(body, '    rg_semantic_item(prbuf, obj, drop);\n', '')
        body = once(body, '    if (num_found == 0)\n    {\n        char *text = nothing(type);\n        add_line(text, NULL);\n    }',
                    '    if (num_found == 0)\n\tadd_line(nothing(type), NULL);')
    return body


def adapt_rip(original: str) -> str:
    """The original scoring/death algorithms, with only the old host adapters."""
    body = once(original, 'death(char monst)\n{\n',
                'death(char monst)\n{\n#ifdef ROGUE_LAYERED\n    rg_core_set_outcome(1, "dead");\n#endif\n')
    body = once(body, 'total_winner()\n{\n',
                'total_winner()\n{\n#ifdef ROGUE_LAYERED\n    rg_core_set_outcome(2, "winner");\n#endif\n')
    return once(body, '    struct tm *localtime();\n', '#ifndef ROGUE_LAYERED\n    struct tm *localtime();\n#endif\n')


def adapt_io(original: str, split: str) -> str:
    # Names, formatting, strcat, threshold, More loop, look and refresh order
    # remain original. Metadata notifications have no C game-state side effects.
    body = once(original, '#include "rogue.h"',
                '#include <stdint.h>\n#include <stdlib.h>\n#include <stdio.h>\n'
                '#include "rogue.h"\n#include "io_state.h"\n#include "rogue_abi.h"')
    body = once(body, "\tmpos = 0;\n\treturn ~ESCAPE;",
                '\tmpos = 0;\n\trg_host_message("message.clear", "[]", "");\n\treturn ~ESCAPE;')
    body = once(body, "    mvaddstr(0, 0, msgbuf);\n    clrtoeol();",
                '    mvaddstr(0, 0, msgbuf);\n    clrtoeol();\n'
                '    rg_host_message("message.legacy", "[]", msgbuf);')

    private_state = extract_block(split, "/* Private logical paging state", "/*\n * step_ok:")
    # The baseline does not accumulate catalog metadata.
    private_state = private_state.replace("    rg_message_discard();\n", "")
    body = once(body, "/*\n * step_ok:", private_state + "/*\n * step_ok:")

    local_declarations = (
        "    static int hpwidth = 0;\n    static int s_hungry = 0;\n"
        "    static int s_lvl = 0;\n    static int s_pur = -1;\n"
        "    static int s_hp = 0;\n    static int s_arm = 0;\n"
        "    static str_t s_str = 0;\n    static int s_exp = 0;\n"
    )
    body = once(body, local_declarations, "")
    body = once(body, "void\nstatus()", local_declarations.replace("    static", "static") + "\nvoid\nstatus()")
    accessors = extract_block(split, "#ifdef ROGUE_LAYERED\nvoid rg_status_state_get", "/*\n * wait_for")
    body = once(body, "/*\n * wait_for", accessors + "/*\n * wait_for")
    return body


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--original", type=Path, default=DEFAULT_ORIGINAL)
    args = parser.parse_args()
    original = args.original.resolve()
    layered = PROJECT / "logic"
    target = PROJECT / "tests" / "baseline-src"
    diffs = PROJECT / "tests" / "baseline-diffs"
    # Re-running is allowed only in the exact fixed baseline directory, and
    # writes known filenames without deleting or moving any existing path.
    assert target.resolve().parent == (PROJECT / "tests").resolve()
    target.mkdir(exist_ok=True)
    diffs.mkdir(exist_ok=True)
    acquisitions = sorted(p for p in original.iterdir() if p.suffix in (".c", ".h") or p.name == "LICENSE.TXT")
    if sum(p.suffix == ".c" for p in acquisitions) != 33:
        raise ValueError("Acquisition must contain exactly 33 C files")
    records = []
    for source in acquisitions:
        initial = source.read_bytes()
        (target / source.name).write_bytes(initial)
        category = "original bytes unchanged"
        output = initial
        if source.name in ADAPTED:
            output = (layered / source.name).read_bytes()
            category = ADAPTED[source.name]
            if source.name in ('command.c', 'misc.c', 'things.c', 'main.c'):
                output = strip_new_presentation(output.decode('utf-8'), source.name).encode('utf-8')
            elif source.name == 'rip.c':
                output = adapt_rip(initial.decode('utf-8')).encode('utf-8')
            if source.name == "command.c":
                # Preserve original replay formatting in bounded fixtures.
                # Percent-bearing user text is an original UB case and is
                # tested only against the safe split implementation.
                output = output.replace(b'when CTRL(\'P\'): after = FALSE; msg("%s", huh);',
                                        b"when CTRL('P'): after = FALSE; msg(huh);")
        elif source.name == "io.c":
            output = adapt_io(initial.decode("utf-8"), text(layered / "io.c")).encode("utf-8")
            category = "original msg/doadd/More; pure host notification and runtime accessors"
        elif source.name == "rogue.h":
            body = text(layered / "rogue.h")
            marker = "/* Source locations choose meaningful catalog IDs;"
            body = body[:body.index(marker)]
            output = body.encode("utf-8")
            category = "shared console/exit routing; original msg/addmsg names retained"
        elif source.name == "extern.h":
            body = text(layered / "extern.h")
            body = once(body, '#ifdef ROGUE_LAYERED\n#include "core.h"\n#define RN rg_random_next()\n#else\n'
                        '#define RN\t\t(((seed = seed*11109+13849) >> 16) & 0xffff)\n#endif',
                        '#define RN\t\t(((seed = seed*11109+13849) >> 16) & 0xffff)')
            output = body.encode("utf-8")
            category = "original RN expression retained; platform feature/prototype adaptation"
        # The nested source directory uses the same authoritative include path.
        if b'"../contract/rogue_abi.h"' in output:
            output = output.replace(b'"../contract/rogue_abi.h"', b'"rogue_abi.h"')
        (target / source.name).write_bytes(output)
        diff = "".join(difflib.unified_diff(initial.decode("utf-8").splitlines(keepends=True),
                                         output.decode("utf-8").splitlines(keepends=True),
                                         fromfile="acquired/" + source.name,
                                         tofile="baseline-src/" + source.name))
        (diffs / (source.name + ".diff")).write_text(diff, encoding="utf-8", newline="\n")
        records.append({"file": source.name, "category": category,
                        "original_sha256": sha(initial), "baseline_sha256": sha(output),
                        "byte_identical": initial == output,
                        "diff": "baseline-diffs/" + source.name + ".diff"})
    shared = []
    for name in SHARED:
        source = layered / name
        if not source.is_file():
            raise ValueError(f"Missing shared infrastructure: {source}")
        before = source.read_bytes()
        output = before.replace(b'"../contract/rogue_abi.h"', b'"rogue_abi.h"')
        (target / name).write_bytes(output)
        shared.append({"file": name, "source": "logic/" + name,
                       "shared_sha256": sha(before), "baseline_sha256": sha(output),
                       "include_path_only_change": before != output})
    manifest = {
        "schema": 1, "original_source": str(original), "original_version": "Rogue 5.4.4",
        "preparation_script_sha256": sha(Path(__file__).read_bytes()),
        "compiler_required": ["-DROGUE_LAYERED", "-std=gnu11", "-fwrapv", "-fno-strict-aliasing"],
        "original_files": records, "shared_infrastructure": shared,
        "split_only_safety_changes": [{
            "file": "pack.c",
            "original_sha256": sha((original / "pack.c").read_bytes()),
            "split_sha256": sha((layered / "pack.c").read_bytes()),
            "reason": "Split item labels have independent ownership; original shallow-label alias can become dangling after rename.",
            "comparison_limit": "Original-UB label split/rename cases are tested only against the safe split module.",
        }, {
            "file": "command.c",
            "original_sha256": sha((original / "command.c").read_bytes()),
            "split_sha256": sha((layered / "command.c").read_bytes()),
            "reason": "Recall uses a literal %s format so percent-bearing user text cannot be interpreted as variadic directives.",
            "comparison_limit": "Percent-bearing recall is a split-only safety regression; baseline retains original msg(huh).",
        }],
        "limits": [
            "Shared startup, knowledge/curses emulation, host, observation/hash and save infrastructure are not independently validated by this comparison.",
            "Native original curses and OS startup are not executed or verified.",
            "Original RN is tested with 32-bit signed int, -fwrapv, Wasm arithmetic right shift.",
            "Original vsprintf/strcat is retained only for bounded ASCII English regression fixtures; hostile/oversized names are outside this baseline.",
            "Message IDs differ; compare C state/RNG/input/knowledge and English cells, not translated metadata.",
            "Baseline pack.c retains original shallow-copy labels; label split/rename ownership regression belongs to split-only tests because the original has undefined behavior.",
            "Baseline command.c retains original msg(huh); recalling percent-bearing user text is an original undefined-behavior case and is tested split-only.",
            "Japanese UI and semantic observers are stripped from baseline rule files; translated metadata is verified separately from original ASCII cells/state.",
            "Baseline options.c retains original ASCII byte editing. UTF-8 scalar editing and Japanese labels are split-only features, not an original-rule equivalence claim.",
        ],
    }
    path = PROJECT / "tests" / "baseline-provenance.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    unchanged = sum(r["byte_identical"] and r["file"].endswith(".c") for r in records)
    print(f"Prepared {target}: 33 original C files, {unchanged} byte-identical C files, {len(shared)} shared infrastructure files")


if __name__ == "__main__":
    main()

"""Reject unrecorded rule edits in the original-source comparison overlay."""
import hashlib
import difflib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
manifest = json.loads((TESTS / "baseline-provenance.json").read_text(encoding="utf-8"))
original = Path(manifest["original_source"])
baseline = TESTS / "baseline-src"


def remove_block(source, marker):
    start = source.index(marker)
    end = source.index("#endif\n", start) + len("#endif\n")
    return source[:start] + source[end:]


def original_after_undo(name, undo):
    actual = undo((baseline / name).read_text(encoding="utf-8"))
    expected = (original / name).read_text(encoding="utf-8")
    if actual.rstrip() != expected.rstrip():
        print(''.join(difflib.unified_diff(expected.splitlines(True), actual.splitlines(True), fromfile='original/'+name, tofile='undo/'+name)))
    assert actual.rstrip() == expected.rstrip(), f"Unrecorded game-rule difference: {name}"
    return {"file": name, "rule_text_after_undo": "identical to acquisition"}


def undo_command(source):
    source = source.replace("/* Persistent command state; accessors permit exact outer-boundary restore. */\n"
                            "static char countch, direction, newcount = FALSE;\n\n", "", 1)
    source = source.replace("    THING *mp;\n", "    THING *mp;\n"
                            "    static char countch, direction, newcount = FALSE;\n", 1)
    source = source.replace("#ifdef ROGUE_LAYERED\n    rg_core_tick_complete();\n#endif\n", "", 1)
    source = remove_block(source, "#ifdef ROGUE_LAYERED\nvoid rg_command_state_get")
    return source.replace("}\n\n\n/*\n * illcom:", "}\n\n/*\n * illcom:", 1)


def undo_misc(source):
    source = source.replace("static coord last_delt = {0,0};\n\n", "", 1)
    source = source.replace("    bool gotit;\n", "    bool gotit;\n    static coord last_delt= {0,0};\n", 1)
    source = remove_block(source, "#ifdef ROGUE_LAYERED\nvoid rg_direction_state_get")
    return source.replace("}\n\n\n/*\n * sign:", "}\n\n/*\n * sign:", 1)


def undo_things(source):
    source = source.replace("static int maxlen = -1;\n", "", 1)
    source = remove_block(source, "#ifdef ROGUE_LAYERED\nvoid rg_menu_state_get")
    source = source.replace("static char *lastfmt, *lastarg;\n\n\n", "static char *lastfmt, *lastarg;\n\n", 1)
    return source.replace('    char *prompt = "--Press space to continue--";\n',
                          '    char *prompt = "--Press space to continue--";\n    static int maxlen = -1;\n', 1)


def undo_rip(source):
    source = source.replace('#ifdef ROGUE_LAYERED\n    rg_core_set_outcome(1, "dead");\n#endif\n', "", 1)
    source = source.replace('#ifdef ROGUE_LAYERED\n    rg_core_set_outcome(2, "winner");\n#endif\n', "", 1)
    return source.replace("#ifndef ROGUE_LAYERED\n    struct tm *localtime();\n#endif\n", "    struct tm *localtime();\n", 1)


def undo_daemon(source):
    source = remove_block(source, "#ifdef ROGUE_LAYERED\n/* Historical C")
    source = source.replace("\n\n\n/*\n * d_slot:", "\n\n/*\n * d_slot:", 1)
    source = source.replace("        {\n#ifdef ROGUE_LAYERED\n            invoke_action(dev->d_func,dev->d_arg);\n#else\n"
                            "\t    (*dev->d_func)(dev->d_arg);\n#endif\n        }",
                            "\t    (*dev->d_func)(dev->d_arg);", 1)
    return source.replace("#ifdef ROGUE_LAYERED\n            invoke_action(wire->d_func,wire->d_arg);\n#else\n"
                          "\t    (*wire->d_func)(wire->d_arg);\n#endif\n", "\t    (*wire->d_func)(wire->d_arg);\n", 1)


def undo_io(source):
    source = source.replace('#include <stdint.h>\n#include <stdlib.h>\n#include <stdio.h>\n', "", 1)
    source = source.replace('#include "io_state.h"\n#include "rogue_abi.h"\n', "", 1)
    source = source.replace('\trg_host_message("message.clear", "[]", "");\n', "", 1)
    source = source.replace('    rg_host_message("message.legacy", "[]", msgbuf);\n', "", 1)
    start = source.index("/* Private logical paging state")
    end = source.index("/*\n * step_ok:", start)
    source = source[:start] + source[end:]
    declarations = (
        "static int hpwidth = 0;\nstatic int s_hungry = 0;\n"
        "static int s_lvl = 0;\nstatic int s_pur = -1;\n"
        "static int s_hp = 0;\nstatic int s_arm = 0;\n"
        "static str_t s_str = 0;\nstatic int s_exp = 0;\n"
    )
    source = source.replace(declarations + "\n", "", 1)
    source = source.replace("    register int oy, ox, temp;\n", "    register int oy, ox, temp;\n"
                            + "".join("    " + line for line in declarations.splitlines(keepends=True)), 1)
    source = remove_block(source, "#ifdef ROGUE_LAYERED\nvoid rg_status_state_get")
    return source.replace("}\n\n\n/*\n * wait_for", "}\n\n/*\n * wait_for", 1)


audited = []
for record in manifest["original_files"]:
    before = (original / record["file"]).read_bytes()
    after = (baseline / record["file"]).read_bytes()
    assert hashlib.sha256(before).hexdigest() == record["original_sha256"], record["file"]
    assert hashlib.sha256(after).hexdigest() == record["baseline_sha256"], record["file"]
    if record["byte_identical"]:
        assert before == after, record["file"]
        audited.append({"file": record["file"], "byte_identical": True})

for name, undo in (("command.c", undo_command), ("misc.c", undo_misc),
                   ("things.c", undo_things), ("rip.c", undo_rip),
                   ("armor.c", lambda s: s.replace("#ifdef ROGUE_LAYERED\n    rg_core_tick_complete();\n#endif\n", "", 1)),
                   ("daemon.c", undo_daemon), ("io.c", undo_io)):
    audited.append(original_after_undo(name, undo))

for name, include in (("mdport.c", "platform_md.h"), ("mach_dep.c", "platform_system.h")):
    start = f'#if defined(ROGUE_LAYERED)\n#include "{include}"\n#else\n'
    audited.append(original_after_undo(name, lambda s, start=start: s.removeprefix(start).removesuffix("\n#endif /* ROGUE_LAYERED */\n")))

rn_line = "#define RN\t\t(((seed = seed*11109+13849) >> 16) & 0xffff)"
assert rn_line in (baseline / "extern.h").read_text()
assert "#define RN rg_random_next()" not in (baseline / "extern.h").read_text()
original_io = (original / "io.c").read_text()
baseline_io = (baseline / "io.c").read_text()
original_doadd = original_io[original_io.index("void\ndoadd("):original_io.index("/*\n * step_ok:")].strip()
baseline_doadd = baseline_io[baseline_io.index("void\ndoadd("):baseline_io.index("/* Private logical paging state")].strip()
assert original_doadd == baseline_doadd, "Original doadd/vsprintf/paging threshold changed"
for function in ("msg(char *fmt, ...)", "addmsg(char *fmt, ...)"):
    assert function in baseline_io, function
audited.extend([{"file": "extern.h", "original_RN": True}, {"file": "io.c", "original_doadd": True}])
report = {"schema": 1, "checks_passed": True, "files": audited,
          "not_independently_audited": ["shared startup/main portability", "shared serializer", "shared knowledge/curses", "host observation/hashes"]}
(TESTS / "baseline-source-audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(f"Baseline source audit passed: {len(audited)} original byte/function/rule checks")

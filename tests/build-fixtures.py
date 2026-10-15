"""Build and run C boundary tests without a shell or platform-specific SDK paths."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from build import SOURCES, c_flags, sdk_environment
from compiler_workspace import CompilerWorkspace


def file_record(p):
    return {'path': p.relative_to(ROOT).as_posix(), 'bytes': p.stat().st_size,
            'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}


def main(kind, argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk-root', default=os.environ.get('EMSDK'))
    parser.add_argument('--keep-artifacts', action='store_true')
    parser.add_argument('--diagnostics', action='store_true')
    args = parser.parse_args(argv)
    fixtures = ['save-adapter'] if kind == 'save' else ['message-capture', 'message-paging', 'semantic-capture', 'options-utf8']
    evidence = {'schema': 1, 'recorded_at_utc': datetime.now(timezone.utc).isoformat(), 'tests': {}}
    with CompilerWorkspace(ROOT, args.keep_artifacts) as scope:
        emcc, env = sdk_environment(args.sdk_root)
        output = scope.build
        for fixture in fixtures:
            names = SOURCES if kind == 'save' else ['message', 'semantic', 'extern', 'init', 'fight']
            if fixture == 'message-paging':
                names = names + ['io']
            elif fixture == 'semantic-capture':
                names = ['semantic', 'extern', 'init', 'fight']
            elif fixture == 'options-utf8':
                names = ['options']
            inputs = [ROOT / 'logic' / (name + '.c') for name in names]
            source = ROOT / 'tests' / (fixture + '.c')
            driver = ROOT / 'tests' / (fixture + '.test.mjs')
            tracked = [*inputs, source, Path(__file__), ROOT / 'tools/build.py', ROOT / 'tools/compiler_workspace.py', ROOT / 'contract/rogue_abi.h', *(ROOT / 'logic').glob('*.h')]
            if driver.exists():
                tracked.append(driver)
            before = [file_record(p) for p in sorted(set(tracked))]
            # These are C-only main/stdio adapters, not the playable Rust game.
            # Their Node runner remains a test-only .cjs; game/fixture Worker
            # modules built by tools/build.py are standalone .wasm files.
            binary = output / (fixture + '.cjs')
            flags = [*c_flags(), '-sENVIRONMENT=node', '-sEXIT_RUNTIME=1', '-sASSERTIONS=2', '-sSAFE_HEAP=1', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=4194304', '-o', binary]
            if kind == 'save':
                if args.diagnostics:
                    flags.append('-DRG_SAVE_DIAGNOSTICS')
                flags += ['-DRG_ALLOC_AUDIT', '-Wl,--wrap=malloc', '-Wl,--wrap=calloc', '-Wl,--wrap=realloc', '-Wl,--wrap=free']
            compile_result = subprocess.run([*emcc, *map(str, inputs), str(source), *map(str, flags)], cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8')
            if compile_result.returncode:
                print(compile_result.stdout + compile_result.stderr, file=sys.stderr)
                raise RuntimeError(f'{fixture} build failed ({compile_result.returncode})')
            run = subprocess.run([os.environ.get('ROGUE_NODE', 'node'), str(driver if driver.exists() else binary)], cwd=ROOT, env={**env, 'ROGUE_ARTIFACT_BUILD': str(output)}, capture_output=True, text=True, encoding='utf-8')
            log = output / (fixture + '-test.log')
            log.write_text(compile_result.stdout + compile_result.stderr + run.stdout + run.stderr, encoding='utf-8')
            print(run.stdout + run.stderr, end='', flush=True)
            if run.returncode:
                raise RuntimeError(f'{fixture} checks failed ({run.returncode})')
            for record in before:
                if file_record(ROOT / record['path'])['sha256'] != record['sha256']:
                    raise RuntimeError('Compilation input changed: ' + record['path'])
            result = json.loads(run.stdout.strip().splitlines()[-1])
            checks = result.get('checks')
            counted = type(checks) is int
            evidence['tests'][fixture.replace('-', '_')] = {'status': 'passed', 'exit_code': run.returncode,
                'checks': checks if counted else sum(v == 'pass' for v in result.values()),
                'check_unit': 'assertions' if counted else 'reported_categories', 'result': result,
                'files': before + [file_record(p) for p in (log, binary, binary.with_suffix('.wasm'))]}
            if kind == 'save':
                (output / 'save-adapter-result.txt').write_text(run.stdout + run.stderr, encoding='utf-8')
                (output / 'save-adapter-inputs.json').write_text(json.dumps([{'file': p['path'], 'sha256': p['sha256']} for p in before], indent=2), encoding='utf-8')
        if kind == 'messages':
            (output / 'c-supplementary-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
    return 0

"""Portable game/UI compiler, also used by every test fixture build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from compiler_workspace import CompilerWorkspace
from bind_browser import bind_browser, binding_environment

ROOT = Path(__file__).resolve().parent.parent
SOURCES = 'vers extern armor chase command daemon daemons fight init io list mach_dep main mdport misc monsters move new_level options pack passages potions rings rip rooms save scrolls state sticks things weapons wizard xcrypt core knowledge message save_adapter semantic'.split()


def run(args, **kwargs):
    print('RUN ' + ' '.join(map(str, args)), flush=True)
    return subprocess.run(list(map(str, args)), cwd=ROOT, check=True, **kwargs)


def sdk_environment(sdk_root=None):
    sdk = Path(sdk_root or os.environ.get('EMSDK', '')).resolve() if sdk_root or os.environ.get('EMSDK') else None
    env = os.environ.copy()
    python = env.get('EMSDK_PYTHON') or env.get('ROGUE_TEST_PYTHON') or sys.executable
    if sdk:
        emcc = sdk / 'upstream' / 'emscripten' / 'emcc.py'
        config = sdk / '.emscripten'
        if not emcc.is_file() or not config.is_file():
            raise ValueError('SDK must contain upstream/emscripten/emcc.py and .emscripten')
        env['EM_CONFIG'] = str(config)
        command = [python, str(emcc)]
        env['PATH'] = str(emcc.parent) + os.pathsep + str(Path(python).parent) + os.pathsep + env['PATH']
    else:
        executable = env.get('ROGUE_EMCC') or shutil.which('emcc')
        if not executable:
            raise ValueError('Activate Emscripten, set ROGUE_EMCC, or pass --sdk-root')
        if Path(executable).suffix in ('.bat', '.cmd', '.exe') and Path(executable).with_name('emcc.py').is_file():
            command = [python, str(Path(executable).with_name('emcc.py'))]
        else:
            command = [executable]
    env.update(EMSDK_PYTHON=python, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    return command, env


def generate_abi():
    header = (ROOT / 'contract/rogue_abi.h').read_text(encoding='utf-8')
    values = re.findall(r'^#define (RG_[A-Z0-9_]+) (0x[0-9a-fA-F]+|[0-9]+)\s*$', header, re.M)
    rust = ['// Generated from contract/rogue_abi.h. Do not edit.', '#![allow(dead_code)] // All constants are public parts of the cross-language ABI.']
    rust += [f'pub const {name}: u32 = {value};' for name, value in values]
    (ROOT / 'rust/crates/contract/src/abi.rs').write_text('\n'.join(rust) + '\n', encoding='utf-8', newline='\n')
    constants = {name: int(value, 0) if value.startswith('0x') else int(value) for name, value in values}
    (ROOT / 'web/abi.js').write_text('/* Generated from contract/rogue_abi.h. */\nglobalThis.RG_ABI = Object.freeze(' + json.dumps(constants, separators=(',', ':')) + ');\n', encoding='utf-8', newline='\n')


def c_flags(logic=None):
    return ['-DROGUE_LAYERED', '-I' + str(logic or ROOT / 'logic'), '-I' + str(ROOT / 'contract'), '-std=gnu11', '-fwrapv', '-fno-strict-aliasing', '-Wno-deprecated-non-prototype', '-O1']


def build(options):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', options.output_name):
        raise ValueError('Invalid output name')
    hooks = options.test_fixtures or options.test_hooks
    if options.output_name == 'game' and (hooks or options.logic_directory):
        raise ValueError('game is reserved for the playable build; choose a fixture/comparison output name')
    with CompilerWorkspace(ROOT, options.keep_artifacts) as scope:
        emcc, env = sdk_environment(options.sdk_root)
        env = binding_environment(env)
        logic = Path(options.logic_directory).resolve() if options.logic_directory else ROOT / 'logic'
        build_dir = scope.directory / 'build'
        build_dir.mkdir(exist_ok=True)
        generate_abi()
        if not options.skip_catalog_generation:
            run([sys.executable, ROOT / 'tools/generate_catalog.py'])
        elif not options.logic_directory:
            run([sys.executable, ROOT / 'tools/generate_catalog.py', '--check'])
        target = Path(env['CARGO_TARGET_DIR'])
        library = target / 'wasm32-unknown-emscripten/release/librogue_layers.a'
        if not options.skip_rust or hooks or not library.is_file():
            args = ['cargo', 'build', '--offline', '--locked', '--manifest-path', ROOT / 'rust/Cargo.toml', '--release', '--lib', '--target', 'wasm32-unknown-emscripten', '--no-default-features']
            if hooks:
                args += ['--features', 'test-hooks']
            run(args, env=env)
            run(['cargo', 'build', '--offline', '--locked', '--manifest-path', ROOT / 'rust/Cargo.toml', '--release', '-p', 'rogue-browser-display', '--target', 'wasm32-unknown-unknown'], env=env)
            bind_browser(target / 'wasm32-unknown-unknown/release/rogue_browser_display.wasm', build_dir)
        elif not (build_dir / 'browser-ui.wasm').is_file():
            shutil.copyfile(ROOT / 'build/browser-ui.wasm', build_dir / 'browser-ui.wasm')
            shutil.copyfile(ROOT / 'build/browser-ui.js', build_dir / 'browser-ui.js')
        inputs = [logic / (source + '.c') for source in SOURCES]
        args = [*inputs, library, *c_flags(logic)]
        if options.test_fixtures:
            run([sys.executable, ROOT / 'tools/generate-wording-tests.py'])
            args += ['-DRG_TEST_FIXTURES', ROOT / 'tests/game-fixtures.c']
        exports = ['_rg_run', '_rg_snapshot_json', '_rg_string_free', '_rg_validate_envelope', '_malloc', '_free']
        if hooks:
            args += ['-DRG_TEST_HOOKS']
            exports += ['_rg_test_repaint', '_rg_test_save_roundtrip']
        args += ['-sEXPORTED_FUNCTIONS=' + json.dumps(exports, separators=(',', ':')), '--no-entry', '-sWASM_BINDGEN=1', '-sMODULARIZE=1', '-sEXPORT_NAME=createRogueModule', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=4194304', '-sASSERTIONS=1', '-sEXPORTED_RUNTIME_METHODS=["ccall","FS","UTF8ToString","HEAPU8"]', '-o', build_dir / (options.output_name + '.js')]
        run([*emcc, *args], env=env)
        generated_js = build_dir / (options.output_name + '.js')
        generated_code = re.sub(r'(?m)^[ \t]+$', '', generated_js.read_text(encoding='utf-8'))
        generated_js.write_text(generated_code, encoding='utf-8', newline='\n')
        outputs = [options.output_name + '.js', options.output_name + '.wasm', 'browser-ui.wasm', 'browser-ui.js']
        records = [{'file': name, 'bytes': (build_dir / name).stat().st_size, 'sha256': hashlib.sha256((build_dir / name).read_bytes()).hexdigest()} for name in outputs]
        manifest_name = 'build-manifest.json' if options.output_name == 'game' else 'build-manifest-' + options.output_name + '.json'
        manifest = {'built_at_utc': datetime.now(timezone.utc).isoformat(), 'logic_source_directory': str(logic), 'c_source_files': len(SOURCES), 'rust_library': str(library), 'rust_engine': 'Bevy 0.19.1', 'sdk_root': options.sdk_root or env.get('EMSDK'), 'rust_version': subprocess.check_output(['rustc', '--version'], text=True).strip(), 'test_hooks': bool(hooks), 'test_fixtures': bool(options.test_fixtures), 'c_flags': ['-DROGUE_LAYERED', '-std=gnu11', '-fwrapv', '-fno-strict-aliasing', '-O1'], 'wasm_flags': ['WASM_BINDGEN', 'MODULARIZE', 'ALLOW_MEMORY_GROWTH', 'STACK_SIZE=4194304', 'ASSERTIONS=1', 'Worker+SAB input; no Asyncify'], 'outputs': records}
        (build_dir / manifest_name).write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
        if options.output_name == 'game' or scope.keep:
            (ROOT / 'build').mkdir(exist_ok=True)
            for name in [*outputs, manifest_name]:
                if build_dir / name != ROOT / 'build' / name:
                    shutil.copyfile(build_dir / name, ROOT / 'build' / name)
        print('Built ' + options.output_name, flush=True)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--sdk-root', default=os.environ.get('EMSDK'))
    result.add_argument('--output-name', default='game')
    result.add_argument('--logic-directory')
    for name in ('skip-rust', 'skip-catalog-generation', 'test-fixtures', 'test-hooks', 'keep-artifacts'):
        result.add_argument('--' + name, action='store_true')
    return result


if __name__ == '__main__':
    build(parser().parse_args())

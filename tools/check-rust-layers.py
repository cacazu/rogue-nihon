import argparse
import os
from pathlib import Path
from build import ROOT, run, sdk_environment
from compiler_workspace import CompilerWorkspace
from rust_linker import rust_environment

parser = argparse.ArgumentParser(description='Build and run the real standalone Rust/Wasm checks')
parser.add_argument('--sdk-root', default=os.environ.get('EMSDK'))
parser.add_argument('--binary', choices=['layer-check', 'entity-check', 'engine-check'], default='layer-check')
parser.add_argument('--keep-artifacts', action='store_true')
args = parser.parse_args()
with CompilerWorkspace(ROOT, args.keep_artifacts):
    _, env = sdk_environment(args.sdk_root)
    env = rust_environment(env)
    run(['cargo', 'rustc', '--offline', '--locked', '--manifest-path', ROOT / 'rust/Cargo.toml', '--bin', args.binary,
         '--release', '--target', 'wasm32-unknown-emscripten', '--features', 'test-hooks', '--', '-C', 'panic=abort',
         '-C', 'link-arg=-sENVIRONMENT=node', '-C', 'link-arg=-sEXIT_RUNTIME=1', '-C', 'link-arg=-sALLOW_MEMORY_GROWTH=1'], env=env)
    run([os.environ.get('ROGUE_NODE', 'node'), Path(env['CARGO_TARGET_DIR']) / 'wasm32-unknown-emscripten/release' / (args.binary + '.js')], env=env)

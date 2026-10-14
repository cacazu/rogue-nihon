"""Build the isolated Rust browser test ABI without changing playable artifacts."""
import argparse
from pathlib import Path
from compiler_workspace import CompilerWorkspace
from build import ROOT, run
from bind_browser import bind_browser

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-artifacts', action='store_true')
    options = parser.parse_args()
    with CompilerWorkspace(ROOT, options.keep_artifacts) as scope:
        import os
        target = Path(os.environ.get('CARGO_TARGET_DIR', scope.directory / 'cargo-target'))
        environment = os.environ.copy()
        environment['CARGO_TARGET_DIR'] = str(target)
        run(['cargo', 'build', '--offline', '--locked', '--manifest-path', ROOT / 'rust/Cargo.toml', '--release', '-p', 'rogue-browser-display', '--features', 'browser-test', '--target', 'wasm32-unknown-unknown'], env=environment)
        output = ROOT / 'build' if options.keep_artifacts else scope.directory / 'build'
        bind_browser(target / 'wasm32-unknown-unknown/release/rogue_browser_display.wasm', output, 'browser-test')

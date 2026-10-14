"""Select the active SDK linker rather than Rust's platform launcher default."""
import os
import shutil


def rust_environment(environment):
    result = environment.copy()
    linker = result.get('ROGUE_EMCC_LINKER') or shutil.which('emcc', path=result.get('PATH'))
    if not linker or not os.path.isfile(linker):
        raise ValueError('An executable Emscripten linker is required; activate the SDK or set ROGUE_EMCC_LINKER')
    result['CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER'] = linker
    return result

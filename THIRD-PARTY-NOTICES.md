# Third-party notices

The original Rogue copyright notices and three BSD-style license blocks remain verbatim in [logic/LICENSE.TXT](logic/LICENSE.TXT) and the original source headers. Upstream build helpers retain their GPL/Autoconf exception and X Consortium notices. This project is a derivative of RRP Rogue 5.4.4; it is not endorsed by the original authors.

[licenses/THIRD-PARTY.txt](licenses/THIRD-PARTY.txt) contains the full notices for the shipped Web targets. [licenses/manifest.json](licenses/manifest.json) records each component's version, declared and selected license, targets, source and notice references. Identical notice bytes are shared without dropping component attribution.

The inventory covers the `normal,build` dependencies of `rogue-layers` for `wasm32-unknown-emscripten` and `rogue-browser-display` for `wasm32-unknown-unknown`. Build dependencies are retained to cover code generation; this does not assert that all of them are linked at runtime. Unused Cargo.lock packages and dependencies for other targets are excluded. Where an MIT alternative is available it is selected; additional copyrights, Unicode licenses, third-party notices and mandatory combined terms remain.

Rust standard-library notices come from the matching `rust-src` dependency graph for those targets, including the installed libraries' backtrace/unwind support. Compiler-builtins notices retain their MIT and Apache/LLVM terms. Rust compiler and test-tool notices are excluded. Emscripten-generated JavaScript, musl and compiler-rt notices remain for the game runtime.

The HUD's stairs icon is adapted from [Lucide Lab's stairs.svg](https://github.com/lucide-icons/lucide-lab/blob/main/icons/stairs.svg) as a Rust vector path. Its ISC license and copyright notice are included in the consolidated notices. No third-party web font or external JavaScript package is used by the browser UI.

The [license guide](docs/LICENSES-ja.md) links to the downloadable bundle.

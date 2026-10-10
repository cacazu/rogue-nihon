# Third-party notices

The original Rogue notices and three BSD-style license blocks are retained verbatim in `logic/LICENSE.TXT` and the original source headers. The upstream build helpers retain their own GPL/Autoconf exception and X Consortium notices. This project is a derivative of RRP Rogue 5.4.4; it is not endorsed by the original authors.

The exact dependency versions and registry checksums are locked in `rust/Cargo.lock`. Copied license texts and their local source paths are recorded in `licenses/manifest.json`:

| Package | Version | Declared license |
|---|---|---|
| Bevy and bevy_* runtime / ECS / macro crates | 0.19.1 | MIT OR Apache-2.0 |
| serde / serde_core / serde_derive | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| memchr | 2.8.3 | Unlicense OR MIT |
| zmij | 1.0.23 | MIT |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| syn | 3.0.6 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.26 | (MIT OR Apache-2.0) AND Unicode-3.0 |

The table highlights direct dependencies and the existing serialization dependencies. The complete locked graph, including Bevy transitive and target-specific dependencies, is recorded in `licenses/manifest.json`; not every locked package is embedded in the final Wasm. Source license texts and copyright notices are preserved in the corresponding `licenses/<package-version>/` folders. For crates whose published archive omits workspace license files, `source_urls` records the upstream files at the exact commit from `.cargo_vcs_info.json`. The r-efi copyright and license text is in its AUTHORS file. Proc-macro dependencies run at build time.

The Emscripten license, musl copyright notice, compiler-rt license, and the installed Rust copyright document are copied in `licenses/emscripten/` and `licenses/rust/`. This is a local implementation deliverable, not a public release. A later public release should re-audit the exact bundled toolchain runtime and notices for its chosen distribution.

No third-party web font, external JavaScript package, or image is used by the browser UI. The upstream `rogue.png` remains among the source acquisition files but is not used as a browser asset.

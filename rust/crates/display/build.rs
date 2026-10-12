use std::{env, fs, path::PathBuf};

fn main() {
    // Gauge boundaries come from the same table used by C's check_level().
    let source =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../../logic/extern.c");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(source).expect("original experience table");
    let table = text
        .split_once("int e_levels[] = {")
        .expect("e_levels")
        .1
        .split_once('}')
        .expect("table end")
        .0;
    let levels: Vec<i64> = table
        .split(',')
        .map(|value| {
            value
                .trim()
                .trim_end_matches('L')
                .parse()
                .expect("experience threshold")
        })
        .take_while(|&value| value != 0)
        .collect();
    assert!(!levels.is_empty() && levels[0] > 0 && levels.windows(2).all(|w| w[0] < w[1]));
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("experience_levels.rs");
    fs::write(
        output,
        format!("const EXPERIENCE_LEVELS: &[i64] = &{levels:?};\n"),
    )
    .expect("experience display table");
}

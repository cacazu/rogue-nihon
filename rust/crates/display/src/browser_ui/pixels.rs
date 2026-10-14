//! Nearest sampling on the native 32px grid, before any Canvas enlargement.
pub fn rotate(input: &[u8], degrees: f64) -> Result<Vec<u8>, &'static str> {
    if input.len() != 32 * 32 * 4 || !degrees.is_finite() {
        return Err("Invalid native pixel image");
    }
    let mut output = vec![0u8; 32 * 32 * 4];
    let cos = degrees.to_radians().cos();
    let sin = degrees.to_radians().sin();
    for y in 0..32 {
        for x in 0..32 {
            let dx = x as f64 + 0.5 - 16.;
            let dy = y as f64 + 0.5 - 16.;
            let sx = (dx * cos + dy * sin + 16.).floor() as i32;
            let sy = (-dx * sin + dy * cos + 16.).floor() as i32;
            if (0..32).contains(&sx) && (0..32).contains(&sy) {
                let from = (sy * 32 + sx) as usize * 4;
                let to = (y * 32 + x) * 4;
                output[to..to + 4].copy_from_slice(&input[from..from + 4]);
            }
        }
    }
    Ok(output)
}

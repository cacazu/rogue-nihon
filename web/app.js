// Only Wasm startup. Browser resources and application behavior are implemented in Rust.
import init, {browser_start} from "/build/browser-ui.js";
await init();
await browser_start();

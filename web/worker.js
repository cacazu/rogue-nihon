// Wasm startup in a fresh Worker. Rust owns its resources and game calls.
import("/build/browser-ui.js").then(async module => {
  await module.default();
  module.worker_boot();
}).catch(error => postMessage({type:"error",text:String(error)}));

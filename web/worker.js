// A classic Worker is required by the original C game's generated Emscripten loader.
import("/build/browser-ui.js").then(async module => {
  await module.default();
  module.worker_boot();
}).catch(error => postMessage({type:"error",text:String(error)}));

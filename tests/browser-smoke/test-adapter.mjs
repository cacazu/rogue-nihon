import {installTileTestAdapter} from "../tile-test-adapter.mjs";

// Installed by Playwright/CDP before navigation; never loaded by the game.
function browserTestAdapter(installTileTestAdapter) {
  let ui, queue;
  for (const name of ["RogueCanvasUi", "RogueEventQueue", "RogueTiles"]) {
    let value;
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => value,
      set(original) {
        if (name === "RogueCanvasUi") {
          const create = original.create;
          original.create = async function(...arguments_) {
            ui = await create.apply(this, arguments_);
            return ui;
          };
          value = original;
        } else if (name === "RogueEventQueue") {
          value = class extends original {
            constructor(...arguments_) { super(...arguments_); queue = this; }
          };
        } else {
          installTileTestAdapter(original, request => ui.request(request));
          value = original;
        }
      }
    });
  }
  const enqueueMany = events => ui.dispatch({type: "enqueue", events}).accepted;
  const descriptors = {
    canvas: {get: () => ui?.scene},
    enqueue: {value: key => enqueueMany([key])}, enqueueMany: {value: enqueueMany},
    rawKey: {value: (key, flags = {}) => ui.request({type: "event", event: {type: "raw-key", key, ...flags}}).raw},
    redraw: {value: () => ui.invalidate()}, centerMap: {value: () => ui.dispatch({type: "center"})},
    graphics: {get: () => ui && ({...ui.state.graphics, camera: ui.scene.camera,
      images: ui.host.tileSets.get(ui.state.graphics?.set)?.images.size || 0, drawCount: ui.drawCount})},
    queuePending: {get: () => queue?.pending || 0}, diagnostics: {get: () => ui?.state}
  };
  for (const key of ["language", "generation", "running", "topOpen", "frame", "frameCount",
    "inputRequestCount", "trace", "traces", "messages", "savedLength", "savePending",
    "translationFallbacks", "uiMissing"]) descriptors[key] = {get: () => ui?.state[key]};
  globalThis.__rogueBrowserTest = Object.freeze(Object.defineProperties({}, descriptors));
}

export const browserTestAdapterSource = () => "(" + browserTestAdapter.toString() + ")(" + installTileTestAdapter.toString() + ");";
export const installBrowserTestAdapter = target => target.addInitScript({content: browserTestAdapterSource()});

"use strict";
importScripts("/web/abi.js", "/web/event-queue.js");
let queue = null;
let started = false;
globalThis.RogueHost = {
  readEvent() {
    self.postMessage({ type: "input-request" });
    return queue.take();
  },
  flushInput() {
    let saveCancelled = false;
    const count = queue.discardPending((raw) => { if ((raw & RG_ABI.RG_EVENT_SCALAR_MASK) === RG_ABI.RG_KEY_SAVE) saveCancelled = true; });
    if (count) self.postMessage({ type: "input-flush", count, saveCancelled });
  },
  present(json) {
    const payload = JSON.parse(json);
    if (!["frame", "message", "trace", "input-context", "presentation"].includes(payload.type)) throw new Error("Unknown Rust presentation payload");
    self.postMessage(payload);
  },
  store(bytes) { self.postMessage({ type: "save", bytes }, [bytes.buffer]); },
  outcome(code, text) { self.postMessage({ type: "outcome", code, text }); }
};
self.onmessage = async (event) => {
  if (event.data.type !== "start" || started) return;
  started = true;
  try {
    queue = new RogueEventQueue(event.data.queue, event.data.capacity);
    importScripts("/build/game.js");
    const module = await createRogueModule({
      locateFile: (name) => "/build/" + name,
      noInitialRun: true,
      print: (text) => self.postMessage({ type: "log", text }),
      printErr: (text) => self.postMessage({ type: "log", text }),
      onAbort: (text) => self.postMessage({ type: "error", text: String(text) })
    });
    if (event.data.restore) module.FS.writeFile("/restore.json", new Uint8Array(event.data.restore));
    module.FS.writeFile("/message-paging.txt", "log");
    module.FS.writeFile("/locale.txt", event.data.locale === "en" ? "en" : "ja");
    if (event.data.trace) module.FS.writeFile("/trace.enabled", "1");
    self.postMessage({ type: "ready" });
    const result = module.ccall("rg_run", "number", ["number", "string"], [event.data.seed >>> 0, event.data.name]);
    self.postMessage({ type: "exit", code: result });
  } catch (error) {
    self.postMessage({ type: "error", text: error.stack || String(error) });
  }
};

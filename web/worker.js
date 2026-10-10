"use strict";
importScripts("/web/event-queue.js");
let queue = null;
globalThis.RogueHost = {
  readEvent() {
    self.postMessage({ type: "input-request" });
    return queue.take();
  },
  flushInput() {
    const events = [];
    const count = queue.discardPending(raw => events.push(raw >>> 0));
    if (count) self.postMessage({ type: "input-flush", count, events });
  },
  present(json) {
    const payload = JSON.parse(json);
    self.postMessage(payload);
  },
  store(bytes) { self.postMessage({ type: "save", bytes }, [bytes.buffer]); },
  outcome(code, text) { self.postMessage({ type: "outcome", code, text }); }
};
self.onmessage = async (event) => {
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
    for (const [path, contents] of event.data.files) module.FS.writeFile(path, contents);
    module.FS.writeFile("/locale.txt", event.data.locale);
    self.postMessage({ type: "ready" });
    const result = module.ccall("rg_run", "number", ["number", "string"], [event.data.seed, event.data.name]);
    self.postMessage({ type: "exit", code: result });
  } catch (error) {
    self.postMessage({ type: "error", text: error.stack || String(error) });
  }
};

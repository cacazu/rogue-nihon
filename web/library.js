/* Emscripten JS imports. These copy borrowed Wasm data before posting it. */
mergeInto(LibraryManager.library, {
  js_rg_read_event: function () { return globalThis.RogueHost.readEvent(); },
  js_rg_flush_input: function () { globalThis.RogueHost.flushInput(); },
  js_rg_present__deps: ["$UTF8ToString"],
  js_rg_present: function (pointer, length) { globalThis.RogueHost.present(UTF8ToString(pointer, length)); },
  js_rg_store: function (pointer, length) { globalThis.RogueHost.store(HEAPU8.slice(pointer, pointer + length)); },
  js_rg_outcome__deps: ["$UTF8ToString"],
  js_rg_outcome: function (code, pointer, length) { globalThis.RogueHost.outcome(code, UTF8ToString(pointer, length)); }
});

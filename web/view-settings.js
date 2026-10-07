(function(root) {
  "use strict";
  const key = "rogue-map-display-v1", modes = Object.freeze(["ascii", "tiles", "pixels"]);
  const sizes = mode => mode === "pixels" ? [32, 64, 96, 128] : [16, 24, 32, 48, 64];
  function valid(value) {
    if (!value || value.version !== 1 || !modes.includes(value.mode) || !Number.isInteger(value.zoom) || !sizes(value.mode).includes(value.zoom)) return null;
    return { version: 1, mode: value.mode, zoom: value.zoom };
  }
  function load(storage) {
    try { return valid(JSON.parse((storage ?? root.localStorage).getItem(key))) || { version: 1, mode: "tiles", zoom: 32 }; }
    catch { return { version: 1, mode: "tiles", zoom: 32 }; }
  }
  function save(value, storage) {
    const preference = valid(value); if (!preference) return false;
    try { (storage ?? root.localStorage).setItem(key, JSON.stringify(preference)); return true; }
    catch { return false; }
  }
  const api = Object.freeze({ key, modes, sizes, valid, load, save });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RogueViewSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

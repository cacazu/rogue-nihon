"use strict";
(async () => {
  const abi = globalThis.RG_ABI;
  if (!abi) throw new Error("Generated ABI constants were not loaded");
  const catalogs = Object.fromEntries(await Promise.all(["ja", "en"].map(async (locale) => {
    const response = await fetch("/locales/ui-web-" + locale + ".json");
    if (!response.ok) throw new Error("UI catalog fetch failed: " + locale);
    return [locale, await response.json()];
  })));
  const parameters = new URLSearchParams(location.search);
  let language = parameters.get("lang") === "en" ? "en" : "ja";
  const ui = new RogueUiCatalog(catalogs, language), t = (id, args) => ui.text(id, args);
  const $ = (id) => document.getElementById(id);
  const board = $("board"), context = board.getContext("2d", { alpha: false });
  const keyCodes = Object.freeze({ ArrowUp: abi.RG_KEY_UP, ArrowDown: abi.RG_KEY_DOWN, ArrowLeft: abi.RG_KEY_LEFT, ArrowRight: abi.RG_KEY_RIGHT, Home: abi.RG_KEY_HOME, End: abi.RG_KEY_END, PageUp: abi.RG_KEY_PAGE_UP, PageDown: abi.RG_KEY_PAGE_DOWN, Escape: 27, Enter: 13, Backspace: 8, Tab: 9, Delete: 127 });
  let worker = null, queue = null, frame = null, composing = false, running = false;
  let savedBytes = null, databasePromise = null, savePending = false, restorePending = false;
  let frameCount = 0, inputRequestCount = 0, generation = 0, lastTrace = null, traces = [], messages = [];
  let lastOutcome = null, exitCode = null, runtimeError = null, logs = [], translationFallbacks = [], textMode = false, textDraftDirty = false, inputContext = null;
  const cellWidth = 12, cellHeight = 19, fontSize = 16;
  const scroll = document.querySelector(".board-scroll"), mapSpace = $("map-space");
  const gamePanel = document.querySelector(".game-panel"), hud = document.querySelector(".hud-overlay"), settingsPanel = $("settings-panel");
  let settingsOpen = false;
  const preference = RogueViewSettings.load();
  let displayMode = RogueViewSettings.modes.includes(parameters.get("view")) ? parameters.get("view") : preference.mode;
  let tileSize = RogueViewSettings.sizes(displayMode).includes(preference.zoom) ? preference.zoom : 32, camera = null, centeredPlayer = "";
  let tiles = null, tileSets = null;
  let noticeState = { id: "notice.start", args: {}, error: false };

  function notice(id, args = {}, error = false) {
    noticeState = { id, args, error }; $("notice").textContent = t(id, args); $("notice").classList.toggle("error", error);
  }
  function setRunning(value) {
    running = value; $("save").disabled = !value || savePending;
    $("language").disabled = value;
  }
  function setSettingsOpen(open) {
    settingsOpen = open; settingsPanel.hidden = !open; $("settings-scrim").hidden = !open;
    $("settings-toggle").setAttribute("aria-expanded", String(open));
    gamePanel.classList.toggle("settings-open", open); scroll.inert = open; hud.inert = open;
    if (open) $("settings-close").focus();
    else if (textMode) $("prompt-text").focus();
    else if (frame) board.focus();
    else $("settings-toggle").focus();
  }
  function enqueue(rawEvent) {
    if (!running || !queue) return false;
    if (!queue.push(rawEvent)) { notice("error.queue_full", {}, true); return false; }
    return true;
  }
  function enqueueMany(events) {
    if (!running || !queue) return false;
    if (!queue.pushMany(events)) { notice("error.queue_full", {}, true); return false; }
    return true;
  }
  function rawKey(key, flags = {}) {
    const code = keyCodes[key] ?? (Array.from(key).length === 1 ? key.codePointAt(0) : undefined);
    if (code === undefined) return null;
    return ((code & abi.RG_EVENT_SCALAR_MASK) | (flags.ctrlKey ? abi.RG_EVENT_CTRL : 0) | (flags.shiftKey ? abi.RG_EVENT_SHIFT : 0) | (flags.altKey ? abi.RG_EVENT_ALT : 0) | (flags.repeat ? abi.RG_EVENT_REPEAT : 0)) | 0;
  }
  function fallbackRecord(value, location) {
    if (value?.fallback_used || value?.missing_translation || value?.missing_ids?.length) {
      translationFallbacks.push({ location, id: value.id, missing_ids: value.missing_ids || [] });
      return language === "ja";
    }
    return false;
  }
  function translatedText(value, location) {
    if (!value || typeof value.text !== "string") return "";
    return fallbackRecord(value, location) ? t("error.translation") : value.text;
  }
  function renderPresentation() {
    const presentation = frame?.ui;
    const menuOnly = Boolean(presentation && presentation.mode !== "game");
    document.querySelector(".board-scroll").hidden = Boolean(menuOnly);
    $("accessible-screen").hidden = Boolean(menuOnly);
    $("presentation").hidden = !presentation || !(menuOnly || presentation.lines?.length || presentation.more || ["text", "space", "enter"].includes(presentation.input?.kind));
    $("player-status").hidden = !presentation?.status;
    if (!presentation) { $("presentation-lines").replaceChildren(); return; }
    fallbackRecord(presentation, "ui");
    if (Object.hasOwn(presentation, "message")) $("game-message").textContent = translatedText(presentation.message, "ui-message");
    $("player-name").textContent = presentation.name || "";
    $("status-text").textContent = translatedText(presentation.status, "status");
    const modeId = "panel." + presentation.mode;
    $("presentation-title").textContent = t(Object.hasOwn(catalogs[language].messages, modeId) ? modeId : "panel.game");
    $("presentation-hint").hidden = presentation.mode !== "menu";
    const fragment = document.createDocumentFragment();
    for (const line of presentation.lines || []) {
      const selectable = line.selectable === true && typeof line.key === "string" && Array.from(line.key).length === 1;
      const element = document.createElement(selectable ? "button" : "div");
      element.className = "presentation-line"; element.dataset.messageId = line.id || ""; element.dataset.scope = line.scope ?? ""; element.dataset.row = line.row ?? "";
      element.textContent = translatedText(line, "line");
      if (selectable) { element.type = "button"; element.dataset.selectionKey = line.key; element.onclick = () => { enqueue(rawKey(line.key)); board.focus(); }; }
      fragment.appendChild(element);
    }
    $("presentation-lines").replaceChildren(fragment);
    $("more-prompt").hidden = !presentation.more; $("more-prompt").replaceChildren();
    if (presentation.more) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = translatedText(presentation.more, "more");
      button.onclick = () => { const event = rawKey(presentation.more.key || " "); if (event !== null) enqueue(event); board.focus(); };
      $("more-prompt").appendChild(button);
    }
    applyInputContext(inputContext || presentation.input);
  }
  function applyInputContext(input) {
    const nextTextMode = input?.kind === "text";
    $("text-prompt").hidden = !nextTextMode;
    $("prompt-text").placeholder = input?.placeholder || "";
    if (nextTextMode && !textMode) textDraftDirty = false;
    if (nextTextMode && !textDraftDirty) $("prompt-text").value = input.current_text ?? input.initial ?? "";
    if (nextTextMode && !textMode && !settingsOpen) $("prompt-text").focus();
    textMode = nextTextMode;
    if (nextTextMode) $("presentation").hidden = false;
    if (["space", "enter"].includes(input?.kind) && !frame?.ui?.more) {
      $("presentation").hidden = false; $("more-prompt").hidden = false; $("more-prompt").replaceChildren();
      const button = document.createElement("button"); button.type = "button"; button.textContent = t("action.continue");
      button.onclick = () => { enqueue(input.kind === "enter" ? 13 : 32); board.focus(); };
      $("more-prompt").appendChild(button);
    }
  }
  function redraw() {
    if (!frame) return;
    const cells = frame.map_cells || " ".repeat(frame.width * frame.height);
    const descriptions = [];
    for (let y = 1; y < frame.height - 1; y++) {
      const visible = [];
      for (let x = 0; x < frame.width; x++) {
        const entry = tiles.entries[frame.map_tiles[y * frame.width + x]];
        if (entry?.id !== "terrain.unexplored") visible.push(`${x + 1}: ${entry?.labels?.[language] || entry?.meaning}`);
      }
      if (visible.length) descriptions.push(`${y}: ${visible.join(" / ")}`);
    }
    $("accessible-screen").textContent = descriptions.join("\n");
    scroll.dataset.display = displayMode;
    $("tile-zoom").disabled = displayMode === "ascii";
    if (displayMode !== "ascii") {
      const totalWidth = frame.width * tileSize, totalHeight = (frame.height - 2) * tileSize;
      const width = scroll.clientWidth || 960, height = scroll.clientHeight || 480;
      // Neutral space lets edge cells be centered clear of the HUD. The same
      // camera remains the source for both drawing and map hit-testing.
      mapSpace.style.width = Math.max(totalWidth, width) + "px"; mapSpace.style.height = totalHeight + height + "px"; mapSpace.style.paddingTop = "";
      const ratio = displayMode === "pixels" ? Math.max(1, Math.min(2, Math.floor(window.devicePixelRatio || 1))) : Math.min(window.devicePixelRatio || 1, 2);
      camera = { size: tileSize, ratio, left: scroll.scrollLeft, top: scroll.scrollTop - height / 2, width, height };
      board.style.width = width + "px"; board.style.height = height + "px";
      board.width = Math.round(width * ratio); board.height = Math.round(height * ratio);
      context.setTransform(1, 0, 0, 1, 0, 0); context.fillStyle = "#080d0f"; context.fillRect(0, 0, board.width, board.height);
      tiles.draw(context, frame, camera);
      return;
    }
    camera = null; mapSpace.style.width = "";
    const width = frame.width, height = frame.height, ratio = window.devicePixelRatio || 1;
    mapSpace.style.height = height * cellHeight + scroll.clientHeight + "px"; mapSpace.style.paddingTop = scroll.clientHeight / 2 + "px";
    board.width = Math.round(width * cellWidth * ratio); board.height = Math.round(height * cellHeight * ratio);
    board.style.width = width * cellWidth + "px"; board.style.height = height * cellHeight + "px";
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = "#080d0f"; context.fillRect(0, 0, width * cellWidth, height * cellHeight);
    context.font = fontSize + "px Consolas, \"Courier New\", monospace"; context.textBaseline = "top";
    const lines = [];
    for (let y = 0; y < height; y++) {
      const line = cells.slice(y * width, (y + 1) * width); lines.push(line);
      for (let x = 0; x < width; x++) {
        const glyph = line[x]; if (!glyph || glyph === " ") continue;
        context.fillStyle = glyph === "@" ? "#9ef0c3" : "/!?=:)]*,".includes(glyph) ? "#ebcf91" : "#c5d0d3";
        context.fillText(glyph, x * cellWidth, y * cellHeight + 1);
      }
    }
  }
  function centerMap() {
    if (!frame?.player) return;
    const width = displayMode === "ascii" ? cellWidth : tileSize, height = displayMode === "ascii" ? cellHeight : tileSize;
    scroll.scrollLeft = frame.player.x * width + width / 2 - scroll.clientWidth / 2;
    scroll.scrollTop = (frame.player.y - (displayMode === "ascii" ? 0 : 1)) * height + height / 2;
    redraw();
  }
  function receiveFrame(payload) {
    const valid = Number.isInteger(payload.width) && Number.isInteger(payload.height) && payload.width > 0 && payload.width <= 256 && payload.height > 0 && payload.height <= 128 && typeof payload.cells === "string" && payload.cells.length === payload.width * payload.height;
    if (!valid) throw new Error("Invalid Rust frame");
    if (language === "ja" && (typeof payload.map_cells !== "string" || payload.map_cells.length !== payload.cells.length || !payload.ui)) throw new Error("Missing translated presentation");
    tiles.validate(payload);
    fallbackRecord(payload, "frame"); frame = Object.freeze(payload); frameCount++; renderPresentation(); redraw();
    const position = frame.player.x + ":" + frame.player.y;
    if (position !== centeredPlayer && frame.ui?.mode === "game") { centeredPlayer = position; centerMap(); }
  }
  function database() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("original-rogue-web", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("saves");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Save database blocked"));
    });
    return databasePromise;
  }
  async function readSave() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("saves", "readonly"), request = transaction.objectStore("saves").get("manual");
      transaction.oncomplete = () => resolve(request.result ? new Uint8Array(request.result) : null);
      transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error("Save read aborted"));
    });
  }
  async function persistSave(bytes) {
    const db = await database();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("saves", "readwrite"); transaction.objectStore("saves").put(bytes, "manual");
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error("Save write aborted"));
    });
    savedBytes = bytes; $("load").disabled = false; $("download-save").disabled = false;
  }
  async function start(restore = null) {
    if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") { notice("error.isolation", {}, true); return; }
    const enteredSeed = Number($("seed").value), validSeed = Number.isInteger(enteredSeed) && enteredSeed >= 0 && enteredSeed <= 0xffffffff;
    if (!restore && !validSeed) { notice("error.seed", {}, true); return; }
    const enteredName = $("name").value || "Player", validName = RogueUiCatalog.validText(enteredName, 49, false);
    if (!restore && !validName) { notice("error.name", {}, true); return; }
    const seed = validSeed ? enteredSeed : 0, name = validName ? enteredName : "Player";
    setSettingsOpen(false);
    if (worker) { queue.close(); worker.terminate(); }
    generation++; queue = new RogueEventQueue(); frame = null; lastTrace = null; traces = []; messages = []; logs = []; translationFallbacks = []; lastOutcome = null; exitCode = null; runtimeError = null; frameCount = 0; inputRequestCount = 0; savePending = false; restorePending = Boolean(restore); textMode = false; textDraftDirty = false; inputContext = null; centeredPlayer = "";
    $("game-message").textContent = ""; $("presentation").hidden = true; $("player-status").hidden = true;
    worker = new Worker("/web/worker.js"); const currentWorker = worker;
    worker.onmessage = async ({ data }) => {
      if (worker !== currentWorker) return;
      try {
        switch (data.type) {
          case "ready": setRunning(true); notice(restore ? "notice.restoring" : "notice.entered"); if (!settingsOpen) board.focus(); break;
          case "frame": receiveFrame(data); break;
          case "presentation":
            if (frame && data.ui && typeof data.ui === "object") {
              frame = Object.freeze({ ...frame, ui: data.ui }); inputContext = data.ui.input || null; renderPresentation();
            }
            break;
          case "trace": lastTrace = data; traces.push(data); if (traces.length > 2048) traces.shift(); break;
          case "input-context": inputContext = data.input; applyInputContext(inputContext); break;
          case "message": messages.push(data); if (messages.length > 128) messages.shift(); $("game-message").textContent = translatedText(data, "message"); break;
          case "input-request": inputRequestCount++; $("screen-status").textContent = t("status.waiting"); if (restorePending) { restorePending = false; notice("notice.restored"); } break;
          case "input-flush":
            if (data.saveCancelled) { savePending = false; $("save").disabled = !running; notice("notice.save_cancelled"); }
            else notice("notice.input_flush", { count: data.count });
            break;
          case "save":
            try { await persistSave(new Uint8Array(data.bytes)); if (worker === currentWorker) notice("notice.saved"); }
            catch (error) { logs.push(error.stack || String(error)); if (worker === currentWorker) notice("error.save", {}, true); }
            finally { if (worker === currentWorker) { savePending = false; $("save").disabled = !running; } }
            break;
          case "outcome": lastOutcome = { code: data.code, text: data.text }; notice("notice.game_ended"); break;
          case "exit": exitCode = data.code; setRunning(false); $("screen-status").textContent = t("status.ended"); if (data.code < 0) notice("error.runtime", {}, true); break;
          case "error": runtimeError = String(data.text); setRunning(false); notice("error.runtime", {}, true); console.error(data.text); break;
          case "log": logs.push(String(data.text)); if (logs.length > 128) logs.shift(); console.info("[Rogue]", data.text); break;
        }
      } catch (error) { runtimeError = error.stack || error.message; setRunning(false); notice(error.message === "Missing translated presentation" ? "error.presentation" : "error.frame", {}, true); console.error(error); }
    };
    worker.onerror = (event) => { runtimeError = event.message; setRunning(false); notice("error.runtime", {}, true); };
    setRunning(false); notice("notice.loading");
    worker.postMessage({ type: "start", queue: queue.buffer, capacity: queue.capacity, seed, name, restore, locale: language, trace: parameters.get("trace") === "1" }, restore ? [restore.buffer] : []);
  }
  ui.apply(document); setRunning(false);
  try {
    const [illustration, pixels] = await Promise.all([RogueTiles.load(), RogueTiles.load("/web/assets/pixels/manifest.json")]);
    tileSets = { tiles: illustration, pixels }; tiles = tileSets[displayMode === "pixels" ? "pixels" : "tiles"];
  }
  catch (error) { runtimeError = error.stack || String(error); notice("error.tiles", {}, true); $("new-game").disabled = true; throw error; }
  $("display-mode").value = displayMode;
  function zoomOptions() {
    const sizes = RogueViewSettings.sizes(displayMode); if (!sizes.includes(tileSize)) tileSize = 32;
    $("tile-zoom").max = sizes.length - 1; $("tile-zoom").value = sizes.indexOf(tileSize); $("tile-zoom").disabled = displayMode === "ascii";
    $("zoom-value").textContent = tileSize / 32 * 100 + "%"; $("tile-zoom").setAttribute("aria-valuetext", $("zoom-value").textContent);
  }
  function persistView() { RogueViewSettings.save({ version: 1, mode: displayMode, zoom: tileSize }); }
  zoomOptions();
  $("display-mode").onchange = () => {
    const selected = $("display-mode").value; if (!RogueViewSettings.modes.includes(selected)) return;
    displayMode = selected; tiles = tileSets[displayMode === "pixels" ? "pixels" : "tiles"];
    zoomOptions(); persistView(); redraw(); centerMap();
  };
  $("tile-zoom").oninput = () => { const size = RogueViewSettings.sizes(displayMode)[Number($("tile-zoom").value)]; if (!size || displayMode === "ascii") return; tileSize = size; zoomOptions(); persistView(); redraw(); centerMap(); };
  $("center-map").onclick = centerMap;
  function fullscreenLabels() {
    const id = document.fullscreenElement ? "action.exit_fullscreen" : "action.fullscreen";
    for (const label of [$("fullscreen"), $("header-fullscreen-label")]) { label.dataset.i18n = id; label.textContent = t(id); }
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await gamePanel.requestFullscreen(); if (!settingsOpen && frame) board.focus(); }
    catch (error) { logs.push(String(error)); notice("error.fullscreen", {}, true); }
  }
  $("fullscreen").onclick = $("header-fullscreen").onclick = toggleFullscreen;
  $("settings-toggle").onclick = () => setSettingsOpen(!settingsOpen);
  $("settings-close").onclick = $("settings-scrim").onclick = () => setSettingsOpen(false);
  document.addEventListener("fullscreenchange", () => { fullscreenLabels(); redraw(); centerMap(); });
  scroll.addEventListener("scroll", () => { if (displayMode !== "ascii") redraw(); }, { passive: true });
  new ResizeObserver(() => { redraw(); }).observe(scroll);
  board.addEventListener("pointermove", event => {
    if (!camera || !frame) return;
    const position = tiles.coordinate(event, board, frame, camera); if (!position) return;
    const entry = tiles.entries[frame.map_tiles[position.y * frame.width + position.x]];
    $("tile-description").textContent = entry.labels?.[language] || entry.meaning;
  });
  $("new-game").onclick = () => start().catch((error) => { runtimeError = error.stack || String(error); notice("error.runtime", {}, true); });
  $("save").onclick = () => {
    if (composing) { notice("error.text_composing", {}, true); return; }
    let events = [abi.RG_KEY_SAVE];
    if (textMode && textDraftDirty) {
      const value = $("prompt-text").value, limit = inputContext?.limit_bytes || frame?.ui?.input?.limit_bytes || 50;
      if (!RogueUiCatalog.validText(value, limit)) { notice("error.prompt_text", { limit }, true); return; }
      events = [21, ...Array.from(value, (character) => character.codePointAt(0)), abi.RG_KEY_SAVE];
    }
    if (enqueueMany(events)) { textDraftDirty = false; savePending = true; $("save").disabled = true; notice("notice.save_pending"); }
  };
  $("load").onclick = async () => { try { const bytes = await readSave(); if (!bytes) { notice("error.no_save", {}, true); return; } await start(bytes); } catch (error) { logs.push(error.stack || String(error)); notice("error.load", {}, true); } };
  $("download-save").onclick = () => {
    if (!savedBytes) return;
    const url = URL.createObjectURL(new Blob([savedBytes], { type: "application/json" })), link = document.createElement("a");
    link.href = url; link.download = "rogue-save.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("language").onchange = () => {
    language = $("language").value === "en" ? "en" : "ja"; ui.locale = language; document.documentElement.lang = language; ui.apply(document);
    setRunning(running); fullscreenLabels(); notice(noticeState.id, noticeState.args, noticeState.error); if (frame) { redraw(); renderPresentation(); }
  };
  $("text-prompt").onsubmit = (event) => {
    event.preventDefault(); if (composing || !textMode) return;
    const value = $("prompt-text").value, limit = inputContext?.limit_bytes || frame?.ui?.input?.limit_bytes || 50;
    if (!RogueUiCatalog.validText(value, limit)) { notice("error.prompt_text", { limit }, true); return; }
    const events = [21, ...Array.from(value, (character) => character.codePointAt(0)), 13];
    if (enqueueMany(events)) { textDraftDirty = false; board.focus(); }
  };
  $("prompt-text").addEventListener("input", () => { textDraftDirty = true; });
  $("cancel-text").onclick = () => { if (enqueue(27)) board.focus(); };
  document.addEventListener("compositionstart", () => { composing = true; });
  document.addEventListener("compositionend", () => { composing = false; });
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (settingsOpen) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSettingsOpen(false); }
      else if (event.key === "Tab") {
        const controls = Array.from(settingsPanel.querySelectorAll("button,input,select,summary,a[href],[tabindex='0']")).filter(element => !element.disabled && element.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (first && (!settingsPanel.contains(target) || (event.shiftKey && target === first) || (!event.shiftKey && target === last))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      }
      return;
    }
    if (event.key === "Escape" && document.fullscreenElement) { event.preventDefault(); void toggleFullscreen(); return; }
    if (target?.closest(".ui-overlay,.heading,.credits")) return;
    if (!running || composing || event.isComposing || event.keyCode === 229 || event.metaKey || target?.closest("input,textarea,select,[contenteditable=true]")) return;
    if (target?.closest("button,a") && (event.key === "Enter" || event.key === " ")) return;
    const raw = rawKey(event.key, event); if (raw !== null) { event.preventDefault(); enqueue(raw); }
  });
  document.querySelectorAll("[data-key],[data-character]").forEach((button) => { button.onclick = () => { if (settingsOpen) return; const raw = rawKey(button.dataset.key || button.dataset.character); if (raw !== null) enqueue(raw); board.focus(); }; });
  board.onclick = (event) => {
    if (settingsOpen || !frame?.player || !running || frame.ui?.mode !== "game") return;
    const bounds = board.getBoundingClientRect();
    const position = camera ? tiles.coordinate(event, board, frame, camera) : {x: Math.floor((event.clientX - bounds.left) * frame.width / bounds.width), y: Math.floor((event.clientY - bounds.top) * frame.height / bounds.height)};
    if (!position) return;
    const { x, y } = position;
    const dx = x - frame.player.x, dy = y - frame.player.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)) { notice("error.adjacent", {}, true); return; }
    const key = dy < 0 ? (dx < 0 ? "Home" : dx > 0 ? "PageUp" : "ArrowUp") : dy > 0 ? (dx < 0 ? "End" : dx > 0 ? "PageDown" : "ArrowDown") : dx < 0 ? "ArrowLeft" : "ArrowRight";
    enqueue(rawKey(key)); board.focus();
  };
  window.addEventListener("resize", redraw); window.addEventListener("pagehide", () => { if (queue) queue.close(); });
  ui.apply(document); $("language").value = language; document.documentElement.lang = language; setRunning(false); notice("notice.start"); $("screen-status").textContent = t("status.waiting");
  fullscreenLabels(); setSettingsOpen(true);
  database().then(readSave).then((bytes) => { if (bytes) { savedBytes = bytes; $("load").disabled = false; $("download-save").disabled = false; } }).catch((error) => { logs.push(error.stack || String(error)); notice("error.storage_init", {}, true); });
  window.__rogueBrowserTest = Object.freeze({ enqueue, enqueueMany, rawKey, redraw, centerMap, get graphics() {return {mode:displayMode,tileSize,camera,ids:tiles.entries.map(e=>e.id),images:tiles.images.size,drawCount:tiles.drawCount,unknown:frame?.map_unknown_glyphs||[]};}, get language() { return language; }, get generation() { return generation; }, get running() { return running; }, get frame() { return frame; }, get frameCount() { return frameCount; }, get inputRequestCount() { return inputRequestCount; }, get trace() { return lastTrace; }, get traces() { return traces.slice(); }, get messages() { return messages.slice(); }, get savedLength() { return savedBytes?.byteLength || 0; }, get savePending() { return savePending; }, get queuePending() { return queue?.pending || 0; }, get translationFallbacks() { return translationFallbacks.slice(); }, get uiMissing() { return ui.missing.slice(); }, get diagnostics() { return { language, generation, running, exitCode, outcome: lastOutcome, runtimeError, notice: $("notice").textContent, message: $("game-message").textContent, inputRequests: inputRequestCount, frameCount, trace: lastTrace, messages: messages.slice(-8), logs: logs.slice(-16), savePending, savedLength: savedBytes?.byteLength || 0, translationFallbacks: translationFallbacks.slice(), uiMissing: ui.missing.slice(), presentation: frame?.ui }; } });
})().catch((error) => { console.error("Browser host startup failed", error); });

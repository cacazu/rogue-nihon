import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../../web/server.mjs";

const require = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, "../..");
const output = path.join(directory, "output/layout");
const executable = process.env.ROGUE_CHROME || "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const launchArgs = ["--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update"];
const candidates = [process.env.ROGUE_PLAYWRIGHT_MODULE, "playwright", "playwright-core",
  path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"),
  path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core")].filter(Boolean);
let playwright, modulePath;
for (const candidate of candidates) {
  try { modulePath = require.resolve(candidate); playwright = require(modulePath); break; }
  catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
}
if (!playwright?.chromium) throw new Error("Playwright is unavailable. Set ROGUE_PLAYWRIGHT_MODULE to the existing Playwright package path.");

await mkdir(output, { recursive: true });
// Each run owns a new browser profile and origin. Never use a person's browser data.
const scratch = await mkdtemp(path.join(output, "scratch-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const server = createPreviewServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const evidence = { started_at: new Date().toISOString(), base, executable, launch_args: launchArgs, headless: process.env.ROGUE_HEADLESS !== "0", playwright: modulePath, scratch, checks: [], screenshots: [], errors: [] };
let browser, context, page;

async function snapshot() {
  return page.evaluate(() => ({
    words: __rogueBrowserTest.trace?.words,
    cells: __rogueBrowserTest.frame?.cells,
    map: __rogueBrowserTest.frame?.map_cells,
    player: __rogueBrowserTest.frame?.player,
    input: __rogueBrowserTest.inputRequestCount,
    pending: __rogueBrowserTest.queuePending,
    generation: __rogueBrowserTest.generation
  }));
}
async function settled() {
  await page.waitForFunction(() => Boolean(window.__rogueBrowserTest?.frame && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0 && __rogueBrowserTest.queuePending === 0));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function unchanged(before, label) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await snapshot(), before, label);
}
async function shot(name) {
  const file = name + ".png";
  const bytes = await page.screenshot({ path: path.join(output, file), fullPage: false });
  evidence.screenshots.push({ file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash("sha256").update(bytes).digest("hex") });
}
async function openSettings() {
  if (await page.locator("#settings-panel").isHidden()) await page.locator("#settings-toggle").click();
  assert.equal(await page.locator("#settings-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#settings-panel").isVisible(), true);
}
async function closeSettings() {
  if (await page.locator("#settings-panel").isVisible()) await page.locator("#settings-close").click();
  assert.equal(await page.locator("#settings-toggle").getAttribute("aria-expanded"), "false");
}
async function measure(name) {
  const layout = await page.evaluate(() => {
    const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
      game: rect(".game-panel"), map: rect(".board-scroll"), ui: rect(".ui-overlay"), hud: rect(".hud-overlay"),
      settings: rect("#settings-panel"), canvas: { width: document.getElementById("board").width }, camera: __rogueBrowserTest.graphics.camera };
  });
  assert.ok(layout.pageWidth <= layout.viewport.width + 1, name + ": no horizontal page overflow");
  assert.ok(layout.map.width > 250 && layout.map.height > 150, name + ": usable map viewport");
  assert.ok(layout.map.left >= layout.game.left - 1 && layout.map.right <= layout.game.right + 1, name + ": map belongs to the game screen");
  assert.ok(layout.ui.left >= layout.game.left - 1 && layout.ui.right <= layout.game.right + 1, name + ": UI belongs to the game screen");
  assert.ok(layout.hud.left >= layout.game.left - 1 && layout.hud.right <= layout.game.right + 1, name + ": HUD belongs to the game screen");
  if (layout.camera) assert.ok(layout.canvas.width <= layout.map.width * 2 + 2, name + ": Canvas remains bounded by the viewport");
  evidence[name] = layout;
}
async function playerVisible() {
  const visible = await page.evaluate(() => {
    const { player } = __rogueBrowserTest.frame, c = __rogueBrowserTest.graphics.camera;
    if (c) return { x: (player.x + 0.5) * c.size - c.left, y: (player.y - 0.5) * c.size - c.top, width: c.width, height: c.height };
    const s = document.querySelector(".board-scroll"), b = document.getElementById("board"), r = b.getBoundingClientRect(), v = s.getBoundingClientRect();
    return { x: r.left + (player.x + 0.5) * r.width / __rogueBrowserTest.frame.width - v.left,
      y: r.top + (player.y + 0.5) * r.height / __rogueBrowserTest.frame.height - v.top, width: s.clientWidth, height: s.clientHeight };
  });
  assert.ok(visible.x >= 0 && visible.x < visible.width && visible.y >= 0 && visible.y < visible.height, "centering keeps the visible player within the map viewport");
}
async function adjacentPoint() {
  return page.evaluate(() => {
    const f = __rogueBrowserTest.frame, c = __rogueBrowserTest.graphics.camera, b = document.getElementById("board"), r = b.getBoundingClientRect();
    const direction = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => f.map_tiles[(f.player.y + dy) * f.width + f.player.x + dx] === 1);
    if (!c || !direction) throw new Error("No visible adjacent floor in the seeded real game");
    const x = f.player.x + direction[0], y = f.player.y + direction[1];
    return { x, y, clientX: r.left + ((x + 0.5) * c.size - c.left) * r.width / c.width,
      clientY: r.top + ((y - 0.5) * c.size - c.top) * r.height / c.height };
  });
}
async function inspectOverlayBounds(name) {
  const point = await adjacentPoint();
  assert.equal(await page.evaluate(({ clientX, clientY }) => document.elementFromPoint(clientX, clientY)?.id, point), "board", name + ": hover targets the visible map");
  await page.mouse.move(point.clientX, point.clientY);
  await page.waitForFunction(() => document.getElementById("tile-description").textContent.trim().length > 0);
  const bounds = await page.evaluate(() => {
    const rect = (selector) => { const e = document.querySelector(selector), r = e.getBoundingClientRect(); return { text: e.textContent.trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    return { description: rect("#tile-description"), directions: rect(".direction-pad"), actions: rect(".action-buttons"), message: rect("#game-message") };
  });
  const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
  assert.equal(overlaps(bounds.description, bounds.directions), false, name + ": nonempty map description does not cover the direction pad");
  assert.equal(overlaps(bounds.description, bounds.actions), false, name + ": map description does not cover action buttons");
  if (bounds.message.text) {
    assert.equal(overlaps(bounds.message, bounds.directions), false, name + ": game message does not cover direction buttons");
    assert.equal(overlaps(bounds.message, bounds.actions), false, name + ": game message does not cover action buttons");
  }
  evidence[name + "_overlay_bounds"] = { pointer: "mouse", ...bounds };
}

try {
  evidence.files = await Promise.all(["web/index.html", "web/style.css", "web/app.js", "build/game.js", "build/game.wasm"].map(async (file) => {
    const bytes = await readFile(path.join(project, file));
    return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }));
  context = await playwright.chromium.launchPersistentContext(path.join(scratch, "profile"), { executablePath: executable, headless: process.env.ROGUE_HEADLESS !== "0", downloadsPath: path.join(scratch, "downloads"),
    viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1, hasTouch: true,
    args: launchArgs });
  browser = context.browser();
  evidence.browser_version = browser.version();
  page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  await page.goto(base + "?trace=1");
  await page.waitForFunction(() => window.__rogueBrowserTest?.graphics?.images === 46);
  assert.equal(await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer === "function"), true);
  assert.equal(await page.locator("#connection").count(), 0, "the former playing badge is removed");
  assert.equal(await page.locator(".game-panel .controls").count(), 1);
  assert.equal(await page.locator(".game-panel .map-area").count(), 1);
  assert.equal(await page.locator(".game-panel .board-scroll").count(), 1);
  assert.equal(await page.locator(".board-scroll").evaluate((element) => Boolean(element.closest(".map-area"))), true);
  assert.equal(await page.locator(".game-panel .ui-overlay #settings-panel").count(), 1);
  assert.equal(await page.locator(".game-panel .hud-overlay #player-status").count(), 1);
  await openSettings();
  assert.equal(await page.locator("#load").isDisabled(), true, "fresh profile starts without a save");
  await page.locator("#language").selectOption("en");
  assert.equal(await page.evaluate(() => __rogueBrowserTest.language), "en");
  await page.locator("#language").selectOption("ja");
  assert.equal(await page.evaluate(() => __rogueBrowserTest.language), "ja");
  assert.equal(await page.evaluate(() => __rogueBrowserTest.generation), 0);
  const repo = page.locator('a[href="https://github.com/cacazu/jrogue"]');
  assert.ok(await repo.count() > 0, "distribution repository is linked");
  evidence.checks.push("Title, unified map/UI/HUD game screen and source/license footer are present; pre-start language selection creates no Worker");
  await page.locator("#seed").fill("12345");
  await page.locator("#name").fill("画面検証の勇者");
  await page.locator("#new-game").click();
  await settled();
  assert.equal(await page.locator("#settings-panel").isHidden(), true);
  assert.equal(await page.locator("#language").isDisabled(), true, "running language contract remains unchanged");
  const before = await snapshot();
  assert.equal(before.words.length, 20);
  evidence.initial = before;

  await openSettings();
  for (let index = 0; index < 28; index++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest("#settings-panel"))), true, "Tab remains in the settings dialog");
  }
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest("#settings-panel"))), true);
  await page.locator("#tile-zoom").focus();
  for (const key of ["h", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) await page.keyboard.press(key);
  await unchanged(before, "dialog keys do not reach C or advance RNG");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#settings-panel").isHidden(), true);
  await unchanged(before, "Escape closes the dialog without a game command");
  await page.locator("#settings-toggle").focus();
  for (const key of ["h", "ArrowLeft", "Escape"]) await page.keyboard.press(key);
  await unchanged(before, "focused closed settings control does not leak map keys");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#settings-panel").isVisible(), true);
  await page.locator("#settings-close").focus();
  await page.keyboard.press("Enter");
  await unchanged(before, "keyboard activation only toggles the settings dialog");
  evidence.checks.push("Settings open/close and native Tab, Shift+Tab, Enter, Escape, arrows and h remain isolated from the game input queue");

  for (const [mode, sizes] of [["tiles", [16, 24, 32, 48, 64]], ["pixels", [32, 64, 96, 128]], ["ascii", []]]) {
    await openSettings();
    await page.locator("#display-mode").selectOption(mode);
    assert.equal(await page.evaluate(() => __rogueBrowserTest.graphics.mode), mode);
    const slider = page.locator("#tile-zoom");
    assert.equal(await slider.getAttribute("type"), "range");
    if (mode === "ascii") assert.equal(await slider.isDisabled(), true);
    else {
      await slider.focus();
      await page.keyboard.press("Home");
      for (let index = 0; index < sizes.length; index++) {
        if (index) await page.keyboard.press("ArrowRight");
        assert.equal(await slider.inputValue(), String(index));
        assert.equal(await page.evaluate(() => __rogueBrowserTest.graphics.tileSize), sizes[index]);
        assert.equal(await page.evaluate(() => document.getElementById("board").getContext("2d").imageSmoothingEnabled), false);
      }
    }
    await page.locator("#center-map").click();
    await closeSettings();
    await playerVisible();
    await unchanged(before, mode + " display, zoom and centering preserve the complete observed state");
  }
  evidence.checks.push("Native zoom slider selects the existing illustration and pixel sizes; ASCII, illustration, pixels and centering preserve C/RNG/frame/input state");

  await openSettings();
  await page.locator("#display-mode").selectOption("pixels");
  await page.locator("#tile-zoom").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.locator("#center-map").click();
  await closeSettings();
  await playerVisible();
  const blocked = await adjacentPoint();
  await openSettings();
  await page.mouse.click(blocked.clientX, blocked.clientY);
  await unchanged(before, "map hit-testing is blocked while settings are open");
  await closeSettings();
  await inspectOverlayBounds("desktop");
  await measure("desktop");
  await shot("desktop");

  for (const [name, width, height, dpr] of [["mobile-portrait", 390, 844, 3], ["mobile-landscape", 844, 390, 2]]) {
    const cdp = await context.newCDPSession(page);
    await page.setViewportSize({ width, height });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: true });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await openSettings();
    const panel = await page.locator("#settings-panel").boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1, name + ": settings remain within viewport width");
    await page.locator("#tile-zoom").focus();
    await page.keyboard.press("End");
    await closeSettings();
    const gesture = await page.evaluate(() => {
      const s = document.querySelector(".board-scroll"), r = s.getBoundingClientRect(), b = document.getElementById("board"), br = b.getBoundingClientRect();
      const visible = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) };
      let point;
      for (const fy of [0.5, 0.35, 0.65]) for (const fx of [0.55, 0.7, 0.85]) {
        const x = visible.left + (visible.right - visible.left) * fx, y = visible.top + (visible.bottom - visible.top) * fy;
        if (!point && document.elementFromPoint(x, y) === b) point = { x, y };
      }
      window.__layoutTouch = [];
      if (!window.__layoutTouchInstalled) {
        for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) document.addEventListener(type, (event) => {
          if (event.pointerType === "touch") __layoutTouch.push({ type, target: event.target.id || event.target.className, x: event.clientX, y: event.clientY });
        }, { capture: true });
        window.__layoutTouchInstalled = true;
      }
      return { point, scroll: { x: s.scrollLeft, y: s.scrollTop }, map: { x: r.x, y: r.y, width: r.width, height: r.height },
        canvas: { x: br.x, y: br.y, width: br.width, height: br.height }, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        camera: __rogueBrowserTest.graphics.camera, inert: s.inert, settingsHidden: document.getElementById("settings-panel").hidden, touchPoints: navigator.maxTouchPoints };
    });
    evidence[name + "_gesture"] = gesture;
    assert.ok(gesture.point, name + ": native pan starts on an unobstructed Canvas");
    const panBefore = gesture.scroll, { x, y } = gesture.point;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - step * 15, y: y - step * 7 }] });
      await page.waitForTimeout(35);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction((previous) => { const s = document.querySelector(".board-scroll"); return s.scrollLeft !== previous.x || s.scrollTop !== previous.y; }, panBefore);
    gesture.after = await page.evaluate(() => { const s = document.querySelector(".board-scroll"); return { x: s.scrollLeft, y: s.scrollTop, camera: __rogueBrowserTest.graphics.camera, settingsHidden: document.getElementById("settings-panel").hidden, events: __layoutTouch }; });
    await openSettings();
    const settingsScroll = await page.locator("#settings-panel").evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }));
    if (settingsScroll.scroll > settingsScroll.height) {
      await page.locator("#settings-panel").evaluate((element) => { element.scrollTop = 0; });
      await page.locator("#settings-panel").hover();
      await page.mouse.wheel(0, 280);
      await page.waitForFunction(() => document.getElementById("settings-panel").scrollTop > 0);
    }
    await shot(name + "-settings");
    await page.locator("#center-map").click();
    await closeSettings();
    await playerVisible();
    await inspectOverlayBounds(name);
    await measure(name);
    await shot(name);
    await unchanged(before, name + " panning and settings scrolling do not send game input");
    await cdp.detach();
  }
  evidence.checks.push("Portrait and landscape mobile viewports keep the overlays in the unified screen, scroll the settings and pan/center the map with no game input; visible descriptions and messages avoid gameplay controls");

  const desktop = await context.newCDPSession(page);
  await page.setViewportSize({ width: 1280, height: 960 });
  await desktop.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await page.locator("#header-fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement === document.querySelector(".game-panel"));
  await shot("fullscreen");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.fullscreenElement);
  await unchanged(before, "header fullscreen and Escape leave C and input unchanged");
  await openSettings();
  await page.locator("#fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement === document.querySelector(".game-panel"));
  await openSettings();
  await page.locator("#fullscreen").click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await closeSettings();
  await unchanged(before, "settings fullscreen enter/exit leaves C and input unchanged");
  evidence.checks.push("Both header and settings fullscreen controls enter and exit the game screen; native Escape exits without a game command");

  await openSettings();
  await page.locator("#tile-zoom").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.locator("#center-map").click();
  await closeSettings();
  const target = await adjacentPoint();
  assert.equal(await page.evaluate(({ clientX, clientY }) => document.elementFromPoint(clientX, clientY)?.id, target), "board", "transparent overlays allow map hit-testing");
  await page.mouse.click(target.clientX, target.clientY);
  await page.waitForFunction((count) => __rogueBrowserTest.inputRequestCount > count, before.input);
  await settled();
  assert.deepEqual(await page.evaluate(() => __rogueBrowserTest.frame.player), { x: target.x, y: target.y });
  evidence.checks.push("A native pointer click through the map camera reaches exactly the selected adjacent cell in the real C game");

  await page.locator('[data-character="i"]').click();
  await page.waitForFunction(() => __rogueBrowserTest.frame.ui.mode === "inventory" || __rogueBrowserTest.frame.ui.mode === "menu");
  await settled();
  await openSettings();
  await page.locator("#save").click();
  await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending);
  const saved = await snapshot();
  evidence.saved = saved;
  evidence.saved_length = await page.evaluate(() => __rogueBrowserTest.savedLength);
  await page.locator("#load").click();
  await page.waitForFunction((generation) => __rogueBrowserTest.generation > generation && __rogueBrowserTest.frame && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0, saved.generation);
  await settled();
  const restored = await snapshot();
  assert.deepEqual({ words: restored.words, cells: restored.cells, map: restored.map, player: restored.player }, { words: saved.words, cells: saved.cells, map: saved.map, player: saved.player });
  assert.equal(await page.locator("#settings-panel").isHidden(), true);
  evidence.restored = restored;
  await shot("restored-inventory");
  evidence.checks.push("Scratch IndexedDB save completes before acknowledgement and a fresh Worker restores exact 20-word C/RNG state and original pending inventory screen");
  assert.deepEqual(await page.evaluate(() => ({ fallbacks: __rogueBrowserTest.translationFallbacks, missing: __rogueBrowserTest.uiMissing })), { fallbacks: [], missing: [] });
  assert.deepEqual(evidence.errors, []);
  evidence.checks.push("Observed Japanese UI has no missing translation IDs, fallbacks or browser exceptions");
  evidence.diagnostics = await page.evaluate(() => __rogueBrowserTest.diagnostics);
  assert.equal(evidence.diagnostics.runtimeError, null);
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = error.stack || String(error);
  if (page) {
    try { evidence.failure_snapshot = await snapshot(); await shot("failure"); }
    catch (diagnosticError) { evidence.diagnostic_error = diagnosticError.message; }
  }
  throw error;
} finally {
  evidence.finished_at = new Date().toISOString();
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks, evidence: path.join(output, "evidence.json"), screenshots: evidence.screenshots.map((item) => item.file), error: evidence.error }, null, 2));
}

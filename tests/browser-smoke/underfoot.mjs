import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../../../tools/server.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = artifactDirectory(path.join(root, "tests/browser-smoke/output/underfoot/fixed"));
const { chromium } = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
await mkdir(output, { recursive: true });
const server = process.argv[2] ? null : createPreviewServer();
if (server) await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = process.argv[2] || "http://127.0.0.1:" + server.address().port + "/";
const browser = await chromium.launch({ executablePath: process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--disable-gpu"] });
const evidence = { url: base, checks: [], pixels: [], screenshots: [], errors: [], started_at: new Date().toISOString() };
let context, page, mobile = false, prefix;
async function scene() { return page.evaluate(() => __rogueBrowserTest.canvas); }
async function state() { return page.evaluate(() => ({ frame: __rogueBrowserTest.frame, words: __rogueBrowserTest.trace?.words, input: __rogueBrowserTest.inputRequestCount })); }
async function click(id) {
  await page.waitForFunction(id => __rogueBrowserTest.canvas.controls.some(c => c.id === id && !c.disabled), id);
  const c = (await scene()).controls.find(c => c.id === id), x = c.rect.x + c.rect.w / 2, y = c.rect.y + c.rect.h / 2;
  if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function key(value) {
  const before = await state();
  if (mobile && (await scene()).controls.some(c => c.id === "touch-" + value)) await click("touch-" + value);
  else await page.keyboard.press(value);
  await page.waitForFunction(n => __rogueBrowserTest.inputRequestCount > n && __rogueBrowserTest.queuePending === 0, before.input);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function settled() {
  await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0 && __rogueBrowserTest.queuePending === 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function shot(name) { const file = prefix + "-" + name + ".png"; await page.screenshot({ path: path.join(output, file) }); evidence.screenshots.push(file); }
async function check(label, fn) { await fn(); evidence.checks.push(label); console.log("PASS " + label); }
async function open(mode, touch = false, fixture = "") {
  await context?.close(); mobile = touch; prefix = (touch ? "mobile-" : "desktop-") + mode + (fixture ? "-" + fixture : "");
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: touch ? { width: 390, height: 844 } : { width: 1100, height: 850 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  if (fixture) {
    const worker = await readFile(path.join(root, "web/worker.js"), "utf8");
    const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };
    await context.route("**/web/worker.js", route => route.fulfill({ body: worker.replace('    module.FS.writeFile("/locale.txt",', '    module.FS.writeFile("/fixture.id", ' + JSON.stringify(fixture) + ');\n    module.FS.writeFile("/locale.txt",'), contentType: "text/javascript", headers }));
    await context.route("**/build/game.js", route => route.fulfill({ path: path.join(root, "build/game-fixtures.js"), contentType: "text/javascript", headers }));
  }
  page = await context.newPage();await installBrowserTestAdapter(page); page.on("pageerror", error => evidence.errors.push(error.message)); page.setDefaultTimeout(15000);
  await page.goto(new URL("?trace=1&lang=ja&view=" + mode, base).href);
  await page.waitForFunction(() => window.__rogueBrowserTest?.canvas?.paintCount > 0);
  await click("seed"); await page.keyboard.press("Control+a"); await page.keyboard.insertText("17"); await click("new-game"); await settled();
}
function doorRoute(f) {
  const queue = [[f.player.x, f.player.y, []]], seen = new Set();
  while (queue.length) {
    const [x, y, keys] = queue.shift(), id = x + "," + y;
    if (seen.has(id)) continue; seen.add(id);
    if (f.map_cells[y * f.width + x] === "+" && keys.length) return { x, y, keys };
    for (const [dx, dy, key] of [[1, 0, "l"], [-1, 0, "h"], [0, 1, "j"], [0, -1, "k"]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < f.width && ny > 0 && ny < f.height - 1 && ".#+@".includes(f.map_cells[ny * f.width + nx])) queue.push([nx, ny, keys.concat(key)]);
    }
  }
  throw new Error("No door reachable through already observed cells");
}
async function tilePixels(x, y) {
  return page.evaluate(({ x, y }) => {
    const s = __rogueBrowserTest.canvas, c = s.camera, r = Math.min(devicePixelRatio, 2);
    const px = Math.round((x * c.size - c.left) * r), py = Math.round(((y - 1) * c.size - c.top) * r);
    const w = Math.round(((x + 1) * c.size - c.left) * r) - px, h = Math.round((y * c.size - c.top) * r) - py;
    return { w, h, pixels: Array.from(document.getElementById("rogue-canvas").getContext("2d").getImageData(px + s.mapRect.x * r, py + s.mapRect.y * r, w, h).data) };
  }, { x, y });
}
async function compareTerrain(before, expectedTile, label, mode) {
  const current = await state(), { x, y } = current.frame.player;
  assert.deepEqual(current.frame.map_player_underlay, { x, y, tile: expectedTile });
  const after = await tilePixels(x, y);
  assert.equal(after.w, before.w); assert.equal(after.h, before.h);
  const alpha = await page.evaluate(async ({ mode, w, h }) => {
    const image = new Image(); image.src = "/web/assets/" + (mode === "pixels" ? "pixels-v2" : "tiles") + "/actor.player.png"; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    return Array.from({ length: w * h }, (_, i) => data[i * 4 + 3]);
  }, { mode, w: after.w, h: after.h });
  let compared = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] === 0) {
    assert.deepEqual(after.pixels.slice(i * 4, i * 4 + 4), before.pixels.slice(i * 4, i * 4 + 4), label + " terrain pixels below the transparent player stay identical");
    compared++;
  }
  assert.ok(compared > 32);
  evidence.pixels.push({ label: prefix + "-" + label, compared, tile: expectedTile, player: { x, y } });
  await shot(label);
}
async function inventoryAndReload(expectedTile) {
  const before = await state();
  if (mobile) await click("touch-action-action.inventory"); else await key("i");
  await page.waitForFunction(() => __rogueBrowserTest.frame.ui.mode === "menu");
  assert.deepEqual((await state()).frame.map_player_underlay, before.frame.map_player_underlay);
  assert.deepEqual((await state()).frame.map_underlays, before.frame.map_underlays);
  await shot("inventory");
  const opened = await state();
  await click("settings-toggle"); await click("save");
  await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending);
  const saved = await state(); assert.deepEqual(saved.words, opened.words);
  await click("settings-top"); await page.waitForFunction(() => __rogueBrowserTest.topOpen);
  await page.reload(); await page.waitForFunction(() => window.__rogueBrowserTest?.canvas?.paintCount > 0);
  await click("load"); await settled();
  const loaded = await state();
  assert.deepEqual(loaded.words.slice(1, 16), saved.words.slice(1, 16));
  assert.deepEqual(loaded.frame.map_player_underlay, before.frame.map_player_underlay);
  assert.deepEqual(loaded.frame.map_underlays, before.frame.map_underlays);
  assert.equal(loaded.frame.map_player_underlay.tile, expectedTile);
  await click("window-32"); await page.waitForFunction(() => !__rogueBrowserTest.frame.ui.window);
  await shot("loaded");
}
async function compareEnemy(x, y, tile, mode, label) {
  const f = (await state()).frame, index = f.map_tiles[y * f.width + x];
  assert.ok(index >= 23 && index <= 48);
  assert.deepEqual(f.map_underlays.find(u => u.x === x && u.y === y), { x, y, tile });
  const actual = await tilePixels(x, y);
  const reference = await page.evaluate(async ({ mode, tile, index, w, h }) => {
    const tiles = await RogueTiles.load("/web/assets/" + (mode === "pixels" ? "pixels-v2" : "tiles") + "/manifest.json");
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const context = canvas.getContext("2d");
    tiles.draw(context, { width: 1, height: 3, map_tiles: [0, tile, 0], map_tile_ids: tiles.entries.map(e => e.id), map_unknown_glyphs: [] }, { size: w, ratio: 1, left: 0, top: 0, width: w, height: h });
    const terrain = Array.from(context.getImageData(0, 0, w, h).data);
    // Independently composite the enemy over the explicit expected terrain.
    // Some illustration alpha values round to zero when drawn on transparency
    // yet still tint an opaque destination, so also verify the full composite.
    context.drawImage(tiles.images.get(tiles.entries[index].image), 0, 0, w, h);
    const composite = Array.from(context.getImageData(0, 0, w, h).data);
    context.clearRect(0, 0, w, h);
    context.drawImage(tiles.images.get(tiles.entries[index].image), 0, 0, w, h);
    const sprite = context.getImageData(0, 0, w, h).data;
    const alpha = Array.from({ length: w * h }, (_, i) => sprite[i * 4 + 3]);
    return { terrain, alpha, composite };
  }, { mode, tile, index, w: actual.w, h: actual.h });
  const mismatch = actual.pixels.findIndex((v,i) => v !== reference.composite[i]);
  assert.equal(mismatch, -1, label + " expected composite differs at byte " + mismatch + ": " + actual.pixels[mismatch] + " vs " + reference.composite[mismatch]);
  let compared = 0;
  for (let i = 0; i < reference.alpha.length; i++) if (reference.alpha[i] === 0 && reference.composite.slice(i * 4, i * 4 + 4).every((v,k) => v === reference.terrain[i * 4 + k])) {
    assert.deepEqual(actual.pixels.slice(i * 4, i * 4 + 4), reference.terrain.slice(i * 4, i * 4 + 4), label + " visible terrain stays identical below the enemy");
    compared++;
  }
  assert.ok(compared > 32);
  evidence.pixels.push({ label: prefix + "-" + label, compared, tile, actor: { x, y, index } });
}
try {
  for (const [mode, touch] of [["pixels", false], ["tiles", false], ["pixels", true]]) {
    await open(mode, touch);
    await check(prefix + ": real movement preserves the door beneath the player pixel for pixel", async () => {
      const route = doorRoute((await state()).frame);
      for (const value of route.keys.slice(0, -1)) await key(value);
      const before = await tilePixels(route.x, route.y); await key(route.keys.at(-1));
      await compareTerrain(before, 3, "door", mode);
      const beforeRepaint = await state();
      await page.evaluate(() => { for (let n = 0; n < 100; n++) __rogueBrowserTest.redraw(); });
      assert.deepEqual((await state()).words, beforeRepaint.words);
      assert.deepEqual((await state()).frame.map_player_underlay, beforeRepaint.frame.map_player_underlay);
    });
    await check(prefix + ": inventory and a fresh Worker load preserve the door underlay", () => inventoryAndReload(3));
    await check(prefix + ": real movement preserves passage pixels and restores the departed door", async () => {
      const f = (await state()).frame, door = f.player;
      const corridor = [[1, 0, "l"], [-1, 0, "h"], [0, 1, "j"], [0, -1, "k"]].find(([dx, dy]) => f.map_cells[(door.y + dy) * f.width + door.x + dx] === "#");
      assert.ok(corridor);
      const before = await tilePixels(door.x + corridor[0], door.y + corridor[1]); await key(corridor[2]);
      await compareTerrain(before, 2, "passage", mode);
      assert.equal((await state()).frame.map_cells[door.y * f.width + door.x], "+");
      const saved = await state();
      await click("settings-toggle"); await click("save"); await page.waitForFunction(() => !__rogueBrowserTest.savePending);
      await click("settings-top"); await page.waitForFunction(() => __rogueBrowserTest.topOpen); await click("load"); await settled();
      assert.deepEqual((await state()).frame.map_player_underlay, saved.frame.map_player_underlay);
      assert.deepEqual((await state()).words.slice(1, 16), saved.words.slice(1, 16));
    });
  }
  await open("pixels", false, "plain");
  await check("Original C stairs remain below the player and are cleared on descent to a new level", async () => {
    for (let n = 0; n < 4; n++) await key("l");
    const before = await tilePixels(15, 10); await key("l"); await compareTerrain(before, 6, "stairs", "pixels");
    await inventoryAndReload(6);
    await key(">");
    const next = (await state()).frame; assert.equal(next.stats.level, 2);
    assert.equal(next.map_player_underlay.tile, 1);
    assert.equal(next.map_player_underlay.x, next.player.x); assert.equal(next.map_player_underlay.y, next.player.y);
    await shot("new-level");
  });
  for (const [mode, touch] of [["pixels", false], ["tiles", false], ["pixels", true]]) {
    await open(mode, touch, "actor-underfoot");
    await check(prefix + ": enemies preserve passage, door, stairs, trap and floor pixels", async () => {
      for (const [i, tile] of [2, 3, 6, 7, 1].entries()) await compareEnemy(11 + i, 10, tile, mode, "enemy-" + tile);
      const before = await state();
      await page.evaluate(() => { for (let n = 0; n < 100; n++) __rogueBrowserTest.redraw(); });
      assert.deepEqual((await state()).words, before.words);
      assert.deepEqual((await state()).frame.map_underlays, before.frame.map_underlays);
      await shot("enemies");
    });
    await check(prefix + ": inventory and fresh Worker load preserve all actor terrain", () => inventoryAndReload(1));
    await open(mode, touch, "actor-underfoot-moving");
    await check(prefix + ": real C enemy movement replaces terrain observations and restores departed cells", async () => {
      for (const [x, tile] of [[13, 6], [12, 3], [11, 2]]) {
        await key(".");
        await compareEnemy(x, 10, tile, mode, "moving-enemy-" + x);
        const f = (await state()).frame;
        assert.ok(!f.map_underlays.some(u => u.x === x + 1 && u.y === 10));
        assert.equal(f.map_tiles[10 * f.width + x + 1], x === 13 ? 1 : x === 12 ? 6 : 3);
      }
      await shot("moving-enemy");
    });
  }
  await open("pixels", false, "actor-underfoot-detected");
  await check("Blind monster detection keeps unobserved terrain dark for every enemy", async () => {
    for (let x = 11; x <= 15; x++) await compareEnemy(x, 10, 0, "pixels", "detected-enemy-" + x);
    await shot("detected-enemies");
  });
  assert.deepEqual(evidence.errors, []);
  evidence.files = await Promise.all(["web/tiles.js", "rust/src/engine.rs", "logic/semantic.c", "logic/knowledge.c", "build/game.js", "build/game.wasm"].map(async file => ({ file, sha256: createHash("sha256").update(await readFile(path.join(root, file))).digest("hex") })));
  evidence.result = "pass";
} catch (error) {
  evidence.result = "fail"; evidence.failure = error.stack;
  if (page) { evidence.frame = await state().catch(() => null); await shot("failure").catch(() => {}); }
  throw error;
} finally {
  evidence.finished_at = new Date().toISOString();
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  await context?.close(); await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}

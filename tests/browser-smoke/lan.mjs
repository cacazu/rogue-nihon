import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runGame } from "../run-game.mjs";

const target = process.argv[2] || process.env.ROGUE_LAN_URL;
if (!target || new URL(target).protocol !== "https:") throw new Error("Pass the running LAN HTTPS URL");
const { chromium } = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const output = artifactDirectory(fileURLToPath(new URL("./output/lan/", import.meta.url)));
await mkdir(output, { recursive: true });
const evidence = { url: target, started_at: new Date().toISOString(), certificate: "Local certificate; browser warning accepted for this test", checks: [], errors: [], screenshots: [] };
const browser = await chromium.launch({ executablePath: process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
let page;
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page = await context.newPage();await installBrowserTestAdapter(page);
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => evidence.errors.push(error.message));
  async function check(label, run) { await run(); evidence.checks.push(label); console.log("PASS " + label); }
  async function tap(id) {
    await page.waitForFunction(id => __rogueBrowserTest.canvas.controls.some(c => c.id === id && !c.disabled), id);
    const control = await page.evaluate(id => __rogueBrowserTest.canvas.controls.find(c => c.id === id), id);
    const { x, y, w, h } = control.rect;
    assert.ok(x + w / 2 >= 0 && x + w / 2 < 390 && y + h / 2 >= 0 && y + h / 2 < 844, id + " is in the mobile viewport");
    await page.touchscreen.tap(x + w / 2, y + h / 2);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function field(id, text) { await tap(id); await page.keyboard.press("Control+a"); await page.keyboard.insertText(text); }
  async function state() { return page.evaluate(() => ({ words: __rogueBrowserTest.trace?.words, frame: __rogueBrowserTest.frame, input: __rogueBrowserTest.inputRequestCount })); }
  async function settled() { await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0 && __rogueBrowserTest.queuePending === 0); }
  async function shot(name) { await page.screenshot({ path: path.join(output, name + ".png") }); evidence.screenshots.push(name + ".png"); }
  const response = await page.goto(new URL("?trace=1&lang=ja&view=pixels", target).href);
  await page.waitForFunction(() => window.__rogueBrowserTest?.canvas?.paintCount > 0);
  await check("LAN HTTPS entry point enables SharedArrayBuffer and cross-origin isolation", async () => {
    assert.equal(response.status(), 200);
    const headers = response.headers();
    assert.equal(headers["cross-origin-opener-policy"], "same-origin");
    assert.equal(headers["cross-origin-embedder-policy"], "require-corp");
    evidence.security = await page.evaluate(() => ({ secure: isSecureContext, isolated: crossOriginIsolated, sab: typeof SharedArrayBuffer }));
    assert.deepEqual(evidence.security, { secure: true, isolated: true, sab: "function" });
    evidence.files = [];
    for (const file of ["build/game.js", "build/game.wasm", "web/canvas-ui.js"]) {
      const local = await readFile(new URL("../../" + file, import.meta.url));
      const served = await context.request.get(new URL(file, target).href);
      assert.equal(served.status(), 200);
      assert.deepEqual(await served.body(), local, file + " matches the current build");
      evidence.files.push({ file, sha256: createHash("sha256").update(local).digest("hex") });
    }
    await shot("top-mobile");
  });
  await check("LAN server serves game resources but denies private keys and source configuration", async () => {
    for (const resource of ["/.local/lan/192.168.11.4-key.pem", "/.gitignore", "/start.ps1", "/rust/Cargo.toml", "/web/%2e%2e/.local/lan/192.168.11.4-key.pem"]) {
      const denied = await context.request.get(new URL(resource, target).href);
      assert.equal(denied.status(), 403, resource);
      assert.ok(!(await denied.text()).includes("PRIVATE KEY"));
    }
    const wasm = await context.request.head(new URL("/build/game.wasm", target).href);
    assert.equal(wasm.status(), 200);
    assert.equal(wasm.headers()["content-type"], "application/wasm");
  });
  await check("Touch and native text fields start the real Bevy/C game over LAN HTTPS", async () => {
    await tap("random-name"); assert.ok(await page.locator("#name").inputValue());
    await tap("random-seed"); assert.match(await page.locator("#seed").inputValue(), /^\d+$/);
    await field("name", "LAN勇者"); await field("seed", "17"); await tap("new-game"); await settled();
    assert.equal((await state()).frame.ui.name, "LAN勇者");
    await shot("game-mobile");
  });
  await check("Touch inventory opens over the map and Close preserves the C/RNG state", async () => {
    const before = await state();
    await tap("touch-action-action.inventory"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.mode === "menu");
    assert.equal((await state()).frame.map_cells, before.frame.map_cells);
    await shot("inventory-mobile");
    const browsing = await state();
    await tap("item-a"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.window.kind === "inventory_actions");
    await shot("food-actions-mobile"); await tap("window-118");
    await page.waitForFunction(() => __rogueBrowserTest.frame.ui.window.kind === "inventory_details");
    await shot("food-details-mobile"); assert.deepEqual((await state()).words, browsing.words);
    await tap("window-27"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.window.kind === "inventory_actions");
    await tap("window-27"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.inventory && __rogueBrowserTest.frame.ui.input.kind === "space");
    await tap("window-32");
    await page.waitForFunction(() => !__rogueBrowserTest.frame.ui.window);
    assert.deepEqual((await state()).words.slice(1, 16), before.words.slice(1, 16));
  });
  await check("Touch input reaches C and advances a game turn", async () => {
    const before = await state(); await tap("touch-.");
    await page.waitForFunction(turn => __rogueBrowserTest.trace.words[13] === turn + 1 && __rogueBrowserTest.queuePending === 0, before.words[13]);
  });
  await check("LAN touch item action equips through C and matches the reference C rules/RNG", async () => {
    await tap("touch-action-action.inventory"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.inventory);
    await tap("item-d"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.window.kind === "inventory_actions");
    await tap("window-119"); await page.waitForFunction(() => !__rogueBrowserTest.frame.ui.window && __rogueBrowserTest.queuePending === 0);
    let baseline = process.env.ROGUE_LAN_BASELINE || fileURLToPath(new URL("./output/inventory-actions/before/build/game.js", import.meta.url));
    evidence.historical_baseline = await access(baseline).then(() => true, () => false);
    if (!evidence.historical_baseline) baseline = fileURLToPath(new URL("../../build/game.js", import.meta.url));
    evidence.baseline = baseline;
    const original = await runGame(baseline, { seed: 17, name: "LAN勇者", locale: "ja", messagePaging: "log", text: "i .i wd" });
    const actual = await page.evaluate(() => __rogueBrowserTest.traces);
    assert.deepEqual(actual.map(t => ({ words: t.words, input_index: t.input_index })), original.traces.map(t => ({ words: t.words, input_index: t.input_index })));
    await shot("equipped-mobile");
  });
  await check("LAN throwing direction uses the ordinary touch pad over the visible map", async () => {
    await tap("touch-action-action.inventory"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.inventory);
    await tap("item-e"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.window.kind === "inventory_actions");
    await tap("window-116"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.movement_direction && __rogueBrowserTest.queuePending === 0);
    assert.equal((await state()).frame.ui.window, null);
    const player = (await state()).frame.player;
    await shot("throw-direction-mobile"); await tap("touch-k");
    await page.waitForFunction(() => !__rogueBrowserTest.frame.ui.window && !__rogueBrowserTest.frame.ui.movement_direction && __rogueBrowserTest.queuePending === 0);
    assert.deepEqual((await state()).frame.player, player);
    const original = await runGame(evidence.baseline, { seed: 17, name: "LAN勇者", locale: "ja", messagePaging: "log", text: "i .i wdi tke" });
    const actual = await page.evaluate(() => __rogueBrowserTest.traces);
    assert.deepEqual(actual.map(t => ({ words: t.words, input_index: t.input_index })), original.traces.map(t => ({ words: t.words, input_index: t.input_index })));
  });
  await check("Settings save to IndexedDB and Load restores the same LAN-origin C/RNG state", async () => {
    const before = await state(); await tap("settings-toggle"); await shot("settings-mobile");
    await tap("save"); await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending);
    const saved = await state(); assert.deepEqual(saved.words, before.words);
    await tap("settings-top"); await page.waitForFunction(() => __rogueBrowserTest.topOpen);
    await page.reload(); await page.waitForFunction(() => window.__rogueBrowserTest?.canvas?.paintCount > 0);
    await tap("load"); await settled();
    assert.deepEqual((await state()).words.slice(1, 16), saved.words.slice(1, 16));
    assert.equal((await state()).frame.map_cells, saved.frame.map_cells);
    await shot("loaded-mobile");
  });
  assert.deepEqual(evidence.errors, []);
  evidence.result = "pass";
} catch (error) {
  evidence.result = "fail"; evidence.failure = error.stack;
  if (page) {
    evidence.diagnostics = await page.evaluate(() => window.__rogueBrowserTest?.diagnostics).catch(() => null);
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  evidence.finished_at = new Date().toISOString();
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  await browser.close();
}

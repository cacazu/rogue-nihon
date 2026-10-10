import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { createPreviewServer } from "../../../tools/server.mjs";
import { runGame } from "../run-game.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const browserName = process.env.ROGUE_CHROME?.includes("Brave") ? "brave" : "chrome";
const output = artifactDirectory(path.join(root, "tests/browser-smoke/output/throw-direction", browserName));
await mkdir(output, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port + "/";
const worker = await readFile(path.join(root, "web/worker.js"), "utf8");
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };
let baseline = process.env.ROGUE_THROW_BASELINE || path.join(root, "tests/browser-smoke/output/throw-direction/before/build/game-fixtures.js");
const historical = await access(baseline).then(() => true, () => false);
if (!historical) baseline = path.join(root, "build/game-fixtures.js");
const evidence = { browser: browserName, baseline, historical, started_at: new Date().toISOString(), checks: [], comparisons: [], screenshots: [], errors: [] };
const directions = [["y", "Home"], ["k", "ArrowUp"], ["u", "PageUp"], ["h", "ArrowLeft"], ["l", "ArrowRight"], ["b", "End"], ["j", "ArrowDown"], ["n", "PageDown"]];
let browser, context, page;
async function draw() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function scene() { return page.evaluate(() => __rogueBrowserTest.canvas); }
async function state() { return page.evaluate(() => ({ input: __rogueBrowserTest.inputRequestCount, trace: __rogueBrowserTest.trace, traces: __rogueBrowserTest.traces, frame: __rogueBrowserTest.frame, messages: __rogueBrowserTest.messages })); }
async function click(id) {
  await page.waitForFunction(id => __rogueBrowserTest.canvas.controls.some(c => c.id === id && !c.disabled), id);
  const c = (await scene()).controls.find(c => c.id === id);
  if (await page.evaluate(() => matchMedia("(pointer:coarse)").matches)) await page.touchscreen.tap(c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2);
  else await page.mouse.click(c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2);
  await draw();
}
async function sent(fn) {
  const before = (await state()).input;
  await fn();
  await page.waitForFunction(n => __rogueBrowserTest.inputRequestCount > n && __rogueBrowserTest.queuePending === 0, before);
  await draw();
}
async function key(value) { await sent(() => page.keyboard.press(value)); }
async function field(id, value) { await click(id); await page.keyboard.press("Control+a"); await page.keyboard.insertText(value); await draw(); }
async function open({ mobile = false, before = false, lang = "ja" } = {}) {
  await context?.close();
  context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1240, height: 900 }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await context.route("**/web/worker.js", r => r.fulfill({ body: worker.replace('    module.FS.writeFile("/locale.txt",', '    module.FS.writeFile("/fixture.id", "inventory-all");\n    module.FS.writeFile("/locale.txt",'), contentType: "text/javascript", headers }));
  await context.route("**/build/game.js", r => r.fulfill({ path: before ? baseline : path.join(root, "build/game-fixtures.js"), contentType: "text/javascript", headers }));
  if (before) await context.route("**/build/game-fixtures.wasm", r => r.fulfill({ path: baseline.replace(/\.js$/, ".wasm"), contentType: "application/wasm", headers }));
  page = await context.newPage();await installBrowserTestAdapter(page); page.setDefaultTimeout(10000);
  page.on("pageerror", e => evidence.errors.push(e.message));
  await page.goto(base + "?trace=1&view=pixels&lang=" + lang);
  await page.waitForFunction(() => window.__rogueBrowserTest?.canvas.paintCount > 0);
  await field("name", "ThrowAudit"); await field("seed", "17"); await click("new-game");
  await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.queuePending === 0); await draw();
}
async function startThrow(menu) {
  if (menu) {
    if ((await scene()).controls.some(c => c.id === "touch-action-action.inventory")) await sent(() => click("touch-action-action.inventory"));
    else await key("i");
    await sent(() => click("item-e")); await sent(() => click("window-116"));
  } else await key("t");
}
async function aiming(mobile) {
  const s = await state(), canvas = await scene();
  assert.equal(s.frame.ui.input.kind, "direction"); assert.equal(s.frame.ui.movement_direction, true);
  assert.equal(s.frame.ui.window, null); assert.equal(canvas.regions.dialog, undefined); assert.equal(canvas.scope, "throw-direction");
  assert.ok(!canvas.controls.some(c => c.id.startsWith("window-")));
  if (mobile) {
    for (const [direction] of directions) assert.ok(canvas.controls.some(c => c.id === "touch-" + direction && !c.disabled));
    assert.ok(canvas.controls.some(c => c.id === "touch-action-action.cancel" && !c.disabled));
    for (const id of ["touch-.", "touch-action-action.inventory", "touch-action-action.help", "touch-action-action.descend", "touch-action-action.continue"]) assert.ok(!canvas.controls.some(c => c.id === id), id + " is absent while aiming");
  }
  return s;
}
async function idle() { await page.waitForFunction(() => !__rogueBrowserTest.frame.ui.window && !__rogueBrowserTest.frame.ui.movement_direction && __rogueBrowserTest.queuePending === 0); await draw(); }
async function reference(text, label) {
  const expected = await runGame(baseline, { fixture: "inventory-all", seed: 17, name: "ThrowAudit", locale: "ja", messagePaging: "log", text });
  const actual = await state();
  assert.deepEqual(actual.traces.map(t => ({ words: t.words, input_index: t.input_index })), expected.traces.map(t => ({ words: t.words, input_index: t.input_index })), label);
  assert.deepEqual(await page.evaluate(() => __rogueBrowserTest.translationFallbacks), []);
  assert.deepEqual(await page.evaluate(() => __rogueBrowserTest.uiMissing), []);
  evidence.comparisons.push({ label, text, checkpoints: expected.traces.length, words: actual.trace.words });
}
async function check(label, fn) { await fn(); evidence.checks.push(label); console.log("PASS " + label); }
async function shot(name) { await page.screenshot({ path: path.join(output, name + ".png") }); evidence.screenshots.push(name + ".png"); }
try {
  browser = await chromium.launch({ executablePath: process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--disable-gpu"] });
  for (const mobile of [true, false]) for (const menu of [true, false]) for (const [direction, physical] of directions) {
    await check((mobile ? "Touch pad" : "Movement key") + " / " + (menu ? "item menu" : "t command") + " / " + direction, async () => {
      await open({ mobile }); const before = await state();
      await startThrow(menu); await aiming(mobile);
      assert.equal((await state()).frame.map_cells, before.frame.map_cells);
      const player = (await state()).frame.player;
      if (mobile) await sent(() => click("touch-" + direction)); else await key(physical);
      if (!menu) { assert.equal((await state()).frame.ui.input.kind, "item"); await sent(() => click("item-e")); }
      await idle(); assert.deepEqual((await state()).frame.player, player, "aiming does not move the player");
      await reference((menu ? "i " : "") + "t" + direction + "e", "direction " + mobile + "/" + menu + "/" + direction);
    });
  }
  for (const modifier of ["", "Shift+", "Control+"]) for (const [direction, physical] of directions) {
    await check("Keyboard " + modifier + (modifier ? physical : direction) + " chooses one throwing direction", async () => {
      await open(); await startThrow(true); await aiming(false);
      await key(modifier + (modifier ? physical : direction)); await idle();
      await reference("i t" + direction + "e", modifier + (modifier ? physical : direction));
    });
  }
  for (const mobile of [true, false]) await check("Cancel aiming then move normally: " + (mobile ? "touch" : "keyboard"), async () => {
    await open({ mobile }); await startThrow(true); const before = await aiming(mobile);
    if (mobile) await sent(() => click("touch-action-action.cancel")); else await key("Escape");
    await idle(); assert.equal((await state()).trace.words[13], before.trace.words[13]);
    if (mobile) await sent(() => click("touch-j")); else await key("ArrowDown");
    await reference("i t\x1bj", "cancel then move " + mobile);
    assert.equal((await scene()).pointer.pressedId, "");
  });
  await check("Visible map, pad, fullscreen and resize leave C/RNG unchanged", async () => {
    await open({ mobile: true }); await startThrow(true); const before = await aiming(true);
    for (const size of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size); await draw(); await aiming(true); assert.deepEqual((await state()).trace, before.trace);
      await shot("aiming-mobile-" + size.width);
    }
    await click("header-fullscreen"); await page.waitForFunction(() => !!document.fullscreenElement); await draw(); await aiming(true);
    assert.deepEqual((await state()).trace, before.trace); await shot("aiming-mobile-fullscreen");
    await sent(() => click("touch-action-action.cancel")); await idle(); await reference("i t\x1b", "resize and fullscreen");
  });
  await check("Desktop English game uses normal diagonal movement input", async () => {
    await open({ lang: "en" }); await startThrow(true); await aiming(false); await shot("aiming-desktop-en");
    await key("PageUp"); await idle(); await reference("i tue", "English PageUp");
  });
  for (const before of historical ? [false, true] : [false]) await check((before ? "Previous" : "Current") + " save during aiming restores the target and ordinary input", async () => {
    await open({ mobile: true, before }); await startThrow(true);
    const saved = await state();
    if (before) { assert.ok(saved.frame.ui.window); assert.notEqual(saved.frame.ui.movement_direction, true); }
    await click("settings-toggle"); await click("save");
    await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending);
    await click("settings-top"); await page.waitForFunction(() => __rogueBrowserTest.topOpen);
    if (before) {
      await context.unroute("**/build/game.js"); await context.unroute("**/build/game-fixtures.wasm");
      await context.route("**/build/game.js", r => r.fulfill({ path: path.join(root, "build/game-fixtures.js"), contentType: "text/javascript", headers }));
    }
    await click("load"); await page.waitForFunction(() => __rogueBrowserTest.frame?.ui.movement_direction && __rogueBrowserTest.queuePending === 0); await draw();
    assert.deepEqual((await state()).trace, saved.trace); await aiming(true); await shot(before ? "legacy-save-aiming" : "restored-aiming");
    await sent(() => click("touch-k")); await idle(); await reference("i tke", "save restore " + before);
  });
  await check("Numeric counted throwing preserves the original direction/cancel repetition", async () => {
    await open(); await key("3"); await key("t");
    // Original C repeats the cancelled throw for each remaining count slot.
    for (let n = 1; n <= 3; n++) { await aiming(false); await key("Escape"); await reference("3t" + "\x1b".repeat(n), "counted throw cancel " + n); }
    await idle();
  });
  await check("Repeat after throwing follows the original C direction and target rules", async () => {
    await open(); await startThrow(true); await key("ArrowUp"); await idle(); await key("a"); await idle(); await reference("i tkea", "repeat throw");
  });
  await check("Staff and other direction commands retain their existing input windows", async () => {
    for (const command of ["z", "f", "F", "m", "^"]) {
      await open(); await key(command); assert.equal((await state()).frame.ui.movement_direction, false); assert.ok((await state()).frame.ui.window);
      await sent(() => click("window-27")); await idle(); await reference(command + "\x1b", "other command " + command);
    }
  });
  assert.deepEqual(evidence.errors, []);
  evidence.files = await Promise.all(["rust/crates/display/src/game_window.rs", "rust/crates/display/src/presentation.rs", "rust/crates/input/src/lib.rs", "rust/src/engine.rs", "logic/command.c", "web/canvas-ui.js", "build/game.js", "build/game.wasm", "build/game-fixtures.js", "build/game-fixtures.wasm"].map(async file => ({ file, sha256: createHash("sha256").update(await readFile(path.join(root, file))).digest("hex") })));
  evidence.result = "pass";
} catch (error) {
  evidence.result = "fail"; evidence.failure = error.stack;
  if (page) { evidence.state = await state().catch(() => null); await shot("failure").catch(() => {}); }
  throw error;
} finally {
  evidence.finished_at = new Date().toISOString();
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  await context?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve));
}

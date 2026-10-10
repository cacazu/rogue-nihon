import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../../web/server.mjs";
import { runGame } from "../run-game.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const browserName = process.env.ROGUE_CHROME?.includes("Brave") ? "brave" : "chrome";
const output = artifactDirectory(path.join(root, "tests/browser-smoke/output/touch-input", browserName));
await mkdir(output, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server = process.argv[2] ? null : createPreviewServer();
if (server) await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = process.argv[2] || "http://127.0.0.1:" + server.address().port + "/";
const browser = await chromium.launch({ executablePath: process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
const evidence = { url: base, browser: browserName, checks: [], errors: [], screenshots: [], started_at: new Date().toISOString() };
let context, page, cdp;
const intended = [];
try {
  context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const worker = await readFile(path.join(root, "web/worker.js"), "utf8");
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };
  await context.route("**/web/worker.js", route => route.fulfill({ body: worker.replace('    module.FS.writeFile("/locale.txt",', '    module.FS.writeFile("/fixture.id", "plain");\n    module.FS.writeFile("/locale.txt",'), contentType: "text/javascript", headers }));
  await context.route("**/build/game.js", route => route.fulfill({ path: path.join(root, "build/game-fixtures.js"), contentType: "text/javascript", headers }));
  page = await context.newPage();await installBrowserTestAdapter(page); page.setDefaultTimeout(15000);
  page.on("pageerror", error => evidence.errors.push(error.message));
  await page.goto(new URL("?trace=1&view=pixels&lang=ja", base).href);
  await page.waitForFunction(() => window.__rogueBrowserTest?.canvas?.paintCount > 0);
  cdp = await context.newCDPSession(page);
  await page.evaluate(() => {
    window.__pointerEvents = [];
    for (const type of ["pointerdown","pointerup","pointercancel","gotpointercapture","lostpointercapture"]) document.addEventListener(type, e => {
      __pointerEvents.push({type,id:e.pointerId,primary:e.isPrimary,buttons:e.buttons,x:e.clientX,y:e.clientY,capture:document.getElementById("rogue-canvas").hasPointerCapture(e.pointerId),active:__rogueBrowserTest.canvas.pointer.activeId});
    },true);
  });
  async function paint() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
  async function scene() { return page.evaluate(() => __rogueBrowserTest.canvas); }
  async function state() { return page.evaluate(() => ({ words: __rogueBrowserTest.trace.words, input: __rogueBrowserTest.inputRequestCount, pending: __rogueBrowserTest.queuePending, player: __rogueBrowserTest.frame.player, notice: __rogueBrowserTest.diagnostics.notice })); }
  async function point(id) { const c = (await scene()).controls.find(c => c.id === id && !c.disabled); assert.ok(c, id); return { x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h / 2 }; }
  async function tap(id) { const p = await point(id); await page.touchscreen.tap(p.x, p.y); await paint(); }
  async function readAfter(before, key) {
    await page.waitForFunction(n => __rogueBrowserTest.inputRequestCount > n && __rogueBrowserTest.queuePending === 0, before.input, { timeout: 5000 });
    intended.push(key); await paint();
    assert.equal((await state()).input, before.input + 1, "one completed tap publishes one C key");
  }
  async function touchKey(key) { const before = await state(); await tap("touch-" + key); await readAfter(before, key); }
  async function key(key, value) { const before = await state(); await page.keyboard.press(key); await readAfter(before, value); }
  async function dispatch(type, points = []) { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points }); await paint(); }
  async function idle() {
    const p = (await scene()).pointer;
    assert.deepEqual(p, { activeId: null, pressedId: "", hoverId: "", focusId: "" });
  }
  async function unchanged(before) { await paint(); assert.deepEqual(await state(), before); }
  async function patch(id) {
    return page.evaluate(id => {
      const c = __rogueBrowserTest.canvas.controls.find(c => c.id === id), r = Math.min(devicePixelRatio, 2);
      return Array.from(document.getElementById("rogue-canvas").getContext("2d").getImageData(Math.round((c.rect.x + 8) * r), Math.round((c.rect.y + 3) * r), Math.round((c.rect.w - 16) * r), Math.round(2 * r)).data);
    }, id);
  }
  async function shot(name) { await page.screenshot({ path: path.join(output, name + ".png") }); evidence.screenshots.push(name + ".png"); }
  async function check(label, fn) { await fn(); evidence.checks.push(label); console.log("PASS " + label); }
  for (const [id, value] of [["seed", "17"], ["name", "TouchAudit"]]) { await tap(id); await page.keyboard.press("Control+a"); await page.keyboard.insertText(value); }
  await tap("new-game"); await page.waitForFunction(() => __rogueBrowserTest.trace && __rogueBrowserTest.queuePending === 0);
  await shot("initial");
  await check("All nine touch directions and Wait release visually, publish exactly one key, and leave no sticky focus", async () => {
    for (const value of ["h", "l", "k", "j", "y", "n", "u", "b", "."]) {
      const pixels = await patch("touch-" + value); await touchKey(value); await idle();
      assert.deepEqual(await patch("touch-" + value), pixels, "released button pixels match their unpressed state");
    }
    await shot("released");
  });
  await check("Space and Enter after a touch do not repeat the previous movement", async () => {
    const before = await state(); await key("Space", " "); await key("Enter", "\r");
    assert.equal((await state()).words[13], before.words[13]); assert.deepEqual((await state()).player, before.player);
    await idle();
  });
  await check("Holding a direction has no autonomous repeat and releasing it sends one movement", async () => {
    const before = await state(), p = await point("touch-h");
    await dispatch("touchStart", [{ ...p, id: 1 }]);
    assert.equal((await scene()).pointer.pressedId, "touch-h");
    await page.waitForTimeout(750); await unchanged(before); await shot("held");
    await dispatch("touchEnd"); await readAfter(before, "h"); await idle(); await shot("hold-released");
  });
  await check("Sliding from a direction onto the map cancels the button without a map click or adjacent-cell error", async () => {
    const before = await state(), p = await point("touch-h"), r = (await scene()).mapRect, to = { x: r.x + r.w / 2, y: r.y + r.h / 3 };
    await dispatch("touchStart", [{ ...p, id: 1 }]);
    await dispatch("touchMove", [{ ...to, id: 1 }]); await dispatch("touchEnd");
    await idle(); await unchanged(before); await shot("slide-canceled");
  });
  await check("Browser touchCancel clears the held direction and sends no command", async () => {
    const before = await state(), p = await point("touch-b");
    await dispatch("touchStart", [{ ...p, id: 1 }]); await dispatch("touchCancel");
    await idle(); await unchanged(before);
  });
  await check("Native loss of pointer capture cancels a direction and ignores its later release", async () => {
    const before = await state(), p = await point("touch-h"); await dispatch("touchStart", [{ ...p, id: 1 }]);
    await page.evaluate(() => { const c = document.getElementById("rogue-canvas"), id = __rogueBrowserTest.canvas.pointer.activeId; if (!c.hasPointerCapture(id)) throw new Error("Expected real pointer capture"); c.releasePointerCapture(id); });
    await dispatch("touchMove", [{ ...p, id: 1 }]); await dispatch("touchEnd");
    await idle(); await unchanged(before);
  });
  await check("Two fingers cannot replace the active direction when the second finger releases first", async () => {
    const before = await state(), first = { ...await point("touch-h"), id: 1 }, second = { ...await point("touch-b"), id: 2 };
    await dispatch("touchStart", [first]); const active = (await scene()).pointer.activeId;
    await dispatch("touchStart", [first, second]); await dispatch("touchEnd", [second]);
    assert.equal((await scene()).pointer.activeId, active); assert.equal((await scene()).pointer.pressedId, "touch-h"); await unchanged(before);
    await dispatch("touchEnd"); await readAfter(before, "h"); await idle();
  });
  await check("Releasing the first of two fingers sends only its direction and ignores the remaining finger", async () => {
    const before = await state(), first = { ...await point("touch-l"), id: 1 }, second = { ...await point("touch-n"), id: 2 };
    await dispatch("touchStart", [first]); await dispatch("touchStart", [first, second]); await dispatch("touchEnd", [first]);
    await readAfter(before, "l"); const released = await state(); await dispatch("touchEnd"); await idle(); await unchanged(released); await shot("multitouch-released");
  });
  await check("Viewport changes cancel a held direction and fresh touches still work", async () => {
    const before = await state(), p = await point("touch-k"); await dispatch("touchStart", [{ ...p, id: 1 }]);
    await page.setViewportSize({ width: 412, height: 915 }); await paint(); await dispatch("touchEnd");
    await idle(); await unchanged(before); await touchKey("j");
  });
  await check("Leaving the browser tab cancels its held direction without a delayed input", async () => {
    const before = await state(), p = await point("touch-b"); await dispatch("touchStart", [{ ...p, id: 1 }]);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    const other = await context.newPage(); await other.bringToFront();
    assert.equal(await page.evaluate(() => document.hasFocus()), false);
    await page.waitForFunction(() => __rogueBrowserTest.canvas.pointer.activeId === null);
    await page.bringToFront(); await other.close(); await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }); await dispatch("touchEnd");
    await idle(); await unchanged(before);
  });
  await check("Opening an inventory while a finger is down cancels the old movement gesture", async () => {
    const before = await state(), p = await point("touch-h"); await dispatch("touchStart", [{ ...p, id: 1 }]); await key("i", "i");
    await page.waitForFunction(() => __rogueBrowserTest.frame.ui.mode === "menu"); await idle();
    const opened = await state(); await dispatch("touchEnd"); await unchanged(opened);
    await tap("window-32"); await readAfter(opened, " "); await idle();
    assert.deepEqual((await state()).player, before.player);
  });
  await check("Map drag still pans without a C command; tapping a neighboring cell moves once", async () => {
    const before = await state(), s = await scene(), p = { x: s.mapRect.x + 220, y: s.mapRect.y + 180 };
    await dispatch("touchStart", [{ ...p, id: 1 }]);
    await dispatch("touchMove", [{ x: p.x + 45, y: p.y + 35, id: 1 }]); await dispatch("touchEnd");
    assert.notEqual((await scene()).camera.left, s.camera.left); await idle(); await unchanged(before);
    await tap("settings-toggle"); await tap("center-map"); await tap("settings-close"); await idle();
    const next = await state(), c = (await scene()).camera, r = (await scene()).mapRect, x = next.player.x + 1, y = next.player.y;
    await page.touchscreen.tap(r.x + (x + .5) * c.size - c.left, r.y + (y - .5) * c.size - c.top); await readAfter(next, "l"); await idle();
    assert.deepEqual((await state()).player, { x, y }); await shot("final");
  });
  await check("The full touch sequence matches exactly the intended original C keys, including RNG and all inspected state words", async () => {
    const reference = await runGame(path.join(root, "build/game-fixtures.js"), { fixture: "plain", seed: 17, name: "TouchAudit", locale: "ja", messagePaging: "log", text: intended.join("") });
    const actual = await page.evaluate(() => __rogueBrowserTest.traces.map(t => t.words));
    assert.deepEqual(actual, reference.traces.map(t => t.words));
    evidence.acceptedKeys = intended; evidence.cCheckpoints = actual.length;
  });
  assert.deepEqual(evidence.errors, []);
  evidence.files = await Promise.all(["web/canvas-ui.js", "web/app.js", "build/game.js", "build/game.wasm"].map(async file => ({ file, sha256: createHash("sha256").update(await readFile(path.join(root, file))).digest("hex") })));
  evidence.result = "pass";
} catch (error) {
  evidence.result = "fail"; evidence.failure = error.stack;
  if (page) { evidence.scene = await page.evaluate(() => window.__rogueBrowserTest?.canvas).catch(() => null); evidence.events = await page.evaluate(() => window.__pointerEvents?.slice(-24)).catch(() => null); console.error(JSON.stringify(evidence.events)); await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {}); }
  throw error;
} finally {
  evidence.finished_at = new Date().toISOString(); await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  await cdp?.detach(); await context?.close(); await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}

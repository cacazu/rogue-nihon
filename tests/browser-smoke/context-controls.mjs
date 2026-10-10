import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createPreviewServer } from "../../web/server.mjs";
import { runGame } from "../run-game.mjs";
import { prepareBrowserRuntime } from "./browser-runtime.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const browserName = process.env.ROGUE_CHROME?.includes("Brave") ? "brave" : "chrome";
const output = artifactDirectory(path.join(root, "tests/browser-smoke/output/context-controls", browserName + (process.env.ROGUE_CONTEXT_FILTER ? "-focused" : "")));
await mkdir(output, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server = createPreviewServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port + "/";
const worker = await readFile(path.join(root, "web/worker.js"), "utf8");
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };
const baseline = path.join(root, "tests/browser-smoke/output/context-controls/before/build/game-fixtures.js");
const evidence = { started_at: new Date().toISOString(), browser: browserName, checks: [], comparisons: [], screenshots: [], transitions: [], errors: [] };
let browser, context, page, fixture, mobile, runtime;
const scene = () => page.evaluate(() => __rogueBrowserTest.canvas);
const state = () => page.evaluate(() => ({ trace: __rogueBrowserTest.trace, traces: __rogueBrowserTest.traces, frame: __rogueBrowserTest.frame, input: __rogueBrowserTest.inputRequestCount, exit: __rogueBrowserTest.diagnostics.exitCode }));
async function draw() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function invariant() {
  const s = await state(), c = await scene(), touch = c.controls.filter(c => c.id.startsWith("touch-"));
  if (!mobile || s.frame.ui.window || s.exit !== null) assert.equal(touch.length, 0);
  else if (s.frame.ui.movement_direction) {
    assert.deepEqual(touch.filter(c => c.id.startsWith("touch-action-")).map(c => c.id), ["touch-action-action.cancel"]);
    assert.equal(touch.filter(c => !c.id.startsWith("touch-action-")).length, 8);
    assert.ok(!touch.some(c => c.disabled || c.id === "touch-."));
  } else {
    const actions = ["touch-action-action.inventory", "touch-action-action.help"];
    if (s.frame.map_player_underlay?.tile === 6) actions.push("touch-action-action.descend");
    assert.deepEqual(touch.filter(c => c.id.startsWith("touch-action-")).map(c => c.id), actions);
    assert.equal(touch.filter(c => !c.id.startsWith("touch-action-")).length, 9);
  }
}
async function click(id) {
  for (let n = 0; n < 25; n++) {
    const s = await scene(), c = s.controls.find(c => c.id === id && !c.disabled);
    if (c) {
      if (mobile) await page.touchscreen.tap(c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2);
      else await page.mouse.click(c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2);
      await draw(); return;
    }
    const region = id.startsWith("item-") ? "dialog" : "settings", r = s.regions[region]?.rect;
    if (!r) { await page.waitForFunction(id => __rogueBrowserTest.canvas.controls.some(c => c.id === id && !c.disabled), id); continue; }
    await page.mouse.move(r.x + 30, r.y + 30); await page.mouse.wheel(0, 130); await draw();
  }
  throw Error("Missing control " + id);
}
async function field(id, value) { await click(id); await page.keyboard.press("Control+a"); await page.keyboard.insertText(value); await draw(); }
async function sent(action, label) {
  const before = await state(); await action();
  await page.waitForFunction(n => __rogueBrowserTest.queuePending === 0 && (__rogueBrowserTest.inputRequestCount > n || __rogueBrowserTest.diagnostics.exitCode !== null), before.input);
  await draw(); await invariant();
  const after = await state(); evidence.transitions.push({ fixture, mobile, action: label, from: before.frame.ui.input.kind, to: after.frame.ui.input.kind, window: after.frame.ui.window?.kind, turn: after.trace.words[13] });
}
async function key(value) { await sent(() => page.keyboard.press(value), value); }
async function tap(id) { await sent(() => click(id), id); }
async function action(code) { await tap("window-" + code); }
async function chars(text) { for (const c of text) { const k = c.charCodeAt(0); await key(k === 27 ? "Escape" : k === 13 ? "Enter" : k === 32 ? "Space" : k < 27 ? "Control+" + String.fromCharCode(k + 96) : c); } }
async function idle() { await page.waitForFunction(() => __rogueBrowserTest.frame.ui.input.kind === "command" && !__rogueBrowserTest.frame.ui.window && __rogueBrowserTest.queuePending === 0); await draw(); await invariant(); }
async function shot(name) { const file = (mobile ? "mobile-" : "pc-") + name + ".png"; await page.screenshot({ path: path.join(output, file) }); evidence.screenshots.push(file); }
async function check(label, run) { if (process.env.ROGUE_CONTEXT_FILTER && !new RegExp(process.env.ROGUE_CONTEXT_FILTER).test(label)) return; await run(); evidence.checks.push(label); console.log("PASS " + browserName + ": " + label); }
async function open(f = "inventory-all", phone = true) {
  await context?.close(); fixture = f; mobile = phone;
  context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1240, height: 900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1, acceptDownloads: true });
  await context.route("**/web/worker.js", r => r.fulfill({ body: worker.replace('    module.FS.writeFile("/locale.txt",', '    module.FS.writeFile("/fixture.id", ' + JSON.stringify(f) + ');\n    module.FS.writeFile("/locale.txt",'), contentType: "text/javascript", headers }));
  await context.route("**/build/game.js", r => r.fulfill({ path: path.join(root, "build/game-fixtures.js"), contentType: "text/javascript", headers }));
  page = await context.newPage();await installBrowserTestAdapter(page); page.setDefaultTimeout(20000); page.on("pageerror", e => evidence.errors.push(e.message));
  await page.goto(base + "?trace=1&lang=ja&view=pixels"); await page.waitForFunction(() => window.__rogueBrowserTest?.canvas?.paintCount > 0);
  await field("name", "ContextAudit"); await field("seed", "17"); await click("new-game");
  await page.waitForFunction(() => __rogueBrowserTest.trace && __rogueBrowserTest.queuePending === 0 && __rogueBrowserTest.inputRequestCount > 0); await draw(); await invariant();
}
async function reference(text, label) {
  const original = await runGame(baseline, { fixture, seed: 17, name: "ContextAudit", locale: "ja", messagePaging: "log", text });
  const actual = await state();
  assert.deepEqual(actual.traces.map(t => ({ words: t.words, input_index: t.input_index })), original.traces.map(t => ({ words: t.words, input_index: t.input_index })), label);
  if (actual.exit !== null) assert.equal(actual.exit, original.code);
  assert.deepEqual(await page.evaluate(() => __rogueBrowserTest.uiMissing), []); assert.deepEqual(await page.evaluate(() => __rogueBrowserTest.translationFallbacks), []);
  evidence.comparisons.push({ label, fixture, mobile, text, checkpoints: original.traces.length });
}
try {
  runtime = await prepareBrowserRuntime(root); evidence.runtime = runtime.diagnostics;
  browser = await chromium.launch({ executablePath: process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--disable-gpu"], downloadsPath: runtime.downloadsPath });
  await check("Map actions appear only where applicable; stairs disappear after leaving and descending", async () => {
    await open("plain"); await shot("normal-map"); await tap("touch-.");
    for (let n = 0; n < 5; n++) await tap("touch-l"); await shot("on-stairs");
    assert.ok((await scene()).controls.some(c => c.id === "touch-action-action.descend"));
    await tap("touch-h"); assert.ok(!(await scene()).controls.some(c => c.id === "touch-action-action.descend"));
    await tap("touch-l"); await tap("touch-action-action.inventory"); await action(32); await tap("touch-action-action.descend"); await idle();
    assert.equal((await state()).frame.map_player_underlay?.tile === 6, false); await shot("descended"); await reference(".lllllhli >", "stairs visibility and execution");
  });
  await check("Throwing offers only eight amber arrows and Cancel, then restores normal controls", async () => {
    await open(); await tap("touch-action-action.inventory"); await tap("item-e"); await action(116); await shot("throw-direction");
    await tap("touch-action-action.cancel"); await idle(); await shot("throw-cancelled");
    await tap("touch-action-action.inventory"); await tap("item-e"); await action(116); await tap("touch-k"); await idle();
    await reference("i t\x1bi tke", "throw menu cancel and execution");
  });
  await check("Drop is hidden on the observed stairs and returns after stepping onto the floor", async () => {
    await open("plain"); await chars("lllll"); await key("i"); await tap("item-a");
    assert.ok(!(await state()).frame.ui.window.actions.some(a => a.key === 100)); await shot("on-stairs-item-actions");
    await action(27); await action(32); await tap("touch-h"); await key("i"); await tap("item-a");
    assert.ok((await state()).frame.ui.window.actions.some(a => a.key === 100)); await action(27); await action(32); await idle();
    await reference("llllli hi ", "drop surface visibility");
  });
  await check("Fullscreen Escape cancels throwing before it acts as the ordinary map fullscreen shortcut", async () => {
    await open("inventory-all", false); await click("header-fullscreen"); await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await key("t"); assert.equal((await state()).frame.ui.movement_direction, true); await key("Escape"); await idle(); await reference("t\x1b", "fullscreen throw cancellation");
    await shot("fullscreen-throw-cancelled"); await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.fullscreenElement);
  });
  for (const phone of [true, false]) {
    for (const [command, item, setup = "", suffix = ""] of [["q", "f"], ["r", "g"], ["e", "a"], ["w", "d"], ["W", "k", "T"], ["P", "h", "", "l"], ["d", "f"], ["c", "c"], ["I", "c"]]) {
      await check((phone ? "Touch" : "PC") + " " + command + ": cancel, select, complete effect and return to map", async () => {
        await open("inventory-all", phone); await chars(setup); await key(command); assert.equal((await state()).frame.ui.input.kind, "item"); await shot("choice-" + command);
        await action(27); await idle(); await key(command); await tap("item-" + item);
        let text = setup + command + "\x1b" + command + item;
        if (suffix) { await action(suffix.charCodeAt(0)); text += suffix; }
        if (command === "c") { await field("prompt-text", "NamedItem"); await tap("submit-text"); text += "\x15NamedItem\r"; }
        await idle(); await reference(text, "item command " + command);
      });
    }
    for (const [command, direction, item, f] of [["t", "k", "e", "inventory-all"], ["z", "k", "j", "inventory-all"], ["m", "l", "", "plain"], ["f", "l", "", "combat"], ["F", "l", "", "combat"], ["^", "l", "", "plain"]]) {
      await check((phone ? "Touch" : "PC") + " " + command + ": cancel direction, choose direction, complete subsequent item/combat", async () => {
        await open(f, phone); await key(command);
        if (command === "t" && phone) await tap("touch-action-action.cancel"); else if (command === "t") await key("Escape"); else await action(27);
        await idle(); await key(command);
        if (command === "t" && phone) await tap("touch-" + direction); else if (command === "t") await key("ArrowUp"); else await action(direction.charCodeAt(0));
        if (item) { assert.equal((await state()).frame.ui.input.kind, "item"); await tap("item-" + item); }
        await idle(); await reference(command + "\x1b" + command + direction + item, "direction command " + command);
      });
    }
  }
  await check("Armor actions appear after removing the equipped armor and change back after equipping", async () => {
    await open(); await key("i"); await tap("item-k"); assert.ok(!(await state()).frame.ui.window.actions.some(a => a.key === 87)); await shot("armor-blocked");
    await action(27); await tap("item-b"); await action(84); await idle(); await key("i"); await tap("item-k");
    assert.ok((await state()).frame.ui.window.actions.some(a => a.key === 87)); await action(87); await idle(); await key("i"); await tap("item-k");
    assert.ok((await state()).frame.ui.window.actions.some(a => a.key === 84)); assert.ok(!(await state()).frame.ui.window.actions.some(a => a.key === 87));
    await action(27); await action(32); await idle(); await reference("i Ti Wki ", "armor slots");
  });
  await check("Item choices omit equipped weapons/rings, blocked armor and already-identified names; both ring removals complete", async () => {
    await open(); await key("w"); assert.ok(!(await scene()).controls.some(c => c.id === "item-c")); await action(27);
    await key("c"); for (const item of ["f", "g", "h", "i", "j"]) assert.ok(!(await scene()).controls.some(c => c.id === "item-" + item));
    assert.ok((await scene()).controls.some(c => c.id === "item-l")); await shot("name-candidates"); await action(27);
    await key("W"); assert.equal((await state()).frame.ui.lines.filter(l => l.selectable).length, 0); await action(27);
    await chars("PhlP"); assert.ok(!(await scene()).controls.some(c => c.id === "item-h")); await action(27);
    await chars("PiP"); assert.equal((await state()).frame.ui.lines.filter(l => l.selectable).length, 0); await action(27);
    await key("R"); await action(108); await key("R"); await idle(); await reference("w\x1bc\x1bW\x1bPhlP\x1bPiP\x1bRlR", "public item choices");
  });
  await check("Help opens, scrolls, closes; a single-command description and symbol identification finish", async () => {
    await open(); await tap("touch-action-action.help"); await action(42); await shot("help");
    const r = (await scene()).regions.dialog.rect; await page.mouse.move(r.x + 20, r.y + 20); await page.mouse.wheel(0, 300); await draw();
    await action(32); await idle(); await key("?"); await field("command-key", "q"); await tap("submit-text"); await idle();
    await key("/"); await action(27); await idle(); await key("/"); await field("command-key", "@"); await tap("submit-text"); await idle();
    await reference("?* ?q/\x1b/@", "help and identify");
  });
  for (const category of ["!", "?", "=", "/", "*"]) await check("Discovery " + category + ": select category, acknowledge every page, close", async () => {
    await open("space-discoveries"); await key("D"); await action(27); await idle(); await key("D");
    if (category === "*") await action(42); else { await field("command-key", category); await tap("submit-text"); }
    let text = "D\x1bD" + category, pages = 0;
    while ((await state()).frame.ui.input.kind === "space") { await shot("discovery-" + (category === "*" ? "all" : category.charCodeAt(0)) + "-" + pages); await action(32); text += " "; if (++pages > 10) throw Error("Discovery did not finish"); }
    assert.ok(pages > 0); await idle(); await reference(text, "discoveries " + category);
  });
  for (let row = 0; row < 6; row++) await check("Game setting " + row + ": true, back, false, back, keep, finish, close", async () => {
    await open(); await key("o"); await chars("\r".repeat(row)); await action(116); await action(45); await action(102); await action(45); await action(13); await action(27); await action(32); await idle();
    await reference("o" + "\r".repeat(row) + "t-f-\r\x1b ", "bool option " + row);
  });
  for (const style of ["o", "s", "c"]) await check("Inventory style " + style + ": choose, finish, open interactive inventory, inspect details, close", async () => {
    await open(); await key("o"); await chars("\r".repeat(6)); await action(style.charCodeAt(0)); await action(27); await action(32);
    await key("i"); await tap("item-a"); await action(118); await action(27); await action(27); await action(32); await idle();
    await reference("o" + "\r".repeat(6) + style + "\x1b i ", "inventory style " + style);
  });
  for (const [row, value] of [[7, "ChangedName"], [8, "ChangedFruit"], [9, "changed.sav"]]) await check("Text game setting " + row + ": edit, commit, finish and close", async () => {
    await open(); await key("o"); await chars("\r".repeat(7)); let prefix = "o" + "\r".repeat(7);
    if (row > 7) { await field("prompt-text", "ContextAudit"); await tap("submit-text"); prefix += "\x15ContextAudit\r"; }
    if (row > 8) { await field("prompt-text", ""); await tap("submit-text"); prefix += "\x15\r"; }
    await field("prompt-text", value); await tap("submit-text");
    if (row !== 9) await action(27); await action(32); await idle();
    await reference(prefix + "\x15" + value + "\r" + (row === 9 ? "" : "\x1b") + " ", "text option " + row);
  });
  await check("Naming cancellation discards the draft; item details and Back remain view-only", async () => {
    await open(); await chars("cc"); await field("prompt-text", "DiscardedName"); await action(27); await idle();
    await key("i"); const before = (await state()).trace; await tap("item-c"); await action(118); await shot("details");
    assert.doesNotMatch((await state()).frame.ui.lines.map(l => l.text).join("\n"), /DiscardedName/); await action(27); await action(27);
    assert.deepEqual((await state()).trace, before); await action(32); await idle(); await reference("cc\x1bi ", "cancel name");
  });
  await check("Identification scroll requires and applies its second item selection", async () => {
    await open("item-identify"); await chars("rf"); assert.equal((await state()).frame.ui.input.kind, "item"); await shot("identify-second-item"); await tap("item-c"); await idle(); await reference("rfc", "identify second item");
  });
  for (const [command, item] of [["q", "f"], ["r", "g"]]) await check("Detection " + command + ": select item, display detected map, close, finish effect", async () => {
    await open("space-detection"); await key(command); await tap("item-" + item); assert.equal((await state()).frame.ui.window.map_view, true); await shot("detection-" + command);
    await action(32); await idle(); assert.equal((await state()).trace.words[13], 1); await reference(command + item + " ", "detection " + command);
  });
  await check("Settings hides irrelevant zoom/download, saves, downloads, changes view, returns to top and loads", async () => {
    await open(); const before = (await state()).trace; await click("settings-toggle"); assert.ok(!(await scene()).controls.some(c => c.id === "download-save"));
    await click("view-ascii"); assert.ok(!(await scene()).controls.some(c => c.id === "tile-zoom")); await shot("ascii-settings");
    await click("view-pixels"); assert.ok((await scene()).controls.some(c => c.id === "tile-zoom")); await click("save"); await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending); await draw();
    const downloaded = page.waitForEvent("download"); await click("download-save"); const download = await downloaded;
    assert.equal(await download.failure(), null); await download.saveAs(path.join(output, "context-save.json"));
    const exported = await readFile(path.join(output, "context-save.json")); assert.equal(JSON.parse(exported).version, 2);
    assert.equal(exported.length, await page.evaluate(() => __rogueBrowserTest.savedLength));
    await click("center-map"); await click("fullscreen"); await page.waitForFunction(() => Boolean(document.fullscreenElement)); await draw(); await shot("fullscreen-settings");
    await click("settings-top"); await page.waitForFunction(() => __rogueBrowserTest.topOpen); await click("load"); await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.queuePending === 0); await draw();
    assert.deepEqual((await state()).trace.words.slice(1, 16), before.words.slice(1, 16)); await invariant(); await tap("touch-."); await idle(); await shot("loaded-fullscreen");
  });
  for (const f of ["ending-death", "ending-no-tomb", "ending-victory"]) await check(f + ": complete every result/score acknowledgement and return to top", async () => {
    await open(f); let text = "";
    while ((await state()).exit === null) { const kind = (await state()).frame.ui.input.kind; assert.ok(["space", "enter"].includes(kind)); await shot(f + "-" + text.length); await action(kind === "space" ? 32 : 13); text += kind === "space" ? " " : "\r"; if (text.length > 6) throw Error("Ending did not finish"); }
    await reference(text, f); await click("result-top"); await page.waitForFunction(() => __rogueBrowserTest.topOpen); assert.ok(!(await scene()).controls.some(c => c.id.startsWith("touch-")));
  });
  await check("Quit No returns to play; Quit Yes completes scores and returns to top", async () => {
    await open(); await key("Q"); await action(110); await idle(); await tap("touch-."); await key("Q"); await action(121); let text = "Qn.Qy";
    while ((await state()).exit === null) { assert.equal((await state()).frame.ui.input.kind, "enter"); await action(13); text += "\r"; if (text.length > 10) throw Error("Quit did not finish"); }
    await reference(text, "quit both choices"); await click("result-top"); await page.waitForFunction(() => __rogueBrowserTest.topOpen);
  });
  assert.deepEqual(evidence.errors, []);
  evidence.files = await Promise.all(["rust/crates/display/src/game_window.rs", "rust/crates/input/src/inventory.rs", "rust/crates/display/src/inventory.rs", "rust/src/engine.rs", "rust/crates/display/src/presentation.rs", "logic/pack.c", "web/app.js", "web/canvas-ui.js", "build/game.js", "build/game.wasm", "build/game-fixtures.js", "build/game-fixtures.wasm"].map(async file => ({ file, sha256: createHash("sha256").update(await readFile(path.join(root, file))).digest("hex") })));
  evidence.result = "pass";
} catch (error) { evidence.result = "fail"; evidence.failure = error.stack; if (page) { evidence.state = await state().catch(() => null); evidence.scene = await scene().catch(() => null); await shot("failure").catch(() => {}); } throw error;
} finally { evidence.finished_at = new Date().toISOString(); await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n"); await context?.close(); await browser?.close(); await runtime?.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

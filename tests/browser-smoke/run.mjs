import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../../web/server.mjs";
import { prepareJapanese, japaneseScenarios } from "./ja-scenarios.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const jaScenario = process.env.ROGUE_JA_SCENARIO === "1";
const output = path.join(directory, jaScenario ? (process.env.ROGUE_VIEW === "pixels" ? "../pixel-output/japanese" : "output-ja") : "output");
const chrome = process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let readBrowserDiagnostics = null;
async function until(callback, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await callback(); if (result) return result;
    if (readBrowserDiagnostics) {
      const diagnostics = await readBrowserDiagnostics();
      if (diagnostics?.runtimeError || diagnostics?.exitCode < 0) throw new Error("Browser failure while " + label + ": " + JSON.stringify(diagnostics));
    }
    await delay(100);
  }
  throw new Error("Timed out: " + label);
}
class CDP {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.events = []; socket.addEventListener("message", (event) => { const packet = JSON.parse(event.data); if (packet.id) { const pending = this.pending.get(packet.id); if (pending) { this.pending.delete(packet.id); clearTimeout(pending.timer); packet.error ? pending.reject(new Error(JSON.stringify(packet.error))) : pending.resolve(packet.result); } } else this.events.push(packet); }); }
  call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.id; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 30000); this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const value = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails)); return value.result.value; }
}

await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "rogue-browser-smoke-"));
const server = createPreviewServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const processHandle = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let chromeErrors = ""; processHandle.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });
let socket = null, cdp = null;
const evidence = { started_at: new Date().toISOString(), checks: [], base };
try {
  const buildDirectory = path.resolve(directory, "../../build");
  evidence.build = JSON.parse(await readFile(path.join(buildDirectory, "build-manifest.json"), "utf8"));
  evidence.actual_build_files = await Promise.all(["game.js", "game.wasm"].map(async (file) => {
    const bytes = await readFile(path.join(buildDirectory, file));
    return { file, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
  }));
  const debugPort = await until(async () => { try { return Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { return false; } }, "Chrome debug port");
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  cdp = new CDP(socket);
  await cdp.call("Runtime.enable"); await cdp.call("Page.enable");
  readBrowserDiagnostics = () => cdp.evaluate("window.__rogueBrowserTest ? __rogueBrowserTest.diagnostics : null");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1240, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.call("Page.navigate", { url: base + "?trace=1" + (process.env.ROGUE_VIEW ? "&view=" + encodeURIComponent(process.env.ROGUE_VIEW) : "") });
  await until(() => cdp.evaluate("Boolean(window.__rogueBrowserTest)"), "browser host loaded");
  assert.equal(await cdp.evaluate("crossOriginIsolated && typeof SharedArrayBuffer === 'function'"), true);
  evidence.checks.push("COOP/COEP enable cross-origin isolated SharedArrayBuffer");
  if (jaScenario) await prepareJapanese(cdp, evidence);
  await cdp.evaluate("document.getElementById('seed').value='12345';document.getElementById('new-game').click();");
  await until(() => cdp.evaluate("window.__rogueBrowserTest.frame && window.__rogueBrowserTest.trace"), "real C/Rust/Wasm frame and trace");
  const initial = await cdp.evaluate("({trace:__rogueBrowserTest.trace,frame:__rogueBrowserTest.frame,frameCount:__rogueBrowserTest.frameCount})");
  assert.equal(initial.trace.words.length, 20); assert.match(initial.frame.cells, /@/);
  evidence.initial = initial; evidence.checks.push("Compiled game emits a visible player and 20-word logical state trace");
  const redrawResult = await cdp.evaluate("(()=>{const before=JSON.stringify(__rogueBrowserTest.trace);for(let i=0;i<50;i++)__rogueBrowserTest.redraw();return {same:before===JSON.stringify(__rogueBrowserTest.trace),pending:__rogueBrowserTest.queuePending};})()");
  assert.equal(redrawResult.same, true); assert.equal(redrawResult.pending, 0);
  evidence.checks.push("50 Canvas redraws enqueue no input and leave logic trace unchanged");
  const inputBefore = await cdp.evaluate("__rogueBrowserTest.inputRequestCount");
  await cdp.evaluate("document.getElementById('name').focus();document.getElementById('name').dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));document.dispatchEvent(new CompositionEvent('compositionstart'));document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true,isComposing:true}));document.dispatchEvent(new CompositionEvent('compositionend'));");
  await delay(150);
  assert.equal(await cdp.evaluate("__rogueBrowserTest.inputRequestCount"), inputBefore);
  evidence.checks.push("Text field and IME composition do not send game commands");
  await cdp.evaluate("document.getElementById('board').focus();__rogueBrowserTest.enqueue('.'.codePointAt(0));");
  await until(() => cdp.evaluate(`__rogueBrowserTest.inputRequestCount > ${inputBefore}`), "wait command processed");
  evidence.after_wait = await cdp.evaluate("__rogueBrowserTest.trace");
  const beforeInventory = await cdp.evaluate("__rogueBrowserTest.inputRequestCount");
  await cdp.evaluate("document.querySelector('[data-character=\"i\"]').click();");
  await until(() => cdp.evaluate("__rogueBrowserTest.inputRequestCount > " + beforeInventory), "inventory prompt");
  const inventoryFrame = await cdp.evaluate("__rogueBrowserTest.frame");
  assert.match(inventoryFrame.cells, /food|ration|armor|mail/);
  evidence.inventory = inventoryFrame; evidence.checks.push("Inventory button enters the original item-list prompt");
  await cdp.evaluate("document.getElementById('save').click();");
  await until(() => cdp.evaluate("__rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending"), "IndexedDB transaction completed");
  evidence.save_length = await cdp.evaluate("__rogueBrowserTest.savedLength"); evidence.checks.push("Save envelope reaches IndexedDB and UI acknowledges transaction completion");
  const saveTrace = await cdp.evaluate("__rogueBrowserTest.trace");
  const saveGeneration = await cdp.evaluate("__rogueBrowserTest.generation");
  await cdp.evaluate("document.getElementById('load').click();");
  await until(() => cdp.evaluate("__rogueBrowserTest.generation > " + saveGeneration + " && __rogueBrowserTest.frame && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0"), "fresh Worker restore");
  const restored = await cdp.evaluate("__rogueBrowserTest.trace");
  assert.deepEqual(restored.words, saveTrace.words);
  const restoredFrame = await cdp.evaluate("__rogueBrowserTest.frame");
  assert.equal(restoredFrame.cells, inventoryFrame.cells);
  evidence.restored = restored; evidence.checks.push("New Worker restores the saved logical trace exactly");
  evidence.checks.push("Restore also reconstructs the pending inventory prompt view");
  const beforeContinue = await cdp.evaluate("__rogueBrowserTest.inputRequestCount");
  await cdp.evaluate("document.querySelector('[data-character=\" \"]').click();");
  await until(() => cdp.evaluate("__rogueBrowserTest.inputRequestCount > " + beforeContinue), "inventory acknowledgement");
  if (jaScenario) await japaneseScenarios(cdp, until, evidence, output);
  const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(path.join(output, "browser.png"), Buffer.from(screenshot.data, "base64"));
  const browserExceptions = cdp.events.filter((event) => event.method === "Runtime.exceptionThrown");
  assert.deepEqual(browserExceptions, []);
  evidence.checks.push("No main-browser Runtime exceptions"); evidence.finished_at = new Date().toISOString(); evidence.status = "passed";
  evidence.browser = await readBrowserDiagnostics();
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", checks: evidence.checks, evidence: path.join(output, "evidence.json"), screenshot: path.join(output, "browser.png") }, null, 2));
} catch (error) {
  evidence.status = "failed"; evidence.error = error.stack || String(error); evidence.chrome_stderr = chromeErrors;
  if (cdp) {
    try { evidence.browser = await readBrowserDiagnostics?.(); } catch (diagnosticError) { evidence.diagnostic_error = diagnosticError.message; }
    evidence.browser_events = cdp.events.filter((event) => ["Runtime.exceptionThrown", "Runtime.consoleAPICalled"].includes(event.method)).slice(-32);
  }
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n"); throw error;
} finally {
  if (socket) socket.close(); processHandle.kill(); await new Promise((resolve) => server.close(resolve));
}

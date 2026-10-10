import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {cp, mkdir, mkdtemp, readFile, readdir, writeFile} from "node:fs/promises";
import {once} from "node:events";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {artifactDirectory} from "../../tools/temporary-artifacts.mjs";
import {prepareBrowserRuntime} from "./browser-runtime.mjs";
import {installBrowserTestAdapter} from "./test-adapter.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const previewServer = fileURLToPath(new URL("../../../tools/server.mjs", import.meta.url));
const output = artifactDirectory(path.join(root, "tests/browser-smoke/output/production-boundary"));
await mkdir(output, {recursive: true});
const {chromium} = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE ||
  path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const evidence = {started_at: new Date().toISOString(), checks: [], errors: [], screenshots: []};
let runtime, browser, child, context, serverPid;

async function copyRuntime(destination) {
  await mkdir(path.join(destination, "web"), {recursive: true});
  await mkdir(path.join(destination, "build"));
  for (const file of await readdir(path.join(root, "web"))) {
    if (/\.(?:m?js|css|html)$/.test(file)) await cp(path.join(root, "web", file), path.join(destination, "web", file));
  }
  for (const set of ["tiles", "pixels-v2"]) {
    const assetPath = path.join("web/assets", set);
    await mkdir(path.join(destination, assetPath), {recursive: true});
    for (const file of await readdir(path.join(root, assetPath))) {
      if (/\.(?:png|json)$/.test(file)) await cp(path.join(root, assetPath, file), path.join(destination, assetPath, file));
    }
  }
  for (const file of ["game.js", "game.wasm", "browser-ui.wasm", "build-manifest.json"])
    await cp(path.join(root, "build", file), path.join(destination, "build", file));
  await cp(path.join(root, "start.ps1"), path.join(destination, "start.ps1"));
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function start(destination, launcher) {
  const args = launcher === "node" ? [previewServer, "--root", destination, "0"] :
    ["-NoProfile", "-File", path.join(destination, "start.ps1"), "-PreviewServer", previewServer, "-Port", String(await unusedPort())];
  const environment = {...process.env, ROGUE_KEEP_ARTIFACTS: "0"};
  for (const name of ["ROGUE_PORT", "ROGUE_HOST", "ROGUE_TLS_CERT", "ROGUE_TLS_KEY"]) delete environment[name];
  // Observe the Node grandchild PID without querying unrelated OS processes.
  // This observer lives in the test output, outside the deployed runtime files.
  if (launcher !== "node") {
    const observer = path.join(output, "server-process.cjs");
    await writeFile(observer, 'process.stdout.write("TEST_SERVER_PID=" + process.pid + "\\n");');
    environment.NODE_OPTIONS = '--require "' + observer.replaceAll("\\", "/") + '"';
  }
  child = spawn(launcher === "node" ? process.execPath : "pwsh", args,
    {cwd: destination, env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
  serverPid = launcher === "node" ? child.pid : null;
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    const timer = setTimeout(() => reject(Error("Server startup timeout: " + stderr + stdout)), 15000);
    child.stderr.on("data", data => {stderr += data;});
    child.stdout.on("data", data => {
      stdout += data;
      const pid = stdout.match(/TEST_SERVER_PID=(\d+)/);
      if (pid) serverPid = Number(pid[1]);
      const match = stdout.match(/Rogue preview: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
    child.once("error", error => {clearTimeout(timer); reject(error);});
    child.once("exit", code => {clearTimeout(timer); reject(Error("Server exited " + code + ": " + stderr));});
  });
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  if (serverPid && serverPid !== child.pid) process.kill(serverPid);
  else child.kill();
  await closed;
}

async function check(label, run) {await run(); evidence.checks.push(label); console.log("PASS " + label);}
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function click(page, id, touch) {
  await page.waitForFunction(id => __rogueBrowserTest.canvas?.controls.some(control => control.id === id && !control.disabled), id);
  const rect = await page.evaluate(id => __rogueBrowserTest.canvas.controls.find(control => control.id === id).rect, id);
  if (touch) await page.touchscreen.tap(rect.x + rect.w/2, rect.y + rect.h/2);
  else await page.mouse.click(rect.x + rect.w/2, rect.y + rect.h/2);
  await paint(page);
}

try {
  runtime = await prepareBrowserRuntime(root);
  browser = await chromium.launch({executablePath: process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true, args: ["--disable-gpu"], downloadsPath: runtime.downloadsPath});
  evidence.browser = browser.version();
  for (const [label, launcher, poison, touch] of [["missing-tools", "node", false, false], ["broken-tools", "powershell", true, true]]) {
    const destination = await mkdtemp(path.join(output, label + "-"));
    await copyRuntime(destination);
    const sentinel = path.join(destination, ".local/tasks/node-interrupted/partial.wasm");
    await mkdir(path.dirname(sentinel), {recursive: true});
    await writeFile(sentinel, "untouched interrupted build");
    await writeFile(path.join(path.dirname(sentinel), ".rogue-owner.json"), "{invalid recovery metadata");
    if (poison) {
      await mkdir(path.join(destination, "tools"));
      await writeFile(path.join(destination, "tools/temporary-artifacts.mjs"), 'throw Error("Recovery must never be imported by production");');
      await writeFile(path.join(destination, "tools/artifact-registry.ps1"), 'throw "Recovery must never be invoked by production"');
    }
    const base = await start(destination, launcher);
    context = await browser.newContext({viewport: touch ? {width: 390, height: 844} : {width: 1240, height: 900},
      isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, acceptDownloads: true});
    let page = await context.newPage();
    page.on("pageerror", error => evidence.errors.push(error.message));
    await check(label + " external preview tool renders runtime with no test adapter or development files", async () => {
      assert.ok(!(await readdir(path.join(destination, "web"))).includes("server.mjs"));
      await page.goto(base);
      await page.waitForFunction(() => document.getElementById("rogue-canvas").width > 300);
      assert.equal(await page.evaluate(() => "__rogueBrowserTest" in window), false);
      assert.equal(await page.evaluate(() => "active" in RogueCanvasUi), false);
      assert.equal((await context.request.get(base + "web/server.mjs")).status(), 404);
      assert.equal((await context.request.get(base + "tools/server.mjs")).status(), 403);
      await page.screenshot({path: path.join(output, label + "-top.png")});
      evidence.screenshots.push(label + "-top.png");
    });
    await page.close();
    page = await context.newPage();
    await installBrowserTestAdapter(page);
    page.on("pageerror", error => evidence.errors.push(error.message));
    const requests = [];
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    await page.goto(base + "?trace=1&lang=ja&view=pixels");
    await page.waitForFunction(() => __rogueBrowserTest.canvas?.paintCount > 0);
    await check(label + " starts the production game and advances a turn", async () => {
      for (const [id, value] of [["name", "独立確認勇者"], ["seed", "17"]]) {
        await click(page, id, touch);
        await page.keyboard.press("Control+a"); await page.keyboard.insertText(value);
      }
      await click(page, "new-game", touch);
      await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.queuePending === 0);
      const turn = await page.evaluate(() => __rogueBrowserTest.trace.words[13]);
      await page.keyboard.press(".");
      await page.waitForFunction(turn => __rogueBrowserTest.trace.words[13] === turn + 1, turn);
    });
    await check(label + " inventory, settings, save and actual export work without recovery", async () => {
      await page.keyboard.press("i"); await page.waitForFunction(() => __rogueBrowserTest.frame.ui.window);
      await click(page, "settings-toggle", touch); await click(page, "view-tiles", touch);
      await click(page, "save", touch);
      await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending);
      const pending = page.waitForEvent("download"); await click(page, "download-save", touch);
      const download = await pending; assert.equal(await download.failure(), null);
      const file = path.join(output, label + "-save.json"); await download.saveAs(file);
      const bytes = await readFile(file);
      const stored = await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open("original-rogue-web", 1); request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, transaction = db.transaction("saves", "readonly"), save = transaction.objectStore("saves").get("manual");
          transaction.oncomplete = () => {db.close(); resolve(Array.from(new Uint8Array(save.result)));};
          transaction.onerror = () => reject(transaction.error);
        };
      }));
      assert.deepEqual(bytes, Buffer.from(stored));
      await page.screenshot({path: path.join(output, label + "-settings.png")});
      evidence.screenshots.push(label + "-settings.png");
    });
    await check(label + " reload restores into a new Worker and resumes play", async () => {
      await page.reload(); await click(page, "load", touch);
      await page.waitForFunction(() => __rogueBrowserTest.frame?.ui.window && __rogueBrowserTest.queuePending === 0);
      await page.keyboard.press("Space");
      await page.waitForFunction(() => __rogueBrowserTest.frame.ui.input.kind === "command" && !__rogueBrowserTest.frame.ui.window);
      const turn = await page.evaluate(() => __rogueBrowserTest.trace.words[13]);
      await page.keyboard.press(".");
      await page.waitForFunction(turn => __rogueBrowserTest.trace.words[13] === turn + 1, turn);
    });
    await check(label + " runtime requests and interrupted files stay independent", async () => {
      assert.ok(requests.every(request => !/\/(?:tests|tools)\/|fixture|artifact/.test(request)));
      assert.equal(await readFile(sentinel, "utf8"), "untouched interrupted build");
      assert.deepEqual(evidence.errors, []);
    });
    await context.close(); context = null; await stop(); child = null;
  }
  evidence.finished_at = new Date().toISOString();
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
} finally {
  await context?.close(); await browser?.close(); await stop(); await runtime?.dispose();
}

import assert from "node:assert/strict";
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {once} from "node:events";
import {createRequire} from "node:module";
import {cp, mkdir, mkdtemp, writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createPreviewServer} from "../../../tools/server.mjs";
import {artifactDirectory} from "../../tools/temporary-artifacts.mjs";
import {prepareBrowserRuntime} from "./browser-runtime.mjs";
import {installBrowserTestAdapter} from "./test-adapter.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const previewServer = fileURLToPath(new URL("../../../tools/server.mjs", import.meta.url));
const output = artifactDirectory(path.join(root, "tests/browser-smoke/output/startup"));
await mkdir(output, {recursive: true});
const {chromium} = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE ||
  path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const evidence = {started_at: new Date().toISOString(), checks: [], errors: [], screenshots: []};
const children = new Set(), servers = new Set();
let browser, runtime;

function launch(args, powershell = false) {
  const environment = {...process.env};
  for (const name of ["ROGUE_PORT", "ROGUE_HOST", "ROGUE_TLS_CERT", "ROGUE_TLS_KEY", "NODE_OPTIONS"]) delete environment[name];
  const child = spawn(powershell ? "pwsh" : process.execPath, args,
    {cwd: root, env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
  children.add(child);
  const result = {child, stdout: "", stderr: ""};
  child.stdout.on("data", data => {result.stdout += data;});
  child.stderr.on("data", data => {result.stderr += data;});
  result.closed = once(child, "close").then(([code]) => {children.delete(child); return {...result, code};});
  return result;
}

async function ready(result) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const match = result.stdout.match(/Rogue preview: (https?:\/\/127\.0\.0\.1:\d+\/)/);
    if (match) return match[1];
    if (result.child.exitCode !== null) throw Error("Startup failed: " + result.stderr + result.stdout);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error("Startup timeout: " + result.stderr + result.stdout);
}

async function completed(result) {
  let timer;
  try {
    return await Promise.race([result.closed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Launcher failed to exit: " + result.stderr + result.stdout)), 10000);
    })]);
  } finally {clearTimeout(timer);}
}

async function listen(server) {
  servers.add(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
async function check(label, run) {await run(); evidence.checks.push(label); console.log("PASS " + label);}
const powershell = port => ["-NoProfile", "-File", path.join(root, "start.ps1"), "-Port", String(port)];
async function click(page, id, touch = false) {
  await page.waitForFunction(id => __rogueBrowserTest.canvas?.controls.some(control => control.id === id && !control.disabled), id);
  const rect = await page.evaluate(id => __rogueBrowserTest.canvas.controls.find(control => control.id === id).rect, id);
  if (touch) await page.touchscreen.tap(rect.x + rect.w/2, rect.y + rect.h/2);
  else await page.mouse.click(rect.x + rect.w/2, rect.y + rect.h/2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

try {
  const first = launch([previewServer, "--root", root, "0"]);
  const base = await ready(first), port = Number(new URL(base).port);
  await check("fresh Node launcher serves the real game with isolation headers", async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cross-origin-embedder-policy"), "require-corp");
    assert.match(response.headers.get("x-rogue-preview"), /^[a-f0-9]{64}$/);
  });
  await check("repeated start.ps1 succeeds and keeps the same server and origin", async () => {
    const second = await completed(launch(powershell(port), true));
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /既に起動/);
    assert.ok(second.stdout.includes("Rogue preview: " + base));
    assert.equal(first.child.exitCode, null);
  });
  const foreign = http.createServer((_, response) => response.end("another application"));
  const foreignPort = await listen(foreign);
  await check("unrelated occupied port reports an actionable error without stopping its owner", async () => {
    const result = await completed(launch(powershell(foreignPort), true));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /別のサーバーが使用/);
    assert.ok(result.stderr.includes(".\\start.ps1 -Port " + (foreignPort + 1)));
    assert.doesNotMatch(result.stdout + result.stderr, /Preview stopped with an error|EADDRINUSE|Exception:/);
    assert.equal(await (await fetch(`http://127.0.0.1:${foreignPort}/`)).text(), "another application");
  });
  const stalled = http.createServer(() => {}), stalledPort = await listen(stalled);
  await check("unresponsive port owner cannot stall startup indefinitely", async () => {
    const started = Date.now();
    const result = await completed(launch([previewServer, "--root", root, String(stalledPort)]));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /別のサーバーが使用/);
    assert.ok(Date.now() - started < 5000);
  });
  const otherRoot = await mkdtemp(path.join(output, "other-project-"));
  await mkdir(path.join(otherRoot, "web"));
  await cp(path.join(root, "web/index.html"), path.join(otherRoot, "web/index.html"));
  const otherPort = await listen(createPreviewServer({root: otherRoot}));
  await check("another Rogue folder is not reused even with the same title and isolation headers", async () => {
    const result = await completed(launch(powershell(otherPort), true));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /別のサーバーが使用/);
  });
  const legacy = createPreviewServer();
  legacy.on("request", (_, response) => response.removeHeader("X-Rogue-Preview"));
  const legacyPort = await listen(legacy);
  await check("an already running older server is verified from matching production files", async () => {
    const result = await completed(launch(powershell(legacyPort), true));
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /既に起動/);
  });
  await cp(path.join(root, "web/worker.js"), path.join(otherRoot, "web/worker.js"));
  await mkdir(path.join(otherRoot, "build"));
  await writeFile(path.join(otherRoot, "build/build-manifest.json"), "different build");
  const mismatch = createPreviewServer({root: otherRoot});
  mismatch.on("request", (_, response) => response.removeHeader("X-Rogue-Preview"));
  const mismatchPort = await listen(mismatch);
  await check("legacy detection rejects different build contents", async () => {
    const result = await completed(launch(powershell(mismatchPort), true));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /別のサーバーが使用/);
  });
  runtime = await prepareBrowserRuntime(root);
  browser = await chromium.launch({executablePath: process.env.ROGUE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true, args: ["--disable-gpu"], downloadsPath: runtime.downloadsPath});
  evidence.browser = browser.version();
  await check("HTTPS launcher also reuses its certificate and renders an isolated browser page", async () => {
    const certificate = path.join(output, "localhost-cert.pem"), key = path.join(output, "localhost-key.pem");
    const openssl = process.env.ROGUE_OPENSSL || (process.platform === "win32" ? path.join(process.env.ProgramFiles, "Git/mingw64/bin/openssl.exe") : "openssl");
    execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-keyout", key,
      "-out", certificate, "-subj", "/CN=Rogue startup", "-addext", "subjectAltName=IP:127.0.0.1"], {windowsHide: true, stdio: "ignore"});
    const secure = launch([previewServer, "--root", root, "0", "127.0.0.1", certificate, key]);
    const secureBase = await ready(secure), securePort = new URL(secureBase).port;
    const duplicate = await completed(launch([previewServer, "--root", root, securePort, "127.0.0.1", certificate, key]));
    assert.equal(duplicate.code, 0, duplicate.stderr);
    assert.ok(duplicate.stdout.includes(secureBase));
    const context = await browser.newContext({ignoreHTTPSErrors: true});
    try {
      const page = await context.newPage();
      page.on("pageerror", error => evidence.errors.push(error.message));
      await page.goto(secureBase);
      await page.waitForFunction(() => document.getElementById("rogue-canvas").width > 300);
      assert.equal(await page.evaluate(() => crossOriginIsolated), true);
      assert.equal(await page.evaluate(() => "__rogueBrowserTest" in window), false);
    } finally {await context.close();}
  });
  for (const touch of [false, true]) {
    const label = touch ? "mobile" : "PC";
    const context = await browser.newContext({viewport: touch ? {width: 390, height: 844} : {width: 1240, height: 900},
      isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, acceptDownloads: true});
    try {
      const page = await context.newPage();
      await installBrowserTestAdapter(page);
      page.on("pageerror", error => evidence.errors.push(error.message));
      await page.goto(base + "?trace=1&lang=ja&view=pixels");
      await check(label + " reused origin starts the game and advances a turn", async () => {
        for (const [id, value] of [["name", "起動確認勇者"], ["seed", "17"]]) {
          await click(page, id, touch); await page.keyboard.press("Control+a"); await page.keyboard.insertText(value);
        }
        await click(page, "new-game", touch);
        await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.queuePending === 0);
        const turn = await page.evaluate(() => __rogueBrowserTest.trace.words[13]);
        await page.keyboard.press(".");
        await page.waitForFunction(turn => __rogueBrowserTest.trace.words[13] === turn + 1, turn);
        const image = label + "-game.png";
        await page.screenshot({path: path.join(output, image)}); evidence.screenshots.push(image);
      });
      await check(label + " repeated launcher preserves saved data and resumed gameplay", async () => {
        await click(page, "settings-toggle", touch); await click(page, "save", touch);
        await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending);
        const result = await completed(launch(powershell(port), true));
        assert.equal(result.code, 0, result.stderr);
        assert.ok(result.stdout.includes(base));
        await page.reload(); await click(page, "load", touch);
        await page.waitForFunction(() => __rogueBrowserTest.frame && __rogueBrowserTest.trace && __rogueBrowserTest.queuePending === 0);
        const turn = await page.evaluate(() => __rogueBrowserTest.trace.words[13]);
        await page.keyboard.press(".");
        await page.waitForFunction(turn => __rogueBrowserTest.trace.words[13] === turn + 1, turn);
      });
    } finally {await context.close();}
  }
  assert.deepEqual(evidence.errors, []);
  evidence.finished_at = new Date().toISOString();
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close(); await runtime?.dispose();
  for (const child of children) child.kill();
  for (const server of servers) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}

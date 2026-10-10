import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
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
const output = artifactDirectory(path.join(directory, "output/combat-log"));
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

try {
  const workerSource=await readFile(path.join(project,'web/worker.js'),'utf8');
  context=await playwright.chromium.launchPersistentContext(path.join(scratch,'profile'),{executablePath:executable,headless:true,viewport:{width:1440,height:900},args:launchArgs});
  browser=context.browser();
  await context.route('**/web/worker.js',route=>route.fulfill({headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'},contentType:'text/javascript',body:workerSource.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", "combat");\n    module.FS.writeFile("/locale.txt",')}));
  await context.route('**/build/game.js',route=>route.fulfill({headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'},path:path.join(project,'build/game-fixtures.js'),contentType:'text/javascript'}));
  page=await context.newPage();await installBrowserTestAdapter(page);page.on('pageerror',error=>evidence.errors.push(error.message));
  await page.goto(base+'?trace=1');await page.waitForFunction(()=>window.__rogueBrowserTest?.graphics.images===46);
  await page.locator('#seed').fill('17');await page.locator('#new-game').click();await settled();
  assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.frame.player),{x:10,y:10},'real controlled combat fixture loaded');
  for(let i=0;i<3;i++){
    const prior=await page.evaluate(()=>__rogueBrowserTest.inputRequestCount);
    await page.locator('#board').focus();await page.keyboard.press('l');
    await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n,prior);await settled();
    assert.equal(await page.evaluate(()=>__rogueBrowserTest.trace.words[13]),i+1,'one completed combat turn per movement key');
    assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.ui.input.kind),'command','no combat Space wait');
  }
  assert.ok(await page.locator('.log-entry[data-source=game]').count()>=3,'combat messages are retained together');
  assert.equal(await page.locator('.log-entry[data-source=game] .log-label').first().textContent(),'ゲーム');
  await shot('combat-history');evidence.checks.push('Three enemy collisions complete through real Worker/SAB without any Space key; labelled game history remains readable');
  const before=await snapshot();await openSettings();await page.locator('#save').click();
  await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);
  assert.match(await page.locator('.log-column #notice').textContent(),/保存/);
  await page.locator('#settings-top').click(); await page.locator('#load').click();await page.waitForFunction(g=>__rogueBrowserTest.generation>g&&__rogueBrowserTest.trace&&__rogueBrowserTest.inputRequestCount>0,before.generation);await settled();
  const restored=await snapshot();assert.deepEqual(restored.words,before.words);assert.deepEqual(restored.player,before.player);
  await page.locator('#board').focus();await page.keyboard.press('l');await page.waitForFunction(()=>__rogueBrowserTest.trace.words[13]===4);await settled();
  evidence.checks.push('Combat scratch save restores exact C/RNG state and the next collision still needs no Space');
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(await page.evaluate(()=>({missing:__rogueBrowserTest.uiMissing,fallbacks:__rogueBrowserTest.translationFallbacks})),{missing:[],fallbacks:[]});
  evidence.status='passed';evidence.diagnostics=await page.evaluate(()=>__rogueBrowserTest.diagnostics);
} catch (error) {
  evidence.status = "failed";
  evidence.error = error.stack || String(error);
  if (page) {
    try { evidence.failure_snapshot = await snapshot(); evidence.failure_diagnostics = await page.evaluate(()=>__rogueBrowserTest.diagnostics); await shot("failure"); }
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

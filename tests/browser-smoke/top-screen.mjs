import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../../web/server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = artifactDirectory(path.join(root, 'tests/browser-smoke/output/top-screen'));
const { chromium } = createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const executablePath = process.env.ROGUE_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const server = createPreviewServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/';
const worker = await readFile(path.join(root, 'web/worker.js'), 'utf8');
const evidence = { started_at: new Date().toISOString(), checks: [], errors: [], screenshots: [], endingComparisons: [] };
await mkdir(output, { recursive: true });
let browser, context, page;
async function previousFile(file) {
  try { return await readFile(path.join(output, 'before', file)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return execFileSync('git', ['show', 'HEAD:rogue-nihon/' + file], { cwd: root }); }
}
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
async function open({ baseline = false, fixture = '', mobile = false, locale = 'ja' } = {}) {
  await context?.close(); context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1240, height: 900 } });
  if (baseline) {
    const files = { '/': 'web/index.html', '/web/app.js': 'web/app.js', '/web/style.css': 'web/style.css', '/locales/ui-web-ja.json': 'locales/ui-web-ja.json', '/locales/ui-web-en.json': 'locales/ui-web-en.json' };
    await context.route('**/*', async route => {
      const file = files[new URL(route.request().url()).pathname];
      if (!file) return route.continue();
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript';
      await route.fulfill({ body: await previousFile(file), contentType: type, headers });
    });
  }
  if (fixture) {
    const source = worker.replace('    module.FS.writeFile("/locale.txt",', '    module.FS.writeFile("/fixture.id", ' + JSON.stringify(fixture) + ');\n    module.FS.writeFile("/locale.txt",');
    await context.route('**/web/worker.js', route => route.fulfill({ body: source, contentType: 'text/javascript', headers }));
    await context.route('**/build/game.js', route => route.fulfill({ path: path.join(root, 'build/game-fixtures.js'), contentType: 'text/javascript', headers }));
  }
  page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(base + '?trace=1&view=pixels&lang=' + locale);
  await page.waitForFunction(() => window.__rogueBrowserTest?.graphics?.images > 0);
}
async function settled() { await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.frame && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0 && __rogueBrowserTest.queuePending === 0); }
async function start(name = 'トップの勇者', seed = '17') {
  await page.locator('#name').fill(name); await page.locator('#seed').fill(seed); await page.locator('#new-game').click(); await settled();
}
async function state() { return page.evaluate(() => ({ words: __rogueBrowserTest.trace?.words, traces: __rogueBrowserTest.traces.map(trace => trace.words), input: __rogueBrowserTest.inputRequestCount, generation: __rogueBrowserTest.generation, name: __rogueBrowserTest.frame?.ui.name, ui: __rogueBrowserTest.frame?.ui, exit: __rogueBrowserTest.diagnostics.exitCode, saved: __rogueBrowserTest.savedLength })); }
async function key(key) {
  const before = (await state()).input; await page.keyboard.press(key);
  await page.waitForFunction(n => __rogueBrowserTest.queuePending === 0 && (__rogueBrowserTest.inputRequestCount > n || __rogueBrowserTest.diagnostics.exitCode !== null), before);
}
async function settings() { await page.locator('#settings-toggle').click(); await page.locator('#settings-panel').waitFor({ state: 'visible' }); }
async function top() { await page.locator('#settings-top').click(); await page.locator('#top-screen').waitFor({ state: 'visible' }); }
async function shot(name) { await page.screenshot({ path: path.join(output, name + '.png') }); evidence.screenshots.push(name + '.png'); }
async function check(label, fn) { await fn(); evidence.checks.push(label); console.log('PASS ' + label); }
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
  await open({ baseline: true }); await start(); const baseline = await state();
  await open();
  await check('Initial title screen exposes New game and Load, with no running Worker or game window', async () => {
    assert.equal(await page.locator('#top-screen').isVisible(), true); assert.equal(await page.locator('#game-screen').isHidden(), true);
    assert.equal(await page.locator('#load').isDisabled(), true); assert.equal(await page.locator('#settings-panel').isHidden(), true);
    assert.equal(await page.locator('#settings-panel #new-game,#settings-panel #load,#settings-panel #name,#settings-panel #seed,#settings-panel #language').count(), 0);
    assert.equal(await page.evaluate(() => __rogueBrowserTest.generation), 0);
    assert.equal(await page.evaluate(() => __rogueBrowserTest.running), false); await shot('top-desktop');
  });
  await check('Separate random buttons change only their field and never enter the C input queue', async () => {
    await page.locator('#random-name').click(); const name = await page.locator('#name').inputValue();
    assert.notEqual(name, 'Player'); assert.equal(await page.locator('#seed').inputValue(), '12345');
    assert.ok(await page.evaluate(() => new TextEncoder().encode(document.getElementById('name').value).length <= 49));
    await page.locator('#random-seed').click(); const seed = Number(await page.locator('#seed').inputValue());
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff); assert.equal(await page.locator('#name').inputValue(), name);
    await page.locator('#name').fill('i?Q'); await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => __rogueBrowserTest.inputRequestCount), 0); assert.equal(await page.evaluate(() => __rogueBrowserTest.queuePending), 0);
    evidence.random = { name, seed };
  });
  await check('Invalid seed and overlong UTF-8 name stay on the title screen with visible errors', async () => {
    for (const seed of ['-1', '', '4294967296', '1.5']) {
      await page.locator('#seed').fill(seed); await page.locator('#new-game').click(); assert.match(await page.locator('#top-notice').innerText(), /0.*4294967295/);
    }
    await page.locator('#seed').fill('17'); await page.locator('#name').fill('界'.repeat(17)); await page.locator('#new-game').click();
    assert.match(await page.locator('#top-notice').innerText(), /49/); assert.equal(await page.locator('#top-screen').isVisible(), true); assert.equal((await state()).generation, 0);
  });
  await start();
  await check('Manual name and seed produce the exact same C/RNG state and trace as the previous screen', async () => {
    const current = await state(); assert.equal(current.name, 'トップの勇者'); assert.deepEqual(current.words, baseline.words); assert.deepEqual(current.traces, baseline.traces);
    assert.equal(await page.locator('#top-screen').isHidden(), true); assert.equal(await page.locator('#game-screen').isVisible(), true); evidence.initialState = current.words;
  });
  await page.locator('#board').focus(); await key('.'); await key('i'); const menu = await state();
  await check('Save, return to title, and Load restore the existing C state and inventory window', async () => {
    await settings(); await page.locator('#save').click(); await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending);
    const saved = await state(); await shot('settings'); await top();
    assert.equal(await page.evaluate(() => __rogueBrowserTest.running), false); assert.equal(await page.evaluate(() => __rogueBrowserTest.frame), null);
    assert.equal(await page.evaluate(() => __rogueBrowserTest.queuePending), 0); assert.equal((await state()).input, saved.input);
    assert.equal(await page.locator('#load').isEnabled(), true); await shot('top-with-save');
    await page.locator('#seed').fill('987654321'); await page.locator('#name').fill('ロードには使わない名前'); await page.locator('#load').click(); await settled();
    const restored = await state(); assert.deepEqual(restored.words.slice(1,16), saved.words.slice(1,16)); assert.equal(restored.name, 'トップの勇者'); assert.equal(restored.ui.mode, 'menu');
    assert.equal(restored.ui.input.kind, 'space'); assert.deepEqual(restored.ui.lines, menu.ui.lines); assert.equal(restored.generation, 2);
    await page.locator('[data-window-key="32"]').click(); await page.waitForFunction(() => !__rogueBrowserTest.frame.ui.window); await shot('loaded-game');
    evidence.restoredState = restored.words;
  });
  await check('A second new game and page reload preserve the manual save and leave no stale modal', async () => {
    await settings(); await top(); await page.locator('#random-name').click(); await page.locator('#random-seed').click();
    const name = await page.locator('#name').inputValue(); await page.locator('#new-game').click(); await settled(); assert.equal((await state()).name, name);
    assert.equal((await state()).ui.window, null); await settings(); await top(); await page.reload();
    await page.waitForFunction(() => window.__rogueBrowserTest?.savedLength > 0); assert.equal(await page.locator('#top-screen').isVisible(), true); assert.equal(await page.locator('#load').isEnabled(), true);
    await page.locator('#load').click(); await settled(); assert.equal((await state()).name, 'トップの勇者'); assert.equal((await state()).ui.mode, 'menu');
  });
  await check('English mobile title supports random inputs, Enter to start, and return without horizontal overflow', async () => {
    await open({ mobile: true, locale: 'en' }); assert.equal(await page.locator('#new-game').innerText(), 'New game'); assert.equal(await page.locator('#load').innerText(), 'Load');
    await page.locator('#random-name').click(); assert.match(await page.locator('#name').inputValue(), /^Adventurer\d+$/);
    await page.locator('#random-seed').click(); await shot('top-mobile');
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    await page.locator('#name').fill('MobileHero'); await page.locator('#seed').fill('4294967295'); await page.locator('#seed').press('Enter'); await settled();
    assert.equal((await state()).name, 'MobileHero'); await settings(); await top(); assert.equal(await page.locator('#top-screen').isVisible(), true);
    await page.locator('#language').selectOption('ja'); assert.equal(await page.locator('#new-game').innerText(), 'はじめから');
    await page.locator('#seed').fill('0'); await page.locator('#new-game').click(); await settled(); assert.equal(await page.evaluate(() => __rogueBrowserTest.running), true);
  });
  for (const fixture of ['ending-death', 'ending-no-tomb', 'ending-victory']) {
    await open({ fixture, baseline: true }); await start('EndingAudit');
    while ((await state()).exit === null) { const kind = (await state()).ui.input.kind; assert.ok(['space','enter'].includes(kind)); await key(kind === 'space' ? 'Space' : 'Enter'); }
    const expected = await state();
    await check(fixture + ': Return to title completes the original C score/accounting and matches manual acknowledgements', async () => {
      await open({ fixture }); await start('EndingAudit'); await page.locator('#result-top').waitFor({ state: 'visible' }); await shot(fixture);
      await page.locator('#result-top').click(); await page.waitForFunction(() => __rogueBrowserTest.topOpen && !__rogueBrowserTest.running);
      const actual = await state(); assert.equal(actual.exit, expected.exit); assert.deepEqual(actual.words, expected.words); assert.deepEqual(actual.traces, expected.traces);
      assert.equal(actual.input, expected.input); assert.equal(await page.locator('#game-screen').isHidden(), true); assert.equal(await page.evaluate(() => __rogueBrowserTest.queuePending), 0);
      evidence.endingComparisons.push({ fixture, words: actual.words, input: actual.input, exit: actual.exit });
    });
  }
  await check('Ended score window still offers Return to title after the original Finish button', async () => {
    await open({ fixture: 'ending-death' }); await start(); await page.locator('[data-window-key="13"]').click();
    await page.waitForFunction(() => __rogueBrowserTest.frame.ui.input.id === 'input.finish_game'); await shot('game-over-score');
    await page.locator('[data-window-key="13"]').click(); await page.waitForFunction(() => !__rogueBrowserTest.running && __rogueBrowserTest.diagnostics.exitCode !== null);
    await page.locator('#result-top').click(); assert.equal(await page.locator('#top-screen').isVisible(), true);
  });
  assert.deepEqual(evidence.errors, []); assert.deepEqual(await page.evaluate(() => __rogueBrowserTest.uiMissing), []); assert.deepEqual(await page.evaluate(() => __rogueBrowserTest.translationFallbacks), []);
  evidence.files = await Promise.all(['web/index.html','web/style.css','web/app.js','locales/ui-web-ja.json','locales/ui-web-en.json','build/game.js','build/game.wasm','build/game-fixtures.wasm'].map(async file => ({ file, sha256: createHash('sha256').update(await readFile(path.join(root,file))).digest('hex') })));
  evidence.compiledArchiveComparison = [];
  for (const file of ['build/game.js', 'build/game.wasm']) {
    try { const current = await readFile(path.join(root,file)), before = await readFile(path.join(output,'before',file)); evidence.compiledArchiveComparison.push({file,identical:current.equals(before),current_sha256:createHash('sha256').update(current).digest('hex'),before_sha256:createHash('sha256').update(before).digest('hex')}); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  evidence.passed = true; console.log(JSON.stringify({ passed: true, checks: evidence.checks.length, originalEndingComparisons: evidence.endingComparisons.length }));
} catch (error) { evidence.passed = false; evidence.failure = error.stack; evidence.diagnostics = await page?.evaluate(() => window.__rogueBrowserTest?.diagnostics).catch(() => null); await shot('failure').catch(() => {}); throw error; }
finally { evidence.finished_at = new Date().toISOString(); await writeFile(path.join(output,'evidence.json'), JSON.stringify(evidence,null,2)); await context?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }

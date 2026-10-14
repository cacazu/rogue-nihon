import {loadPlaywright, browserExecutable} from '../../tools/toolchain.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Use the production game and naturally generated starting inventory. Only the
// input/display/platform boundaries changed by the ownership repair are covered.
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.ROGUE_OWNERSHIP_OUTPUT ? path.resolve(process.env.ROGUE_OWNERSHIP_OUTPUT, 'input') : artifactDirectory(path.join(root, 'tests/browser-smoke/output/input-ownership'));
await mkdir(output, {recursive: true});
const {chromium} = loadPlaywright();
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const evidence = {started_at: new Date().toISOString(), seed: 17, checks: [], snapshots: [], screenshots: [], errors: []};
let browser, context, page, runtime;
const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const scene = () => page.evaluate(() => __rogueBrowserTest.canvas);
const state = () => page.evaluate(() => ({
  words: __rogueBrowserTest.trace.words,
  inputs: __rogueBrowserTest.trace.input_index,
  requests: __rogueBrowserTest.inputRequestCount,
  generation: __rogueBrowserTest.generation,
  frame: __rogueBrowserTest.frame,
  queue: __rogueBrowserTest.queuePending
}));

async function check(label, action) {
  await action();
  evidence.checks.push(label);
  console.log(`PASS ${label}`);
}
async function click(id) {
  await page.waitForFunction(id => __rogueBrowserTest.canvas.controls.some(control => control.id === id && !control.disabled), id);
  const control = (await scene()).controls.find(control => control.id === id);
  const bounds = await page.locator('#rogue-canvas').boundingBox();
  await page.mouse.click(bounds.x + control.rect.x + control.rect.w / 2, bounds.y + control.rect.y + control.rect.h / 2, {delay: 40});
  await paint();
}
async function field(id, value) {
  await click(id);
  await page.keyboard.press('Control+a');
  if (value) await page.keyboard.insertText(value);
  else await page.keyboard.press('Backspace');
  await paint();
}
async function sent(action) {
  const before = (await state()).requests;
  await action();
  await page.waitForFunction(before => __rogueBrowserTest.queuePending === 0 && __rogueBrowserTest.inputRequestCount > before, before);
  await paint();
}
const key = value => sent(() => page.keyboard.press(value));
const action = value => sent(() => click(`window-${value}`));
async function commandWait() {
  await page.waitForFunction(() => __rogueBrowserTest.queuePending === 0 && __rogueBrowserTest.frame.ui.input.kind === 'command' && !__rogueBrowserTest.frame.ui.window);
  await paint();
}
async function open(name = '所有権勇者') {
  await context?.close();
  context = await browser.newContext({viewport: {width: 1240, height: 900}});
  page = await context.newPage();
  await installBrowserTestAdapter(page);
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(`${base}?trace=1&view=pixels&lang=ja`);
  await page.waitForFunction(() => window.__rogueBrowserTest?.canvas?.paintCount > 0);
  await field('name', name);
  await field('seed', '17');
  await click('new-game');
  await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0 && __rogueBrowserTest.queuePending === 0);
  await commandWait();
  assert.equal((await state()).frame.ui.name, name);
}
function unchanged(before, after, label) {
  assert.deepEqual(after.words, before.words, `${label}: all C state/RNG words`);
  assert.equal(after.inputs, before.inputs, `${label}: consumed C input index`);
}
async function snapshot(label) {
  const value = await state();
  evidence.snapshots.push({label, words: value.words, inputs: value.inputs, requests: value.requests, generation: value.generation});
  return value;
}
async function screenshot(name) {
  await page.screenshot({path: path.join(output, `${name}.png`)});
  evidence.screenshots.push(`${name}.png`);
}
function observedControls(frame) {
  const tile = frame.map_player_underlay?.tile;
  const ui = frame.ui;
  assert.equal(ui.can_drop, !(Number.isInteger(tile) && tile > 2), 'new frame uses its own observed footing');
  const available = !ui.window && ui.mode === 'game' && ui.input.kind === 'command';
  const descend = available && tile === 6 && !ui.player_state.levitating;
  assert.equal(ui.map_controls.stairs.descend, descend);
  assert.equal(ui.map_controls.stairs.ascend, descend && Boolean(ui.player_state.amulet));
}
async function select(item) {
  await key('i');
  await sent(() => click(`item-${item}`));
  assert.equal((await state()).frame.ui.window.kind, 'inventory_actions');
}
async function optionName() {
  await key('o');
  // Six original boolean options and one inventory-style option precede name.
  for (let index = 0; index < 7; index++) await key('Enter');
  await page.waitForFunction(() => __rogueBrowserTest.frame.ui.input.kind === 'text' && __rogueBrowserTest.frame.ui.input.row === 7);
}
async function closeOptions() {
  await key('Escape');
  await page.waitForFunction(() => __rogueBrowserTest.frame.ui.input.kind === 'space');
  await action(32);
  await commandWait();
}

try {
  runtime = await prepareBrowserRuntime(root);
  evidence.runtime = runtime.diagnostics;
  browser = await chromium.launch({executablePath: browserExecutable(), headless: true, args: ['--disable-gpu'], downloadsPath: runtime.downloadsPath});
  evidence.browser = browser.version();
  await open();
  observedControls((await state()).frame);

  await check('Inventory selection, details and Back preserve the C journal and all C/RNG words', async () => {
    await key('i');
    const before = await snapshot('inventory-open');
    await sent(() => click('item-c'));
    assert.equal((await state()).frame.ui.window.kind, 'inventory_actions');
    await action(118);
    assert.equal((await state()).frame.ui.window.kind, 'inventory_details');
    await action(27);
    assert.equal((await state()).frame.ui.window.kind, 'inventory_actions');
    await action(27);
    assert.equal((await state()).frame.ui.inventory, true);
    unchanged(before, await snapshot('inventory-returned'), 'inventory browsing');
    await action(32);
    await commandWait();
  });

  await check('An inventory action reaches C, and a cancelled throw never leaves an item key for the next command', async () => {
    const beforeEquip = await state();
    await select('d');
    await action(119);
    await commandWait();
    assert.equal((await state()).words[13], beforeEquip.words[13] + 1);
    await select('c');
    await action(116);
    assert.equal((await state()).frame.ui.input.kind, 'direction');
    const direction = await state();
    await key('Escape');
    await commandWait();
    assert.equal((await state()).words[13], direction.words[13]);
    const beforeWait = await state();
    await key('.');
    await commandWait();
    assert.equal((await state()).words[13], beforeWait.words[13] + 1);
    observedControls((await state()).frame);
  });

  await check('A UTF-8 item-name draft saves without committing and restores in a new Worker before editing and the next turn', async () => {
    await select('c');
    await action(99);
    await page.waitForFunction(() => __rogueBrowserTest.frame.ui.input.kind === 'text');
    const beforeDraft = await state();
    await field('prompt-text', '日本語🗡');
    unchanged(beforeDraft, await state(), 'native draft editing');
    await screenshot('text-draft');
    await click('settings-toggle');
    const beforeSave = await snapshot('before-draft-save');
    await click('save');
    await page.waitForFunction(() => __rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending && __rogueBrowserTest.queuePending === 0);
    const saved = await snapshot('saved-draft');
    // The draft is now consumed by C's editor, which redraws its ASCII cells.
    // Word 16 hashes those cells; every game/RNG word must remain unchanged.
    assert.deepEqual(saved.words.filter((_, index) => index !== 16), beforeSave.words.filter((_, index) => index !== 16), 'draft save keeps C game/RNG state');
    assert.notEqual(saved.words[16], beforeSave.words[16], 'consumed draft redraws the C editor');
    assert.equal(saved.inputs - beforeSave.inputs, 1 + Buffer.byteLength('日本語🗡'), 'only Ctrl-U and consumed UTF-8 bytes enter the journal');
    await click('save');
    await page.waitForFunction(() => !__rogueBrowserTest.savePending && __rogueBrowserTest.queuePending === 0);
    unchanged(saved, await state(), 'save of an already consumed draft');
    await click('settings-top');
    await page.waitForFunction(() => __rogueBrowserTest.topOpen);
    await click('load');
    await page.waitForFunction(generation => __rogueBrowserTest.generation > generation && __rogueBrowserTest.running && __rogueBrowserTest.frame?.ui.input.kind === 'text' && __rogueBrowserTest.queuePending === 0, saved.generation);
    await paint();
    unchanged(saved, await snapshot('restored-draft'), 'new Worker replay');
    assert.equal(await page.locator('#prompt-text').inputValue(), '日本語🗡');
    await screenshot('text-restored');
    await click('prompt-text');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await paint();
    assert.equal(await page.locator('#prompt-text').inputValue(), '日本語');
    await sent(() => click('submit-text'));
    await commandWait();
    await key('i');
    assert.ok((await state()).frame.ui.lines.some(line => line.text.includes('日本語') && !line.text.includes('日本語🗡')));
    await action(32);
    await commandWait();
    const beforeWait = await state();
    await key('.');
    await commandWait();
    assert.equal((await state()).words[13], beforeWait.words[13] + 1);
  });

  await check('Only C-confirmed player-name edits replace the original Unicode name', async () => {
    await open('開始勇者🗡');
    await optionName();
    await field('prompt-text', '');
    await sent(() => click('submit-text'));
    assert.equal((await state()).frame.ui.input.row, 8);
    assert.equal((await state()).frame.ui.name, '開始勇者🗡', 'empty Enter keeps the true Unicode identity');
    await closeOptions();

    await optionName();
    await field('prompt-text', '-');
    await sent(() => click('submit-text'));
    await page.waitForFunction(() => __rogueBrowserTest.frame.ui.input.kind === 'text' && __rogueBrowserTest.frame.ui.input.row === 7);
    assert.equal((await state()).frame.ui.name, '開始勇者🗡', 'the original leading-minus navigation keeps the true identity');
    await field('prompt-text', '改名勇者🗡');
    await sent(() => click('submit-text'));
    assert.equal((await state()).frame.ui.input.row, 8);
    assert.equal((await state()).frame.ui.name, '改名勇者🗡', 'an explicit C-confirmed name is adopted');
    await closeOptions();
    const beforeWait = await state();
    await key('.');
    await commandWait();
    assert.equal((await state()).frame.ui.name, '改名勇者🗡');
    assert.equal((await state()).words[13], beforeWait.words[13] + 1);
    observedControls((await state()).frame);
  });

  assert.deepEqual(evidence.errors, []);
  evidence.result = 'pass';
} catch (error) {
  evidence.result = 'fail';
  evidence.failure = error.stack;
  if (page) {
    evidence.state = await state().catch(() => null);
    evidence.scene = await scene().catch(() => null);
  }
  throw error;
} finally {
  evidence.finished_at = new Date().toISOString();
  await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  await context?.close();
  await browser?.close();
  await runtime?.dispose();
  await new Promise(resolve => server.close(resolve));
}

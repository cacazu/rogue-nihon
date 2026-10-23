// Reproduce seed 12345 through the shipped UI and C, without test adapters.
// Answered questions must disappear from the map log and full history.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright, browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {runGame} from '../run-game.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = artifactDirectory(path.join(root, 'tests/browser-smoke/output/item-prompt-history'));
await mkdir(output, {recursive: true});
const runtime = await prepareBrowserRuntime(root);
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = process.env.ROGUE_PROMPT_URL || 'http://127.0.0.1:' + server.address().port + '/';
const browser = await loadPlaywright().chromium.launch({
  executablePath: browserExecutable(), headless: true, downloadsPath: runtime.downloadsPath,
});
// Publicly observed route: collect the potion, scroll, gold and mercury wand,
// then return to (41,10), matching the reported item letters and position.
const route = 'hhhhhhhhhjllllljjjhhjjjhhhhhhhhkhhhhhhhhhhhhhhhhjjjjhhhhhhhhhhllllkkkkj';
const report = {seed: 12345, route, url, cases: [], errors: []};
let context, page, mobile, mode, journal;
const observation = () => page.evaluate(() => ({
  ...JSON.parse(document.querySelector('#rogue-observation').textContent),
  trace: window.coreTrace,
}));
async function wait(kind) {
  await page.waitForFunction(({kind, count}) => {
    const state = JSON.parse(document.querySelector('#rogue-observation').textContent);
    const trace = window.coreTrace;
    return state.input?.kind === kind && trace?.input_index === count
      && state.player?.x === trace.words[3] && state.player?.y === trace.words[4];
  }, {kind, count: journal.length});
}
async function key(physical, original, kind) {
  await page.locator('#rogue-canvas').focus();
  await page.keyboard.press(physical);
  journal += original;
  await wait(kind);
}
async function tap(id) {
  const control = page.locator('[data-control="' + id + '"]');
  if (mobile) await control.tap(); else await control.click();
}
function noQuestions(state) {
  // Assert actual painted content, independently of the internal classifier.
  assert.doesNotMatch(state.text.join(''), /どれを使う|どの方向[？?]/);
  assert.ok(!state.messages.some(text => /どれを使う|どの方向[？?]/.test(text)));
}
async function compare() {
  const expected = await runGame(path.join(root, 'build/game.wasm'), {
    seed: 12345, name: 'Player', locale: 'ja', messagePaging: 'log', text: journal,
  });
  assert.deepEqual((await observation()).trace.words, expected.traces.at(-1).words);
}
try {
  for (mode of ['pixels', 'tiles', 'ascii']) for (mobile of [false, true]) {
    await context?.close();
    context = await browser.newContext({
      viewport: mobile ? {width: 390, height: 844} : {width: 1920, height: 1032},
      hasTouch: mobile, isMobile: mobile, ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
      const Original = Worker;
      window.Worker = class extends Original {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({data}) => {
            if (data.type === 'trace') window.coreTrace = data;
          });
        }
      };
    });
    await page.goto(url + '?trace=1&lang=ja&view=' + mode);
    await page.locator('#name').fill('Player');
    await page.locator('#seed').fill('12345');
    await tap('new-game');
    journal = '';
    await wait('command');
    for (const move of route) await key(move, move, 'command');
    assert.deepEqual((await observation()).player, {x: 41, y: 10});
    await key('i', 'i', 'space');
    await tap('item-h');
    await tap('window-122');
    journal += ' z';
    await wait('direction');
    await tap(mobile ? 'touch-l' : 'window-108');
    journal += 'lh'; // h is the already selected wand, supplied by Rust input.
    await wait('command');
    noQuestions(await observation());
    await compare();
    const name = mode + '-' + (mobile ? 'phone' : 'pc');
    await page.screenshot({path: path.join(output, name + '-after-use.png')});
    await tap('history-open');
    noQuestions(await observation());
    await page.screenshot({path: path.join(output, name + '-history.png')});
    await compare();
    await tap('history-close');
    await key('.', '.', 'command');
    noQuestions(await observation());
    await compare();
    // Direct use must still show the required active selector, and cancellation
    // must remove its question from both the ordinary log and full history.
    await key('z', 'z', 'direction');
    await tap(mobile ? 'touch-l' : 'window-108');
    journal += 'l';
    await wait('item');
    assert.ok((await observation()).window);
    assert.ok(await page.locator('[data-control="item-h"]').isVisible());
    await key('Escape', '\x1b', 'command');
    noQuestions(await observation());
    await tap('history-open');
    noQuestions(await observation());
    await compare();
    await tap('history-close');
    report.cases.push({mode, mobile, journal, state: await observation()});
    console.log('PASS seed12345 ' + name);
  }
  assert.deepEqual(report.errors, []);
  report.result = 'pass';
} catch (error) {
  report.failure = error.stack;
  report.last = await observation().catch(() => null);
  await page?.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  await context?.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await runtime.dispose();
  console.log('Evidence: ' + output);
}

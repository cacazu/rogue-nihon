import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createPreviewServer } from '../../../tools/server.mjs';
const require = createRequire(import.meta.url);
const modulePath = process.env.ROGUE_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(modulePath);
const output = artifactDirectory(fileURLToPath(new URL('./output/windows/', import.meta.url)));
await mkdir(output, { recursive: true });
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const executablePath = process.env.ROGUE_CHROME || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
let browser, page;
const evidence = { started_at: new Date().toISOString(), playwright: modulePath, executablePath, checks: [], screenshots: [], errors: [] };
async function record(label, fn) { await fn(); evidence.checks.push(label); console.log('PASS: ' + label); }
async function snapshot() { return page.evaluate(() => { const f=__rogueBrowserTest.frame, w=__rogueBrowserTest.trace.words; return { map:f.map_cells, tiles:f.map_tiles, ui:f.ui, game:[...w.slice(1,16)], input:__rogueBrowserTest.inputRequestCount, canvas:document.getElementById('board').toDataURL() }; }); }
async function key(key) {
  const before=await page.evaluate(() => __rogueBrowserTest.inputRequestCount);
  await page.keyboard.press(key);
  await page.waitForFunction(before => __rogueBrowserTest.inputRequestCount > before && __rogueBrowserTest.queuePending === 0, before);
}
async function action(key) {
  const before=await page.evaluate(() => __rogueBrowserTest.inputRequestCount);
  await page.locator('[data-window-key="'+key+'"]').click();
  await page.waitForFunction(before => __rogueBrowserTest.inputRequestCount > before && __rogueBrowserTest.queuePending === 0, before);
}
async function shot(name) { await page.screenshot({ path:path.join(output,name+'.png') }); evidence.screenshots.push(name+'.png'); }
async function mapPreserved(before) {
  const current=await snapshot();
  assert.equal(current.map,before.map); assert.deepEqual(current.tiles,before.tiles); assert.ok(current.canvas===before.canvas, 'Canvas pixels are unchanged behind the dialog');
  assert.deepEqual(current.game,before.game, 'dialog observation leaves C state, RNG, food and turn unchanged');
  assert.equal(await page.locator('#board').isVisible(),true);
  assert.equal(await page.locator('#presentation').isVisible(),true);
  assert.equal(await page.locator('#presentation').getAttribute('role'),'dialog');
  assert.equal(await page.evaluate(() => document.getElementById('presentation').contains(document.activeElement)),true);
}
async function closed() { await page.waitForFunction(() => !__rogueBrowserTest.frame.ui.window && document.getElementById('game-window-layer').hidden); assert.equal(await page.locator('#board').isVisible(),true); }
async function start(locale='ja',view='tiles') {
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+locale+'&view='+view);
  await page.locator('#new-game').click();
  await page.waitForFunction(() => window.__rogueBrowserTest?.frame && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount);
  await page.locator('#board').focus();
}
try {
  browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
  page=await browser.newPage({viewport:{width:1240,height:900}});await installBrowserTestAdapter(page);
  page.on('pageerror',error=>evidence.errors.push(String(error)));
  await start();
  await record('Bevy 0.19.1 generates game frames in the real browser Worker',async()=>{
    evidence.engine=await page.evaluate(()=>__rogueBrowserTest.frame.engine);
    assert.deepEqual(evidence.engine,{name:'Bevy',version:'0.19.1',renderer:'browser-canvas'});
  });
  await record('Inventory preserves the actual map; Enter closes through Rust input',async()=>{
    const before=await snapshot(); await key('i'); await mapPreserved(before);
    assert.equal((await snapshot()).ui.mode,'menu');
    assert.equal(await page.locator('[data-window-key="32"]').innerText(),'閉じる');
    assert.doesNotMatch(await page.locator('#presentation').innerText(),/続ける|続きを表示/);
    await shot('inventory-desktop');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.getElementById('presentation').contains(document.activeElement)),true);
    await page.locator('#presentation').focus(); await key('Enter'); await closed();
  });
  await record('Escape closes inventory acknowledgement without leaving C waiting',async()=>{
    await key('i'); await key('Escape'); await closed();
  });
  await record('Inventory open/close keeps real game history without copying item rows into the log',async()=>{
    await key('v');
    const history=await page.locator('.log-entry[data-source="game"]').allTextContents();
    assert.ok(history.length>0,'a real C version message is already in game history');
    for (const close of ['button','Enter','Escape']) {
      await key('i');
      assert.ok((await snapshot()).ui.lines.some(line=>line.id==='ui.inventory.entry'),'C inventory rows are displayed in the window');
      assert.deepEqual(await page.locator('.log-entry[data-source="game"]').allTextContents(),history,'opening inventory preserves history');
      if(close==='button') await action(32); else await key(close);
      await closed();
      assert.deepEqual(await page.locator('.log-entry[data-source="game"]').allTextContents(),history,'closing inventory adds no item rows and retains game messages');
    }
    await shot('inventory-closed-log');
  });
  await record('Help question and full help use scrollable game windows',async()=>{
    const before=await snapshot(); await key('?'); await mapPreserved(before);
    assert.equal((await snapshot()).ui.input.kind,'help'); await action(42);
    assert.equal((await snapshot()).ui.mode,'help'); await mapPreserved(before);
    assert.ok((await snapshot()).ui.lines.length>20); await shot('help-desktop');
    await action(32); await closed();
  });
  await record('Game option controls apply to C and highlight the current row',async()=>{
    const before=await snapshot(); await key('o'); await mapPreserved(before);
    assert.equal((await snapshot()).ui.input.kind,'option_bool');
    assert.ok(await page.locator('.active-option').count()); await action(116);
    const changed=(await snapshot()).ui.lines.find(line=>line.scope==='options'&&line.row===0&&line.id==='options.value.true'); assert.ok(changed);
    await shot('options-desktop'); await action(27); await action(32); await closed();
  });
  await record('Item buttons are C inventory descriptors and execute C wield logic',async()=>{
    const before=await snapshot(); await key('w'); await mapPreserved(before);
    assert.equal((await snapshot()).ui.input.kind,'item');
    assert.ok(await page.locator('[data-selection-key="c"]').count());
    assert.equal(await page.locator('[data-window-key="42"]').count(),0,'item choices need no extra inventory button');
    await shot('item-desktop');
    await page.locator('[data-selection-key="d"]').click(); await closed();
    await page.waitForFunction(()=>__rogueBrowserTest.trace.words[13]===1);
    assert.equal((await snapshot()).game[12],before.game[12]+1);
  });
  await record('Nested item inventory opens, closes and cancels with unchanged RNG, turn and world state',async()=>{
    const before=await snapshot(); await key('w'); await mapPreserved(before);
    assert.equal(await page.locator('[data-window-key="42"]').count(),0);
    await key('*'); assert.equal((await snapshot()).ui.mode,'menu'); await mapPreserved(before);
    await action(32); assert.equal((await snapshot()).ui.input.kind,'item'); await mapPreserved(before);
    await action(27); await closed(); assert.deepEqual((await snapshot()).game,before.game);
  });
  await record('Direction buttons and cancel route through Rust input to C',async()=>{
    const before=await snapshot(); await key('t'); await mapPreserved(before);
    assert.equal((await snapshot()).ui.input.kind,'direction'); await shot('direction-desktop');
    assert.equal(await page.locator('[data-window-key="107"]').count(),1); await action(27); await closed();
    await key('t'); await action(107); assert.equal((await snapshot()).ui.input.kind,'item'); await action(27); await closed();
  });
  await record('Discoveries, symbol identification and quit confirmation use windows',async()=>{
    await key('D'); assert.equal((await snapshot()).ui.input.kind,'discovery'); await action(42);
    if((await snapshot()).ui.input.kind==='space') await action(32); await closed();
    await key('/'); assert.equal((await snapshot()).ui.input.kind,'symbol');
    await page.locator('#command-key').fill('@'); await page.locator('#key-prompt button').click(); await closed();
    const before=await snapshot(); await key('Q'); await mapPreserved(before); assert.equal((await snapshot()).ui.input.kind,'confirm'); await shot('confirm-desktop');
    await action(110); await closed();
  });
  await record('Item and direction commands share the Rust game window input path',async()=>{
    for (const command of ['q','r','e','W','d','P','I']) {
      const before=await snapshot(); await key(command); assert.equal((await snapshot()).ui.input.kind,'item',command);
      assert.equal(await page.locator('[data-window-key="42"]').count(),0,command+' has no duplicate inventory button');
      await mapPreserved(before); await action(27); await closed();
      assert.deepEqual((await snapshot()).game,before.game,command+' selection and cancellation preserve RNG, turns and world state');
    }
    for (const command of ['z','m','f','F','^']) {
      await key(command); assert.equal((await snapshot()).ui.input.kind,'direction',command);
      await action(27); await closed();
    }
  });
  await record('Escape in a focused text editor cancels without committing its draft',async()=>{
    await key('c'); await page.locator('[data-selection-key="c"]').click();
    await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='text');
    await page.locator('#prompt-text').fill('未確定の名前'); await key('Escape'); await closed();
    await key('i'); assert.doesNotMatch(await page.locator('#presentation-lines').innerText(),/未確定の名前/); await action(32); await closed();
  });
  await record('Japanese text editor remains in a game window and updates C item names',async()=>{
    await key('c'); await page.locator('[data-selection-key="c"]').click();
    await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='text');
    await page.locator('#prompt-text').fill('旅人の剣'); await page.locator('#text-prompt button').click(); await closed();
    await key('i'); assert.match(await page.locator('#presentation-lines').innerText(),/旅人の剣/); await action(32); await closed();
  });
  await record('Saving and restoring an open inventory preserves its window and map',async()=>{
    await key('i'); const before=await snapshot();
    await page.locator('#settings-toggle').click(); await page.locator('#save').click();
    await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);
    await page.locator('#settings-top').click(); await page.locator('#load').click();
    await page.waitForFunction(()=>__rogueBrowserTest.generation===2&&__rogueBrowserTest.frame?.ui.mode==='menu'&&__rogueBrowserTest.frame.ui.input.kind==='space'&&__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.trace?.words[19]===1&&__rogueBrowserTest.queuePending===0);
    await mapPreserved(before); await shot('restored-inventory'); await action(32); await closed();
  });
  await record('Mobile i button opens a bounded scrollable window over the map',async()=>{
    await page.setViewportSize({width:390,height:844}); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); const before=await snapshot();
    await page.locator('[data-character="i"]').click(); await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.mode==='menu');
    await mapPreserved(before); await shot('inventory-mobile');
    const rect=await page.locator('#presentation').boundingBox(); assert.ok(rect.x>=0&&rect.x+rect.width<=390);
    await action(32); await closed(); await key('?'); await action(42); await shot('help-mobile');
    assert.equal(await page.evaluate(()=>{const e=document.getElementById('presentation-lines');return e.scrollHeight>e.clientHeight}),true);
    await action(32); await closed();
  });
  await record('English and ASCII mode preserve the map behind inventory',async()=>{
    await page.setViewportSize({width:1240,height:900}); await start('en','ascii'); const before=await snapshot();
    await key('i'); await mapPreserved(before); assert.match(await page.locator('#presentation-title').innerText(),/Inventory/); await shot('inventory-ascii-en'); await action(32); await closed();
  });
  assert.deepEqual(evidence.errors,[]); assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.translationFallbacks),[]);
  evidence.files=await Promise.all(['web/app.js','web/index.html','web/style.css','rust/crates/display/src/game_window.rs','rust/crates/input/src/lib.rs','rust/crates/display/src/presentation.rs','rust/src/lib.rs','logic/command.c','logic/pack.c','logic/options.c','logic/main.c','logic/things.c','logic/rings.c','locales/ui-game-ja.json','locales/ui-game-en.json','build/game.js','build/game.wasm'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(new URL('../../'+file,import.meta.url))).digest('hex')})));
  evidence.result='pass';
} catch(error) { evidence.result='fail'; evidence.failure=error.stack; if(page) { evidence.diagnostics=await page.evaluate(()=>window.__rogueBrowserTest?.diagnostics).catch(()=>null); await shot('failure').catch(()=>{}); } throw error;
} finally { evidence.finished_at=new Date().toISOString(); await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)); if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }

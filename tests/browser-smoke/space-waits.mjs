import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../../web/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/space-waits'));
const modulePath=process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {chromium}=createRequire(import.meta.url)(modulePath);
const executablePath=process.env.ROGUE_CHROME||'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/';
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const evidence={started_at:new Date().toISOString(),playwright:modulePath,executablePath,checks:[],screenshots:[],errors:[]};
let browser,context,page;
async function snapshot(){return page.evaluate(()=>({ui:__rogueBrowserTest.frame.ui,words:__rogueBrowserTest.trace.words,map:__rogueBrowserTest.frame.map_cells,input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending}));}
async function settled(){await page.waitForFunction(()=>__rogueBrowserTest?.frame&&__rogueBrowserTest.trace&&__rogueBrowserTest.inputRequestCount&&__rogueBrowserTest.queuePending===0);}
async function start(fixture='',legacy=false){
 await context?.close();context=await browser.newContext({viewport:{width:1240,height:900}});
 if(fixture||legacy){let source=worker;if(fixture)source=source.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",');if(legacy)source=source.replace('module.FS.writeFile("/message-paging.txt", "log");','module.FS.writeFile("/message-paging.txt", "legacy");');
 await context.route('**/web/worker.js',r=>r.fulfill({body:source,contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'}}));
 }
 if(fixture)await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'}}));
 page=await context.newPage();await installBrowserTestAdapter(page);page.on('pageerror',e=>evidence.errors.push(String(e)));
 await page.goto(base+'?trace=1');await page.locator('#seed').fill('17');await page.locator('#new-game').click();await settled();
 if(!((await snapshot()).ui.window))await page.locator('#board').focus();
}
async function send(key){const n=(await snapshot()).input;await page.keyboard.press(key);await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,n);}
async function action(key,ends=false){const n=(await snapshot()).input;await page.locator('[data-window-key="'+key+'"]').click();await page.waitForFunction(({n,ends})=>__rogueBrowserTest.queuePending===0&&(ends?__rogueBrowserTest.diagnostics.exitCode!==null:__rogueBrowserTest.inputRequestCount>n),{n,ends});}
async function closed(){await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window&&document.getElementById('game-window-layer').hidden);}
async function label(key,text){assert.equal(await page.locator('[data-window-key="'+key+'"]').innerText(),text);}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});evidence.screenshots.push(name+'.png');}
async function record(name,fn){await fn();assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.translationFallbacks),[]);evidence.checks.push(name);console.log('PASS: '+name);}
async function inventoryStyle(key){await send('o');for(let n=0;n<6;n++)await action(13);assert.equal((await snapshot()).ui.input.kind,'option_inventory');await action(key);assert.equal((await snapshot()).ui.input.kind,'text');await send('Escape');await label(32,'閉じる');await action(32);await closed();}
try{
 browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
 await record('Production inventory: Close button, Enter and Esc; C turn, food and RNG remain unchanged',async()=>{
  await start();const before=await snapshot();
  for(const method of ['button','Enter','Escape']){await send('i');await label(32,'閉じる');assert.doesNotMatch(await page.locator('#presentation').innerText(),/続ける|続きを表示/);assert.equal((await snapshot()).map,before.map);if(method==='button'){await shot('inventory-close');await action(32);}else await send(method);await closed();assert.deepEqual((await snapshot()).words.slice(1,16),before.words.slice(1,16));}
 });
 await record('Full help closes from its button without Space',async()=>{await send('?');await action(42);await label(32,'閉じる');await action(32);await closed();});
 await record('Finished game-options window closes from its button without Space',async()=>{await send('o');await action(27);await label(32,'閉じる');await action(32);await closed();});
 await record('Overlay and clear inventory styles both close without Space',async()=>{for(const key of [111,99]){await inventoryStyle(key);await send('i');await label(32,'閉じる');await action(32);await closed();}});
 await record('Slow inventory has Next item and Close; Esc cancels the C list rather than advancing',async()=>{
  await inventoryStyle(115);const before=await snapshot();await send('i');assert.equal((await snapshot()).ui.input.kind,'space_cancel');await label(32,'次の品物');await label(27,'閉じる');await shot('slow-inventory');
  await send('Enter');assert.equal((await snapshot()).ui.input.kind,'space_cancel');await action(27);await closed();assert.equal((await snapshot()).words[13],before.words[13]);
  await send('i');let count=0;while((await snapshot()).ui.input.kind==='space_cancel'){await action(32);if(++count>26)throw Error('slow inventory did not end');}await closed();assert.ok(count>0);assert.equal((await snapshot()).words[13],before.words[13]);
 });
 await record('Complete discovery list: every intermediate page says Next page, final page says Close',async()=>{
  await start('space-discoveries');await send('D');await action(42);let pages=0;
  while((await snapshot()).ui.input.id==='input.next_page'){await label(32,'次のページ');if(!pages)await shot('discovery-next-page');await action(32);if(++pages>10)throw Error('discovery paging did not end');}
  assert.ok(pages>=2);assert.equal((await snapshot()).ui.input.id,'input.close');await label(32,'閉じる');await shot('discovery-last-page');await action(32);await closed();
 });
 await record('Nested item list closes and returns to the original item choice without Space',async()=>{await start();await send('w');assert.equal(await page.locator('[data-window-key="42"]').count(),0);await send('*');await label(32,'閉じる');await action(32);assert.equal((await snapshot()).ui.input.kind,'item');await action(27);await closed();});
 await record('Magic-detection potion: actual C effect opens a Close window and finishes one turn',async()=>{await start('space-detection');const map=(await snapshot()).map;await send('q');await page.locator('[data-selection-key="f"]').click();await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.id==='input.close');assert.ok((await snapshot()).ui.lines.some(x=>x.id==='ui.detect_magic'));await label(32,'閉じる');assert.equal((await snapshot()).map,map);assert.equal(await page.locator('#window-map').isVisible(),true);assert.match(await page.locator('#window-map').getAttribute('aria-label'),/13,10/);await shot('magic-detection');await action(32);await closed();assert.equal((await snapshot()).words[13],1);});
 await record('Food-detection scroll: actual C effect opens a Close window and finishes one turn',async()=>{await start('space-detection');const map=(await snapshot()).map;await send('r');await page.locator('[data-selection-key="g"]').click();await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.id==='input.close');assert.ok((await snapshot()).ui.lines.some(x=>x.id==='ui.detect_food'));await label(32,'閉じる');assert.equal((await snapshot()).map,map);assert.equal(await page.locator('#window-map').isVisible(),true);assert.match(await page.locator('#window-map').getAttribute('aria-label'),/12,10/);await shot('food-detection');await action(32);await closed();assert.equal((await snapshot()).words[13],1);});
 await record('Victory acknowledgement says Show results and reaches actual C loot accounting without Space',async()=>{await start('ending-victory');assert.equal((await snapshot()).ui.input.id,'input.results');await label(32,'結果を見る');await shot('victory-results');await action(32);assert.equal((await snapshot()).ui.input.kind,'enter');assert.ok((await snapshot()).ui.lines.some(x=>x.id==='ui.ending.loot_columns'));await label(13,'スコアを見る');await action(13,true);});
 await record('Death confirmations use Show scores then Finish buttons for actual C Enter waits',async()=>{for(const fixture of ['ending-death','ending-no-tomb']){await start(fixture);assert.equal((await snapshot()).ui.input.kind,'enter');await label(13,'スコアを見る');await action(13);assert.equal((await snapshot()).ui.input.kind,'enter');await label(13,'終了する');await action(13,true);}});
 await record('Empty and one-item inventories return immediately with no Space wait',async()=>{for(const f of ['space-empty-pack','space-single-item']){await start(f);await send('i');await closed();assert.equal((await snapshot()).ui.input.kind,'command');}});
 await record('Normal combat narration completes multiple turns with no Space wait',async()=>{await start('combat');for(let n=1;n<=3;n++){await send('l');assert.equal((await snapshot()).words[13],n);assert.equal((await snapshot()).ui.input.kind,'command');await closed();}});
 await record('Legacy narration acknowledgement has a Next message button; production browser uses log paging',async()=>{await start('combat',true);await send('l');let count=0;while((await snapshot()).ui.input.id==='input.next_message'){await label(32,'次のメッセージ');await action(32);if(++count>10)throw Error('legacy More did not end');}assert.ok(count>0);await closed();assert.equal((await snapshot()).words[13],1);});
 assert.deepEqual(evidence.errors,[]);
 evidence.files=await Promise.all(['logic/io.c','logic/command.c','logic/options.c','logic/rip.c','logic/things.c','logic/rogue.h','rust/crates/input/src/lib.rs','rust/crates/display/src/game_window.rs','rust/crates/display/src/presentation.rs','web/app.js','locales/ui-game-ja.json','locales/ui-game-en.json','locales/runtime-ja.json','locales/runtime-en.json','tests/game-fixtures.c','build/game.wasm','build/game-fixtures.wasm'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')})));
 evidence.result='pass';
}catch(error){evidence.result='fail';evidence.failure=error.stack;if(page){evidence.snapshot=await snapshot().catch(()=>null);evidence.diagnostics=await page.evaluate(()=>__rogueBrowserTest.diagnostics).catch(()=>null);await shot('failure').catch(()=>{});}throw error;
}finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');await context?.close();await browser?.close();await new Promise(r=>server.close(r));}

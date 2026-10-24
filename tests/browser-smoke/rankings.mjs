import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
const root=process.cwd(),output=process.env.ROGUE_RANKINGS_OUTPUT?path.resolve(process.env.ROGUE_RANKINGS_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/rankings'));await mkdir(output,{recursive:true});
const base=process.env.ROGUE_RANKINGS_BASE||'https://192.168.11.4:4173';
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};let runtime,browser,context,page,fixture='plain';
const state=()=>page.evaluate(()=>__rogueUiAdapter.state);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function tap(id){await page.locator('[data-control="'+id+'"]:not([disabled])').click();await paint();}
async function database(key='personal-rankings-v1'){return page.evaluate(key=>new Promise((resolve,reject)=>{const q=indexedDB.open('original-rogue-web',1);q.onsuccess=()=>{const db=q.result,t=db.transaction('saves','readonly'),r=t.objectStore('saves').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);t.oncomplete=()=>db.close();};q.onerror=()=>reject(q.error);}),key);}
async function shot(name){const file=path.join(output,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);console.log(file);}
async function open(next){fixture=next;await page?.close();page=await context.newPage();page.setDefaultTimeout(20000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/?trace=1&lang=ja&view=tiles');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await page.locator('#seed').fill('17');await page.locator('#name').fill('Ranking');}
async function start(){await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.inputRequestCount>0&&!__rogueBrowserTest.queuePending);}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&!__rogueBrowserTest.queuePending);}
async function waitBook(count){await page.waitForFunction(count=>__rogueUiAdapter.state.rankings?.entries.length===count&&!__rogueUiAdapter.state.rankingLoading,count);return JSON.parse(await database());}
try{
 runtime=await prepareBrowserRuntime(root);const {chromium}=await loadPlaywright();browser=await chromium.launch({headless:true,executablePath:browserExecutable(),downloadsPath:runtime.downloadsPath});context=await browser.newContext({viewport:{width:1240,height:900},ignoreHTTPSErrors:true});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 await open('plain');await start();await idle();await page.keyboard.press('O');await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen&&!__rogueBrowserTest.savePending);
 const slot=JSON.parse(await database('manual.inventory'));assert.ok(slot.adventure);assert.equal(await database(),null,'Interrupted save is not a score');report.checks.push({id:'save-sidecar',adventure:slot.adventure,rankings:null});
 await tap('load');await idle();await page.waitForFunction(()=>__rogueBrowserTest.running&&!__rogueUiAdapter.state.starting);
 // Fail exactly the personal-ranking put, without altering the user profile or game save.
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.failRankingOnce=true;IDBObjectStore.prototype.put=function(value,key){if(key==='personal-rankings-v1'&&window.failRankingOnce){window.failRankingOnce=false;throw new DOMException('Induced ranking failure','AbortError');}return put.call(this,value,key);};});
 await page.keyboard.press('Q');await page.keyboard.press('y');await page.waitForFunction(()=>__rogueUiAdapter.state.rankingErrorId==='error.rankings_save');assert.equal(await database(),null);await shot('quit-pending');
 await tap('result-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await tap('rankings-open');let book=await waitBook(1);assert.equal(book.entries[0].score,0);assert.equal(book.entries[0].adventure,slot.adventure);await shot('top-zero');report.checks.push({id:'restored-quit-zero-retry',book});await tap('rankings-close');
 await open('ending-death');await start();await page.keyboard.press('Enter');book=await waitBook(2);assert.equal(book.entries[0].flags,0);await shot('death-score');await page.keyboard.press('Enter');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);report.checks.push({id:'death',book});
 await open('ending-victory');await start();await page.keyboard.press('Space');await page.keyboard.press('Enter');book=await waitBook(3);assert.equal(book.entries[0].flags,2);await shot('winner-score');report.checks.push({id:'winner',book});
 await open('plain');await tap('rankings-open');await waitBook(3);assert.deepEqual(JSON.parse(await database()),book);await shot('reload-personal-top');const before=(await state()).inputRequestCount;await page.setViewportSize({width:390,height:300});await paint();const region=await page.evaluate(()=>__rogueBrowserTest.canvas.regions.rankings);assert.ok(region.max>0);const box=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(box.x+region.rect.x+10,box.y+region.rect.y+10);await page.mouse.wheel(0,200);await paint();assert.ok(await page.evaluate(()=>__rogueBrowserTest.canvas.scrolls.rankings>0));assert.equal((await state()).inputRequestCount,before);await shot('compact-scrolled');
 const final=await state();assert.equal(final.runtimeError,null);assert.deepEqual(final.translationFallbacks,[]);assert.deepEqual(final.uiMissing,[]);assert.deepEqual(report.errors,[]);report.result='pass';console.log('Ranking smoke passed');
}catch(error){report.result='fail';report.failure=error.stack;report.failedState=await state().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await context?.close();await browser?.close();await runtime?.dispose();}

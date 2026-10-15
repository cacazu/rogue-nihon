import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_AUTOSAVE_OUTPUT?path.resolve(process.env.ROGUE_AUTOSAVE_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/autosave'));
await mkdir(output,{recursive:true});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view=pixels';
const report={checks:[],screenshots:[],errors:[]};
let runtime,browser,context,page,mobile,fixture;
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace?.words,inputs:__rogueBrowserTest.trace?.input_index,level:__rogueBrowserTest.frame?.stats.level,generation:__rogueBrowserTest.generation}));
const idle=()=>page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0&&!__rogueBrowserTest.savePending);
async function tap(id){
 const button=page.locator('[data-control="'+id+'"]:not([disabled])');await button.waitFor();
 if(mobile){const r=await button.boundingBox();assert.ok(r);await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);}else await button.click();
}
async function action(key,touch){
 const before=(await state()).inputs;
 if(mobile)await tap(touch);else await page.keyboard.press(key);
 await page.waitForFunction(before=>__rogueBrowserTest.trace.input_index>before,before);await idle();
}
async function stored(){return page.evaluate(()=>new Promise((resolve,reject)=>{
 const request=indexedDB.open('original-rogue-web',1);request.onerror=()=>reject(request.error);
 request.onsuccess=()=>{const db=request.result,tx=db.transaction('saves','readonly'),read=tx.objectStore('saves').get('manual');tx.oncomplete=()=>{db.close();resolve(read.result?Array.from(new Uint8Array(read.result)):null);};tx.onerror=()=>reject(tx.error);};
}));}
async function slot(expected){
 for(let i=0;i<100;i++){const bytes=await stored();if(Boolean(bytes)===expected)return bytes;await page.waitForTimeout(25);}
 assert.fail('Persistent save slot did not become '+expected);
}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function hidden(){
 for(const id of ['save','download-save','import-save'])assert.equal(await page.locator('[data-control="'+id+'"]').count(),0,id+' is hidden');
 assert.ok(!(await page.evaluate(()=>__rogueBrowserTest.canvas.controls)).some(c=>['save','download-save','import-save'].includes(c.id)));
}
function equalGame(a,b){assert.deepEqual(a.words,b.words);assert.equal(a.inputs,b.inputs);assert.equal(a.level,b.level);}
async function check(label,operation){await operation();report.checks.push(label);console.log('PASS '+label);}
async function open(phone,selected){
 await context?.close();mobile=phone;fixture=selected;
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 await installBrowserTestAdapter(context);
 await context.route('**/web/worker.js',route=>route.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',route=>route.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 await context.addInitScript(()=>{
  const transaction=IDBDatabase.prototype.transaction,completed=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
  IDBDatabase.prototype.transaction=function(...args){
   const tx=transaction.apply(this,args);
   if(window.__holdNextWrite&&args[0]==='saves'&&args[1]==='readwrite'){
    window.__holdNextWrite=false;
    Object.defineProperty(tx,'oncomplete',{set(callback){completed.set.call(tx,event=>{window.__releaseSaveCommit=()=>callback.call(tx,event);});}});
   }
   return tx;
  };
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args){const rq=put.apply(this,args);if(window.__failNextSave&&this.name==='saves'){window.__failNextSave=false;queueMicrotask(()=>this.transaction.abort());}return rq;};
 });
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base);await page.locator('[data-control="new-game"]:not([disabled])').waitFor();await hidden();
 await page.locator('#seed').fill('17');await page.locator('#name').fill('Autosave');await tap('new-game');await idle();
}
async function load(){await tap('load');await idle();await page.waitForFunction(()=>__rogueBrowserTest.savedLength===0);await slot(false);}
async function top(){await tap('settings-toggle');await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await page.locator('[data-control="load"]:not([disabled])').waitFor();}

async function production(){
 for(const phone of [false,true]){
  await context?.close();mobile=phone;
  context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
  await context.addInitScript(()=>{const Base=window.Worker;window.__publishedFrame=null;window.Worker=class extends Base{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data.type==='frame')window.__publishedFrame=e.data;});}};});
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  const label=(phone?'phone':'desktop')+' production';
  await check(label+' uses published artifacts for hidden controls, guidance, automatic top save and one-use load',async()=>{
   await page.goto(base.replace('trace=1','trace=0'));await page.locator('[data-control="new-game"]:not([disabled])').waitFor();
   for(const id of ['save','download-save','import-save'])assert.equal(await page.locator('[data-control="'+id+'"]').count(),0);
   await page.locator('#seed').fill('17');await tap('new-game');await page.waitForFunction(()=>__publishedFrame?.ui.input.kind==='command');
   await page.keyboard.press('S');await page.waitForFunction(()=>document.getElementById('rogue-observation').textContent.includes('階層移動時と、設定からトップ画面へ戻る時に自動保存します。'));
   const before=await page.evaluate(()=>({player:__publishedFrame.player,stats:__publishedFrame.stats}));
   await tap('settings-toggle');for(const id of ['save','download-save','import-save'])assert.equal(await page.locator('[data-control="'+id+'"]').count(),0);
   await shot((phone?'phone':'desktop')+'-production-settings');await tap('settings-top');
   await page.locator('[data-control="load"]:not([disabled])').waitFor();await slot(true);await page.evaluate(()=>{__publishedFrame=null;});
   await tap('load');await page.waitForFunction(()=>__publishedFrame?.ui.input.kind==='command');await slot(false);
   assert.deepEqual(await page.evaluate(()=>({player:__publishedFrame.player,stats:__publishedFrame.stats})),before);
   await page.reload();await page.locator('[data-control="new-game"]:not([disabled])').waitFor();assert.equal(await page.locator('[data-control="load"]').isDisabled(),true);
  });
 }
}

try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 if(process.argv.includes('--production-only'))await production();
 else for(const phone of [false,true]){
  const label=phone?'phone':'desktop';await open(phone,'inventory-context');
  await check(label+' hides manual save/export/import and saves after actual descent',async()=>{
   assert.equal(await stored(),null,'A new game alone does not create an autosave');
   await tap('settings-toggle');await hidden();await shot(label+'-settings');await tap('settings-close');
   for(let i=0;i<5;i++)await action('l','touch-l');
   await action('>','touch-search');assert.equal((await state()).level,2);
   await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);await slot(true);
  });
  const floor=await state();await action('.','touch-.');const next=await state();
  await check(label+' restores the autosave once and reproduces the next C/RNG turn',async()=>{
   await page.reload();await page.locator('[data-control="load"]:not([disabled])').waitFor();await hidden();await shot(label+'-top');
   await load();equalGame(await state(),floor);await action('.','touch-.');equalGame(await state(),next);
  });
  await check(label+' stays in play after an aborted autosave and waits for commit before returning top',async()=>{
   await tap('settings-toggle');await page.evaluate(()=>{__failNextSave=true;});await tap('settings-top');
   await page.waitForFunction(()=>!__rogueBrowserTest.savePending&&__rogueBrowserTest.diagnostics.entries.some(e=>e.id==='error.save'));
   assert.equal(await page.evaluate(()=>__rogueBrowserTest.topOpen),false);equalGame(await state(),next);await slot(false);
   await page.evaluate(()=>{__holdNextWrite=true;});await tap('settings-top');
   await page.waitForFunction(()=>typeof __releaseSaveCommit==='function');
   assert.equal(await page.evaluate(()=>__rogueBrowserTest.topOpen),false);assert.equal(await page.evaluate(()=>__rogueBrowserTest.savePending),true);
   equalGame(await state(),next);await page.evaluate(()=>{__releaseSaveCommit();delete window.__releaseSaveCommit;});
   await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await slot(true);await load();equalGame(await state(),next);
  });
  await check(label+' death deletes the existing slot before title/reload and cannot autosave the ending',async()=>{
   await top();assert.ok(await stored());fixture='ending-death';await tap('new-game');
   await page.locator('[data-control="result-top"]').waitFor();await slot(false);
   assert.equal(await page.evaluate(()=>__rogueBrowserTest.savedLength),0);await shot(label+'-death');
   await tap('result-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);
   await page.reload();await page.locator('[data-control="new-game"]:not([disabled])').waitFor();
   assert.equal(await page.locator('[data-control="load"]').isDisabled(),true);await slot(false);
  });
  await open(phone,'inventory-amulet');
  await check(label+' also saves after actual ascent',async()=>{
   assert.equal((await state()).level,2);assert.equal(await stored(),null);
   await action('<','touch-search');assert.equal((await state()).level,1);
   await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);await slot(true);
   const climbed=await state();await page.reload();await page.locator('[data-control="load"]:not([disabled])').waitFor();await load();equalGame(await state(),climbed);
  });
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await state().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}

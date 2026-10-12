import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {runGame} from '../run-game.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const baseline=process.env.ROGUE_DISCOVERY_BASELINE;
assert.ok(baseline,'ROGUE_DISCOVERY_BASELINE must name the pre-change fixture module');
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/discovery-direct'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],comparisons:[],errors:[],baseline_sha256:createHash('sha256').update(await readFile(baseline.replace(/\.js$/,'.wasm'))).digest('hex')};
let context,page,mobile=true;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const traces=()=>page.evaluate(()=>__rogueBrowserTest.traces.map(t=>({words:t.words,input_index:t.input_index})));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const words=()=>page.evaluate(()=>__rogueBrowserTest.trace.words);
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0&&!__rogueBrowserTest.diagnostics.windowClosing);await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.equal(c.rect.h,c.fullRect.h,id+' fully visible');const b=await page.locator('#rogue-canvas').boundingBox();const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(key){await page.keyboard.press(key);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(fixture='inventory-all',phone=true){
 if(context)await context.close();mobile=phone;
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));
 await tap('name');await page.locator('#name').fill('DiscoveryAudit');await tap('seed');await page.locator('#seed').fill('17');await tap('new-game');await idle();
 await page.evaluate(()=>{window.__historyPaints=[];const original=RogueCanvasUi.prototype.request;RogueCanvasUi.prototype.request=function(request){const result=original.call(this,request);if(request.type==='render')__historyPaints.push(result.diagnostics.controls.map(c=>c.id));return result;};});
}
const reference=text=>runGame(baseline,{fixture:'inventory-all',seed:17,name:'DiscoveryAudit',locale:'ja',messagePaging:'log',text});
async function inventory(){await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();}
async function direct(){await inventory();await page.evaluate(()=>__historyPaints=[]);await tap('inventory-history');await page.waitForFunction(()=>['input.close','input.next_page'].includes(__rogueBrowserTest.frame?.ui.input.id)&&__rogueBrowserTest.frame.ui.inventory!==true&&__rogueBrowserTest.queuePending===0);await paint();assert.ok(!(await scene()).controls.some(c=>c.id==='window-42'));assert.ok(!(await page.evaluate(()=>__historyPaints)).some(ids=>ids.includes('window-42')),'No painted selection intermediary');}
async function close(){const c=(await scene()).controls.find(c=>c.id==='window-32'||c.id==='window-close');assert.ok(c);await tap(c.id);await idle();}
function content(ui){return ui.lines.map(({id,text,args})=>({id,text,args}));}
async function compare(expected,name){const actual=await traces();assert.deepEqual(actual,expected.traces.slice(0,actual.length),name+' all 20 words and input positions');report.comparisons.push({name,checkpoints:actual.length,rng:(await words())[1]});}
try {
 const manual=await reference('i D* .');
 const manualList=manual.presentations.findLast(p=>p.ui.mode==='menu'&&p.ui.inventory!==true&&p.ui.input.id==='input.close').ui;
 for(const phone of [true,false]){
  await start('inventory-all',phone);const device=phone?'phone':'pc';
  await check(device+' item history opens every type directly with identical original RNG and order',async()=>{await direct();assert.deepEqual(content((await frame()).ui),content(manualList));await compare(manual,device+' direct list');const t=await traces();assert.notEqual(t[3].words[1],t[4].words[1],'Keep original set_order RNG consumption');assert.equal(t[3].words[13],t[4].words[13],'Listing does not consume a turn');await shot(device+'-direct-history');});
  await check(device+' closing and the next turn match the former manual D* path exactly',async()=>{await close();await key('.');await idle();await compare(manual,device+' after next turn');assert.equal((await traces()).length,manual.traces.length);});
  await check(device+' direct keyboard D still offers the original type selector',async()=>{await key('D');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='discovery');await paint();assert.ok((await scene()).controls.some(c=>c.id==='window-42'));await key('Escape');await idle();});
 }
 await start();
 await check('saving and restoring the direct list preserves RNG without selecting all twice',async()=>{
  await direct();const before=await words(),list=content((await frame()).ui);await tap('settings-toggle');await tap('save');await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending&&__rogueBrowserTest.queuePending===0);await paint();
  const bytes=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('original-rogue-web',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('saves','readonly'),s=t.objectStore('saves').get('manual');t.oncomplete=()=>{resolve(Array.from(new Uint8Array(s.result)));db.close();};t.onerror=()=>reject(t.error);};}));
  const save=JSON.parse(Buffer.from(bytes).toString('utf8'));assert.deepEqual(save.inputs.slice(-2),[68,42]);assert.equal(save.inputs.filter(key=>key===42).length,1);
  const generation=await page.evaluate(()=>__rogueBrowserTest.generation);await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await paint();await tap('load');await page.waitForFunction(g=>__rogueBrowserTest.generation>g&&__rogueBrowserTest.running&&__rogueBrowserTest.frame?.ui.input.id==='input.close'&&__rogueBrowserTest.queuePending===0,generation);await paint();assert.deepEqual(await words(),before);assert.deepEqual(content((await frame()).ui),list);await shot('phone-restored-history');await close();await key('.');await idle();assert.deepEqual(await words(),manual.traces.at(-1).words);
 });
 await start('space-discoveries');
 await check('long discovery lists keep the original pages, acknowledgements and RNG',async()=>{await direct();assert.equal((await frame()).ui.input.id,'input.next_page');await shot('phone-history-first-page');await close();const actual=await traces(),acks=actual.at(-1).input_index-4;assert.ok(acks>1);const expected=await runGame(baseline,{fixture:'space-discoveries',seed:17,name:'DiscoveryAudit',locale:'ja',messagePaging:'log',text:'i D*'+' '.repeat(acks)});assert.deepEqual(actual,expected.traces);report.comparisons.push({name:'paginated discoveries',checkpoints:actual.length,acknowledgements:acks,rng:(await words())[1]});});
 await start(null);
 await check('published playable build also opens the list in one click',async()=>{await direct();assert.equal((await frame()).ui.input.id,'input.close');await close();});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

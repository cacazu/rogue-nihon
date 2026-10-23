// Shared PC/phone status: docs/IMPLEMENTATION-ja.md. Synthetic packets test
// layout only; real inventory and next-command inputs are compared with C/RNG.
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
import {runGame} from '../run-game.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/hud-widgets/after'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=path.join(root,'build/item-use-fixtures.wasm');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],layouts:[],errors:[]};let page,context,cfg,journal;
const snap=()=>page.evaluate(()=>({scene:__rogueBrowserTest.canvas,state:__rogueUiAdapter.state,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function tap(id){await paint();const c=(await snap()).scene.controls.find(c=>c.id===id&&!c.disabled);assert.ok(c,id);const b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(cfg.mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(value){await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);await paint();}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,cfg.label+'-'+name+'.png')});}
async function packet(values){await page.evaluate(values=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args=values.map(value=>({value}));__statusPacket(ui);},values);await paint();}
function layout(s){
 const h=s.scene.hud,settings=s.scene.controls.find(c=>c.id==='settings-toggle').rect;
 assert.equal(h.rows.length,2);assert.equal(h.row.h,48);assert.equal(h.fontSize,17);
 assert.equal(h.row.y+h.row.h/2,settings.y+settings.h/2);assert.ok(h.row.x+h.row.w<=settings.x);
 assert.equal(h.hp.rect.x,h.experience.rect.x);assert.equal(h.hp.rect.w,h.experience.rect.w);assert.equal(h.hp.rect.y+24,h.experience.rect.y);
 for(const a of ['iconRect','textRect','rect']){assert.equal(h.items.armor[a].x,h.items.strength[a].x);assert.equal(h.items.hunger[a].x,h.items.gold[a].x);}
 assert.equal(h.hp.label.iconRect.x+h.hp.label.iconRect.w,h.hp.rect.x-2);
 assert.equal(h.experience.label.iconRect.x+h.experience.label.iconRect.w,h.experience.rect.x-2);
 assert.equal(h.items.depth.rect.y,h.rows[0].y);assert.equal(h.items.gold.rect.y,h.rows[1].y);
 assert.ok(!s.scene.controls.some(c=>c.id.startsWith('hud-')));
 assert.ok(s.scene.controls.some(c=>c.id==='status-open'));
 assert.ok(!s.commands.some(c=>c.op==='box'&&c.rect.x===h.row.x&&c.rect.y===h.row.y&&c.rect.w===h.row.w));
 assert.ok(!s.commands.some(c=>c.op==='text'&&c.text==='StatusCheck'));
 assert.equal(s.scene.icons.find(i=>i.name==='strength').glyph,'💪');assert.equal(s.scene.icons.find(i=>i.name==='level').glyph,'👑');
 const start=s.commands.findIndex(c=>c.op==='clip'&&JSON.stringify(c.rect)===JSON.stringify(h.row));assert.ok(start>=0);
 let depth=1;for(const c of s.commands.slice(start+1)){if(c.op==='restore'&&--depth===0)break;if(c.op==='clip'||c.op==='save')depth++;if(c.op==='text'||c.op==='path')assert.deepEqual(c.outline,{color:'#000',width:2});}
 return h;
}
async function equivalent(){const r=await runGame(wasm,{fixture:'inventory-all',name:'StatusCheck',seed:17,locale:cfg.language,messagePaging:'log',text:journal});assert.deepEqual((await snap()).state.trace.words,r.traces.at(-1).words);assert.equal((await snap()).state.trace.input_index,journal.length);}
try{
 for(cfg of [
  {label:'pc-ja',language:'ja',mobile:false,viewport:{width:1400,height:1050},mode:'pixels',dpr:1},
  {label:'pc-en',language:'en',mobile:false,viewport:{width:900,height:800},mode:'tiles',dpr:2},
  {label:'phone-ja',language:'ja',mobile:true,viewport:{width:390,height:844},mode:'pixels',dpr:2},
  {label:'phone-en',language:'en',mobile:true,viewport:{width:320,height:720},mode:'ascii',dpr:1},
 ]){
  journal='';context=await browser.newContext({viewport:cfg.viewport,isMobile:cfg.mobile,hasTouch:cfg.mobile,deviceScaleFactor:cfg.dpr});
  await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'inventory-all'),contentType:'text/javascript',headers}));
  await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
  page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
  // Only published status packets change; C and the observed map stay untouched.
  await page.addInitScript(()=>{const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__statusPacket=ui=>handler({data:{type:'presentation',ui}});}};});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+cfg.language+'&view='+cfg.mode);
  await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
  for(const [id,value]of[['name','StatusCheck'],['seed','17']]){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
  await tap('new-game');await wait('command');const initial=await snap(),original=initial.state.frame.ui.status.args.map(a=>a.value);
  layout(initial);await shot('status');await equivalent();
  if(!cfg.mobile){
   const pc=initial.scene.hud;
   // Same 420px status region through the phone compositor must be identical.
   await page.setViewportSize({width:484,height:844});await paint();assert.deepEqual((await snap()).scene.hud,pc);
   await page.setViewportSize(cfg.viewport);await paint();
  }
  const before=(await snap()).state.trace;
  for(const [hp,xp,p]of[[0,0,0],[6,5,.5],[12,10,1]]){
   await packet([1,5000,hp,12,18,22,-2,1,xp,'status.hunger.1']);const s=await snap(),h=layout(s);
   assert.equal(h.hp.progress,p);assert.equal(h.experience.progress,p);assert.equal(h.hp.label.text,hp+'/12');assert.equal(h.experience.label.text,'1');
   assert.equal(h.items.strength.text,'18');assert.equal(h.items.armor.text,'-2');assert.equal(h.items.gold.text,'5k');
   if(p===.5)await shot('half-gauges');
  }
  await packet([1,5000,12,12,18,22,-2,2,10,'status.hunger.0']);assert.equal((await snap()).scene.hud.experience.progress,0);assert.equal((await snap()).scene.hud.experience.label.text,'2');
  await tap('status-open');assert.equal((await snap()).scene.scope,'status');
  assert.ok((await snap()).scene.text.includes('18 / 22'));assert.ok((await snap()).scene.text.includes('5000'));assert.ok((await snap()).scene.text.includes('StatusCheck'));await shot('full-status');
  // A movement key while reading the window must not reach the game.
  await key('l');assert.deepEqual((await snap()).state.trace,before);
  if(cfg.mobile)await tap('status-close');else await key('Escape');
  assert.equal((await snap()).scene.scope,'game');assert.deepEqual((await snap()).state.trace,before);
  if(!cfg.mobile){
   for(let i=0;i<12&&(await snap()).scene.pointer.focusId!=='status-open';i++){await key('Tab');}
   assert.equal((await snap()).scene.pointer.focusId,'status-open');await key('Enter');assert.equal((await snap()).scene.scope,'status');await key('Escape');
   await tap('header-fullscreen');await page.waitForFunction(()=>!!document.fullscreenElement);await paint();layout(await snap());await shot('fullscreen');await tap('header-fullscreen');await page.waitForFunction(()=>!document.fullscreenElement);await paint();
  }
  for(const hunger of ['0','1','2','3']){
   await packet([99,2147483647,12345,12345,31,40,-10,21,2147483647,'status.hunger.'+hunger]);layout(await snap());await tap('status-open');assert.ok((await snap()).scene.text.includes('2147483647'));await tap('status-close');
  }
  await packet(original);await tap('settings-toggle');assert.equal((await snap()).scene.scope,'settings');await tap('settings-close');assert.deepEqual((await snap()).state.trace,before);
  await key('i');journal+='i';await wait('space');await shot('inventory');await tap('window-32');journal+=' ';await wait('command');await equivalent();
  await key('.');journal+='.';await page.waitForFunction(n=>__rogueBrowserTest.trace.input_index===n&&!__rogueBrowserTest.queuePending,journal.length);await wait('command');await equivalent();layout(await snap());
  assert.deepEqual((await snap()).state.translationFallbacks,[]);assert.deepEqual((await snap()).state.uiMissing,[]);
  report.checks.push(cfg);report.layouts.push({label:cfg.label,hud:(await snap()).scene.hud});console.log('PASS '+cfg.label);await context.close();context=null;
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'evidence.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();}

// Missing glyph 0 paints a visible box+X, so text presence alone is insufficient.
// Capture real C windows and feed their exact draw text to rogue-raster's font test.
// Contract: docs/IMPLEMENTATION-ja.md (Rust rasterization); fixtures: item-use-fixtures.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {runGame} from '../run-game.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_FONT_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/font-glyphs'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const wasm=path.join(root,'build/item-use-fixtures.wasm'),worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],windows:[],errors:[]},corpus=new Map();
let context,page,cdp,current,fixture,journal;
const name='検証勇者💪👑';
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function tap(id){
 for(let attempt=0;attempt<16;attempt++){
  const s=await snap(),c=s.scene.controls.find(c=>c.id===id&&!c.disabled),b=await page.locator('#rogue-canvas').boundingBox();
  if(c&&c.rect.h>=Math.min(c.fullRect.h,40)){
   const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
   if(current.mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();return;
  }
  const r=s.scene.regions.dialog?.rect;
  if(id.startsWith('item-')&&r){
   const x=b.x+r.x+r.w/2,y=b.y+r.y+r.h-16,d=Math.min(180,r.h-32);
   if(current.mobile){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-d*i/6,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else{await page.mouse.move(x,y);await page.mouse.wheel(0,d);}
  }
  await paint();
 }
 throw Error('Cannot reach '+id);
}
async function key(value){await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);await paint();}
async function open(value){
 await context?.close();fixture=value;journal='';
 context=await browser.newContext({viewport:current.viewport,hasTouch:current.mobile,isMobile:current.mobile,deviceScaleFactor:current.mobile?2:1});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();cdp=await context.newCDPSession(page);page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+current.language+'&view='+current.mode);
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
 for(const [id,value]of [['name',name],['seed','17']]){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
 await capture('top',false);await tap('new-game');
 if(fixture.startsWith('ending-'))await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window&&!__rogueBrowserTest.queuePending);else await wait('command');await paint();
}
async function capture(label,check=true){
 const s=await snap();
 for(const c of s.commands.filter(c=>c.op==='text')){
  const key=JSON.stringify([c.text,c.size,!!c.bold,!!c.mono]);corpus.set(key,{text:c.text,size:c.size,bold:!!c.bold,mono:!!c.mono});
 }
 const prefix=`${current.mobile?'phone':'pc'}-${current.language}-${current.viewport.width}-${current.mode}`;
 await page.screenshot({path:path.join(output,prefix+'-'+label+'.png')});
 assert.equal(s.state.runtimeError,null);assert.deepEqual(s.state.translationFallbacks,[]);assert.deepEqual(s.state.uiMissing,[]);
 if(check){
  assert.ok(!s.commands.some(c=>c.op==='text'&&c.text.includes('↵')),'No unavailable Enter symbol in actual draw commands');
  for(const c of s.scene.controls.filter(c=>c.shortcut==='Enter'))assert.ok(c.label.startsWith('Enter) '),'Enter key is readable: '+c.label);
 }
 report.windows.push({prefix,label,scope:s.scene.scope,controls:s.scene.controls.map(c=>({id:c.id,label:c.label,shortcut:c.shortcut})),text:s.scene.text});return s;
}
async function equivalent(){
 const expected=await runGame(wasm,{fixture,name,seed:17,locale:current.language,messagePaging:'log',text:journal});
 assert.deepEqual((await snap()).state.trace.words,expected.traces.at(-1).words,'C state and RNG');
 assert.equal((await snap()).state.trace.input_index,journal.length);
}
try{
 for(current of [
  {mobile:false,language:'ja',mode:'pixels',viewport:{width:1920,height:1032}},
  {mobile:false,language:'en',mode:'ascii',viewport:{width:600,height:900}},
  {mobile:true,language:'ja',mode:'tiles',viewport:{width:320,height:720}},
  {mobile:true,language:'en',mode:'pixels',viewport:{width:390,height:844}},
 ]){
  for(const ending of ['ending-death','ending-victory']){
   await open(ending);
   for(let i=0;i<6&&!(await snap()).state.topOpen;i++){
    const s=await capture(ending+'-'+i);
    const action=s.scene.controls.find(c=>c.id==='window-32'||c.id==='window-13');
    await tap(action?.id||'result-top');
    await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n||__rogueBrowserTest.topOpen||!__rogueBrowserTest.running,s.state.inputRequestCount);await paint();
   }
   assert.equal((await snap()).state.topOpen,true);
  }
  await open('inventory-all');
  await key('I');journal+='I';await wait('item');await tap('item-j');journal+='j';await wait('command');await capture('staff-log');
  await tap('history-open');const log=await capture('staff-history');
  // The charge marker is an intentional vector battery, independent of fonts.
  const charge=log.scene.icons.find(i=>i.name==='item-charges');assert.ok(charge,'Charge icon appears in history');
  assert.ok(log.commands.some(c=>c.op==='path'&&c.rect.x===charge.rect.x&&c.rect.y===charge.rect.y&&c.path==='M2 6H20V18H2ZM20 10H23V14H20M6 9V15M10 9V15M14 9V15'));
  await tap('history-close');await equivalent();
  if(current.mobile)await tap('touch-action-action.inventory');else await key('i');journal+='i';await wait('space');await capture('inventory');
  await tap('item-c');await capture('actions');await tap('window-118');await capture('details');await tap('window-27');await tap('window-27');await tap('window-32');journal+=' ';await wait('command');
  await key('c');journal+='c';await wait('item');await tap('item-c');journal+='c';await wait('text');await capture('text-submit');await tap('window-27');journal+='\x1b';await wait('command');
  await tap('settings-toggle');const before=(await snap()).state.trace;await capture('settings');await tap('select-display-mode');await capture('dropdown');await tap('select-display-mode-'+current.mode);await tap('settings-close');assert.deepEqual((await snap()).state.trace,before);
  if(current.mobile)await tap('touch-.');else await key('.');journal+='.';await wait('command');await equivalent();
  report.checks.push(current);console.log('PASS '+JSON.stringify(current));
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{
 await writeFile(path.join(output,'draw-text.json'),JSON.stringify([...corpus.values()],null,2));
 await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
 await context?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();
}

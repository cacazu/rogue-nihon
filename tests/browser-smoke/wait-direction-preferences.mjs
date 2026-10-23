import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
import {runGame} from '../run-game.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_WAIT_CONTROLS_OUTPUT?path.resolve(process.env.ROGUE_WAIT_CONTROLS_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/wait-direction-preferences'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.ROGUE_WAIT_CONTROLS_BASE||'http://127.0.0.1:'+server.address().port;
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let runtime,browser,context,page,mobile;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const snapshot=()=>page.evaluate(async()=>JSON.parse((await import('/build/browser-ui.js')).browser_snapshot()));
const idle=()=>page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame?.ui.input.kind==='command');
async function control(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls.some(c=>c.id===id&&!c.disabled),id);
 const rect=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id).rect,id),canvas=await page.locator('#rogue-canvas').boundingBox();
 return {x:canvas.x+rect.x+rect.w/2,y:canvas.y+rect.y+rect.h/2,rect};
}
async function tap(id){const {x,y}=await control(id);if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(value){const before=(await snapshot()).state.inputRequestCount;await page.keyboard.press(value);await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,before);await paint();}
async function shot(label){const file=label+'.png';await page.screenshot({path:path.join(output,file)});report.screenshots.push(file);}
async function open({width=1240,mode='tiles',fixture='pickup-quantity',fresh=false}={}){
 await context?.close();mobile=width<700;
 context=await browser.newContext({viewport:{width,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,ignoreHTTPSErrors:true});
 await context.route('**/web/worker.js',route=>route.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',route=>route.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base+'/?trace=1&lang=ja'+(fresh?'':'&view='+mode));await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
 await page.locator('#seed').fill('17');await tap('new-game');await idle();await paint();
}
async function pixels(){
 const sample=await page.evaluate(()=>{
  const pose=__rogueBrowserTest.diagnostics.animation?.find(a=>a.id===0);
  const command=__rogueBrowserTest.commands.find(c=>c.op==='image'&&c.image?.startsWith('animations-v1/actor.player/'));
  if(!command)throw Error('Player image is not painted');
  const canvas=document.getElementById('rogue-canvas'),ratio=canvas.width/canvas.getBoundingClientRect().width,r=command.rect;
  return {pose,image:command.image,bytes:Array.from(canvas.getContext('2d').getImageData(Math.round(r.x*ratio),Math.round(r.y*ratio),Math.round(r.w*ratio),Math.round(r.h*ratio)).data)};
 });
 return {...sample,bytes:undefined,hash:createHash('sha256').update(Buffer.from(sample.bytes)).digest('hex')};
}
async function waitPaused(value){await page.waitForFunction(value=>__rogueBrowserTest.diagnostics.animation?.find(a=>a.id===0)?.stopped===value,value);}
async function holdPointer(width,mode){
 await open({width,mode});const label='wait-'+width+'-'+mode;
 await shot(label+'-before');const before=(await snapshot()).state;
 const {x,y}=await control('touch-.');const cdp=await context.newCDPSession(page);
 if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});else{await page.mouse.move(x,y);await page.mouse.down();}
 await waitPaused(true);const samples=[];
 for(let n=0;n<4;n++){samples.push({step:(await snapshot()).state.frame.map_actor_step,...await pixels()});await page.waitForTimeout(160);}
 await shot(label+'-held');
 if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
 await waitPaused(false);await idle();const released=(await snapshot()).state;
 await shot(label+'-released');await page.waitForTimeout(350);assert.deepEqual((await snapshot()).state.trace,released.trace,'Release adds no game turn');
 assert.equal(new Set(samples.map(s=>s.hash)).size,1,'Actual player pixels stay fixed during wait hold');
 assert.ok(samples.at(-1).step>samples[0].step,'Real C turns continue while pixels are fixed');
 const resumed=new Set();for(let n=0;n<5;n++){resumed.add((await pixels()).hash);await page.waitForTimeout(140);}
 assert.ok(resumed.size>=2,'Released player resumes real animated pixels');
 const consumed=released.trace.input_index-before.trace.input_index;
 const reference=await runGame(path.join(root,'build/game-fixtures.wasm'),{fixture:'pickup-quantity',seed:17,name:'Player',locale:'ja',messagePaging:'log',text:'.'.repeat(consumed)});
 assert.deepEqual(released.trace.words,reference.traces.at(-1).words,'Same wait keys preserve C/RNG');
 report.checks.push({label,consumed,before:before.trace,after:released.trace,samples});
}
async function holdKeyboard(){
 await open();
 for(const keyName of ['.','Numpad5','Enter',' ']){
  if(keyName==='Enter'||keyName===' '){
   await page.keyboard.press('Tab');
   for(let n=0;n<70&&(await snapshot()).diagnostics.pointer.focusId!=='touch-.';n++)await page.keyboard.press('Tab');
   // The focus path is rendered and exposed through pointer diagnostics.
   await page.evaluate(()=>{if(__rogueBrowserTest.canvas.pointer.focusId!=='touch-.')throw Error('Wait button was not reached by Tab');});
  }
  await page.keyboard.down(keyName);await page.waitForTimeout(80);await waitPaused(false);
  await page.keyboard.down(keyName);await waitPaused(true);const first=await pixels();
  for(let n=0;n<3;n++){await page.keyboard.down(keyName);await page.waitForTimeout(100);assert.equal((await pixels()).hash,first.hash);}
  await page.keyboard.up(keyName);await waitPaused(false);
  report.checks.push({label:'keyboard-wait-'+keyName,trace:(await snapshot()).state.trace});
 }
 await page.keyboard.down('.');await page.keyboard.down('.');await waitPaused(true);await page.keyboard.press('l');await waitPaused(false);await page.keyboard.up('.');
 for(const event of ['blur','pagehide']){
  await page.keyboard.down('.');await page.keyboard.down('.');await waitPaused(true);
  await page.evaluate(event=>window.dispatchEvent(new Event(event)),event);
  if(event==='pagehide'){
   // pagehide closes the real input queue, so the Worker exits and removes
   // the player pose instead of publishing an unpaused pose.
   await page.waitForFunction(()=>!__rogueBrowserTest.running&&__rogueBrowserTest.diagnostics.animation?.length===0);
   await page.keyboard.up('.');await paint();const ended=(await snapshot()).state;
   await page.waitForTimeout(350);const settled=(await snapshot()).state;
   assert.deepEqual(settled.trace,ended.trace,'Pagehide adds no input after Worker exit');
   assert.equal(settled.inputRequestCount,ended.inputRequestCount,'Pagehide leaves no held input requests');
   report.checks.push({label:'keyboard-wait-pagehide',trace:ended.trace});
  }else{
   await waitPaused(false);await page.keyboard.up('.');
   report.checks.push({label:'keyboard-wait-'+event,trace:(await snapshot()).state.trace});
  }
 }
}
function highlighted(snap,id){
 const r=snap.diagnostics.controls.find(c=>c.id===id).fullRect;
 return snap.commands.some(c=>c.op==='box'&&c.rect.x===r.x&&c.rect.y===r.y&&c.rect.w===r.w&&c.rect.h===r.h&&c.fill==='#ffffff');
}
async function direction(width,pad=true){
 await open({width,fixture:'inventory-all'});const label='direction-'+width+(pad?'':'-modal');
 if(!pad){await tap('settings-toggle');await tap('mobile-controls');}
 if(pad){await shot(label+'-normal');assert.ok(!highlighted(await snapshot(),'touch-h'));}
 const before=(await snapshot()).state;await key('t');const aimed=await snapshot();
 for(const keyName of ['h','j','k','l','y','u','b','n'])assert.ok(highlighted(aimed,pad?'touch-'+keyName:'window-'+keyName.charCodeAt(0)),'Direction candidate uses a solid contrasting highlight');
 const cancel=pad?(mobile?'touch-action-action.cancel':'pc-cancel'):'window-27';assert.ok(!highlighted(aimed,cancel));
 assert.deepEqual(aimed.state.frame.player,before.frame.player);await shot(label+'-aiming');
 await key('Escape');await idle();await shot(label+'-cancelled');
 if(pad)assert.ok(!highlighted(await snapshot(),'touch-h'));
 report.checks.push({label,before:before.trace,aiming:aimed.state.trace,after:(await snapshot()).state.trace});
}
async function preferences(width){
 await open({width,fresh:true});assert.equal((await snapshot()).state.displayMode,'tiles');
 for(const mode of ['ascii','pixels','tiles']){
  await tap('settings-toggle');await tap('select-display-mode');await tap('select-display-mode-'+mode);await tap('settings-close');
  assert.equal((await snapshot()).state.displayMode,mode);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rogue-map-display-v1')).mode),mode);
  await tap('settings-toggle');await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen&&!__rogueBrowserTest.savePending);
  await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);assert.equal((await snapshot()).state.displayMode,mode);
  await tap('load');await idle();assert.equal((await snapshot()).state.displayMode,mode);await key('.');
  report.checks.push({label:'preference-'+width+'-'+mode,trace:(await snapshot()).state.trace});
 }
 await page.goto(base+'/?trace=1&view=ascii');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);assert.equal((await snapshot()).state.displayMode,'ascii');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rogue-map-display-v1')).mode),'tiles','Explicit URL mode does not overwrite saved selection');
}
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const width of [1240,390])for(const mode of ['tiles','pixels'])await holdPointer(width,mode);
 await holdKeyboard();
 for(const width of [1240,390,320]){await direction(width);await direction(width,false);await preferences(width);}
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}
for(const check of report.checks)console.log('PASS '+check.label);

import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
import {runGame} from '../run-game.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_AUTOWALK_OUTPUT?path.resolve(process.env.ROGUE_AUTOWALK_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/autowalk'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.ROGUE_AUTOWALK_BASE||'http://127.0.0.1:'+server.address().port;
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let runtime,browser,context,page,mobile;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const snap=()=>page.evaluate(()=>__rogueUiAdapter.state);
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls.some(c=>c.id===id&&!c.disabled),id);
 const r=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id).rect,id),b=await page.locator('#rogue-canvas').boundingBox();
 if(mobile)await page.touchscreen.tap(b.x+r.x+r.w/2,b.y+r.y+r.h/2);else await page.mouse.click(b.x+r.x+r.w/2,b.y+r.y+r.h/2);
 await paint();
}
async function shot(label){const file=label+'.png';await page.screenshot({path:path.join(output,file)});report.screenshots.push(file);}
async function open(fixture='autowalk-clear',touch=false,mode='pixels'){
 await context?.close();mobile=touch;
 context=await browser.newContext({viewport:{width:mobile?390:1240,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1,ignoreHTTPSErrors:true});
 if(fixture){
  await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
  await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 }
 await context.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__walkTimeline=[];
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',e=>{if(['frame','input-request','player-event'].includes(e.data.type))window.__walkTimeline.push({type:e.data.type,kind:e.data.kind,sequence:e.data.sequence,at:performance.now(),player:e.data.player});});}};
 });
 page=await context.newPage();await installBrowserTestAdapter(page);page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base+'/?trace=1&lang=ja&view='+mode);await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
 await page.locator('#seed').fill(fixture?.startsWith('autowalk-dragon')?'0':fixture?'17':'12345');await tap('new-game');await idle();
}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame?.ui.input.kind==='command');await paint();}
async function cell(x,y){
 const p=await page.evaluate(({x,y})=>{const s=__rogueBrowserTest.canvas,c=s.camera,r=s.mapRect;return {x:r.x+(x+.5)*c.size-c.left,y:r.y+(y-.5)*c.cellH-c.top};},{x,y});
 // camera uses a square cell; older test diagnostics call the height cell_h.
 if(!Number.isFinite(p.y))p.y=await page.evaluate(y=>{const s=__rogueBrowserTest.canvas,c=s.camera;return s.mapRect.y+(y-.5)*c.size-c.top;},y);
 const b=await page.locator('#rogue-canvas').boundingBox();return {x:b.x+p.x,y:b.y+p.y};
}
async function target(x,y){const p=await cell(x,y);if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);await paint();}
async function stopped(reason){await page.waitForFunction(reason=>!__rogueUiAdapter.state.autowalk.active&&__rogueUiAdapter.state.autowalk.reason===reason,reason);await idle();}
async function stable(){const s=await snap();await page.waitForTimeout(350);const a=await snap();assert.deepEqual(a.trace,s.trace,'Stopped walk produces no further C turn');return a;}
async function reference(fixture,s,keys){
 const r=await runGame(path.join(root,'build/game-fixtures.wasm'),{fixture,seed:fixture.startsWith('autowalk-dragon')?0:17,name:'Player',locale:'ja',messagePaging:'log',text:keys});
 assert.deepEqual(s.trace.words,r.traces.at(-1).words,'Auto keys and same ordinary consumed keys preserve all C/RNG words');
}
async function check(label,fn){await fn();report.checks.push(label);console.log('PASS '+label);}
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const touch of [false,true])for(const mode of ['pixels','tiles','ascii'])await check((touch?'mobile':'pc')+' '+mode+' arrival and cadence',async()=>{
  await open('autowalk-clear',touch,mode);const before=await snap(),x=touch?15:18;
  await shot((touch?'mobile':'pc')+'-'+mode+'-before');await target(x,10);
  await page.waitForFunction(()=>__rogueBrowserTest.frame.player.x>10);await shot((touch?'mobile':'pc')+'-'+mode+'-walking');
  await stopped('arrived');const after=await stable();assert.deepEqual(after.frame.player,{x,y:10});
  const consumed=after.trace.input_index-before.trace.input_index;assert.equal(consumed,x-10);await reference('autowalk-clear',after,'l'.repeat(consumed));
  const timeline=await page.evaluate(()=>__walkTimeline.filter(e=>e.type==='input-request'));
  const times=timeline.slice(-consumed).map(e=>e.at);for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=80,'Walk leaves time for real interruption');
  await shot((touch?'mobile':'pc')+'-'+mode+'-arrived');
 });
 for(const [fixture,reason,goal] of [['autowalk-gaze-hit','attacked',11],['autowalk-gaze-miss','attacked',11],['autowalk-dragon-hit','attacked',15],['autowalk-dragon-miss','attacked',15],['autowalk-miss','attacked',15],['autowalk-hit','attacked',15],['autowalk-invisible','attacked',15],['autowalk-trap','trap',15],['autowalk-teleport','trap',15],['autowalk-trapdoor','trap',15],['autowalk-enemy','attack',14],['autowalk-blocked','blocked',15]])await check(fixture+' interruption',async()=>{
  await open(fixture);const before=await snap();await target(goal,10);await stopped(reason);const s=await stable();
  const consumed=s.trace.input_index-before.trace.input_index;assert.ok(consumed>=1&&consumed<goal-10+1);await reference(fixture,s,'l'.repeat(consumed));
  if(fixture==='autowalk-hit'||fixture==='autowalk-dragon-hit')assert.ok(s.frame.stats.hp<before.frame.stats.hp,'Hit fixture actually loses HP');
  if(fixture==='autowalk-miss'||fixture==='autowalk-invisible'||fixture==='autowalk-dragon-miss')assert.equal(s.frame.stats.hp,before.frame.stats.hp,'Miss stops without HP loss');
  if(reason==='attacked'||reason==='trap'||reason==='attack'){
   const events=await page.evaluate(()=>__walkTimeline);const i=events.findIndex(e=>e.type==='player-event'&&e.kind===reason);
   assert.ok(i>=0);assert.ok(events.slice(i+1).some(e=>e.type==='input-request'),'Semantic stop is delivered before following input wait');
   assert.deepEqual(Object.keys(s.playerEvents.at(-1)).sort(),['kind','sequence','type'],'No hidden attacker identity, position or trap type');
  }
  await shot(fixture+'-stopped');
 });
 for(const touch of [false,true])for(const operation of ['key','pad','settings','inventory','blur','enqueue'])await check((touch?'mobile':'pc')+' cancel '+operation,async()=>{
  await open('autowalk-clear',touch);await target(15,10);await page.waitForFunction(()=>__rogueBrowserTest.frame.player.x>10);
  if(operation==='key')await page.keyboard.press('s');
  if(operation==='pad')await tap('touch-.');
  if(operation==='settings')await tap('settings-toggle');
  if(operation==='inventory')await page.keyboard.press('i');
  if(operation==='enqueue')await page.evaluate(()=>__rogueBrowserTest.enqueue(115));
  if(operation==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(()=>!__rogueUiAdapter.state.autowalk.active);await paint();
  if(operation==='settings')await tap('settings-close');if(operation==='inventory')await page.keyboard.press('Escape');
  await idle();await stable();
 });
 await check('manual queue then click waits for a fresh input boundary',async()=>{
  await open();const p=await cell(18,10),before=await snap();
  await page.evaluate(()=>__rogueBrowserTest.enqueueMany([108,108,108]));
  await page.mouse.click(p.x,p.y);await paint();const pending=await snap();
  assert.equal(pending.autowalk.active,true);const goal=pending.autowalk.target;
  await stopped('arrived');const after=await stable();assert.deepEqual(after.frame.player,goal);
  await reference('autowalk-clear',after,'l'.repeat(after.trace.input_index-before.trace.input_index));
 });
 await check('cancelled and retired timers cannot advance or cancel a later walk',async()=>{
  await open();await target(18,10);const prior=await snap(),timer=prior.autowalk.scheduled;assert.ok(timer);
  await page.keyboard.press('s');await idle();
  await page.evaluate(({timer,generation})=>__rogueUiAdapter.dispatch({type:'autowalk-tick',token:timer.token,generation}),{timer,generation:prior.generation});
  await stable();await target(18,10);const current=await snap();assert.equal(current.autowalk.active,true);
  await page.evaluate(({generation,token})=>__rogueUiAdapter.dispatch({type:'autowalk-tick',token,generation}),{generation:current.generation,token:timer.token});
  assert.equal((await snap()).autowalk.active,true);
  await page.evaluate(generation=>__rogueUiAdapter.dispatch({type:'autowalk-tick',token:1,generation}),current.generation-1);
  assert.equal((await snap()).autowalk.active,true);await stopped('arrived');
 });
 await check('game end stops movement without waiting for a command prompt',async()=>{
  await open('autowalk-death');await target(15,10);
  await page.waitForFunction(()=>['death','tombstone','score'].includes(__rogueBrowserTest.frame.ui.mode));
  assert.equal((await snap()).autowalk.active,false);await stable();await shot('game-end');
 });
 await check('new Worker load has no old route or timer',async()=>{
  await open();await target(18,10);const old=await snap();await page.waitForFunction(()=>__rogueBrowserTest.frame.player.x>10);
  await tap('settings-toggle');await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen&&!__rogueBrowserTest.savePending);
  await tap('load');await idle();const restored=await snap();assert.equal(restored.autowalk.active,false);assert.ok(restored.generation>old.generation);
  await stable();await target(18,10);assert.equal((await snap()).autowalk.active,true);
  await page.evaluate(generation=>__rogueUiAdapter.dispatch({type:'autowalk-tick',generation,token:1}),old.generation);
  assert.equal((await snap()).autowalk.active,true);await stopped('arrived');
 });
 await check('touch pan and pinch are UI only',async()=>{
  await open('autowalk-clear',true);const before=(await snap()).trace,cdp=await context.newCDPSession(page),a=await cell(10,10);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+70,y:a.y+30}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();assert.deepEqual((await snap()).trace,before);
  const p=[{x:100,y:300},{x:250,y:300}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:p});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:300},{x:270,y:300}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();assert.deepEqual((await snap()).trace,before);assert.equal((await snap()).autowalk.active,false);
 });
 await check('unknown target and wall produce no C input',async()=>{
  await open('animation-dark');const before=await snap(),f=before.frame;
  const points=await page.evaluate(()=>{const s=__rogueBrowserTest.canvas,c=s.camera,r=s.mapRect,f=__rogueBrowserTest.frame;return Array.from(f.map_cells,(glyph,i)=>({glyph,x:i%f.width,y:Math.floor(i/f.width)})).filter(p=>p.y>0&&p.y<f.height-1&&r.x+(p.x+.5)*c.size-c.left>r.x+60&&r.x+(p.x+.5)*c.size-c.left<r.x+r.w-30&&r.y+(p.y-.5)*c.size-c.top>r.y+100&&r.y+(p.y-.5)*c.size-c.top<r.y+r.h-30);});
  for(const group of [' ','-|']){const p=points.find(p=>group.includes(p.glyph));assert.ok(p,'Visible viewport has a target for '+group);await target(p.x,p.y);await page.waitForTimeout(250);assert.deepEqual((await snap()).trace,before.trace);assert.equal((await snap()).autowalk.active,false);}
 });
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;report.debug=await snap().catch(()=>null);report.scene=await page.evaluate(()=>__rogueBrowserTest.canvas).catch(()=>null);report.timeline=await page.evaluate(()=>__walkTimeline).catch(()=>null);await shot('failure').catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}

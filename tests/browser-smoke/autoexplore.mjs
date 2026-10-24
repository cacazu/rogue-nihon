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
const output=process.env.ROGUE_AUTOEXPLORE_OUTPUT?path.resolve(process.env.ROGUE_AUTOEXPLORE_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/autoexplore'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.ROGUE_AUTOEXPLORE_BASE||'http://127.0.0.1:'+server.address().port;
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const filter=process.env.ROGUE_AUTOEXPLORE_FILTER;
const report={checks:[],skipped:[],screenshots:[],errors:[],filter:filter||null};
let runtime,browser,context,page,mobile;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const snap=()=>page.evaluate(()=>__rogueUiAdapter.state);
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls.some(c=>c.id===id&&!c.disabled),id);
 const r=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id).rect,id),b=await page.locator('#rogue-canvas').boundingBox();
 if(mobile)await page.touchscreen.tap(b.x+r.x+r.w/2,b.y+r.y+r.h/2);else await page.mouse.click(b.x+r.x+r.w/2,b.y+r.y+r.h/2);
 await paint();
}
async function open(fixture='autoexplore-clear',touch=false){
 await context?.close();mobile=touch;
 context=await browser.newContext({viewport:{width:mobile?390:1240,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1,ignoreHTTPSErrors:true});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 await context.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__explorePositions=[];
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);let player;this.addEventListener('message',e=>{
   if(e.data.type==='frame')player=e.data.player;
   if(e.data.type==='input-request'&&player)window.__explorePositions.push({...player});
  });}};
 });
 page=await context.newPage();await installBrowserTestAdapter(page);page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base+'/?trace=1&lang=ja&view=pixels');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
 await page.locator('#seed').fill('17');await tap('new-game');await idle();
}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame?.ui.input.kind==='command');await paint();}
async function explore(){if(mobile)await tap('touch-explore');else await page.keyboard.press('v');await paint();}
async function stopped(reason){await page.waitForFunction(reason=>!__rogueUiAdapter.state.autowalk.active&&__rogueUiAdapter.state.autowalk.reason===reason,reason);await idle();}
async function stable(){const s=await snap();await page.waitForTimeout(350);assert.deepEqual((await snap()).trace,s.trace,'Stopped exploration does not consume more input');return s;}
async function completion(s){
 const entries=s.entries.filter(e=>e.id==='explore.complete');assert.equal(entries.length,1,'Completion is logged exactly once');assert.equal(entries[0].text,'全て探索した');
 const painted=await page.evaluate(()=>__rogueBrowserTest.commands.filter(c=>c.op==='text').map(c=>c.text).join(''));assert.ok(painted.includes('全て探索した'),'Completion is painted in the actual log');
}
async function shot(label){const name=label+'.png';await page.screenshot({path:path.join(output,name)});report.screenshots.push(name);}
async function check(label,fn){if(filter&&!new RegExp(filter).test(label)){report.skipped.push(label);return;}await fn();report.checks.push(label);console.log('PASS '+label);}
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const touch of [false,true])await check((touch?'phone':'pc')+' dark-room exploration reveals every reachable square and collects every item',async()=>{
  await open('autoexplore-clear',touch);const before=await snap();
  assert.equal(before.frame.map_cells[12*80+14],' ','Distant food is initially unpublished');
  await explore();await stopped('complete');const after=await stable(),f=after.frame;
  await completion(after);assert.equal(f.player.x,15);assert.equal(f.player.y,12,'After exploring, return to the known reachable stairs');assert.equal(f.map_player_surface?.tile,6,'Stop on stairs without descending');assert.equal(f.map_actor_epoch,before.frame.map_actor_epoch,'Exploration never descends');
  for(let y=9;y<=13;y++)for(let x=9;x<=15;x++)assert.notEqual(f.map_cells[y*80+x],' ','Reachable dark floor is now remembered');
  assert.ok(!f.map_cells.includes(':'),'Every published food was picked up');assert.notEqual(f.map_player_surface?.tile,17);
  assert.ok(f.map_cells.split('').some((ch,i)=>ch==='.'&&!f.map_visible[i]),'Previously seen floor survives outside current view');
  const positions=await page.evaluate(()=>__explorePositions),keys=[];
  const directions={'-1,0':'h','0,1':'j','0,-1':'k','1,0':'l','-1,-1':'y','1,-1':'u','-1,1':'b','1,1':'n'};
  for(let i=1;i<positions.length;i++){
   const a=positions[i-1],b=positions[i],key=directions[[b.x-a.x,b.y-a.y].join(',')];
   assert.ok(key,'Successful pickup leaves no extra comma or idle command');keys.push(key);
  }
  assert.ok(keys.length>4);assert.equal(after.trace.input_index-before.trace.input_index,keys.length);
  const reference=await runGame(path.join(root,'build/game-fixtures.wasm'),{fixture:'autoexplore-clear',seed:17,name:'Player',locale:'ja',messagePaging:'log',text:keys.join('')});
  assert.deepEqual(after.trace.words,reference.traces.at(-1).words,'Exploration matches exactly the same ordinary C movement and RNG');
  report[touch?'phonePath':'pcPath']=keys.join('');await shot(touch?'phone-complete':'pc-complete');
 });
 for(const side of ['right','left'])await check('loop '+side+' nearby branch beats distant item and sealed areas do not prevent completion',async()=>{
  await open('autoexplore-loop-'+side);const before=await snap();assert.equal(before.frame.map_cells[8*80+(side==='right'?19:9)],' ');
  await explore();await stopped('complete');const after=await stable(),positions=await page.evaluate(()=>__explorePositions);
  assert.equal(positions[1].x,side==='right'?17:11,'First real move uses the short side toward the nearby branch');assert.equal(positions[1].y,12);
  for(let x=side==='right'?19:6;x<=(side==='right'?22:9);x++)assert.notEqual(after.frame.map_cells[8*80+x],' ','The nearby branch is fully observed');
  assert.notEqual(after.frame.map_cells[8*80+(side==='right'?10:18)],':','The reachable distant item is eventually collected');
  assert.equal(after.frame.map_cells[12*80+30],':','The unreachable published item remains');assert.equal(after.frame.map_cells[9*80+14],'|','The reachable secret entrance remains an undiscovered wall');assert.equal(after.frame.map_cells[10*80+14],' ','The secret region remains unpublished');
  await completion(after);assert.equal(after.frame.player.x,14);assert.equal(after.frame.player.y,12);assert.equal(after.frame.map_player_surface.tile,6);assert.equal(after.frame.map_actor_epoch,before.frame.map_actor_epoch,'Stairs never descend automatically');
  await shot('loop-'+side+'-complete');
 });
 await check('visible enemy stops before another movement and refuses restart while in view',async()=>{
  await open('autoexplore-enemy');await explore();await stopped('enemy');const after=await stable();
  assert.ok(after.frame.map_actors.some(a=>a.id!==0&&after.frame.map_visible[a.y*80+a.x]));
  assert.ok(!after.playerEvents.some(e=>e.kind==='attack'),'Exploration never attacks a seen enemy');
  const before=after.trace;await explore();await stopped('enemy');assert.deepEqual((await snap()).trace,before);await shot('visible-enemy-stop');
 });
 await check('capacity failure retries pickup once, stops, and explicit restart can retry',async()=>{
  await open('autoexplore-full');const before=await snap();await explore();await stopped('pickup');const after=await stable();
  assert.equal(after.trace.input_index-before.trace.input_index,2,'One ordinary step plus one explicit pickup attempt');
  assert.equal(after.frame.map_player_surface.tile,17);assert.ok(after.messages.some(m=>m.args?.some(part=>part.kind==='message_part'&&part.value?.id==='pack.pack_room.no_room')),'Original capacity message remains visible');
  await explore();await stopped('pickup');assert.equal((await stable()).trace.input_index-after.trace.input_index,1);await shot('full-pack-stop');
 });
 await check('trap event cancels the shared scheduled exploration',async()=>{
  await open('autoexplore-trap');await explore();await stopped('trap');assert.ok((await stable()).playerEvents.some(e=>e.kind==='trap'));
 });
 await check('manual input interrupts the return to stairs without duplicating completion or leaking steps',async()=>{
  await open('autoexplore-loop-right');const before=await snap();await explore();
  await page.waitForFunction(()=>__rogueUiAdapter.state.autowalk.returning===true);
  const returning=await snap();assert.equal(returning.autowalk.active,true);await completion(returning);
  await page.keyboard.press('.');await stopped('input');const after=await stable();await completion(after);
  assert.equal(after.frame.map_actor_epoch,before.frame.map_actor_epoch,'Interrupting the return never descends');await shot('return-manual-stop');
 });
 await check('manual input stops with no stale steps and explicit exploration resumes',async()=>{
  await open();await explore();await page.waitForFunction(()=>__rogueBrowserTest.frame.player.x!==10||__rogueBrowserTest.frame.player.y!==10);
  await page.keyboard.press('.');await stopped('input');await stable();
  await explore();await stopped('complete');await stable();
 });
 await check('save and new Worker restore preserve public memory but discard exploration and timers',async()=>{
  await open();await explore();await page.waitForFunction(()=>__rogueBrowserTest.frame.player.x>=12);
  await tap('settings-toggle');const before=await snap();await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen&&!__rogueBrowserTest.savePending);
  await tap('load');await idle();const restored=await stable();
  assert.ok(restored.generation>before.generation);assert.equal(restored.autowalk.active,false);
  for(let i=0;i<before.frame.map_cells.length;i++)if('.#+-%^:!?)]=/,'.includes(before.frame.map_cells[i]))assert.notEqual(restored.frame.map_cells[i],' ');
  await page.evaluate(generation=>__rogueUiAdapter.dispatch({type:'autowalk-tick',generation,token:1}),before.generation);
  assert.deepEqual((await snap()).trace,restored.trace);await explore();await stopped('complete');
 });
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;report.debug=page?await snap().catch(()=>null):null;report.scene=page?await page.evaluate(()=>__rogueBrowserTest.canvas).catch(()=>null):null;await shot('failure').catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}

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
import {createPreviewServer} from '../../../tools/server.mjs';

// This scenario observes real C moves/hits, Rust clips and completed Canvas pixels.
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_ANIMATION_OUTPUT?path.resolve(process.env.ROGUE_ANIMATION_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/character-animation'));
await mkdir(output,{recursive:true});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[],poses:[]};
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let runtime,browser,context,page;
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,inputs:__rogueBrowserTest.trace.input_index,requests:__rogueBrowserTest.inputRequestCount,generation:__rogueBrowserTest.generation,frame:__rogueBrowserTest.frame,enabled:__rogueBrowserTest.diagnostics.animationEnabled,animation:__rogueBrowserTest.diagnostics.animation}));
const idle=()=>page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame?.ui.input.kind==='command');
async function tap(id,mobile=false){
 const button=page.locator('[data-control="'+id+'"]:not([disabled])');await button.waitFor();
 if(mobile){const box=await button.boundingBox();assert.ok(box,id);await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);}else await button.click();
}
async function key(value,command=true){const before=(await state()).requests;await page.keyboard.press(value);await page.waitForFunction(before=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.inputRequestCount>before,before);if(command)await idle();}
async function pose(id,kind,frame=null,freeze=false){
 await page.waitForFunction(({id,kind,frame,freeze})=>{
  const found=__rogueBrowserTest.diagnostics.animation?.some(a=>a.id===id&&a.state===kind&&(frame===null||a.frame===frame));
  if(found&&freeze)window.__animationFrozenAt=window.__animationLastNow;
  return found;
 },{id,kind,frame,freeze});
 const observation=await state();report.poses.push({id,kind,frame,actors:observation.frame.map_actors,words:observation.words});
}
async function shot(name){try{await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}finally{await page.evaluate(()=>{window.__animationFrozenAt=null;});}}
async function open(mode,mobile=false,fixture='animation'){
 await context?.close();context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1240,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
 await context.addInitScript(()=>{
  const now=Date.now;
  // Freeze only the main-thread presentation clock for a stable screenshot.
  // The original C Worker and its input/RNG clock stay independent.
  Date.now=()=>window.__animationFrozenAt??(window.__animationLastNow=now());
  for(const name of ['fillRect','strokeRect','fillText','strokeText','measureText','drawImage','beginPath','arc','roundRect','fill','stroke','clip','rotate','scale','translate'])CanvasRenderingContext2D.prototype[name]=()=>{throw Error('JavaScript drawing forbidden: '+name);};
 });
 await context.route('**/web/worker.js',route=>route.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',route=>route.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Rust browser host'))report.errors.push(message.text());});
 await page.goto(base+'/?trace=1&lang=ja&view='+mode);
 await page.locator('[data-control="new-game"]').waitFor();await page.locator('#name').fill('Animation');await page.locator('#seed').fill('17');await tap('new-game',mobile);
 await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.frame?.map_actors?.some(a=>a.id===0));await idle();
}
function unchanged(before,after,label){assert.deepEqual(after.words,before.words,label+' C/RNG');assert.equal(after.inputs,before.inputs,label+' journal');assert.equal(after.requests,before.requests,label+' input requests');}
async function idlePixels(){
 const hashes=[];
 for(const frame of [0,1,2]){
  await pose(0,'idle',frame);
  const pixels=await page.evaluate(()=>{
   const command=__rogueBrowserTest.commands.find(c=>c.op==='image'&&c.image.startsWith('animations-v1/actor.player/idle.'));
   if(!command)throw Error('Animated player image was not drawn');
   const canvas=document.getElementById('rogue-canvas'),ratio=canvas.width/canvas.getBoundingClientRect().width,r=command.rect;
   return {image:command.image,bytes:Array.from(canvas.getContext('2d').getImageData(Math.round(r.x*ratio),Math.round(r.y*ratio),Math.round(r.w*ratio),Math.round(r.h*ratio)).data)};
  });
  assert.equal(pixels.image,'animations-v1/actor.player/idle.'+(frame+1)+'.png');
  hashes.push(createHash('sha256').update(Buffer.from(pixels.bytes)).digest('hex'));
 }
 assert.ok(new Set(hashes).size>=2,'Idle frames change the actual Canvas pixels');
 return hashes;
}
async function moving(id,targetX,fromX,freeze=false){
 await page.waitForFunction(({id,targetX,fromX,freeze})=>{
  const a=__rogueBrowserTest.diagnostics.animation?.find(a=>a.id===id);
  const found=a?.x===targetX&&a.displayX>Math.min(targetX,fromX)&&a.displayX<Math.max(targetX,fromX);
  if(found&&freeze)window.__animationFrozenAt=window.__animationLastNow;
  return found;
 },{id,targetX,fromX,freeze});
 return (await state()).animation.find(a=>a.id===id);
}
async function staticPixels(){return createHash('sha256').update(await page.evaluate(()=>document.getElementById('rogue-canvas').toDataURL())).digest('hex');}
async function settingsSwitch(mode,mobile=false){
 const before=await state();await tap('settings-toggle',mobile);
 await page.locator('[data-control="animation-toggle"][aria-checked="true"]').waitFor();
 await tap('animation-toggle',mobile);await page.locator('[data-control="animation-toggle"][aria-checked="false"]').waitFor();
 assert.equal((await state()).enabled,false);unchanged(before,await state(),'Switch animation off');await shot(mode+'-settings-off');
 await tap('settings-close',mobile);await page.locator('[data-control="settings-close"]').waitFor({state:'detached'});await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animation.every(a=>a.animated===false));
 const still=await staticPixels();await page.waitForTimeout(450);assert.equal(await staticPixels(),still,'Disabled animation keeps actual pixels still');
 await tap('settings-toggle',mobile);await tap('animation-toggle',mobile);await tap('settings-close',mobile);await pose(0,'idle');
 unchanged(before,await state(),'Switch animation on');
 report.checks.push({mode,check:'Settings switch changes live rendering without C/input/RNG changes'});
}
async function multiStageThrow(){
 await open('pixels');await key('t',false);assert.equal((await state()).frame.ui.input.kind,'direction');
 await key('h',false);const selection=await state();assert.ok(selection.frame.ui.lines.some(line=>line.key==='e'&&line.selectable));
 const step=selection.frame.map_actor_step;await key('e');await pose(0,'attack',null,true);
 const thrown=await state();assert.equal(thrown.animation.find(a=>a.id===0).facing,-1);
 assert.equal(thrown.frame.map_actor_step,step,'Direction and item selection belong to the same original action');
 await shot('multi-stage-throw');report.checks.push({mode:'pixels',check:'Direction/item follow-up inputs still animate the actual thrown weapon'});
}
const throwOnly=process.argv.includes('--throw-only');
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 if(!throwOnly){
 for(const mode of ['pixels','tiles']){
  await open(mode);const before=await state();const hashes=await idlePixels();unchanged(before,await state(),'Passive '+mode+' animation');
  await shot(mode+'-idle');report.checks.push({mode,check:'Idle changes real pixels while C/RNG/input stay unchanged',hashes});
  const actors=before.frame.map_actors;assert.ok(actors.every(a=>!(a.x===12&&a.y===12)&&!(a.x===13&&a.y===12)),'Hidden and disguised enemies remain private');
  await key('h');const motion=await moving(0,9,10,true);assert.equal(motion.state,'idle');assert.equal(motion.facing,-1);
  const leftFlip=await page.evaluate(()=>__rogueBrowserTest.commands.find(c=>c.image?.startsWith('animations-v1/actor.player/')).flipX);
  assert.equal(leftFlip,mode==='tiles');await shot(mode+'-continuous-left');
  await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animation.find(a=>a.id===0).displayX===9);
  await key('.');await key('.');await key('l');await pose(0,'attack',0,true);
  const rightFlip=await page.evaluate(()=>__rogueBrowserTest.commands.find(c=>c.image?.startsWith('animations-v1/actor.player/')).flipX);
  assert.notEqual(rightFlip,leftFlip);await shot(mode+'-attack-right');
  const phases=[];for(let n=0;n<8;n++){phases.push((await state()).animation.find(a=>a.id===0).state);await page.waitForTimeout(70);}
  assert.ok(phases.includes('idle'));assert.ok(phases.every(p=>p==='attack'||p==='idle'),'Attack suppresses hurt for the same original action');
  report.checks.push({mode,check:'Continuous movement, native left/right facing and attack > hurt > idle',motion,phases});
  await key('l');await pose(0,'attack',0,true);const attacking=await state();const frozenClock=await page.evaluate(()=>window.__animationFrozenAt);
  const started=Date.now();await key('.');await pose(0,'hurt',0);const hurt=await state();
  assert.ok(hurt.frame.map_actor_step>attacking.frame.map_actor_step);assert.equal(await page.evaluate(()=>window.__animationFrozenAt),frozenClock,'Old action clock never reached completion');
  report.checks.push({mode,check:'Next real input replaces an unfinished attack immediately',elapsed_ms:Date.now()-started});await shot(mode+'-next-input-hurt');
  await settingsSwitch(mode);
  if(mode==='pixels'){
   await key('l');await pose(0,'attack');await tap('settings-toggle');const saved=await state();await tap('save');
   await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending&&__rogueBrowserTest.queuePending===0);
   assert.deepEqual((await state()).words,saved.words);await tap('settings-top');await tap('load');
   await page.waitForFunction(g=>__rogueBrowserTest.generation>g&&__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.diagnostics.animation?.length>0,saved.generation);
   await idle();const restored=await state();assert.deepEqual(restored.words,saved.words);assert.ok(restored.animation.every(a=>a.state==='idle'));
   await key('l');await pose(0,'attack');report.checks.push({mode,check:'Save/restore excludes presentation state and next attack works'});
   await tap('settings-toggle');await tap('animation-toggle');await page.reload();await page.locator('[data-control="new-game"]:not([disabled])').waitFor();
   assert.equal(await page.evaluate(()=>__rogueBrowserTest.diagnostics.animationEnabled),false,'Animation preference survives reload');
   report.checks.push({mode,check:'Animation preference persists across reload'});
  }
 }
 await open('pixels',true);await tap('touch-h',true);await idle();await moving(0,9,10,true);await shot('mobile-continuous-move');await settingsSwitch('mobile-pixels',true);
 report.checks.push({mode:'mobile',check:'Real touch movement interpolates and the settings switch is usable'});
 await open('pixels',false,'animation-held');await key('j');const held=(await state()).frame.map_actors.find(a=>a.glyph===75);assert.ok(held?.stopped);
 const frozen=(await state()).animation.find(a=>a.id===held.id);await page.waitForTimeout(450);assert.deepEqual((await state()).animation.find(a=>a.id===held.id),frozen);await shot('held-still');
 await key('j');await key('l');
 await page.waitForFunction(id=>__rogueBrowserTest.frame.map_actors.some(a=>a.id===id&&!a.stopped),held.id);
 await pose(held.id,'attack');report.checks.push({mode:'pixels',check:'The original held state freezes the actor and runto releases it after a real attack'});
 await open('pixels',false,'animation-hallucination');
 const hallucination=await state(),cells=hallucination.frame.map_cells,w=hallucination.frame.width;
 assert.ok(hallucination.frame.map_actors.every(a=>cells.charCodeAt(a.y*w+a.x)===a.glyph));
 assert.ok(hallucination.frame.map_actors.every(a=>!(a.x===12&&a.y===12)&&!(a.x===13&&a.y===12)));
 report.checks.push({mode:'pixels',check:'Hallucination keeps only public glyphs and actors'});
 }
 await multiStageThrow();
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;if(page)report.last=await state().catch(()=>null);throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}
for(const check of report.checks)console.log('PASS '+check.mode+' '+check.check);

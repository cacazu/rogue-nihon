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
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,inputs:__rogueBrowserTest.trace.input_index,requests:__rogueBrowserTest.inputRequestCount,generation:__rogueBrowserTest.generation,frame:__rogueBrowserTest.frame,animation:__rogueBrowserTest.diagnostics.animation}));
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
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const mode of ['pixels','tiles']){
  await open(mode);const before=await state();const hashes=await idlePixels();unchanged(before,await state(),'Passive '+mode+' animation');
  await shot(mode+'-idle');report.checks.push({mode,check:'Three idle frames render different pixels without C/RNG/input changes',hashes});
  const actors=(await state()).frame.map_actors;assert.ok(actors.every(a=>!(a.x===12&&a.y===12)&&!(a.x===13&&a.y===12)),'Hidden enemy and disguised xeroc are not actors');
  await key('h');await pose(0,'move',null,true);await shot(mode+'-move');
  await key('.');const foe=(await state()).frame.map_actors.find(a=>a.glyph===90);assert.ok(foe,'Visible chasing zombie');await pose(foe.id,'move');
  await key('.');await key('l');await pose(0,'attack',null,true);await shot(mode+'-attack');
  await key('l');await pose(0,'hurt',null,true);await shot(mode+'-hurt');
  await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animation.every(a=>a.state==='idle'));
  report.checks.push({mode,check:'Real C player/enemy moves, attack and hurt play and return to idle'});
  await key('i',false);const menu=await state();await pose(0,'idle',2);unchanged(menu,await state(),'Inventory animation');await key('Space');
  if(mode==='pixels'){
   await key('l');await pose(0,'attack');await tap('settings-toggle');const saved=await state();await tap('save');
   await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending&&__rogueBrowserTest.queuePending===0);
   const savedState=await state();assert.deepEqual(savedState.words,saved.words,'Saving an animation never changes C/RNG');
   await tap('settings-top');await tap('load');
   await page.waitForFunction(generation=>__rogueBrowserTest.generation>generation&&__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.diagnostics.animation?.length>0,savedState.generation);
   await idle();const restored=await state();assert.deepEqual(restored.words,savedState.words,'Restore C/RNG');assert.equal(restored.inputs,savedState.inputs,'Restore journal');assert.ok(restored.animation.every(a=>a.state==='idle'),'Restore starts in idle rather than replaying old attacks');
   await key('l');await pose(0,'attack');report.checks.push({mode,check:'Save during an action restores a fresh idle player and the next real attack works'});
  }
 }
 await open('pixels',true);await pose(0,'idle');await tap('touch-h',true);await idle();await pose(0,'move',null,true);await shot('mobile-move');
 report.checks.push({mode:'pixels',check:'Mobile touch movement reaches C and animates the player'});
 await open('pixels',false,'animation-hallucination');
 const hallucination=await state();const cells=hallucination.frame.map_cells,w=hallucination.frame.width;
 assert.ok(hallucination.frame.map_actors.every(a=>cells.charCodeAt(a.y*w+a.x)===a.glyph),'Hallucination actors use only public glyphs');
 assert.ok(hallucination.frame.map_actors.every(a=>!(a.x===12&&a.y===12)&&!(a.x===13&&a.y===12)),'Hidden and disguised actors remain private during hallucination');
 await pose(0,'idle');report.checks.push({mode:'pixels',check:'Hallucination uses displayed glyphs and preserves hidden/disguised actors'});
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;if(page)report.last=await state().catch(()=>null);throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}
for(const check of report.checks)console.log('PASS '+check.mode+' '+check.check);

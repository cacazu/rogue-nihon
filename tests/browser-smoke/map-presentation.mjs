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

// Real C pickup/projectile frames, front-facing artwork and the settings control.
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_PRESENTATION_OUTPUT?path.resolve(process.env.ROGUE_PRESENTATION_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/map-presentation'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let runtime,browser,context,page,mobile;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const snapshot=()=>page.evaluate(async()=>JSON.parse((await import('/build/browser-ui.js')).browser_snapshot()));
async function tap(id){
 await page.waitForFunction(id=>globalThis.__rogueBrowserTest?.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);
 const rect=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id).rect,id),canvas=await page.locator('#rogue-canvas').boundingBox();
 const x=canvas.x+rect.x+rect.w/2,y=canvas.y+rect.y+rect.h/2;
 if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
 await paint();
}
async function key(value){
 const before=(await snapshot()).state.inputRequestCount;await page.keyboard.press(value);
 await page.waitForFunction(before=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.inputRequestCount>before,before);
}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function open(config){
 await context?.close();mobile=config.mobile;
 context=await browser.newContext({viewport:{width:config.width,height:mobile?844:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
 await context.addInitScript(()=>{
  window.__mapFrames=[];const NativeWorker=Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.addEventListener('message',event=>{
    const f=event.data;if(f.type!=='frame'||!window.__recordMap)return;
    const index=f.player.y*f.width+f.player.x;
    __mapFrames.push({step:f.map_actor_step,raw:f.cells[index],map:f.map_cells[index],tile:f.map_tiles[index],actors:f.map_actors,events:f.map_actor_events});
   });}
  };
 });
 await context.route('**/web/worker.js',route=>route.fulfill({body:fixtureWorker(worker,'map-presentation'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',route=>route.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base+'/?trace=1&lang='+config.language+'&view='+config.mode);
 await page.locator('#seed').fill('17');await tap('new-game');
 await page.waitForFunction(()=>__rogueBrowserTest.trace&&__rogueBrowserTest.frame?.map_actors?.some(a=>a.id===0));
}
async function actors(label){
 const initial=await snapshot();assert.ok(initial.state.frame.map_actors.some(a=>a.glyph===66),'Real public front-facing bat is visible');
 assert.ok(initial.commands.some(c=>c.image?.startsWith('animations-v1/monster.bat/')));
 assert.ok(!initial.commands.some(c=>['M17 4L5 12L17 20Z','M7 4L19 12L7 20Z'].includes(c.path)),'No character direction markers');
 await shot(label+'-front-character');
 await page.evaluate(async()=>{
  const module=await import('/build/browser-ui.js'),put=CanvasRenderingContext2D.prototype.putImageData;
  window.__mapPaints=[];window.__recordMap=true;
  CanvasRenderingContext2D.prototype.putImageData=function(...args){
   const result=put.apply(this,args);
   if(this.canvas.id==='rogue-canvas'){
    const snap=JSON.parse(module.browser_snapshot());
    __mapPaints.push({step:snap.state.frame.map_actor_step,player:snap.state.animation?.find(a=>a.id===0),drawn:snap.commands.some(c=>/^(animations-v1\/)?actor.player/.test(c.image||''))});
   }
   return result;
  };
 });
 for(const direction of ['l','l','l'])await key(direction);
 await page.waitForFunction(()=>__rogueBrowserTest.frame.player.x===13&&__rogueBrowserTest.frame.ui.input.kind==='command');
 await shot(label+'-pickup');
 await key('w');await key('d'); // Equip the original starting bow.
 for(const direction of ['h','l']){await key('t');await key(direction);await key('e');}
 await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='command');await paint();
 const evidence=await page.evaluate(()=>({frames:__mapFrames,paints:__mapPaints}));
 const intermediate=evidence.frames.filter(f=>f.raw!=='@');
 assert.ok(intermediate.length>=3,'The actual C pickup erasure frames were exercised');
 assert.ok(evidence.frames.every(f=>f.map==='@'&&f.tile===8&&f.actors.some(a=>a.id===0)),'All original pickup/projectile frames retain the public player');
 assert.ok(evidence.paints.every(f=>f.drawn&&f.player),'Every completed game paint contains the player');
 assert.ok(evidence.frames.some(f=>f.events.some(e=>e.id===0&&e.kind==='attack')),'Real original arrow attack occurred');
 await shot(label+'-arrows');
 report.checks.push({label,check:'Pickup intermediate frames, bow equipment and arrows in both directions retain the player; front-facing character has no marker',...evidence});
}
async function settings(label){
 const before=(await snapshot()).state;await tap('settings-toggle');
 let snap=await snapshot();const control=snap.diagnostics.controls.find(c=>c.id==='select-display-mode');
 assert.ok(control.fullRect.w>=48&&control.fullRect.w<170,'Display selector fits its labels');
 assert.ok(control.fullRect.x+control.fullRect.w<=snap.diagnostics.width-8);
 assert.ok(!control.label.includes('▾'),'Dropdown arrow is vector artwork, not an unsupported font glyph');
 assert.ok(snap.diagnostics.icons.some(icon=>icon.name==='chevron-down'));
 await shot(label+'-settings');await tap('select-display-mode');await shot(label+'-display-options');
 for(const mode of ['ascii','tiles','pixels']){
  if(mode!=='ascii')await tap('select-display-mode');
  await tap('select-display-mode-'+mode);snap=await snapshot();
  assert.equal(snap.state.displayMode,mode);
  assert.equal(snap.diagnostics.controls.find(c=>c.id==='select-display-mode').fullRect.w,control.fullRect.w);
 }
 await tap('settings-close');
 const after=(await snapshot()).state;
 assert.deepEqual(after.trace.words,before.trace.words,'Display selection does not advance C/RNG');
 assert.equal(after.trace.input_index,before.trace.input_index);
 assert.equal(after.inputRequestCount,before.inputRequestCount);
 report.checks.push({label,check:'Settings selector has a vector chevron, content width, all three working choices and no C input',width:control.fullRect.w});
}
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const config of [{mode:'pixels',mobile:true,width:390,language:'ja'},{mode:'tiles',mobile:false,width:1240,language:'ja'},{mode:'pixels',mobile:true,width:320,language:'en',settingsOnly:true}]){
  if(config.settingsOnly&&process.argv.includes('--actors-only'))continue;
  const label=config.mode+'-'+config.width+'-'+config.language;await open(config);
  if(!config.settingsOnly&&!process.argv.includes('--settings-only'))await actors(label);
  if(!process.argv.includes('--actors-only'))await settings(label);
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}
for(const check of report.checks)console.log('PASS '+check.label+' '+check.check);

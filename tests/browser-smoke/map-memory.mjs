import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/map-memory'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const wasm=process.env.ROGUE_MAP_MEMORY_MODULE||path.join(root,'build/game-fixtures.wasm');
const theme=JSON.parse(await readFile(path.join(root,'web/themes.json'),'utf8'));
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const remaining=process.argv.includes('--remaining');
const report={selection:remaining?'pc-overview-and-phone':'all',checks:[],screenshots:[],errors:[]};let context,page;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const snap=()=>page.evaluate(()=>({frame:__rogueBrowserTest.frame,trace:__rogueBrowserTest.trace,commands:__rogueBrowserTest.commands,scene:__rogueBrowserTest.canvas}));
async function tap(id,mobile){await paint();const command=(await snap()).scene.controls.find(command=>command.id===id&&!command.disabled);assert.ok(command,id);const box=await page.locator('#rogue-canvas').boundingBox(),x=box.x+command.rect.x+command.rect.w/2,y=box.y+command.rect.y+command.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame?.ui.input.kind==='command');await paint();}
async function key(value){const before=await page.evaluate(()=>__rogueBrowserTest.inputRequestCount);await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);await page.waitForFunction(before=>__rogueBrowserTest.inputRequestCount>before,before);await idle();}
async function mode(value,mobile){await tap('settings-toggle',mobile);await tap('select-display-mode',mobile);await tap('select-display-mode-'+value,mobile);await tap('settings-close',mobile);await paint();}
async function cellPixels(x,y){return page.evaluate(({x,y})=>{const scene=__rogueBrowserTest.canvas,camera=scene.camera,map=scene.mapRect,canvas=document.getElementById('rogue-canvas'),ratio=canvas.width/canvas.getBoundingClientRect().width;
 const left=map.x+x*camera.size-camera.left,top=map.y+(y-1)*camera.cellH-camera.top;
 const bytes=canvas.getContext('2d').getImageData(Math.round((left+2)*ratio),Math.round((top+2)*ratio),Math.max(1,Math.round((camera.size-4)*ratio)),Math.max(1,Math.round((camera.cellH-4)*ratio))).data;
 let visible=0,colored=0;for(let i=0;i<bytes.length;i+=4){if(bytes[i]||bytes[i+1]||bytes[i+2])visible++;if(bytes[i]!==bytes[i+1]||bytes[i]!==bytes[i+2])colored++;}return {visible,colored};},{x,y});}
try{
 for(const mobile of [false,true]){
  context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1050},isMobile:mobile,hasTouch:mobile});
  await context.addInitScript(()=>localStorage.setItem('rogue-map-display-v1',JSON.stringify({version:1,mode:'tiles',zoom:32,animation:false})));
  await context.route('**/web/worker.js',route=>route.fulfill({body:fixtureWorker(worker,'animation-dark'),contentType:'text/javascript',headers}));
  await context.route('**/build/game.wasm',route=>route.fulfill({path:wasm,contentType:'application/wasm',headers}));
  page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
  for(const [id,value] of [['name','Memory'],['seed','17']]){await tap(id,mobile);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
  await tap('new-game',mobile);await idle();for(const step of 'lll')await key(step);
  const expected=(await snap()).trace;
  for(const display of (remaining&&!mobile?[]:['tiles','pixels','ascii'])){
   await mode(display,mobile);const state=await snap();assert.deepEqual(state.trace,expected,'Display changes do not touch C/RNG/input');
   assert.equal(state.frame.cells[10*80+9],' ');assert.equal(state.frame.map_cells[10*80+9],'.');assert.equal(state.frame.map_visible[10*80+9],false);
   assert.equal(state.frame.map_cells[10*80+17],' ');
   const player=state.frame.player;assert.equal(state.frame.map_visible[player.y*80+player.x],true,'The current player is in ordinary public sight');
   const sprite=state.commands.find(command=>command.palette==='map'&&(display==='ascii'?command.op==='text'&&command.text==='@':command.op==='image'&&command.image.includes('actor.player')));
   assert.ok(sprite,'The player is drawn in this display mode');
   if(display==='ascii')assert.equal(sprite.color,theme.map_colors['ascii.player'],'ASCII player retains its original map color');
   else assert.equal(sprite.tint,undefined,'The current player image keeps original artwork colors');
   const remembered=await cellPixels(9,10),current=await cellPixels(14,10),unknown=await cellPixels(17,10);
   assert.ok(remembered.visible>0,'Remembered cell has actual pixels');assert.equal(remembered.colored,0,'Remembered pixels are gray');
   assert.ok(current.colored>0,'Current sight retains its original color');assert.equal(unknown.visible,0,'Unknown cell is pure black');
   const name=(mobile?'phone':'pc')+'-'+display+'.png';await page.screenshot({path:path.join(output,name)});report.screenshots.push(name);report.checks.push({mobile,display,remembered,current,unknown,player:{visible:state.frame.map_visible[player.y*80+player.x],image:sprite.image,color:sprite.color,tint:sprite.tint??null}});
  }
  await tap('mobile-full-map',mobile);const overview=await snap();assert.ok(overview.commands.some(command=>command.palette==='map'&&command.color==='#808080'),'Overview shares gray memory');assert.deepEqual(overview.trace,expected);
  await page.screenshot({path:path.join(output,(mobile?'phone':'pc')+'-overview.png')});await context.close();context=null;
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,remaining?'result-remaining.json':'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(resolve=>server.close(resolve));await runtime.dispose();}
for(const check of report.checks)console.log('PASS '+(check.mobile?'phone':'pc')+' '+check.display+' memory gray / current original color / unknown black');

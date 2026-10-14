// Exercise the Rust framebuffer with browser drawing and image decoding disabled.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_RASTER_OUTPUT?path.resolve(process.env.ROGUE_RASTER_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/rust-raster'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
const report={checks:[],screenshots:[],errors:[],states:[]};
let runtime,browser,context,page;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,inputs:__rogueBrowserTest.trace.input_index}));
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function tap(id){
 const button=page.locator(`[data-control="${id}"]`);
 if(await button.count())await button.click();
 else{
  const control=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id&&!c.disabled),id);
  assert.ok(control,'Enabled Canvas control: '+id);const bounds=await page.locator('#rogue-canvas').boundingBox(),r=control.rect;
  await page.mouse.click(bounds.x+r.x+r.w/2,bounds.y+r.y+r.h/2);
 }
 await paint();
}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame?.ui.input.kind==='command'&&!__rogueBrowserTest.frame.ui.window);await paint();}
async function open(mobile=false,adapter=true){
 await context?.close();context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1240,height:900},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(()=>{
  const forbidden=['fillRect','strokeRect','fillText','strokeText','measureText','drawImage','beginPath','arc','roundRect','fill','stroke','clip','rotate','scale','translate'];
  for(const name of forbidden)CanvasRenderingContext2D.prototype[name]=function(){throw Error('Browser raster operation forbidden: '+name);};
  HTMLImageElement.prototype.decode=function(){throw Error('Browser PNG decoding forbidden');};
 });
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Rust browser host'))report.errors.push(m.text());});
 page.on('response',r=>{if(!r.ok()&&/\/(web\/assets|build)\//.test(new URL(r.url()).pathname))report.errors.push('Asset HTTP failure: '+r.url());});
 if(adapter)await installBrowserTestAdapter(page);
 await page.goto(base+'?lang=ja&view=pixels&trace=1');
 if(adapter)await page.waitForFunction(()=>window.__rogueBrowserTest?.canvas?.paintCount>0);
 else await page.locator('[data-control="new-game"]').waitFor();
}
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const corrupt of [false,true]){
  await context?.close();context=await browser.newContext();page=await context.newPage();let first=true;
  page.on('pageerror',e=>report.errors.push(e.message));
  await context.route('**/web/assets/fonts/'+(corrupt?'NotoColorEmoji.ttf':'NotoSansJP.ttf'),route=>{
   if(first){first=false;return route.fulfill({status:corrupt?200:503,body:corrupt?'invalid font bytes':'injected font fetch failure'});}
   return route.continue();
  });
  await page.goto(base+'?lang=ja');await page.locator('#rogue-startup-error').waitFor();
  await page.getByRole('button',{name:'再読み込み',exact:true}).click();await page.locator('[data-control="new-game"]').waitFor();
  assert.equal(await page.locator('#rogue-startup-error').count(),0);
 }
 report.checks.push('Rust reports failed/corrupt fonts visibly and reload recovers');
 // Check the published binding first, without replacement or a test ABI.
 await open(false,false);await page.locator('#seed').fill('17');await tap('new-game');
 await page.locator('[data-control="settings-toggle"]').waitFor();await shot('production-game');
 report.checks.push('Published Rust renderer starts and draws without browser raster APIs');

 for(const mobile of [false,true]){
  await open(mobile);await page.locator('#name').fill('描画勇者🗡');await page.locator('#seed').fill('17');
  await paint();await shot(mobile?'mobile-top':'desktop-top');await tap('new-game');await idle();
  const before=await state();report.states.push({mobile,state:before});
  await shot(mobile?'mobile-game':'desktop-game');
  await tap('settings-toggle');
  for(const mode of ['ascii','tiles','pixels']){
   await tap('select-display-mode');await tap('select-display-mode-'+mode);
   await page.waitForFunction(mode=>__rogueBrowserTest.graphics.mode===mode,mode);
   await paint();assert.deepEqual(await state(),before,'Display changes preserve C and RNG');
  }
  await shot(mobile?'mobile-settings':'desktop-settings');await tap('settings-close');
  if(!mobile){
   await page.keyboard.press('i');await page.waitForFunction(()=>Boolean(__rogueBrowserTest.frame.ui.window));await paint();await shot('desktop-inventory');
   await page.keyboard.press('Escape');await idle();
   await page.keyboard.press('.');await page.waitForFunction(turn=>__rogueBrowserTest.trace.words[13]===turn+1,before.words[13]);await idle();
  }else{
   await tap('touch-.');await page.waitForFunction(turn=>__rogueBrowserTest.trace.words[13]===turn+1,before.words[13]);await idle();
  }
  report.checks.push(`${mobile?'Mobile DPR2':'Desktop'} Japanese/emoji text, paths, clips, both PNG sets, display selection and next C turn`);
 }
 const pixels=await page.evaluate(async()=>{
  const tiles=await RogueTiles.load('/web/assets/pixels-v2/manifest.json'),entry=tiles.entries[11];
  const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=a.height=32;b.width=b.height=128;
  for(const canvas of [a,b])tiles.drawImage(canvas.getContext('2d'),{...entry,pixelArt:true},0,0,canvas.width,canvas.height);
  const native=a.getContext('2d').getImageData(0,0,32,32).data,zoomed=b.getContext('2d').getImageData(0,0,128,128).data;
  for(let y=0;y<128;y++)for(let x=0;x<128;x++)for(let c=0;c<4;c++)if(zoomed[(y*128+x)*4+c]!==native[(Math.floor(y/4)*32+Math.floor(x/4))*4+c])throw Error('Rust sprite scaling blurred a pixel');
  for(let i=3;i<native.length;i+=4)if(native[i]!==0&&native[i]!==255)throw Error('Rust sprite rotation changed binary alpha');
  return {images:tiles.images.size,rotations:tiles.rotated.size,opaque:native.some((v,i)=>i%4===3&&v===255)};
 });assert.deepEqual(pixels,{images:46,rotations:1,opaque:true});report.checks.push('Rust PNG decoding, cached native rotation and exact nearest-neighbour scaling');
 if(process.env.ROGUE_RASTER_BASELINE){
  const baseline=JSON.parse(await readFile(process.env.ROGUE_RASTER_BASELINE,'utf8'));
  assert.deepEqual(report.states,baseline,'Renderer replacement preserves original C/RNG checkpoints');report.checks.push('C/RNG checkpoints match the previous Canvas renderer');
 }
 assert.deepEqual(report.errors,[]);report.result='pass';for(const label of report.checks)console.log('PASS '+label);
}catch(error){report.result='fail';report.failure=error.stack;throw error;}
finally{await writeFile(path.join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}

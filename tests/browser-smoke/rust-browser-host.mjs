// Covers the browser APIs moved from handwritten JS, plus the actual production bootstrap.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_HOST_OUTPUT?path.resolve(process.env.ROGUE_HOST_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/rust-browser-host'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`,report={checks:[],errors:[],screenshots:[]};
const recoveryOnly=process.argv.includes('--recovery-only');
let browser,context,page,runtime;
async function check(name,operation){if(recoveryOnly&&!/Worker bootstrap|license ZIP/.test(name))return;await operation();report.checks.push(name);console.log('PASS '+name);}
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.trace.input_index,generation:__rogueBrowserTest.generation}));
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function tap(id,touch=false){
 const target=page.locator(`[data-control="${id}"]`);
 if(await target.count()){if(touch)await target.tap();else await target.click();}
 else{
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  const r=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id).rect,id),bounds=await page.locator('#rogue-canvas').boundingBox();
  if(touch)await page.touchscreen.tap(bounds.x+r.x+r.w/2,bounds.y+r.y+r.h/2);else await page.mouse.click(bounds.x+r.x+r.w/2,bounds.y+r.y+r.h/2);
 }await paint();
}
async function open({mobile=false,adapter=true,parameters='?trace=1&view=pixels'}={}){
 await context?.close();context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1240,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1,acceptDownloads:true});
 if(adapter)await installBrowserTestAdapter(context);page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base+parameters);await page.locator('[data-control="new-game"]:enabled').waitFor();
}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame.ui.input.kind==='command');await paint();}
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 await check('production boots and plays using only generated bindings and minimal JS',async()=>{
  await open({adapter:false,parameters:'?record=1&view=pixels'});const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  const exports=await page.evaluate(async()=>Object.keys(await import('/build/browser-ui.js')));
  for(const name of ['browser_request','browser_snapshot','policy_request','EventQueue','TilePainter'])assert.ok(!exports.includes(name),name);
  assert.equal(await page.evaluate(()=>'RogueCanvasUi'in window||'RoguePlayRecording'in window),false);
  await tap('new-game');await page.waitForFunction(()=>JSON.parse(document.querySelector('#rogue-observation').textContent).running);
  await page.keyboard.press('i');await page.waitForFunction(()=>Boolean(JSON.parse(document.querySelector('#rogue-observation').textContent).window));
  await page.keyboard.press('Space');await page.waitForFunction(()=>JSON.parse(document.querySelector('#rogue-observation').textContent).input?.kind==='command');
  assert.deepEqual(posts,[]);await shot('production-pixels');
 });
 await check('Rust registers native editing, composition suppression and crypto seed selection',async()=>{
  await open();await tap('random-seed');const seed=await page.locator('#seed').inputValue();assert.ok(/^\d+$/.test(seed)&&Number(seed)<=0xffffffff);
  await page.locator('#seed').fill('17');await page.locator('#name').fill('日本語勇者');
  await page.locator('#name').evaluate(input=>input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'日本語'})));
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>__rogueBrowserTest.topOpen),true);
  await page.locator('#name').evaluate(input=>input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本語勇者'})));
  await tap('new-game');await idle();assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.ui.name),'日本語勇者');
 });
 await check('Rust Canvas, fullscreen, wheel zoom and resize do not advance C or RNG',async()=>{
  const before=await state();await tap('settings-toggle');
  for(const mode of ['ascii','tiles','pixels']){await tap('select-display-mode');await tap('select-display-mode-'+mode);assert.deepEqual(await state(),before);}
  await tap('settings-close');await tap('header-fullscreen');await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  await shot('fullscreen');await tap('header-fullscreen');await page.waitForFunction(()=>!document.fullscreenElement);
  const bounds=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(bounds.x+bounds.width/3,bounds.y+bounds.height/2);await page.mouse.wheel(0,-80);
  await page.setViewportSize({width:1100,height:800});await paint();assert.deepEqual(await state(),before);await shot('desktop-pixels');
 });
 await check('Rust image cache rasterizes beams once on the native grid and scales without blending',async()=>{
  const result=await page.evaluate(async()=>{
   const tiles=await RogueTiles.load('/web/assets/pixels-v2/manifest.json'),image=tiles.entries[11];
   const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=a.height=32;b.width=b.height=128;
   for(const canvas of [a,b]){const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;tiles.drawImage(c,{...image,pixelArt:true},0,0,canvas.width,canvas.height);}
   const n=a.getContext('2d').getImageData(0,0,32,32).data,z=b.getContext('2d').getImageData(0,0,128,128).data;
   for(let y=0;y<128;y++)for(let x=0;x<128;x++)for(let k=0;k<4;k++)if(z[(y*128+x)*4+k]!==n[(Math.floor(y/4)*32+Math.floor(x/4))*4+k])throw Error('Blended pixels');
   for(let i=3;i<n.length;i+=4)if(n[i]!==0&&n[i]!==255)throw Error('Antialiased native rotation');
   return {images:tiles.images.size,rotations:tiles.rotated.size,opaque:n.some((v,i)=>i%4===3&&v===255)};
  });assert.deepEqual(result,{images:73,rotations:1,opaque:true});
 });
 await check('Rust handles mobile taps, held input, release and captured pointer cleanup',async()=>{
  await open({mobile:true});await page.locator('#seed').fill('17');await tap('new-game',true);await idle();const before=await state();
  await tap('touch-.',true);await page.waitForFunction(turn=>__rogueBrowserTest.trace.words[13]===turn+1,before.words[13]);await idle();
  const button=page.locator('[data-control="touch-."]'),bounds=await button.boundingBox(),cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}]});
  await page.waitForFunction(turn=>__rogueBrowserTest.trace.words[13]>=turn+3,before.words[13]);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await idle();const released=await state();
  await page.waitForTimeout(200);assert.deepEqual(await state(),released);
  assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.canvas.pointer.capturedIds),[]);await shot('mobile-pixels');
  const saved=released.words;await tap('settings-toggle',true);await tap('settings-top',true);await page.waitForFunction(()=>__rogueBrowserTest.topOpen&&__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);
  await tap('load',true);await idle();assert.deepEqual((await state()).words,saved);
 });
 await check('Worker bootstrap reports Wasm load failure and permits another start',async()=>{
  await open();let requests=0;await context.route('**/build/browser-test.wasm',async route=>{if(++requests===1)await route.fulfill({status:503,body:'injected Worker startup failure'});else await route.fulfill({path:path.join(root,'build/browser-test.wasm'),contentType:'application/wasm',headers:{'Cross-Origin-Resource-Policy':'same-origin'}});});
  await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.runtimeError&&!__rogueBrowserTest.diagnostics.starting);
  assert.equal(await page.evaluate(()=>__rogueBrowserTest.running),false);
  await tap('new-game');await idle();
 });
 await check('license ZIP is downloadable and matches the updated notices',async()=>{
  const response=await context.request.get(base+'distribution/rogue-5.4.4-licenses.zip');assert.equal(response.status(),200);
  assert.deepEqual(await response.body(),await readFile(path.join(root,'distribution/rogue-5.4.4-licenses.zip')));
  await tap('settings-toggle');await tap('settings-top');
  await context.route('https://github.com/cacazu/roguelike-nihon/**',route=>route.fulfill({body:'<!doctype html><title>Repository link target</title>',contentType:'text/html'}));
  const popup=page.waitForEvent('popup');await tap('credits-repository');const repository=await popup;
  await repository.waitForURL('https://github.com/cacazu/roguelike-nihon/tree/main/rogue-nihon');await repository.close();
  assert.match(await readFile(path.join(root,'README.md'),'utf8'),/docs\/LICENSES-ja\.md/);
  assert.match(await readFile(path.join(root,'docs/LICENSES-ja.md'),'utf8'),/rogue-5\.4\.4-licenses\.zip/);
 });
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;throw e;}
finally{await writeFile(path.join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

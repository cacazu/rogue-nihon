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

// Native repeated keydowns and distinct taps must both show movement while
// inputs are still arriving, with identical C input and deterministic state.
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_KEYBOARD_OUTPUT?path.resolve(process.env.ROGUE_KEYBOARD_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/keyboard-repeat'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let runtime,browser,context,page;
const snapshot=()=>page.evaluate(async()=>{
 const s=JSON.parse((await import('/build/browser-ui.js')).browser_snapshot());
 return {words:s.state.trace.words,inputs:s.state.trace.input_index,requests:s.state.inputRequestCount,player:s.state.frame.player,pending:s.queuePending};
});
async function open(mode){
 await context?.close();context=await browser.newContext({viewport:{width:1240,height:900}});
 await context.addInitScript(()=>{
  const now=Date.now,raf=window.requestAnimationFrame.bind(window);
  Date.now=()=>window.__repeatClock??now();
  window.__blockedPaints=[];
  window.requestAnimationFrame=callback=>raf(time=>{
   if(window.__pausePaint)__blockedPaints.push(callback);else callback(time);
  });
  window.__resumePaint=()=>{
   window.__pausePaint=false;
   for(const callback of __blockedPaints.splice(0))raf(callback);
  };
 });
 await context.route('**/web/worker.js',route=>route.fulfill({body:fixtureWorker(worker,'pickup-quantity'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',route=>route.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view='+mode);
 await page.locator('[data-control="new-game"]:not([disabled])').click();
 await page.waitForFunction(()=>__rogueBrowserTest.trace&&__rogueBrowserTest.frame?.ui.input.kind==='command');
 await page.evaluate(async()=>{
  const module=await import('/build/browser-ui.js'),put=CanvasRenderingContext2D.prototype.putImageData;
  window.__repeatKeys=[];window.__repeatPaints=[];
  window.addEventListener('keydown',event=>{
   const s=JSON.parse(module.browser_snapshot());
   __repeatKeys.push({t:performance.now(),key:event.key,repeat:event.repeat,step:s.state.frame.map_actor_step});
  },true);
  CanvasRenderingContext2D.prototype.putImageData=function(...args){
   const result=put.apply(this,args);
   if(this.canvas.id==='rogue-canvas'){
    const s=JSON.parse(module.browser_snapshot()),pose=s.state.animation?.find(a=>a.id===0);
    __repeatPaints.push({t:performance.now(),step:s.state.frame.map_actor_step,pose});
    if(pose?.x>10&&pose.x<24&&!window.__repeatMovingPixels)window.__repeatMovingPixels=this.canvas.toDataURL();
   }
   return result;
  };
 });
}
async function movement(mode,held){
 const label=mode+'-'+(held?'held':'tapped');await open(mode);
 const cdp=await context.newCDPSession(page),pending=[];
 const key=mode==='tiles'?'ArrowRight':'l',code=mode==='tiles'?'ArrowRight':'KeyL',virtualKey=mode==='tiles'?39:76;
 for(let i=0;i<14;i++){
  pending.push(cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey,autoRepeat:held&&i>0,...(key==='l'?{text:'l',unmodifiedText:'l'}:{})}));
  if(!held)pending.push(cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey}));
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 pending.push(cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey}));
 await Promise.all(pending);
 const released=await snapshot();
 await page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.trace.input_index===14&&__rogueBrowserTest.frame.map_actor_step===14);
 await page.waitForTimeout(180);const final=await snapshot();
 await page.waitForTimeout(160);assert.deepEqual(await snapshot(),final,'Released movement stops at the consumed input');
 const evidence=await page.evaluate(()=>({keys:__repeatKeys,paints:__repeatPaints,moving:window.__repeatMovingPixels}));
 report.checks.push({label,released,final,keys:evidence.keys,paints:evidence.paints});
 const last=evidence.keys.at(-1).t,during=evidence.paints.filter(paint=>paint.t<last);
 assert.equal(evidence.keys.length,14);
 assert.equal(evidence.keys.filter(event=>event.repeat).length,held?13:0);
 assert.ok(new Set(evidence.keys.map(event=>event.step)).size>=3,'New original turns must be observed before the movement key is released');
 assert.ok(new Set(during.map(paint=>paint.step)).size>=3,'The screen must advance during continuous key input, rather than only after release');
 assert.ok(during.some(paint=>paint.pose.displayX!==paint.pose.x),'Actual intermediate coordinates are drawn during movement');
 assert.equal(final.inputs,14);assert.equal(final.player.x,24);assert.equal(final.player.y,10);
 if(evidence.moving){const file=label+'-moving.png';await writeFile(path.join(output,file),Buffer.from(evidence.moving.split(',')[1],'base64'));report.screenshots.push(file);}
 const file=label+'-released.png';await page.screenshot({path:path.join(output,file)});report.screenshots.push(file);
 return final;
}
async function processingWithoutPaint(mode){
 const label=mode+'-processing-without-paint';await open(mode);
 const origin=await page.evaluate(()=>{
  window.__repeatClock=Date.now();window.__pausePaint=true;__repeatPaints.length=0;
  return __rogueBrowserTest.diagnostics.animation.find(a=>a.id===0).displayX;
 });
 for(let i=0;i<14;i++)await page.keyboard.press('l');
 await page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.trace.input_index===14&&__rogueBrowserTest.frame.map_actor_step===14,null,{polling:20});
 const completed=await snapshot();
 assert.equal((await page.evaluate(()=>__repeatPaints.length)),0,'All 14 inputs finish processing while presentation is paused');
 await page.evaluate(()=>__resumePaint());
 await page.waitForFunction(()=>__repeatPaints.length>0);
 const first=await page.evaluate(()=>__repeatPaints[0]);
 report.checks.push({label,completed,origin,first});
 assert.equal(first.step,14,'The next paint uses the latest processed result, skipping older results');
 assert.equal(first.pose.x,24);
 assert.equal(first.pose.displayX,origin,'Changing the target at the same presentation time must not teleport the sprite');
 await page.evaluate(()=>{window.__repeatClock+=60;window.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animation.find(a=>a.id===0).displayX===17);
 const moving=await page.evaluate(()=>({pose:__rogueBrowserTest.diagnostics.animation.find(a=>a.id===0),drawn:__rogueBrowserTest.commands.some(c=>c.op==='image'&&c.image.startsWith('animations-v1/actor.player/'))}));
 assert.ok(moving.drawn,'The current sprite is drawn even when the logical destination is outside its camera');
 report.checks.at(-1).moving=moving;
 const file=label+'.png';await page.screenshot({path:path.join(output,file)});report.screenshots.push(file);
 await page.evaluate(()=>{window.__repeatClock+=60;window.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animation.find(a=>a.id===0).displayX===24);
 assert.deepEqual(await snapshot(),completed,'Presentation does not process another input or game turn');
 return completed;
}
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const mode of ['pixels','tiles']){
  const completed=await processingWithoutPaint(mode);
  if(!process.argv.includes('--without-paint-only')){
   const held=await movement(mode,true),tapped=await movement(mode,false);
   assert.deepEqual(held,tapped,'Held and tapped movement consume the same input and produce the same C/RNG state');
   assert.deepEqual(held,completed,'Rendering frequency does not control input processing or C/RNG results');
  }
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}
for(const check of report.checks)console.log('PASS '+check.label);

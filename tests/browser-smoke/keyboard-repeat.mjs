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
async function open(mode,enabled=true,trace=true){
 await context?.close();context=await browser.newContext({viewport:{width:1240,height:900}});
 await context.addInitScript(({mode,enabled})=>{
  localStorage.setItem('rogue-map-display-v1',JSON.stringify({version:1,mode,zoom:32,animation:enabled}));
  window.__repeatLatest={step:0,x:10};window.__repeatRenders=[];
  const WorkerBase=window.Worker,raf=window.requestAnimationFrame.bind(window);
  window.Worker=class extends WorkerBase{constructor(...args){super(...args);this.addEventListener('message',event=>{
   const d=event.data;if(d.type==='frame')window.__repeatLatest={step:d.map_actor_step,x:d.player?.x};
  });}};
  window.requestAnimationFrame=callback=>raf(time=>{
   const start=performance.now();callback(time);__repeatRenders.push({t:start,duration:performance.now()-start});
  });
 },{mode,enabled});
 await context.route('**/web/worker.js',route=>route.fulfill({body:fixtureWorker(worker,'pickup-quantity'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',route=>route.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace='+(trace?'1':'0')+'&lang=ja&view='+mode);
 await page.locator('[data-control="new-game"]:not([disabled])').click();
 await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command');
 await page.evaluate(async trace=>{
  const module=await import('/build/browser-ui.js'),put=CanvasRenderingContext2D.prototype.putImageData;
  window.__repeatKeys=[];window.__repeatPaints=[];
  window.addEventListener('keydown',event=>{
   __repeatKeys.push({t:performance.now(),stamp:event.timeStamp,key:event.key,repeat:event.repeat,step:window.__repeatLatest.step});
  },true);
  CanvasRenderingContext2D.prototype.putImageData=function(...args){
   const result=put.apply(this,args);
   if(this.canvas.id==='rogue-canvas'){
    const pose=trace?JSON.parse(module.browser_snapshot()).state.animation?.find(a=>a.id===0):undefined;
    __repeatPaints.push({t:performance.now(),...window.__repeatLatest,pose});
    if(pose?.x>10&&pose.x<24&&!window.__repeatMovingPixels)window.__repeatMovingPixels=this.canvas.toDataURL();
   }
   return result;
  };
 },trace);
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
async function cadence(mode,enabled){
 const label=mode+'-tapped-animation-'+(enabled?'on':'off');await open(mode,enabled,false);
 await page.evaluate(()=>{__repeatKeys.length=0;__repeatPaints.length=0;__repeatRenders.length=0;});
 await page.evaluate(async()=>{(await import('/build/browser-ui.js')).browser_take_paint_timings();});
 const cdp=await context.newCDPSession(page),pending=[];
 const profiling=process.argv.includes('--profile');
 if(profiling){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
 for(let i=0;i<56;i++){
  const key=Math.floor(i/14)%2===0?'l':'h',code=key==='l'?'KeyL':'KeyH',vk=key==='l'?76:72;
  pending.push(cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,text:key,unmodifiedText:key}));
  pending.push(cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk}));
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 await Promise.all(pending);
 await page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame.map_actor_step===56);
 await page.waitForTimeout(180);
 if(profiling){const {profile}=await cdp.send('Profiler.stop');await writeFile(path.join(output,label+'-profile.json'),JSON.stringify(profile));}
 const phases=await page.evaluate(async()=>JSON.parse((await import('/build/browser-ui.js')).browser_take_paint_timings()));
 const data=await page.evaluate(async()=>({keys:__repeatKeys,paints:__repeatPaints,renders:__repeatRenders,state:JSON.parse((await import('/build/browser-ui.js')).browser_snapshot()).state}));
 const first=data.keys[0].t,last=data.keys.at(-1).t;
 const during=data.paints.filter(p=>p.t>=first&&p.t<=last);
 const changed=data.paints.filter((p,i,a)=>p.step>0&&(i===0||p.step!==a[i-1].step));
 const delays=data.keys.map(k=>k.t-k.stamp).sort((a,b)=>a-b);
 const renders=data.renders.filter(r=>r.t>=first&&r.t<=last).map(r=>r.duration).sort((a,b)=>a-b);
 const presentation=data.keys.map((key,i)=>{
  const paint=data.paints.find(p=>p.step>=i+1&&p.t>=key.t);
  assert.ok(paint,'Each movement input reaches an actual presentation');return paint.t-key.t;
 }).sort((a,b)=>a-b);
 const metrics={maxKeyDelay:delays.at(-1),p95KeyDelay:delays[Math.floor(delays.length*.95)],p95Render:renders[Math.floor(renders.length*.95)],maxRender:renders.at(-1),maxPresentation:presentation.at(-1),p95Presentation:presentation[Math.floor(presentation.length*.95)],maxPaintGap:Math.max(...during.slice(1).map((p,i)=>p.t-during[i].t)),paintedSteps:new Set(changed.map(p=>p.step)).size};
 report.checks.push({label,profiling,metrics,phases,keys:data.keys,paints:data.paints,renders:data.renders,final:{player:data.state.frame.player,step:data.state.frame.map_actor_step,requests:data.state.inputRequestCount}});
 console.log(label+' '+JSON.stringify(metrics));
 console.log('paint phases '+JSON.stringify(['scene','raster','transfer','dom'].map((name,index)=>{
  const values=phases.map(sample=>sample[index+1]).sort((a,b)=>a-b);
  return {name,mean:values.reduce((a,b)=>a+b,0)/values.length,p95:values[Math.floor(values.length*.95)]};
 })));
 assert.equal(data.keys.length,56);assert.equal(data.state.frame.player.x,10);assert.equal(data.state.frame.map_actor_step,56);
 if(!profiling){
 assert.ok(metrics.maxKeyDelay<50,'Rendering must not block a movement key for one input interval');
 // One nominal input interval is the rendering budget. Allow the Worker and
 // the next browser frame in the end-to-end limit, without a growing backlog.
 assert.ok(metrics.p95Render<50,'Normal rendering must finish within one movement input interval');
 assert.ok(metrics.maxPresentation<100&&metrics.p95Presentation<75,'Movement inputs must reach presentation without waiting for later input batches');
 assert.ok(metrics.paintedSteps>=52,'Processed movement results must be displayed throughout the repeated inputs');
 }
 const file=label+'.png';await page.screenshot({path:path.join(output,file)});report.screenshots.push(file);
}

try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 const selected=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);
 assert.ok(!selected||/^(pixels|tiles)-(on|off)$/.test(selected),'Unknown movement case');
 for(const mode of ['pixels','tiles']){
  if(selected&&!selected.startsWith(mode+'-'))continue;
  for(const enabled of [false,true]){
   if(!selected||selected===mode+'-'+(enabled?'on':'off'))await cadence(mode,enabled);
  }
  if(!process.argv.includes('--cadence-only')){
   const held=await movement(mode,true),tapped=await movement(mode,false);
   assert.deepEqual(held,tapped,'Held and tapped movement consume the same input and produce the same C/RNG state');
  }
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(error){report.result='fail';report.failure=error.stack;throw error;}
finally{await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(resolve=>server.close(resolve));}
for(const check of report.checks)console.log((check.profiling?'PROFILE ':'PASS ')+check.label);

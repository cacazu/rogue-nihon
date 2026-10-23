// Real original-rule dark-room movement must keep the player on its public floor.
// Run after a test-fixture build (default: visibility-fixtures) and browser-test ABI.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {runGame} from '../run-game.mjs';
import {createPreviewServer} from '../../tools/server.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const wasm=path.resolve(root,process.env.ROGUE_VISIBILITY_WASM||'build/visibility-fixtures.wasm');
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/visibility-motion'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const report={checks:[],errors:[]};let context,page;
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const idle=()=>page.waitForFunction(()=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame?.ui.input.kind==='command');
async function tap(id,mobile){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);
 const r=(await snap()).scene.controls.find(c=>c.id===id).rect,b=await page.locator('#rogue-canvas').boundingBox();
 const x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2;
 if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
 await paint();
}
async function settle(){await idle();await page.waitForTimeout(170);await paint();}
async function reference(text,label){
 const actual=(await snap()).state,expected=await runGame(wasm,{fixture:'animation-dark',seed:17,name:'Visibility',locale:'ja',messagePaging:'log',text});
 assert.deepEqual(actual.trace.words,expected.traces.at(-1).words,label+' original C state/RNG');
 assert.equal(actual.trace.input_index,text.length,label+' consumed commands');
}
try{
 for(const config of [
  {mode:'pixels'},{mode:'tiles'},{mode:'pixels',mobile:true},{mode:'tiles',mobile:true},
  {mode:'pixels',disabled:true},{mode:'pixels',mobile:true,disabled:true},{mode:'ascii'},
 ]){
  const {mode,mobile=false,disabled=false}=config,label=mode+'-'+(mobile?'phone':'pc')+(disabled?'-off':'');
  await context?.close();context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1000},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1});
  await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'animation-dark'),contentType:'text/javascript',headers}));
  await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
  page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&view='+mode+'&lang=ja');
  await tap('name',mobile);await page.keyboard.press('Control+a');await page.keyboard.insertText('Visibility');
  await tap('seed',mobile);await page.keyboard.press('Control+a');await page.keyboard.insertText('17');
  await tap('new-game',mobile);await idle();
  if(disabled){await tap('settings-toggle',mobile);await tap('animation-toggle',mobile);await tap('settings-close',mobile);await paint();}
  await page.evaluate(async()=>{
   const module=await import('/build/browser-ui.js'),put=CanvasRenderingContext2D.prototype.putImageData;
   window.visibilityFrames=[];
   // Observe the state/commands belonging to each completed actual Canvas paint.
   CanvasRenderingContext2D.prototype.putImageData=function(...args){
    const result=put.apply(this,args);
    if(this.canvas.id==='rogue-canvas'){
     const s=JSON.parse(module.browser_snapshot()),f=s.state.frame;
     if(f?.map_actors?.some(a=>a.id===0)){
      const floor=[];f.map_tiles.forEach((t,i)=>{if(t===1)floor.push([i%f.width,Math.floor(i/f.width)]);});
      window.visibilityFrames.push({player:f.player,pose:s.state.animation?.find(a=>a.id===0),step:f.map_actor_step,floor,camera:s.diagnostics.camera,
       playerImage:s.commands.find(c=>c.op==='image'&&(c.image==='actor.player.png'||c.image?.startsWith('animations-v1/actor.player/'))),
       groundImages:s.commands.filter(c=>c.op==='image'&&c.image==='terrain.floor.png').map(c=>c.rect)});
     }
    }
    return result;
   };
  });
  let text='';
  for(const key of 'llllllhhhhhhuuubbb'){
   if(mobile)await tap('touch-'+key,true);else{await page.keyboard.press(key);await page.waitForTimeout(12);}
   text+=key;
  }
  await settle();await reference(text,label+' reversal and diagonal');
  if(mobile){
   const before=(await snap()).state.trace.input_index,r=(await snap()).scene.controls.find(c=>c.id==='touch-l').rect,b=await page.locator('#rogue-canvas').boundingBox();
   const cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+r.x+r.w/2,y:b.y+r.y+r.h/2}]});
   await page.waitForTimeout(650);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await settle();const after=(await snap()).state.trace.input_index;
   assert.ok(after-before>=2,'Touch hold issues multiple real movements');text+='l'.repeat(after-before);await reference(text,label+' touch hold');
  }
  // Original Shift+direction running can publish many turns between paints.
  for(const key of ['L','H']){
   const before=(await snap()).state.trace.input_index;
   await page.keyboard.press('Shift+'+key);text+=key;
   await page.waitForFunction(before=>__rogueBrowserTest.trace.input_index>before&&__rogueBrowserTest.queuePending===0,before);await settle();
  }
  await reference(text,label+' original running');
  await page.keyboard.press('.');text+='.';await settle();await reference(text,label+' next command');
  const stable=(await snap()).state.trace;await page.waitForTimeout(240);assert.deepEqual((await snap()).state.trace,stable,'Passive redraw never advances C/RNG');
  const frames=await page.evaluate(()=>visibilityFrames);assert.ok(frames.length>=10,label+' completed paints');
  let maxLag=0;
  for(const f of frames){
   assert.ok(f.floor.length>=4,label+' visible floor exists');
   assert.ok(f.floor.every(([x,y])=>Math.abs(x-f.player.x)<=1&&Math.abs(y-f.player.y)<=1),label+' floor follows the actual original visibility');
   if(mode==='ascii')continue;
   assert.ok(f.pose&&f.playerImage,label+' actual player image');
   const lag=Math.hypot(f.pose.displayX-f.player.x,f.pose.displayY-f.player.y);maxLag=Math.max(maxLag,lag);
   assert.ok(lag<1e-8,label+' player detached from visible floor: '+JSON.stringify(f));
   const r=f.playerImage.rect,c=f.camera;
   assert.ok(Math.abs(r.x-(f.player.x*c.size-c.left))<1,label+' painted player X uses the same ground cell');
   assert.ok(Math.abs(r.y-((f.player.y-1)*c.size-c.top))<1,label+' painted player Y uses the same ground cell');
   assert.ok(f.groundImages.some(g=>Math.abs(g.x-r.x)<1&&Math.abs(g.y-r.y)<1),label+' floor is painted beneath the player');
  }
  const screenshot=label+'.png';await page.screenshot({path:path.join(output,screenshot)});
  report.checks.push({label,frames:frames.length,maxLag,text,screenshot,samples:frames});
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify({checks:report.checks.map(({label,frames,maxLag})=>({label,frames,maxLag})),errors:report.errors,output}));
}finally{
 await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
 await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();
}

// The playable bindings and real game, without test exports or route replacement.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
import {runGame} from '../run-game.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_AUTOWALK_OUTPUT?path.resolve(process.env.ROGUE_AUTOWALK_OUTPUT):artifactDirectory(path.join(root,'tests/browser-smoke/output/autowalk-production'));
await mkdir(output,{recursive:true});const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=process.env.ROGUE_AUTOWALK_BASE||'http://127.0.0.1:'+server.address().port;
const report={errors:[],checks:[]};let runtime,browser,context,page;
try{
 runtime=await prepareBrowserRuntime(root);browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
 for(const mobile of [false,true]){
  await context?.close();context=await browser.newContext({viewport:{width:mobile?390:1240,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1,ignoreHTTPSErrors:true});
  await context.addInitScript(()=>{const Native=Worker;window.__messages=[];window.Worker=class extends Native{constructor(...a){super(...a);this.addEventListener('message',e=>{if(['trace','input-request'].includes(e.data.type))__messages.push(e.data);});}};});
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/?trace=1&view=pixels');
  const exports=await page.evaluate(async()=>Object.keys(await import('/build/browser-ui.js')));assert.ok(!exports.includes('browser_snapshot'));
  await page.locator('[data-control="new-game"]:enabled').waitFor();
  await page.locator('#seed').fill('17');await page.locator('[data-control="new-game"]').click();
  await page.waitForFunction(()=>{const o=JSON.parse(document.querySelector('#rogue-observation').textContent);return o.running&&o.input?.kind==='command'&&__messages.some(m=>m.type==='input-request');});
  const before=await page.evaluate(()=>JSON.parse(document.querySelector('#rogue-observation').textContent));
  report.before=before;report.startTrace=await page.evaluate(()=>__messages.filter(m=>m.type==='trace').at(-1));
  const [dx,dy,key]=[[1,0,'l'],[-1,0,'h'],[0,1,'j'],[0,-1,'k']].find(([dx,dy])=>[1,2,3].every(n=>'.#+%'.includes(before.map[(before.player.y+dy*n)*before.width+before.player.x+dx*n])))||[];
  assert.ok(key,'Normal seed has a publicly known three-step route');const target={x:before.player.x+dx*3,y:before.player.y+dy*3};
  const b=await page.locator('#rogue-canvas').boundingBox();
  // The initial public player is centered by the normal Rust camera. The
  // production PC dock is 230px; the phone reserves messages, the dock and the exploration row.
  const mapW=mobile?b.width:Math.floor(b.width*.8),mapH=mobile?b.height-64-184-58:b.height-230;
  const x=b.x+mapW/2+dx*3*32,y=b.y+mapH/2+dy*3*32;
  await page.screenshot({path:path.join(output,'production-'+mobile+'-before.png')});
  if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
  await page.waitForFunction(p=>{const o=JSON.parse(document.querySelector('#rogue-observation').textContent);return o.player?.x===p.x&&o.player?.y===p.y;},target);
  await page.waitForTimeout(400);const observed=await page.evaluate(()=>({public:JSON.parse(document.querySelector('#rogue-observation').textContent),messages:__messages}));
  assert.deepEqual(observed.public.player,target);const trace=observed.messages.filter(m=>m.type==='trace').at(-1);
  const reference=await runGame(path.join(root,'build/game.wasm'),{seed:17,name:'Player',locale:'ja',messagePaging:'log',text:key.repeat(3)});assert.deepEqual(trace.words,reference.traces.at(-1).words);
  if(process.env.ROGUE_AUTOWALK_PRODUCTION_BEFORE){const prior=await runGame(process.env.ROGUE_AUTOWALK_PRODUCTION_BEFORE,{seed:17,name:'Player',locale:'ja',messagePaging:'log',text:key.repeat(3)});assert.deepEqual(trace.words,prior.traces.at(-1).words);} 
  await page.screenshot({path:path.join(output,'production-'+mobile+'-arrived.png')});report.checks.push({mobile,target,key,trace});console.log('PASS production '+(mobile?'mobile tap':'PC click'));
  const startIndex=trace.input_index;
  if(mobile)await page.locator('[data-control="touch-explore"]').tap();else await page.keyboard.press('v');
  await page.waitForFunction(index=>__messages.some(message=>message.type==='trace'&&message.input_index>index),startIndex);
  await page.keyboard.press('.');await page.waitForTimeout(250);
  const stoppedTrace=await page.evaluate(()=>__messages.filter(message=>message.type==='trace').at(-1));
  await page.waitForTimeout(350);assert.deepEqual(await page.evaluate(()=>__messages.filter(message=>message.type==='trace').at(-1)),stoppedTrace,'Manual input stops production exploration');
  report.checks.push({mobile,operation:'explore-and-stop',startIndex,trace:stoppedTrace});console.log('PASS production '+(mobile?'phone exploration tap':'PC exploration key')+' and manual stop');
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;throw e;}
finally{await writeFile(path.join(output,'production-evidence.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

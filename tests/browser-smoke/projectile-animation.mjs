// Real C projectile observations + actual PC/touch input and Rust-painted pixels.
// Contract and independent baseline preparation: docs/MAP-DISPLAY-ja.md, this directory's README.
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
const root=fileURLToPath(new URL('../../',import.meta.url)),output=artifactDirectory(path.join(root,'tests/browser-smoke/output/projectile-animation'));
const baseline=process.env.ROGUE_PROJECTILE_BASELINE;assert.ok(baseline,'Set ROGUE_PROJECTILE_BASELINE to the independent pre-change fixture Wasm');
await mkdir(output,{recursive:true});const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=path.join(root,'build/item-use-fixtures.wasm');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'},report={checks:[],samples:[],errors:[]};let ctx,page,cfg,fixture,journal;
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function key(k){await page.locator('#rogue-canvas').focus();await page.keyboard.press(k);await paint();}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function tap(id){await paint();const c=(await snap()).scene.controls.find(c=>c.id===id&&!c.disabled);assert.ok(c,id);const b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(cfg.mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function open(value){fixture=value;journal='';await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view='+cfg.mode);await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();for(const [id,value]of [['name','ProjectileCheck'],['seed','17']]){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}await tap('new-game');await wait('command');}
async function compare(){const expected=await runGame(baseline,{fixture,seed:17,name:'ProjectileCheck',locale:'ja',messagePaging:'log',text:journal}),actual=await snap();assert.deepEqual(actual.state.trace.words,expected.traces.at(-1).words,'Same original C/RNG after '+JSON.stringify(journal));assert.equal(actual.state.trace.input_index,journal.length);assert.equal(actual.state.runtimeError,null);assert.deepEqual(actual.state.uiMissing,[]);assert.deepEqual(actual.state.translationFallbacks,[]);}
async function use(item,command,direction){
 if(cfg.mobile){
  await tap('touch-action-action.inventory');journal+='i';await wait('space');await tap('item-'+item);await tap('window-'+command.charCodeAt(0));journal+=' '+command;
  if(direction){await wait('direction');await tap('touch-'+direction);journal+=direction;}
  journal+=item;
 }else{
  await key(command);journal+=command;
  if(direction){await wait('direction');await key(direction);journal+=direction;}
  await wait('item');await key(item);journal+=item;
 }
 await wait('command');
}
async function arm(){await page.evaluate(()=>{window.__captureFlight=true;});}
async function advance(delta){await page.evaluate(delta=>{window.__flightClock+=delta;__rogueUiAdapter.invalidate();},delta);await paint();}
async function capture(kind,label){
 await page.waitForFunction(kind=>window.__flightClock!==null&&__rogueUiAdapter.state.projectiles?.some(f=>f.kind===kind),kind);await paint();
 const first=await snap(),before=first.state.trace,frames=[],hashes=[];
 for(let i=0;i<3;i++){
  if(i)await advance(65);
  const s=await snap(),flight=s.state.projectiles.find(f=>f.kind===kind);assert.ok(flight,label+' still flying');
  const command=s.commands.find(c=>c.projectile);assert.ok(command,'Projectile is actually painted');
  assert.equal(command.op,kind==='arrow'?'path':'image');if(kind==='item')assert.equal(command.fitRotation,true);
  const camera=s.scene.camera,map=s.scene.mapRect;assert.ok(Math.abs(command.rect.x-(map.x+flight.x*camera.size-camera.left))<.01);assert.ok(Math.abs(command.rect.y-(map.y+(flight.y-1)*camera.cellH-camera.top))<.01);
  const hash=await page.evaluate(async r=>{const c=document.querySelector('#rogue-canvas'),ratio=c.width/c.clientWidth,x=Math.max(0,Math.round(r.x*ratio)),y=Math.max(0,Math.round(r.y*ratio)),w=Math.min(c.width-x,Math.round(r.w*ratio)),h=Math.min(c.height-y,Math.round(r.h*ratio));const rgba=c.getContext('2d').getImageData(x,y,w,h).data;const digest=await crypto.subtle.digest('SHA-256',rgba);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');},map);
  hashes.push(hash);frames.push(flight);assert.deepEqual(s.state.trace,before,'Animation timer performs no game read/turn/RNG');
  await page.screenshot({path:path.join(output,cfg.label+'-'+label+'-'+i+'.png')});
 }
 assert.ok(new Set(hashes).size>1,'Actual map pixels change while projectile travels');assert.ok(frames.some(f=>Math.abs(f.x-frames[0].x)>.05||Math.abs(f.y-frames[0].y)>.05),'Projectile moves across cells');
 if(kind==='item')assert.ok(new Set(frames.map(f=>f.rotation)).size>1,'Thrown item spins');
 if(kind==='arrow')assert.equal(new Set(frames.map(f=>f.rotation)).size,1,'Arrow keeps its orientation');
 report.samples.push({config:cfg.label,label,frames,hashes});await advance(1000);assert.deepEqual((await snap()).state.projectiles,[]);assert.ok(!(await snap()).commands.some(c=>c.projectile),'Finished flight leaves no sprite');await compare();
 await key('.');journal+='.';await page.waitForFunction(n=>__rogueBrowserTest.trace.input_index===n&&!__rogueBrowserTest.queuePending,journal.length);await wait('command');await compare();
}
try{
 for(cfg of [{label:'pc-pixels',mode:'pixels',mobile:false},{label:'pc-tiles',mode:'tiles',mobile:false},{label:'phone-pixels',mode:'pixels',mobile:true},{label:'phone-tiles',mode:'tiles',mobile:true}]){
  ctx=await browser.newContext({viewport:cfg.mobile?{width:390,height:844}:{width:1240,height:900},isMobile:cfg.mobile,hasTouch:cfg.mobile,deviceScaleFactor:cfg.mobile?2:1});
  await ctx.addInitScript(()=>{
   const now=Date.now;window.__flightClock=null;window.__lastFlightNow=null;window.__captureFlight=false;
   Date.now=()=>window.__flightClock??(window.__lastFlightNow=now());
   const put=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(...args){const state=window.__rogueUiAdapter?.state;if(window.__captureFlight&&state?.projectiles?.length){window.__flightClock=window.__lastFlightNow;window.__captureFlight=false;}return put.apply(this,args);};
   // Browser JavaScript still cannot draw sprites, paths, text or rotations.
   for(const name of ['fillRect','strokeRect','fillText','strokeText','measureText','drawImage','beginPath','arc','roundRect','fill','stroke','clip','rotate','scale','translate'])CanvasRenderingContext2D.prototype[name]=()=>{throw Error('JavaScript drawing forbidden: '+name);};
  });
  await ctx.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));await ctx.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));page=await ctx.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
  await open('item-use-weapon-4-known');await arm();await use('f','t','h');await capture('item','spinning-dagger');
  await open('item-use-weapon-4-known');await use('d','w');await arm();await use('e','t','l');await capture('arrow','straight-arrow');
  for(const [kind,label]of [[2,'magic-bolt'],[11,'target-magic'],[0,'light-pulse']]){await open('item-use-stick-'+kind+'-known');await arm();await use('f','z','h');await capture('magic',label);}
  // Diagonal throws retain the same camera/scale and item spin.
  await open('item-use-weapon-4-known');await arm();await use('f','t','y');await capture('item','diagonal-dagger');
  await open('item-use-stick-2-known');for(let i=0;i<6;i++){if(cfg.mobile)await tap('touch-h');else await key('h');journal+='h';await wait('command');}
  await arm();await use('f','z','h');await capture('magic','reflected-bolt');
  // Turning animation off consumes observations once; enabling it never replays them.
  await open('item-use-weapon-4-known');await tap('settings-toggle');await tap('animation-toggle');await tap('settings-close');await use('f','t','h');assert.deepEqual((await snap()).state.projectiles,[]);assert.ok(!(await snap()).commands.some(c=>c.projectile));await compare();await tap('settings-toggle');await tap('animation-toggle');await tap('settings-close');assert.deepEqual((await snap()).state.projectiles,[]);await compare();
  // Cancel at the direction prompt, then issue the next ordinary command.
  if(cfg.mobile){await tap('touch-action-action.inventory');journal+='i';await wait('space');await tap('item-e');await tap('window-116');journal+=' t';await wait('direction');await tap('touch-action-action.cancel');journal+='\x1b';}else{await key('z');journal+='z';await wait('direction');await key('Escape');journal+='\x1b';}await wait('command');assert.deepEqual((await snap()).state.projectiles,[]);await key('.');journal+='.';await wait('command');await compare();
  report.checks.push(cfg);console.log('PASS '+cfg.label);await ctx.close();ctx=null;
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await ctx?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();}

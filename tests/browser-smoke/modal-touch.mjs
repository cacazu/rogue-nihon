import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/modal-touch'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],errors:[],screenshots:[]};
let resumed=!process.env.ROGUE_MODAL_FROM;
if(!resumed){const previous=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));report.checks.push(...previous.checks);report.screenshots.push(...previous.screenshots);}
let context,page,mobile,cdp;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending}));
async function physical(x,y){return page.evaluate(({x,y})=>{
 const b=document.querySelector('#rogue-canvas').getBoundingClientRect(),s=__rogueBrowserTest.canvas;
 if(document.documentElement.classList.contains('portrait-reversed'))return {x:b.left+y*b.width/s.height,y:b.bottom-x*b.height/s.width};
 if(document.documentElement.classList.contains('portrait-rotated'))return {x:b.right-y*b.width/s.height,y:b.top+x*b.height/s.width};
 return {x:b.left+x*b.width/s.width,y:b.top+y*b.height/s.height};
},{x,y});}
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
 const c=(await scene()).controls.find(c=>c.id===id),p=await physical(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2);
 if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);await paint();
}
async function swipe(x,y,dx,dy){
 const from=await physical(x,y),to=await physical(x+dx,y+dy);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
 for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8,id:1}]});await paint();}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();
}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){if(!resumed){if(!name.includes(process.env.ROGUE_MODAL_FROM))return;resumed=true;}await fn();report.checks.push(name);console.log('PASS '+name);}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0&&!__rogueBrowserTest.diagnostics.windowClosing);await paint();}
function closeControl(s){
 const icon=s.icons.filter(i=>i.name==='close').at(-1);assert.ok(icon,'Close icon');
 const c=s.controls.find(c=>Math.abs(c.rect.x+c.rect.w/2-icon.rect.x-icon.rect.w/2)<.01&&Math.abs(c.rect.y+c.rect.h/2-icon.rect.y-icon.rect.h/2)<.01);
 assert.ok(c,'Close control');assert.ok(c.rect.w>=48&&c.rect.h>=48);
 if(s.scope.startsWith('dialog:')){assert.equal(c.rect.y,s.dialogRect.y+8);assert.equal(c.rect.x+c.rect.w,s.dialogRect.x+s.dialogRect.w-8);}
 return c;
}
async function close(){await tap(closeControl(await scene()).id);}
async function inventory(){if(mobile)await tap('touch-action-action.inventory');else await page.keyboard.press('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();}
async function reveal(id){
 for(let i=0;i<20;i++){const s=await scene(),c=s.controls.find(c=>c.id===id);if(c&&c.rect.h>=40)return;
  const r=s.regions.dialog.rect;if(mobile)await swipe(r.x+r.w/2,r.y+r.h-40,0,-Math.min(150,r.h-64));else{const p=await physical(r.x+r.w/2,r.y+r.h/2);await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,150);await paint();}
 }throw Error('Cannot reveal '+id);
}
async function command(key,kind){await page.keyboard.press(key);await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind,kind);await paint();}
async function scrolling(region,control=null,backwards=false){
 const before=await state(),s=await scene(),r=s.regions[region].rect;assert.ok(s.regions[region].max>0,'Overflow '+region);
 const c=control?s.controls.find(c=>c.id===control):null,x=c?c.rect.x+c.rect.w/2:r.x+r.w/2;
 const y=c?c.rect.y+c.rect.h/2:r.y+r.h/2,offset=s.scrolls[region];
 await swipe(x,y,0,backwards?Math.min(120,r.h/3):-Math.min(120,r.h/3));
 const after=await scene();assert.ok(backwards?after.scrolls[region]<offset:after.scrolls[region]>offset,'Swipe '+region);assert.deepEqual(await state(),before);assert.equal(after.scope,s.scope);
}
try{
 for(mobile of [true,false]){
  const device=mobile?'phone':'pc';context=await browser.newContext({viewport:mobile?{width:320,height:480}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
  await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", "inventory-all");\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));
  await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);
  await page.addInitScript(()=>{
   window.__portraitRequests=[];Object.defineProperty(screen.orientation,'lock',{configurable:true,value:kind=>{__portraitRequests.push(kind);return Promise.reject(new DOMException('Emulated unsupported orientation lock','NotSupportedError'));}});
   const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__modalMessage=message=>handler({data:{type:'message',...message}});}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));
  if(mobile)await check('phone top swipes over a field without focusing or activating it',async()=>{
   const s=await scene(),r=s.controls.find(c=>c.id==='name').rect;assert.ok(s.regions.top.max>0);await swipe(r.x+r.w/2,r.y+r.h/2,0,-60);assert.ok((await scene()).scrolls.top>0);assert.notEqual(await page.evaluate(()=>document.activeElement.id),'name');await tap('name');assert.equal(await page.evaluate(()=>document.activeElement.id),'name');await page.keyboard.press('Tab');
  });
  await tap('new-game');await idle();
  await check(device+' inventory has a header X and closes normally',async()=>{
   await inventory();const s=await scene();closeControl(s);assert.ok(!s.controls.some(c=>c.id==='window-32'&&c.rect.y>s.dialogRect.y+56));
   if(mobile){const item=s.controls.find(c=>c.id.startsWith('item-')&&c.rect.h>=40&&c.rect.y>s.regions.dialog.rect.y+50);await scrolling('dialog',item.id);assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.ui.window.kind),'menu');await shot('phone-inventory-swiped');}
   await close();await idle();
  });
  await check(device+' item details X closes nested inventory without extra game turns',async()=>{
   await inventory();await reveal('item-a');await tap('item-a');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window?.kind==='inventory_actions');await tap('window-118');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window?.kind==='inventory_details');await paint();closeControl(await scene());await close();await idle();
  });
  await check(device+' item selection X cancels; swiping rows never selects an item',async()=>{
   await command('d','item');if(mobile){const s=await scene(),item=s.controls.find(c=>c.id.startsWith('item-')&&c.rect.h>=40&&c.rect.y>s.regions.dialog.rect.y+50);await scrolling('dialog',item.id);assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.ui.input.kind),'item');}await close();await idle();
  });
  await check(device+' symbol input X cancels its unsubmitted draft',async()=>{
   await command('/','symbol');closeControl(await scene());await tap('command-key');await page.keyboard.insertText('?');await close();await idle();
  });
  await check(device+' help and discoveries use the header X',async()=>{
   for(const [key,kind]of [['?','help'],['D','discovery']]){await command(key,kind);await tap('window-42');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='space');await paint();closeControl(await scene());if(mobile&&(await scene()).regions.dialog.max>0)await scrolling('dialog');await close();await idle();}
  });
  await check(device+' game options X finishes both editing and final acknowledgement',async()=>{
   await tap('settings-toggle');closeControl(await scene());if(mobile){await scrolling('settings','save');await shot('phone-settings-swiped');}
   await close();await tap('settings-toggle');const s=await scene(),c=s.controls.find(c=>c.id==='mobile-system-111');if(c.rect.h<40){if(mobile){const r=s.regions.settings.rect;await swipe(r.x+r.w/2,r.y+r.h/2,0,-150);}else{const p=await physical(s.regions.settings.rect.x+40,s.regions.settings.rect.y+40);await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,300);await paint();}}
   await tap('mobile-system-111');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.mode==='options');await paint();await close();await idle();
  });
  await check(device+' hand and confirmation X and direction-pad cancel work safely',async()=>{
   await command('P','item');await reveal('item-h');await tap('item-h');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='hand');await paint();await close();await idle();
   await command('z','direction');if(mobile)await tap('touch-action-action.cancel');else await page.keyboard.press('Escape');await idle();
   await command('Q','confirm');const before=(await state()).words;await close();await idle();assert.deepEqual((await state()).words.slice(0,16),before.slice(0,16));
  });
  if(mobile){
   await check('phone status, operations, history and HUD respond to direct swipes',async()=>{
    await tap('status-open');await scrolling('status');closeControl(await scene());await shot('phone-status-swiped');await close();
    await tap('mobile-operations');await scrolling('mobile-operations','mobile-op-109');closeControl(await scene());await close();
    await page.evaluate(()=>{for(let i=0;i<24;i++){const text='確認用履歴 '+i;__modalMessage({id:'ui.text',args:[{kind:'string',value:text}],text});}});await paint();await tap('history-open');await scrolling('log',null,true);closeControl(await scene());await shot('phone-history-swiped');await close();
    const s=await scene();if(s.regions.hud.max>0){const r=s.regions.hud.rect,before=await state();await swipe(r.x+r.w/2,r.y+r.h/2,-60,0);assert.ok((await scene()).scrolls.hud>0);assert.equal((await scene()).scope,'game');assert.deepEqual(await state(),before);}
   });
   await check('phone remains portrait after rotation; transformed taps and fullscreen work',async()=>{
    const before=await state();await page.setViewportSize({width:844,height:390});await paint();assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('portrait-rotated')),true);assert.equal((await scene()).width,390);assert.ok((await scene()).height>390);
    await tap('settings-toggle');closeControl(await scene());await shot('phone-landscape-portrait-settings');await tap('fullscreen');await page.waitForFunction(()=>!!document.fullscreenElement);await paint();assert.equal((await scene()).width,390);assert.ok((await scene()).height>390);await tap('fullscreen');await page.waitForFunction(()=>!document.fullscreenElement);await close();assert.deepEqual(await state(),before);assert.ok((await page.evaluate(()=>__portraitRequests)).filter(k=>k==='portrait').length>=2);
    await page.setViewportSize({width:390,height:844});await paint();assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('portrait-rotated')),false);
   });
   await check('phone keyboard-sized viewport does not trigger a false orientation rotation',async()=>{
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:300,screenWidth:390,screenHeight:844,deviceScaleFactor:2,mobile:true,screenOrientation:{type:'portraitPrimary',angle:0}});await paint();assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('portrait-rotated')),false);await page.setViewportSize({width:390,height:844});await paint();
   });
  }
  await check(device+' result X returns to top',async()=>{await command('Q','confirm');await tap('window-121');await page.waitForFunction(()=>['death','tombstone','score','victory'].includes(__rogueBrowserTest.frame?.ui.mode));await paint();assert.equal(closeControl(await scene()).id,'result-top');await shot(device+'-result-x');await close();await page.waitForFunction(()=>__rogueBrowserTest.topOpen);});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await page?.evaluate(()=>({input:__rogueBrowserTest.frame?.ui.input,window:__rogueBrowserTest.frame?.ui.window,closing:__rogueBrowserTest.diagnostics.windowClosing,requests:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending,scene:__rogueBrowserTest.canvas})).catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

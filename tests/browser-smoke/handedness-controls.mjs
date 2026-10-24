// Handed layouts, readable controls and original C command continuations.
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
const settingsOnly=process.argv.includes('--settings-only');
const disabledOnly=process.argv.includes('--disabled-only');
const output=process.env.ROGUE_HANDED_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/handedness-controls'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=path.join(root,'build/game-fixtures.wasm');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};let context,page,cfg,journal,fixture;
const snap=()=>page.evaluate(()=>({scene:__rogueBrowserTest.canvas,state:__rogueUiAdapter.state,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const game=async()=>{const s=await snap();return {words:s.state.trace.words,index:s.state.trace.input_index};};
async function wait(kind='command'){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);
 let c=(await snap()).scene.controls.find(c=>c.id===id);
 for(let n=0;n<20&&c.rect.h<c.fullRect.h;n++){
  const s=(await snap()).scene,r=(s.regions.settings||s.regions.dialog).rect,b=await page.locator('#rogue-canvas').boundingBox();
  await page.mouse.move(b.x+r.x+r.w/2,b.y+r.y+r.h/2);await page.mouse.wheel(0,c.fullRect.y<r.y?-100:100);await paint();c=(await snap()).scene.controls.find(c=>c.id===id);
 }
 assert.deepEqual(c.rect,c.fullRect,id+' fully visible');
 const b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
 if(cfg.phone)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();
}
async function key(key,text=key){await page.locator('#rogue-canvas').focus();await page.keyboard.press(key);journal+=text;await paint();}
async function shot(label){const name=cfg.label+'-'+label+'.png';await page.screenshot({path:path.join(output,name)});report.screenshots.push(name);}
async function start(name='inventory-context'){
 fixture=name;journal='';await context?.close();
 context=await browser.newContext({viewport:{width:cfg.width,height:cfg.height},hasTouch:cfg.phone,isMobile:cfg.phone});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+cfg.lang+'&view=pixels');
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();await page.locator('#name').fill('Handed');await page.locator('#seed').fill('17');await tap('new-game');await wait();
}
async function compare(label){
 const expected=await runGame(wasm,{fixture,name:'Handed',seed:17,locale:cfg.lang,messagePaging:'log',text:journal}),s=await snap();
 assert.deepEqual(s.state.trace.words,expected.traces.at(-1).words,label+' original C state/RNG');
 assert.equal(s.state.trace.input_index,journal.length,label+' consumed inputs');assert.deepEqual(s.state.uiMissing,[]);assert.deepEqual(s.state.translationFallbacks,[]);
 report.checks.push(cfg.label+': '+label);console.log('PASS '+report.checks.at(-1));
}
async function hand(value){const before=await game();await tap('settings-toggle');if((await snap()).state.handedness!==value)await tap('handedness-toggle');await tap('settings-close');assert.deepEqual(await game(),before);}
function dock(scene){return scene.controls.filter(c=>c.id.startsWith('pc-')||c.id.startsWith('touch-')||['mobile-movement','mobile-full-map','mobile-operations'].includes(c.id));}
function layout(s){
 const controls=dock(s.scene),get=id=>controls.find(c=>c.id===id);
 assert.ok(get('touch-h').rect.x<get('touch-l').rect.x);assert.equal(get('touch-h').rect.w,get('touch-h').rect.h);
 for(let i=0;i<controls.length;i++){
  const c=controls[i];assert.deepEqual(c.rect,c.fullRect,c.id);assert.ok(c.rect.w>=48&&c.rect.h>=48,c.id+' target');assert.ok(c.rect.x>=0&&c.rect.y>=0&&c.rect.x+c.rect.w<=cfg.width&&c.rect.y+c.rect.h<=cfg.height,c.id+' fits');
  for(const b of controls.slice(i+1)){const a=c.rect,r=b.rect;assert.ok(a.x+a.w<=r.x||r.x+r.w<=a.x||a.y+a.h<=r.y||r.y+r.h<=a.y,c.id+' avoids '+b.id);}
 }
 if(!cfg.phone)for(const [id,key]of [['mobile-movement','g'],['pc-inventory','i'],['pc-search','s'],['pc-wield','w'],['pc-throw','t'],['pc-zap','z'],['mobile-full-map','p'],['touch-again','E'],['pc-explore','v'],['pc-quaff','q'],['pc-ring','P'],['pc-read','r'],['pc-eat','e']])assert.equal(get(id)?.shortcut,key,id+' command shortcut');
 return controls;
}
try{
 for(cfg of [{label:'pc1400-ja',width:1400,height:900,lang:'ja',phone:false},{label:'pc700-ja',width:700,height:500,lang:'ja',phone:false},{label:'pc700-en',width:700,height:500,lang:'en',phone:false},{label:'phone390-ja',width:390,height:844,lang:'ja',phone:true},{label:'phone320-ja',width:320,height:568,lang:'ja',phone:true},{label:'phone320-en',width:320,height:568,lang:'en',phone:true}]){
  if(disabledOnly&&!['pc1400-ja','pc700-ja','phone320-ja'].includes(cfg.label))continue;
  await start();
  if(disabledOnly){
   const brightest=async(id,half=0)=>page.evaluate(({id,half})=>{
    const c=__rogueBrowserTest.canvas.controls.find(c=>c.id===id),canvas=document.querySelector('#rogue-canvas'),scale=canvas.width/canvas.clientWidth;
    const r=c.rect,top=r.y+5+(half===2?r.h/2:0),height=(half?r.h/2:r.h)-10;
    const pixels=canvas.getContext('2d').getImageData(Math.round((r.x+5)*scale),Math.round(top*scale),Math.max(1,Math.floor((r.w-10)*scale)),Math.max(1,Math.floor(height*scale))).data;
    let max=0;for(let i=0;i<pixels.length;i+=4)max=Math.max(max,pixels[i],pixels[i+1],pixels[i+2]);return max;
   },{id,half});
   await shot('normal-opacity');
   for(const [id,half]of [['mobile-movement',0],['touch-again',1],['touch-again',2]])assert.ok(await brightest(id,half)>220,'Enabled caption stays bright');
   if(!cfg.phone){
    await key('t');await wait('direction');const before=await game();await shot('disabled-captions');
    for(const [id,half]of [['mobile-movement',0],['touch-again',1],['touch-again',2]]){
     const max=await brightest(id,half);assert.ok(max>70&&max<140,id+' disabled pixel brightness '+max);
     const c=(await snap()).scene.controls.find(c=>c.id===id);assert.equal(c.disabled,true);const b=await page.locator('#rogue-canvas').boundingBox();
     await page.mouse.click(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+(half===1?c.rect.h/4:half===2?c.rect.h*3/4:c.rect.h/2));await paint();assert.deepEqual(await game(),before);
    }
    await key('Escape','\x1b');await wait();await compare('disabled custom captions, pixels and ignored clicks');
   }else{report.checks.push(cfg.label+': normal phone captions stay fully opaque');}
   continue;
  }
  if(settingsOnly){for(const value of ['right','left']){const before=await game();await tap('settings-toggle');if((await snap()).state.handedness!==value)await tap('handedness-toggle');await shot(value+'-settings');await tap('settings-close');assert.deepEqual(await game(),before);}report.checks.push(cfg.label+': setting thumb and label agree without C input');continue;}let s=await snap();assert.equal(s.state.handedness,'right');const initial=await game(),right=layout(s);await shot('right');
  assert.ok(s.scene.controls.find(c=>c.id==='touch-again').label.includes('1'));
  await hand('left');s=await snap();const left=layout(s);await shot('left');
  for(const c of right){const mirror=left.find(v=>v.id===c.id);if(!c.id.startsWith('touch-')||['touch-search','touch-again','touch-action-action.inventory'].includes(c.id))assert.ok(Math.abs(c.rect.x+mirror.rect.x+c.rect.w-cfg.width)<.01,c.id+' mirrors');}
  assert.deepEqual(await game(),initial);
  await page.reload();await page.waitForFunction(()=>__rogueUiAdapter.state?.handedness==='left');await page.locator('#name').fill('Handed');await page.locator('#seed').fill('17');await tap('new-game');await wait();journal='';layout(await snap());
  for(const value of ['right','left']){
   await hand(value);await key('t');await wait('direction');s=await snap();assert.ok(s.scene.controls.find(c=>c.id==='touch-h').rect.x<s.scene.controls.find(c=>c.id==='touch-l').rect.x);await shot(value+'-direction');await key('Escape','\x1b');await wait();
   await tap('settings-toggle');await tap('mobile-controls');await key('t');await wait('direction');s=await snap();assert.ok(s.scene.controls.find(c=>c.id==='window-104').rect.x<s.scene.controls.find(c=>c.id==='window-108').rect.x);await shot(value+'-hidden-direction');await key('Escape','\x1b');await wait();await tap('settings-toggle');await tap('mobile-controls');
  }
  if(!cfg.phone){
   await key('W');await wait('item');assert.equal((await snap()).state.input.filter,'armor');await tap('window-27');journal+='\x1b';await wait();
   for(const [id,verb,filter]of [['pc-quaff','q','potion'],['pc-ring','P','ring'],['pc-read','r','scroll'],['pc-eat','e','food']]){
    await tap(id);journal+=verb;await wait('item');s=await snap();assert.equal(s.state.input.filter,filter);assert.ok(s.scene.controls.some(c=>c.id==='inventory-tab-'+filter));await tap('window-27');journal+='\x1b';await wait();
   }
   for(const k of ['T','W','k','P','h','l','R','q','f','r','g','e','a']){await key(k);await paint();}
   await wait();await tap('pc-search');journal+='s';await wait();
   await tap('pc-wield');journal+='w';await wait('item');await tap('item-d');journal+='d';await wait();
   const mapHeight=(await snap()).scene.mapRect.h;
   await tap('touch-j');journal+='j';await wait();s=await snap();assert.ok(s.scene.controls.some(c=>c.id==='pc-trap'));assert.ok(s.scene.controls.some(c=>c.id==='pc-fire'));assert.ok(s.scene.controls.some(c=>c.id==='pc-search'));assert.ok(s.scene.controls.some(c=>c.id==='pc-throw'));layout(s);await shot('trap-and-fire');
   for(let step=0;step<3;step++){await tap('touch-k');journal+='k';await wait();}s=await snap();assert.ok(!s.scene.controls.some(c=>c.id==='pc-trap'));assert.equal(s.scene.mapRect.h,mapHeight);
   await key('d');await wait('item');await tap('item-b');journal+='b';await wait();assert.ok((await snap()).scene.controls.some(c=>c.id==='pc-pickup'));await shot('pickup');await tap('pc-pickup');journal+=',';await wait();
  }else{
   await tap('touch-j');journal+='j';await wait();s=await snap();const c=s.scene.controls.find(c=>c.id==='touch-search');assert.equal(c.key,94);assert.ok(s.commands.some(v=>v.op==='box'&&v.rect.x===c.rect.x&&v.rect.y===c.rect.y&&v.fill!== '#000000'));await shot('trap-highlight');await tap('touch-search');journal+='^';await wait('direction');await tap('touch-j');journal+='j';await wait();
  }
  await compare('both hands, reload, natural directions, cancellation and next commands');
  if(!cfg.phone){await start('inventory-amulet');s=await snap();assert.ok(s.scene.controls.some(c=>c.id==='pc-ascend'));assert.ok(s.scene.controls.some(c=>c.id==='pc-descend'));assert.ok(s.scene.controls.some(c=>c.id==='pc-search'));layout(s);await shot('both-stairs');await compare('both stair choices preserve the original command state');}
 }
 assert.deepEqual(report.errors,[]);
} catch(error){report.failure=error.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

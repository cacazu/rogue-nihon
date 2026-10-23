import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';

// docs/IMPLEMENTATION-ja.md: real production game and onscreen desktop actions.
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_PC_DOCK_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/desktop-dock'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let context,page;
const snap=()=>page.evaluate(()=>({scene:__rogueBrowserTest.canvas,state:__rogueUiAdapter.state}));
const state=async()=>{const {state}=await snap();return {words:state.trace.words,index:state.trace.input_index};};
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function wait(kind='command'){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&__rogueBrowserTest.queuePending===0,kind);await paint();}
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);
 let c=(await snap()).scene.controls.find(c=>c.id===id);
 for(let attempt=0;attempt<12&&(c.rect.h<c.fullRect.h||c.rect.w<c.fullRect.w);attempt++){
  const scene=(await snap()).scene,region=scene.regions.dialog?.rect||scene.regions.settings?.rect;
  assert.ok(region,id+' scroll viewport');const box=await page.locator('#rogue-canvas').boundingBox();
  await page.mouse.move(box.x+region.x+region.w/2,box.y+region.y+region.h/2);
  await page.mouse.wheel(0,c.fullRect.y<region.y?-80:80);await paint();c=(await snap()).scene.controls.find(c=>c.id===id);assert.ok(c,id);
 }
 const box=await page.locator('#rogue-canvas').boundingBox();
 assert.deepEqual(c.rect,c.fullRect,id+' fully visible');
 await page.mouse.click(box.x+c.rect.x+c.rect.w/2,box.y+c.rect.y+c.rect.h/2);await paint();
}
async function key(value){const before=(await snap()).state.inputRequestCount;await page.keyboard.press(value);await page.waitForFunction(before=>__rogueBrowserTest.inputRequestCount>before&&__rogueBrowserTest.queuePending===0,before);await paint();}
async function shot(label){await page.screenshot({path:path.join(output,label+'.png')});report.screenshots.push(label+'.png');}
async function open(config,before=false){
 await context?.close();context=await browser.newContext({viewport:{width:config.width,height:config.height}});
 page=await context.newPage();page.setDefaultTimeout(12000);await installBrowserTestAdapter(page);
 if(before&&process.env.ROGUE_PC_DOCK_BEFORE){
  const build=path.join(process.env.ROGUE_PC_DOCK_BEFORE,'build');
  await page.route('**/build/browser-ui.js',r=>r.fulfill({path:path.join(build,'browser-test.js'),contentType:'text/javascript',headers}));
  await page.route('**/build/browser-test.wasm',r=>r.fulfill({path:path.join(build,'browser-test.wasm'),contentType:'application/wasm',headers}));
 }
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+config.language+'&view='+config.mode);
 await page.locator('#name').fill('PCDock');await page.locator('#seed').fill('17');await tap('new-game');await wait();
}
function layout(scene){
 const controls=scene.controls.filter(c=>c.id.startsWith('pc-')||c.id.startsWith('touch-')||['mobile-movement','mobile-full-map'].includes(c.id));
 assert.ok(controls.some(c=>c.id==='pc-inventory'));assert.ok(controls.some(c=>c.id==='touch-.'));
 const map=scene.mapRect,log=scene.controls.find(c=>c.id==='history-open').rect;
 assert.equal(map.y+map.h,log.y+log.h);
 for(const c of controls){
  assert.ok(c.rect.y>=map.y+map.h,c.id+' stays below map and log');
  assert.ok(c.rect.x>=0&&c.rect.y>=0&&c.rect.x+c.rect.w<=scene.width&&c.rect.y+c.rect.h<=scene.height,c.id+' fits');
  assert.ok(c.rect.w>=48&&c.rect.h>=48,c.id+' target');assert.deepEqual(c.rect,c.fullRect);
 }
 for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
  const a=controls[i].rect,b=controls[j].rect;
  assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,controls[i].id+' avoids '+controls[j].id);
 }
}
async function reference(config){
 await open(config,true);const initial=(await snap()).scene;await shot(config.label+'-before');
 for(const value of ['s','.','i','Escape','w','d','t','Escape','t','l','e','z','Escape','w','c','t','h','e','s','3','a'])await key(value);
 await wait();return {initial,expected:await state()};
}
try{
 for(const config of [
  {width:1400,height:900,language:'ja',mode:'pixels',label:'pc-ja-1400'},
  {width:900,height:700,language:'en',mode:'ascii',label:'pc-en-900'},
  {width:700,height:500,language:'ja',mode:'tiles',label:'pc-ja-700'},
 ]){
  const {initial,expected}=await reference(config);await open(config);let s=await snap();layout(s.scene);
  if(process.env.ROGUE_PC_DOCK_BEFORE)assert.equal(initial.mapRect.h-s.scene.mapRect.h,172,'Dedicated dock height');
  await shot(config.label+'-after');const clean=await state();
  await tap('mobile-full-map');await shot(config.label+'-overview');assert.deepEqual(await state(),clean);
  await tap('mobile-full-map');assert.deepEqual(await state(),clean);
  await tap('history-open');assert.ok(!(await snap()).scene.controls.some(c=>c.id==='pc-inventory'));await page.keyboard.press('Escape');await paint();assert.deepEqual(await state(),clean);
  await tap('commands-open');assert.ok(!(await snap()).scene.controls.some(c=>c.id==='pc-inventory'));await page.keyboard.press('Escape');await paint();assert.deepEqual(await state(),clean);
  await tap('header-fullscreen');await paint();layout((await snap()).scene);assert.deepEqual(await state(),clean);await tap('header-fullscreen');await paint();
  await tap('pc-context');await wait();await tap('touch-.');await wait();
  await tap('pc-inventory');await wait('space');assert.ok(!(await snap()).scene.controls.some(c=>c.id==='pc-inventory'));await key('Escape');await wait();
  await tap('pc-wield');await wait('item');await tap('item-d');await wait();
  s=await snap();assert.ok(s.scene.controls.some(c=>c.id==='pc-fire'&&!c.disabled));assert.ok(!s.scene.controls.some(c=>c.id==='pc-throw'));await shot(config.label+'-bow');
  await tap('pc-fire');await wait('direction');assert.ok((await snap()).scene.controls.some(c=>c.id==='pc-cancel'));assert.ok(!(await snap()).scene.controls.some(c=>c.id==='touch-.'));await shot(config.label+'-direction');await tap('pc-cancel');await wait();
  await tap('pc-fire');await wait('direction');await tap('touch-l');await wait();
  await tap('pc-zap');await wait('direction');await tap('pc-cancel');await wait();
  await tap('pc-wield');await wait('item');await tap('item-c');await wait();assert.ok((await snap()).scene.controls.some(c=>c.id==='pc-throw'));
  await tap('pc-throw');await wait('direction');await tap('touch-h');await wait('item');await tap('item-e');await wait();
  await tap('pc-context');await wait();const beforeRepeat=await state();
  s=await snap();const repeat=s.scene.controls.find(c=>c.id==='touch-again'),box=await page.locator('#rogue-canvas').boundingBox();
  await page.mouse.move(box.x+repeat.rect.x+repeat.rect.w/2,box.y+repeat.rect.y+repeat.rect.h/2);await page.mouse.down();await page.waitForTimeout(600);await page.mouse.up();await paint();
  assert.equal((await snap()).scene.scope,'repeat-count');assert.deepEqual(await state(),beforeRepeat);
  await page.locator('#repeat-count').fill('3');await tap('repeat-count-submit');await paint();
  assert.notEqual((await snap()).scene.scope,'repeat-count');await tap('touch-again');await wait();
  assert.deepEqual(await state(),expected,'Clicks preserve the original C commands and RNG');
  await tap('pc-wield');await wait('item');await tap('item-d');await wait();await key('d');await key('e');await wait();
  assert.ok((await snap()).scene.controls.find(c=>c.id==='pc-fire').disabled,'Arrow depletion disables desktop firing');
  s=await snap();assert.deepEqual(s.state.uiMissing,[]);assert.deepEqual(s.state.translationFallbacks,[]);
  report.checks.push(config.label+': dock layout, actual commands, bow, cancel, repeat, overview and C/RNG parity');console.log('PASS '+report.checks.at(-1));
 }
 await open({width:1400,height:900,language:'ja',mode:'pixels'});const beforeHide=await state(),mapHeight=(await snap()).scene.mapRect.h;
 await tap('settings-toggle');await tap('mobile-controls');assert.ok(!(await snap()).scene.controls.some(c=>c.id==='pc-inventory'));
 assert.equal((await snap()).scene.mapRect.h,mapHeight+172);assert.deepEqual(await state(),beforeHide);
 await key('t');await wait('direction');assert.ok((await snap()).scene.controls.some(c=>c.id==='window-27'),'Hidden dock uses ordinary direction dialog');await tap('window-27');await wait();
 const beforeShow=await state();await tap('settings-toggle');await tap('mobile-controls');layout((await snap()).scene);assert.deepEqual(await state(),beforeShow);
 report.checks.push('Settings hides and restores the dock; hidden direction prompt stays operable');
 await page.setViewportSize({width:390,height:844});await paint();
 const phone=(await snap()).scene;assert.ok(phone.controls.some(c=>c.id==='touch-action-action.inventory'));assert.ok(!phone.controls.some(c=>c.id==='pc-inventory'));await shot('phone-preserved');
 await page.setViewportSize({width:1400,height:900});await paint();layout((await snap()).scene);
 report.checks.push('Phone layout preserved and desktop restored on resize');
 await context.close();context=await browser.newContext({viewport:{width:1400,height:900}});page=await context.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?lang=ja&view=pixels');
 await page.locator('#name').fill('PCDock');await page.locator('#seed').fill('17');
 await page.locator('[data-control="new-game"]').click();await page.locator('[data-control="pc-inventory"]').waitFor({state:'visible'});
 await page.locator('[data-control="pc-wield"]').click();await page.locator('[data-control="item-d"]').click();
 await page.locator('[data-control="pc-fire"]').click();await page.locator('[data-control="touch-l"]').click();
 await page.locator('[data-control="pc-fire"]').waitFor({state:'visible'});await paint();await shot('production-pc-bow');
 report.checks.push('Published UI and normal game fire an arrow through native desktop controls');assert.deepEqual(report.errors,[]);
}finally{
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 await context?.close();await browser.close();await runtime.dispose();await new Promise(resolve=>server.close(resolve));console.log('Evidence: '+output);
}

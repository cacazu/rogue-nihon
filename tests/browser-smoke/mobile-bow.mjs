import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {createPreviewServer} from '../../tools/server.mjs';

// Ordinary production game, real inventory taps, and original t/direction/item keys.
// Optional ROGUE_BOW_BEFORE points to a pre-change build for state/visual comparison.
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_BOW_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-bow'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const runtime=await prepareBrowserRuntime(root);
const {chromium}=loadPlaywright();
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let context,page,mobile;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,index:__rogueBrowserTest.trace.input_index}));
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);
 const c=(await scene()).controls.find(c=>c.id===id),box=await page.locator('#rogue-canvas').boundingBox();
 assert.deepEqual(c.rect,c.fullRect,id+' is fully visible');
 const x=box.x+c.rect.x+c.rect.w/2,y=box.y+c.rect.y+c.rect.h/2;
 if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
 await paint();
}
async function key(key){
 const before=await page.evaluate(()=>__rogueBrowserTest.inputRequestCount);await page.keyboard.press(key);
 await page.waitForFunction(before=>__rogueBrowserTest.inputRequestCount>before&&__rogueBrowserTest.queuePending===0,before);await paint();
}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function open({width=390,height=844,language='ja',mode='pixels',before=false,phone=true}={}){
 await context?.close();mobile=phone;
 context=await browser.newContext({viewport:{width,height},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);
 if(before){
  const build=path.join(process.env.ROGUE_BOW_BEFORE,'build');
  await page.route('**/build/browser-ui.js',r=>r.fulfill({path:path.join(build,'browser-test.js'),contentType:'text/javascript',headers}));
  await page.route('**/build/browser-test.wasm',r=>r.fulfill({path:path.join(build,'browser-test.wasm'),contentType:'application/wasm',headers}));
  await page.route('**/build/game.wasm',r=>r.fulfill({path:path.join(build,'game.wasm'),contentType:'application/wasm',headers}));
 }
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+language+'&view='+mode);
 await page.locator('#seed').fill('17');await tap('new-game');await idle();
}
async function wield(letter){
 if(mobile)await tap('touch-action-action.inventory');else await key('i');
 await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();
 assert.ok(!(await scene()).controls.some(c=>c.id==='touch-fire'),'No firing through inventory');
 await tap('item-'+letter);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();
 await tap('window-119');await idle();
}
async function reference(config){
 await open({...config,before:!!process.env.ROGUE_BOW_BEFORE});await wield('d');
 await shot(config.label+'-before');
 await key('t');await key('Escape');await key('.');
 for(const direction of ['l','h']){await key('t');await key(direction);await key('e');await idle();}
 return state();
}
try{
 for(const config of [
  {width:390,height:844,language:'ja',mode:'pixels',label:'ja-390'},
  {width:320,height:568,language:'ja',mode:'tiles',label:'ja-320'},
  {width:320,height:568,language:'en',mode:'ascii',label:'en-320'},
 ]){
  const expected=await reference(config);await open(config);
  const initial=await scene(),log=initial.controls.find(c=>c.id==='history-open').rect;
  assert.ok(!initial.controls.some(c=>c.id==='touch-fire'));
  await wield('d');let s=await scene(),fire=s.controls.find(c=>c.id==='touch-fire'),message=s.controls.find(c=>c.id==='history-open').rect;
  assert.ok(fire&&!fire.disabled);assert.equal(fire.label,config.language==='ja'?'矢を撃つ':'Fire arrow');
  assert.equal(log.y-message.y,58,'Chat moves up one control row');assert.equal(initial.mapRect.h-s.mapRect.h,58);
  assert.equal(message.h,log.h,'Two chat lines remain available');
  assert.ok(fire.rect.w>=48&&fire.rect.h>=48);assert.ok(message.y+message.h<=fire.rect.y);
  assert.ok(fire.rect.y+fire.rect.h<=s.controls.find(c=>c.id==='touch-k').rect.y);
  const before=await state();await paint();assert.deepEqual(await state(),before,'Displaying the button does not advance C');
  await shot(config.label+'-equipped');
  await tap('history-open');assert.ok(!(await scene()).controls.some(c=>c.id==='touch-fire'),'History blocks shooting');
  await page.keyboard.press('Escape');await paint();assert.deepEqual(await state(),before);
  await tap('mobile-operations');await tap('mobile-operations-close');assert.deepEqual(await state(),before);
  await tap('touch-fire');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.movement_direction===true);await paint();
  assert.ok((await scene()).controls.find(c=>c.id==='touch-fire').disabled);
  await shot(config.label+'-direction');await tap('touch-action-action.cancel');await idle();await key('.');
  for(const direction of ['l','h']){await tap('touch-fire');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.movement_direction===true);await paint();await tap('touch-'+direction);await idle();}
  assert.deepEqual(await state(),expected,'Button equals original t/direction/arrow including C state and RNG');
  await wield('c');s=await scene();assert.ok(!s.controls.some(c=>c.id==='touch-fire'));assert.equal(s.controls.find(c=>c.id==='history-open').rect.y,log.y);
  await wield('d');await key('d');await key('e');await idle();s=await scene();
  assert.ok(s.controls.find(c=>c.id==='touch-fire').disabled,'No arrows disables firing while keeping the bow row');
  await shot(config.label+'-no-arrows');
  assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.translationFallbacks),[]);
  report.checks.push(config.label+': equip, chat shift, direction, cancel, C/RNG parity, history, unequip, no arrows');console.log('PASS '+report.checks.at(-1));
 }
 await open({phone:false,width:1240,height:900});await wield('d');assert.ok(!(await scene()).controls.some(c=>c.id==='touch-fire'));assert.ok((await scene()).controls.some(c=>c.id==='pc-fire'&&!c.disabled));
 await shot('desktop-equipped');report.checks.push('Desktop uses its dedicated firing control');
 assert.deepEqual(report.errors,[]);
}finally{
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 await context?.close();await browser.close();await runtime.dispose();await new Promise(resolve=>server.close(resolve));console.log('Evidence: '+output);
}

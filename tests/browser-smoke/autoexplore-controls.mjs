// Isolated UI acceptance for the shared exploration command and preference migration.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_EXPLORE_CONTROLS_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/autoexplore-controls'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};let context,page,cfg;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const snap=()=>page.evaluate(()=>({scene:__rogueBrowserTest.canvas,state:__rogueUiAdapter.state}));
const prefs=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('rogue-controls-v1')));
const get=async id=>(await snap()).scene.controls.find(c=>c.id===id);
async function wait(kind='command'){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function key(value){await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);await paint();}
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
 const c=await get(id),b=await page.locator('#rogue-canvas').boundingBox();assert.deepEqual(c.rect,c.fullRect,id+' full target');
 const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
 if(cfg.touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();
}
async function start(){await page.locator('#name').fill('Explore controls');await page.locator('#seed').fill('17');await tap('new-game');await wait();}
async function persistPreferences(){
 const before=(await snap()).state.trace;
 // Exercise a reversible real edit so the storage contains the canonical loaded preferences.
 for(let turn=0;turn<2;turn++){
  await tap('settings-toggle');await tap('controls-placement');
  const a=await get('mobile-movement'),z=await get(cfg.width<700?'touch-action-action.inventory':'pc-inventory'),b=await page.locator('#rogue-canvas').boundingBox();
  const x=b.x+a.rect.x+a.rect.w/2,y=b.y+a.rect.y+a.rect.h/2,tx=b.x+z.rect.x+z.rect.w/2,ty=b.y+z.rect.y+z.rect.h/2;
  if(cfg.touch){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(tx,ty,{steps:6});await page.mouse.up();}
  await paint();await tap('controls-commit');
 }
 assert.deepEqual((await snap()).state.trace,before,'Reversible configuration edits never send C input or consume RNG');
}

async function open(config,preferences){
 await context?.close();cfg=config;
 context=await browser.newContext({viewport:{width:cfg.width,height:cfg.width===320?568:900},hasTouch:cfg.touch,isMobile:cfg.touch});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'autoexplore-clear'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 if(preferences)await context.addInitScript(p=>{if(!sessionStorage.getItem('explore-preferences-loaded')){localStorage.setItem('rogue-controls-v1',JSON.stringify(p));sessionStorage.setItem('explore-preferences-loaded','1');}},preferences);
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+cfg.lang+'&view=pixels');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await start();await persistPreferences();
}
async function shot(label){const name=label+'.png';await page.screenshot({path:path.join(output,name)});report.screenshots.push(name);}
async function hand(value){await tap('settings-toggle');if((await snap()).state.handedness!==value)await tap('handedness-toggle');await tap('settings-close');}
async function check(label,fn){await fn();report.checks.push(label);console.log('PASS '+label);}
function valid(c,width,height){assert.deepEqual(c.rect,c.fullRect);assert.ok(c.rect.w>=48&&c.rect.h>=48);assert.ok(c.rect.x>=0&&c.rect.y>=0&&c.rect.x+c.rect.w<=width&&c.rect.y+c.rect.h<=height);}
try{
 const pc={width:1400,touch:false,lang:'ja'};await open(pc);const defaults=await prefs();assert.ok(defaults?.bindings?.['web.explore']);
 await check('PC button and v start the same exploration command',async()=>{
  for(const input of ['button','key']){
   await open(pc);const control=await get('pc-explore');assert.equal(control.shortcut,'v');
   if(input==='button')await tap('pc-explore');else await key('v');
   await page.waitForFunction(()=>__rogueUiAdapter.state.autowalk.exploring);const s=await snap();assert.equal(s.state.autowalk.mode,0);
   await shot('pc-'+input);await key('Escape');await wait();assert.equal((await snap()).state.autowalk.active,false);
  }
 });
 for(const width of [320,390,650])for(const handedness of ['right','left'])await check(width+' '+handedness+' half-width row, pad placement and pointer shortcuts',async()=>{
  await open({width,touch:width!==650,lang:width===320?'en':'ja'});await hand(handedness);
  let exploration=await get('touch-explore');assert.equal(exploration.shortcut??null,width===650?'v':null);assert.ok(!await get('touch-fire'));const original=exploration.rect;
  await key('w');await wait('item');await tap('item-d');await wait();
  let fire=await get('touch-fire');exploration=await get('touch-explore');assert.ok(fire);assert.equal(exploration.rect.w,fire.rect.w);assert.deepEqual(exploration.rect,original);
  for(const c of [exploration,fire])valid(c,width,width===320?568:900);
  assert.equal(exploration.rect.x<fire.rect.x,handedness==='right');await shot('phone-'+width+'-'+handedness);
  const saved=await prefs(),pad=saved.phone.columns.findIndex(c=>c.kind==='pad');[saved.phone.columns[pad],saved.phone.columns[pad===0?2:0]]=[saved.phone.columns[pad===0?2:0],saved.phone.columns[pad]];
  await page.evaluate(p=>localStorage.setItem('rogue-controls-v1',JSON.stringify(p)),saved);await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await start();
  exploration=await get('touch-explore');const west=await get('touch-h'),east=await get('touch-l'),padCenter=(west.rect.x+east.rect.x+east.rect.w)/2;
  assert.equal(exploration.rect.x<width/2,padCenter<width/2);valid(exploration,width,width===320?568:900);await shot('phone-'+width+'-'+handedness+'-pad-swap');
 });
 await check('Old preferences migrate once and preserve custom v and tilde owners',async()=>{
  const old=structuredClone(defaults);delete old.bindings['web.explore'];old.bindings['game.version']=[{key:'v'}];old.desktop.assignments[3]='game.wear';old.desktop.assignments[1]='game.search';
  await open(pc,old);let saved=await prefs();assert.equal(saved.desktop.assignments[3],'web.explore');assert.equal(saved.desktop.assignments[1],'game.search');assert.equal(saved.bindings['game.version'][0].key,'~');assert.equal(saved.bindings['web.explore'][0].key,'v');
  old.bindings['game.version']=[{key:'F21'}];old.bindings['game.search']=[{key:'v'}];old.bindings['game.inventory']=[{key:'~'}];
  await open(pc,old);saved=await prefs();assert.deepEqual(saved.bindings['web.explore'],[]);assert.equal((await get('pc-explore')).shortcut??null,null);
  assert.equal(saved.bindings['game.search'][0].key,'v');assert.equal(saved.bindings['game.inventory'][0].key,'~');assert.equal(saved.bindings['game.version'][0].key,'F21');
  const before=(await snap()).state.trace.input_index;await key('v');await wait();assert.equal((await snap()).state.trace.input_index,before+1);assert.equal((await snap()).state.autowalk.active,false);
  await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('rogue-controls-v1'));p.desktop.assignments[3]='game.wear';localStorage.setItem('rogue-controls-v1',JSON.stringify(p));});
  await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await start();assert.equal((await prefs()).desktop.assignments[3],'game.wear');assert.deepEqual((await prefs()).bindings['web.explore'],[]);
  await shot('pc-custom-bindings');
  old.bindings['game.version']=[{key:'v'}];old.bindings['game.search']=[{key:'F20'}];await open(pc,old);saved=await prefs();assert.deepEqual(saved.bindings['game.version'],[]);assert.equal(saved.bindings['game.inventory'][0].key,'~');assert.equal(saved.bindings['web.explore'][0].key,'v');
 });
 assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

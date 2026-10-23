// Visual roles must follow the operation, across desktop and phone layouts.
// Uses real C input for item commands and follows each operation back to play.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {runGame} from '../run-game.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const before=process.argv.includes('--before');
const output=process.env.ROGUE_ROLES_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/control-roles'));
await mkdir(output,{recursive:true});
const {chromium}=loadPlaywright(),browser=await chromium.launch({executablePath:browserExecutable(),headless:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const wasm=path.join(root,'build/game-fixtures.wasm');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={before,checks:[],frames:[],errors:[]};let context,page,width;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const snap=()=>page.evaluate(()=>({scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands,state:__rogueUiAdapter.state,trace:__rogueBrowserTest.trace}));
const same=(a,b)=>['x','y','w','h'].every(k=>Math.abs(a[k]-b[k])<.01);
async function role(id,framed){await tap(id,false);const s=await snap(),c=s.scene.controls.find(c=>c.id===id);assert.ok(c,id);
 const boxes=s.commands.filter(v=>v.op==='box'&&same(v.rect,c.fullRect));
 report.frames.push({width,id,framed:boxes.length>0,rect:c.fullRect});
 if(!before){assert.equal(boxes.length>0,framed,id+' visual role');if(framed)assert.ok(boxes.some(v=>v.fill==='#000000'&&v.stroke==='#ffffff'&&v.radius===0),id+' square black/white button');}
}
async function tap(id,activate=true){let direction=1;for(let i=0;i<30;i++){const s=await snap(),c=s.scene.controls.find(c=>c.id===id&&(!activate||!c.disabled));
 if(c&&c.rect.h>=Math.min(c.fullRect.h,38)){if(!activate)return;const b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
  if(width<700)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();return;}
 const regionName=['settings','dialog','mobile-operations','top'].find(name=>s.scene.regions[name]);
 assert.ok(regionName,'Control '+id+' and scroll region exist');const region=s.scene.regions[regionName],r=region.rect,b=await page.locator('#rogue-canvas').boundingBox();
 const offset=s.scene.scrolls[regionName]||0;
 if(offset>=region.max)direction=-1;else if(offset<=0)direction=1;
 if(c)direction=c.fullRect.y<r.y?-1:1;
 await page.mouse.move(b.x+r.x+r.w/2,b.y+r.y+r.h/2);await page.mouse.wheel(0,120*direction);await paint();}
 throw Error('Cannot reveal '+id);
}
async function key(k){await page.locator('#rogue-canvas').focus();await page.keyboard.press(k);await paint();}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,width+'-'+name+'.png')});}
async function check(name,fn){await fn();report.checks.push({width,name});console.log('PASS '+width+' '+name);}
try{for(width of [390,1400,320]){
 context=await browser.newContext({viewport:{width,height:width===320?700:width<700?844:1050},isMobile:width<700,hasTouch:width<700});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'inventory-all'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view=pixels');
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
 await check('language and dropdown values are plain; commands and fields are framed',async()=>{
  await role('select-language',false);await role('new-game',true);await role('name',true);await shot('top');
  await tap('select-language');const values=(await snap()).scene.controls.filter(c=>c.id.startsWith('select-language-'));assert.equal(values.length,2);for(const c of values)await role(c.id,false);
  await shot('language');await key('Escape');
 });
 for(const [id,value]of [['name','UiRoles'],['seed','17']]){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
 await tap('new-game');await wait('command');
 await check('inventory rows and tabs stay plain; item actions and details back are buttons',async()=>{
  await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();
  await role('item-c',false);await role('inventory-tab-all',false);await role('inventory-history',true);await shot('inventory');
  const trace=(await snap()).trace;await tap('item-c');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();assert.deepEqual((await snap()).trace,trace,'Opening actions does not advance C/RNG');
  for(const c of (await snap()).scene.controls.filter(c=>c.id.startsWith('window-')))await role(c.id,true);await shot('item-commands');
  await tap('window-118');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_details');await paint();await role('window-27',true);await shot('details');
  await tap('window-27');await tap('window-27');
  for(const item of ['a','b','d','e','f','g','h','j','k','l','m']){
   await role('item-'+item,false);await tap('item-'+item);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();
   for(const c of (await snap()).scene.controls.filter(c=>c.id.startsWith('window-')))await role(c.id,true);
   await tap('window-27');assert.deepEqual((await snap()).trace,trace,'Inspecting '+item+' commands does not advance C/RNG');
  }
 });
 await check('drop button runs the selected command; the next movement matches direct C input',async()=>{
  await tap('item-f');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await role('window-100',true);await tap('window-100');await wait('command');
  const previous=(await snap()).trace.input_index;await key('j');await page.waitForFunction(n=>__rogueBrowserTest.trace.input_index>n&&!__rogueBrowserTest.queuePending,previous);await paint();
  const reference=await runGame(wasm,{fixture:'inventory-all',seed:17,name:'UiRoles',locale:'ja',messagePaging:'log',text:'i dfj'});assert.deepEqual((await snap()).trace.words,reference.traces.at(-1).words,'Drop and subsequent movement preserve C/RNG');
 });
 await check('equip button executes and the next movement matches direct C input',async()=>{
  await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();await tap('item-d');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();
  await role('window-119',true);await tap('window-119');await wait('command');const previous=(await snap()).trace.input_index;
  await key('j');await page.waitForFunction(n=>__rogueBrowserTest.trace.input_index>n&&!__rogueBrowserTest.queuePending,previous);await paint();
  const reference=await runGame(wasm,{fixture:'inventory-all',seed:17,name:'UiRoles',locale:'ja',messagePaging:'log',text:'i dfji wdj'});assert.deepEqual((await snap()).trace.words,reference.traces.at(-1).words,'Equip and subsequent movement preserve C/RNG');
 });
 await check('settings selections and switch have their own presentation; commands have borders',async()=>{
  const trace=(await snap()).trace;await tap('settings-toggle');await role('select-display-mode',false);await role('animation-toggle',false);await tap('select-display-mode');const values=(await snap()).scene.controls.filter(c=>c.id.startsWith('select-display-mode-'));assert.equal(values.length,3);for(const c of values)await role(c.id,false);await key('Escape');
  await tap('animation-toggle');await tap('animation-toggle');for(const id of ['settings-top','mobile-system-81'])await role(id,true);assert.ok(!(await snap()).scene.controls.some(c=>c.id==='mobile-system-111'),'Original options are absent from shared settings');
  await shot('settings');assert.deepEqual((await snap()).trace,trace);await tap('settings-close');
 });
 if(width<700)await check('mobile operation commands have button frames and preserve subsequent input',async()=>{
  const trace=(await snap()).trace;await tap('mobile-operations');for(const c of (await snap()).scene.controls.filter(c=>c.id.startsWith('mobile-op-')))await role(c.id,true);await shot('operations');assert.deepEqual((await snap()).trace,trace);
  await tap('mobile-op-109');await wait('direction');await key('Escape');await wait('command');await key('j');await wait('command');
 });
 await check('hand values are plain choices and selecting one returns to play',async()=>{
  await key('P');await wait('item');await key('h');await wait('hand');await role('window-108',false);await role('window-114',false);await shot('hand');await tap('window-108');await wait('command');
 });
 await check('confirmation responses are commands',async()=>{await key('Q');await wait('confirm');await role('window-121',true);await role('window-110',true);await shot('confirm');await tap('window-110');await wait('command');});
 await check('original option values are plain; keep and back are command buttons',async()=>{
  await key('o');for(let i=0;i<12;i++){const s=await snap(),kind=s.state.frame.ui.input.kind;
   if(kind==='option_bool'||kind==='option_inventory'){
    const values=kind==='option_bool'?[116,102]:[111,115,99];for(const k of values)await role('window-'+k,false);
    await role('window-13',true);await role('window-45',true);await shot(kind);
    if(kind==='option_inventory')break;
   }
   await key('Enter');
  }
  assert.equal((await snap()).state.frame.ui.input.kind,'option_inventory','Reached original inventory option');await key('Escape');
  for(let i=0;i<3&&(await snap()).state.frame.ui.input.kind!=='command';i++)await key('Space');await wait('command');await key('j');await wait('command');
 });
 await context.close();context=null;
 }assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));}

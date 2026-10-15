import {fixtureWorker} from "./fixture-worker.mjs";
import {loadPlaywright, browserExecutable} from '../../tools/toolchain.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-dock-operations'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let resumed=!process.env.ROGUE_DOCK_FROM;
if(!resumed){const previous=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));report.checks.push(...previous.checks);report.screenshots.push(...previous.screenshots);}
let context,page,cdp,positions;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending,words:__rogueBrowserTest.trace.words,player:__rogueBrowserTest.frame.player}));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.ok(c.rect.h>=Math.min(c.fullRect.h,40),id+' visible');const b=await page.locator('#rogue-canvas').boundingBox();await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();}
async function swipe(distance){const s=await scene(),r=s.regions['mobile-operations'].rect,b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 for(let i=1;i<=3;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-distance*i/3,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();
}
async function open(){if((await scene()).scope!=='mobile-operations')await tap('mobile-operations');}
async function collect(){
 const found=new Map();
 for(let i=0;i<25;i++){const s=await scene(),offset=s.scrolls['mobile-operations'];
  for(const c of s.controls.filter(c=>c.id.startsWith('mobile-op-')||c.id==='mobile-movement'))found.set(c.id,{...c,y:c.fullRect.y+offset});
  if(offset===s.regions['mobile-operations'].max){positions=found;return found;}
  await swipe(Math.min(220,s.regions['mobile-operations'].rect.h/2));
 }throw Error('Operations did not reach the bottom');
}
async function reveal(id){
 await open();
 for(let i=0;i<25;i++){const s=await scene(),c=s.controls.find(c=>c.id===id),r=s.regions['mobile-operations'].rect;
  if(c&&c.rect.h===c.fullRect.h)return;
  const known=positions?.get(id);assert.ok(known,'Known operation '+id);
  const delta=known.y-s.scrolls['mobile-operations']-r.y-60;
  await swipe(Math.sign(delta)*Math.min(Math.abs(delta),r.h/2));
 }throw Error('Cannot reveal '+id);
}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){if(!resumed){if(!name.includes(process.env.ROGUE_DOCK_FROM))return;resumed=true;}await fn();report.checks.push(name);console.log('PASS '+name);}
function dock(s,labels){
 const ids=['mobile-movement','touch-action-action.inventory','touch-search','mobile-full-map','mobile-operations','touch-again'];
 const controls=ids.map(id=>{const c=s.controls.find(c=>c.id===id);assert.ok(c,id);assert.ok(c.rect.w>=48&&c.rect.h===52);return c;});
 for(let row=0;row<3;row++){const a=controls[row*2].rect,b=controls[row*2+1].rect;assert.equal(a.y,b.y);assert.ok(a.x+a.w<b.x);if(row>0)assert.equal(a.y,controls[(row-1)*2].rect.y+58);}
 assert.equal(new Set(controls.filter((_,i)=>i%2===0).map(c=>c.rect.x)).size,1);assert.equal(new Set(controls.filter((_,i)=>i%2===1).map(c=>c.rect.x)).size,1);
 assert.deepEqual(controls.map(c=>c.label),labels);assert.ok(!s.controls.some(c=>['touch-throw','touch-wield','mobile-map','touch-action-action.descend','touch-ascend'].includes(c.id)));
}
const groups=[
 ['移動・探索',[109,44,94,62]],
 ['戦闘',[102,70]],
];
try{
 context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,"inventory-all"),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);
 // Published flags only, to check the conditional ascent control without changing C.
 await page.addInitScript(()=>{const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__dockUi=ui=>handler({data:{type:'presentation',ui}});}};});
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await idle();
 await check('specified three rows fit 390px and 320px phone screens',async()=>{
  for(const [width,height]of [[390,844],[320,568]]){await page.setViewportSize({width,height});await paint();dock(await scene(),['歩く','持ち物','探す','全体図','リスト','繰返し\n長押し']);await shot('phone-'+width+'-dock');}
  await page.setViewportSize({width:390,height:844});await paint();
 });
 await check('movement cycles 歩く → 走る1 → 走る2 → 歩く without C input',async()=>{
  const before=await state();for(const label of ['走る1','走る2','歩く']){await tap('mobile-movement');assert.equal((await scene()).controls.find(c=>c.id==='mobile-movement').label,label);assert.deepEqual(await state(),before);}
 });
 await check('search and repeat buttons execute original commands',async()=>{
  let before=await state();await tap('touch-search');await idle();assert.equal((await state()).input,before.input+1);assert.deepEqual((await state()).player,before.player);
  before=await state();await tap('touch-again');await idle();assert.equal((await state()).input,before.input+1);assert.deepEqual((await state()).player,before.player);
 });
 await check('inventory opens from its new button and closes normally',async()=>{
  await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await tap('window-32');await idle();dock(await scene(),['歩く','持ち物','探す','全体図','リスト','繰返し\n長押し']);
 });
 await check('whole map toggles from its dock button without C input',async()=>{
  const before=await state(),size=(await scene()).camera.size;await tap('mobile-full-map');assert.ok((await scene()).text.includes('自分'));assert.ok((await scene()).text.includes('アイテム'));await shot('phone-whole-map');assert.deepEqual(await state(),before);
  await tap('mobile-full-map');assert.equal((await scene()).camera.size,size);assert.deepEqual(await state(),before);
 });
 await check('operations contain exactly the agreed original actions, grouped and swipeable',async()=>{
  const before=await state();await open();await shot('phone-operations-top');const commands=await page.evaluate(()=>__rogueBrowserTest.commands),headings=groups.map(([title])=>commands.find(c=>c.op==='text'&&c.text===title));assert.ok(headings.every(Boolean));
  const controls=await collect(),expected=groups.flatMap(([,ids])=>ids.map(id=>typeof id==='number'?'mobile-op-'+id:id));assert.deepEqual([...controls.keys()].sort(),expected.sort());
  let last=-Infinity;for(let i=0;i<groups.length;i++){const [title,ids]=groups[i];assert.ok(headings[i].y>last,title);for(const id of ids){const c=controls.get(typeof id==='number'?'mobile-op-'+id:id);assert.ok(c.y>headings[i].y);assert.ok(c.y>=last);last=c.y;}}
  assert.deepEqual(await state(),before);await shot('phone-operations-bottom');await tap('mobile-operations-close');assert.deepEqual(await state(),before);
 });
 await check('discovery opens from the inventory title button',async()=>{
  await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await tap('inventory-history');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.id==='input.close');await paint();await tap('window-32');await idle();
 });
 await check('direction selection from inventory still has cancel and eight arrows',async()=>{
  await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await tap('item-a');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-116');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.movement_direction===true);await paint();
  const s=await scene();assert.equal(s.controls.filter(c=>/^touch-[hjklyubn]$/.test(c.id)).length,8);assert.ok(!s.controls.some(c=>c.id==='touch-again'));await tap('touch-action-action.cancel');await idle();
 });
 await check('standing on stairs changes the context button and hides its duplicate',async()=>{
  for(let i=0;i<5;i++){await tap('touch-l');await idle();}assert.equal((await state()).player.x,15);dock(await scene(),['歩く','持ち物','下りる','全体図','リスト','繰返し\n長押し']);await open();assert.ok(!(await collect()).has('mobile-op-62'));await shot('phone-operations-stairs');await tap('mobile-operations-close');
 });
 await check('ascent is shown only for an amulet and follows published stair availability',async()=>{
  await page.evaluate(()=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.player_state.amulet=true;ui.map_controls.stairs.ascend=true;__dockUi(ui);});await paint();assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'上る');await open();const found=await collect();assert.ok(!found.has('mobile-op-60'));assert.equal(found.get('mobile-op-62').disabled,false);await tap('mobile-operations-close');
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await page?.evaluate(()=>{const f=__rogueBrowserTest.frame;return {player:f.player,underlay:f.map_player_underlay,ui:f.ui};}).catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

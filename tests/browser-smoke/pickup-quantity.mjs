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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/pickup-quantity'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};


let context,page,cdp,mobile=true;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,words:__rogueBrowserTest.trace.words,pending:__rogueBrowserTest.queuePending}));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.ok(Math.abs(c.rect.h-c.fullRect.h)<.01,id+' full height');assert.ok(Math.abs(c.rect.w-c.fullRect.w)<.01,id+' full width');const b=await page.locator('#rogue-canvas').boundingBox();const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(key){await page.keyboard.press(key);await paint();}
async function inventory(){if(mobile)await tap('touch-action-action.inventory');else await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(phone=true,lang='ja',fixture='inventory-all'){
 if(context)await context.close();mobile=phone;
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));}
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+lang);await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await idle();await inventory();
}
async function scroll(region,distance){const r=(await scene()).regions[region].rect,b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2;
 if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=3;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-(region==='inventory-tabs'?distance*i/3:0),y:y-(region==='inventory-tabs'?0:distance*i/3),id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await page.mouse.move(x,y);await page.mouse.wheel(region==='inventory-tabs'?distance:0,region==='inventory-tabs'?0:distance);}await paint();}
async function tab(name){const id='inventory-tab-'+name;for(let i=0;i<15;i++){const s=await scene(),c=s.controls.find(c=>c.id===id);if(c&&Math.abs(c.rect.w-c.fullRect.w)<.01){await tap(id);return;}const order=['all','equipped','stick','food','potion','scroll','weapon','armor','ring'];const visible=s.controls.filter(c=>c.id.startsWith('inventory-tab-'));const first=order.indexOf(visible[0].id.slice(14));await scroll('inventory-tabs',c?(c.fullRect.x<s.regions['inventory-tabs'].rect.x?-110:110):(order.indexOf(name)<first?-110:110));}throw Error('Cannot select '+name);}
async function collectItems(){const found=new Map();for(let i=0;i<20;i++){const s=await scene();for(const c of s.controls.filter(c=>c.id.startsWith('item-')))found.set(c.id.slice(5),c.label);if(s.scrolls.dialog===s.regions.dialog.max)break;await scroll('dialog',Math.min(150,s.regions.dialog.rect.h/2));}return found;}
async function action(item,key){await tap('item-'+item);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-'+key);}
function descriptor(f,key){return f.ui.lines.find(row=>row.key===key).args[1].value;}


const items=async()=>((await frame()).ui.lines).filter(r=>r.id==='ui.inventory.entry').map(r=>({key:r.key,item:r.args[1].value}));
function pickupItems(value){if(!value||typeof value!=='object')return [];return [...(value.type==='item'&&value.pickup?[value]:[]),...Object.values(value).flatMap(pickupItems)];}
async function pickup(count,total,name){
 if(mobile)await tap('touch-l');else await key('ArrowRight');await idle();
 const entry=await page.evaluate(()=>__rogueBrowserTest.diagnostics.entries.filter(e=>e.source==='game').at(-1));
 report.lastEntry=entry;assert.equal(pickupItems(entry.message)[0]?.count,count,'Log uses picked quantity');
 assert.match(entry.text,name.startsWith('矢')?new RegExp('矢.* '+count+'本'):new RegExp(name),'Stored log: '+entry.text);
 const screen=await scene();assert.ok(screen.text.join('').includes(name),'Visible log: '+screen.text.join(''));
 report.observations.push({mobile,count,total,text:entry.text});await shot((mobile?'phone':'desktop')+'-'+count+'-'+total);
 await inventory();const pack=await items();assert.equal(pack.find(r=>r.item.category===(name.startsWith('矢')?'weapon':'food')&&(name.startsWith('矢')?r.item.which===3:true)).item.count,total,'Inventory keeps total');
 assert.ok(pack.every(r=>!r.item.pickup),'Pickup marker never leaks into inventory');
 await tap('window-32');await idle();
}
try {
 report.observations=[];
 for(const phone of [true,false]){
  await start(phone,'ja','pickup-quantity');assert.equal((await items()).find(r=>r.item.category==='weapon'&&r.item.which===3).item.count,10);await tap('window-32');await idle();
  await pickup(1,11,'矢 1本');await pickup(3,14,'矢 3本');await pickup(1,2,'食料 ×1');
  if(mobile)await tap('history-open');else await tap('history-open');
  await paint();const history=(await scene()).text.join('');assert.ok(history.includes('矢 1本')&&history.includes('矢 3本')&&history.includes('食料 ×1'),'History shows acquired quantities');await shot((phone?'phone':'desktop')+'-history');
  report.checks.push((phone?'Phone touch':'Desktop')+': one arrow, three arrows, one food and history');console.log('PASS '+report.checks.at(-1));
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.observedTranslationFailures),[],'No translation failure before or after saving/reloading');
} catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/arrow-consumption'));
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
async function badgeRows(expected){
 const s=await scene(),icons=s.icons.filter(i=>i.name==='equipped'),commands=await page.evaluate(()=>__rogueBrowserTest.commands);assert.equal(icons.length,expected.length);
 for(const key of expected){const c=s.controls.find(c=>c.id==='item-'+key);assert.ok(c);const icon=icons.find(i=>i.rect.y>=c.rect.y&&i.rect.y+i.rect.h<=c.rect.y+c.rect.h);assert.ok(icon,'Badge for '+key);assert.ok(icon.rect.x>=c.rect.x);const first=commands.find(t=>t.op==='text'&&t.y>=c.rect.y&&t.y<c.rect.y+c.rect.h);assert.ok(first&&icon.rect.x+icon.rect.w<first.x,'Badge precedes item text');assert.doesNotMatch(c.label,/武器として装備中|着用中|左手に装備中|右手に装備中|weapon in hand|being worn|on left hand|on right hand/);}
}
function brackets(labels){for(const text of labels.values())assert.doesNotMatch(text,/[［］\[\]（）・]/,'Uniform brackets/spaces: '+text);}


const items=async()=>((await frame()).ui.lines).filter(r=>r.id==='ui.inventory.entry').map(r=>({key:r.key,text:r.text,item:r.args[1].value}));
try {
 await start(true,'ja',null);await tab('weapon');const before=await items();report.before=before;await shot('before-bow-equipped');
 const bow=before.find(r=>r.item.category==='weapon'&&r.item.which===2),arrow=before.find(r=>r.item.category==='weapon'&&r.item.which===3);assert.ok(bow&&arrow);
 await action(bow.key,119);await idle();await inventory();await tab('weapon');report.equipped=await items();assert.equal(report.equipped.find(r=>r.key===bow.key).item.equipped,'weapon');await shot('bow-equipped-before-arrow');
 report.beforeThrow=await state();await action(arrow.key,116);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='direction');await paint();report.aim=await scene();console.log('AIM '+JSON.stringify({input:(await frame()).ui.input,controls:report.aim.controls.filter(c=>c.id.startsWith('touch-')).map(c=>({id:c.id,key:c.key}))}));await shot('arrow-direction');await tap('touch-k');await idle();report.afterThrow=await state();report.throwMessages=await page.evaluate(()=>__rogueBrowserTest.messages);await inventory();await tab('weapon');report.after=await items();await shot('after-one-arrow');
 const remaining=report.after.find(r=>r.item.category==='weapon'&&r.item.which===3);report.arrowCounts={before:arrow.item.count,after:remaining?.item.count||0};console.log('COUNTS '+JSON.stringify(report.arrowCounts));report.passed=report.arrowCounts.after===report.arrowCounts.before-1;assert.ok(report.passed,'One shot consumes one arrow');
 await tap('window-32');await idle();await inventory();await tab('weapon');const heldBefore=(await items()).find(r=>r.key===arrow.key).item.count;await action(arrow.key,116);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='direction');await paint();const aimPoint=(await scene()).controls.find(c=>c.id==='touch-k').rect,canvas=await page.locator('#rogue-canvas').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:canvas.x+aimPoint.x+aimPoint.w/2,y:canvas.y+aimPoint.y+aimPoint.h/2,id:1}]});await page.waitForTimeout(1200);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await idle();await inventory();await tab('weapon');const heldAfter=(await items()).find(r=>r.key===arrow.key)?.item.count||0;report.holdCounts={before:heldBefore,after:heldAfter};console.log('HOLD '+JSON.stringify(report.holdCounts));assert.equal(heldAfter,heldBefore-1);
 await tap('window-32');await idle();await inventory();await tab('weapon');const savedBefore=(await items()).find(r=>r.key===arrow.key).item.count;await action(arrow.key,116);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='direction');await paint();await tap('settings-toggle');await tap('save');await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);await paint();await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await paint();await tap('load');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='direction'&&__rogueBrowserTest.queuePending===0);await paint();await tap('touch-k');await idle();await inventory();await tab('weapon');const savedAfter=(await items()).find(r=>r.key===arrow.key)?.item.count||0;report.saveCounts={before:savedBefore,after:savedAfter};console.log('SAVE '+JSON.stringify(report.saveCounts));assert.equal(savedAfter,savedBefore-1);
 await tap('window-32');await idle();await tap('history-open');await paint();report.finalHistory=await scene();report.translationFallbacks=await page.evaluate(()=>__rogueBrowserTest.translationFallbacks);assert.deepEqual(report.translationFallbacks,[],'Wield, throw and restored throw have no missing translations');assert.doesNotMatch(report.finalHistory.text.join(''),/日本語訳を表示できません|どの方向/,'Mobile history hides the keyboard direction prompt');await shot('phone-throw-history');report.passed=true;

assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.observedTranslationFailures),[],'No translation failure before or after saving/reloading');
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

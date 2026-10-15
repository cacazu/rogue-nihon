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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/parameter-icons'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let resumed=!process.env.ROGUE_PARAMETER_FROM;
if(!resumed){const previous=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));report.checks.push(...previous.checks);report.screenshots.push(...previous.screenshots);}

let context,page,cdp,mobile=true;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,words:__rogueBrowserTest.trace.words,pending:__rogueBrowserTest.queuePending}));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.ok(Math.abs(c.rect.h-c.fullRect.h)<.01,id+' full height');assert.ok(Math.abs(c.rect.w-c.fullRect.w)<.01,id+' full width');const b=await page.locator('#rogue-canvas').boundingBox();const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(key){await page.keyboard.press(key);await paint();}
async function inventory(){await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){if(!resumed){if(!name.includes(process.env.ROGUE_PARAMETER_FROM))return;resumed=true;}await fn();report.checks.push(name);console.log('PASS '+name);}
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
 const s=await scene(),f=await frame();assert.equal(s.icons.filter(i=>i.name==='equipped').length,0);
 const en=await page.evaluate(()=>__rogueBrowserTest.language)==='en';
 for(const key of expected){const c=s.controls.find(c=>c.id==='item-'+key);assert.ok(c);const slot=descriptor(f,key).equipped;assert.ok(c.label.endsWith(en?{weapon:'Hand',armor:'Body',left_ring:'Left hand',right_ring:'Right hand'}[slot]:{weapon:'手',armor:'胴体',left_ring:'左手',right_ring:'右手'}[slot]));}
}
const ringKnown=d=>d.category==='ring'&&d.known===true&&d.type_known!==false;
const ringIcon=d=>ringKnown(d)?({0:'shield',1:'strength',7:'item-hit',8:'item-damage'}[d.which]||'item-modifier'):'item-modifier';
const fields={hplus:'item-hit',dplus:'item-damage',enchantment:'item-enchantment',protection:'shield',bonus:'item-modifier',strength:'strength',charges:'item-charges'};
async function rowPaint(key,expected){
 const s=await scene(),c=s.controls.find(c=>c.id==='item-'+key);assert.ok(c,'Item '+key);
 const within=r=>r.y>=c.fullRect.y&&r.y+r.h<=c.fullRect.y+c.fullRect.h;
 const icons=s.icons.filter(i=>within(i.rect)&&Object.values(fields).includes(i.name));
 assert.deepEqual(icons.map(i=>i.name),expected.map(([name])=>name),'Parameter icons '+key);
 const commands=(await page.evaluate(()=>__rogueBrowserTest.commands)).filter(t=>t.op==='text'&&t.y>=c.fullRect.y&&t.y<c.fullRect.y+c.fullRect.h);
 for(const icon of icons){assert.ok(icon.rect.x>=c.fullRect.x);assert.ok(icon.rect.x+icon.rect.w<=c.fullRect.x+c.fullRect.w,'Icon fits');const value=commands.find(t=>t.x>=icon.rect.x+icon.rect.w&&t.x<icon.rect.x+icon.rect.w+4&&Math.abs((t.y+t.size/2)-(icon.rect.y+icon.rect.h/2))<.1);assert.ok(value,'Value next to '+icon.name);assert.equal(value.text,expected.find(([name])=>name===icon.name)[1]);}
 const painted=commands.map(t=>t.text).join('');assert.doesNotMatch(painted,/命中|威力|強化|防御力|補正|残り|hit |damage |enchantment |protection |bonus |charges/,'No visible parameter labels');
 return {c,painted,icons};
}
async function details(item,expected,screenshot){
 await tap('item-'+item);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-118');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_details');await paint();
 const f=await frame(),s=await scene(),commands=await page.evaluate(()=>__rogueBrowserTest.commands);
 assert.deepEqual(f.ui.lines.filter(r=>r.parameter).map(r=>r.parameter),expected);
 for(const row of f.ui.lines.filter(r=>r.parameter)){const item=f.ui.lines[0].args[1].value,kindIcon=row.parameter==='bonus'?ringIcon(item):fields[row.parameter];const en=await page.evaluate(()=>__rogueBrowserTest.language)==='en';const names=en?{0:'Protection',1:'Strength',7:'Hit',8:'Damage'}:{0:'防御力',1:'腕力',7:'命中',8:'威力'};const detailText=row.parameter==='bonus'&&ringKnown(item)&&names[item.which]?names[item.which]+'：'+item.bonus:row.text;const text=commands.find(c=>c.op==='text'&&c.text===detailText);assert.ok(text,'Detail label '+row.text);const icon=s.icons.find(i=>i.name===kindIcon&&Math.abs(text.x-(i.rect.x+i.rect.w+2))<.1&&Math.abs((text.y+text.size/2)-(i.rect.y+i.rect.h/2))<.1);assert.ok(icon,'Detail icon + label '+row.parameter);}
 if(screenshot)await shot(screenshot);
 await tap('window-27');await paint();await tap('window-27');await paint();
}
try {
 await start();
 await check('phone inventory replaces weapon and armor parameter labels with inline icons',async()=>{const before=await state();await tab('equipped');await badgeRows(['b','c']);await rowPaint('b',[['item-enchantment','+1'],['shield','4']]);await rowPaint('c',[['item-hit','+1'],['item-damage','+1']]);assert.deepEqual(await state(),before);await shot('phone-equipped-parameters');});
 await check('320px wrapped parameter icons keep their values together and inside the rows',async()=>{await page.setViewportSize({width:320,height:568});await paint();await rowPaint('b',[['item-enchantment','+1'],['shield','4']]);await rowPaint('c',[['item-hit','+1'],['item-damage','+1']]);await shot('phone-320-parameters');await page.setViewportSize({width:390,height:844});await paint();});
 await check('weapon and armor details retain their item names beside the same parameter icons',async()=>{const before=await state();await details('b',['enchantment','protection'],'phone-armor-details');await details('c',['hplus','dplus'],'phone-weapon-details');assert.deepEqual((await state()).words,before.words);assert.equal((await state()).pending,0);});
 await check('ring and staff use matching icons in inventory and labeled details',async()=>{const before=await state();await tab('ring');await rowPaint('h',[['shield','+1']]);await rowPaint('i',[['strength','+1']]);await shot('phone-ring-parameters');await details('h',['bonus']);await tab('stick');await rowPaint('j',[['item-charges','5']]);await shot('phone-staff-parameters');await details('j',['charges'],'phone-staff-details');assert.deepEqual((await state()).words,before.words);assert.equal((await state()).pending,0);});
 await check('unidentified weapon continues to hide numeric parameters and their icons',async()=>{await tab('weapon');await collectItems();const r=await rowPaint('m',[]);assert.equal(r.painted,'短剣');assert.doesNotMatch(r.painted,/7|-3/);});
 await start(false);
 await check('PC inventory and details show the same parameter icons with keyboard prefixes',async()=>{await tab('equipped');const r=await rowPaint('c',[['item-hit','+1'],['item-damage','+1']]);assert.ok(r.painted.startsWith('c) メイス'));await rowPaint('b',[['item-enchantment','+1'],['shield','4']]);await shot('pc-parameters');await details('b',['enchantment','protection'],'pc-armor-details');});
 await start(false,'en');
 await check('English inventory and details retain the same semantic icons and numeric values',async()=>{await tab('equipped');await rowPaint('c',[['item-hit','+1'],['item-damage','+1']]);await rowPaint('b',[['item-enchantment','+1'],['shield','4']]);await shot('pc-en-parameters');await details('c',['hplus','dplus'],'pc-en-weapon-details');});
 await start(true,'ja',null);
 await check('playable build contains inline parameter icons and labeled details',async()=>{await tab('equipped');const f=await frame();for(const row of f.ui.lines.filter(r=>r.args?.[1]?.value?.equipped!=='none'&&r.key)){const d=row.args[1].value;const expected=[];for(const [field,icon] of Object.entries(fields)){const visibility=['enchantment','protection'].includes(field)?'ac':field==='bonus'?'ring_bonus':field;if(d.visible_fields[visibility]===true&&Number.isInteger(d[field]))expected.push([field==='bonus'?ringIcon(d):icon,['hplus','dplus','enchantment','bonus'].includes(field)?(d[field]>=0?'+':'')+d[field]:String(d[field])]);}await rowPaint(row.key,expected);}await details('b',['enchantment','protection']);});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

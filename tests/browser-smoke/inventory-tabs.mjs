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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/inventory-tabs'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
const order=['all','equipped','stick','food','potion','scroll','weapon','armor','ring','amulet','gold'];
let page,context,cdp,mobile=true,positions=new Map();
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,words:__rogueBrowserTest.trace.words,pending:__rogueBrowserTest.queuePending}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0&&!__rogueBrowserTest.diagnostics.windowClosing);await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.ok(Math.abs(c.rect.h-c.fullRect.h)<.01,id+' full height');assert.ok(Math.abs(c.rect.w-c.fullRect.w)<.01,id+' full width');const b=await page.locator('#rogue-canvas').boundingBox();const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(key){await page.keyboard.press(key);await paint();}
async function inventory(){await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();}
async function close(){await tap('window-32');await idle();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(phone=true,fixture='inventory-all'){
 if(context)await context.close();mobile=phone;positions=new Map();
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await idle();
}
async function scroll(region,distance){
 const r=(await scene()).regions[region].rect,b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2;
 if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=3;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-(region==='inventory-tabs'?distance*i/3:0),y:y-(region==='inventory-tabs'?0:distance*i/3),id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await page.mouse.move(x,y);await page.mouse.wheel(region==='inventory-tabs'?distance:0,region==='inventory-tabs'?0:distance);}
 await paint();
}
async function collectTabs(){
 const found=new Map();for(let i=0;i<15;i++){const s=await scene(),r=s.regions['inventory-tabs'].rect,offset=s.scrolls['inventory-tabs'];for(const c of s.controls.filter(c=>c.id.startsWith('inventory-tab-')))found.set(c.id.slice(14),{...c,left:c.fullRect.x-r.x+offset});if(offset===s.regions['inventory-tabs'].max)break;await scroll('inventory-tabs',Math.min(120,r.w/2));}
 positions=found;return found;
}
async function tab(tab){
 const id='inventory-tab-'+tab;for(let i=0;i<15;i++){const s=await scene(),c=s.controls.find(c=>c.id===id),r=s.regions['inventory-tabs'].rect;if(c&&Math.abs(c.rect.w-c.fullRect.w)<.01){await tap(id);assert.equal((await scene()).inventory.tab,tab);return;}
 const p=positions.get(tab);assert.ok(p,tab+' exists');const desired=Math.max(0,Math.min(s.regions['inventory-tabs'].max,p.left+p.fullRect.w/2-r.w/2));await scroll('inventory-tabs',Math.max(-120,Math.min(120,desired-s.scrolls['inventory-tabs'])));
 }throw Error('Cannot reveal tab '+tab);
}
async function visibleItems(){const found=new Set();for(let i=0;i<20;i++){const s=await scene();for(const c of s.controls.filter(c=>c.id.startsWith('item-')))found.add(c.id.slice(5));if(s.scrolls.dialog===s.regions.dialog.max)break;await scroll('dialog',Math.min(150,s.regions.dialog.rect.h/2));}return [...found].sort();}
function header(s,commands){const title=commands.find(c=>c.op==='text'&&c.text==='持ち物'),h=s.controls.find(c=>c.id==='inventory-history'),x=s.controls.find(c=>c.id==='window-32');assert.ok(title&&h&&x);assert.equal(h.rect.h,title.size);assert.equal(h.rect.y,title.y);assert.ok(h.rect.x+h.rect.w+8<=x.rect.x);assert.equal(x.rect.h,48);}
try {
 await start();await inventory();
 await check('phone history button matches title height and only held categories appear in order',async()=>{header(await scene(),await page.evaluate(()=>__rogueBrowserTest.commands));const before=await state(),found=await collectTabs();assert.deepEqual([...found.keys()].sort((a,b)=>order.indexOf(a)-order.indexOf(b)),order.slice(0,9));assert.ok(!found.has('amulet')&&!found.has('gold'));assert.deepEqual(await state(),before);await tab('all');await shot('phone-inventory-tabs');});
 await check('phone tabs filter public rows without C input or losing equipment context',async()=>{const before=await state();for(const [name,keys]of [['equipped',['b','c']],['stick',['j']],['food',['a']],['potion',['f','l']],['scroll',['g']],['weapon',['c','d','e','m']],['armor',['b','k']],['ring',['h','i']]]){await tab(name);assert.deepEqual(await visibleItems(),keys.sort(),name);assert.equal((await frame()).ui.lines.filter(row=>row.selectable).length,13);assert.deepEqual(await state(),before);}await tab('all');});
 await check('320px header fits and each tab restores its own scroll offset',async()=>{await page.setViewportSize({width:320,height:480});await paint();header(await scene(),await page.evaluate(()=>__rogueBrowserTest.commands));await collectTabs();await tab('weapon');assert.ok((await scene()).regions.dialog.max>0);await scroll('dialog',45);const weapon=(await scene()).scrolls.dialog;assert.ok(weapon>0);await tab('all');await scroll('dialog',160);const all=(await scene()).scrolls.dialog;assert.ok(all>weapon);await tab('weapon');assert.equal((await scene()).scrolls.dialog,weapon);await tab('all');assert.equal((await scene()).scrolls.dialog,all);await shot('phone-320-tabs-scrolled');});
 await check('details/back and closing/reopening preserve the selected tab and position',async()=>{await tab('all');const offset=(await scene()).scrolls.dialog;const item=(await scene()).controls.find(c=>c.id.startsWith('item-')&&c.rect.h===c.fullRect.h);assert.ok(item);await tap(item.id);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();assert.ok(!(await scene()).controls.some(c=>c.id.startsWith('inventory-tab-')));await tap('window-118');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_details');await paint();await tap('window-27');await paint();await tap('window-27');await paint();assert.equal((await scene()).inventory.tab,'all');assert.equal((await scene()).scrolls.dialog,offset);await close();await inventory();assert.equal((await scene()).scrolls.dialog,offset);});
 await check('the compact history button still opens all discoveries directly and returns to the remembered view',async()=>{const offset=(await scene()).scrolls.dialog;await tap('inventory-history');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory!==true&&__rogueBrowserTest.frame.ui.input.id==='input.close');await paint();assert.ok(!(await scene()).controls.some(c=>c.id==='window-42'||c.id.startsWith('inventory-tab-')));await tap('window-32');await idle();await inventory();assert.equal((await scene()).inventory.tab,'all');assert.equal((await scene()).scrolls.dialog,offset);});
 await check('tab and scroll preferences survive a page reload and saved-game restore',async()=>{await page.setViewportSize({width:390,height:844});await paint();const expected=(await scene()).inventory;assert.ok(expected.positions.all>0);await tap('settings-toggle');await tap('save');await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending&&__rogueBrowserTest.queuePending===0);const before=await state();const preference=await page.evaluate(()=>JSON.parse(localStorage.getItem('rogue-inventory-view-v1')));assert.equal(preference.tab,expected.tab);assert.equal(preference.positions.all,expected.positions.all);await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='load'&&!c.disabled));await paint();await tap('load');await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.frame?.ui.inventory===true&&__rogueBrowserTest.queuePending===0);await paint();assert.equal((await scene()).inventory.tab,expected.tab);assert.equal((await scene()).scrolls.dialog,expected.positions.all);assert.deepEqual((await state()).words,before.words);await shot('phone-restored-tabs');});
 await check('using the last food hides its tab and falls back to all',async()=>{await collectTabs();await tab('food');await tap('item-a');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-101');await idle();await inventory();assert.equal((await scene()).inventory.tab,'all');const found=await collectTabs();assert.ok(!found.has('food'));assert.ok(!(await frame()).ui.lines.some(row=>row.args?.[1]?.value.category==='food'));});
 await start(false);await inventory();
 await check('PC has the same compact header, filtering, horizontal scrolling and keyboard tab navigation',async()=>{header(await scene(),await page.evaluate(()=>__rogueBrowserTest.commands));const before=await state();const found=await collectTabs();assert.equal(found.size,9);await tab('stick');assert.deepEqual(await visibleItems(),['j']);await key('ArrowRight');assert.equal((await scene()).inventory.tab,'food');assert.deepEqual(await visibleItems(),['a']);await key('ArrowLeft');assert.equal((await scene()).inventory.tab,'stick');assert.deepEqual(await state(),before);await tab('armor');await tap('item-k');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();assert.ok(!(await scene()).controls.some(c=>c.id==='window-87'),'Existing equipped armor still blocks wear');await tap('window-27');await paint();assert.equal((await scene()).inventory.tab,'armor');await shot('pc-inventory-tabs');await tab('all');if((await scene()).regions.dialog.max>0){await scroll('dialog',35);const offset=(await scene()).scrolls.dialog;await close();await inventory();assert.equal((await scene()).scrolls.dialog,offset);}});
 await start(true,'inventory-single');await inventory();
 await check('a single carried food shows only all and food; absent equipment has no tab',async()=>{const tabs=await collectTabs();assert.deepEqual([...tabs.keys()],['all','food']);await tab('food');assert.deepEqual(await visibleItems(),['a']);await shot('phone-single-food-tabs');});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

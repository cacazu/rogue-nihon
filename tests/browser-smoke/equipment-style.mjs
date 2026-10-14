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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/equipment-style'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let resumed=!process.env.ROGUE_STYLE_FROM;
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
async function check(name,fn){if(!resumed){if(!name.includes(process.env.ROGUE_STYLE_FROM))return;resumed=true;}await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(phone=true,lang='ja',fixture='inventory-all'){
 if(context)await context.close();mobile=phone;
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
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
async function slotRows(expected){
 const s=await scene(),f=await frame(),commands=await page.evaluate(()=>__rogueBrowserTest.commands);
 assert.equal(s.icons.filter(i=>i.name==='equipped').length,0);
 const labels=await page.evaluate(()=>__rogueBrowserTest.language)==='en'?{weapon:'Hand',armor:'Body',left_ring:'Left hand',right_ring:'Right hand'}:{weapon:'手',armor:'胴体',left_ring:'左手',right_ring:'右手'};
 for(const key of expected){
  const c=s.controls.find(c=>c.id==='item-'+key);assert.ok(c);
  const slot=labels[descriptor(f,key).equipped];assert.ok(slot);
  const label=commands.find(t=>t.op==='text'&&t.text===slot&&t.y>=c.fullRect.y&&t.y<c.fullRect.y+c.fullRect.h);assert.ok(label,'Slot for '+key);
  const width=await page.evaluate(t=>{const ctx=document.createElement('canvas').getContext('2d');ctx.font=(t.bold?'600 ':'')+t.size+'px system-ui, "Yu Gothic", sans-serif';return ctx.measureText(t.text).width;},label);
  assert.ok(Math.abs(label.x+width-(c.fullRect.x+c.fullRect.w-10))<1,'Slot at row right edge');
  assert.ok(c.label.endsWith(slot));assert.doesNotMatch(c.label,/武器として装備中|着用中|左手に装備中|右手に装備中|weapon in hand|being worn|on left hand|on right hand/);
 }
}
function brackets(labels){for(const text of labels.values())assert.doesNotMatch(text,/[［］\[\]（）・]/,'Uniform brackets/spaces: '+text);}
try {
 await start();
 await check('phone equipped rows show slots at the right edge',async()=>{const before=await state();await tab('equipped');await slotRows(['b','c']);assert.deepEqual(await state(),before);await shot('phone-equipped-badges');});
 await check('weapon, armor, ring and staff numbers use ASCII parentheses and spaces',async()=>{const before=await state();await tab('all');const labels=await collectItems();assert.equal(labels.size,13);brackets(labels);assert.ok(labels.get('c').includes('(命中+1 威力+1)'));assert.ok(labels.get('b').includes('(強化+1 防御力4)'));assert.ok(labels.get('h').includes('(補正+1)'));assert.ok(labels.get('i').includes('(補正+1)'));assert.ok(labels.get('j').includes(' 残り5回)'));assert.ok(labels.get('e').endsWith('×27'));assert.deepEqual(await state(),before);});
 await check('unidentified weapon and potion still hide their numbers and identity',async()=>{await tab('weapon');const labels=await collectItems();assert.equal(labels.get('m'),'短剣');assert.doesNotMatch(labels.get('m'),/7|-3|命中|威力/);await tab('potion');const potion=descriptor(await frame(),'l');assert.equal(potion.known,false);assert.equal(potion.which,null);assert.ok(!Object.hasOwn(potion,'bonus'));});
 await check('320px slots fit without overlapping the item names',async()=>{await page.setViewportSize({width:320,height:568});await paint();await tab('equipped');await slotRows(['b','c']);await shot('phone-320-equipped');await page.setViewportSize({width:390,height:844});await paint();});
 await check('selected-item actions and details also show slots at the right edge',async()=>{await tap('item-b');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();assert.ok((await scene()).text.includes('胴体'));assert.equal((await scene()).icons.filter(i=>i.name==='equipped').length,0);assert.ok((await scene()).icons.some(i=>i.name==='item-enchantment'));assert.ok((await scene()).icons.some(i=>i.name==='shield'));await shot('phone-selected-armor');await tap('window-118');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_details');await paint();assert.ok((await scene()).text.includes('胴体'));assert.equal((await scene()).icons.filter(i=>i.name==='equipped').length,0);assert.ok((await scene()).text.includes('防御力：4'));await tap('window-27');await paint();await tap('window-27');await paint();});
 await check('changing the wielded weapon moves the hand label from mace to bow',async()=>{await tab('weapon');await action('d',119);await idle();await inventory();assert.equal(descriptor(await frame(),'d').equipped,'weapon');assert.equal(descriptor(await frame(),'c').equipped,'none');await tab('equipped');await slotRows(['b','d']);await shot('phone-new-weapon');});
 await check('armor changes remove and add the body label',async()=>{await action('b',84);await idle();await inventory();assert.equal(descriptor(await frame(),'b').equipped,'none');await slotRows(['d']);await tab('armor');await action('k',87);await idle();await inventory();assert.equal(descriptor(await frame(),'k').equipped,'armor');await tab('equipped');await slotRows(['d','k']);const armor=descriptor(await frame(),'k'),label=(await scene()).controls.find(c=>c.id==='item-k').label;assert.ok(label.includes('(強化+0 防御力'+armor.protection+')'));});
 await check('both ring hands retain their original action routing and slot labels',async()=>{await tab('ring');await action('h',80);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='hand');await paint();await tap('window-108');await idle();await inventory();await action('i',80);await idle();await inventory();assert.equal(descriptor(await frame(),'h').equipped,'left_ring');assert.equal(descriptor(await frame(),'i').equipped,'right_ring');await tab('equipped');await slotRows(['d','k','h','i']);await shot('phone-both-rings');await tab('ring');await action('i',82);await idle();await inventory();assert.equal(descriptor(await frame(),'h').equipped,'left_ring');assert.equal(descriptor(await frame(),'i').equipped,'none');await tab('equipped');await slotRows(['d','k','h']);await tab('ring');await action('h',82);await idle();await inventory();assert.equal(descriptor(await frame(),'h').equipped,'none');});
 await start(false);
 await check('PC uses the same slot labels and preserves keyboard item prefixes',async()=>{await tab('equipped');await slotRows(['b','c']);assert.ok((await scene()).controls.find(c=>c.id==='item-c').label.includes('c) メイス (命中+1 威力+1)'));await shot('pc-equipped-badges');});
 await start(false,'en');
 await check('English item numbers use the same bracket and separator convention',async()=>{await tab('equipped');await slotRows(['b','c']);await tab('all');const labels=await collectItems();brackets(labels);assert.ok(labels.get('c').includes('(hit +1 damage +1)'));assert.ok(labels.get('b').includes('(enchantment +1 protection 4)'));assert.ok(labels.get('h').includes('(bonus +1)'));assert.ok(labels.get('j').includes('(5 charges)'));await tab('equipped');await shot('pc-en-equipped');});
 await start(true,'ja',null);
 await check('published playable build includes right-aligned equipment slots',async()=>{await tab('equipped');const s=await scene();await slotRows(['b','c']);for(const c of s.controls.filter(c=>c.id.startsWith('item-')))assert.doesNotMatch(c.label,/[［］\[\]（）・]|武器として装備中|着用中/);});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

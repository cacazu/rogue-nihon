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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/log-parameters-wrap'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let resumed=!process.env.ROGUE_LOG_STYLE_FROM;
if(!resumed){const prior=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));report.checks.push(...prior.checks);report.screenshots.push(...prior.screenshots);}



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
async function check(name,fn){if(!resumed){if(!name.includes(process.env.ROGUE_LOG_STYLE_FROM))return;resumed=true;}await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(phone=true,lang='ja',fixture='inventory-all'){
 if(context)await context.close();mobile=phone;
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);await page.addInitScript(()=>{const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__logPacket=data=>handler({data});}};});cdp=await context.newCDPSession(page);
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



const commands=()=>page.evaluate(()=>__rogueBrowserTest.commands);
const visible=async()=>((await scene()).text).join('');
const parameterNames=['item-hit','item-damage','item-enchantment','shield','item-modifier','strength','item-charges'];
async function bodyLines(){const s=await scene(),r=s.regions.log?.rect||s.controls.find(c=>c.id==='history-open').rect;let paint=await commands();if(s.controls.some(c=>c.id==='history-close')){const start=paint.findLastIndex(c=>c.op==='clip'&&c.rect.x===r.x&&c.rect.y===r.y&&c.rect.w===r.w&&c.rect.h===r.h);assert.ok(start>=0);paint=paint.slice(start+1);const end=paint.findIndex(c=>c.op==='restore');paint=paint.slice(0,end);}const text=paint.filter(c=>c.op==='text'&&c.y>=r.y&&c.y<r.y+r.h);const lines=new Map();for(const t of text){if(!lines.has(t.y))lines.set(t.y,[]);lines.get(t.y).push(t);}return {r,text,paint,lines:[...lines].map(([y,parts])=>({y,text:parts.map(t=>t.text).join(''),parts}))};}
async function parameterIcons(expected,labeled){const s=await scene(),{r,text,paint}=await bodyLines(),icons=s.icons.filter(i=>parameterNames.includes(i.name)&&i.rect.y>=r.y&&i.rect.y+i.rect.h<=r.y+r.h&&(i.glyph==='💪'||paint.some(c=>c.op==='path'&&c.rect.x===i.rect.x&&c.rect.y===i.rect.y)));for(const name of expected)assert.ok(icons.some(i=>i.name===name),name+' in log');for(const i of icons){const value=text.find(t=>Math.abs(t.x-(i.rect.x+i.rect.w+2))<.1&&t.y===i.rect.y);assert.ok(value,'Icon and parameter text together');assert.ok(labeled?/[^+\d\s-]/.test(value.text):/^[+-]?\d+$/.test(value.text),'Parameter label device policy '+value.text);const path=paint.find(c=>c.op==='path'&&c.rect.x===i.rect.x&&c.rect.y===i.rect.y)||paint.find(c=>c.op==='text'&&c.text==='💪'&&c.x>=i.rect.x-1&&c.x<=i.rect.x+i.rect.w);assert.notEqual(path.color,'#e8ebed');assert.ok(i.rect.x+i.rect.w<=r.x+r.w,'Icon fits');}}
async function history(){await tap('history-open');await paint();}
async function closeHistory(){await tap('history-close');await paint();}
async function inject(values){await page.evaluate(values=>{for(const v of values)__logPacket({type:'message',args:[],...v});},values);await paint();}
async function nativeEquip(item,key){await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await tab(item==='d'?'weapon':item==='h'?'ring':item==='k'?'armor':'equipped');await action(item,key);if(item==='h'){await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='hand');await paint();await tap('window-108');}await idle();}
try {
 await start();const mace=descriptor(await frame(),'c');await tap('window-32');await idle();
 await check('native mobile wield log shows colored icons with numbers and fits one short line',async()=>{await nativeEquip('d',119);await parameterIcons(['item-hit','item-damage'],false);const body=await bodyLines();assert.equal(body.lines.length,1);assert.ok(body.lines[0].text.includes('構えた'));assert.doesNotMatch(body.lines[0].text,/命中|威力|\(d\)|（d）/);await shot('phone-short-wield-icons');await history();await parameterIcons(['item-hit','item-damage'],false);await shot('phone-history-wield-icons');await closeHistory();});
 await check('native armor and ring logs share the same compact parameter display',async()=>{await nativeEquip('b',84);await nativeEquip('k',87);await parameterIcons(['item-enchantment','shield'],false);await nativeEquip('h',80);await parameterIcons(['shield'],false);await history();await parameterIcons(['item-hit','item-damage','item-enchantment','shield'],false);await shot('phone-history-equipment');await closeHistory();});
 await check('Japanese spaces no longer rewind a log line far before its available width',async()=>{const text='あなたはメイス (命中+1 威力+0) (c) を構えた。';await inject([{id:'ui.text',text}]);const short=await bodyLines();assert.ok(short.lines.length<=2);assert.ok(short.lines.find(l=>l.text.includes('あなたはメイス')).text.includes('威力+0'),'Use width after the internal space');await history();const b=await bodyLines();const line=b.lines.find(l=>l.text.includes('あなたはメイス'));assert.ok(line.text.includes('威力+0'));await shot('phone-spaces-fill-width');await closeHistory();});
 await check('literal Japanese templates preserve text and fit the log bounds (layout only)',async()=>{const catalog=JSON.parse(await readFile(path.join(root,'locales/ja.json'),'utf8')).messages;await history();for(const [id,entry] of Object.entries(catalog)){const text=entry.template.replace(/\{\d+\}/g,'数値12');if(!text.trim())continue;await inject([{id:'ui.text',text}]);const b=await bodyLines();assert.ok(b.lines.map(l=>l.text).join('').replace(/\s/g,'').includes(text.replace(/\s/g,'')),'Complete log text '+id);for(const t of b.text){const width=await page.evaluate(t=>{const c=document.querySelector('#rogue-canvas').getContext('2d');c.font=t.size+'px system-ui, "Yu Gothic", sans-serif';return c.measureText(t.text).width;},t);assert.ok(t.x+width<=b.r.x+b.r.w+1,'Within log width: '+id+' '+JSON.stringify({text:t.text,width,x:t.x,right:b.r.x+b.r.w}));}}await closeHistory();});
 await check('320px log retains whole icon-value pairs and hidden keyboard prompts',async()=>{await page.setViewportSize({width:320,height:844});await paint();await inject([{id:'weapons.wield.wielding',args:[{kind:'entity',value:mace},{kind:'signed',value:99}],text:'メイス (命中+1 威力+1) (c) を構えた。'},{id:'things.discovered.for_all',text:'？（* ですべて表示）'}]);await parameterIcons(['item-hit','item-damage'],false);assert.doesNotMatch(await visible(),/\*.*すべて表示/);await shot('phone-320-log-icons');await page.setViewportSize({width:390,height:844});await paint();});
 await check('nested recalls, staff charges, unknown items and literal parameter words render safely',async()=>{const staff={type:'item',category:'stick',which:3,count:1,known:true,identified:true,subtype:'wand',appearance:{kind:'metal',id:8},charges:3,visible_fields:{charges:true}};await inject([{id:'command.command.string',args:[{kind:'entity',value:{type:'message',id:'weapons.wield.wielding',args:[{kind:'entity',value:mace},{kind:'signed',value:99}]}}],text:'再表示するメイス'},{id:'message.entity',args:[{kind:'entity',value:staff}],text:'炎のワンド (鉄 残り3回)'}]);await parameterIcons(['item-charges'],false);await history();await parameterIcons(['item-charges'],false);await closeHistory();await inject([{id:'message.entity',args:[{kind:'entity',value:{...mace,identified:false,hplus:7,dplus:-3,visible_fields:{hplus:false,dplus:false},label:'命中+7 威力-3'}}],text:'メイス (命名：命中+7 威力-3)'}]);assert.equal((await scene()).icons.filter(i=>parameterNames.includes(i.name)&&i.rect.y>600).length,0);assert.ok((await visible()).includes('命名'));await inject([{id:'ui.text',text:'一行目\n二行目\n三行目'}]);const lines=await bodyLines();assert.deepEqual(lines.lines.map(l=>l.text),['二行目','三行目']);});
 await start(false);
 await check('PC item logs show the colored icons plus item names and values',async()=>{await tap('window-32');await idle();await key('w');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='item');await paint();await key('d');await idle();await parameterIcons(['item-hit','item-damage'],true);assert.ok((await visible()).includes('命中'));assert.ok((await visible()).includes('威力'));await shot('pc-parameter-log');await history();await parameterIcons(['item-hit','item-damage'],true);await shot('pc-history-parameters');await closeHistory();});
 await start(true,'en',null);
 await check('English playable build handles composite equip logs with the mobile icon-only labels',async()=>{await tap('item-c');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-100');await idle();await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await action('d',119);await idle();await parameterIcons(['item-hit','item-damage'],false);await shot('phone-en-equip-log');});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.entries=await page.evaluate(()=>__rogueBrowserTest.diagnostics.entries).catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

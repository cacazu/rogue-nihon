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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-log-hints'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let resumed=!process.env.ROGUE_LOG_FROM;
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
async function check(name,fn){if(!resumed){if(!name.includes(process.env.ROGUE_LOG_FROM))return;resumed=true;}await fn();report.checks.push(name);console.log('PASS '+name);}
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


const entries=()=>page.evaluate(()=>__rogueBrowserTest.diagnostics.entries);
const visible=async()=>((await scene()).text).join('\n');
const hasId=(m,id)=>m.id===id||(m.args||[]).some(a=>a.value&&typeof a.value==='object'&&hasId(a.value,id));
async function packets(values){await page.evaluate(values=>{for(const value of values)__logPacket({type:'message',args:[],...value});},values);await paint();}
async function historyCheck(needle){const before=await state();await tap('history-open');assert.doesNotMatch(await visible(),/\*.*(すべて|一覧)|L（左）|右手（R）|\(y\/n\)|Space.*Enter|キーを入力/);if(needle)assert.ok((await visible()).includes(needle));assert.deepEqual(await state(),before);await tap('history-close');assert.deepEqual(await state(),before);}
async function assertHidden(id){const m=(await page.evaluate(()=>__rogueBrowserTest.messages)).findLast(m=>hasId(m,id));assert.ok(m,'Actual C message '+id);const entry=(await entries()).findLast(e=>e.text===m.text);assert.ok(entry?.mobile_keyboard_hint,'Classified '+id);assert.ok(!(await visible()).includes(m.text),'Not painted '+id);}
try {
 await start();await tap('window-32');await idle();
 await check('mobile item-history D* prompt remains in original history but is hidden in short and full logs',async()=>{await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await tap('inventory-history');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.id==='input.close'&&__rogueBrowserTest.queuePending===0);await paint();await tap('window-32');await idle();await assertHidden('things.discovered.for_all');await historyCheck();await shot('phone-after-item-history');});
 await check('mobile item selection hints are hidden while throwing still opens the direction pad',async()=>{await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await tab('weapon');await action('e',116);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='direction'&&__rogueBrowserTest.queuePending===0);await paint();await tap('touch-action-action.cancel');await idle();await key('t');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='direction');await paint();await tap('touch-k');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='item');await paint();await key('Escape');await idle();await assertHidden('pack.get_item.for_list');await historyCheck();});
 await check('mobile ring hand L/R prompt is hidden while the hand buttons still equip the chosen ring',async()=>{await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await tab('ring');await action('h',80);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='hand');await paint();await tap('window-108');await idle();await assertHidden('rings.gethand.left_hand_or_right_hand');await historyCheck();});
 await check('mobile native y/n confirmation prompt is hidden and cancel still returns to play',async()=>{await key('Q');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='confirm');await paint();await tap('window-110');await idle();await assertHidden('main.quit.really_quit');await historyCheck();});
 await check('all other keyboard instruction families and nested recalls stay out of both mobile logs',async()=>{const before=await state();await packets([{id:'ui.text',text:'通常のゲームメッセージ１'},{id:'command.call.called',args:[{kind:'string',value:'Esc * L/R'}],text:'「Esc * L/R」という名前を付けた。'}]);const initial=await visible();const samples=[
  {id:'command.help.character_you_want_help_for_for_all'},
  {id:'command.help.string_string'},
  {id:'pack.picky_inven.item'},
  {id:'things.discovered.please_type_one_of_escape_to_quit'},
  {id:'rings.gethand.please_type_l_or_r'},
  {id:'save.save_game.please_answer_y_or_n'},
  {id:'wizard.create_obj.which_do_you_want_f'},
  {id:'input.choose_direction'},
  {id:'input.next_message'},
  {id:'options.hint.bool'},
  {id:'ui.ending.space'},
  {id:'input.close'},
  {id:'help.run_adjacent'},
  {id:'message.sequence',args:[{kind:'message_part',value:{id:'things.discovered.for_all',args:[]}}]},
  {id:'command.command.string',args:[{kind:'entity',value:{type:'message',id:'message.sequence',args:[{kind:'message_part',value:{id:'pack.get_item.for_list',args:[]}}]}}]},
  {id:'message.entity',args:[{kind:'entity',value:{type:'term',id:'input.wait_space'}}]},
 ];await packets(samples.map((m,i)=>({...m,text:'非表示にするキー案内'+i})));assert.equal(await visible(),initial);for(const e of (await entries()).slice(-samples.length))assert.equal(e.mobile_keyboard_hint,true);assert.deepEqual(await state(),before);await historyCheck('Esc * L/R');await tap('history-open');await shot('phone-filtered-full-history');await tap('history-close');});
 await check('gameplay, literal names and platform errors remain visible in mobile history',async()=>{await packets([{id:'daemons.stomach.you_are_starting_to_get_hungry',text:'お腹が空いてきた'},{id:'platform.error',text:'ゲームの処理でエラーが発生しました。'}]);assert.ok((await visible()).includes('お腹が空いてきた'));const before=await state();await tap('history-open');assert.ok((await visible()).includes('Esc * L/R'));assert.ok((await visible()).includes('ゲームの処理でエラーが発生しました。'));assert.deepEqual(await state(),before);await shot('phone-preserved-messages-and-errors');await tap('history-close');});
 await start(false);
 await check('PC preserves original keyboard prompts in the log and full history',async()=>{await tap('window-32');await idle();await key('D');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='discovery');await paint();await key('Escape');await idle();const m=(await page.evaluate(()=>__rogueBrowserTest.messages)).findLast(m=>hasId(m,'things.discovered.for_all'));assert.ok(m);assert.ok((await entries()).findLast(e=>e.text===m.text).mobile_keyboard_hint);assert.match(await visible(),/\*\s*ですべて表示/);await shot('pc-keeps-keyboard-log');await tap('history-open');assert.match(await visible(),/\*\s*ですべて表示/);await tap('history-close');});
 await start(true,'en',null);
 await check('mobile English playable build hides native keyboard prompts by the same IDs',async()=>{await tap('window-32');await idle();await key('D');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='discovery');await paint();await key('Escape');await idle();await assertHidden('things.discovered.for_all');await tap('history-open');assert.doesNotMatch(await visible(),/\* for all/);await shot('phone-en-filtered-history');await tap('history-close');});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.entries=await entries().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

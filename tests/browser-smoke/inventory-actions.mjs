import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createPreviewServer} from '../../web/server.mjs';
import {runGame} from '../run-game.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const brave=(process.env.ROGUE_CHROME||'').toLowerCase().includes('brave'),mobile=process.env.ROGUE_INVENTORY_MOBILE==='1',output=artifactDirectory(path.join(root,'tests/browser-smoke/output/inventory-actions',(brave?'brave':'chrome')+(mobile?'-mobile':'')));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/',worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
let baseline=process.env.ROGUE_INVENTORY_BASELINE||path.join(root,'build/inventory-before.js');
const historical=await access(baseline).then(()=>true,()=>false);if(!historical)baseline=path.join(root,'build/game-fixtures.js');
// The untranslated historical build is retained for legacy save replay. A
// separately built, pre-fix C reference may use corrected message-site metadata
// so intentionally repaired English text still gets a strict 20-word comparison.
const referenceBaseline=process.env.ROGUE_INVENTORY_REFERENCE||baseline;
const evidence={started_at:new Date().toISOString(),baseline,reference_baseline:referenceBaseline,historical,checks:[],commands:[],screenshots:[],errors:[]};
evidence.baseline_files=await Promise.all([baseline,baseline.replace(/\.js$/,'.wasm')].map(async file=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})));
evidence.reference_files=await Promise.all([referenceBaseline,referenceBaseline.replace(/\.js$/,'.wasm')].map(async file=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})));
let browser,context,page,fixture='inventory-all',locale='ja';
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({traces:__rogueBrowserTest.traces,trace:__rogueBrowserTest.trace,frame:__rogueBrowserTest.frame,input:__rogueBrowserTest.inputRequestCount,queue:__rogueBrowserTest.queuePending,exit:__rogueBrowserTest.diagnostics.exitCode,messages:__rogueBrowserTest.messages}));
async function check(label,fn){if(process.env.ROGUE_INVENTORY_FILTER&&!new RegExp(process.env.ROGUE_INVENTORY_FILTER).test(label))return;await fn();evidence.checks.push(label);console.log('PASS '+label);}
async function draw(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function open(options={}){
 await context?.close();fixture=options.fixture||'inventory-all';locale=options.lang||'ja';const width=options.width||(mobile?390:1240),height=options.height||(mobile?844:900);
 context=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700,deviceScaleFactor:options.scale||1});
 await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.js',r=>r.fulfill({path:options.module||path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>evidence.errors.push(error.message));
 await page.goto(base+'?trace=1&view=pixels&lang='+locale);await page.waitForFunction(()=>window.__rogueBrowserTest?.canvas.paintCount>0);
 await field('name','ItemAudit');await field('seed','17');await click('new-game');
 await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.queuePending===0);await draw();
}
async function click(id){
 for(let n=0;n<20;n++){
  const s=await scene(),c=s.controls.find(c=>c.id===id&&!c.disabled);
  if(c){if((await page.evaluate(()=>matchMedia('(pointer:coarse)').matches)))await page.touchscreen.tap(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2);else await page.mouse.click(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2,{delay:40});await draw();return;}
  if(id.startsWith('item-')&&s.regions.dialog){await page.mouse.move(s.regions.dialog.rect.x+30,s.regions.dialog.rect.y+30);await page.mouse.wheel(0,100);await draw();}
  else await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
 }
 throw Error('Missing control '+id+' '+JSON.stringify(await scene()));
}
async function field(id,value){await click(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);await draw();}
async function sent(fn){const before=(await state()).input;await fn();await page.waitForFunction(n=>__rogueBrowserTest.queuePending===0&&(__rogueBrowserTest.inputRequestCount>n||__rogueBrowserTest.diagnostics.exitCode!==null),before);await draw();}
async function press(key){await sent(()=>page.keyboard.press(key));}
async function action(key){await sent(()=>click('window-'+key));}
async function chars(text){for(const c of text){const v=c.charCodeAt(0);await press(v===27?'Escape':v===13?'Enter':v===32?'Space':v<27?'Control+'+String.fromCharCode(v+96):c);}}
async function select(item){await press('i');await sent(()=>click('item-'+item));assert.equal((await state()).frame.ui.window.kind,'inventory_actions');}
async function idle(){await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window&&__rogueBrowserTest.queuePending===0);}
async function reference(text,label='',module=referenceBaseline){
 const old=await runGame(module,{fixture,seed:17,name:'ItemAudit',locale,messagePaging:'log',text});const actual=await state();
 assert.deepEqual(actual.traces.map(t=>({words:t.words,input_index:t.input_index})),old.traces.map(t=>({words:t.words,input_index:t.input_index})),label+' every C state/RNG checkpoint');
 if(actual.exit!==null)assert.equal(actual.exit,old.code,label+' original exit code');
 assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.translationFallbacks),[]);assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.uiMissing),[]);
 evidence.commands.push({label,fixture,text,reference:module,checkpoints:old.traces.length,words:actual.trace.words});
}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});evidence.screenshots.push(name+'.png');}
async function menu(item,command,after=''){await select(item);await action(command.charCodeAt(0));if(after)await chars(after);await idle();}
try{
 browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--disable-gpu']});
 await check('Mobile touch: item menus/details/back preserve map, log, C journal, turn and RNG; hidden knowledge stays hidden',async()=>{
  await open({width:390,height:844,scale:2});await press('i');const before=await state();await shot('inventory-mobile');
  for(const item of ['a','b','c','d','e','f','g','h','i','j','k','l','m']){
   await sent(()=>click('item-'+item));assert.equal((await state()).frame.ui.window.kind,'inventory_actions');
   const options=(await state()).frame.ui.window.actions.map(a=>a.key);assert.ok(options.includes(118)&&options.includes(100)&&options.includes(116));
   if(item==='f')await shot('potion-actions-mobile');if(item==='d')await shot('weapon-actions-mobile');
   await action(118);assert.equal((await state()).frame.ui.window.kind,'inventory_details');
   const details=(await state()).frame.ui.lines.map(l=>l.text).join('\n');
   if(item==='l'){assert.match(details,/未判明/);assert.doesNotMatch(details,/毒|呪|Poison|curs/i);assert.equal((await state()).frame.ui.lines[0].args[1].value.which,null);await shot('unknown-potion-details');}
   if(item==='m'){assert.doesNotMatch(details,/命中補正|ダメージ補正|呪/);assert.equal((await state()).frame.ui.lines[0].args[1].value.hplus,undefined);}
   if(item==='j'){assert.match(details,/残り使用回数：5/);await shot('staff-details-mobile');}
   if(item==='b'){assert.match(details,/着用中/);assert.match(details,/防御力：4/);}
   await press('Escape');assert.equal((await state()).frame.ui.window.kind,'inventory_actions');await action(27);
   assert.equal((await state()).frame.ui.window.title,'持ち物');assert.deepEqual((await state()).trace,before.trace);assert.deepEqual((await state()).messages,before.messages);assert.equal((await state()).frame.map_cells,before.frame.map_cells);
  }
  await action(32);await idle();await reference('i ','browse-only');
 });
 for(const [label,item,command,suffix,cKeys] of [
  ['drink','f','q','','qf'],['read','g','r','','rg'],['eat','a','e','','ea'],['equip weapon','d','w','','wd'],['remove armor','b','T','','T'],
  ['ring left','h','P','l','Phl'],['ring right','h','P','r','Phr'],['use staff','j','z','k','zkj']
 ])await check('Item action: '+label,async()=>{await open();await menu(item,command,suffix);await reference('i '+cKeys,label);});
 for(const item of ['a','b','c','d','e','f','g','h','j','k','l','m']){
  await check('Throw item '+item+' through C (including non-weapons)',async()=>{await open();await menu(item,'t','k');await reference('i tk'+item,'throw '+item);});
  await check('Drop item '+item+' through C',async()=>{await open();await menu(item,'d');await reference('i d'+item,'drop '+item);});
 }
 await check('Wear armor after taking off; equipment menu changes to Take off',async()=>{await open();await menu('b','T');await menu('k','W');await select('k');assert.ok((await state()).frame.ui.window.actions.some(a=>a.key===84));assert.ok(!(await state()).frame.ui.window.actions.some(a=>a.key===87));await action(27);await action(32);await reference('i Ti Wki ','wear and refresh');});
 await check('Another armor cannot be worn until the current armor is removed; keyboard C rejection stays intact',async()=>{await open();await select('k');assert.ok(!(await state()).frame.ui.window.actions.some(a=>a.key===87));await action(27);await action(32);await chars('Wk');await idle();await reference('i Wk','already wearing armor');});
 for(const hand of ['h','i'])await check('Remove selected ring '+hand+' when both hands are occupied',async()=>{await open();await menu('h','P','l');await menu('i','P');await menu(hand,'R');await reference('i Phli Pii R'+(hand==='h'?'l':'r'),'remove selected ring '+hand);});
 for(const item of ['b','c','l'])await check('Name item '+item+' through original text editor',async()=>{await open();await select(item);await action(99);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='text');await field('prompt-text','ItemName');await sent(()=>click('submit-text'));await idle();await reference('i c'+item+'\x15ItemName\r','name '+item);});
 await check('Cancelling throw/staff direction clears the selected-item intent',async()=>{for(const command of ['t','z']){await open();await select(command==='t'?'e':'j');await action(command.charCodeAt(0));assert.equal((await state()).frame.ui.input.kind,'direction');if(command==='t'){assert.equal((await state()).frame.ui.window,null);await press('Escape');}else await action(27);await press('j');await idle();await reference('i '+command+'\x1bj','cancel '+command);}});
 await check('A blocked drop never leaks an item letter into the next movement',async()=>{await open();await menu('f','d');await menu('g','d');await press('j');await reference('i dfi dj','blocked drop');});
 for(const [item,command,cKeys] of [['b','T','T'],['b','d','db'],['c','d','dc'],['d','w','w'],['h','R','Rl'],['h','d','dh']])await check('Cursed equipment obeys original C: '+item+'/'+command,async()=>{await open({fixture:'inventory-cursed'});await menu(item,command);await press('j');await reference('i '+cKeys+'j','cursed '+item+'/'+command);});
 for(const [f,count] of [['inventory-empty',0],['inventory-single',1]])await check('Inventory remains usable with '+count+' items',async()=>{await open({fixture:f,width:390,height:844});await press('i');assert.equal((await state()).frame.ui.lines.filter(l=>l.selectable).length,count);await shot(f);if(count){await sent(()=>click('item-a'));await action(118);await action(27);await action(27);}await action(32);await idle();if(count){await menu('a','e');await press('i');assert.equal((await state()).frame.ui.lines.filter(l=>l.selectable).length,0);await action(32);}});
 await check('Menu/details resize, fullscreen, desktop English and landscape keep every action inside the panel',async()=>{
  await open({lang:'en',width:390,height:844});await select('d');const before=await state();
  for(const viewport of [{width:320,height:844},{width:844,height:390},{width:1240,height:900}]){
   await page.setViewportSize(viewport);await draw();const s=await scene();
   for(const c of s.controls.filter(c=>c.id.startsWith('window-')))assert.ok(c.rect.y>=s.dialogRect.y+40&&c.rect.y+c.rect.h<=s.dialogRect.y+s.dialogRect.h+1,'button fits '+JSON.stringify({viewport,c,dialog:s.dialogRect}));
   assert.deepEqual((await state()).trace,before.trace);await shot('actions-en-'+viewport.width);
  }
  await click('header-fullscreen');await page.waitForFunction(()=>!!document.fullscreenElement);await draw();await shot('actions-fullscreen');assert.deepEqual((await state()).trace,before.trace);await action(118);await shot('details-en-desktop');await action(27);await action(27);await action(32);await page.keyboard.press('Escape');
 });
 await check('Save/load during item menu returns to inventory with identical C state; action still works',async()=>{await open();await select('f');const before=await state();await click('settings-toggle');await click('save');await page.waitForFunction(()=>!__rogueBrowserTest.savePending&&__rogueBrowserTest.savedLength>0);await click('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await click('load');await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.frame?.ui.inventory&&__rogueBrowserTest.queuePending===0);await draw();assert.deepEqual((await state()).trace.words,before.trace.words);await sent(()=>click('item-f'));await action(113);await idle();await reference('i qf','save menu');});

 if(historical)for(const [style,prefix] of [['overlay','i'],['slow','o'+'\r'.repeat(6)+'s\x1b i '],['clear','o'+'\r'.repeat(6)+'c\x1b i']])await check('Legacy '+style+' inventory save replays correctly and then opens the new menu',async()=>{
  await open({module:baseline});await chars(prefix);const before=await state();
  await click('settings-toggle');await click('save');await page.waitForFunction(()=>!__rogueBrowserTest.savePending&&__rogueBrowserTest.savedLength>0);
  await context.unroute('**/build/game.js');await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));
  await click('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await click('load');await page.waitForFunction(index=>__rogueBrowserTest.running&&__rogueBrowserTest.trace?.input_index===index&&__rogueBrowserTest.queuePending===0,before.trace.input_index);await draw();
  assert.deepEqual((await state()).trace,before.trace);assert.equal((await state()).frame.ui.inventory,false);
  await press(style==='slow'?'Escape':'Space');await idle();await press('j');await reference(prefix+(style==='slow'?'\x1b':' ')+'j','legacy '+style,baseline);
  await press('i');assert.equal((await state()).frame.ui.inventory,true);await sent(()=>click('item-c'));await action(118);await shot('legacy-'+style+'-new-details');await action(27);await action(27);await action(32);
 });
 for(const [item,command] of [['e','t'],['j','z']])await check('Save/load while choosing '+command+' direction retains the selected item',async()=>{
  await open();await select(item);await action(command.charCodeAt(0));assert.equal((await state()).frame.ui.input.kind,'direction');const before=await state();
  await click('settings-toggle');await click('save');await page.waitForFunction(()=>!__rogueBrowserTest.savePending&&__rogueBrowserTest.savedLength>0);await click('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await click('load');await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.frame?.ui.input.kind==='direction'&&__rogueBrowserTest.queuePending===0);await draw();
  assert.deepEqual((await state()).trace,before.trace);if(command==='t'){assert.equal((await state()).frame.ui.window,null);await press('ArrowUp');}else await action(107);await idle();await reference('i '+command+'k'+item,'saved direction '+command);
 });
 for(const [direction,code] of [['y',121],['k',107],['u',117],['h',104],['l',108],['b',98],['j',106],['n',110]])for(const [item,command] of [['e','t'],['j','z']])await check('Menu '+command+' direction '+direction,async()=>{await open();await select(item);await action(command.charCodeAt(0));if(command==='t'){assert.equal((await state()).frame.ui.window,null);await press(direction);}else await action(code);await idle();await reference('i '+command+direction+item,'direction '+command+'/'+direction);});
 await check('Identification scroll selected in inventory keeps the second C item choice interactive',async()=>{await open({fixture:'item-identify'});await select('f');await action(114);assert.equal((await state()).frame.ui.input.kind,'item');await sent(()=>click('item-c'));await idle();await reference('i rfc','identify second choice');});
 await check('Detection potion selected in inventory opens and closes its map window',async()=>{await open({fixture:'space-detection'});await select('f');await action(113);assert.equal((await state()).frame.ui.window.map_view,true);await action(32);await idle();await reference('i qf ','detection map');});
 await check('Status recall displays the observed values without changing C/RNG',async()=>{await open();await chars('@\x10');assert.ok((await state()).messages.at(-1).text.includes('100'));assert.ok(!(await state()).messages.at(-1).text.includes('%'));await reference('@\x10','status recall');});
 await check('Move without pickup and explicit pickup use the original floor-item rules',async()=>{await open({fixture:'label-split'});await chars('lml,');await reference('lml,','successful pickup');});
 // Every non-wizard command in the original 65-row help table. The two NUL
 // rows are modifier descriptions, exercised by real Shift/Ctrl arrow aliases.
 const commands=[];
 for(const c of 'hjklyubnHJKLYUBN')commands.push({key:c,text:c,fixture:'plain'});
 for(const c of 'hjklyubn')commands.push({key:'CTRL('+c+')',text:String.fromCharCode(c.charCodeAt(0)&31),fixture:'plain'});
 commands.push(...[
  ['?','?* '],['/','/!'],['f','fl','combat'],['F','Fl','combat'],['t','tke'],['m','ml'],['z','zkj'],['^','^l'],['s','s'],['>','lllll>'],['<','<'],['.','.'],[',',','],['i','i '],['I','Ic'],['q','qf'],['r','rg'],['e','ea'],['w','wd'],['W','TWk'],['T','T'],['P','Phl'],['R','PhlR'],['d','df'],['c','cc\x15KeyName\r'],['a','.a'],[')',')'],[']',']'],['=','Phl='],['@','@'],['D','D* '],['o','o\x1b '],['CTRL(r)','\x12'],['CTRL(p)','v\x10'],['ESC','\x1b'],['S','S'],['Q','Qn'],['!','!'],['v','v']
 ].map(([key,text,f])=>({key,text,fixture:f||'inventory-all'})));
 const source=await readFile(path.join(root,'logic/extern.c'),'utf8'),help=source.split('struct h_list helpstr[] = {')[1].split('\n};')[0];
 const helpKeys=[...help.matchAll(/\{(ESCAPE|CTRL\('([^']+)'\)|'((?:\\.|[^'])+)'),/g)].map(m=>m[1]==='ESCAPE'?'ESC':m[2]?'CTRL('+m[2].toLowerCase()+')':m[3]==='\\0'?null:m[3]==='\\033'?'ESC':m[3]).filter(Boolean);
 assert.equal(helpKeys.length,63);assert.deepEqual(new Set(commands.map(c=>c.key)),new Set(helpKeys));
 for(const command of commands)await check('Original command '+command.key,async()=>{await open({fixture:command.fixture});if(command.key==='c'){await chars('cc');await field('prompt-text','KeyName');await sent(()=>click('submit-text'));await idle();}else await chars(command.text);await idle();assert.equal((await state()).frame.ui.input.kind,'command',command.key+' finishes its follow-up input');if(command.key==='@'){assert.ok((await state()).messages.some(m=>m.text.includes('100')&&!m.text.includes('%')));await shot('status-command');}await reference(command.text,command.key);});
 for(const [modifier,cCode] of [['Shift',0],['Control',31]])for(const [arrow,c] of [['ArrowLeft','h'],['ArrowDown','j'],['ArrowUp','k'],['ArrowRight','l'],['Home','y'],['PageUp','u'],['End','b'],['PageDown','n']])await check('Original modifier alias '+modifier+'+'+arrow,async()=>{await open({fixture:'plain'});await press(modifier+'+'+arrow);await reference(cCode?String.fromCharCode(c.charCodeAt(0)&cCode):c.toUpperCase(),modifier+'+'+arrow);});
 await check('Numeric count prefix repeats movement through C',async()=>{await open({fixture:'plain'});await chars('3h');await reference('3h','count prefix');});
 await check('Quit Yes completes the original score/result flow',async()=>{await open();let text='Qy';await chars(text);for(let n=0;n<8&&(await state()).exit===null;n++){const input=(await state()).frame.ui.input;const c=input.kind==='space'?' ':input.kind==='enter'?'\r':null;assert.ok(c,'known quit prompt '+JSON.stringify(input));await chars(c);text+=c;}assert.equal((await state()).exit,3);await reference(text,'quit yes');});
 assert.deepEqual(evidence.errors,[]);
 evidence.files=await Promise.all(['rust/crates/input/src/inventory.rs','rust/crates/display/src/inventory.rs','rust/src/engine.rs','rust/src/lib.rs','rust/crates/display/src/presentation.rs','logic/pack.c','logic/command.c','build/game.js','build/game.wasm','build/game-fixtures.js'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')})));
 evidence.result='pass';
}catch(error){evidence.result='fail';evidence.failure=error.stack;if(page){evidence.state=await state().catch(()=>null);evidence.scene=await scene().catch(()=>null);await shot('failure').catch(()=>{});}throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');await context?.close();await browser?.close();await new Promise(r=>server.close(r));}

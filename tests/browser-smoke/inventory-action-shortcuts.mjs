// PC item action buttons own both the displayed a/b/c key and its operation.
// Physical key presses are compared with the original C command sequence.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../tools/server.mjs';import {installBrowserTestAdapter} from './test-adapter.mjs';import {fixtureWorker} from './fixture-worker.mjs';import {runGame} from '../run-game.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=process.env.ROGUE_SHORTCUT_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/inventory-action-shortcuts'));
await mkdir(output,{recursive:true});const {chromium}=loadPlaywright(),browser=await chromium.launch({executablePath:browserExecutable(),headless:true}),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=path.join(root,'build/game-fixtures.wasm'),headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],menus:[],errors:[]};let context,page,fixture,language,width,mobile;
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function key(k){await page.locator('#rogue-canvas').focus();await page.keyboard.press(k);await paint();}
async function tap(id){await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);const c=(await snap()).scene.controls.find(c=>c.id===id),b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function windowKind(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.window?.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function open(options={}){await context?.close();fixture=options.fixture||'inventory-all';language=options.language||'ja';width=options.width||1400;mobile=options.mobile??width<700;
 context=await browser.newContext({viewport:{width,height:width<700?844:1050},hasTouch:mobile,isMobile:mobile});await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&view=pixels&lang='+language);await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
 await tap('name');await page.keyboard.press('Control+a');await page.keyboard.insertText('KeyAudit');await tap('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText('17');await tap('new-game');await wait('command');
}
async function select(item,openInventory=true){if(openInventory){await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();}await key(item);await windowKind('inventory_actions');}
async function inspect(){const s=await snap(),actions=s.state.frame.ui.window.actions;
 for(const [index,action]of actions.entries()){const c=s.scene.controls.find(c=>c.id==='window-'+action.key);assert.ok(c,'Action '+action.key);const shortcut=String.fromCharCode(97+index);if(!mobile){assert.equal(c.shortcut,shortcut);assert.equal(c.label,shortcut+') '+action.text);assert.ok(s.commands.some(command=>command.op==='text'&&command.text===c.label),'Shortcut is painted on the actual button');}else{assert.equal(c.shortcut,undefined);assert.equal(c.label,action.text);}}
 report.menus.push({fixture,language,width,kind:s.state.frame.ui.window.kind,actions:actions.map((a,index)=>({key:a.key,shortcut:!mobile?String.fromCharCode(97+index):null,text:a.text}))});return actions;
}
async function action(original){const s=await snap(),c=s.scene.controls.find(c=>c.id==='window-'+original);assert.ok(c?.shortcut,'Shortcut for command '+original);await key(c.shortcut);}
async function reference(text){const expected=await runGame(wasm,{fixture,seed:17,name:'KeyAudit',locale:language,messagePaging:'log',text});assert.deepEqual((await snap()).state.trace.words,expected.traces.at(-1).words,'Same C state, turn and RNG as '+JSON.stringify(text));}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
try{
 for(const lang of ['ja','en'])await check('All item categories: displayed shortcuts, details/back and Esc stay local ('+lang+')',async()=>{
  await open({language:lang});await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();const trace=(await snap()).state.trace;
  for(const item of 'abcdefghijklm'){await select(item,false);const actions=await inspect();if(item==='a'||item==='l')await shot(lang+'-'+item+'-actions');
   await action(118);await windowKind('inventory_details');await inspect();await key('a');await windowKind('inventory_actions');await action(27);await windowKind('menu');assert.deepEqual((await snap()).state.trace,trace,'Browsing '+item+' keeps C/RNG');
  }
  await select('a',false);await key('Escape');await windowKind('menu');await key('Escape');await wait('command');await reference('i ');
 });
 const cases=[
  {name:'food a eats',item:'a',command:101,follow:'',original:'ea'},
  {name:'food b throws',item:'a',command:116,follow:'k',original:'tka'},
  {name:'food c drops',item:'a',command:100,follow:'',original:'da'},
  {name:'potion a drinks',item:'f',command:113,follow:'',original:'qf'},
  {name:'scroll a reads',item:'g',command:114,follow:'',original:'rg'},
  {name:'weapon a equips',item:'d',command:119,follow:'',original:'wd'},
  {name:'armor a takes off',item:'b',command:84,follow:'',original:'T'},
  {name:'ring a equips with a hand choice',item:'h',command:80,follow:'l',original:'Phl'},
  {name:'staff a chooses a direction and zaps',item:'j',command:122,follow:'k',original:'zkj'},
  {name:'cursed weapon rejects equip without leaking the item key',item:'d',command:119,follow:'',original:'w',fixture:'inventory-cursed'},
  {name:'cursed ring rejects removal with the selected hand',item:'h',command:82,follow:'',original:'Rl',fixture:'inventory-cursed'},
 ];
 for(const c of cases)await check(c.name+' and next movement match original C',async()=>{await open(c);await select(c.item);await inspect();await action(c.command);if(c.follow){await wait(c.command===80?'hand':'direction');await key(c.follow);}await wait('command');await key('j');await wait('command');await reference('i '+c.original+'j');});
 await check('Throw cancellation clears the selected item before the next command',async()=>{await open();await select('e');await action(116);await wait('direction');await key('Escape');await wait('command');await key('j');await wait('command');await reference('i t\x1bj');});
 await check('Action shortcuts follow the visible order when Drop is unavailable',async()=>{await open();for(let i=0;i<5;i++){await key('l');await wait('command');}await select('a');const actions=await inspect();assert.ok(!actions.some(a=>a.key===100));assert.equal((await snap()).scene.controls.find(c=>c.id==='window-118').shortcut,'c');await key('c');await windowKind('inventory_details');await key('a');await windowKind('inventory_actions');await action(27);await windowKind('menu');await key('Escape');await wait('command');await reference('llllli ');});
 await check('Text input retains a/b/c letters and spaces; confirm returns to play',async()=>{await open();await select('c');await action(99);await wait('text');const before=(await snap()).state.trace;await tap('prompt-text');await page.keyboard.insertText('abc  ABC');assert.equal(await page.locator('#prompt-text').inputValue(),'abc  ABC');assert.deepEqual((await snap()).state.trace,before);await tap('submit-text');await wait('command');await key('j');await wait('command');await reference('i ccabc  ABC\rj');});
 await check('Uppercase shortcuts work; settings consume shortcut letters without game input',async()=>{await open();await select('a');const trace=(await snap()).state.trace;await tap('settings-toggle');await key('a');assert.deepEqual((await snap()).state.trace,trace);await tap('settings-close');await key('D');await windowKind('inventory_details');await key('a');await windowKind('inventory_actions');await key('e');await windowKind('menu');await key('Escape');await wait('command');await reference('i ');});
 await check('PC shortcuts also work in a narrow window and stop applying after the action',async()=>{await open({width:600,mobile:false});await select('a');await inspect();await action(101);await wait('command');await key('b');await wait('command');await reference('i eab');await shot('pc-narrow-actions-complete');});
 await check('Phone buttons retain their touch labels and operations',async()=>{await open({width:390});await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();await tap('item-a');await windowKind('inventory_actions');await inspect();await shot('phone-actions');await tap('window-101');await wait('command');await key('j');await wait('command');await reference('i eaj');});
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));}

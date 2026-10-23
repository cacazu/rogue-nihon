// All selection windows share displayed shortcuts and physical keyboard dispatch.
// Physical key presses are compared with the original C command sequence.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';import {installBrowserTestAdapter} from './test-adapter.mjs';import {fixtureWorker} from './fixture-worker.mjs';import {runGame} from '../run-game.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=process.env.ROGUE_SELECTION_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/selection-shortcuts'));
await mkdir(output,{recursive:true});const {chromium}=loadPlaywright(),browser=await chromium.launch({executablePath:browserExecutable(),headless:true}),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=path.join(root,'build/game-fixtures.wasm'),headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],windows:[],errors:[]};let context,page,fixture,language,width,mobile;
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
async function inspect(kind){const s=await snap();if(kind)assert.equal(s.state.input.kind,kind);
 const controls=s.scene.controls.filter(c=>c.shortcut);
 assert.ok(controls.length,'Window has keyboard hints');
 for(const c of controls){const hint=c.shortcut==='Escape'?'Esc':c.shortcut==='Enter'?'Enter':c.shortcut===' '?'Space':c.shortcut;assert.ok(c.label.startsWith(hint+') '),c.label);
  const label=c.label.replace(/\s+/g,' ').trim();assert.ok(s.commands.some(command=>{if(command.op!=='text')return false;const text=command.text.replace(/\s+/g,' ').trim();return text&&(text===label||text===hint||label.startsWith(text));}),'Actual canvas paints '+c.label);}
 const painted=s.commands.filter(c=>c.op==='text').map(c=>c.text).join('').replace(/\s+/g,'');
 if(s.scene.scope.startsWith('dialog:'))for(const c of controls.filter(c=>c.id.startsWith('window-')&&c.shortcut!=='Escape')){
  const label=c.label.replace(/\s+/g,'');const first=painted.indexOf(label);assert.ok(first>=0&&painted.indexOf(label,first+label.length)<0,'Button caption is shown once: '+c.label);
 }
 assert.doesNotMatch(painted,/選択キー|Choicekeys|\*で一覧|\*ですべて表示|\(\*for(?:list|all)\)/,'No duplicate operation instructions');
 const kindNow=s.state.input?.kind,obsolete=kindNow==='confirm'?/[（(][yYnN]\/?[yYnN]?[）)]|[YN][:：]/:kindNow==='hand'?/[（(][LR][）)]|[LR][:：]/:kindNow==='option_bool'?/[TF][:：]|[（(](?:Enter|-)[）)]/:kindNow==='option_inventory'?/[OSC][:：]|[（(](?:Enter|-)[）)]/:null;
 if(obsolete)assert.ok(!obsolete.test(painted),'No obsolete keys anywhere in the painted window/log: '+painted);
 report.windows.push({language,width,kind:s.state.input?.kind,scope:s.scene.scope,painted,controls:controls.map(c=>({id:c.id,label:c.label,shortcut:c.shortcut,disabled:c.disabled}))});return s;
}
async function action(id){const c=(await snap()).scene.controls.find(c=>c.id===id);assert.ok(c?.shortcut,id);await key(c.shortcut);}
async function reference(text){const expected=await runGame(wasm,{fixture,seed:17,name:'KeyAudit',locale:language,messagePaging:'log',text});assert.deepEqual((await snap()).state.trace.words,expected.traces.at(-1).words,'Same C state, turn and RNG as '+JSON.stringify(text));}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});}
async function check(name,fn){if(process.env.ROGUE_SELECTION_FILTER&&!name.match(new RegExp(process.env.ROGUE_SELECTION_FILTER)))return;await fn();report.checks.push(name);console.log('PASS '+name);}
async function finishOptions(){await key('Escape');await wait('command');}
try{
 for(const config of [{language:'ja'},{language:'en',width:600,mobile:false}]){
  await check('Confirmation No and Esc cancel, with the next game command '+JSON.stringify(config),async()=>{
   await open(config);for(const cancel of ['b','Escape']){await key('Q');await wait('confirm');const s=await inspect('confirm');assert.equal(s.scene.controls.find(c=>c.id==='window-121').shortcut,'a');assert.equal(s.scene.controls.find(c=>c.id==='window-110').shortcut,'b');await shot(language+'-'+width+'-confirm');await key(cancel);await wait('command');}
   await key('j');await wait('command');await reference('QnQnj');
  });
  await check('Confirmation Yes reaches results and Enter/Space proceeds '+JSON.stringify(config),async()=>{
   await open(config);await key('Q');await wait('confirm');await key('a');await page.waitForFunction(()=>['enter','space'].includes(__rogueBrowserTest.frame?.ui.input.kind)&&!__rogueBrowserTest.queuePending);await paint();await inspect();await reference('Qy');
   for(let i=0;i<6&&!(await snap()).state.topOpen;i++){const s=await snap();if(!s.state.running){await key('Escape');break;}const c=s.scene.controls.find(c=>c.id==='window-13'||c.id==='window-32');assert.ok(c,'Result has a continuation choice');await action(c.id);await paint();}
   await page.waitForFunction(()=>__rogueBrowserTest.topOpen&&!__rogueBrowserTest.running);
  });
  for(const [shortcut,original]of [['a','l'],['b','r']])await check('Hand '+original+' selection and next command '+JSON.stringify(config),async()=>{
   await open(config);await key('P');await wait('item');await key('h');await wait('hand');await inspect('hand');await shot(language+'-'+width+'-hand');await key(shortcut);await wait('command');await key('j');await wait('command');await reference('Ph'+original+'j');
  });
  await check('Ring removal question and captions use a/b without L/R '+JSON.stringify(config),async()=>{
   await open(config);await key('P');await wait('item');await key('h');await wait('hand');await key('a');await wait('command');
   await key('P');await wait('item');await key('i');await wait('command');
   await key('R');await wait('hand');await inspect('hand');await shot(language+'-'+width+'-ring-removal');await key('a');await wait('command');await key('j');await wait('command');await reference('PhlPiRlj');
  });
  await check('All boolean and inventory values, keep/back/finish '+JSON.stringify(config),async()=>{
   await open(config);await key('o');await wait('option_bool');let text='o';await inspect('option_bool');await shot(language+'-'+width+'-options-bool');
   for(const [alias,original]of [['a','t'],['b','f'],['c','\r'],['d','-']]){await key(alias);text+=original;await wait('option_bool');await inspect('option_bool');}
   for(let i=0;(await snap()).state.input.kind==='option_bool'&&i<10;i++){await key('c');text+='\r';await paint();}
   await wait('option_inventory');await inspect('option_inventory');await shot(language+'-'+width+'-options-inventory');
   // Back to a boolean, then return to exercise every inventory value on C.
   await key('e');text+='-';await wait('option_bool');await key('c');text+='\r';await wait('option_inventory');
   for(const [alias,original]of [['a','o'],['b','s'],['c','c'],['d','\r']]){await key(alias);text+=original;await wait('text');await key('Escape');text+='\x1b ';await wait('command');await reference(text);await key('o');text+='o';for(let i=0;(await snap()).state.input.kind==='option_bool'&&i<10;i++){await key('c');text+='\r';await paint();}await wait('option_inventory');}
   await finishOptions();text+='\x1b ';await key('j');await wait('command');await reference(text+'j');
  });
  await check('Language/display/theme dropdowns and every settings choice share dispatch '+JSON.stringify(config),async()=>{
   await open(config);const trace=(await snap()).state.trace;await tap('settings-toggle');await inspect();await key('a');await page.waitForFunction(()=>document.fullscreenElement!==null);await key('a');await page.waitForFunction(()=>document.fullscreenElement===null);await key('b');await page.waitForFunction(()=>!__rogueBrowserTest.diagnostics.settingsOpen);await tap('settings-toggle');await key('b');await page.waitForFunction(()=>!__rogueBrowserTest.diagnostics.settingsOpen);await tap('settings-toggle');await key('c');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animationEnabled===false);await key('c');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animationEnabled===true);
   await key('e');await inspect();await shot(language+'-'+width+'-display-dropdown');for(const [alias,value]of [['a','ascii'],['b','tiles'],['c','pixels']]){if(!(await snap()).scene.controls.some(c=>c.id==='select-display-mode-'+value))await key('e');await key(alias);await page.waitForFunction(value=>__rogueBrowserTest.diagnostics.displayMode===value,value);await paint();}
   await key('d');await inspect();await key('b');await page.waitForFunction(()=>__rogueUiAdapter.state.theme==='green-black');await key('d');await key('a');await page.waitForFunction(()=>__rogueUiAdapter.state.theme==='default');
   await key('Escape');assert.deepEqual((await snap()).state.trace,trace);await key('j');await wait('command');await reference('j');
   await tap('settings-toggle');await key('h');await wait('option_bool');await inspect('option_bool');await finishOptions();await wait('command');
   await tap('settings-toggle');await key('g');await wait('confirm');await key('b');await wait('command');
   // Saving and returning to the title also exercises the remaining settings action.
   await tap('settings-toggle');await key('f');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await paint();await tap('select-language');await inspect();await key(language==='ja'?'b':'a');await page.waitForFunction(value=>__rogueBrowserTest.language===value,language==='ja'?'en':'ja');await paint();await tap('select-language');await key('Escape');
  });
  await check('Category lists, item letters, numeric tabs, help, symbol and text fields '+JSON.stringify(config),async()=>{
   await open(config);await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();const trace=(await snap()).state.trace;const s=await inspect();assert.ok(s.scene.controls.find(c=>c.id==='item-a').label.startsWith('a) '),'PC keeps item letters even on narrow layouts');await shot(language+'-'+width+'-inventory');
   for(const tab of s.scene.controls.filter(c=>c.id.startsWith('inventory-tab-'))){await action(tab.id);await paint();assert.deepEqual((await snap()).state.trace,trace);}
   await key('1');await paint();for(let i=1;i<s.scene.controls.filter(c=>c.id.startsWith('inventory-tab-')).length;i++){await key('Tab');const t=await snap(),focused=t.scene.controls.find(c=>c.id===t.scene.pointer.focusId);assert.ok(focused?.id.startsWith('inventory-tab-'));assert.ok(focused.rect.w>0,'Tab reveals offscreen categories');}await key('Enter');assert.deepEqual((await snap()).state.trace,trace);await key('1');await paint();await key('D');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.itemHistoryOpen);await paint();await inspect();await key('I');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await key('Escape');await wait('command');
   await key('D');await wait('discovery');await inspect('discovery');await action('window-42');await wait('space');await inspect('space');await key('Escape');await wait('command');
   await key('?');await wait('help');await inspect('help');await action('window-42');await page.waitForFunction(()=>['space','space_cancel'].includes(__rogueBrowserTest.frame?.ui.input.kind));await paint();await inspect();await shot(language+'-'+width+'-help');for(let i=0;i<5&&(await snap()).state.input.kind!=='command';i++)await key('Space');await wait('command');
   await key('/');await wait('symbol');await inspect('symbol');await tap('command-key');await page.keyboard.insertText('!');await page.keyboard.press('Enter');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind!=='symbol');await paint();for(let i=0;i<5&&(await snap()).state.input.kind!=='command';i++)await key('Space');await wait('command');
   await key('c');await wait('item');await key('c');await wait('text');await inspect('text');const before=(await snap()).state.trace;await tap('prompt-text');await page.keyboard.insertText('abc  ABC');assert.equal(await page.locator('#prompt-text').inputValue(),'abc  ABC');assert.deepEqual((await snap()).state.trace,before);await page.keyboard.press('Enter');await wait('command');await key('j');await wait('command');
  });
  await check('History/status close hints and local input preserve C state '+JSON.stringify(config),async()=>{
   await open(config);const trace=(await snap()).state.trace;await tap('history-open');await inspect();await key('a');assert.deepEqual((await snap()).state.trace,trace);await key('Escape');await key('@');await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='status');await inspect();await key('Escape');await key('j');await wait('command');await reference('@j');
  });
 }
 await check('Item, direction, inventory actions and details show each shortcut once',async()=>{
  await open();await key('e');await wait('item');await inspect('item');await shot('item-without-footer');await key('Escape');await wait('command');
  await key('t');await wait('direction');await inspect('direction');await shot('direction-without-footer');await key('Escape');await wait('command');
  await key('i');await wait('space');await inspect();await tap('item-c');await windowKind('inventory_actions');await inspect();await shot('actions-without-footer');
  await action('window-118');await windowKind('inventory_details');await inspect();await action('window-27');await windowKind('inventory_actions');await action('window-27');await key('Escape');await wait('command');await key('j');await wait('command');await reference('e\x1bt\x1bi j');
 });
 await check('Detection result windows retain Close without repeating its key',async()=>{
  await open({fixture:'space-detection'});await key('q');await wait('item');await key('f');await wait('space');await inspect('space');await shot('detection-without-footer');await key('Space');await wait('command');
  await key('r');await wait('item');await key('g');await wait('space');await inspect('space');await key('Space');await wait('command');await key('j');await wait('command');await reference('qf rg j');
 });
 await check('PC narrow operations, disabled stairs, repeat input, and exact f/F command cases',async()=>{
  await open({width:600,mobile:false});await tap('mobile-operations');await inspect();await shot('pc-narrow-operations');const disabled=(await snap()).scene.controls.find(c=>c.id==='mobile-op-62');assert.ok(disabled?.disabled);const trace=(await snap()).state.trace;await key('>');assert.deepEqual((await snap()).state.trace,trace);await key('m');await wait('direction');await key('Escape');await wait('command');await key('j');await wait('command');await reference('m\x1bj');
  for(const command of ['f','F']){await tap('mobile-operations');await key(command);await wait('direction');await key('Escape');await wait('command');}
  const count=(await snap()).scene.controls.find(c=>c.id==='touch-again'),bounds=await page.locator('#rogue-canvas').boundingBox(),x=bounds.x+count.rect.x+count.rect.w/2,y=bounds.y+count.rect.y+count.rect.h/2;await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='repeat-count');await page.mouse.up();await inspect();await shot('pc-narrow-repeat');await tap('repeat-count');await page.keyboard.press('Control+a');await page.keyboard.insertText('12');await page.keyboard.press('Enter');await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope!=='repeat-count');
 });
 await check('Phone choices keep clean labels and can still be selected by touch',async()=>{await open({width:390,mobile:true});await key('Q');await wait('confirm');assert.ok((await snap()).scene.controls.every(c=>!c.shortcut));assert.ok(!/[（(]y\/n[）)]/.test((await snap()).scene.text.join('')),'Phone question has no obsolete keyboard hints');await shot('phone-confirm');await tap('window-110');await wait('command');await tap('settings-toggle');assert.ok((await snap()).scene.controls.every(c=>!c.shortcut));await tap('select-display-mode');assert.ok((await snap()).scene.controls.every(c=>!c.shortcut));await tap('select-display-mode-tiles');await tap('settings-close');await key('j');await wait('command');await reference('Qnj');});
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));}

// Item selection '*', fallback direction dialogs, cancellation, and all printable
// keyboard characters pass through real browser events to the original C waits.
import assert from 'node:assert/strict';import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';import {runGame} from '../run-game.mjs';import {createPreviewServer} from '../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),wasm=path.resolve(root,process.env.ROGUE_ITEM_USE_WASM||'build/item-use-fixtures.wasm');
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/item-use-keys'));await mkdir(output,{recursive:true});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],errors:[]},runtime=await prepareBrowserRuntime(root),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
let page,context,fixture,mobile,mode,text,playerName;
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);
 const c=(await snap()).scene.controls.find(c=>c.id===id),b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
 if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();
}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function key(k,append=k){await page.locator('#rogue-canvas').focus();await page.keyboard.press(k);text+=append;await paint();}
async function start(options={}){
 fixture=options.fixture||'item-identify';mobile=options.mobile||false;mode=options.mode||'pixels';playerName=options.name||'UseKeys';text='';await context?.close();
 context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1050},hasTouch:mobile,isMobile:mobile});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view='+mode);await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
 await tap('name');await page.keyboard.press('Control+a');await page.keyboard.insertText(playerName);await tap('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText('17');await tap('new-game');await wait('command');
}
async function compare(label){const ref=await runGame(wasm,{fixture,name:playerName,seed:17,locale:'ja',messagePaging:'log',text}),s=await snap();assert.deepEqual(s.state.trace.words,ref.traces.at(-1).words,label+' C/RNG');assert.equal(s.state.trace.input_index,text.length,label+' journal');assert.deepEqual(s.state.translationFallbacks,[]);assert.deepEqual(s.state.uiMissing,[]);
 const questions=[...new Set(ref.presentations.filter(p=>['item','direction','hand','text','confirm','help','symbol','discovery'].includes(p.ui.input.kind)).map(p=>p.ui.message?.text).filter(Boolean))];
 const visible=s.state.entries.filter(e=>!e.transient_prompt&&(!mobile||!e.mobile_keyboard_hint));
 for(const question of questions)assert.ok(!visible.some(e=>e.text===question),label+' leaves no selection question in persistent history: '+question);
 report.checks.push({label,fixture,mobile,mode,text,inputs:s.state.trace.input_index});}
async function listing(){
 let s=await snap();
 if(s.state.input.kind==='space'){assert.equal(s.state.frame.ui.mode,'menu');assert.ok(s.state.frame.ui.lines.some(l=>l.id==='ui.inventory.entry'),'The original list is visible');if(mobile){await tap('window-32');text+=' ';}else await key('Space',' ');await wait('item');}
 s=await snap();assert.equal(s.state.input.kind,'item');assert.equal(s.state.input.id,'input.choose_item_list');assert.match(s.state.frame.ui.window.title,/一覧/);assert.ok(s.scene.controls.some(c=>c.id.startsWith('item-')));await compare('Original list returns to a selectable item window');
}
try{
 for(const mode of ['pixels','tiles','ascii'])for(const mobile of [false,true]){
  await start({mode,mobile});await key('r');await wait('item');
  assert.ok(!(await snap()).scene.controls.some(c=>c.id==='window-42'),'Candidates need no duplicate list button');
  await key('NumpadMultiply','*');await listing();
  await tap('item-f');text+='f';await wait('item');assert.equal((await snap()).state.input.action,'action.identify');assert.match((await snap()).state.frame.ui.window.title,/識別/);
  await page.screenshot({path:path.join(output,mode+'-'+(mobile?'phone':'pc')+'-target.png')});
  await key('*');await listing();
  await tap('item-d');text+='d';await wait('command');await key('.');await wait('command');await compare('Read, list, select the identification target, next command');
  await start({mode,mobile,fixture:'naming-stick-0-known'});await key('z');await wait('direction');
  const selector=(await snap()).scene.controls.some(c=>c.id==='touch-l')?'touch-l':'window-108';assert.ok((await snap()).scene.controls.some(c=>c.id===selector));
  await page.screenshot({path:path.join(output,mode+'-'+(mobile?'phone':'pc')+'-direction.png')});
  await tap(selector);text+='l';await wait('item');await key('*');await listing();
  await tap('item-f');text+='f';await wait('command');await key('.');await wait('command');await compare('A single wand has a persistent list and can be used');
 }
 for(const mode of ['pixels','tiles','ascii']){
  await start({mode,mobile:true,fixture:'naming-stick-0-known'});
  await tap('settings-toggle');await tap('mobile-controls');await wait('command');
  await key('z');await wait('direction');
  const controls=(await snap()).scene.controls,r=key=>controls.find(c=>c.id==='window-'+key).rect;
  assert.equal(r(121).x,r(98).x);assert.equal(r(107).x,r(106).x);assert.equal(r(117).x,r(110).x);assert.ok(r(98).y>r(104).y,'Directions preserve the compass layout');
  await page.screenshot({path:path.join(output,mode+'-phone-hidden-pad.png')});
  await tap('window-108');text+='l';await wait('item');await key('Escape','\x1b');await wait('command');await key('.');await wait('command');await compare('Hidden phone pad falls back to the direction window');
 }
 // PC headers resolve the current public tile at the pointer on every repaint.
 for(const mode of ['pixels','tiles','ascii']){
  await start({mode,name:'長い名前の冒険者あいうえお'});const before=await snap();
  assert.ok(before.scene.text.includes(playerName),'PC name is above the gauges');
  const publicCells=await page.evaluate(()=>{const f=__rogueBrowserTest.frame,s=__rogueBrowserTest.canvas,c=s.camera,r=s.mapRect;return f.map_tiles.map((tile,i)=>({tile,x:r.x+(i%f.width+.5)*c.size-c.left,y:r.y+(Math.floor(i/f.width)-.5)*c.cellH-c.top})).filter(p=>p.x>r.x+20&&p.x<r.x+r.w-20&&p.y>r.y+100&&p.y<r.y+r.h-20);});
  const manifest=JSON.parse(await readFile(path.join(root,'web/assets/'+(mode==='pixels'?'pixels-v2':'tiles')+'/manifest.json'),'utf8'));
  for(const dark of [true,false]){
   const p=publicCells.find(p=>dark?p.tile===0:p.tile!==0);assert.ok(p,'Public hover cell exists');
   const bounds=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(bounds.x+p.x,bounds.y+p.y);await paint();const current=await snap(),image=current.commands.find(c=>c.logHeader);
   assert.equal(image.image,manifest.entries[p.tile].image);assert.equal(image.set,mode==='pixels'?'pixels':'tiles');
   assert.ok(current.scene.text.includes(manifest.entries[p.tile].labels.ja));
   await page.screenshot({path:path.join(output,mode+'-pc-header-'+(dark?'dark':'public')+'.png')});
  }
  assert.deepEqual((await snap()).state.trace,before.state.trace,'Hover leaves all C/RNG observations unchanged');
  for(const [command,tabs]of [['w',['weapon']],['t',['all']],['d',['all']]]){
   await key(command);if((await snap()).state.input.kind==='direction'){await key('l');}await wait('item');
   const s=await snap();assert.deepEqual(s.scene.controls.filter(c=>c.id.startsWith('inventory-tab-')).map(c=>c.id.slice(14)),tabs);
   assert.ok(!s.scene.controls.some(c=>c.id==='inventory-history'||c.id==='window-42'));
   await page.screenshot({path:path.join(output,mode+'-pc-'+command+'-selection.png')});
   await key('Escape','\x1b');await wait('command');
  }
  await compare('PC public header, name, weapon/throw/drop tabs');
 }
 // Every ordinary C item entry uses the same rows, tabs, and cancellation path.
 for(const mobile of [false,true]){
  await start({mobile,fixture:'plain'});
  for(const [command,tab]of [['w','weapon'],['W','armor'],['q','potion'],['r','scroll'],['e','food'],['P','ring'],['z','stick'],['t','all'],['d','all'],['c',null],['I','all']]){
   await key(command);if((await snap()).state.input.kind==='direction'){await key('l');}await wait('item');
   const s=await snap(),ui=s.state.frame.ui;
   assert.equal(typeof ui.input.filter,'string');assert.ok(!ui.lines.some(l=>l.scope==='item_filter'));
   assert.deepEqual(ui.window.actions.map(a=>a.key),[27],command+' has only Cancel');
   assert.ok(!s.scene.controls.some(c=>c.id==='window-42'));
   const actual=s.scene.controls.filter(c=>c.id.startsWith('inventory-tab-')).map(c=>c.id.slice(14));
   if(mobile)assert.deepEqual(actual,[]);else if(tab)assert.deepEqual(actual,[tab]);else{
    const order=['stick','food','potion','scroll','weapon','armor','ring','amulet','gold'];
    const expected=order.filter(category=>ui.lines.some(l=>l.selectable&&l.args?.[1]?.value.category===category));assert.deepEqual(actual,expected.length?expected:['all']);
   }
   await key('Escape','\x1b');await wait('command');assert.equal((await snap()).state.frame.ui.input.filter,undefined);await compare('All item contexts: '+command);
  }
 }
 // Cancelling each stage must discard the pending inventory action.
 for(const mobile of [false,true])for(const stage of ['direction','item','target','hand','text']){
  await start({mobile,fixture:stage==='hand'?'item-use-ring-0-base':stage==='text'?'item-use-weapon-0-base':undefined});
  if(stage==='direction'){await key('i');await wait('space');await tap('item-c');await tap('window-116');text+=' t';await wait('direction');}
  else if(stage==='hand'||stage==='text'){await key(stage==='hand'?'P':'c');await wait('item');if(stage==='text'&&!mobile)await tap('inventory-tab-weapon');await tap('item-f');text+='f';await wait(stage);}
  else{await key('r');await wait('item');if(stage==='target'){await tap('item-f');text+='f';await wait('item');}}
  await key('Escape','\x1b');await wait('command');await key('.');await wait('command');await compare('Cancel '+stage+' and execute the next command');
 }
 // Direction aliases must reach C instead of being treated as dialog scrolling.
 await start({fixture:'plain'});
 for(const [physical,original]of [
  ['ArrowLeft','h'],['ArrowRight','l'],['ArrowUp','k'],['ArrowDown','j'],['Home','y'],['End','b'],['PageUp','u'],['PageDown','n'],
  ['Numpad4','h'],['Numpad6','l'],['Numpad8','k'],['Numpad2','j'],['Numpad7','y'],['Numpad1','b'],['Numpad9','u'],['Numpad3','n'],
 ]){
  await key('t');await wait('direction');await key(physical,original);await wait('item');await tap('item-e');text+='e';await wait('command');await compare('Direction alias '+physical+' through actual arrow throwing');
 }
 // Help and discovery also advertise '*'; exercise the actual shared button.
 for(const command of ['?','D']){
  await start({fixture:'space-discoveries'});await key(command);await wait(command==='?'?'help':'discovery');
  await key('*');
  for(let i=0;i<15;i++){const s=await snap();if(s.state.input.kind==='command')break;assert.ok(['space','space_cancel'].includes(s.state.input.kind));await key('Space',' ');await paint();}
  await wait('command');await key('.');await wait('command');await compare('Advertised * in '+command);
 }
 // Every printable ASCII key, including JIS/US punctuation, has an entry path.
 // Native key events fill the explicit one-key field; Enter submits that key.
 await start({fixture:'plain'});
 for(let scalar=32;scalar<127;scalar++){
  const c=String.fromCharCode(scalar);await key('/');await wait('symbol');await tap('command-key');
  await page.keyboard.press(c==='+'?'Shift+Equal':c===' '?'Space':c);
  assert.equal(await page.locator('#command-key').inputValue(),c,'Physical key '+JSON.stringify(c));
  await page.keyboard.press('Enter');text+=c;await wait('command');
  assert.equal((await snap()).state.trace.input_index,text.length,'Consumed key '+JSON.stringify(c));
 }
 await key('.');await wait('command');await compare('All 95 printable ASCII keys through the one-key input');
 if(process.env.ROGUE_ITEM_REFERENCE){
  for(const [fixture,keys]of [['item-identify','rf* d.'],['naming-stick-0-known','zl*f.']]){
   const configuration={fixture,text:keys,name:'UseKeys',seed:17,locale:'ja',messagePaging:'log'},a=await runGame(wasm,configuration),b=await runGame(process.env.ROGUE_ITEM_REFERENCE,configuration);
   assert.deepEqual(a.traces,b.traces,'C list metadata preserves all original state/RNG checkpoints');report.checks.push({label:'Original pre-change C list flow',fixture,text:keys});
  }
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify({checks:report.checks.length,printableKeys:95,errors:report.errors,output}));
}catch(e){report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();}

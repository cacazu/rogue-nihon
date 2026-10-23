// Touch every phone window family, including the follow-ups produced by real C item use.
// Layout/wording contract: ../../docs/IMPLEMENTATION-ja.md; run via tests/run.mjs.
// Requires build/item-use-fixtures.wasm, never adds fixtures to the shipped game.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {runGame} from '../run-game.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_MOBILE_WINDOWS_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-window-layout/after'));
await mkdir(output,{recursive:true});
const wasm=path.join(root,'build/item-use-fixtures.wasm'),worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const report={windows:[],checks:[],errors:[]};
let context,page,cdp,fixture,width,language,mode,journal='';
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function swipe(region,delta,horizontal=false){
 const r=(await snap()).scene.regions[region].rect,b=await page.locator('#rogue-canvas').boundingBox();
 const x=b.x+r.x+(horizontal?(delta>0?r.w-12:12):r.w/2),y=b.y+r.y+(horizontal?r.h/2:(delta>0?r.h-16:16));
 const distance=Math.sign(delta)*Math.min(Math.abs(delta),(horizontal?r.w:r.h)-32);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-(horizontal?distance*i/6:0),y:y-(horizontal?0:distance*i/6),id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();
}
async function tap(id,region){
 for(let i=0;i<16;i++){
  const s=await snap(),c=s.scene.controls.find(c=>c.id===id&&!c.disabled);
  if(c&&c.rect.h>=Math.min(40,c.fullRect.h)&&c.rect.w>=Math.min(40,c.fullRect.w)){
   const b=await page.locator('#rogue-canvas').boundingBox();await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();return;
  }
  if(region)await swipe(region,160);else await paint();
 }
 throw Error('Cannot touch '+id+'; available: '+(await snap()).scene.controls.map(c=>c.id).join(','));
}
async function key(k){await page.locator('#rogue-canvas').focus();await page.keyboard.press(k);await paint();}
async function open(name,options={}){
 await context?.close();fixture=name;mode=options.mode||'pixels';language=options.language||'ja';
 context=await browser.newContext({viewport:{width,height:width===320?720:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);cdp=await context.newCDPSession(page);
 await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+language+'&view='+mode);
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
 for(const [id,value]of [['name','PhoneAudit'],['seed','17']]){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
 if(options.top)return;
 await tap('new-game');if(fixture.startsWith('ending-')){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window&&!__rogueBrowserTest.queuePending);await paint();}else await wait('command');journal='';
}
function panel(s){
 if(s.scene.scope.startsWith('dialog:'))return s.scene.dialogRect;
 // The surface panel is painted before its header and controls; log has an inner box too.
 return s.commands.find(c=>c.op==='box'&&c.fill==='#000000'&&c.stroke==='#ffffff'&&c.rect.w>200&&c.rect.h>100)?.rect;
}
async function inspect(name){
 const s=await snap(),p=panel(s),text=s.commands.filter(c=>c.op==='text').map(c=>c.text).join('').replace(/\s+/g,'');
 assert.doesNotMatch(text,/選択キー|Choicekeys|表示された持ち物キーで選びます|Choosethekeyshownintheinventory|\*で一覧|\*ですべて表示|\(\*for(?:list|all)\)/);
 assert.ok(s.scene.controls.every(c=>!c.shortcut),'Phone does not repeat PC key captions');
 assert.equal(s.state.runtimeError,null);assert.deepEqual(s.state.translationFallbacks,[]);assert.deepEqual(s.state.uiMissing,[]);
 if(p){assert.ok(p.y>=0&&p.y+p.h<=s.scene.height+0.1,'Window stays within phone height');assert.ok(p.x>=0&&p.x+p.w<=s.scene.width+0.1,'Window stays within phone width');}
 const entry={name,width,viewport:{width:s.scene.width,height:s.scene.height},language,mode,scope:s.scene.scope,input:s.state.input?.kind,panel:p,regions:s.scene.regions,controls:s.scene.controls.map(c=>({id:c.id,label:c.label,rect:c.rect,fullRect:c.fullRect})),text:s.scene.text};
 report.windows.push(entry);await page.screenshot({path:path.join(output,`${width}-${language}-${mode}-${name}.png`)});
 // These surfaces have finite content, and should not reserve an empty full screen.
 if(name==='settings')assert.equal(s.scene.regions.settings.max,0,'Fitting content has no scrollbar');
 if(['settings','status'].includes(s.scene.scope)){
  const region=s.scene.regions[s.scene.scope];
  if(region&&!region.max){const bottom=Math.max(...s.scene.controls.filter(c=>!c.id.endsWith('-close')).map(c=>c.fullRect.y+c.fullRect.h));
   if(s.scene.scope==='settings'){assert.ok(p.y+p.h-bottom<=32,'Settings has no empty tail');const by=id=>s.scene.controls.find(c=>c.id===id).fullRect;assert.ok(Math.abs(by('select-theme').y-by('animation-toggle').y-by('animation-toggle').h-12)<.01);assert.ok(Math.abs(by('select-display-mode').y-by('select-theme').y-by('select-theme').h-12)<.01);assert.ok(Math.abs(by('mobile-system-111').y-by('settings-top').y-by('settings-top').h-12)<.01);}
   if(s.scene.scope==='status')assert.ok(p.h<=76+9*50+24,'Status follows its rows');
  }
 }
 if(name==='history-short')assert.ok(p.h<=320,'Short history does not reserve an empty screen');
 if(name==='repeat')assert.equal(p.y+p.h-s.scene.controls.find(c=>c.id==='repeat-count-submit').fullRect.y-48,16,'No unused error placeholder');
 return s;
}
async function reference(label){const expected=await runGame(wasm,{fixture,name:'PhoneAudit',seed:17,locale:language,messagePaging:'log',text:journal});const s=await snap();assert.deepEqual(s.state.trace.words,expected.traces.at(-1).words,label+' preserves C state/RNG');assert.equal(s.state.trace.input_index,journal.length);}
async function next(){await tap('touch-.');journal+='.';await wait('command');await reference('Next command');}
async function inventory(){await tap('touch-action-action.inventory');journal+='i';await wait('space');}
async function actions(letter='f'){await inventory();await tap('item-'+letter,'dialog');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();}
async function followups(name,target){
 for(let i=0;i<12;i++){
  const s=await snap(),kind=s.state.input.kind;if(kind==='command')return;
  await inspect(name+'-'+i+'-'+kind);
  if(kind==='item'){await tap('item-'+target,'dialog');journal+=target;}
  else if(kind==='text'){await tap('submit-text');journal+='\x15\r';}
  else if(kind==='hand'){await tap('window-108');journal+='l';}
  else if(kind==='space'||kind==='space_cancel'){await tap(s.scene.controls.some(c=>c.id==='window-32')?'window-32':'window-close');journal+=' ';}
  else throw Error('Unexpected follow-up '+kind);
  await page.waitForFunction(()=>!__rogueBrowserTest.queuePending);await paint();
 }
 throw Error('Unfinished item use '+name);
}
async function check(name,fn){if(process.env.ROGUE_MOBILE_WINDOWS_FILTER&&!name.match(new RegExp(process.env.ROGUE_MOBILE_WINDOWS_FILTER)))return;await fn();report.checks.push(`${width} ${name}`);console.log('PASS '+width+' '+name);}
try{
 for(width of process.env.ROGUE_MOBILE_WINDOWS_WIDTHS?.split(',').map(Number)||[390,320]){
  await check('top language choices and inventory tabs/actions/details/history',async()=>{
   await open('inventory-all',{top:true});await tap('select-language');await inspect('language');await tap('select-language-ja');await tap('new-game');await wait('command');
   await inventory();await inspect('inventory');const before=(await snap()).state.trace,found=new Set();
   for(let i=0;i<8;i++){const s=await snap();for(const c of s.scene.controls.filter(c=>c.id.startsWith('inventory-tab-')&&c.rect.w===c.fullRect.w))found.add(c.id);if(s.scene.scrolls['inventory-tabs']===s.scene.regions['inventory-tabs'].max)break;await swipe('inventory-tabs',130,true);}
   assert.equal(found.size,9);for(const id of [...found].reverse()){
    for(let i=0;i<10;i++){const c=(await snap()).scene.controls.find(c=>c.id===id);if(c&&c.rect.w===c.fullRect.w)break;await swipe('inventory-tabs',-100,true);}
    await tap(id);await inspect(id);assert.deepEqual((await snap()).state.trace,before);
   }
   await tap('item-c','dialog');await inspect('weapon-actions');await tap('window-118');await inspect('weapon-details');await tap('window-27');await tap('window-27');
   await tap('inventory-history');await wait('space');await inspect('item-history');await tap('inventory-return');await wait('space');await inspect('inventory-return');await tap('window-32');journal+=' ';await wait('command');
   // Discovery browsing consumes its own original C inputs; start a fresh fixture for trace checks.
  });
  await check('settings, dropdown, switches, status, logs, operations and repeat input',async()=>{
   await open('inventory-all');const before=(await snap()).state.trace;
   await tap('settings-toggle');await inspect('settings');await tap('select-display-mode');await inspect('display');await tap('select-display-mode-pixels');
   await tap('animation-toggle');await inspect('animation-off');await tap('animation-toggle');await tap('settings-close');assert.deepEqual((await snap()).state.trace,before);
   await tap('status-open');await inspect('status');await tap('status-close');await tap('history-open');await inspect('history-short');await tap('history-close');
   await tap('mobile-operations');await inspect('operations');const region=(await snap()).scene.regions['mobile-operations'];if(region.max)await swipe('mobile-operations',300);await inspect('operations-scrolled');await tap('mobile-operations-close');
   const c=(await snap()).scene.controls.find(c=>c.id==='touch-again'),b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='repeat-count');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();await inspect('repeat');
   await tap('repeat-count');await page.keyboard.press('Control+a');await page.keyboard.insertText('0');await tap('repeat-count-submit');await inspect('repeat-error');await tap('repeat-count');await page.keyboard.press('Control+a');await page.keyboard.insertText('12');await tap('repeat-count-submit');assert.deepEqual((await snap()).state.trace,before);await next();
  });
  await check('every original settings input and ending confirmation',async()=>{
   await open('inventory-all');await tap('settings-toggle');await tap('mobile-system-111');await wait('option_bool');await inspect('options-bool');
   let seen=0;while((await snap()).state.input.kind==='option_bool'&&seen++<10){await tap('window-13');await paint();}
   await wait('option_inventory');await inspect('options-inventory');await tap('window-13');await wait('text');await inspect('options-text');await tap('window-27');await wait('command');
   await tap('settings-toggle');await tap('mobile-system-81');await wait('confirm');await inspect('quit-confirm');await tap('window-110');await wait('command');
  });
  for(const [category,type,verb,target]of [['potion',11,'q'],['scroll',15,'r'],...[5,6,7,8,9].map((n,i)=>['scroll',n,'r',['g','h','d','b','i'][i]]),['ring',0,'P'],['stick',13,'z'],['food',0,'e'],['armor',0,'W'],['weapon',0,'w']]){
   await check(`${category}-${type} item use and all follow-ups`,async()=>{
    await open(`item-use-${category}-${type}-base`);await actions();await inspect(`${category}-${type}-actions`);await tap('window-'+verb.charCodeAt(0));journal+=' '+verb;
    if(verb==='z'){await wait('direction');await inspect('stick-direction');await tap('touch-l');journal+='l';}
    journal+='f';await paint();await followups(`${category}-${type}-after-use`,target);await wait('command');await reference('Item use');await next();
   });
  }
  await check('both detection results, help, symbol and empty inventory',async()=>{
   await open('space-detection');for(const [letter,verb,name]of [['f','q','magic'],['g','r','food']]){await actions(letter);await tap('window-'+verb.charCodeAt(0));journal+=' '+verb+letter;await wait('space');await followups('detection-'+name);await wait('command');}await next();
   await open('inventory-empty');await inventory();await inspect('empty-inventory');await tap('window-32');journal+=' ';await wait('command');await next();
   await open('inventory-all');await key('?');await wait('help');await inspect('help-select');await tap('window-42');await page.waitForFunction(()=>['space','space_cancel'].includes(__rogueBrowserTest.frame.ui.input.kind)&&!__rogueBrowserTest.queuePending);await paint();await inspect('help-list');for(let i=0;i<10&&(await snap()).state.input.kind!=='command';i++){const controls=(await snap()).scene.controls;await tap(controls.some(c=>c.id==='window-27')?'window-27':controls.some(c=>c.id==='window-32')?'window-32':'window-close');}await wait('command');
   await key('/');await wait('symbol');await inspect('symbol');await tap('command-key');await page.keyboard.insertText('!');await tap('submit-text');await wait('command');
  });
  await check('direction selection with the touch pad hidden and cancellation',async()=>{
   await open('item-use-stick-13-base');await actions();await tap('settings-toggle');await tap('mobile-controls');await tap('window-122');journal+=' z';await wait('direction');await inspect('direction-no-pad');await tap('window-27');journal+='\x1b';await wait('command');await tap('settings-toggle');await tap('mobile-controls');await next();
  });
  await check('short viewports scroll finite sheets and long history remains readable',async()=>{
   await open('inventory-all');const before=(await snap()).state.trace;
   await page.setViewportSize({width:320,height:360});await page.waitForFunction(()=>__rogueBrowserTest.canvas.width===320&&__rogueBrowserTest.canvas.height<360);await paint();await tap('settings-toggle');await inspect('settings-short-viewport');assert.ok((await snap()).scene.regions.settings.max>0);await swipe('settings',200);await inspect('settings-short-scrolled');await tap('settings-close');
   await tap('status-open');await swipe('status',250);await inspect('status-short-scrolled');await tap('status-close');await tap('mobile-operations');await swipe('mobile-operations',250);await inspect('operations-short-scrolled');await tap('mobile-operations-close');
   assert.deepEqual((await snap()).state.trace,before);await page.setViewportSize({width,height:width===320?720:844});await paint();await tap('settings-toggle');await inspect('settings-grown');assert.equal((await snap()).scene.scrolls.settings,0);await tap('settings-close');await next();
   await open('inventory-all');for(let i=0;i<24;i++){journal+='v';await key('v');await page.waitForFunction(n=>__rogueBrowserTest.trace.input_index===n&&!__rogueBrowserTest.queuePending,journal.length);}const longBefore=(await snap()).state.trace;await tap('history-open');assert.ok((await snap()).scene.regions.log.max>0);await inspect('history-long');await swipe('log',-250);await inspect('history-long-scrolled');await tap('history-close');assert.deepEqual((await snap()).state.trace,longBefore);await next();
  });
  await check('death and victory result windows return to top',async()=>{
   for(const ending of ['ending-death','ending-no-tomb','ending-victory']){await open(ending);for(let i=0;i<8&&!(await snap()).state.topOpen;i++){const s=await inspect(ending+'-'+i);await tap(s.scene.controls.find(c=>c.id==='window-32'||c.id==='window-13')?.id||'result-top');await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n||__rogueBrowserTest.topOpen||!__rogueBrowserTest.running,s.state.inputRequestCount);await paint();}assert.equal((await snap()).state.topOpen,true);}
  });
 }
 // Long English labels and both other map modes use the same phone windows.
 width=320;await open('item-use-potion-11-base',{language:'en',mode:'tiles'});await tap('settings-toggle');await inspect('english-settings');await tap('settings-close');await actions();await inspect('english-actions');await tap('window-113');journal+=' qf';await followups('english-naming');await next();
 width=390;await open('item-use-scroll-15-base',{mode:'ascii'});await actions();await tap('window-114');journal+=' rf';await followups('ascii-naming');await next();
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();console.log('Evidence: '+output);}

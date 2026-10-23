// PC command reference contract: docs/IMPLEMENTATION-ja.md.
// Real C waits, actual pointer/keyboard operations, two-column layout and C/RNG isolation.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {runGame} from '../run-game.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=artifactDirectory(path.join(root,'tests/browser-smoke/output/command-reference'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=path.resolve(root,process.env.ROGUE_COMMAND_REFERENCE_WASM||'build/item-use-fixtures.wasm');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],windows:[],errors:[]},corpus=[];let ctx,page,cfg,journal;
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function key(value){await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);await paint();}
async function tap(id){await paint();const c=(await snap()).scene.controls.find(c=>c.id===id&&!c.disabled);assert.ok(c,id);const b=await page.locator('#rogue-canvas').boundingBox();await page.mouse.click(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function screenshot(label){const s=await snap();assert.equal(s.state.runtimeError,null);assert.deepEqual(s.state.uiMissing,[]);assert.deepEqual(s.state.translationFallbacks,[]);corpus.push(...s.commands.filter(c=>c.op==='text'));await page.screenshot({path:path.join(output,cfg.label+'-'+label+'.png')});report.windows.push({config:cfg.label,label,scope:s.scene.scope,text:s.scene.text});return s;}
function inspectTable(s){
 assert.equal(s.scene.scope,'commands');assert.equal(s.scene.mapRect,null);
 assert.deepEqual(s.scene.controls.map(c=>c.id),['commands-close'],'Rows are reference text, never command buttons');
 assert.deepEqual(Object.keys(s.scene.regions),['commands'],'Background has no active scroll/map regions');
 const expected=cfg.lang==='ja'?['キー','処理']:['Key','Action'];
 const headings=expected.map(t=>s.commands.find(c=>c.op==='text'&&c.text===t));assert.ok(headings.every(Boolean));assert.ok(headings.every(c=>c.y>s.scene.regions.commands.rect.y-40&&c.y<s.scene.regions.commands.rect.y),'Both headings are inside the fixed header');assert.ok(headings[1].x>headings[0].x+80,'Exactly two labelled columns');
 const r=s.scene.regions.commands.rect;
 for(const c of s.commands.filter(c=>c.op==='text'&&c.size===16)){assert.ok(c.x>=r.x&&c.x<r.x+r.w,'Table text starts within its viewport');}
 if(cfg.theme==='green-black')for(const c of s.commands.filter(c=>c.op==='text'&&c.size===16))assert.equal(c.color,'#00ff66');
 return {headingY:headings[0].y,split:headings[1].x};
}
async function openReference(label){const before=await snap();await tap('commands-open');const opened=await screenshot(label);inspectTable(opened);
 const labels=cfg.lang==='ja'?['キー','処理']:['Key','Action'],cells=labels.map(text=>opened.commands.find(c=>c.op==='text'&&c.text===text)),headerY=opened.scene.regions.commands.rect.y-40;
 const centers=await page.evaluate(({cells,headerY})=>{const canvas=document.querySelector('#rogue-canvas'),context=canvas.getContext('2d'),scale=canvas.width/canvas.clientWidth;return cells.map(c=>{const x=Math.floor(c.x*scale),y=Math.floor((headerY+3)*scale),width=Math.ceil(c.text.length*16*scale),height=Math.floor(34*scale),rgba=context.getImageData(x,y,width,height).data;let first=height,last=-1;for(let row=0;row<height;row++)for(let col=0;col<width;col++){const i=(row*width+col)*4;if(Math.max(rgba[i],rgba[i+1],rgba[i+2])>20){first=Math.min(first,row);last=Math.max(last,row);}}return {present:last>=first,center:(y+(first+last+1)/2)/scale};});},{cells,headerY});
 for(const ink of centers){assert.ok(ink.present);assert.ok(Math.abs(ink.center-headerY-20)<=1.5,'Header ink is vertically centered: '+JSON.stringify(ink));}
 assert.deepEqual(opened.state.trace,before.state.trace);return before;}
async function assertRestored(before){const s=await snap();assert.deepEqual(s.state.trace,before.state.trace);assert.deepEqual(s.state.input,before.state.input);assert.deepEqual(s.state.frame.ui.window,before.state.frame.ui.window);assert.equal(s.scene.scope,before.scene.scope);}
async function reference(){const expected=await runGame(wasm,{fixture:'inventory-all',seed:17,name:'CommandCheck',locale:cfg.lang,messagePaging:'log',text:journal});assert.deepEqual((await snap()).state.trace.words,expected.traces.at(-1).words);assert.equal((await snap()).state.trace.input_index,journal.length);}
try{
 for(cfg of [
  {label:'pc-ja',lang:'ja',width:1400,height:1000,mode:'pixels',theme:'default'},
  {label:'pc-en',lang:'en',width:900,height:700,mode:'ascii',theme:'default'},
  {label:'pc-compact-green',lang:'ja',width:700,height:420,mode:'tiles',theme:'green-black'},
 ]){
  journal='';ctx=await browser.newContext({viewport:{width:cfg.width,height:cfg.height}});
  await ctx.addInitScript(cfg=>localStorage.setItem('rogue-map-display-v1',JSON.stringify({version:1,mode:cfg.mode,zoom:32,animation:false,theme:cfg.theme})),cfg);
  await ctx.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'inventory-all'),contentType:'text/javascript',headers}));await ctx.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
  page=await ctx.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+cfg.lang);await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
  assert.ok(!(await snap()).scene.controls.some(c=>c.id==='commands-open'),'PC game button is absent from the title form');
  for(const [id,value]of [['name','CommandCheck'],['seed','17']]){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
  await tap('new-game');await wait('command');await screenshot('game');
  const controls=(await snap()).scene.controls,button=controls.find(c=>c.id==='commands-open'),settings=controls.find(c=>c.id==='settings-toggle'),status=controls.find(c=>c.id==='status-open');
  assert.equal(button.rect.y,settings.rect.y);assert.equal(button.rect.x+button.rect.w+8,settings.rect.x,'Command button is beside Settings');assert.ok(status.rect.x+status.rect.w<=button.rect.x,'Status does not overlap the added button');
  let before=await openReference('movement');const seen=new Set(),header=inspectTable(await snap());
  for(let i=0;i<60;i++){
   const s=await snap();s.scene.text.forEach(t=>seen.add(t));corpus.push(...s.commands.filter(c=>c.op==='text'));assert.equal(inspectTable(s).headingY,header.headingY,'Table headings stay fixed');
   if(s.scene.scrolls.commands>=s.scene.regions.commands.max)break;
   await key('PageDown');
  }
  for(const group of cfg.lang==='ja'?['移動・探索','戦闘','アイテム・装備','情報の確認','反復・取消','ウィンドウの選択・入力','システム']:['Movement and search','Combat','Items and equipment','Information','Repeat and cancel','Window selection and input','System'])assert.ok(seen.has(group),'All command genres are reachable: '+group);
  for(const shortcut of ['g','p','x + '+(cfg.lang==='ja'?'方向':'direction'),'E','A','C','O','G','V','M'])assert.ok([...seen].some(text=>text===shortcut||text.startsWith(shortcut)), 'Web shortcut is documented: '+shortcut);
  await screenshot('system');assert.ok((await snap()).scene.scrolls.commands>0);
  await key('Home');assert.equal((await snap()).scene.scrolls.commands,0);const r=(await snap()).scene.regions.commands.rect,b=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(b.x+r.x+40,b.y+r.y+40);await page.mouse.wheel(0,500);await paint();assert.ok((await snap()).scene.scrolls.commands>0,'Mouse wheel scrolls table');
  await page.mouse.move(b.x+r.x+40,b.y+r.y+70);await page.mouse.down();await page.mouse.move(b.x+r.x+40,b.y+r.y+20,{steps:5});await page.mouse.up();await paint();
  for(const k of ['i','j','.','z','Q','Control+r','Control+p','*'])await key(k);
  assert.deepEqual((await snap()).state.trace,before.state.trace,'Reading, scrolling, row clicks and keys do not reach C');
  await key('Escape');await assertRestored(before);
  await tap('commands-open');assert.equal((await snap()).scene.scrolls.commands,0,'Reopening starts at the first genre');await key('Tab');await key('Enter');await assertRestored(before);
  await key('i');journal+='i';await wait('space');before=await openReference('over-inventory');await tap('commands-close');await assertRestored(before);await key(' ');journal+=' ';await wait('command');
  await key('z');journal+='z';await wait('direction');before=await openReference('over-direction');await key('j');await key('Escape');await assertRestored(before);await key('Escape');journal+='\x1b';await wait('command');
  await key('q');journal+='q';await wait('item');before=await openReference('over-item');await key('*');await tap('commands-close');await assertRestored(before);await key('Escape');journal+='\x1b';await wait('command');
  await key('c');journal+='c';await wait('item');await key('c');journal+='c';await wait('text');await tap('prompt-text');await page.keyboard.insertText('Draft 名称');before=await openReference('over-naming');await key('x');await key('Escape');await assertRestored(before);assert.equal(await page.locator('#prompt-text').inputValue(),'Draft 名称','Opening the reference preserves the unsubmitted draft');await key('Escape');journal+='\x1b';await wait('command');
  await key('Q');journal+='Q';await wait('confirm');before=await openReference('over-confirm');await key('a');await tap('commands-close');await assertRestored(before);await key('b');journal+='n';await wait('command');
  await reference();await key('.');journal+='.';await page.waitForFunction(n=>__rogueBrowserTest.trace.input_index===n&&!__rogueBrowserTest.queuePending,journal.length);await wait('command');await reference();
  // A PC reference already open survives resizing into the narrow layout safely.
  before=await openReference('before-resize');await page.setViewportSize({width:320,height:600});await paint();inspectTable(await screenshot('resized-320'));await key('End');await screenshot('resized-bottom');await key('Escape');assert.deepEqual((await snap()).state.trace,before.state.trace);assert.ok(!(await snap()).scene.controls.some(c=>c.id==='commands-open'));
  await page.setViewportSize({width:cfg.width,height:cfg.height});await paint();await tap('settings-toggle');assert.ok(!(await snap()).scene.controls.some(c=>c.id==='commands-open'),'Settings is modal');await tap('settings-close');
  report.checks.push(cfg);console.log('PASS '+cfg.label);await ctx.close();ctx=null;
 }
 ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page=await ctx.newPage();await installBrowserTestAdapter(page);await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id==='new-game'&&!c.disabled));await page.locator('[data-control="new-game"]').tap();await wait('command');assert.ok(!(await snap()).scene.controls.some(c=>c.id==='commands-open'));report.checks.push({label:'phone-unchanged'});assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await writeFile(path.join(output,'draw-text.json'),JSON.stringify(corpus));await ctx?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();}

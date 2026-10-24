// UI theme data and settings contract: docs/IMPLEMENTATION-ja.md.
// Real C fixtures, actual keys/touch, palette changes, persistence, and unchanged C/RNG.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {runGame} from '../run-game.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=artifactDirectory(path.join(root,'tests/browser-smoke/output/themes'));
await mkdir(output,{recursive:true});
const spec=JSON.parse(await readFile(path.join(root,'web/themes.json'),'utf8'));
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=process.env.ROGUE_THEMES_WASM||path.join(root,'build/item-use-fixtures.wasm');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const mapOnly=process.argv.includes('--map-only');
const mapColors=new Set(Object.values(spec.map_colors));
const report={checks:[],windows:[],errors:[]};let ctx,page,cfg,fixture,journal;
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function tap(id){await paint();const c=(await snap()).scene.controls.find(c=>c.id===id&&!c.disabled);assert.ok(c,id);const b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(cfg.mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(value){await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);await paint();}
async function controlKey(id){const c=(await snap()).scene.controls.find(c=>c.id===id&&!c.disabled);assert.ok(c?.shortcut,id+' has an active visible shortcut');await key(c.shortcut);}
async function capture(label){
 const s=await snap();assert.equal(s.state.runtimeError,null);assert.deepEqual(s.state.translationFallbacks,[]);assert.deepEqual(s.state.uiMissing,[]);
 assert.ok(!s.commands.some(c=>['color','fill','stroke'].some(k=>typeof c[k]==='string'&&c[k].startsWith('@'))),'Resolved paint roles');
 if(s.state.theme==='green-black')for(const c of s.commands.filter(c=>c.op==='text'&&!mapColors.has(c.color))){assert.equal(c.color,'#00ff66',label+': '+c.text);assert.equal(c.monochrome,true);}
 const css=await page.evaluate(()=>{const stage=document.getElementById('canvas-stage'),heading=document.getElementById('app-heading');return {foreground:getComputedStyle(stage).color,background:getComputedStyle(stage).backgroundColor,theme:stage.dataset.theme,shellForeground:getComputedStyle(heading).color,shellBackground:getComputedStyle(document.documentElement).backgroundColor,shellTheme:document.documentElement.dataset.theme};});
 assert.equal(css.foreground,s.state.theme==='green-black'?'rgb(0, 255, 102)':'rgb(255, 255, 255)');assert.equal(css.background,'rgb(0, 0, 0)');assert.equal(css.theme,s.state.theme);
 assert.equal(css.shellForeground,'rgb(255, 255, 255)','HTML title keeps the shell text color');assert.equal(css.shellBackground,'rgb(0, 0, 0)');assert.equal(css.shellTheme,undefined,'Game theme is scoped below the HTML shell');
 await page.screenshot({path:path.join(output,cfg.label+'-'+label+'.png')});report.windows.push({config:cfg.label,label,theme:s.state.theme,scope:s.scene.scope,text:s.scene.text,css});return s;
}
function mapPaint(s,rect){
 let start=s.commands.findIndex(c=>c.op==='clip'&&JSON.stringify(c.rect)===JSON.stringify(rect));assert.ok(start>=0,'Map clip');const result=[];let depth=1;
 for(const c of s.commands.slice(start+1)){if(c.op==='restore'&&--depth===0)break;if(c.op==='save'||c.op==='clip')depth++;result.push(c);}return result;
}
async function select(value){
 await tap('settings-toggle');
 if(cfg.mobile)await tap('select-theme');else await controlKey('select-theme');
 assert.ok((await snap()).scene.controls.some(c=>c.id==='select-theme-'+value));
 if(cfg.mobile)await tap('select-theme-'+value);else await key(value==='default'?'a':'b');
 await page.waitForFunction(value=>__rogueUiAdapter.state.theme===value,value);await paint();
 await capture('settings-'+value);await tap('settings-close');
}
async function start(){
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
 for(const [id,value]of[['name','ThemeCheck'],['seed','17']]){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
 await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window||__rogueBrowserTest.frame?.ui.input.kind==='command');await paint();
}
async function displayMode(mode){
 await tap('settings-toggle');await tap('select-display-mode');await tap('select-display-mode-'+mode);
 await page.waitForFunction(mode=>__rogueUiAdapter.state.displayMode===mode,mode);await tap('settings-close');await paint();
}
async function mapPixels(rect){
 return page.evaluate(rect=>{const canvas=document.getElementById('rogue-canvas'),map=__rogueBrowserTest.canvas.mapRect,r=rect||{...map,y:map.y+92,h:map.h-92},ratio=canvas.width/canvas.getBoundingClientRect().width;
  const bytes=Array.from(canvas.getContext('2d').getImageData(Math.ceil((r.x+2)*ratio),Math.ceil((r.y+2)*ratio),Math.floor((r.w-4)*ratio),Math.floor((r.h-4)*ratio)).data);
  let visible=0,colored=0,offPalette=0;for(let i=0;i<bytes.length;i+=4){const [red,green,blue]=bytes.slice(i,i+3);if(red||green||blue)visible++;if(red>0&&red!==green)colored++;if(red!==0||Math.abs(blue-green*.4)>2)offPalette++;}
  return {bytes,visible,colored,offPalette};},rect);
}
async function mapPaletteCases(){
 // Put a real public item beside the player through ordinary C input.
 await key('d');journal+='d';await wait('item');await key('f');journal+='f';await wait('command');await key('h');journal+='h';await wait('command');
 for(const mode of ['ascii','tiles','pixels']){
  await displayMode(mode);const before=await snap(),base=await mapPixels();assert.ok(base.visible>50,'Actual map pixels rendered');
  if(mode!=='ascii'){assert.ok(base.colored>50,'Original artwork has visible color');const images=mapPaint(before,before.scene.mapRect).filter(c=>c.op==='image');for(const group of ['terrain.','actor.','item.'])assert.ok(images.some(c=>c.image.includes(group)),group+' is visible');}
  await select('green-black');const green=await snap(),pixels=await mapPixels();assert.deepEqual(green.state.trace,before.state.trace,'Theme leaves C/RNG/input unchanged');assert.ok(pixels.visible>50);assert.deepEqual(pixels.bytes,base.bytes,'Green monitor keeps exact original map RGBA');assert.deepEqual(mapPaint(green,green.scene.mapRect),mapPaint(before,before.scene.mapRect),'Map commands retain their original palette');
  for(const c of mapPaint(green,green.scene.mapRect)){assert.equal(c.tint,undefined);assert.equal(c.monochrome,undefined);}
  if(!cfg.mobile){
   const p=await page.evaluate(()=>{const f=__rogueBrowserTest.frame,s=__rogueBrowserTest.canvas,c=s.camera,r=s.mapRect;return f.map_tiles.map((tile,i)=>({tile,glyph:f.map_cells[i],x:r.x+(i%f.width+.5)*c.size-c.left,y:r.y+(Math.floor(i/f.width)-.5)*c.cellH-c.top})).find(p=>p.tile>=14&&p.tile<=22&&p.x>r.x&&p.x<r.x+r.w&&p.y>r.y&&p.y<r.y+r.h);});assert.ok(p,'Public item hover');const b=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(b.x+p.x,b.y+p.y);await paint();const header=(await snap()).commands.find(c=>c.logHeader);assert.ok(header);if(mode==='ascii'){assert.equal(header.text,p.glyph);assert.equal(header.color,'#00ff66');}else{assert.equal(header.set,mode);assert.equal(header.tint,'#00ff66');}const headerPixels=await mapPixels(header.rect||{x:header.x-2,y:header.y-2,w:26,h:26});assert.ok(headerPixels.visible>5,'Hovered item actually rendered');assert.equal(headerPixels.offPalette,0,'Actual hover RGBA uses green shades');
  }
  await capture('green-map-'+mode);await select('default');assert.deepEqual((await mapPixels()).bytes,base.bytes,'Default restores exact original map RGBA');assert.deepEqual((await snap()).state.trace,before.state.trace);report.checks.push({config:cfg.label,mode,mapPixels:pixels.visible});
 }
 await equivalent();
}
async function equivalent(){const expected=await runGame(wasm,{fixture,name:'ThemeCheck',seed:17,locale:cfg.lang,messagePaging:'log',text:journal});assert.deepEqual((await snap()).state.trace.words,expected.traces.at(-1).words);assert.equal((await snap()).state.trace.input_index,journal.length);}
try{
 for(cfg of [
  {label:'pc-ja',lang:'ja',mobile:false,width:1400,height:1050,mode:'pixels'},
  {label:'pc-en',lang:'en',mobile:false,width:900,height:800,mode:'ascii'},
  {label:'phone-ja',lang:'ja',mobile:true,width:390,height:844,mode:'tiles'},
  {label:'phone-en',lang:'en',mobile:true,width:320,height:720,mode:'pixels'},
 ].filter(c=>!mapOnly||['pc-ja','phone-ja'].includes(c.label))){
  fixture='inventory-all';journal='';ctx=await browser.newContext({viewport:{width:cfg.width,height:cfg.height},isMobile:cfg.mobile,hasTouch:cfg.mobile});
  await ctx.addInitScript(mode=>{if(!localStorage.getItem('rogue-map-display-v1'))localStorage.setItem('rogue-map-display-v1',JSON.stringify({version:1,mode,zoom:32,animation:false}));},cfg.mode);
  await ctx.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
  await ctx.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
  page=await ctx.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+cfg.lang);await start();await wait('command');
  if(mapOnly){await mapPaletteCases();await ctx.close();ctx=null;console.log('PASS map '+cfg.label);continue;}
  const initial=await capture('default-game');assert.equal(initial.state.theme,'default');const before=initial.state.trace,map=mapPaint(initial,initial.scene.mapRect);
  await tap('settings-toggle');
  const settings=(await snap()).scene,theme=settings.controls.find(c=>c.id==='select-theme'),display=settings.controls.find(c=>c.id==='select-display-mode');
  assert.equal(display.fullRect.y,theme.fullRect.y+theme.fullRect.h+12,'Map display is the next row below theme');
  assert.ok(Math.abs(display.fullRect.x+display.fullRect.w-theme.fullRect.x-theme.fullRect.w)<.01,'Both dropdowns align to the right');
  assert.ok(settings.text.includes(cfg.lang==='ja'?'表示方法':'Display mode'));
  assert.equal(Boolean(theme.shortcut),!cfg.mobile);assert.equal(Boolean(display.shortcut),!cfg.mobile);if(!cfg.mobile)assert.notEqual(theme.shortcut,display.shortcut,'Settings shortcuts remain distinct');
  await capture('settings-order');
  for(const mode of ['ascii','tiles','pixels',cfg.mode]){
   if(cfg.mobile)await tap('select-display-mode');else await controlKey('select-display-mode');
   await tap('select-display-mode-'+mode);await page.waitForFunction(mode=>__rogueUiAdapter.state.displayMode===mode,mode);await paint();
   assert.deepEqual((await snap()).state.trace,before,'Display selection is local');
  }
  await tap('select-theme');await capture('default-dropdown');assert.equal((await snap()).scene.controls.filter(c=>c.id.startsWith('select-theme-')).length,spec.themes.length);
  await key('Escape');assert.equal((await snap()).state.theme,'default');await tap('settings-close');
  await select('green-black');await capture('green-game');assert.deepEqual((await snap()).state.trace,before);assert.deepEqual(mapPaint(await snap(),initial.scene.mapRect),map,'Green monitor keeps original map paint');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('rogue-map-display-v1')));assert.equal(stored.theme,'green-black');assert.equal(stored.mode,cfg.mode);assert.equal(stored.animation,false);
  await tap('status-open');await capture('green-status');await tap('status-close');await tap('history-open');await capture('green-history');await tap('history-close');
  await key('i');journal+='i';await wait('space');await capture('green-inventory');await tap('item-c');await capture('green-actions');await tap('window-118');await capture('green-details');await tap('window-27');await tap('window-27');await tap('window-32');journal+=' ';await wait('command');
  await key('c');journal+='c';await wait('item');const callable=(await snap()).scene.controls.find(c=>c.id.startsWith('item-')&&!c.disabled);assert.ok(callable,'Visible callable item');await tap(callable.id);journal+=callable.id.slice(5);await wait('text');await capture('green-text-input');await tap('window-27');journal+='\x1b';await wait('command');
  await equivalent();await key('.');journal+='.';await page.waitForFunction(n=>__rogueBrowserTest.trace.input_index===n&&!__rogueBrowserTest.queuePending,journal.length);await wait('command');await equivalent();
  const after=(await snap()).state.trace;await select('default');await capture('restored-default');assert.deepEqual((await snap()).state.trace,after);await select('green-black');
  await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();assert.equal((await snap()).state.theme,'green-black');await capture('persisted-green-top');
  // A used potion's naming dialog uses the same theme during its real follow-up.
  fixture='item-use-potion-11-base';await start();await wait('command');await key('q');await wait('item');await tap('item-f');await wait('text');await capture('green-after-use');await tap('window-27');await wait('command');
  if(cfg.label==='pc-ja'){
   fixture='ending-death';await page.reload();await start();await wait('enter');await capture('green-tombstone');await tap('window-13');await wait('enter');await capture('green-score');await tap('window-13');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await capture('green-ended-top');
  }
  await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('rogue-map-display-v1'));p.theme='missing-theme';localStorage.setItem('rogue-map-display-v1',JSON.stringify(p));});await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();assert.equal((await snap()).state.theme,'default');assert.equal((await snap()).state.displayMode,cfg.mode);await capture('unknown-theme-fallback');
  report.checks.push(cfg);console.log('PASS '+cfg.label);await ctx.close();ctx=null;
 }
 assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await ctx?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();}

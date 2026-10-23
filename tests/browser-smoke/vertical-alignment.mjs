// All control types share vertical text centering, including exact native values.
// Pixel checks deliberately exclude borders, focus underlines and the blinking caret.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';import {fixtureWorker} from './fixture-worker.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=process.env.ROGUE_VERTICAL_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/vertical-alignment'));
await mkdir(output,{recursive:true});const {chromium}=loadPlaywright(),browser=await chromium.launch({executablePath:browserExecutable(),headless:true}),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],pixels:[],errors:[]};let context,page,cdp,width,language,scale;
const snap=()=>page.evaluate(()=>({scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands,state:__rogueUiAdapter.state}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function tap(id){await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);const c=(await snap()).scene.controls.find(c=>c.id===id),b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(width<700)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function blur(){await page.locator('#rogue-canvas').focus();await page.mouse.move(1,1);await paint();}
async function fill(id,value){await tap(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);await paint();assert.equal(await page.locator('#'+id).inputValue(),value);}
async function key(k){await page.locator('#rogue-canvas').focus();await page.keyboard.press(k);await paint();}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function centered(id,label='',crop={top:5,bottom:5}){await blur();const s=await snap(),r=s.scene.controls.find(c=>c.id===id)?.fullRect;assert.ok(r,id);
 const ink=await page.evaluate(({r,crop})=>{const canvas=document.querySelector('#rogue-canvas'),ctx=canvas.getContext('2d'),ratio=canvas.width/canvas.clientWidth;
  const left=Math.ceil((r.x+10)*ratio),top=Math.ceil((r.y+crop.top)*ratio),w=Math.floor((r.w-20)*ratio),h=Math.floor((r.h-crop.top-crop.bottom)*ratio),pixels=ctx.getImageData(left,top,w,h).data;
  let y0=h,y1=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>16){y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  return {top:(top+y0)/ratio,bottom:(top+y1+1)/ratio,present:y1>=y0};
 },{r,crop});assert.ok(ink.present,id+' has painted text');const delta=(ink.top+ink.bottom)/2-(r.y+r.h/2);
 assert.ok(Math.abs(delta)<=1,id+' '+label+' actual ink center differs by '+delta+'px: '+JSON.stringify({r,ink}));report.pixels.push({width,language,scale,id,label,delta});
}
async function check(name,fn){await fn();report.checks.push({width,language,scale,name});console.log('PASS '+width+' '+language+' '+scale+'x '+name);}
async function shot(name){await page.screenshot({path:path.join(output,`${width}-${language}-${scale}x-${name}.png`)});}
try{for(const config of [[320,'ja',1],[390,'ja',2],[390,'en',1],[1400,'ja',1],[1400,'en',2]]){
 [width,language,scale]=config;context=await browser.newContext({viewport:{width,height:width<700?844:1050},isMobile:width<700,hasTouch:width<700,deviceScaleFactor:scale});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'inventory-all'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+language+'&view=pixels');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
 await check('default title values, buttons and selection display use the same vertical center',async()=>{await centered('name');await centered('seed');await centered('new-game');await centered('select-language');await shot('top');});
 await check('Japanese, spaces, long values and editing cursor stay centered without changing values',async()=>{
  for(const value of ['A  B','入力  確認','W'.repeat(49)]){await fill('name',value);await centered('name',value);const s=await snap(),r=s.scene.controls.find(c=>c.id==='name').fullRect;assert.ok(s.commands.some(c=>c.op==='text'&&c.text===value&&c.x>=r.x&&c.x<r.x+r.w),'Exact text is painted, including repeated spaces');}
  await fill('name','AB  CD');await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('Shift+ArrowLeft');await paint();const s=await snap(),r=s.scene.controls.find(c=>c.id==='name').fullRect;
  const selection=s.commands.find(c=>c.op==='rect'&&c.color==='#ffffff33'&&c.rect.y>=r.y&&c.rect.y<r.y+r.h);assert.ok(selection,'Native selection is painted');assert.equal(selection.rect.y+selection.rect.h/2,r.y+r.h/2);assert.equal(await page.locator('#name').inputValue(),'AB  CD');
  await fill('name','FieldAudit');await fill('seed','17');await centered('seed','17');
 });
 await tap('new-game');await wait('command');
 await check('inventory row, tab and item commands are vertically centered',async()=>{
  await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);await paint();await centered('item-a');await centered('inventory-tab-all','',{top:6,bottom:10});await shot('inventory');
  const trace=(await snap()).state.trace;await tap('item-c');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await centered('window-100');assert.deepEqual((await snap()).state.trace,trace);await tap('window-27');await tap('window-32');await wait('command');
 });
 await check('42px naming input centers exact text and submits it without collapsing spaces',async()=>{
  await key('c');await wait('item');await key('c');await wait('text');const trace=(await snap()).state.trace;await fill('prompt-text','AB  CD');await centered('prompt-text');await shot('name-dialog');assert.deepEqual((await snap()).state.trace,trace,'Editing and alignment do not advance C/RNG');
  await tap('submit-text');await wait('command');await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.inventory===true);assert.ok(JSON.stringify((await snap()).state.frame.ui.lines).includes('AB  CD'),'Game receives the exact name');await tap('window-32');await wait('command');
 });
 await check('symbol input is centered and cancellation returns to normal input',async()=>{
  await key('/');await wait('symbol');const trace=(await snap()).state.trace;await fill('command-key','!');await centered('command-key');await shot('symbol-dialog');assert.deepEqual((await snap()).state.trace,trace);await key('Escape');
  for(let i=0;i<3&&(await snap()).state.input.kind!=='command';i++)await key('Space');await wait('command');
 });
 if(width<700)await check('repeat count input and two line button share the same centering',async()=>{
  const trace=(await snap()).state.trace,c=(await snap()).scene.controls.find(c=>c.id==='touch-again'),b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='repeat-count');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();
  await centered('repeat-count');await fill('repeat-count','123');await centered('repeat-count');await shot('repeat-dialog');await tap('repeat-count-submit');await wait('command');assert.deepEqual((await snap()).state.trace,trace);await centered('touch-again','two lines');await shot('repeat-button');
 });
 await key('.');await wait('command');await context.close();context=null;
 }assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));}

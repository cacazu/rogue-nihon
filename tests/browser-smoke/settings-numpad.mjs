// Settings alignment and physical keypad behavior on desktop and phone layouts.
// Uses real C fixtures, native keyboard events and the pixels actually painted.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {runGame} from '../run-game.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_SETTINGS_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/settings-numpad'));
await mkdir(output,{recursive:true});
const {chromium}=loadPlaywright(),browser=await chromium.launch({executablePath:browserExecutable(),headless:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),wasm=path.join(root,'build/game-fixtures.wasm');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],alignment:[],keys:[],errors:[]};let context,page,cdp,width,language,text;
const snapshot=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function tap(id){await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);const c=(await snapshot()).scene.controls.find(c=>c.id===id),b=await page.locator('#rogue-canvas').boundingBox();const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(width<700)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
const offKeys=['','End','ArrowDown','PageDown','ArrowLeft','Clear','ArrowRight','Home','ArrowUp','PageUp'];
const offVk=[0,35,40,34,37,12,39,36,38,33];
const chars=['','b','j','n','h','.','l','y','k','u'];
async function keypad(digit,{locked=true,modifiers=0,repeat=false,insert=false}={}){
 const key=locked?String(digit):offKeys[digit],vk=locked?96+digit:offVk[digit];
 const data={key,code:'Numpad'+digit,isKeypad:true,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers};
 await cdp.send('Input.dispatchKeyEvent',{...data,type:'keyDown',autoRepeat:repeat,...(insert?{text:String(digit),unmodifiedText:String(digit)}:{})});
 await cdp.send('Input.dispatchKeyEvent',{...data,type:'keyUp'});await paint();
}
async function wait(kind){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function sent(fn){const previous=(await snapshot()).state.inputRequestCount;await fn();await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&!__rogueBrowserTest.queuePending,previous);await paint();}
async function press(key,original){await sent(async()=>{await page.locator('#rogue-canvas').focus();await page.keyboard.press(key);});text+=original;}
async function move(digit,options={}){await sent(async()=>{await page.locator('#rogue-canvas').focus();await keypad(digit,options);});let c=chars[digit];if(options.modifiers===8)c=c.toUpperCase();if(options.modifiers===2&&c!=='.')c=String.fromCharCode(c.charCodeAt(0)&31);text+=c;await wait('command');report.keys.push({width,language,digit,...options,original:c});}
async function reference(){const expected=await runGame(wasm,{fixture:'inventory-all',seed:17,name:'5',locale:language,messagePaging:'log',text});assert.deepEqual((await snapshot()).state.trace.words,expected.traces.at(-1).words,'Physical keys match original C state, turn and RNG');}
async function check(name,fn){await fn();report.checks.push({width,language,name});console.log('PASS '+width+' '+language+' '+name);}
async function shot(name){await page.screenshot({path:path.join(output,width+'-'+language+'-'+name+'.png')});}
async function centered(checked){const s=await snapshot(),row=s.scene.controls.find(c=>c.id==='animation-toggle').fullRect;
 const track=s.commands.find(c=>c.op==='box'&&c.rect.w===56&&c.rect.h===32&&c.rect.y>=row.y&&c.rect.y<row.y+row.h)?.rect;assert.ok(track,'Switch track exists');
 const state={x:track.x-60,y:row.y,w:48,h:row.h-4};
 const label={x:row.x+12,y:row.y,w:state.x-row.x-24,h:row.h-4};
 const ink=await page.evaluate(({state,label})=>{const canvas=document.querySelector('#rogue-canvas'),ctx=canvas.getContext('2d'),ratio=canvas.width/canvas.clientWidth;
  const bounds=r=>{const x=Math.round(r.x*ratio),y=Math.round(r.y*ratio),w=Math.round(r.w*ratio),h=Math.round(r.h*ratio),data=ctx.getImageData(x,y,w,h).data;let left=w,right=-1,top=h,bottom=-1;
   for(let iy=0;iy<h;iy++)for(let ix=0;ix<w;ix++){const i=(iy*w+ix)*4;if(data[i]>=200&&data[i+1]>=200&&data[i+2]>=200){left=Math.min(left,ix);right=Math.max(right,ix);top=Math.min(top,iy);bottom=Math.max(bottom,iy);}}
   return {left:r.x+left/ratio,right:r.x+(right+1)/ratio,top:r.y+top/ratio,bottom:r.y+(bottom+1)/ratio,present:right>=left};};return {state:bounds(state),label:bounds(label)};
 },{state,label});
 for(const key of ['state','label']){assert.ok(ink[key].present,'Painted '+key);assert.ok(Math.abs((ink[key].top+ink[key].bottom)/2-(row.y+row.h/2))<=1,'Actual '+key+' ink vertically centered: '+JSON.stringify({ink:ink[key],row}));}
 assert.ok(Math.abs((ink.state.left+ink.state.right)/2-(state.x+state.w/2))<=1,'On/off text horizontally centered');
 assert.equal(await page.locator('[data-control="animation-toggle"]').getAttribute('aria-checked'),String(checked));report.alignment.push({width,language,checked,row,track,ink});
}
try{for(width of [320,390,1400])for(language of ['ja','en']){
 context=await browser.newContext({viewport:{width,height:width<700?844:1050},hasTouch:width<700,isMobile:width<700,deviceScaleFactor:1});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'inventory-all'),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(15000);await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&view=pixels&lang='+language);await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await paint();
 await tap('name');await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');await keypad(5,{insert:true});assert.equal(await page.locator('#name').inputValue(),'5','Numpad stays numeric in the name field');
 await tap('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText('17');await tap('new-game');await wait('command');text='';
 await check('right aligned display selector and centered shared switch in both states',async()=>{
  const previous=(await snapshot()).state.trace;await tap('settings-toggle');let s=await snapshot();const select=s.scene.controls.find(c=>c.id==='select-display-mode').fullRect,r=s.scene.regions.settings.rect;
  assert.ok(Math.abs(select.x+select.w-r.x-r.w)<.01,'Display selector ends at the settings right edge');assert.ok(select.x>=s.scene.controls.find(c=>c.id==='mobile-controls').fullRect.x+48+8);
  await centered(true);await shot('on');await tap('animation-toggle');await page.waitForFunction(()=>!__rogueBrowserTest.diagnostics.animationEnabled);await paint();await centered(false);await shot('off');
  await keypad(8);await keypad(8,{locked:false});assert.deepEqual((await snapshot()).state.trace,previous,'Settings and switch do not read C input or change RNG');
  await tap('animation-toggle');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.animationEnabled);await paint();await tap('settings-close');
 });
 if(width===320){await context.close();context=null;continue;}
 await check('eight keypad directions and center wait with NumLock on and off',async()=>{
  for(const locked of [true,false]){for(let digit=1;digit<=9;digit++)await move(digit,{locked});await reference();}
 });
 await check('Shift, Ctrl and repeated keypad events keep the original movement semantics',async()=>{
  for(const modifiers of [8,2]){for(const digit of [1,2,3,4,6,7,8,9,5])await move(digit,{modifiers});await reference();}
  for(let i=0;i<3;i++)await move(6,{repeat:i>0});await reference();
 });
 await check('number row still supplies a numeric count before keypad movement',async()=>{
  await press('2','2');await move(6);await reference();
 });
 await check('keypad chooses a throw direction, cancellation clears it, and the next input works',async()=>{
  await press('t','t');await wait('direction');await sent(()=>keypad(9,{locked:false,modifiers:8}));text+='u';await wait('item');await press('e','e');await wait('command');await reference();
  await press('t','t');await wait('direction');await press('Escape','\x1b');await wait('command');await move(4);await reference();
 });
 await check('keypad digits remain text while naming and work as movement after submission',async()=>{
  await press('c','c');await wait('item');await press('c','c');await wait('text');await tap('prompt-text');
  for(const digit of [1,2,3])await keypad(digit,{insert:true});assert.equal(await page.locator('#prompt-text').inputValue(),'123');
  await sent(()=>tap('submit-text'));text+='123\r';await wait('command');await move(5);await reference();
 });
 await context.close();context=null;
 }assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snapshot().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));}

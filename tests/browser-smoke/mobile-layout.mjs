import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-layout'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=process.env.ROGUE_TEST_BASE?null:createPreviewServer();
if(server)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.ROGUE_TEST_BASE||'http://127.0.0.1:'+server.address().port+'/';
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:runtime.downloadsPath});
const report={checks:[],screenshots:[],errors:[],base};
let page,context,cdp,mobile;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({generation:__rogueBrowserTest.generation,words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending,player:__rogueBrowserTest.frame.player}));
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
 const c=(await scene()).controls.find(c=>c.id===id),b=await page.locator('#rogue-canvas').boundingBox();
 assert.ok(c.rect.h>=Math.min(40,c.fullRect.h),'Visible control: '+id);
 if(mobile)await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);else await page.mouse.click(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);
 await paint();
}
async function settled(){await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame.ui.input.kind==='command');await paint();}
async function zoomSettled(){await page.waitForFunction(()=>Math.abs(__rogueBrowserTest.canvas.camera.size-__rogueBrowserTest.graphics.tileSize)<0.0001);await paint();}
async function reveal(id,region='settings'){
 for(let i=0;i<16;i++){
  const s=await scene(),c=s.controls.find(c=>c.id===id);if(c&&c.rect.h>=Math.min(48,c.fullRect.h))return;
  const r=s.regions[region].rect,b=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(b.x+r.x+r.w/2,b.y+r.y+r.h/2);await page.mouse.wheel(0,180);await paint();
 }
 throw Error('Unable to reveal '+id);
}
async function shot(name){const file=name+'.png';await page.screenshot({path:path.join(output,file)});report.screenshots.push(file);}
let resumed=!process.env.ROGUE_LAYOUT_FROM;
async function check(name,fn){
 if(!resumed){if(!name.includes(process.env.ROGUE_LAYOUT_FROM))return;resumed=true;}
 await fn();report.checks.push(name);console.log('PASS '+name);
}
async function settings(){if((await scene()).scope!=='settings')await tap('settings-toggle');}
async function mode(value){await settings();await tap('select-display-mode');await tap('select-display-mode-'+value);await tap('settings-close');await paint();}
async function fileImport(files){const chooser=page.waitForEvent('filechooser');await tap('import-save');await(await chooser).setFiles(files);await page.waitForFunction(()=>!document.querySelector('input[type=file]')&&!__rogueBrowserTest.diagnostics.starting);await paint();}
async function windowCancel(key=27){
 const controls=(await scene()).controls;
 const c=controls.find(c=>c.id==='window-'+key||c.key===key||c.key===String.fromCharCode(key)||key===27&&c.key==='Escape')
  ||(key===27&&controls.find(c=>c.id==='window-32'||c.id==='window-13'));
 assert.ok(c,'Onscreen cancel key '+key);await tap(c.id);await settled();
}
function settingsLayout(s){
 const ids=['settings-close','fullscreen','mobile-controls','select-display-mode','save','download-save','import-save','settings-top','mobile-system-81','mobile-system-111'];
 assert.deepEqual(s.controls.map(c=>c.id),ids);
 const by=id=>s.controls.find(c=>c.id===id).fullRect;
 assert.equal(by('fullscreen').y,by('mobile-controls').y);assert.equal(by('fullscreen').y,by('select-display-mode').y);
 assert.ok(by('fullscreen').x<by('mobile-controls').x&&by('mobile-controls').x<by('select-display-mode').x);
 assert.equal(by('save').y,by('download-save').y);assert.ok(by('save').x<by('download-save').x);
 assert.ok(by('import-save').y>by('save').y);assert.equal(by('settings-top').y,by('mobile-system-81').y);
 for(const [a,b] of [['fullscreen','save'],['import-save','settings-top'],['settings-top','mobile-system-111']])assert.ok(by(b).y-by(a).y-by(a).h>=36);
 assert.ok(!s.text.some(t=>t.includes('迷宮に入りました')||t.includes('画面を書き直す')||t.includes('直前のメッセージ')));
 for(const id of ['fullscreen','mobile-controls'])assert.ok(!s.text.includes(s.controls.find(c=>c.id===id).label),'icon only: '+id);
}
try{
 for(mobile of process.env.ROGUE_LAYOUT_DEVICE==='pc'?[false]:[true,false]){
  context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,ignoreHTTPSErrors:true,acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(error.message));cdp=await context.newCDPSession(page);await installBrowserTestAdapter(page);
  await page.goto(base+'?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText('123');await tap('new-game');await settled();
  await check((mobile?'phone':'pc')+' shared settings rows, icon buttons and actions',async()=>{
   const before=await state();await settings();settingsLayout(await scene());await shot(mobile?'phone-settings':'pc-settings');
   await tap('fullscreen');await page.waitForFunction(()=>!!document.fullscreenElement);await tap('fullscreen');await page.waitForFunction(()=>!document.fullscreenElement);await tap('settings-close');
   const hadControls=(await scene()).controls.some(c=>c.id==='touch-j');await settings();await tap('mobile-controls');assert.equal((await scene()).controls.some(c=>c.id==='touch-j'),!hadControls);await settings();await tap('mobile-controls');assert.equal((await scene()).controls.some(c=>c.id==='touch-j'),hadControls);assert.deepEqual(await state(),before);
  });
  if(mobile){
   await check('phone status overlays map, message below map, all status rows and modal isolation',async()=>{
    let s=await scene();assert.deepEqual(s.hud.metrics,['depth','hp','strength','hunger','level','experience','armor','gold']);assert.equal(s.hud.row.y,s.controls.find(c=>c.id==='settings-toggle').rect.y);assert.ok(s.controls.find(c=>c.id==='history-open').rect.y>=s.mapRect.y+s.mapRect.h);await shot('phone-game');
    const before=await state();await tap('status-open');s=await scene();assert.equal(s.scope,'status');
    for(const text of ['名前','階層','所持金','HP','腕力','防御','レベル','経験値','空腹度','満腹','12 / 12','16 / 16'])assert.ok(s.text.includes(text),text);
    for(const icon of ['person','stairs','coins','heart','strength','shield','level','experience','food'])assert.ok(s.icons.some(i=>i.name===icon),icon);
    await shot('phone-status');await page.keyboard.press('j');assert.deepEqual(await state(),before);await tap('status-close');assert.deepEqual(await state(),before);
    await tap('history-open');assert.equal((await scene()).scope,'history');await tap('history-close');assert.deepEqual(await state(),before);
    await page.keyboard.press('@');await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,before.input);assert.equal((await scene()).scope,'status');
    // Original @ writes a status message to the C terminal (word 16 is its hash).
    const after=await state();assert.deepEqual(after.words.slice(0,16),before.words.slice(0,16));assert.deepEqual(after.words.slice(17),before.words.slice(17));await tap('status-close');
   });
  }
  for(const display of mobile?['ascii','tiles','pixels']:['ascii']){
   await check((mobile?'phone':'pc')+' '+display+' continuous wheel/pinch and common square cells',async()=>{
    await mode(display);const before=await state(),s=await scene(),start=s.camera.size,b=await page.locator('#rogue-canvas').boundingBox();assert.equal(s.camera.cellH,start);
    await page.mouse.move(b.x+s.mapRect.w/2,b.y+s.mapRect.y+s.mapRect.h/2);await page.mouse.wheel(0,-20);
    const samples=await page.evaluate(()=>new Promise(resolve=>{const sizes=[];const sample=()=>{sizes.push(__rogueBrowserTest.canvas.camera.size);if(sizes.length===18)resolve(sizes);else requestAnimationFrame(sample);};requestAnimationFrame(sample);}));
    await zoomSettled();assert.ok(new Set(samples.map(v=>v.toFixed(5))).size>=4,'animated wheel intermediates');assert.ok(samples.every((v,i)=>i===0||v>=samples[i-1]-0.001));assert.ok(Math.abs((await scene()).camera.size-start*Math.exp(.04))<0.001);
    if(mobile){
     const scale=(await scene()).camera.size,y=b.y+s.mapRect.y+s.mapRect.h/2,cx=b.x+s.mapRect.w/2;
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-50,y,id:1},{x:cx+50,y,id:2}]});
     const sizes=[];for(const distance of [103,108,113,119,123]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-distance/2,y,id:1},{x:cx+distance/2,y,id:2}]});await paint();sizes.push((await scene()).camera.size);}
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();assert.equal(new Set(sizes).size,5);assert.ok(Math.abs(sizes.at(-1)-scale*1.23)<0.001);
    }
    assert.equal((await scene()).camera.size,(await scene()).camera.cellH);assert.deepEqual(await state(),before);report.checks.push({display,wheelSamples:samples});
   });
  }
  if(mobile){
   await check('phone full-map single-line legend and item wording',async()=>{
    const before=await state();await tap('mobile-full-map');const runs=await page.evaluate(()=>__rogueBrowserTest.commands.filter(c=>c.op==='text'&&['自分','階段','敵','アイテム'].includes(c.text)));assert.equal(runs.length,4);assert.equal(new Set(runs.map(r=>r.y)).size,1);await shot('phone-full-map');assert.deepEqual(await state(),before);await tap('mobile-full-map');
    await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window?.kind==='menu');assert.ok(!(await scene()).text.some(t=>t.includes('品物')));await shot('phone-inventory');await windowCancel();
   });
   await check('settings save/export and validated in-game import',async()=>{
    await settings();await tap('save');await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);await settled();const saved=await state();
    const downloadPromise=page.waitForEvent('download');await tap('download-save');const download=await downloadPromise;const file=path.join(output,'mobile-layout-save.json');await download.saveAs(file);
    const before=await state();await fileImport({name:'other.json',mimeType:'application/json',buffer:Buffer.from('{"hello":"world"}')});assert.deepEqual(await state(),before);assert.ok((await scene()).text.includes('無効なセーブファイルです。'));await shot('phone-invalid-file');await fileImport([]);assert.deepEqual(await state(),before);
    await tap('settings-close');await tap('touch-j');await settled();await settings();await fileImport(file);await settled();assert.ok((await state()).generation>saved.generation);assert.deepEqual((await state()).words,saved.words);await tap('touch-.');await settled();
   });
   await check('original settings and end-adventure confirmation retain onscreen cancellation',async()=>{
    await settings();await tap('mobile-system-111');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.mode==='options');await tap('window-27');await page.waitForFunction(()=>__rogueBrowserTest.canvas.controls.some(c=>c.id==='window-32'));await tap('window-32');await settled();
    const before=await state();await settings();await tap('mobile-system-81');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='confirm');await windowCancel(110);assert.deepEqual((await state()).player,before.player);
   });
   await check('320px phone settings/status/map layout remains usable',async()=>{
    await page.setViewportSize({width:320,height:568});await paint();await shot('phone-320-game');await tap('status-open');await shot('phone-320-status');await tap('status-close');await settings();settingsLayout(await scene());await shot('phone-320-settings');await reveal('settings-top');await tap('settings-top');assert.ok((await scene()).controls.some(c=>c.id==='new-game'));await page.setViewportSize({width:390,height:844});
   });
  }else{
   await check('pc @ opens complete status window and Escape closes it',async()=>{await page.keyboard.press('@');await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='status');await shot('pc-status');await page.keyboard.press('Escape');await settled();assert.equal((await scene()).scope,'game');});
   await check('fractional zoom preference survives reload',async()=>{
    const s=await scene(),b=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(b.x+s.mapRect.w/2,b.y+s.mapRect.y+s.mapRect.h/2);await page.mouse.wheel(0,-37);await zoomSettled();
    const preference=await page.evaluate(()=>JSON.parse(localStorage.getItem('rogue-map-display-v1')));assert.ok(preference.zoom%1!==0);
    await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.tileSize),preference.zoom);
    await tap('new-game');await settled();assert.equal((await scene()).camera.size,preference.zoom);
   });
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();if(server)await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

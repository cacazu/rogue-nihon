import {fixtureWorker} from "./fixture-worker.mjs";
import {loadPlaywright, browserExecutable} from '../../tools/toolchain.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-hud-hold'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
if(process.env.ROGUE_HUD_DEVICE==='pc'){const previous=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));report.checks.push(...previous.checks);report.screenshots.push(...previous.screenshots);}
let page,context,cdp,mobile;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,player:__rogueBrowserTest.frame.player,pending:__rogueBrowserTest.queuePending}));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function point(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);const b=await page.locator('#rogue-canvas').boundingBox();return {x:b.x+c.rect.x+c.rect.w/2,y:b.y+c.rect.y+c.rect.h/2};}
async function tap(id){const p=await point(id);if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);await paint();}
async function down(id){const p=await point(id);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});return p;}
async function up(type='touchEnd'){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[]});await idle();}
async function stopped(){const before=await state();await page.waitForTimeout(450);await idle();assert.deepEqual(await state(),before);}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function presentation(level,experience){
 await page.evaluate(({level,experience})=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args[7].value=level;ui.status.args[8].value=experience;__hudPresentation(ui);},{level,experience});await paint();
}
try{
 for(mobile of process.env.ROGUE_HUD_DEVICE==='pc'?[false]:[true,false]){
  context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
  await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,"inventory-all"),contentType:'text/javascript',headers}));
  await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);
  // Change only the published presentation to exercise XP boundaries, never C state.
  await page.addInitScript(()=>{const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__hudPresentation=ui=>handler({data:{type:'presentation',ui}});}};});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await idle();
  await check((mobile?'phone':'pc')+' hunger wording is 満腹',async()=>{
   if(mobile){assert.ok((await scene()).text.includes('満腹'));assert.equal((await scene()).controls.find(c=>c.id==='touch-.').label,'待機');}assert.ok(!(await scene()).text.some(t=>t.includes('空腹なし')));
   await tap(mobile?'status-open':'hud-hunger');
   assert.ok((await scene()).text.some(t=>t.includes('満腹')));if(mobile)await tap('status-close');else{await shot('pc-hunger');await page.keyboard.press('Escape');}await paint();
  });
  if(mobile){
   await check('phone two rows match settings height at 390px and 320px',async()=>{
    for(const width of [390,320]){await page.setViewportSize({width,height:844});await paint();const s=await scene(),settings=s.controls.find(c=>c.id==='settings-toggle').rect;
     assert.deepEqual(s.hud.metrics,['depth','hp','strength','hunger','level','experience','armor','gold']);assert.equal(s.hud.row.y,settings.y);assert.equal(s.hud.row.h,settings.h);assert.equal(s.hud.rows.length,2);assert.equal(s.hud.rows[0].h+s.hud.rows[1].h,48);
     assert.ok(Math.abs(s.hud.experience.rect.x+s.hud.experience.rect.w+4-s.hud.items.strength.rect.x)<.001);assert.ok(s.hud.row.x+s.hud.row.w<=settings.x);await shot('phone-'+width+'-hud');
    }await page.setViewportSize({width:390,height:844});await paint();
   });
   await check('phone XP gauge follows original thresholds and resets on level up',async()=>{
    for(const [level,xp,progress,previous,next]of [[1,0,0,0,10],[1,5,.5,0,10],[1,9,.9,0,10],[2,10,0,10,20],[2,15,.5,10,20],[8,970,.5,640,1300],[21,8000000,1,8000000,null]]){
     await presentation(level,xp);const e=(await scene()).hud.experience;assert.equal(e.progress,progress);assert.equal(e.previous,previous);assert.equal(e.next,next);if(xp===5)await shot('phone-xp-half');
    }await presentation(1,0);
   });
   await check('phone short tap moves or waits once',async()=>{
    let before=await state();await tap('touch-l');await idle();assert.equal((await state()).player.x,before.player.x+1);assert.equal((await state()).input,before.input+1);await stopped();
    before=await state();await tap('touch-.');await idle();assert.deepEqual((await state()).player,before.player);assert.equal((await state()).input,before.input+1);await stopped();
   });
   await check('phone long press repeats movement and stops on release',async()=>{
    const before=await state();await down('touch-l');await page.waitForFunction(x=>__rogueBrowserTest.frame.player.x>=x+4,before.player.x);await up();assert.ok((await state()).input>=before.input+4);await stopped();
   });
   await check('phone long press repeats waiting and stops on release',async()=>{
    const before=await state();await down('touch-.');await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>=n+4,before.input);await up();assert.deepEqual((await state()).player,before.player);await stopped();
   });
   await check('phone hold stops when finger moves or touch is cancelled',async()=>{
    const before=await state(),p=await down('touch-.');await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+35,y:p.y,id:1}]});await idle();await stopped();await up();assert.equal((await state()).input,before.input+1);
    await down('touch-.');await up('touchCancel');await stopped();
   });
   await check('phone opening status or a game window stops a held command',async()=>{
    await down('touch-.');await idle();await page.keyboard.press('@');await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='status');await stopped();await up();await tap('status-close');await idle();
    await down('touch-.');await idle();await page.keyboard.press('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();const before=await state();await page.waitForTimeout(450);assert.deepEqual(await state(),before);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await tap('window-32');await idle();
   });
   await check('phone direction selection stays a single action on a long press',async()=>{
    await page.keyboard.press('t');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.movement_direction===true);await paint();await down('touch-l');const before=await state();await page.waitForTimeout(500);assert.deepEqual(await state(),before);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='item');await paint();await tap('window-27');await idle();
   });
  }else{
   await check('pc direction pad keeps one command on mouse release',async()=>{
    await tap('settings-toggle');await tap('mobile-controls');const p=await point('touch-.');const before=await state();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(500);assert.deepEqual(await state(),before);await page.mouse.up();await idle();assert.equal((await state()).input,before.input+1);await stopped();await shot('pc-hud');
   });
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

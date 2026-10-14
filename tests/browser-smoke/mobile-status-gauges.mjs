import {loadPlaywright, browserExecutable} from '../../tools/toolchain.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-status-gauges'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);
const report={checks:[],screenshots:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
// Exercise only public status packets; the original game state is untouched.
await page.addInitScript(()=>{const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__statusPacket=ui=>handler({data:{type:'presentation',ui}});}};});
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending,words:__rogueBrowserTest.trace.words}));
async function status(values){await page.evaluate(values=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);for(const [index,value]of Object.entries(values))ui.status.args[Number(index)].value=value;__statusPacket(ui);},values);await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);const b=await page.locator('#rogue-canvas').boundingBox();await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
function geometry(s){
 const h=s.hud,settings=s.controls.find(c=>c.id==='settings-toggle').rect;
 assert.equal(h.row.y,settings.y);assert.equal(h.row.h,settings.h);assert.equal(h.rows.length,2);
 assert.equal(h.hp.rect.x,h.experience.rect.x);assert.equal(h.hp.rect.w,h.experience.rect.w);assert.equal(h.hp.rect.y+24,h.experience.rect.y);
 assert.equal(h.items.strength.rect.y,h.rows[0].y);assert.equal(h.items.armor.rect.y,h.rows[1].y);
 for(const a of ['iconRect','textRect','rect']){assert.equal(h.items.armor[a].x,h.items.strength[a].x);assert.equal(h.items.hunger[a].x,h.items.gold[a].x);}
 assert.ok(Math.abs(h.experience.rect.x+h.experience.rect.w+4-h.items.strength.rect.x)<.001);
 assert.ok(h.items.depth.rect.x+h.items.depth.rect.w<h.hp.rect.x);assert.ok(h.items.gold.rect.x+h.items.gold.rect.w<=h.row.x+h.row.w+0.01);assert.equal(h.maxScroll,0);
 assert.equal(h.experience.label.text, String(h.experience.next===10?1:2));
}
async function fill(gauge,progress){
 const commands=await page.evaluate(()=>__rogueBrowserTest.commands),r=gauge.rect;
 const track=commands.find(c=>c.op==='box'&&c.rect.x===r.x&&c.rect.y===r.y&&c.rect.w===r.w&&c.rect.h===r.h);assert.ok(track);
 const active=commands.find(c=>c.op==='box'&&c.rect.x===r.x+1&&c.rect.y===r.y+1&&c.rect.h===r.h-2);
 if(progress===0)assert.equal(active,undefined);else{assert.ok(active);assert.ok(Math.abs(active.rect.w-(r.w-2)*progress)<.001);}
}
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame.ui.input.kind==='command');await paint();
 const before=await state();
 await check('390px and 320px align both rows, equal gauges and the right columns',async()=>{
  await status({0:1,1:0,2:6,3:12,4:16,5:16,6:4,7:1,8:5,9:'status.hunger.0'});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await paint();geometry(await scene());await shot('phone-'+width+'-status');}
 });
 await check('icons sit beside the gauges; HP and level numbers overlay them',async()=>{
  const h=(await scene()).hud;assert.equal(h.hp.label.text,'6/12');assert.equal(h.experience.label.text,'1');
  for(const g of [h.hp,h.experience]){assert.equal(g.label.iconRect.x+g.label.iconRect.w,g.rect.x-2);assert.ok(g.label.textRect.x>=g.rect.x);assert.ok(g.label.textRect.x+g.label.textRect.w<=g.rect.x+g.rect.w);assert.ok(g.label.textRect.y>=g.rect.y-4);}
  assert.equal(h.hp.label.iconRect.x,h.experience.label.iconRect.x);
  const texts=await page.evaluate(r=>__rogueBrowserTest.commands.filter(c=>c.op==='text'&&c.x>=r.x&&c.x<r.x+r.w&&c.y>=r.y-4&&c.y<=r.y+r.h+4).map(c=>c.text),h.experience.rect);assert.deepEqual(texts,['1']);
  const blank=await page.evaluate(h=>__rogueBrowserTest.commands.filter(c=>c.op==='text'&&c.x>=h.items.depth.rect.x&&c.x<h.items.depth.rect.x+h.items.depth.rect.w&&c.y>=h.rows[1].y&&c.y<h.rows[1].y+h.rows[1].h),h);assert.deepEqual(blank,[]);
 });
 await check('strength always shows only its current value, above armor',async()=>{
  await status({4:16,5:20});let h=(await scene()).hud;assert.equal(h.items.strength.text,'16');assert.equal(h.items.strength.rect.y,h.rows[0].y);assert.equal(h.items.armor.rect.y,h.rows[1].y);
  await status({4:14});h=(await scene()).hud;assert.equal(h.items.strength.text,'14');geometry(await scene());await shot('phone-320-current-strength');
 });
 await check('HP and XP correctly draw empty, half and full progress',async()=>{
  for(const [hp,xp,p]of [[0,0,0],[6,5,.5],[12,10,1]]){await status({2:hp,3:12,7:1,8:xp});const h=(await scene()).hud;assert.equal(h.hp.progress,p);assert.equal(h.experience.progress,p);await fill(h.hp,p);await fill(h.experience,p);}
  await status({2:12,7:2,8:10});const h=(await scene()).hud;assert.equal(h.hp.progress,1);assert.equal(h.experience.progress,0);assert.equal(h.experience.label.text,'2');await fill(h.experience,0);
 });
 await check('changing armor, hunger and money keeps matching column starts',async()=>{
  await status({0:20,1:5000,2:12,3:12,4:18,5:22,6:-2,7:2,8:15,9:'status.hunger.1'});geometry(await scene());assert.equal((await scene()).hud.items.gold.text,'5k');assert.equal((await scene()).hud.items.strength.text,'18');await shot('phone-320-changed-status');
 });
 await check('status area opens full values and closes without game input',async()=>{
  assert.deepEqual(await state(),before);await tap('status-open');const s=await scene();assert.equal(s.scope,'status');assert.ok(s.text.includes('12 / 12'));assert.ok(s.text.includes('18 / 22'));assert.ok(s.text.includes('5000'));await tap('status-close');assert.deepEqual(await state(),before);geometry(await scene());
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene();await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

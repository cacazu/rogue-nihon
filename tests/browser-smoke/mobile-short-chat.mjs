import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-short-chat'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:runtime.downloadsPath});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);
const report={checks:[],screenshots:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
// Feed public messages and status through the existing Worker presentation path.
await page.addInitScript(()=>{const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__shortChatPacket=data=>handler({data});}};});
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending,words:__rogueBrowserTest.trace.words}));
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);const b=await page.locator('#rogue-canvas').boundingBox();await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();}
async function message(text){await page.evaluate(text=>__shortChatPacket({type:'message',id:'ui.text',args:[{kind:'string',value:text}],text}),text);await paint();}
const shortLines=()=>page.evaluate(()=>{const r=__rogueBrowserTest.canvas.controls.find(c=>c.id==='history-open').rect;return __rogueBrowserTest.commands.filter(c=>c.op==='text'&&c.y>=r.y&&c.y<r.y+r.h).map(c=>c.text);});
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.frame.ui.input.kind==='command');await paint();
 const before=await state();
 await check('experience gauge overlays only the level and still fills',async()=>{
  for(const xp of [0,5]){await page.evaluate(xp=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args[7].value=1;ui.status.args[8].value=xp;__shortChatPacket({type:'presentation',ui});},xp);await paint();
   const s=await scene(),r=s.hud.experience.rect;assert.equal(s.hud.experience.progress,xp/10);
   const texts=await page.evaluate(r=>__rogueBrowserTest.commands.filter(c=>c.op==='text'&&c.x>=r.x&&c.x<r.x+r.w&&c.y>=r.y-4&&c.y<=r.y+r.h+4).map(c=>c.text),r);assert.deepEqual(texts,['1']);
  }
 });
 await check('short messages show the latest two lines in chronological order',async()=>{
  await message('古いメッセージ');await message('一つ目のメッセージ');await message('二つ目のメッセージ');assert.deepEqual(await shortLines(),['一つ目のメッセージ','二つ目のメッセージ']);await shot('phone-two-messages');
 });
 await check('blank messages do not replace the two displayed lines',async()=>{
  await message('');await message(' \n ');assert.deepEqual(await shortLines(),['一つ目のメッセージ','二つ目のメッセージ']);
 });
 await check('explicit line breaks keep only the last two lines',async()=>{
  await message('先頭の行\n途中の行\n最後の行');assert.deepEqual(await shortLines(),['途中の行','最後の行']);
 });
 await check('long messages wrap to at most two visible lines at 390px and 320px',async()=>{
  await message('長いメッセージ'.repeat(12)+'終端');
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await paint();const lines=await shortLines();assert.equal(lines.length,2);assert.ok(lines.at(-1).endsWith('終端'));await shot('phone-'+width+'-wrapped');}
 });
 await check('the short message area still opens full history without game input',async()=>{
  assert.deepEqual(await state(),before);await tap('history-open');assert.ok((await scene()).controls.some(c=>c.id==='history-close'));assert.deepEqual(await state(),before);await tap('history-close');assert.equal((await shortLines()).length,2);assert.deepEqual(await state(),before);
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../web/server.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/ending-screens'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)('C:/Users/kit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const evidence={checks:[],errors:[],video:false};
let context,page;
try{
 for(const mobile of [false,true])for(const language of ['ja','en'])for(const fixture of ['ending-victory','ending-death','ending-no-tomb']){
  await context?.close();context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1050},isMobile:mobile,hasTouch:mobile});
  await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));
  await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>evidence.errors.push(e.message));
  const state=()=>page.evaluate(()=>({ui:__rogueBrowserTest.frame?.ui,running:__rogueBrowserTest.running,input:__rogueBrowserTest.inputRequestCount,diagnostics:__rogueBrowserTest.diagnostics}));
  const draw=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  async function click(id){await draw();const c=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id&&!c.disabled),id);assert.ok(c,id);const x=c.rect.x+c.rect.w/2,y=c.rect.y+c.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await draw();}
  async function field(id,value){await click(id);await page.keyboard.press('Control+a');await page.keyboard.insertText(value);}
  const actions=[];
  async function next(id){const n=(await state()).input;await click(id);await page.waitForFunction(n=>!__rogueBrowserTest.queuePending&&(__rogueBrowserTest.inputRequestCount>n||!__rogueBrowserTest.running),n);await draw();const s=await state();actions.push({control:id,input:s.ui.input,scopes:[...new Set(s.ui.lines.map(l=>l.scope))],lines:s.ui.lines.map(l=>l.text)});return s;}
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&view=pixels&lang='+language);
  await page.waitForFunction(()=>window.__rogueBrowserTest?.canvas.paintCount>0);
  await field('seed','17');await field('name','EndingCheck');await click('new-game');
  await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window&&__rogueBrowserTest.inputRequestCount>0&&!__rogueBrowserTest.queuePending);
  const label=(mobile?'mobile':'desktop')+'-'+language+'-'+fixture;
  await page.screenshot({path:path.join(output,label+'-initial.png')});
  if(fixture==='ending-victory'){
   assert.ok((await state()).ui.lines.some(l=>l.id==='ui.ending.victory_title'));
   const loot=await next('window-32');assert.ok(loot.ui.lines.some(l=>l.id==='ui.ending.loot_columns'));
   await page.screenshot({path:path.join(output,label+'-loot.png')});
  }
  const score=await next('window-13');
  assert.ok(score.ui.lines.some(l=>l.id==='ui.score.heading'));
  assert.ok(score.ui.lines.some(l=>l.id==='ui.score.entry'||l.id==='ui.score.entry_death'));
  assert.ok(score.ui.lines.every(l=>l.scope==='score'||l.scope==='death'&&l.id==='ui.ending.return'),'score replaces old ending/valuation content and retains the final acknowledgement');
  await page.screenshot({path:path.join(output,label+'-score.png')});
  if(fixture!=='ending-victory')await next('window-13');
  const final=await state();assert.equal(final.running,false);assert.equal(final.diagnostics.exitCode,fixture==='ending-victory'?2:1);
  assert.equal(final.diagnostics.runtimeError,null);assert.deepEqual(final.diagnostics.translationFallbacks,[]);assert.deepEqual(final.diagnostics.uiMissing,[]);
  await click('result-top');assert.equal(await page.evaluate(()=>__rogueBrowserTest.topOpen),true);
  evidence.checks.push({label,actions,outcome:final.diagnostics.outcome,exit:final.diagnostics.exitCode,returnedToTop:true});console.log('PASS '+label);
 }
 assert.deepEqual(evidence.errors,[]);evidence.result='pass';
}catch(error){evidence.result='fail';evidence.failure=error.stack;await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));}

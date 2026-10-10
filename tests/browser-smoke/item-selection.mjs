import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createPreviewServer} from '../../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=artifactDirectory(path.join(root,'tests/browser-smoke/output/item-selection'));await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const evidence={started_at:new Date().toISOString(),checks:[],errors:[],operations:[],screenshots:[]};let browser,context,page;
async function snap(){return page.evaluate(()=>({ui:__rogueBrowserTest.frame.ui,game:__rogueBrowserTest.trace.words.slice(1,16),input:__rogueBrowserTest.inputRequestCount}));}
async function start(locale='ja',mobile=false,fixture=''){
 await context?.close();context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1240,height:900}});
 if(fixture){const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};const source=worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",');await context.route('**/web/worker.js',r=>r.fulfill({body:source,contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();await installBrowserTestAdapter(page);page.on('pageerror',e=>evidence.errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+locale+'&view=pixels');await page.locator('#seed').fill('17');await page.locator('#new-game').click();await page.waitForFunction(()=>window.__rogueBrowserTest?.trace&&__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.queuePending===0);await page.locator('#board').focus();
}
async function key(value){const n=(await snap()).input;await page.keyboard.press(value);await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,n);}
async function action(value){const n=(await snap()).input;await page.locator('[data-window-key="'+value+'"]').click();await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,n);}
async function choose(value){const n=(await snap()).input;await page.locator('[data-selection-key="'+value+'"]').click();await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,n);}
async function closed(){await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);}
async function cleanChoice(){const state=await snap();assert.equal(state.ui.input.kind,'item');assert.deepEqual(state.ui.window.actions.map(a=>a.key),[27]);assert.equal(await page.locator('[data-window-key="42"]').count(),0);assert.doesNotMatch(await page.locator('#more-prompt').innerText(),/\*/);return state;}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});evidence.screenshots.push(name+'.png');}
try{
 browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--disable-gpu']});
 for(const [locale,mobile] of [['ja',false],['en',true]]){
  await start(locale,mobile);
  for(const command of ['q','w','r','e','W','P','d','c','t','z','I']){
   const before=await snap();await key(command);const direction=(await snap()).ui.input.kind==='direction';if(direction)await action(107);const selection=await cleanChoice();assert.deepEqual(selection.game,before.game);evidence.operations.push({locale,mobile,command,directionFirst:direction,keys:selection.ui.lines.filter(l=>l.scope==='choices').map(l=>l.key)});if(command==='w')await shot('choice-'+locale);await action(27);await closed();assert.deepEqual((await snap()).game,before.game);
  }
  await key('i');assert.equal((await snap()).ui.mode,'menu');assert.ok((await snap()).ui.lines.some(l=>l.id==='ui.inventory.entry'));await action(32);await closed();
  const before=await snap();await key('w');await cleanChoice();await key('*');assert.equal((await snap()).ui.mode,'menu');await action(32);await cleanChoice();await action(27);await closed();assert.deepEqual((await snap()).game,before.game);
  await key('?');assert.equal(await page.locator('[data-window-key="42"]').count(),1);await action(42);await action(32);await closed();
  await key('D');assert.equal(await page.locator('[data-window-key="42"]').count(),1);await action(27);await closed();
  evidence.checks.push(locale+': all 11 item-selection paths show candidates and Cancel only; i, keyboard * inventory, help and discovery controls remain available.');
 }
 await start('ja',false,'item-identify');await key('r');await cleanChoice();await choose('f');const selection=await cleanChoice();assert.ok(selection.ui.lines.some(l=>l.scope==='choices'&&l.key==='c'));await shot('identify-choice');await choose('c');await closed();assert.equal((await snap()).game[12],1);evidence.checks.push('Actual identification scroll consumes the scroll, shows weapon candidates without a redundant inventory button, and applies C identification after clicking a candidate.');
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.translationFallbacks),[]);
 evidence.files=await Promise.all(['rust/crates/display/src/game_window.rs','locales/ui-game-ja.json','locales/ui-game-en.json','logic/pack.c','logic/io.c','tests/game-fixtures.c','build/game.js','build/game.wasm','build/game-fixtures.js','build/game-fixtures.wasm'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')})));
 evidence.passed=true;console.log(JSON.stringify({passed:true,selectionChecks:evidence.operations.length,checks:evidence.checks}));
}catch(error){evidence.passed=false;evidence.failure=error.stack;if(page){evidence.diagnostics=await page.evaluate(()=>window.__rogueBrowserTest?.diagnostics).catch(()=>null);await shot('failure').catch(()=>{});}throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));await context?.close();await browser?.close();await new Promise(r=>server.close(r));}

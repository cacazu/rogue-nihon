import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';import path from 'node:path';import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../../../tools/server.mjs';
import { runGame } from '../run-game.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/session-rng'));await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const old=Object.fromEntries(['web/index.html','web/app.js','web/style.css','locales/ui-web-ja.json','locales/ui-web-en.json'].map(file=>['/'+file,execFileSync('git',['show','HEAD:rogue-nihon/'+file],{cwd:root,maxBuffer:10*1024*1024})]));old['/']=old['/web/index.html'];
const previousWasm=await readFile(path.join(output,'pre-conversation/game.wasm'));
const previousJavaScript=await readFile(path.join(output,'pre-conversation/game.js'));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const fixtureWorker=worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", "hallucination");\n    module.FS.writeFile("/locale.txt",');
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/';
const evidence={started_at:new Date().toISOString(),checks:[],errors:[],snapshots:[],screenshots:[]};let browser,context,page;
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
async function state(){return page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,queue:__rogueBrowserTest.queuePending}));}
async function settled(){await page.waitForFunction(()=>window.__rogueBrowserTest?.trace&&__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.queuePending===0);}
async function start(role='current',fixture=false){
 await context?.close();context=await browser.newContext({viewport:{width:1240,height:900}});
 if(role==='before')await context.route('**/*',route=>{const name=new URL(route.request().url()).pathname;if(name==='/build/game.js')return route.fulfill({body:previousJavaScript,contentType:'text/javascript',headers});if(name==='/build/game.wasm')return route.fulfill({body:previousWasm,contentType:'application/wasm',headers});if(old[name])return route.fulfill({body:old[name],contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html',headers});return route.continue();});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker,contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();await installBrowserTestAdapter(page);page.on('pageerror',e=>evidence.errors.push(e.message));
 await page.goto(base+'?trace=1&view=pixels');await page.locator('#seed').fill('17');await page.locator('#name').fill('Audit');await page.locator('#new-game').click();await settled();await page.locator('#board').focus();
}
async function key(value){const n=(await state()).input;await page.keyboard.press(value);await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,n);}
async function clickKey(value){const n=(await state()).input;await page.locator('[data-window-key="'+value+'"]').click();await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,n);}
async function item(value){const n=(await state()).input;await page.locator('[data-selection-key="'+value+'"]').click();await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,n);}
async function settings(){if(await page.locator('#settings-panel').isHidden())await page.locator('#settings-toggle').click();}
async function pureDisplay(label){
 const before=await state();await settings();
 for(const mode of ['ascii','tiles','pixels']){await page.locator('#display-mode').selectOption(mode);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.deepEqual(await state(),before,label+' display mode');}
 for(let index=0;index<4;index++){await page.locator('#tile-zoom').focus();await page.locator('#tile-zoom').press('Home');for(let n=0;n<index;n++)await page.locator('#tile-zoom').press('ArrowRight');assert.deepEqual(await state(),before,label+' zoom');}
 await page.locator('#center-map').click();await page.locator('#settings-close').click();
 await page.evaluate(()=>{for(let n=0;n<100;n++)__rogueBrowserTest.redraw();});assert.deepEqual(await state(),before,label+' 100 redraws');
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.deepEqual(await state(),before,label+' resize');
 await page.setViewportSize({width:1240,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.deepEqual(await state(),before,label+' restore viewport');
 evidence.checks.push(label+': display modes, 4 pixel zooms, centering, 100 redraws and mobile resize preserve all 20 C words, input count and queue.');
}
async function capture(label){const value=await state();evidence.snapshots.push({label,...value});return value;}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});evidence.screenshots.push(name+'.png');}
try {
 browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--disable-gpu']});
 const runs=[];
 for(const role of ['before','current']){
  await start(role);const states=[];states.push(await capture(role+'-start'));await pureDisplay(role+' normal');
  await key('i');states.push(await capture(role+'-inventory'));
  if(role==='current'){await shot('current-inventory');await clickKey(32);}else await key('Space');states.push(await capture(role+'-inventory-closed'));
  await key('w');states.push(await capture(role+'-wield'));if(role==='current')await item('d');else await key('d');states.push(await capture(role+'-wield-applied'));
  await key('q');states.push(await capture(role+'-quaff'));await key('*');states.push(await capture(role+'-empty-quaff-list'));
  runs.push({role,states});
 }
 assert.deepEqual(runs[0].states,runs[1].states,'before/current frontend and Wasm deliver the same C words and input count for equivalent actions');evidence.checks.push('Before-conversation HTML/JS/CSS/Wasm vs current: start, inventory, Close button, weapon choice and empty potion list agree in all 20 C words and input counts.');
 const closeStates=[];
 for(const method of ['Space','Enter','Escape','button']){
  await start('current',true);await pureDisplay('hallucination '+method);await key('i');await pureDisplay('hallucination open inventory '+method);if(method==='button')await clickKey(32);else await key(method);closeStates.push({method,state:await state()});if(method==='button')await shot('hallucination-closed');
 }
 for(const {method,state:value} of closeStates)assert.deepEqual(value,closeStates[0].state,'hallucination close '+method+' matches canonical Space');
 evidence.closeStates=closeStates;evidence.checks.push('Hallucination: Close button, Enter and Esc reach the exact same RNG/C state as Space; rendering the open dialog is pure.');
 const canonical=await runGame(path.join(root,'build/game-fixtures.js'),{fixture:'hallucination',seed:17,name:'Audit',locale:'ja',text:'i ',messagePaging:'log'});
 assert.deepEqual(closeStates[0].state.words,canonical.traces.at(-1).words,'browser dialog returns to actual canonical C/Rust read state');
 await start('current',true);const stages=[];stages.push(await capture('hall-quaff-before'));await key('q');stages.push(await capture('hall-quaff-selection'));assert.equal(await page.locator('[data-window-key="42"]').count(),0);await key('*');stages.push(await capture('hall-quaff-list'));
 const q=await runGame(path.join(root,'build/game-fixtures.js'),{fixture:'hallucination',seed:17,name:'Audit',locale:'ja',text:'q*',messagePaging:'log'});assert.deepEqual(stages.at(-1).words,q.traces.at(-1).words);
 assert.notEqual(stages[0].words[1],stages.at(-1).words[1]);assert.equal(stages[0].words[13],stages.at(-1).words[13]);evidence.checks.push('Hallucination empty potion list: observed RNG advance with no turn matches the canonical C key sequence.');await shot('hallucination-empty-potions');
 assert.deepEqual(evidence.errors,[]);evidence.result='pass';
 evidence.files=await Promise.all(['web/app.js','web/index.html','web/style.css','rust/crates/input/src/lib.rs','rust/src/lib.rs','rust/crates/display/src/game_window.rs','logic/pack.c','logic/io.c','build/game.js','build/game.wasm','build/game-fixtures.js','build/game-fixtures.wasm'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')})));
 console.log(JSON.stringify({result:'pass',checks:evidence.checks.length,closeStates:closeStates.map(({method,state:s})=>({method,rng:s.words[1],turn:s.words[13]}))}));
} catch(error){evidence.result='fail';evidence.failure=error.stack;if(page){evidence.diagnostics=await page.evaluate(()=>window.__rogueBrowserTest?.diagnostics).catch(()=>null);await shot('failure').catch(()=>{});}throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');await context?.close();await browser?.close();await new Promise(r=>server.close(r));}

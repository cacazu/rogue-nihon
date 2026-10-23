// Specific system failures stay beside the edited field; processing does not enter history.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/system-messages'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root),browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const removed=['notice.start','notice.entered','notice.restored','notice.top','notice.game_ended','notice.input_flush','save.browser','notice.loading','notice.restoring'];
const report={checks:[],errors:[]};let context,page,width,language;
const snapshot=()=>page.evaluate(()=>({state:__rogueBrowserTest.diagnostics,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function tap(id){await page.locator('[data-control="'+id+'"]:not([disabled])').click();await paint();}
async function field(id,value){await page.locator('#'+id).fill(value);await paint();}
async function error(id,messageId,prefix){
 await page.waitForFunction(({id,messageId})=>__rogueBrowserTest.diagnostics.fieldErrors[id]?.id===messageId,{id,messageId});await paint();
 const s=await snapshot(),control=s.scene.controls.find(c=>c.field===id),line=s.commands.find(t=>t.op==='text'&&t.text.startsWith(prefix));
 assert.ok(control,id+' field is visible');assert.ok(line,'Painted field error '+prefix);
 assert.ok(line.y>=control.fullRect.y+control.fullRect.h,'Error appears below its field');
 assert.ok(!s.state.entries.some(e=>e.id===messageId),'Input error is absent from history');
 assert.ok(!s.state.topNotice,'Input error is absent from global title notice');
}
async function clean(){const s=await snapshot();assert.ok(!s.state.entries.some(e=>removed.includes(e.id)));assert.ok(!s.state.messages.some(m=>m.id==='save.browser'));}
async function shot(name){await page.screenshot({path:path.join(output,width+'-'+language+'-'+name+'.png')});}
try{for(width of [320,390,1240])for(language of ['ja','en']){
 context=await browser.newContext({viewport:{width,height:844},isMobile:width<700,hasTouch:width<700});
 await installBrowserTestAdapter(context);
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'inventory-all'),contentType:'text/javascript',headers}));
 let release;
 const gate=new Promise(resolve=>release=resolve);
 await context.route('**/build/game.wasm',async r=>{await gate;await r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers});});
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&view=pixels&lang='+language);
 await page.locator('[data-control="new-game"]:not([disabled])').waitFor();await paint();await clean();
 assert.equal((await snapshot()).state.entries.length,0,'No startup instructions');
 await field('seed','-1');await tap('new-game');await error('seed','error.seed',language==='ja'?'シードは':'Seed must');await shot('seed-error');
 await field('seed','17');assert.equal((await snapshot()).state.fieldErrors.seed,null);
 await field('name','勇'.repeat(17));await tap('new-game');await error('name','error.name',language==='ja'?'名前が長':'The name is too');
 await field('name','勇\u0085');await tap('new-game');await error('name','error.name_characters',language==='ja'?'名前に使':'The name contains');await shot('name-characters');
 await field('name','');await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.loading);await paint();
 assert.ok((await snapshot()).scene.text.some(t=>t=== (language==='ja'?'読み込み中…':'Loading…')));await clean();release();
 await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&!__rogueBrowserTest.queuePending);await paint();await clean();
 assert.equal((await snapshot()).state.loading,false);
 await page.locator('#rogue-canvas').focus();await page.keyboard.press('?');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='help');
 await page.keyboard.press('S');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&!__rogueBrowserTest.queuePending);await paint();await clean();
 assert.ok(!(await snapshot()).state.entries.some(e=>e.message?.args?.some(a=>a.kind==='term'&&a.value==='help.save')));
 await page.keyboard.press('?');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='help');
 await page.keyboard.press('*');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.mode==='help');await paint();
 assert.ok(!(await snapshot()).state.presentation.lines.some(line=>line.id==='ui.help.entry'&&line.args?.[1]?.value==='help.save'));
 assert.ok(!(await page.locator('#rogue-observation').textContent()).includes('help.save'));
 await page.keyboard.press('Space');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command');
 await page.locator('#rogue-canvas').focus();await page.keyboard.press('c');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='item');
 await page.keyboard.press('c');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='text');await paint();
 const before=(await snapshot()).state.trace;
 await field('prompt-text','勇'.repeat(17));await tap('submit-text');await error('prompt-text','error.prompt_text',language==='ja'?'文字が多':'The text is too');await shot('prompt-length');
 await tap('settings-toggle');await tap('settings-top');assert.equal((await snapshot()).state.settingsOpen,false);await error('prompt-text','error.prompt_text',language==='ja'?'文字が多':'The text is too');
 await field('prompt-text','勇\u0085');await tap('submit-text');await error('prompt-text','error.prompt_text_characters',language==='ja'?'使えない':'The text contains');
 assert.deepEqual((await snapshot()).state.trace,before,'Invalid edits do not consume C input or RNG');
 await page.evaluate(()=>__rogueUiAdapter.dispatchRequest({type:'api',operation:'queue',ok:false,after:'submit'}));await paint();
 await error('prompt-text','error.queue_full',language==='ja'?'少し待っ':'Wait a moment');
 await field('prompt-text','勇者😀');assert.equal((await snapshot()).state.fieldErrors['prompt-text'],null);
 await tap('submit-text');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&!__rogueBrowserTest.queuePending);await paint();
 await page.evaluate(()=>__rogueUiAdapter.dispatchRequest({type:'worker',generation:__rogueBrowserTest.generation,data:{type:'message',id:'save.browser',text:'Old save guidance'}}));await paint();await clean();
 await shot('game');report.checks.push({width,language});console.log('PASS system messages '+width+' '+language);
 await context.close();context=null;
}assert.deepEqual(report.errors,[]);report.result='pass';
}catch(e){report.result='fail';report.failure=e.stack;report.last=await snapshot().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));}

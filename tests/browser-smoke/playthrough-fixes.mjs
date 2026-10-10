import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../web/server.mjs';
import {runGame} from '../run-game.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const executablePath=process.env.ROGUE_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browserName=executablePath.toLowerCase().includes('brave')?'brave':'chrome';
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/playthrough-fixes',browserName));
const baseline=path.join(root,'build/playthrough-before.js');
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/',worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const evidence={started:new Date().toISOString(),executablePath,checks:[],comparisons:[],screenshots:[],errors:[],before:{}};
let browser,context,page,fixture,locale;
const state=()=>page.evaluate(()=>({frame:__rogueBrowserTest.frame,trace:__rogueBrowserTest.trace,traces:__rogueBrowserTest.traces,input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending,messages:__rogueBrowserTest.messages,diagnostics:__rogueBrowserTest.diagnostics,top:__rogueBrowserTest.topOpen}));
const draw=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function click(id){
 for(let n=0;n<30;n++){
  const s=await page.evaluate(()=>__rogueBrowserTest.canvas),c=s.controls.find(c=>c.id===id&&!c.disabled);
  if(c){const x=c.rect.x+c.rect.w/2,y=c.rect.y+c.rect.h/2;if(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches))await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await draw();return;}
  if(id.startsWith('item-')&&s.regions.dialog){await page.mouse.move(s.regions.dialog.rect.x+30,s.regions.dialog.rect.y+30);await page.mouse.wheel(0,100);await draw();}
  else await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
 }
 throw Error('Missing control '+id);
}
async function field(id,value){await click(id);await page.keyboard.press('Control+a');if(value)await page.keyboard.insertText(value);else await page.keyboard.press('Backspace');await draw();}
async function sent(fn){const n=(await state()).input;await fn();await page.waitForFunction(n=>!__rogueBrowserTest.queuePending&&(__rogueBrowserTest.inputRequestCount>n||__rogueBrowserTest.diagnostics.exitCode!==null),n);await draw();}
const key=k=>sent(()=>page.keyboard.press(k));
async function chars(text){for(const c of text){const v=c.charCodeAt(0);await key(v===27?'Escape':v===13?'Enter':v===32?'Space':v<27?'Control+'+String.fromCharCode(v+96):c);}}
async function open(f, mobile=false, lang='ja', module='game-fixtures'){
 await context?.close();fixture=f;locale=lang;
 context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1240,height:900},isMobile:mobile,hasTouch:mobile});
 if(f)await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(f)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));
 if(module!=='game')await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build',module+'.js'),contentType:'text/javascript',headers}));
 page=await context.newPage();await installBrowserTestAdapter(page);page.setDefaultTimeout(12000);page.on('pageerror',e=>evidence.errors.push(e.message));
 await page.goto(base+'?trace=1&view=pixels&lang='+lang);await page.waitForFunction(()=>window.__rogueBrowserTest?.canvas.paintCount>0);
 await field('name','BugAudit');await field('seed','17');await click('new-game');
 await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.inputRequestCount>0&&!__rogueBrowserTest.queuePending);await draw();
}
async function idle(){await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window&&__rogueBrowserTest.frame.ui.input.kind==='command'&&!__rogueBrowserTest.queuePending);}
async function shot(name){const file=name+'.png';await page.screenshot({path:path.join(output,file)});evidence.screenshots.push(file);}
async function clean(){const s=await state();assert.deepEqual(s.diagnostics.translationFallbacks,[]);assert.deepEqual(s.diagnostics.uiMissing,[]);assert.equal(s.diagnostics.runtimeError,null);}
async function check(name,fn){await fn();await clean();evidence.checks.push(name);console.log('PASS '+name);}
async function reference(text,label,oldText=text){
 const s=await state(),old=await runGame(baseline,{fixture,seed:17,name:'BugAudit',locale,messagePaging:'log',events:Array.from(oldText,c=>c.codePointAt(0))});
 if(text===oldText)assert.deepEqual(s.traces.map(t=>({words:t.words,input_index:t.input_index})),old.traces.map(t=>({words:t.words,input_index:t.input_index})),label+' all C/RNG checkpoints');
 else assert.deepEqual(s.trace.words,old.traces.at(-1).words,label+' C state/RNG after the original empty-list workaround');
 evidence.comparisons.push({label,fixture,text,oldText,allCheckpoints:text===oldText,checkpoints:s.traces.length,words:s.trace.words});
}
try{
 browser=await chromium.launch({executablePath,headless:true,args:['--disable-gpu']});
 // Establish the defects against a separately built copy of the pre-fix C.
 const beforeEmpty=await runGame(baseline,{fixture:'bug-identify-empty-potion',seed:17,text:'rb\x1b',messagePaging:'log'});
 assert.equal(beforeEmpty.frames.at(-1).ui.input.kind,'item');
 const beforeName=await runGame(baseline,{fixture:'bug-naming',seed:17,text:'i qf',messagePaging:'log'});
 assert.ok(beforeName.input_contexts.at(-1).input.initial);
 const beforeTranslation=await runGame(baseline,{fixture:'bug-translation',seed:17,text:'.rfq*',locale:'ja',messagePaging:'log'});
 assert.ok(beforeTranslation.messages.some(m=>m.fallback_used));
 evidence.before={emptyIdentifyCancelStillWaiting:true,namingInitial:beforeName.input_contexts.at(-1).input.initial,untranslated:beforeTranslation.messages.filter(m=>m.fallback_used).map(m=>m.fallback)};
 for(const mobile of [false,true]){
  const device=mobile?'mobile':'desktop';
  for(const type of ['potion','scroll','weapon','armor','ring-stick'])await check(device+' empty identify '+type+' returns to movement',async()=>{
   await open('bug-identify-empty-'+type,mobile);const initial=await state();await chars('rb');await idle();
   assert.ok((await state()).messages.some(m=>m.text.includes('鑑定できる持ち物がない')));
   assert.equal((await state()).trace.words[13],initial.trace.words[13]);
   if(type==='potion')await shot(device+'-empty-identify');
   await key('h');assert.equal((await state()).frame.player.x,9);await reference('rbh',device+' empty '+type,'rb*h');
   await key('i');assert.equal((await state()).frame.ui.lines.filter(l=>l.selectable).length,1);await sent(()=>click('window-32'));await idle();
  });
  for(const method of ['button','Escape'])await check(device+' identify cancel '+method+' consumes scroll and permits movement',async()=>{
   await open('bug-identify-potion',mobile);const initial=await state();await chars('rg');assert.equal((await state()).frame.ui.input.kind,'item');
   if(method==='button')await sent(()=>click('window-27'));else await key('Escape');await idle();
   const cancelled=await state();assert.equal(cancelled.trace.words[1],initial.trace.words[1]);assert.equal(cancelled.trace.words[13],initial.trace.words[13]);
   await key('i');const rows=(await state()).frame.ui.lines.filter(l=>l.selectable);assert.ok(!rows.some(r=>r.key==='g'));assert.equal(rows.find(r=>r.key==='f').args[1].value.known,false);await sent(()=>click('window-32'));await key('h');await idle();
  });
  await check(device+' identify rejects wrong type in Japanese, accepts correct item, then moves',async()=>{
   await open('bug-identify-potion',mobile);await chars('rgc');assert.equal((await state()).frame.ui.input.kind,'item');
   assert.ok((await state()).messages.some(m=>m.text.includes('薬を鑑定しなければならない')));await shot(device+'-identify-wrong-type');
   await sent(()=>click('item-f'));await idle();await key('h');await reference('rgcfh',device+' identify wrong then correct');
  });
  for(const method of ['name','empty','Escape'])await check(device+' after-use naming '+method+' starts empty and returns to movement',async()=>{
   await open('bug-naming',mobile);await chars('i qf');assert.equal((await state()).frame.ui.input.kind,'text');
   assert.equal((await state()).frame.ui.input.initial,'');await click('prompt-text');assert.equal(await page.locator('#prompt-text').inputValue(),'');await shot(device+'-naming-'+method);
   if(method==='name'){await field('prompt-text','回復の目印');await sent(()=>click('submit-text'));}
   else if(method==='empty')await sent(()=>click('submit-text'));else await key('Escape');
   await idle();await key('h');
   if(method==='name')await reference('i qf\x15回復の目印\rh',device+' explicit name');
   await chars('D!');
   if(method==='name')assert.ok((await state()).messages.at(-1).text.includes('回復の目印'));
   else assert.ok(JSON.stringify((await state()).messages.at(-1).args).includes('discoveries.none.potion'),'blank/cancel does not register a name');
   await idle();
  });
  for(const lang of ['ja','en'])await check(device+' hungry, remove curse and empty list notifications '+lang,async()=>{
   await open('bug-translation',mobile,lang);await chars('.rfq*');await idle();
   const messages=(await state()).messages;assert.ok(messages.some(m=>/stomach.you_are_starting_to_get_hungry/.test(m.id)||JSON.stringify(m.args).includes('stomach.you_are_starting_to_get_hungry')));
   assert.ok(messages.some(m=>/watching_over_you/.test(m.id)||JSON.stringify(m.args).includes('watching_over_you')));
   if(lang==='ja'){assert.ok(messages.some(m=>m.text.includes('お腹が空いて')));assert.ok(messages.some(m=>m.text.includes('見守')));}
   await shot(device+'-notifications-'+lang);await chars('eah');await idle();await reference('.rfq*eah',device+' notifications '+lang);
  });
  for(const ending of ['bug-death-combat','ending-no-tomb'])await check(device+' death HP/gold stay correct through score and finish '+ending,async()=>{
   await open(ending,mobile);let text='';
   for(let n=0;(await state()).frame.ui.input.kind!=='enter';n++){assert.ok(n<12,'controlled enemy must finish combat');await key('.');text+='.';}
   let s=await state();const gold=ending==='bug-death-combat'?422:111;assert.equal(s.frame.ui.status.args[2].value,0);assert.equal(s.frame.ui.status.args[1].value,gold);
   await shot(device+'-'+ending);await sent(()=>click('window-13'));text+='\r';s=await state();assert.equal(s.frame.ui.status.args[2].value,0);assert.ok(s.frame.ui.lines.some(l=>l.text.includes(gold+'点')));
   await sent(()=>click('window-13'));text+='\r';assert.equal((await state()).diagnostics.exitCode,1);await reference(text,device+' '+ending);
   await click('result-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await shot(device+'-result-top-'+ending);
  });
  await check(device+' production fixed seed start, inventory, close and movement',async()=>{
   await open('',mobile,'ja','game');const initial=await state();await key('i');await sent(()=>click('window-32'));await idle();assert.deepEqual((await state()).trace.words,initial.trace.words);await key('h');await idle();await shot(device+'-production');
  });
 }
 await check('save/load of the new blank after-use naming prompt preserves its draft and follow-up',async()=>{
  await open('bug-naming',true);await chars('i qf');await field('prompt-text','保存した名');await click('settings-toggle');await click('save');await page.waitForFunction(()=>!__rogueBrowserTest.savePending&&__rogueBrowserTest.savedLength>0);await click('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await click('load');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='text'&&!__rogueBrowserTest.queuePending);await draw();await click('prompt-text');assert.equal(await page.locator('#prompt-text').inputValue(),'保存した名');await sent(()=>click('submit-text'));await idle();await key('h');await idle();await shot('naming-save-restored');
 });
 assert.deepEqual(evidence.errors,[]);evidence.result='pass';
 evidence.files=await Promise.all(['build/game.wasm','build/game-fixtures.wasm','build/playthrough-before.wasm','logic/wizard.c','logic/misc.c','logic/io.c','logic/rip.c','tools/generate_catalog.py'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')})));
}catch(error){evidence.result='fail';evidence.failure=error.stack;evidence.state=await state().catch(()=>null);await shot('failure').catch(()=>{});throw error;}
finally{evidence.finished=new Date().toISOString();await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));await context?.close();await browser?.close();await new Promise(r=>server.close(r));}

// Original after-use naming branches, exercised through the real C/Worker/UI.
// Fixture build: python tools/build.py --output-name game-fixtures --test-fixtures.
// --quick selects representative branches; --inventory exercises item actions.
// --answers-only checks naming, skipping, cancellation and the next use.
// --case=naming-scroll-12-unknown-rooms selects one fixture.
// ROGUE_NAMING_RESUME retains verified pairs after a startup asset failure;
// the failed pair must be executed again and the earlier failure stays recorded.
// --shard=0/4 splits complete display-mode pairs. ROGUE_NAMING_WASM may
// select a separately named fixture build, leaving the playable game untouched.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_NAMING_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/after-use-naming'));
await mkdir(output,{recursive:true});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const definition=await readFile(path.join(root,'logic/rogue.h'),'utf8');
const count=kind=>Number(definition.match(new RegExp('#define\\s+MAX'+kind+'\\s+(\\d+)'))[1]);
const types=[['potion',count('POTIONS'),'q'],['scroll',count('SCROLLS'),'r'],['stick',count('STICKS'),'z']];
const quick=process.argv.includes('--quick');
const inventoryOnly=process.argv.includes('--inventory');
const answersOnly=process.argv.includes('--answers-only');
const caseArgument=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
assert.ok(!inventoryOnly||!answersOnly);
const shardArgument=process.argv.find(a=>a.startsWith('--shard='));
const [shard,totalShards]=shardArgument?shardArgument.slice(8).split('/').map(Number):[0,1];
assert.ok(Number.isInteger(shard)&&Number.isInteger(totalShards)&&shard>=0&&shard<totalShards);
const belongs=index=>index%totalShards===shard;
const includeAnswers=shard===0&&!inventoryOnly&&!caseArgument;
const fixtureWasm=process.env.ROGUE_NAMING_WASM||path.join(root,'build/game-fixtures.wasm');
const cases=quick?[['potion',11,'unknown','q'],['potion',2,'unknown','q'],['scroll',13,'unknown','r'],['stick',0,'unknown','z']]:types.flatMap(([category,length,key])=>Array.from({length},(_,type)=>['unknown','known','called','knowncalled'].map(knowledge=>[category,type,knowledge,key])).flat());
if(!quick){
 for(const [category,length,command]of types.filter(([category])=>category!=='stick'))
  for(let type=0;type<length;type++)cases.push([category,type,'unknown',command,'single']);
 cases.push(['potion',0,'unknown','q','trip'],['potion',7,'unknown','q','target'],['scroll',2,'unknown','r','target'],['scroll',11,'unknown','r','target'],['scroll',12,'unknown','r','rooms']);
}
const selected=answersOnly?[]:cases.filter(c=>!inventoryOnly||(c[2]==='unknown'&&!c[4])).filter((_,index)=>belongs(index)).filter(c=>!caseArgument||`naming-${c[0]}-${c[1]}-${c[2]}${c[4]?'-'+c[4]:''}`===caseArgument);
assert.ok(selected.length>0||(answersOnly&&includeAnswers),'No browser cases selected');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=loadPlaywright();
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true});
const report={shard,totalShards,route:answersOnly?'answers':inventoryOnly?'inventory':'direct',types:types.map(([category,count])=>({category,count})),cases:[],comparisons:0,errors:[],startupEvents:[]};
const completed=new Set();
if(process.env.ROGUE_NAMING_RESUME){
 const previous=JSON.parse(await readFile(process.env.ROGUE_NAMING_RESUME,'utf8'));
 assert.equal(previous.shard,shard);assert.equal(previous.totalShards,totalShards);
 assert.equal(previous.route,report.route);
 assert.equal(previous.lastState?.running,false);
 assert.equal(previous.lastState?.error,'Invalid tile dimensions or unavailable assets','Resume is limited to a failed asset load before starting the game');
 // Keep only mode pairs whose steps and every trace were already compared.
 const verified=previous.cases.slice(0,previous.comparisons*2);
 report.cases.push(...verified);report.comparisons=previous.comparisons;
 report.previousStartupFailure={path:process.env.ROGUE_NAMING_RESUME,current:previous.current,failure:previous.failure};
 for(const entry of verified)completed.add(entry.width+'|'+entry.fixture);
}
let context,page,current;
const draw=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.frame?.ui.input,window:__rogueBrowserTest.frame?.ui.window,running:__rogueBrowserTest.running,trace:__rogueBrowserTest.trace,traces:__rogueBrowserTest.traces,controls:__rogueBrowserTest.canvas.controls.map(c=>({id:c.id,label:c.label,disabled:c.disabled})),error:__rogueBrowserTest.diagnostics.runtimeError}));
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls.some(c=>c.id===id&&!c.disabled),id);
 const c=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id),id),b=await page.locator('#rogue-canvas').boundingBox();
 if(current.width<700)await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);
 else await page.mouse.click(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);
 await draw();
}
async function sent(action){
 const n=await page.evaluate(()=>__rogueBrowserTest.inputRequestCount);
 await action();await page.waitForFunction(n=>(__rogueBrowserTest.inputRequestCount>n||!__rogueBrowserTest.running)&&!__rogueBrowserTest.queuePending,n);await draw();
}
async function key(value){await sent(async()=>{await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);});}
async function open(fixture,mode,width){
 await context?.close();context=await browser.newContext({viewport:{width,height:width<700?844:1050},hasTouch:width<700,isMobile:width<700});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:fixtureWasm,contentType:'application/wasm',headers}));
 page=await context.newPage();await installBrowserTestAdapter(page);page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
 page.on('requestfailed',r=>report.startupEvents.push({url:r.url(),failure:r.failure(),current}));
 page.on('console',m=>{if(m.type()==='error')report.startupEvents.push({console:m.text(),current});});
 await page.goto('http://127.0.0.1:'+server.address().port+'/?lang=ja&view='+mode+'&trace=1');
 await page.waitForFunction(()=>__rogueBrowserTest.canvas?.paintCount>0);
 await tap('name');await page.keyboard.press('Control+a');await page.keyboard.insertText('NamingAudit');
 await tap('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText(fixture.endsWith('-rooms')?'20':'17');
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics.ready||__rogueBrowserTest.diagnostics.runtimeError);
 assert.equal((await state()).error,null,'Both image sets must load before game startup');
 await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.trace&&__rogueBrowserTest.frame?.ui.input.kind==='command');await draw();
}
async function settle(reply){
 const steps=[];let naming=false;
 for(let n=0;n<24;n++){
  const s=await state();assert.equal(s.error,null);assert.ok(s.running,'Game remains live');
  if(s.input.kind==='command')return {naming,steps,state:s};
  steps.push({kind:s.input.kind,id:s.input.id,message:s.window?.message?.id});
  if(s.input.kind==='text'){
   assert.match(s.window?.message?.id||'',/^misc\.call_it\./);
   assert.ok(s.controls.some(c=>c.id==='prompt-text'&&!c.disabled),'Naming input is painted');
   assert.ok(s.controls.some(c=>c.id==='submit-text'&&!c.disabled),'Naming input can be submitted');
   naming=true;
   if(reply==='name'){
    await tap('prompt-text');await page.keyboard.insertText('audit-name');await sent(()=>tap('submit-text'));
   }else if(reply==='Escape')await key('Escape');
   else await sent(()=>tap('submit-text'));
  }else if(s.input.kind==='item')await key('Escape');
  else if(s.input.kind==='direction')await key('l');
  else if(s.input.kind==='space'||s.input.kind==='space_cancel')await key('Space');
  else if(s.input.kind==='enter')await key('Enter');
  else if(s.input.kind==='confirm')await key('n');
  else assert.fail('Unexpected follow-up '+JSON.stringify(s.input));
 }
 assert.fail('Follow-up did not return to command');
}
try{
 for(const width of [390,1400])for(const [category,type,knowledge,command,scenario] of selected){
  const fixture=`naming-${category}-${type}-${knowledge}${scenario?'-'+scenario:''}`;
  if(completed.has(width+'|'+fixture))continue;
  const pair=[];
  for(const mode of ['pixels','tiles']){
   current={width,category,type,knowledge,mode,scenario,fixture:`naming-${category}-${type}-${knowledge}${scenario?'-'+scenario:''}`};
   await open(current.fixture,mode,width);
   if(inventoryOnly){
    await key('i');await tap('item-f');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window?.kind==='inventory_actions');
    await sent(()=>tap('window-'+command.charCodeAt(0)));
   }else{
    await key(command);
    if(category==='stick'){
     assert.equal((await state()).input.kind,'direction','Zap asks for its direction before the item');
     await key('l');
    }
    assert.equal((await state()).input.kind,'item','The requested object must actually be selected');
    await key('f');
   }
   const result=await settle('empty');
   if(knowledge==='unknown'&&category==='potion'&&type===11)assert.equal(result.naming,true,'Unidentified restore-strength asks for a name');
   if(scenario==='target')assert.equal(result.naming,false,'Successful detection/hold identifies the type');
   if(scenario==='rooms')assert.equal(result.naming,false,'Teleporting to a different room identifies the scroll');
   if(scenario==='trip')assert.equal(result.naming,true,'Confusion while hallucinating remains unidentified');
   if(knowledge!=='unknown'||category==='stick')assert.equal(result.naming,false,'Only an unrecognized, unnamed scroll/potion can prompt');
   await key('h');const final=await state();assert.equal(final.input.kind,'command');assert.equal(final.error,null);
   const entry={...current,naming:result.naming,steps:result.steps,trace:final.trace,traces:final.traces.map(t=>({words:t.words,input_index:t.input_index}))};
   pair.push(entry);report.cases.push(entry);
   if(knowledge==='unknown'&&type===11&&category==='potion')await page.screenshot({path:path.join(output,`${width}-${mode}-after.png`)});
  }
  assert.deepEqual(pair[0].steps,pair[1].steps,'Same follow-up windows in both map modes');
  assert.deepEqual(pair[0].traces,pair[1].traces,'Every original C/RNG/input checkpoint matches across map modes');
  report.comparisons++;
  if(report.comparisons%12===0)console.log('PASS naming comparisons',report.comparisons,'browser cases',report.cases.length);
 }
 // The optional naming answers and the inventory action route are separate inputs.
 for(const width of (includeAnswers?[390,1400]:[]))for(const mode of ['pixels','tiles'])for(const reply of ['name','empty','Escape']){
  current={width,mode,reply,fixture:'naming-potion-11-unknown'};await open(current.fixture,mode,width);
  await key('i');await tap('item-f');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window?.kind==='inventory_actions');
  await sent(()=>tap('window-113'));await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='text');
  await draw();await page.screenshot({path:path.join(output,`${width}-${mode}-${reply}-prompt.png`)});
  const before=await state();await tap('settings-toggle');await tap('select-display-mode');await tap('select-display-mode-'+(mode==='pixels'?'tiles':'pixels'));await tap('settings-close');
  const switched=await state();assert.equal(switched.input.kind,'text');assert.deepEqual(switched.trace,before.trace,'Mode changes do not consume the naming answer');
  const result=await settle(reply);assert.ok(result.naming);await key('h');assert.equal((await state()).input.kind,'command');
  await key('q');assert.equal((await state()).input.kind,'item');await key('f');
  const second=await settle('empty');assert.equal(second.naming,reply!=='name','A saved name suppresses the next prompt; empty/cancelled answers do not');
  await key('h');assert.equal((await state()).input.kind,'command');
  report.cases.push({...current,route:'inventory',naming:true,secondNaming:second.naming,trace:(await state()).trace});
 }
 assert.equal(report.cases.length,selected.length*4+(includeAnswers?12:0),'Every requested browser case completed');
 assert.deepEqual(report.errors,[]);report.result='pass';console.log('PASS all naming checks',report.cases.length,'mode comparisons',report.comparisons);
}catch(error){report.result='fail';report.failure=error.stack;report.current=current;report.lastState=await state().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));}
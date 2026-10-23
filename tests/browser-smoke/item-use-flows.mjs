// Exercise every usable original item through the actual Worker and UI.
// Build: tools/build.py --output-name item-use-fixtures --test-fixtures --keep-artifacts
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';import {runGame} from '../run-game.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),wasm=path.resolve(root,process.env.ROGUE_ITEM_USE_WASM||'build/item-use-fixtures.wasm');
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/item-use-flows'));await mkdir(output,{recursive:true});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8'),definitions=await readFile(path.join(root,'logic/rogue.h'),'utf8');
const count=kind=>Number(definitions.match(new RegExp('#define\\s+MAX'+kind+'\\s+(\\d+)'))[1]);
const categories=[['potion',count('POTIONS'),'q'],['scroll',count('SCROLLS'),'r'],['stick',count('STICKS'),'z'],['ring',count('RINGS'),'P'],['weapon',count('WEAPONS'),'w'],['armor',count('ARMORS'),'W'],['food',2,'e'],['amulet',1,'t']];
const quick=process.argv.includes('--quick');
const report={result:'running',cases:[],failures:[],errors:[]},runtime=await prepareBrowserRuntime(root),server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};let context,page,current,text;
const snap=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function tap(id){
 for(let n=0;n<20;n++){
  const s=await snap(),c=s.scene?.controls?.find(c=>c.id===id&&!c.disabled);
  if(c){const b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(current.mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();return;}
  if(id.startsWith('item-')&&s.scene?.regions.dialog){const r=s.scene.regions.dialog.rect,b=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(b.x+r.x+20,b.y+r.y+20);await page.mouse.wheel(0,200);await paint();}
  else await page.waitForTimeout(25);
 }
 throw Error('Missing '+id+' in '+JSON.stringify((await snap()).scene.controls.map(c=>({id:c.id,label:c.label}))));
}
async function physical(key){await page.locator('#rogue-canvas').focus();await page.keyboard.press(key);await paint();}
async function send(key){const before=(await snap()).state.inputRequestCount;await physical(key);await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&!__rogueBrowserTest.queuePending,before);await paint();}
async function start(){
 await context?.close();context=await browser.newContext({viewport:current.mobile?{width:390,height:844}:{width:1400,height:1050},hasTouch:current.mobile,isMobile:current.mobile});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,current.fixture),contentType:'text/javascript',headers}));await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view='+current.mode);await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
 await tap('name');await page.keyboard.press('Control+a');await page.keyboard.insertText('ItemUse');await tap('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText('17');await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command');text='';
}
function observed(s){const ui=s.state.frame.ui;return {kind:ui.input.kind,window:ui.window?.kind,title:ui.window?.title,choices:ui.lines.filter(l=>l.selectable).map(l=>({key:l.key,text:l.text})),actions:ui.window?.actions,message:ui.window?.message?.text};}
async function followups(phases){
 for(let n=0;n<18;n++){
  const s=await snap(),ui=s.state.frame.ui,k=ui.input.kind;phases.push(observed(s));
  assert.equal(s.state.runtimeError,null);assert.deepEqual(s.state.translationFallbacks,[]);
  if(k==='command')return;
  if(k==='item'){
   assert.ok(ui.window,'A requested item target has a selection window');const choices=ui.lines.filter(l=>l.selectable);assert.ok(choices.length,'A requested item target has selectable public rows');
   const targets={5:'g',6:'h',7:'d',8:'b',9:current.scenario==='sticktarget'?'j':'i'},target=targets[current.type]||choices[0].key;
   assert.ok(choices.some(c=>c.key===target),'The correct target category is offered');
   const targetCategory=choices.find(c=>c.key===target).args[1].value.category;
   if(!current.mobile&&!s.scene.controls.some(c=>c.id==='item-'+target)&&s.scene.controls.some(c=>c.id==='inventory-tab-'+targetCategory))await tap('inventory-tab-'+targetCategory);
   await tap('item-'+target);text+=target;
  }else if(k==='text'){assert.ok(current.verb==='c'||/^misc\.call_it\./.test(ui.window?.message?.id||''));if(current.verb==='c'){await tap('prompt-text');await page.keyboard.press('Control+a');await page.keyboard.insertText('UseLabel');}await tap('submit-text');text+='\x15'+(current.verb==='c'?'UseLabel':'')+'\r';}
  else if(k==='hand'){const choice=ui.window.actions.find(a=>a.key===108);assert.ok(choice);if(current.mobile)await tap('window-108');else{const c=s.scene.controls.find(c=>c.id==='window-108');await physical(c.shortcut);}text+='l';}
  else if(k==='space'||k==='space_cancel'){if(current.mobile)await tap('window-32');else await physical('Space');text+=' ';}
  else if(k==='enter'){await physical('Enter');text+='\r';}
  else throw Error('Unimplemented follow-up '+JSON.stringify(observed(s)));
  await page.waitForTimeout(15);await paint();
 }
 throw Error('Use did not return to the command prompt');
}
async function equivalent(label){
 const expected=await runGame(wasm,{fixture:current.fixture,name:'ItemUse',seed:17,locale:'ja',messagePaging:'log',text}),s=await snap();
 assert.deepEqual(s.state.trace.words,expected.traces.at(-1).words,label+' C state/RNG');assert.equal(s.state.trace.input_index,text.length,label+' consumed journal');
 // Check the actual questions emitted by C for this full use, including
 // prompts answered automatically by an inventory action between repaints.
 const questions=[...new Set(expected.presentations.filter(p=>['item','direction','hand','text','confirm'].includes(p.ui.input.kind)).map(p=>p.ui.message?.text).filter(Boolean))];
 const visible=s.state.entries.filter(e=>!e.transient_prompt&&(!current.mobile||!e.mobile_keyboard_hint));
 for(const question of questions){assert.ok(!visible.some(e=>e.text===question),label+' leaves no answered question in the log: '+question);assert.notEqual(s.state.message,question,label+' latest message is a result');}
}
try{
 const cases=[];
 for(const [category,total,verb]of categories)for(let type=0;type<total;type++){
  if(quick&&!((category==='scroll'&&[5,6,7,8,9].includes(type))||type===0||category==='stick'&&type===13))continue;
  for(const mobile of [false,true])cases.push({category,type,verb,mobile,mode:'pixels',scenario:'base'});
 }
 for(const mode of ['tiles','ascii'])for(const mobile of [false,true])for(const [category,type,verb]of [['scroll',9,'r'],['stick',13,'z'],['ring',0,'P']])cases.push({category,type,verb,mobile,mode,scenario:'base'});
 if(!quick)for(const mobile of [false,true])for(const [category,type,verb,scenario]of [['stick',0,'z','empty'],['stick',9,'z','weak'],['stick',13,'z','alone'],['scroll',9,'r','sticktarget'],['ring',0,'P','cursed'],['armor',7,'W','cursed'],['weapon',8,'w','cursed']])cases.push({category,type,verb,mobile,mode:'pixels',scenario});
 if(!quick)for(const [category]of categories)for(const mobile of [false,true])for(const verb of ['t','d',...(['potion','scroll','stick','ring','weapon','armor'].includes(category)?['c']:[])])cases.push({category,type:0,verb,mobile,mode:'pixels',scenario:'base'});
 for(const c of cases){current={...c,fixture:`item-use-${c.category}-${c.type}-${c.scenario}`};const phases=[];
  try{
   await start();const useStart=(await snap()).state.messages.length;
   if(current.mobile){await tap('touch-action-action.inventory');text+='i';await tap('item-f');assert.equal((await snap()).state.frame.ui.window.kind,'inventory_actions');assert.equal((await snap()).state.frame.ui.lines[0].args[1].value.category,current.category,'The requested item category is selected');await tap('window-'+current.verb.charCodeAt(0));text+=' '+current.verb;}
   else{await send(current.verb);text+=current.verb;}
   if(current.verb==='z'||current.verb==='t'){
    assert.equal((await snap()).state.input.kind,'direction');const direction=(await snap()).scene.controls.some(c=>c.id==='touch-l')?'touch-l':'window-108';assert.ok((await snap()).scene.controls.some(c=>c.id===direction),'A usable direction selector is visible');
    await tap(direction);text+='l';
   }
   if(current.mobile){text+='f';await page.waitForTimeout(20);await paint();}else{assert.equal((await snap()).state.input.kind,'item');const row=(await snap()).state.frame.ui.lines.find(l=>l.key==='f');assert.equal(row?.args[1].value.category,current.category,'The original selection offers the requested item');await send('f');text+='f';}
   await followups(phases);await equivalent('Use');
   if((current.category==='ring'&&current.verb==='P')||(current.category==='armor'&&current.verb==='W')){
    const verb=current.category==='ring'?'R':'T';if(current.mobile)await tap('touch-action-action.inventory');else await physical('i');text+='i';await tap('item-f');await tap('window-'+verb.charCodeAt(0));text+=' '+verb;
    await followups(phases);await equivalent('Remove equipment');
   }
   if(current.mobile)await tap('touch-.');else await send('.');text+='.';await followups(phases);await equivalent('Next command');
   const final=await snap();assert.deepEqual(final.state.translationFallbacks,[]);assert.deepEqual(final.state.uiMissing,[]);
   console.log('PASS '+current.fixture+' '+(current.mobile?'touch':'keyboard')+' '+current.mode);report.cases.push({...current,text,phases,messages:final.state.messages.slice(useStart).map(m=>({id:m.id,text:m.text})),words:final.state.trace.words});
  }catch(e){const last=await snap().catch(()=>null);report.failures.push({...current,text,phases,error:e.stack,last:last&&observed(last)});console.log('FAIL '+current.fixture+' '+current.mobile+' '+e.message);await writeFile(path.join(output,'progress.json'),JSON.stringify(report,null,2));await page?.screenshot({path:path.join(output,'failure-'+report.failures.length+'.png')}).catch(()=>{});}
 }
 report.result=report.failures.length?'fail':'pass';assert.deepEqual(report.errors,[]);assert.equal(report.failures.length,0,JSON.stringify(report.failures.map(({fixture,mobile,error})=>({fixture,mobile,error})),null,2));report.result='pass';
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,failures:report.failures,output}));
}finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await new Promise(r=>server.close(r));await runtime.dispose();}

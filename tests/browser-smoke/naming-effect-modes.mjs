// Web contract: show the current use's logged effects inside the naming dialog.
// Uses real C fixtures, physical input and the painted dialog content in every
// map mode. Fixture build: tools/build.py --output-name game-fixtures --test-fixtures.
// ROGUE_NAMING_WASM selects an independently named fixture build.
// --quick uses restore strength, remove curse and confusion while hallucinating.
// --shard=0/2 splits item cases; manual naming checks run in shard zero.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_EFFECT_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/naming-effect-modes'));
await mkdir(output,{recursive:true});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const wasm=process.env.ROGUE_NAMING_WASM||path.join(root,'build/game-fixtures.wasm');
const modes=['pixels','tiles','ascii'];
const shardArg=process.argv.find(a=>a.startsWith('--shard='));
const [shard,shards]=shardArg?shardArg.slice(8).split('/').map(Number):[0,1];
assert.ok(Number.isInteger(shard)&&Number.isInteger(shards)&&shard>=0&&shard<shards);
const all=process.argv.includes('--quick')?[['potion',11],['scroll',15],['potion',0,'trip']]:[
 ...Array.from({length:14},(_,i)=>['potion',i]),...Array.from({length:18},(_,i)=>['scroll',i]),['potion',0,'trip']];
const cases=all.filter((_,i)=>i%shards===shard);assert.ok(cases.length);
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true});
const report={result:'running',shard,shards,modes,widths:[390,1400],routes:['direct','inventory'],cases:[],switches:[],manual:[],errors:[]};
let context,page,current;
const normalized=text=>text.replace(/\s+/gu,'');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const snapshot=()=>page.evaluate(()=>({state:__rogueUiAdapter.state,scene:__rogueBrowserTest.canvas,commands:__rogueBrowserTest.commands}));
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls?.some(c=>c.id===id&&!c.disabled),id);
 const c=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id),id),b=await page.locator('#rogue-canvas').boundingBox();
 const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
 if(current.width<700)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
 await paint();
}
async function sent(action){
 const before=await page.evaluate(()=>__rogueBrowserTest.inputRequestCount);
 await action();await page.waitForFunction(before=>__rogueBrowserTest.inputRequestCount>before&&!__rogueBrowserTest.queuePending,before);await paint();
}
async function key(value){await sent(async()=>{await page.locator('#rogue-canvas').focus();await page.keyboard.press(value);});}
async function start(fixture,mode,width){
 await context?.close();context=await browser.newContext({viewport:{width,height:width<700?844:1050},hasTouch:width<700,isMobile:width<700});
 await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,fixture),contentType:'text/javascript',headers}));
 await context.route('**/build/game.wasm',r=>r.fulfill({path:wasm,contentType:'application/wasm',headers}));
 page=await context.newPage();page.setDefaultTimeout(20000);await installBrowserTestAdapter(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?lang=ja&view='+mode+'&trace=1');
 await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready||__rogueBrowserTest.diagnostics?.runtimeError);
 assert.equal((await snapshot()).state.runtimeError,null,'Assets loaded');
 await tap('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText('17');
 await tap('new-game');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command');await paint();
}
function containsId(value,prefix){
 if(!value||typeof value!=='object')return false;
 return (typeof value.id==='string'&&value.id.startsWith(prefix))||Object.values(value).some(v=>containsId(v,prefix));
}
function useEffects(messages){
 const prompt=messages.findIndex(m=>m.id.startsWith('misc.call_it.'));
 assert.ok(prompt>=0,'The current use emitted its naming prompt');
 return messages.slice(0,prompt).filter(m=>m.text?.trim()&&m.id!=='message.clear'&&!containsId(m,'pack.get_item.'));
}
function dialogLines(s){
 const viewport=s.scene.regions.dialog?.rect;assert.ok(viewport,'A dialog content viewport exists');
 const clips=[],lines=[];
 const same=r=>r&&['x','y','w','h'].every(k=>Math.abs(r[k]-viewport[k])<.01);
 for(const command of s.commands){
  if(command.op==='clip')clips.push(command.rect);
  else if(command.op==='restore')clips.pop();
  else if(command.op==='text'&&clips.some(same)&&command.x>=viewport.x&&command.x<viewport.x+viewport.w&&command.y>=viewport.y&&command.y+command.size<=viewport.y+viewport.h+.1)
   lines.push({text:command.text,x:command.x,y:command.y,color:command.color,size:command.size});
 }
 return lines;
}
async function inspect(effects){
 const s=await snapshot();assert.equal(s.state.runtimeError,null);assert.equal(s.state.input.kind,'text');
 assert.ok(s.scene.controls.some(c=>c.id==='prompt-text'&&!c.disabled));
 const lines=dialogLines(s),text=normalized(lines.map(l=>l.text).join(''));
 if(effects.length){
  assert.ok(text.includes('使用時のメッセージ'),'Effect heading is inside the dialog, not just the background log');
  for(const effect of effects)assert.ok(text.includes(normalized(effect.text)),'The dialog contains the current logged effect: '+effect.text);
 }else assert.ok(!text.includes('使用時のメッセージ'),'No effect is invented when the game emitted none');
 const r=s.scene.regions.dialog.rect,b=await page.locator('#rogue-canvas').boundingBox();
 const image=await page.screenshot({clip:{x:b.x+r.x,y:b.y+r.y,width:r.w,height:r.h}});
 return {effects:effects.map(({id,text})=>({id,text})),lines,digest:hash(image),trace:s.state.trace,requests:s.state.inputRequestCount};
}
async function finishFollowups(logStart){
 for(let i=0;i<24;i++){
  const s=await snapshot(),kind=s.state.input.kind;assert.equal(s.state.runtimeError,null);
  if(kind==='command')return null;
  if(kind==='text'){
   assert.match(s.state.frame.ui.window.message.id,/^misc\.call_it\./);
   return inspect(useEffects(s.state.messages.slice(logStart)));
  }
  if(kind==='item')await key('Escape');
  else if(kind==='direction')await key('l');
  else if(kind==='space'||kind==='space_cancel')await key('Space');
  else if(kind==='enter')await key('Enter');
  else if(kind==='confirm')await key('n');
  else assert.fail('Unexpected follow-up '+JSON.stringify(s.state.input));
 }
 assert.fail('Follow-ups did not settle');
}
async function switchModes(original,effects,expectedDigest){
 await tap('prompt-text');await page.keyboard.insertText('確認中');
 const before=await snapshot(),draft=await page.locator('#prompt-text').inputValue();assert.equal(draft,'確認中');
 for(const mode of [...modes.filter(m=>m!==original),original]){
  await tap('settings-toggle');await tap('select-display-mode');await tap('select-display-mode-'+mode);await tap('settings-close');
  const inspected=await inspect(effects),after=await snapshot();
  assert.equal(inspected.digest,expectedDigest,'Changing map mode preserves the actual effect pixels');
  assert.equal(after.state.displayMode,mode);assert.deepEqual(after.state.trace,before.state.trace);
  assert.equal(after.state.inputRequestCount,before.state.inputRequestCount);assert.equal(await page.locator('#prompt-text').inputValue(),draft);
  report.switches.push({...current,to:mode,effects:inspected.effects,digest:inspected.digest});
 }
 await tap('prompt-text');await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');
}
try{
 for(const width of [390,1400])for(const route of ['direct','inventory'])for(const [category,type,scenario]of cases){
  const group=[];
  for(const mode of modes){
   const fixture=`naming-${category}-${type}-unknown${scenario?'-'+scenario:''}`;current={width,route,category,type,scenario,mode,fixture};await start(fixture,mode,width);
   let logStart;
   if(route==='direct'){
    await key(category==='potion'?'q':'r');assert.equal((await snapshot()).state.input.kind,'item');
    logStart=(await snapshot()).state.messages.length;await key('f');
   }else{
    await key('i');await tap('item-f');await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.window?.kind==='inventory_actions');
    logStart=(await snapshot()).state.messages.length;await sent(()=>tap(category==='potion'?'window-113':'window-114'));
   }
   const displayed=await finishFollowups(logStart);
   if(displayed){
    if((category==='potion'&&type===11)||(category==='scroll'&&type===15)){
     await page.screenshot({path:path.join(output,`${width}-${route}-${category}-${type}-${mode}.png`)});
     const raw=(await snapshot()).state.messages.slice(logStart);await switchModes(mode,useEffects(raw),displayed.digest);
    }
    await sent(()=>tap('submit-text'));
   }
   assert.equal((await snapshot()).state.input.kind,'command');await key('h');
   const final=await snapshot();assert.equal(final.state.input.kind,'command');
   const entry={...current,naming:!!displayed,display:displayed,finalTrace:final.state.trace};group.push(entry);report.cases.push(entry);
  }
  for(const other of group.slice(1)){
   assert.equal(other.naming,group[0].naming);
   assert.deepEqual(other.display?.effects,group[0].display?.effects,'Same current effect messages in every map mode');
   assert.deepEqual(other.display?.lines,group[0].display?.lines,'Same text, layout and colors inside the dialog');
   assert.equal(other.display?.digest,group[0].display?.digest,'Actual painted dialog content is pixel-identical across map modes');
   assert.deepEqual(other.finalTrace,group[0].finalTrace,'Mode does not alter the game or submitted input');
  }
  if(report.cases.length%18===0)console.log('PASS effect browser cases',report.cases.length);
 }
 if(shard===0)for(const width of [390,1400])for(const mode of modes){
  current={width,mode,route:'manual',fixture:'naming-potion-11-unknown'};await start(current.fixture,mode,width);
  await key('q');await key('f');const s=await snapshot();const effects=s.state.messages.filter(m=>m.id==='potions.quaff.hey_this_tastes_great_it_make_you_feel_warm_all_over');
  assert.equal(effects.length,1);await inspect(effects);await sent(()=>tap('submit-text'));
  await key('c');await key('f');const manual=await snapshot();assert.match(manual.state.frame.ui.window.message.id,/^command\.call\./);
  const text=normalized(dialogLines(manual).map(l=>l.text).join(''));
  assert.ok(!text.includes('使用時のメッセージ'));assert.ok(!text.includes(normalized(effects[0].text)),'Manual renaming does not reuse an earlier effect');
  await key('Escape');await key('h');report.manual.push({...current,result:'pass'});
 }
 assert.equal(report.cases.length,cases.length*12);assert.deepEqual(report.errors,[]);report.result='pass';
 console.log('PASS naming effects',report.cases.length,'cases,',report.switches.length,'mode changes,',report.manual.length,'manual naming checks');
}catch(error){report.result='fail';report.failure=error.stack;report.current=current;report.last=await snapshot().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}

// Control configuration is a transaction; no edit gesture reaches the game.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {fixtureWorker} from './fixture-worker.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_CUSTOM_CONTROLS_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/control-customization'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[],systemErrors:[]};let context,page,phone;
const snap=async()=>{
 const value=await page.evaluate(()=>({scene:__rogueBrowserTest.canvas,state:__rogueUiAdapter.state}));
 for(const entry of value.state?.entries||[])if(entry.source==='system'&&entry.error){
  const error={id:entry.id,text:entry.text};if(!report.systemErrors.some(e=>e.id===error.id&&e.text===error.text))report.systemErrors.push(error);
 }
 if(value.state?.runtimeError&&!report.systemErrors.some(e=>e.runtimeError===value.state.runtimeError))report.systemErrors.push({runtimeError:value.state.runtimeError});
 return value;
};
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const game=async()=>{const s=await snap();return {words:s.state.trace.words,index:s.state.trace.input_index};};
const prefs=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('rogue-controls-v1')||'null'));
async function wait(kind='command'){await page.waitForFunction(kind=>__rogueBrowserTest.frame?.ui.input.kind===kind&&!__rogueBrowserTest.queuePending,kind);await paint();}
async function tap(id){
 await page.waitForFunction(id=>__rogueBrowserTest.canvas?.controls.some(c=>c.id===id&&!c.disabled),id);
 let c=(await snap()).scene.controls.find(c=>c.id===id);
 for(let n=0;n<40&&(c.rect.h<c.fullRect.h||c.rect.y<0);n++){
  const s=(await snap()).scene,r=(id.startsWith('control-pick-')?s.regions['control-picker']:(s.regions.settings||s.regions.commands)).rect,b=await page.locator('#rogue-canvas').boundingBox();
  await page.mouse.move(b.x+r.x+r.w/2,b.y+r.y+r.h/2);await page.mouse.wheel(0,c.fullRect.y<r.y?-100:100);await paint();c=(await snap()).scene.controls.find(c=>c.id===id);
 }
 assert.ok(c.rect.h>=Math.min(48,c.fullRect.h),id+' visible');
 const b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;
 if(phone)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();
}
async function drag(from,to){
 const s=(await snap()).scene,b=await page.locator('#rogue-canvas').boundingBox(),a=s.controls.find(c=>c.id===from).rect,z=s.controls.find(c=>c.id===to).rect;
 const x=b.x+a.x+a.w/2,y=b.y+a.y+a.h/2,tx=b.x+z.x+z.w/2,ty=b.y+z.y+z.h/2;
 if(phone){
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(tx,ty,{steps:6});await page.mouse.up();}
 await paint();
}
async function binding(command,index=0){
 const id='command-bind-'+command+'-'+index;
 for(let attempt=0;attempt<80;attempt++){
  if((await snap()).scene.controls.some(c=>c.id===id)){await tap(id);return;}
  const s=(await snap()).scene,r=s.regions.commands.rect,b=await page.locator('#rogue-canvas').boundingBox();
  await page.mouse.move(b.x+r.x+r.w/2,b.y+r.y+r.h/2);await page.mouse.wheel(0,240);await paint();
 }
 throw Error('Binding cell not reached: '+id);
}
async function verifyAssignedActions(inventory,movement){
 await edit('commands');await tap(inventory);await tap('control-pick-web.repeat');await tap('controls-commit');
 await tap(phone?'touch-search':'pc-search');await wait();const beforeShort=await game();
 await tap(inventory);await wait();assert.equal((await game()).index,beforeShort.index+1,'Assigned Repeat short tap executes once');
 const c=(await snap()).scene.controls.find(c=>c.id===inventory),b=await page.locator('#rogue-canvas').boundingBox();
 const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2,beforeHold=await game();
 let cdp;
 if(phone){cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});}
 else{await page.mouse.move(x,y);await page.mouse.down();}
 try{await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='repeat-count');}
 finally{if(phone){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.mouse.up();}
 await paint();assert.deepEqual(await game(),beforeHold,'Assigned Repeat long press opens count without a game action');
 await shot('production-assigned-repeat-count');await tap('repeat-count-close');
 await edit('commands');await tap(movement);await tap('control-pick-web.movement');await tap('controls-commit');const beforeMovement=await game();
 await tap(movement);await paint();assert.ok((await snap()).scene.controls.find(c=>c.id===movement).label.includes('走る1'));
 assert.deepEqual(await game(),beforeMovement,'Assigned movement changes mode without advancing the game');
 await shot('production-assigned-controls');
 report.checks.push((phone?'phone':'pc')+': assigned Repeat short tap/real long press/count cancel and assigned movement mode');
}
async function edit(mode){await tap('settings-toggle');await tap(mode==='layout'?'controls-placement':'controls-assignment');assert.equal((await snap()).scene.scope,'controls-editor');}
async function shot(label){const name=(phone?'phone':'pc')+'-'+label+'.png';await page.screenshot({path:path.join(output,name)});report.screenshots.push(name);}
try{
 for(phone of [false,true]){
  context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1400,height:900},hasTouch:phone,isMobile:phone});
  await context.route('**/web/worker.js',r=>r.fulfill({body:fixtureWorker(worker,'inventory-context'),contentType:'text/javascript',headers}));
  await context.route('**/build/game.wasm',r=>r.fulfill({path:path.join(root,'build/game-fixtures.wasm'),contentType:'application/wasm',headers}));
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view=pixels');
  await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await page.locator('#name').fill('Controls');await page.locator('#seed').fill('17');await tap('new-game');await wait();
  const inventory=phone?'touch-action-action.inventory':'pc-inventory',other=phone?'mobile-full-map':'pc-quaff',baseline=await game();
  await edit('layout');const original=(await snap()).scene.controlsEditor.draft;
  await drag(inventory,other);assert.notDeepEqual((await snap()).scene.controlsEditor.draft.columns,original.columns);assert.deepEqual(await game(),baseline);
  await page.keyboard.press('s');await page.keyboard.press('E');await paint();assert.deepEqual(await game(),baseline);
  await shot('layout-draft');await tap('controls-cancel');assert.deepEqual(await game(),baseline);
  await edit('layout');assert.deepEqual((await snap()).scene.controlsEditor.draft,original);
  await drag('touch-h',inventory);const arranged=(await snap()).scene.controlsEditor.draft;assert.notDeepEqual(arranged.columns,original.columns);
  assert.equal(arranged.columns.filter(c=>c.kind==='pad').length,1);
  await shot('pad-column');await tap('controls-commit');assert.deepEqual(await game(),baseline);
  const form=phone?'phone':'desktop',savedLayout=(await prefs())[form].columns;
  await edit('commands');await tap(inventory);assert.ok((await snap()).scene.controls.some(c=>c.id==='control-pick-game.search'));
  await tap('control-pick-game.search');await shot('assignment-draft');assert.deepEqual(await game(),baseline);
  assert.notDeepEqual((await snap()).scene.controlsEditor.draft.assignments,original.assignments);
  await tap('controls-commit');assert.deepEqual(await game(),baseline);
  const saved=await prefs();assert.deepEqual(saved[form].columns,savedLayout);assert.equal(saved[form].assignments[1],'game.search');
  await tap(inventory);await wait();assert.equal((await game()).index,baseline.index+1,'Replacement executes the assigned Search command');
  const afterSearch=await game();
  await edit('commands');await tap('controls-default');assert.deepEqual((await snap()).scene.controlsEditor.draft.columns,savedLayout);
  await tap('controls-cancel');assert.deepEqual(await prefs(),saved);assert.deepEqual(await game(),afterSearch);
  await edit('layout');await tap('controls-default');assert.deepEqual((await snap()).scene.controlsEditor.draft.assignments,saved[form].assignments);
  await tap('controls-commit');assert.deepEqual((await prefs())[form].columns,original.columns);assert.equal((await prefs())[form].assignments[1],'game.search');
  const persisted=await prefs();await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
  assert.deepEqual(await prefs(),persisted,'Reload retains committed configuration');
  await page.locator('#name').fill('Controls');await page.locator('#seed').fill('17');await tap('new-game');await wait();
  await tap(inventory);await wait();assert.equal((await game()).index,1);
  if(!phone){
   const before=await prefs();await edit('layout');await drag(inventory,'pc-quaff');
   await page.setViewportSize({width:390,height:844});await paint();assert.equal((await snap()).scene.scope,'settings','Form change cancels editor');
   assert.deepEqual(await prefs(),before);await tap('settings-close');
   await edit('layout');const phoneDraft=(await snap()).scene.controlsEditor.draft;assert.deepEqual(phoneDraft,before.phone);
   await tap('controls-cancel');await page.setViewportSize({width:1400,height:900});await paint();
   await tap('pc-throw');await wait('item');await tap('item-e');await wait('direction');
   const s=(await snap()).scene;assert.ok(s.controls.some(c=>c.id==='pc-cancel'));assert.ok(!s.controls.some(c=>c.id==='touch-.'));
   assert.equal(s.directionOrigin.control,'pc-throw');const left=s.controls.find(c=>c.id==='touch-h').rect,right=s.controls.find(c=>c.id==='touch-l').rect;assert.ok(left.x<right.x);
   for(const c of s.controls){assert.ok(c.rect.x>=0&&c.rect.y>=0&&c.rect.x+c.rect.w<=1400&&c.rect.y+c.rect.h<=900);}
   await shot('nearby-direction');await tap('pc-cancel');await wait();
   await page.locator('#rogue-canvas').focus();await page.keyboard.press('t');await wait('item');await tap('item-e');await wait('direction');
   assert.equal((await snap()).scene.directionOrigin,null,'Keyboard origin clears the old click');await tap('pc-cancel');await wait();
  }
  report.checks.push((phone?'phone':'pc')+': drag, pad-column exchange, drafts, independent defaults, assignment, reload and input isolation');await context.close();context=null;
 }
 // Production game.wasm uses a fresh context, with no fixture worker or C ABI override.
 // The browser adapter only exposes observations from the same Rust UI.
 report.layouts=[];
 for(phone of [false,true]){
  context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1400,height:900},hasTouch:phone,isMobile:phone});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view=pixels');
  await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);await page.locator('#name').fill('Controls');await page.locator('#seed').fill('17');await tap('new-game');await wait();
  const baseline=await game();
  if(!phone){
   const rows=[['mobile-movement','pc-inventory','pc-wield','pc-armor'],['pc-search','pc-throw','pc-zap','pc-read'],['touch-again','mobile-full-map','pc-eat','pc-quaff']];
   const labels=[['歩く','持ち物','武器','防具'],['探す','投げる','杖','巻物'],['繰返し','全体図','食べる','飲む']];
   for(const hand of ['right','left']){
    await tap('settings-toggle');if((await snap()).state.handedness!==hand)await tap('handedness-toggle');await tap('settings-close');
    const scene=(await snap()).scene;
    for(let row=0;row<rows.length;row++)for(let column=0;column<4;column++){
     const c=scene.controls.find(c=>c.id===rows[row][column]);assert.ok(c,'Production '+rows[row][column]);
     assert.ok(c.label.includes(labels[row][column]),c.id+' retains its caption');
     assert.deepEqual(c.rect,c.fullRect,c.id+' fully visible');
     assert.ok(c.rect.w>=48&&c.rect.h>=48);
     if(column){const previous=scene.controls.find(c=>c.id===rows[row][column-1]);assert.equal(c.rect.y,previous.rect.y);assert.ok(hand==='left'?c.rect.x>previous.rect.x:c.rect.x<previous.rect.x);}
     if(row){assert.ok(c.rect.y>scene.controls.find(c=>c.id===rows[row-1][column]).rect.y);}
    }
    const pad=scene.controls.find(c=>c.id==='touch-h').rect,first=scene.controls.find(c=>c.id===rows[0][0]).rect;
    assert.ok(hand==='left'?pad.x<first.x:pad.x>first.x);
    assert.ok(scene.controls.find(c=>c.id==='touch-h').rect.x<scene.controls.find(c=>c.id==='touch-l').rect.x);
    report.layouts.push({production:true,hand,controls:rows.flat().map(id=>scene.controls.find(c=>c.id===id))});
    await shot('production-'+hand+'-default');assert.deepEqual(await game(),baseline);
   }
   await page.setViewportSize({width:390,height:900});await paint();await shot('production-narrow-pc-default');assert.deepEqual(await game(),baseline);
   await page.setViewportSize({width:1400,height:900});await paint();
   await edit('layout');await shot('production-editor');await tap('controls-cancel');assert.deepEqual(await game(),baseline);
   await tap('pc-throw');await wait('item');
   const item=(await snap()).scene.controls.find(c=>/^item-[a-z]$/.test(c.id)&&!c.disabled);assert.ok(item,'Production starting inventory offers a throw item');
   await tap(item.id);await wait('direction');await shot('production-direction');await tap('pc-cancel');await wait();
   await verifyAssignedActions('pc-inventory','pc-wield');
   await page.keyboard.press('C');await paint();await binding('game.search');
   const beforeBinding=await prefs();await page.keyboard.press('Control+s');await paint();
   assert.deepEqual(await prefs(),beforeBinding,'A captured key remains a draft');await shot('production-key-capture');
   await page.keyboard.press('Enter');await paint();const searchBinding=await prefs();
   assert.deepEqual(searchBinding.bindings['game.search'],[{key:'s',ctrl:true,alt:false,shift:false}]);
   await binding('game.search');await page.keyboard.press('Control+Shift+s');await paint();await page.keyboard.press('Escape');await paint();
   assert.deepEqual(await prefs(),searchBinding,'Escape discards the candidate key');
   await binding('game.inventory');await page.keyboard.press('Control+Shift+s');await paint();await page.keyboard.press('Enter');await paint();
   const inventoryBinding=await prefs();assert.deepEqual(inventoryBinding.bindings['game.inventory'],[{key:'s',ctrl:true,alt:false,shift:true}]);
   await tap('commands-close');await page.keyboard.press('C');await paint();await binding('game.move-left',1);
   const aliasBefore=(await prefs()).bindings['game.move-left'];
   await page.keyboard.press('Alt+g');await paint();await page.keyboard.press('Alt+Shift+Enter');await paint();
   assert.ok((await snap()).scene.controls.some(c=>c.id==='key-binding-confirm'),'Modified Enter changes the candidate');
   assert.deepEqual((await prefs()).bindings['game.move-left'],aliasBefore);await shot('production-modified-enter');
   await page.keyboard.press('Enter');await paint();const aliases=(await prefs()).bindings['game.move-left'];
   assert.deepEqual(aliases[0],aliasBefore[0]);assert.deepEqual(aliases[2],aliasBefore[2]);
   assert.deepEqual(aliases[1],{key:'Enter',ctrl:false,alt:true,shift:true});
   await tap('commands-close');const beforeKeys=await game();
   await page.keyboard.press('s');await page.keyboard.press('i');await paint();assert.deepEqual(await game(),beforeKeys,'Removed keys do not revive original commands');
   await page.keyboard.press('Control+s');await wait();assert.equal((await game()).index,beforeKeys.index+1,'Ctrl+s executes Search once');
   await page.keyboard.press('Control+Shift+s');await wait('space');assert.equal((await snap()).state.frame.ui.inventory,true);
   await page.keyboard.press('Escape');await wait();const beforeAlt=await game();
   await page.keyboard.press('Alt+Shift+Enter');await wait();assert.equal((await game()).index,beforeAlt.index+1,'Alt+Shift+Enter executes its command once');
   const committedBindings=await prefs();await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.diagnostics?.ready);
   assert.deepEqual(await prefs(),committedBindings,'Reload preserves command keys and aliases');
   report.checks.push('pc: actual key cells capture Ctrl, Ctrl+Shift, Alt+Shift+Enter; confirmation, cancellation, alias preservation, old-key suppression, dispatch and reload');
  }else{
   const scene=(await snap()).scene;assert.equal(scene.controls.find(c=>c.id==='mobile-operations').label,'リスト');
   await shot('production-default');await edit('commands');await shot('production-editor');await tap('controls-cancel');assert.deepEqual(await game(),baseline);
   await verifyAssignedActions('touch-action-action.inventory','touch-search');
  }
  report.checks.push((phone?'phone':'pc')+': production game default/editor screenshots and unchanged game state');await context.close();context=null;
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.systemErrors,[]);
}catch(error){report.failure=error.stack;report.last=await snap().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

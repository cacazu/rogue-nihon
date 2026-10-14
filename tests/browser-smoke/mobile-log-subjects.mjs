import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadPlaywright, browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-log-subjects'));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const runtime=await prepareBrowserRuntime(root);
const {chromium}=loadPlaywright();
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const report={checks:[],screenshots:[],errors:[]};
let context,page,phone=true;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending}));
async function tap(id){
  const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);
  const box=await page.locator('#rogue-canvas').boundingBox();
  const x=box.x+c.rect.x+c.rect.w/2,y=box.y+c.rect.y+c.rect.h/2;
  if(phone)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();
}
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function start(mobile=true,language='ja'){
  await context?.close();phone=mobile;
  context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1240,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
  page=await context.newPage();await installBrowserTestAdapter(page);
  await page.addInitScript(()=>{const Native=Worker;window.Worker=class extends Native{set onmessage(handler){super.onmessage=handler;window.__subjectPacket=d=>handler({data:d});}};});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+language);
  await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));
  await tap('new-game');await idle();
}
async function body(){return page.evaluate(()=>{
  const s=__rogueBrowserTest.canvas,r=s.regions.log?.rect||s.controls.find(c=>c.id==='history-open').rect;
  let commands=__rogueBrowserTest.commands;
  if(s.controls.some(c=>c.id==='history-close')){
    const start=commands.findLastIndex(c=>c.op==='clip'&&c.rect.x===r.x&&c.rect.y===r.y&&c.rect.w===r.w&&c.rect.h===r.h);
    const rest=commands.slice(start+1),end=rest.findIndex(c=>c.op==='restore');commands=rest.slice(0,end);
  }
  return commands.filter(c=>c.op==='text'&&c.y>=r.y&&c.y<r.y+r.h).map(c=>c.text).join('');
});}
async function send(message){await page.evaluate(m=>__subjectPacket({type:'message',...m}),message);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,run){await run();report.checks.push(name);console.log('PASS '+name);}
const part=(id,args=[])=>({kind:'part',value:{id,args}});
const entity=value=>({kind:'entity',value});
const enemy={type:'monster',display:'name',index:7,role:'object'};
const bow=entity({type:'item',category:'weapon',which:2,count:1,identified:false});
const cases=[
  {id:'message.sequence',args:[part('armor.wear.you_are_now'),part('armor.wear.wearing',[bow])],text:'あなたは短弓を身につけた。',mobile:'短弓を身につけた。'},
  {id:'message.sequence',args:[part('weapons.wield.you_are_now'),part('weapons.wield.wielding',[bow,{kind:'signed',value:99}])],text:'あなたは短弓（c）を構えた。',mobile:'短弓を構えた。'},
  {id:'message.sequence',args:[part('pack.move_msg.you'),part('pack.move_msg.moved_onto',[bow])],text:'あなたは短弓の上に移動した。',mobile:'短弓の上に移動した。'},
  {id:'message.sequence',args:[part('fight.killed.you_have'),part('fight.killed.defeated_trailing_space'),part('message.entity',[entity(enemy)])],text:'あなたが倒した敵：ホブゴブリン',mobile:'倒した敵：ホブゴブリン'},
];
for(const [hit,index,text] of [[true,0,'ホブゴブリンに痛烈な一撃を与えた'],[true,2,'ホブゴブリンに傷を負わせた'],[true,3,'振りかぶり、ホブゴブリンに攻撃を当てた'],[false,1,'振りかぶったが、ホブゴブリンには当たらなかった']]){
  cases.push({id:'message.sequence',args:[part('message.entity',[entity({type:'monster',display:'you',role:'subject'})]),part('message.entity',[entity({type:'combat_verb',hit,index})]),part('message.entity',[entity(enemy)])],text:'あなたは'+text,mobile:text});
}
function recall(m){return {id:'command.command.string',args:[entity({type:'message',id:m.id,args:m.args})],text:m.text,mobile:m.mobile};}
const normalized=s=>s.replace(/\s/g,'');
try{
  await start();
  await check('all eight player statement patterns disappear from both phone logs and nested recalls',async()=>{
    const before=await state();
    for(const m of [...cases,...cases.map(recall)]){
      await send(m);assert.ok(normalized(await body()).includes(normalized(m.mobile)),m.text);
      assert.doesNotMatch(await body(),/あなた[はが]/);
      const stored=await page.evaluate(()=>__rogueBrowserTest.diagnostics.entries.at(-1).text);assert.equal(stored,m.text,'original history remains intact');
      await tap('history-open');const history=await body();assert.ok(normalized(history).includes(normalized(m.mobile)));assert.doesNotMatch(history,/あなた[はが]/);await tap('history-close');
    }
    assert.deepEqual(await state(),before);await shot('phone-short-subject-hidden');await tap('history-open');await shot('phone-history-subject-hidden');await tap('history-close');
  });
  await check('native phone inventory action omits the subject while keeping item parameter icons',async()=>{
    await tap('touch-action-action.inventory');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();
    const entries=await page.evaluate(()=>__rogueBrowserTest.frame.ui.lines.filter(r=>r.id==='ui.inventory.entry'));
    const item=entries.find(r=>r.args[1].value.category==='weapon'&&r.args[1].value.which===2);assert.ok(item);
    await tap('item-'+item.key);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-119');await idle();
    assert.ok((await body()).includes('構えた'));assert.doesNotMatch(await body(),/あなた[はが]/);
    const r=(await scene()).controls.find(c=>c.id==='history-open').rect;
    assert.ok((await scene()).icons.some(i=>i.name==='item-hit'&&i.rect.y>=r.y));await shot('phone-native-wield');
  });
  await check('literal text, user item names, enemy actors and your-attack messages remain intact',async()=>{
    for(const literal of ['あなたはという名前','あなたがという名前']){
      await send({id:'message.entity',args:[entity({type:'literal',text:literal})],text:literal});assert.ok((await body()).includes(literal));
    }
    const named={type:'item',category:'weapon',which:2,count:1,identified:false,label:'あなたが命名した弓'};
    await send({id:'message.sequence',args:[part('weapons.wield.you_are_now'),part('weapons.wield.wielding',[entity(named),{kind:'signed',value:99}])],text:'あなたは短弓 (命名：あなたが命名した弓)（c）を構えた。'});
    assert.ok(normalized(await body()).includes('命名：あなたが命名した弓'));assert.doesNotMatch(await body(),/^あなたは/);
    await send({id:'message.entity',args:[entity({type:'combat',hit:true,index:0,actor:{...enemy,role:'subject'},target:{type:'monster',display:'you',role:'object'}})],text:'ホブゴブリンはあなたに痛烈な一撃を与えた'});
    assert.ok(normalized(await body()).includes('ホブゴブリンはあなたに痛烈な一撃を与えた'));
    await send({id:'message.entity',args:[entity({type:'combat',hit:true,index:1,actor:{type:'monster',display:'you'},target:enemy})],text:'あなたの攻撃がホブゴブリンに命中した'});
    assert.ok(normalized(await body()).includes('あなたの攻撃がホブゴブリンに命中した'));
  });
  await start(false);
  await check('PC retains every subject and stored logs redraw correctly when switching display width',async()=>{
    await tap('history-open');
    for(const m of cases){await send(m);assert.ok(normalized(await body()).includes(normalized(m.text)));}
    await shot('pc-history-subject-visible');
    await page.setViewportSize({width:390,height:844});phone=true;await paint();assert.doesNotMatch(await body(),/あなた[はが]/);await shot('resized-phone-history');
    await page.setViewportSize({width:1240,height:900});phone=false;await paint();assert.ok((await body()).includes('あなたは'));await tap('history-close');
  });
  await start(true,'en');
  await check('English phone player subjects remain intact',async()=>{
    await send({id:'message.sequence',args:[part('armor.wear.you_are_now'),part('armor.wear.wearing',[bow])],text:'You are now wearing a short bow'});
    assert.ok((await body()).includes('You are now'));await tap('history-open');assert.ok((await body()).includes('You are now'));await tap('history-close');
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.observedTranslationFailures),[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

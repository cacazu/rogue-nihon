import {loadPlaywright, browserExecutable} from '../../tools/toolchain.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/wording-catalog'));
await mkdir(output,{recursive:true});
const {chromium} = loadPlaywright();
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};


let context,page,cdp,mobile=true;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,words:__rogueBrowserTest.trace.words,pending:__rogueBrowserTest.queuePending}));
async function idle(){await page.waitForFunction(()=>{if(__rogueBrowserTest.diagnostics.runtimeError)throw Error(__rogueBrowserTest.diagnostics.runtimeError);return __rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0;},null,{timeout:30000});await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.ok(Math.abs(c.rect.h-c.fullRect.h)<.01,id+' full height');assert.ok(Math.abs(c.rect.w-c.fullRect.w)<.01,id+' full width');const b=await page.locator('#rogue-canvas').boundingBox();const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(key){await page.keyboard.press(key);await paint();}
async function inventory(){if(mobile)await tap('touch-action-action.inventory');else await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(phone=true,lang='ja',fixture='inventory-all'){
 if(context)await context.close();mobile=phone;
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);await page.addInitScript(()=>{
 const NativeWorker=Worker;window.__wordingEvents=[];window.__wordingLogs=[];let current=null;
 window.Worker=class extends NativeWorker{set onmessage(handler){
  super.onmessage=event=>{const d=event.data;if(['error','log','exit'].includes(d.type))__wordingLogs.push(d);
   if(d.type==='log'&&d.text.startsWith('WORDING_CASE:')){current=d.text.slice(13);return;}
   else if(d.type==='message'&&current){window.__wordingEvents.push({case:current,message:d});current=null;return;}
   handler(event);
  };window.__wordingDeliver=data=>handler({data});
 }};
});cdp=await context.newCDPSession(page);
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang='+lang);await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await idle();await inventory();
}
async function scroll(region,distance){const r=(await scene()).regions[region].rect,b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2;
 if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=3;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-(region==='inventory-tabs'?distance*i/3:0),y:y-(region==='inventory-tabs'?0:distance*i/3),id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await page.mouse.move(x,y);await page.mouse.wheel(region==='inventory-tabs'?distance:0,region==='inventory-tabs'?0:distance);}await paint();}
async function tab(name){const id='inventory-tab-'+name;for(let i=0;i<15;i++){const s=await scene(),c=s.controls.find(c=>c.id===id);if(c&&Math.abs(c.rect.w-c.fullRect.w)<.01){await tap(id);return;}const order=['all','equipped','stick','food','potion','scroll','weapon','armor','ring'];const visible=s.controls.filter(c=>c.id.startsWith('inventory-tab-'));const first=order.indexOf(visible[0].id.slice(14));await scroll('inventory-tabs',c?(c.fullRect.x<s.regions['inventory-tabs'].rect.x?-110:110):(order.indexOf(name)<first?-110:110));}throw Error('Cannot select '+name);}
async function collectItems(){const found=new Map();for(let i=0;i<20;i++){const s=await scene();for(const c of s.controls.filter(c=>c.id.startsWith('item-')))found.set(c.id.slice(5),c.label);if(s.scrolls.dialog===s.regions.dialog.max)break;await scroll('dialog',Math.min(150,s.regions.dialog.rect.h/2));}return found;}
async function action(item,key){await tap('item-'+item);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-'+key);}
function descriptor(f,key){return f.ui.lines.find(row=>row.key===key).args[1].value;}

const manifest=JSON.parse(await readFile(path.join(root,'tests/wording-cases.generated.json'),'utf8'));
const samples=new Map();
try {
 report.sourceCalls=manifest.source_calls;report.catalogIds=manifest.catalog_ids;report.dynamicSites=manifest.dynamic_sites;report.native={};report.rendered={};
 for(const language of ['ja','en']){
  await start(true,language,'wording-catalog');await tap('window-32');await idle();
  const observed=await page.evaluate(()=>__wordingEvents);assert.equal(observed.length,manifest.cases.length,'Every generated case must emit a message');
  const byCase=new Map(observed.map(e=>[e.case,e.message]));const good=[];let negatives=0;
  for(const expected of manifest.cases){
   const message=byCase.get(expected.case);assert.ok(message,expected.case);assert.equal(message.id,expected.id,expected.case);
   const missing=message.fallback_used||message.missing_ids?.length>0;
   const negative=expected.negative&&(language==='ja'||expected.case.startsWith('negative:'));
   assert.equal(Boolean(missing),Boolean(negative),language+' '+expected.case+' '+JSON.stringify(message));
   assert.doesNotMatch(message.text,/\uFFFD/);if(negative)negatives++;else good.push({case:expected.case,message});
  }
  samples.set(language,good);report.native[language]={cases:observed.length,positive:good.length,negativeDetected:negatives};console.log('PASS native '+language+' '+observed.length+' cases');
 }
 for(const phone of [true,false])for(const language of ['ja','en']){
  await start(phone,language,null);await tap('window-32');await idle();await tap('history-open');await paint();
  const seen=new Set(),cases=samples.get(language).filter(e=>{
   if(!e.message.text.trim()||e.message.id==='message.clear')return false;
   const key=e.case.startsWith('site:')?'site:'+e.message.id:e.case.startsWith('id:')?'id:'+e.message.id:e.case.startsWith('item:')?'item:'+e.case.split(':').slice(1,2)+':'+e.case.split(':').slice(3).join(':'):e.case;
   if(seen.has(key))return false;seen.add(key);return true;
  });
  let checked=0;
  for(let offset=0;offset<cases.length;offset+=40){
   const result=await page.evaluate(async({cases,phone,language})=>{
    const normalize=text=>text.replace(/\s/g,'');let checked=0;
    let sequence=0;for(const sample of cases){
     const marker='⟦W'+(++sequence)+'⟧';__wordingDeliver({type:'message',id:'ui.text',args:[],text:marker});__wordingDeliver(sample.message);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     const s=__rogueBrowserTest.canvas,commands=__rogueBrowserTest.commands,entry=__rogueBrowserTest.diagnostics.entries.at(-1);
     if(__rogueBrowserTest.translationFallbacks.length)throw Error(sample.case+' translation fallback: '+JSON.stringify(__rogueBrowserTest.translationFallbacks.at(-1)));
     if(__rogueBrowserTest.uiMissing?.length)throw Error(sample.case+' missing UI label');
     const r=s.regions.log.rect;
     const start=commands.findLastIndex(c=>c.op==='clip'&&c.rect.x===r.x&&c.rect.y===r.y&&c.rect.w===r.w&&c.rect.h===r.h);
     const stop=commands.slice(start+1).findIndex(c=>c.op==='restore');const paint=commands.slice(start+1,start+1+stop),body=paint.filter(c=>c.op==='text');
     const markerPart=body.findLast(c=>c.text===marker);if(!markerPart)throw Error(sample.case+' marker missing');const own=body.filter(c=>c.y>markerPart.y);const text=own.map(c=>c.text).join('');if(text.includes('日本語訳を表示できません'))throw Error(sample.case+' visible translation error');
     const hasEntity=JSON.stringify(sample.message.args).includes('"entity"');
     const hidden=phone&&entry.mobile_keyboard_hint;
     const subjectOnly=phone&&language==='ja'&&['armor.wear.you_are_now','weapons.wield.you_are_now','pack.move_msg.you','fight.killed.you_have'].includes(sample.message.id);
     const expectedText=subjectOnly?'':sample.message.text;
     if(phone&&(sample.message.id.startsWith('prompt.direction')||JSON.stringify(sample.message.args).includes('"prompt.direction"'))&&!hidden)throw Error(sample.case+' phone direction instruction was not hidden');
     const mobileShortcut=phone&&['weapons.wield.wielding','rings.ring_off.was_wearing','armor.take_off.wearing','command.current.character_string','pack.picky_inven.character_string','ui.inventory.entry','pack.add_pack.string_character','rings.ring_on.string_character','pack.picky_inven.a'].includes(sample.message.id);
     if(!hidden&&!hasEntity&&!mobileShortcut&&!normalize(text).includes(normalize(expectedText)))throw Error(sample.case+' text lost: '+JSON.stringify({expected:expectedText,actual:text}));
     if(subjectOnly&&text.trim())throw Error(sample.case+' standalone player subject was rendered on phone');
     if(hidden&&own.length)throw Error(sample.case+' phone keyboard prompt was rendered');
     if(!hidden&&(hasEntity||mobileShortcut)&&!text.trim())throw Error(sample.case+' rich message missing');
     const items=value=>!value||typeof value!=='object'?[]:[...(value.type==='item'?[value]:[]),...Object.values(value).flatMap(items)];
     if(!hidden)for(const item of items(sample.message.args)){
      const known=item.category==='ring'&&item.known===true&&item.type_known!==false;const bonusIcon=known?({0:'shield',1:'strength',7:'item-hit',8:'item-damage'}[item.which]||'item-modifier'):'item-modifier';
      const fields=[['hplus','hplus','item-hit',true],['dplus','dplus','item-damage',true],['enchantment','ac','item-enchantment',true],['protection','ac','shield',false],['charges','charges','item-charges',false],['bonus','ring_bonus',bonusIcon,true]];
      const currentIcons=s.icons.filter(i=>i.rect.y>markerPart.y&&i.rect.y<r.y+r.h&&fields.some(f=>f[2]===i.name)&&(i.glyph==='💪'||paint.some(c=>c.op==='path'&&c.rect.x===i.rect.x&&c.rect.y===i.rect.y)));
      const expected=fields.filter(([field,visibility])=>item.visible_fields?.[visibility]===true&&Number.isInteger(item[field]));
      if(expected.length===0&&currentIcons.length)throw Error(sample.case+' hidden parameters leaked');
      for(const [field,,name,signed] of expected){const icon=currentIcons.find(i=>i.name===name);if(!icon)throw Error(sample.case+' missing parameter icon '+name);const value=own.find(c=>Math.abs(c.x-icon.rect.x-icon.rect.w-2)<.1&&c.y===icon.rect.y);const expectedValue=(signed&&item[field]>=0?'+':'')+item[field];if(!value?.text.endsWith(expectedValue))throw Error(sample.case+' wrong parameter '+field+': '+JSON.stringify({value,icon,text:own}));if(phone&&!/^[+-]?\d+$/.test(value.text))throw Error(sample.case+' phone parameter label was not removed');if(!phone&&!/[^+\d\s-]/.test(value.text))throw Error(sample.case+' PC parameter label missing');}
     }

     if(/[\uFFFD]/.test(text)||/\{[0-9]+\}/.test(text))throw Error(sample.case+' unexpanded or corrupt text');
     const ctx=document.getElementById('rogue-canvas').getContext('2d');
     for(const c of body){ctx.font=(c.bold?'600 ':'')+c.size+'px '+(c.mono?'Consolas, "Courier New", monospace':'system-ui, "Yu Gothic", sans-serif');if(c.x+ctx.measureText(c.text).width>r.x+r.w+1)throw Error(sample.case+' text outside log bounds');}
     checked++;
    }return checked;
   },{cases:cases.slice(offset,offset+40),phone,language});checked+=result;
   if(offset%200===0)console.log('Render '+(phone?'phone':'PC')+' '+language+' '+checked+'/'+cases.length);
  }
  report.rendered[(phone?'phone':'PC')+'-'+language]=checked;await shot((phone?'phone':'PC')+'-'+language+'-all-wording');
  await tap('history-close');await paint();
  if(phone){
   let shortCount=0;for(let offset=0;offset<cases.length;offset+=60){
    shortCount+=await page.evaluate(async ({cases,language})=>{for(const sample of cases){
     __wordingDeliver(sample.message);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     const scene=__rogueBrowserTest.canvas,r=scene.controls.find(c=>c.id==='history-open').rect,body=__rogueBrowserTest.commands.filter(c=>c.op==='text'&&c.y>=r.y&&c.y<r.y+r.h);
     if(new Set(body.map(c=>c.y)).size>2)throw Error(sample.case+' short log exceeded two lines');
     if(__rogueBrowserTest.observedTranslationFailures.length)throw Error(sample.case+' short log translation failure');
     const entry=__rogueBrowserTest.diagnostics.entries.at(-1),message=sample.message;
     const subjectOnly=language==='ja'&&['armor.wear.you_are_now','weapons.wield.you_are_now','pack.move_msg.you','fight.killed.you_have'].includes(message.id);
     const expectedText=subjectOnly?'':message.text;
     if(entry.source==='game'&&!entry.mobile_keyboard_hint&&!JSON.stringify(message.args).includes('"entity"')&&!['weapons.wield.wielding','rings.ring_off.was_wearing','armor.take_off.wearing','command.current.character_string','pack.picky_inven.character_string','ui.inventory.entry','pack.add_pack.string_character','rings.ring_on.string_character','pack.picky_inven.a'].includes(message.id)&&!message.text.includes('\n')){
      const ctx=document.getElementById('rogue-canvas').getContext('2d');ctx.font='17px system-ui, "Yu Gothic", sans-serif';
      if(ctx.measureText(expectedText).width<r.w-24&&!body.map(c=>c.text).join('').replace(/\s/g,'').includes(expectedText.replace(/\s/g,'')))throw Error(sample.case+' short log lost text that fits');
     }
    }return cases.length;},{cases:cases.slice(offset,offset+60),language});
    if(offset%240===0)console.log('Short phone '+language+' '+shortCount+'/'+cases.length);
   }report.rendered['phone-short-'+language]=shortCount;await shot('phone-'+language+'-short-wording');
  }
  report.checks.push((phone?'Phone':'PC')+' '+language+' native IDs and rendered logs');console.log('PASS '+report.checks.at(-1));
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.events=await page.evaluate(()=>__wordingEvents).catch(()=>[]);report.logs=await page.evaluate(()=>__wordingLogs).catch(()=>[]);report.diagnostics=await page.evaluate(()=>__rogueBrowserTest.diagnostics).catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

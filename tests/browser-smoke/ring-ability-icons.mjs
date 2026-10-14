import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';
import {createPreviewServer} from '../../../tools/server.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/ring-ability-icons'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),{chromium}=loadPlaywright();
const browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const abilities={0:{icon:'shield',ja:'防御力',en:'Protection'},1:{icon:'strength',ja:'腕力',en:'Strength'},7:{icon:'item-hit',ja:'命中',en:'Hit'},8:{icon:'item-damage',ja:'威力',en:'Damage'}};
const parameterNames=['shield','strength','item-hit','item-damage','item-modifier'];
const report={checks:[],screenshots:[],errors:[]};
let context,page,phone,locale;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount}));
const idle=()=>page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0&&!__rogueBrowserTest.diagnostics.windowClosing);
async function tap(id){await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);const c=(await scene()).controls.find(c=>c.id===id),b=await page.locator('#rogue-canvas').boundingBox();assert.ok(c.rect.h===c.fullRect.h&&c.rect.w===c.fullRect.w,id+' visible');const x=b.x+c.rect.x+c.rect.w/2,y=b.y+c.rect.y+c.rect.h/2;if(phone)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await paint();}
async function key(k){await page.locator('#rogue-canvas').focus();await page.keyboard.press(k);await paint();}
async function scroll(region,delta){const r=(await scene()).regions[region].rect,b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2;await page.mouse.move(x,y);await page.mouse.wheel(region==='inventory-tabs'?delta:0,region==='inventory-tabs'?0:delta);await paint();}
async function reveal(id,region='dialog'){for(let n=0;n<30;n++){const s=await scene(),c=s.controls.find(c=>c.id===id);if(c&&c.rect.h>0&&c.rect.h===c.fullRect.h&&c.rect.w===c.fullRect.w)return c;const r=s.regions[region].rect;await scroll(region,c&&(region==='inventory-tabs'?c.fullRect.x<r.x:c.fullRect.y<r.y)?-140:140);}throw Error('Unable to reveal '+id);}
async function inventory(){await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();await reveal('inventory-tab-ring','inventory-tabs');await tap('inventory-tab-ring');}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function rowIcon(key,expected,value){const c=await reveal('item-'+key),s=await scene();const icons=s.icons.filter(i=>parameterNames.includes(i.name)&&i.rect.x>=c.fullRect.x&&i.rect.x+i.rect.w<=c.fullRect.x+c.fullRect.w&&i.rect.y>=c.fullRect.y&&i.rect.y+i.rect.h<=c.fullRect.y+c.fullRect.h);assert.deepEqual(icons.map(i=>i.name),expected?[expected]:[],key+' ability icon');if(expected){const commands=await page.evaluate(()=>__rogueBrowserTest.commands);const number=commands.find(t=>t.op==='text'&&Math.abs(t.x-icons[0].rect.x-icons[0].rect.w-2)<.1&&t.y>=c.fullRect.y&&t.y<c.fullRect.y+c.fullRect.h);assert.equal(number?.text,value,key+' visible value');}assert.ok(!s.icons.some(i=>i.name==='item-bonus'));}
async function details(row,ability){await reveal('item-'+row.key);await tap('item-'+row.key);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();const actionRegion=(await scene()).regions.dialog.rect;assert.ok((await scene()).icons.some(i=>i.name===ability.icon&&i.rect.y>=actionRegion.y));await tap('window-118');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_details');await paint();const s=await scene(),r=s.regions.dialog.rect;assert.ok(s.icons.filter(i=>i.name===ability.icon&&i.rect.y>=r.y&&i.rect.y+i.rect.h<=r.y+r.h).length>=2);assert.ok(s.text.includes(ability[locale]+'：'+row.args[1].value.bonus));await shot(`${phone?'mobile':'pc'}-${locale}-details-${row.args[1].value.which}`);await tap('window-27');await tap('window-27');}
async function open(fixture,mobile=false,lang='ja'){await context?.close();phone=mobile;locale=lang;context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",',`    module.FS.writeFile("/fixture.id", ${JSON.stringify(fixture)});\n    module.FS.writeFile("/locale.txt",`),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/parameter-rings.js'),contentType:'text/javascript',headers}));page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);await page.goto(`http://127.0.0.1:${server.address().port}/?trace=1&lang=${locale}`);await tap('new-game');await idle();}
async function check(label,fn){await fn();report.checks.push(label);console.log('PASS '+label);}
try{
 for(const [mobile,lang] of [[false,'ja'],[true,'ja'],[false,'en']]){
  await open('parameter-rings',mobile,lang);await inventory();const before=await state(),rings=(await frame()).ui.lines.filter(r=>r.args?.[1]?.value?.category==='ring');assert.equal(rings.length,14);
  await check(`${phone?'mobile':'PC'} ${locale}: all 14 ring types, four numeric abilities, positive/negative/zero, selection and details`,async()=>{
   for(const row of rings){const item=row.args[1].value,ability=abilities[item.which];assert.equal(item.visible_fields.ring_bonus,!!ability);await rowIcon(row.key,ability?.icon,item.bonus>=0?'+'+item.bonus:String(item.bonus));if(ability)await details(row,ability);}
   assert.deepEqual((await state()).words,before.words);assert.equal(await page.evaluate(()=>__rogueBrowserTest.queuePending),0);
   await scroll('dialog',-2000);await shot(`${phone?'mobile':'pc'}-${locale}-rings`);
   if(phone){await page.setViewportSize({width:320,height:568});await paint();for(const row of rings.filter(r=>abilities[r.args[1].value.which])){const item=row.args[1].value;await rowIcon(row.key,abilities[item.which].icon,item.bonus>=0?'+'+item.bonus:String(item.bonus));}await shot('mobile-320-rings');await page.setViewportSize({width:390,height:844});await paint();}
  });
  await tap('window-32');await idle();await key('P');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='item');await paint();
  await check(`${phone?'mobile':'PC'} ${locale}: original item-selection window uses ability icons`,async()=>{for(const row of rings.filter(r=>abilities[r.args[1].value.which])){const item=row.args[1].value;await rowIcon(row.key,abilities[item.which].icon,item.bonus>=0?'+'+item.bonus:String(item.bonus));}await tap('window-27');await idle();});
  await check(`${phone?'mobile':'PC'} ${locale}: real ring equip logs and message history use all four abilities`,async()=>{
   for(const row of rings.filter(r=>abilities[r.args[1].value.which])){
    await key('P');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='item');await key(row.key);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='hand');await tap('window-108');await idle();
    const s=await scene(),r=s.regions.log?.rect||s.controls.find(c=>c.id==='history-open').rect;
    assert.ok(s.icons.some(i=>i.name===abilities[row.args[1].value.which].icon&&i.rect.x>=r.x&&i.rect.y>=r.y&&i.rect.y+i.rect.h<=r.y+r.h));
    await key('R');await idle();
   }
   await tap('history-open');await scroll('log',-2000);const seen=new Set();for(let n=0;n<12;n++){const s=await scene(),r=s.regions.log.rect;for(const icon of s.icons)if(icon.rect.x>=r.x&&icon.rect.x+icon.rect.w<=r.x+r.w&&icon.rect.y>=r.y&&icon.rect.y+icon.rect.h<=r.y+r.h)seen.add(icon.name);if(s.scrolls.log>=s.regions.log.max)break;await scroll('log',400);}for(const ability of Object.values(abilities))assert.ok(seen.has(ability.icon),ability.icon+' in history');
   await shot(`${phone?'mobile':'pc'}-${locale}-message-history`);await tap('history-close');
  });
 }
 for(const mobile of [false,true]){
  await open('parameter-rings-unknown',mobile);await inventory();
  await check(`${phone?'mobile':'PC'}: unknown identities remain hidden; a visible called bonus uses the generic modifier`,async()=>{for(const row of (await frame()).ui.lines.filter(r=>r.args?.[1]?.value?.category==='ring')){const item=row.args[1].value;assert.equal(item.known,false);assert.equal(item.which,null);await rowIcon(row.key,item.visible_fields.ring_bonus?'item-modifier':null,'+7');}await shot(`${phone?'mobile':'pc'}-unknown-rings`);});
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

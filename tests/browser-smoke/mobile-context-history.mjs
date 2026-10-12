import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../../../tools/server.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {installBrowserTestAdapter} from './test-adapter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/mobile-context-history'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let page,context,cdp;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function tap(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.equal(c.rect.h,c.fullRect.h,id+' fully visible');const b=await page.locator('#rogue-canvas').boundingBox();if(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches))await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);else await page.mouse.click(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();}
async function key(key){await page.evaluate(key=>__rogueBrowserTest.enqueue(key),key);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(fixture,width=390,height=844,mobile=true){
 if(context)await context.close();
 context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);
 // Presentation-only flag checks, separate from the real C command checks below.
 await page.addInitScript(()=>{const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(handler){super.onmessage=handler;window.__contextUi=ui=>handler({data:{type:'presentation',ui}});}};});
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await idle();
}
async function swipe(){const s=await scene(),r=s.regions['mobile-operations'].rect,b=await page.locator('#rogue-canvas').boundingBox(),x=b.x+r.x+r.w/2,y=b.y+r.y+r.h*.75;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=3;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-r.h*.5*i/3,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await paint();}
async function list(expected){await tap('mobile-operations');const found=new Set();for(let i=0;i<10;i++){const s=await scene();for(const c of s.controls)if(c.id.startsWith('mobile-op-'))found.add(Number(c.id.slice(10)));assert.ok(!s.controls.some(c=>c.id==='mobile-movement'));if(s.scrolls['mobile-operations']===s.regions['mobile-operations'].max)break;await swipe();}assert.deepEqual([...found].sort((a,b)=>a-b),expected.sort((a,b)=>a-b));await tap('mobile-operations-close');}
async function inventory(){await key(105);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();}
async function history(name){
 await inventory();const f=await frame(),s=await scene(),h=s.controls.find(c=>c.id==='inventory-history'),close=s.controls.find(c=>c.id.startsWith('window-'));
 assert.ok(h);assert.equal(h.label,'アイテム履歴');assert.equal(h.rect.y,close.rect.y+7);assert.ok(h.rect.x+h.rect.w+8<=close.rect.x);assert.equal(h.rect.h,20);await shot(name+'-inventory');
 await tap('inventory-history');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.id==='input.close');await paint();assert.deepEqual((await frame()).player,f.player);assert.ok(!(await scene()).controls.some(c=>c.id==='window-42'));await paint();assert.ok((await scene()).text.some(t=>t.includes('回復')||t.includes('防具')));await shot(name+'-history');
 const id=(await scene()).controls.find(c=>c.id==='window-32'||c.id==='window-close')?.id;assert.ok(id);await tap(id);await idle();assert.deepEqual((await frame()).player,f.player);
 // Returning to inventory after D must not leave a pending command or item.
 await inventory();await tap('item-a');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();assert.ok(!(await scene()).controls.some(c=>c.id==='inventory-history'));await tap('window-27');await paint();assert.ok((await scene()).controls.some(c=>c.id==='inventory-history'));await tap('window-32');await idle();
}
try {
 await start('inventory-context');
 await check('phone labels fit 390px and 320px and the list removes specified and duplicate actions',async()=>{
  for(const [width,height]of [[390,844],[320,568]]){await page.setViewportSize({width,height});await paint();const s=await scene();assert.equal(s.controls.find(c=>c.id==='mobile-operations').label,'リスト');assert.equal(s.controls.find(c=>c.id==='touch-again').label,'繰返し\n長押し');assert.equal(s.controls.find(c=>c.id==='touch-search').label,'探す');await shot('phone-'+width+'-dock');await list([109,44,94,62,102,70]);}
  await page.setViewportSize({width:390,height:844});await paint();
 });
 await check('normal search runs; an adjacent hidden trap does not change the button',async()=>{assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'探す');await tap('touch-l');await idle();const p=(await frame()).player;await tap('touch-search');await idle();assert.deepEqual((await frame()).player,p);await tap('touch-h');await idle();assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'探す');});
 await check('phone inventory header opens original discovery and remains usable after closing',()=>history('phone-390'));
 await check('320px inventory header stays beside its title and clear of the close button',async()=>{await page.setViewportSize({width:320,height:568});await paint();await inventory();const s=await scene(),h=s.controls.find(c=>c.id==='inventory-history'),x=s.controls.find(c=>c.id==='window-32');assert.ok(h.rect.x+h.rect.w+8<=x.rect.x);await shot('phone-320-inventory');await tap('window-32');await idle();await page.setViewportSize({width:390,height:844});await paint();});
 await check('dropping an item changes the context button to 拾う and it picks up the real floor item',async()=>{
  await inventory();await tap('item-a');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-100');await idle();assert.equal((await frame()).map_player_surface.tile,17);assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'拾う');await list([109,115,94,62,102,70]);await shot('phone-pickup');await tap('touch-search');await idle();assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'探す');await inventory();assert.ok((await scene()).controls.some(c=>c.id==='item-a'));await tap('window-32');await idle();
 });
 await check('a visible adjacent trap changes to 罠調査 and the original direction query works',async()=>{
  await tap('touch-j');await idle();assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'罠調査');await list([109,44,115,62,102,70]);await shot('phone-trap');await tap('touch-search');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==='direction');await paint();await tap('touch-j');await idle();assert.ok((await frame()).ui.message.text.includes('矢'));await tap('touch-k');await idle();assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'探す');
 });
 await check('stairs change to 下りる and execute the original descent',async()=>{for(let i=0;i<5;i++){await tap('touch-l');await idle();}assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'下りる');await list([109,44,115,94,102,70]);await shot('phone-descent');await tap('touch-search');await idle();assert.equal((await frame()).ui.status.args[0].value,2);});
 await start('inventory-amulet');
 await check('an amulet changes stairs to 上る and executes the original ascent',async()=>{assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'上る');await list([109,44,115,94,62,102,70]);await shot('phone-ascent');await tap('touch-search');await idle();assert.equal((await frame()).ui.status.args[0].value,1);});
 await start('inventory-all',1240,900,false);
 await check('PC inventory header opens the original discovery and closes correctly',()=>history('pc'));
 await start(null,390,844,true);
 await check('published normal game includes the new header and native discovery transition',async()=>{await inventory();assert.ok((await scene()).controls.some(c=>c.id==='inventory-history'));await tap('inventory-history');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.id==='input.close');await paint();await tap('window-32');await idle();});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

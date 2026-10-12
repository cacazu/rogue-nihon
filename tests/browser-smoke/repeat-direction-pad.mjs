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
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/repeat-direction-pad'));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const runtime=await prepareBrowserRuntime(root);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:runtime.downloadsPath});
const worker=await readFile(path.join(root,'web/worker.js'),'utf8');
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const report={checks:[],screenshots:[],errors:[]};
let resumed=!process.env.ROGUE_REPEAT_FROM;
if(!resumed){const previous=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));report.checks.push(...previous.checks);report.screenshots.push(...previous.screenshots);}
let context,page,cdp,mobile=true;
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const frame=()=>page.evaluate(()=>__rogueBrowserTest.frame);
const state=()=>page.evaluate(()=>({input:__rogueBrowserTest.inputRequestCount,words:__rogueBrowserTest.trace.words,pending:__rogueBrowserTest.queuePending,player:__rogueBrowserTest.frame.player}));
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function idle(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='command'&&__rogueBrowserTest.queuePending===0);await paint();}
async function point(id){const c=(await scene()).controls.find(c=>c.id===id);assert.ok(c&&!c.disabled,id);assert.equal(c.rect.h,c.fullRect.h,id+' fully visible');const b=await page.locator('#rogue-canvas').boundingBox();return{x:b.x+c.rect.x+c.rect.w/2,y:b.y+c.rect.y+c.rect.h/2};}
async function tap(id){const p=await point(id);if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);await paint();}
async function key(key){await page.keyboard.press(key);await paint();}
async function down(id){const p=await point(id);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});return p;}
async function up(type='touchEnd'){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[]});await paint();}
async function hold(){await down('touch-again');await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==='repeat-count');await up();assert.equal((await scene()).scope,'repeat-count');}
async function fill(value){await page.locator('#repeat-count').fill(value);await paint();}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function check(name,fn){if(!resumed){if(!name.includes(process.env.ROGUE_REPEAT_FROM))return;resumed=true;}await fn();report.checks.push(name);console.log('PASS '+name);}
async function start(fixture='inventory-all',phone=true){
 if(context)await context.close();mobile=phone;
 context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1240,height:900},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1});
 if(fixture){await context.route('**/web/worker.js',r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:'text/javascript',headers}));await context.route('**/build/game.js',r=>r.fulfill({path:path.join(root,'build/game-fixtures.js'),contentType:'text/javascript',headers}));}
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await installBrowserTestAdapter(page);cdp=await context.newCDPSession(page);
 await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja');await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==='new-game'&&!c.disabled));await tap('new-game');await idle();
}
async function aim(){await page.waitForFunction(()=>__rogueBrowserTest.frame?.ui.input.kind==='direction'&&__rogueBrowserTest.frame.ui.movement_direction===true);await paint();const f=await frame(),s=await scene();assert.equal(f.ui.window,null);assert.ok(!s.regions.dialog);assert.ok(!s.controls.some(c=>c.id.startsWith('window-')));assert.equal(f.ui.map_controls.directions.length,8);assert.ok(!s.controls.some(c=>c.id==='touch-.'));if(mobile){const commands=await page.evaluate(()=>__rogueBrowserTest.commands);for(const id of ['h','j','k','l','y','u','b','n']){const c=s.controls.find(c=>c.id==='touch-'+id);assert.ok(c&&!c.disabled);assert.ok(commands.some(box=>box.op==='box'&&box.fill==='#6b3d1b'&&box.rect.x===c.rect.x&&box.rect.y===c.rect.y),'Highlighted '+id);}assert.ok(s.controls.some(c=>c.id==='touch-action-action.cancel'));}}
async function inventory(){await key('i');await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.inventory===true);await paint();}
async function itemAction(item,action){await inventory();await tap('item-'+item);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window.kind==='inventory_actions');await paint();await tap('window-'+action);}
try {
 await start();
 await check('initial repeat is one execution and displays 繰返し / 長押し',async()=>{assert.equal((await scene()).controls.find(c=>c.id==='touch-again').label,'繰返し\n長押し');await shot('phone-repeat-default');await tap('touch-search');await idle();const before=await state();await tap('touch-again');await page.waitForFunction(n=>__rogueBrowserTest.trace.words[13]===n+1,before.words[13]);await idle();assert.equal((await state()).input,before.input+1);});
 await check('long press opens numeric entry without executing or changing C state',async()=>{const before=await state();await hold();assert.deepEqual(await state(),before);assert.equal(await page.locator('#repeat-count').inputValue(),'1');assert.equal(await page.locator('#repeat-count').getAttribute('inputmode'),'numeric');const s=await scene(),x=s.controls.find(c=>c.id==='repeat-count-close');assert.ok(x.rect.w>=48&&x.rect.h>=48);assert.ok(s.icons.some(i=>i.name==='close'));await shot('phone-repeat-dialog');await key('h');assert.deepEqual(await state(),before);});
 await check('invalid counts remain in the dialog; setting 20 shows 20 without game input',async()=>{const before=await state();for(const value of ['0','256','1.5','']){await fill(value);await tap('repeat-count-submit');assert.equal((await scene()).scope,'repeat-count');assert.ok((await scene()).text.includes('1〜255の整数を入力してください。'));assert.deepEqual(await state(),before);}await fill('20');await key('Enter');assert.equal((await scene()).scope,'game');assert.equal((await scene()).controls.find(c=>c.id==='touch-again').label,'繰返し\n20');assert.deepEqual(await state(),before);await shot('phone-repeat-20');});
 await check('a short repeat tap sends the native 20a and repeats exactly 20 turns',async()=>{const before=await state();await tap('touch-again');await page.waitForFunction(n=>__rogueBrowserTest.trace.words[13]>=n+20,before.words[13]);await idle();assert.equal((await state()).words[13],before.words[13]+20);assert.deepEqual((await state()).player,before.player);});
 await check('320px repeat text fits and cancellation keeps 20; moving or cancelling a hold does nothing',async()=>{await page.setViewportSize({width:320,height:568});await paint();await shot('phone-320-repeat-20');const before=await state();await hold();assert.equal(await page.locator('#repeat-count').inputValue(),'20');await fill('7');await tap('repeat-count-close');assert.equal((await scene()).controls.find(c=>c.id==='touch-again').label,'繰返し\n20');await hold();await fill('8');await key('Escape');assert.equal((await scene()).controls.find(c=>c.id==='touch-again').label,'繰返し\n20');const p=await down('touch-again');await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+35,y:p.y,id:1}]});await page.waitForTimeout(550);await up();assert.equal((await scene()).scope,'game');await down('touch-again');await up('touchCancel');await page.waitForTimeout(550);assert.equal((await scene()).scope,'game');assert.deepEqual(await state(),before);await page.setViewportSize({width:390,height:844});await paint();});
 await check('starting another game resets repeat to one',async()=>{await tap('settings-toggle');await tap('settings-top');await page.waitForFunction(()=>__rogueBrowserTest.topOpen===true);await paint();await tap('new-game');await idle();assert.equal((await scene()).controls.find(c=>c.id==='touch-again').label,'繰返し\n長押し');});
 await check('all six original direction commands use the highlighted pad and cancel safely',async()=>{for(const command of ['m','^','f','F','t','z']){const before=await state();await key(command);await aim();await shot('phone-direction-'+(command==='^'?'trap':command));await tap('touch-action-action.cancel');await idle();assert.equal((await state()).words[13],before.words[13]);assert.deepEqual((await state()).player,before.player);}});
 await check('no-pickup from the list moves with the pad and leaves the floor item',async()=>{await tap('touch-l');await idle();await itemAction('a',100);await idle();await tap('touch-h');await idle();await tap('mobile-operations');await tap('mobile-op-109');await aim();const before=await state();await tap('touch-l');await idle();assert.equal((await state()).player.x,before.player.x+1);assert.equal((await frame()).map_player_surface.tile,17);assert.equal((await scene()).controls.find(c=>c.id==='touch-search').label,'拾う');await tap('touch-search');await idle();});
 await check('f and F direction choices execute their original no-enemy result',async()=>{for(const command of ['f','F']){await key(command);await aim();const before=(await state()).player;await tap('touch-l');await idle();assert.deepEqual((await state()).player,before);assert.ok((await frame()).ui.message.text.includes('怪物'));}});
 await check('staff and throw selected from inventory use pad directions and consume their chosen item',async()=>{await itemAction('j',122);await aim();await tap('touch-k');await idle();await inventory();const staff=(await frame()).ui.lines.find(row=>row.key==='j');assert.equal(staff.args[1].value.charges,4);await tap('window-32');await idle();await itemAction('e',116);await aim();await tap('touch-k');await idle();await inventory();assert.equal((await frame()).ui.lines.find(row=>row.key==='e').args[1].value.count,26);await tap('window-32');await idle();});
 await check('holding a direction selects once on release and never auto-repeats while aiming',async()=>{await key('m');await aim();const before=await state();await down('touch-j');await page.waitForTimeout(600);assert.deepEqual(await state(),before);await up();await idle();assert.equal((await state()).input,before.input+1);assert.equal((await state()).player.y,before.player.y+1);});
 await start('inventory-context');
 await check('visible trap investigation completes with the movement pad',async()=>{await tap('touch-j');await idle();await tap('touch-search');await aim();await tap('touch-j');await idle();assert.ok((await frame()).ui.message.text.includes('矢'));});
 await start('inventory-all',false);
 await check('PC uses the same six direction prompts without windows; Shift selects one direction',async()=>{for(const command of ['m','^','f','F','t','z']){await key(command);await aim();await key('Escape');await idle();}await key('m');await aim();const before=(await state()).player;await key('Shift+ArrowRight');await idle();assert.equal((await state()).player.x,before.x+1);assert.equal((await frame()).ui.movement_direction,false);await shot('pc-after-direction');});
 await start(null);
 await check('published normal game opens the count dialog and no-pickup pad',async()=>{const before=await state();await hold();assert.deepEqual(await state(),before);await fill('2');await tap('repeat-count-submit');assert.equal((await scene()).controls.find(c=>c.id==='touch-again').label,'繰返し\n2');await key('m');await aim();await tap('touch-action-action.cancel');await idle();});
 await check('keyboard-sized viewport keeps the count field, confirm and X inside the screen',async()=>{await hold();await page.evaluate(()=>{Object.defineProperty(screen,'width',{configurable:true,value:320});Object.defineProperty(screen,'height',{configurable:true,value:844});});await page.setViewportSize({width:320,height:300});await paint();const s=await scene();for(const id of ['repeat-count','repeat-count-submit','repeat-count-close']){const c=s.controls.find(c=>c.id===id);assert.ok(c.rect.y>=0&&c.rect.y+c.rect.h<=s.height,id+' fits');}await shot('phone-keyboard-sized-repeat');const before=await state();await fill('3');await tap('repeat-count-submit');assert.deepEqual(await state(),before);await page.setViewportSize({width:390,height:844});await paint();assert.equal((await scene()).controls.find(c=>c.id==='touch-again').label,'繰返し\n3');});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;report.last=await scene().catch(()=>null);report.frame=await frame().catch(()=>null);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await runtime.dispose();await new Promise(r=>server.close(r));console.log('Evidence: '+output);}

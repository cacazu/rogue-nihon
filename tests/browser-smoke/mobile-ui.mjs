import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createPreviewServer} from "../../../tools/server.mjs";
import {artifactDirectory} from "../../tools/temporary-artifacts.mjs";
import {prepareBrowserRuntime} from "./browser-runtime.mjs";
import {installBrowserTestAdapter} from "./test-adapter.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const output=artifactDirectory(path.join(root,"tests/browser-smoke/output/mobile-ui"));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=createPreviewServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port+"/";
const evidence={checks:[],screenshots:[],errors:[],started_at:new Date().toISOString()};
let runtime,browser,context,page,cdp;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,player:__rogueBrowserTest.frame.player}));
async function tap(id){
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  const c=(await scene()).controls.find(c=>c.id===id);
  const b=await page.locator("#rogue-canvas").boundingBox();
  await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();
}
async function swipe(x,y,toY){
  const b=await page.locator("#rogue-canvas").boundingBox();x+=b.x;y+=b.y;toY+=b.y;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1}]});
  for(let i=1;i<=6;i++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:y+(toY-y)*i/6,id:1}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await paint();
}
async function reveal(id,region="settings"){
  for(let i=0;i<20;i++){
    const s=await scene(),c=s.controls.find(c=>c.id===id);
    if(c&&c.rect.h>=47.9)return;
    const r=s.regions[region].rect;await swipe(r.x+r.w/2,r.y+r.h-40,r.y+40);
  }
  throw Error("Unable to reveal "+id);
}
async function shot(name){await page.screenshot({path:path.join(output,name+".png")});evidence.screenshots.push(name+".png");}
async function check(label,fn){await fn();evidence.checks.push(label);console.log("PASS "+label);}
async function send(id){const before=await state();await tap(id);await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,before.input);await paint();}
try{
  runtime=await prepareBrowserRuntime(root);
  browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:true,args:["--disable-gpu"],downloadsPath:runtime.downloadsPath});
  evidence.browser=browser.version();
  for(const lang of ["ja","en"]){
    await context?.close();context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,acceptDownloads:true});
    page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);
    page.on("pageerror",e=>evidence.errors.push(e.message));cdp=await context.newCDPSession(page);
    await page.goto(base+"?trace=1&view=pixels&lang="+lang);await page.waitForFunction(()=>__rogueBrowserTest.canvas?.paintCount>0);
    await check(lang+" phone top shows title, start and load without a game map",async()=>{
      const s=await scene();assert.equal(s.scope,"top");assert.equal(s.mapRect,null);assert.ok(s.text.includes("ROGUE"));
      assert.deepEqual(s.controls.map(c=>c.id),["name","random-name","seed","random-seed","select-language","new-game","load","credits-repository","settings-toggle"]);
      assert.ok(s.controls.find(c=>c.id==="load").disabled);
      for(const c of s.controls)assert.ok(c.rect.w>=48&&c.rect.h>=48,c.id);
      assert.equal(s.regions.log,undefined);await shot(lang+"-initial");
    });
    await check(lang+" top fits small portrait and landscape without scrolling",async()=>{
      for(const viewport of [{width:320,height:568},{width:844,height:390},{width:568,height:320}]){
        await page.setViewportSize(viewport);await paint();const s=await scene();
        assert.equal(s.regions.top.max,0);assert.equal(s.scrolls.top,0);
        for(const id of ["name","random-name","seed","random-seed","select-language","new-game","load","credits-repository","settings-toggle"]){
          const c=s.controls.find(c=>c.id===id);assert.ok(c&&c.rect.w>=48&&c.rect.h>=48,id);assert.ok(c.rect.y>=0&&c.rect.y+c.rect.h<=s.height,id);
        }
        assert.equal(await page.evaluate(()=>__rogueBrowserTest.generation),0);await shot(lang+"-top-"+viewport.width+"x"+viewport.height);
      }
      await page.setViewportSize({width:390,height:844});await paint();
    });
    await tap("settings-toggle");
    for(const id of ["name","seed","random-name","random-seed","new-game","load","settings-load"])assert.ok(!(await scene()).controls.some(c=>c.id===id),id);
    await tap("settings-close");
    await tap("random-name");await tap("random-seed");assert.equal(await page.evaluate(()=>__rogueBrowserTest.generation),0);
    await tap("seed");await page.keyboard.press("Control+a");await page.keyboard.insertText("-1");
    await tap("new-game");await paint();assert.equal(await page.evaluate(()=>__rogueBrowserTest.generation),0);
    assert.ok((await scene()).text.some(t=>lang==="ja"?t.includes("シードは"):t.includes("Seed must")));
    for(const [id,value] of [["name","Mobile123"],["seed","123"]]){await tap(id);await page.keyboard.press("Control+a");await page.keyboard.insertText(value);}
    await tap("new-game");await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);await paint();
    await check(lang+" game starts with seed123 and controls are visible immediately",async()=>{
      assert.deepEqual((await state()).player,{x:23,y:10});
      assert.ok((await scene()).controls.some(c=>c.id==="touch-j"));
      const s=await scene();for(const c of s.controls.filter(c=>!c.id.startsWith("hud-"))){assert.ok(c.rect.w>=48&&c.rect.h>=48,c.id);assert.ok(c.rect.y+c.rect.h<=s.height,c.id);}
      assert.equal(s.regions.log,undefined);assert.ok(s.hud.items.some(i=>i.id==="hunger"));await shot(lang+"-dock");
    });
    await check(lang+" map overview and fullscreen do not consume C/RNG input",async()=>{
      const before=await state();assert.equal((await scene()).camera.size,32);
      await tap("mobile-map");assert.equal((await scene()).camera.size,16);await tap("mobile-map");assert.equal((await scene()).camera.size,32);
      await tap("settings-toggle");assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false);
      await tap("fullscreen");await page.waitForFunction(()=>!!document.fullscreenElement);await tap("fullscreen");await page.waitForFunction(()=>!document.fullscreenElement);await tap("settings-close");
      assert.deepEqual(await state(),before);
    });
    await check(lang+" zoom controls, center location and touch cancellation preserve C/RNG",async()=>{
      const before=await state();
      await tap("mobile-map");assert.equal((await scene()).camera.size,16);await tap("settings-toggle");assert.ok(!(await scene()).controls.some(c=>c.id==="center-map"));
      assert.ok(!(await scene()).controls.some(c=>["select-language","tile-zoom"].includes(c.id)));
      assert.ok(!(await scene()).text.some(t=>t.includes("迷宮に入りました")||t.includes("地図の表示")||t.includes("倍率")));
      await tap("settings-close");await tap("mobile-map");assert.equal((await scene()).camera.size,32);
      await tap("mobile-operations");await reveal("center-map","mobile-operations");await tap("center-map");await tap("mobile-operations-close");
      assert.deepEqual(await state(),before);
      const r=(await scene()).mapRect,b=await page.locator("#rogue-canvas").boundingBox();
      const x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2;
      for(const spread of [90,25,110,20]){
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:x-40,y,id:1},{x:x+40,y,id:2}]});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-spread,y,id:1},{x:x+spread,y,id:2}]});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await paint();
      }
      assert.deepEqual(await state(),before);
      await tap("mobile-map");assert.equal((await scene()).camera.size,16);await tap("mobile-map");
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1}]});
      await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});await paint();assert.deepEqual(await state(),before);
      const c=(await scene()).controls.find(c=>c.id==="touch-j");
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:b.x+c.rect.x+c.rect.w/2,y:b.y+c.rect.y+c.rect.h/2,id:1}]});
      await page.waitForTimeout(800);assert.deepEqual(await state(),before);
      await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});await paint();assert.deepEqual(await state(),before);
      const suppressed=await page.locator('#canvas-controls button').first().evaluate(el=>({context:!el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})),selection:getComputedStyle(el).userSelect}));
      assert.equal(suppressed.context,true);assert.equal(suppressed.selection,"none");await shot(lang+"-zoom-longpress");
    });
    await check(lang+" operations swipe on a button, block background input, and expose every command",async()=>{
      const before=await state();await tap("mobile-operations");await page.keyboard.press(".");await page.keyboard.press("h");await page.touchscreen.tap(4,320);assert.deepEqual(await state(),before);
      const c=(await scene()).controls.find(c=>c.id==="mobile-op-101");
      await swipe(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2,200);
      assert.ok((await scene()).scrolls["mobile-operations"]>200);assert.deepEqual(await state(),before);
      const ids=new Set((await scene()).controls.map(c=>c.id));
      for(let i=0;i<10;i++){
        const s=await scene(),r=s.regions["mobile-operations"].rect;
        for(const c of s.controls)if(c.rect.h>=47.9)ids.add(c.id);
        if(s.scrolls["mobile-operations"]===s.regions["mobile-operations"].max)break;
        await swipe(r.x+r.w/2,r.y+r.h-40,r.y+40);
      }
      // Includes commands above the initial swipe as well as the full tail.
      await page.keyboard.press("PageUp");await tap("mobile-operations-close");await tap("mobile-operations");
      for(const c of (await scene()).controls)if(c.rect.h>=47.9)ids.add(c.id);
      for(const key of [105,115,116,113,114,101,122,119,87,84,80,82,100,44,109,102,70,46,97,62,99,73,68,47,94,41,93,61,64,27,48,49,50,51,52,53,54,55,56,57])assert.ok(ids.has("mobile-op-"+key),"command "+key);
      assert.ok(!ids.has("mobile-op-60"),"ascending is hidden before the Amulet");
      await shot(lang+"-operations");await tap("mobile-operations-close");assert.deepEqual(await state(),before);
    });
    await check(lang+" inventory and throw keep their existing rows and actions",async()=>{
      await send("touch-action-action.inventory");
      const ui=await page.evaluate(()=>__rogueBrowserTest.frame.ui);
      assert.equal(ui.window.kind,"menu");assert.equal(ui.lines.filter(l=>l.selectable).length,5);
      await send("item-e");assert.ok((await scene()).controls.some(c=>c.id==="window-116"));await shot(lang+"-item-actions");
      await send("window-116");assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.ui.input.kind),"direction");
      assert.equal((await scene()).controls.filter(c=>/^touch-[hjklyubn]$/.test(c.id)).length,8);await shot(lang+"-throw-direction");
      await send("touch-action-action.cancel");
    });
    await check(lang+" item selection keeps item data and keys while hiding PC commands and cancel explanation",async()=>{
      await tap("mobile-operations");await reveal("mobile-op-119","mobile-operations");await send("mobile-op-119");
      const ui=await page.evaluate(()=>__rogueBrowserTest.frame.ui),s=await scene();
      assert.equal(ui.input.kind,"item");
      for(const line of ui.lines.filter(l=>l.selectable)){
        const control=s.controls.find(c=>c.id==="item-"+line.key);assert.ok(control,line.key);
        assert.equal(control.key,line.key);assert.ok(!control.label.startsWith(line.key+") "));
        assert.equal(control.label,line.text.replace(new RegExp("^"+line.key+"\\) "),""));
      }
      assert.ok(!s.text.some(t=>t.includes("*で一覧")||t.includes("やめるには")||t.includes("Esc:")));
      await shot(lang+"-item-selection");await send("window-27");
    });
    await check(lang+" movement, search, save and top load use the existing game paths",async()=>{
      await send("touch-j");assert.deepEqual((await state()).player,{x:23,y:11});await send("touch-search");
      await tap("settings-toggle");await tap("save");await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);await paint();
      const saved=await state(),generation=await page.evaluate(()=>__rogueBrowserTest.generation);
      await tap("settings-close");await send("touch-j");assert.equal((await state()).words[13],saved.words[13]+1);
      await tap("settings-toggle");await reveal("settings-top");await tap("settings-top");await tap("load");await page.waitForFunction(n=>__rogueBrowserTest.generation>n&&__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0,generation);
      assert.deepEqual((await state()).words,saved.words);assert.deepEqual((await state()).player,saved.player);
    });
    await check(lang+" returning to top and reloading the page allows saved-game resume",async()=>{
      const saved=await state();
      await tap("settings-toggle");await reveal("settings-top");await tap("settings-top");
      assert.equal((await scene()).scope,"top");assert.equal((await scene()).mapRect,null);
      assert.equal(await page.evaluate(()=>__rogueBrowserTest.running),false);
      assert.ok(!(await scene()).controls.find(c=>c.id==="load").disabled);await shot(lang+"-top-saved");
      await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==="load"&&!c.disabled));
      assert.equal((await scene()).scope,"top");await tap("load");
      await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);await paint();
      assert.deepEqual((await state()).words,saved.words);assert.deepEqual((await state()).player,saved.player);
      await send("touch-j");
      assert.equal((await state()).words[13],saved.words[13]+1);
    });
    await check(lang+" settings swipe on buttons reaches system controls without a game turn",async()=>{
      const before=await state();await page.setViewportSize({width:390,height:568});await paint();await tap("settings-toggle");const r=(await scene()).controls.find(c=>c.id==="save").rect;
      await swipe(r.x+r.w/2,r.y+r.h/2,80);assert.ok((await scene()).scrolls.settings>0);
      for(const key of [111,81])await reveal("mobile-system-"+key);
      await shot(lang+"-system-settings");assert.deepEqual(await state(),before);await tap("settings-close");await page.setViewportSize({width:390,height:844});await paint();
    });
    await check(lang+" 320px portrait and phone landscape retain 48px targets and usable map",async()=>{
      const before=await state();for(const viewport of [{width:320,height:568},{width:844,height:390},{width:390,height:844}]){
        await page.setViewportSize(viewport);await paint();const s=await scene();assert.ok(s.mapRect.h>0);
        for(const c of s.controls.filter(c=>!c.id.startsWith("hud-"))){assert.ok(c.rect.w>=48&&c.rect.h>=48,c.id);assert.ok(c.rect.x+c.rect.w<=s.width,c.id);assert.ok(c.rect.y+c.rect.h<=s.height,c.id);}
        const controls=s.controls;for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
          const a=controls[i].rect,b=controls[j].rect;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,"overlap "+controls[i].id+" "+controls[j].id);
        }
        assert.deepEqual(await state(),before);await shot(lang+"-"+viewport.width+"x"+viewport.height);
      }
    });
    assert.deepEqual(await page.evaluate(()=>({missing:__rogueBrowserTest.uiMissing,fallbacks:__rogueBrowserTest.translationFallbacks})),{missing:[],fallbacks:[]});
  }
  await check("switching a narrow mouse window to desktop closes the operations modal",async()=>{
    await context.close();context=await browser.newContext({viewport:{width:390,height:844},hasTouch:false});
    page=await context.newPage();await installBrowserTestAdapter(page);await page.goto(base+"?trace=1&view=pixels");await page.waitForFunction(()=>__rogueBrowserTest.canvas?.paintCount>0);
    const mouseTap=async id=>{const c=(await scene()).controls.find(c=>c.id===id&&!c.disabled),b=await page.locator("#rogue-canvas").boundingBox();assert.ok(c,id);await page.mouse.click(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();};
    await mouseTap("seed");await page.keyboard.insertText("123");await mouseTap("new-game");
    await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);
    await mouseTap("mobile-operations");const before=await state();
    await page.setViewportSize({width:1280,height:900});await paint();assert.equal((await scene()).scope,"game");assert.deepEqual(await state(),before);
    await page.keyboard.press(".");await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,before.input);assert.equal((await state()).words[13],before.words[13]+1);await shot("mouse-desktop-resize");
  });
  assert.deepEqual(evidence.errors,[]);evidence.result="pass";
}catch(e){evidence.result="fail";evidence.failure=e.stack;throw e;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

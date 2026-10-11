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
  await page.touchscreen.tap(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2);await paint();
}
async function swipe(x,y,toY){
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
    await check(lang+" initial screen contains only fullscreen and settings",async()=>{
      assert.deepEqual((await scene()).controls.map(c=>c.id),["header-fullscreen","settings-toggle"]);
      assert.equal((await scene()).regions.log,undefined);await shot(lang+"-initial");
    });
    await tap("settings-toggle");
    await tap("random-name");await tap("random-seed");assert.equal(await page.evaluate(()=>__rogueBrowserTest.generation),0);
    for(const [id,value] of [["name","Mobile123"],["seed","123"]]){await tap(id);await page.keyboard.press("Control+a");await page.keyboard.insertText(value);}
    await tap("new-game");await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);await paint();
    await check(lang+" game starts with seed123 and controls can be enabled in settings",async()=>{
      assert.deepEqual((await state()).player,{x:23,y:10});
      assert.deepEqual((await scene()).controls.map(c=>c.id),["header-fullscreen","settings-toggle"]);
      const before=await state();await tap("settings-toggle");await tap("mobile-controls");assert.deepEqual(await state(),before);
      const s=await scene();for(const c of s.controls){assert.ok(c.rect.w>=48&&c.rect.h>=48,c.id);assert.ok(c.rect.y+c.rect.h<=s.height,c.id);}
      assert.equal(s.regions.log,undefined);assert.ok(s.text.includes(lang==="ja"?"空腹なし":"Not hungry"));await shot(lang+"-dock");
    });
    await check(lang+" map overview and fullscreen do not consume C/RNG input",async()=>{
      const before=await state();assert.equal((await scene()).camera.size,32);
      await tap("mobile-map");assert.equal((await scene()).camera.size,16);await tap("mobile-map");assert.equal((await scene()).camera.size,32);
      await tap("header-fullscreen");await page.waitForFunction(()=>!!document.fullscreenElement);await tap("header-fullscreen");await page.waitForFunction(()=>!document.fullscreenElement);
      assert.deepEqual(await state(),before);
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
      for(const key of [105,115,116,113,114,101,122,119,87,84,80,82,100,44,109,102,70,46,97,62,60,99,73,68,47,94,41,93,61,64,63,27,48,49,50,51,52,53,54,55,56,57])assert.ok(ids.has("mobile-op-"+key),"command "+key);
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
    await check(lang+" movement, search, save and direct load use the existing game paths",async()=>{
      await send("touch-j");assert.deepEqual((await state()).player,{x:23,y:11});await send("touch-search");
      await tap("settings-toggle");await tap("save");await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);await paint();
      const saved=await state(),generation=await page.evaluate(()=>__rogueBrowserTest.generation);
      await tap("settings-close");await send("touch-j");assert.equal((await state()).words[13],saved.words[13]+1);
      await tap("settings-toggle");await tap("settings-load");await page.waitForFunction(n=>__rogueBrowserTest.generation>n&&__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0,generation);
      assert.deepEqual((await state()).words,saved.words);assert.deepEqual((await state()).player,saved.player);
    });
    await check(lang+" settings swipe on buttons reaches system controls without a game turn",async()=>{
      const before=await state();await tap("settings-toggle");const r=(await scene()).controls.find(c=>c.id==="save").rect;
      await swipe(r.x+r.w/2,r.y+r.h/2,80);assert.ok((await scene()).scrolls.settings>0);
      for(const key of [111,81,118,18,16,33])await reveal("mobile-system-"+key);
      await shot(lang+"-system-settings");assert.deepEqual(await state(),before);await tap("settings-close");
    });
    await check(lang+" 320px portrait and phone landscape retain 48px targets and usable map",async()=>{
      const before=await state();for(const viewport of [{width:320,height:568},{width:844,height:390},{width:390,height:844}]){
        await page.setViewportSize(viewport);await paint();const s=await scene();assert.ok(s.mapRect.h>0);
        for(const c of s.controls){assert.ok(c.rect.w>=48&&c.rect.h>=48,c.id);assert.ok(c.rect.x+c.rect.w<=s.width,c.id);assert.ok(c.rect.y+c.rect.h<=s.height,c.id);}
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
    const mouseTap=async id=>{const c=(await scene()).controls.find(c=>c.id===id&&!c.disabled);assert.ok(c,id);await page.mouse.click(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2);await paint();};
    await mouseTap("settings-toggle");await mouseTap("seed");await page.keyboard.insertText("123");await mouseTap("new-game");
    await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);
    await mouseTap("settings-toggle");await mouseTap("mobile-controls");await mouseTap("mobile-operations");const before=await state();
    await page.setViewportSize({width:1280,height:900});await paint();assert.equal((await scene()).scope,"game");assert.deepEqual(await state(),before);
    await page.keyboard.press(".");await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,before.input);assert.equal((await state()).words[13],before.words[13]+1);await shot("mouse-desktop-resize");
  });
  assert.deepEqual(evidence.errors,[]);evidence.result="pass";
}catch(e){evidence.result="fail";evidence.failure=e.stack;throw e;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

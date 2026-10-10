import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createPreviewServer} from "../../web/server.mjs";
import {prepareBrowserRuntime} from "./browser-runtime.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url)),output=artifactDirectory(path.join(root,"tests/browser-smoke/output/hud-widgets"));
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port+"/",evidence={started_at:new Date().toISOString(),checks:[],screenshots:[],layouts:[],errors:[]};
let browser,context,page,runtime;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,frameCount:__rogueBrowserTest.frameCount}));
async function check(label,fn){await fn();evidence.checks.push(label);console.log("PASS "+label);}
async function click(id,touch=false){
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  const r=(await scene()).controls.find(c=>c.id===id).rect;
  if(touch)await page.touchscreen.tap(r.x+r.w/2,r.y+r.h/2);
  else await page.mouse.click(r.x+r.w/2,r.y+r.h/2);
  await paint();
}
async function shot(name,clip){await page.screenshot({path:path.join(output,name+".png"),...(clip?{clip}:{})});evidence.screenshots.push(name+".png");}
async function start(lang,touch=false,scale=1){
  await context?.close();context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1240,height:900},hasTouch:touch,isMobile:touch,deviceScaleFactor:scale});
  page=await context.newPage();await installBrowserTestAdapter(page);page.on("pageerror",error=>evidence.errors.push(error.message));
  await page.addInitScript(()=>{
    const NativeWorker=Worker;
    window.Worker=class extends NativeWorker {
      set onmessage(handler){super.onmessage=handler;window.__hudPresentation=ui=>handler({data:{type:"presentation",ui}});}
    };
  });
  await page.goto(base+"?trace=1&view=pixels&lang="+lang);
  await page.waitForFunction(()=>window.__rogueBrowserTest?.canvas?.paintCount>0);
  for(const [id,value] of [["name",lang==="ja"?"勇者".repeat(8):"LongPlayerName".repeat(3)],["seed","17"]]){
    await click(id,touch);await page.keyboard.press("Control+a");await page.keyboard.insertText(value);
  }
  await click("new-game",touch);
  await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);
  await paint();
}
function assertLayout(s){
  assert.equal(s.uiOwner,"rust");
  const hud=s.hud;assert.ok(hud);assert.equal(hud.items.length,7);
  assert.deepEqual(hud.items.map(item=>item.id),["depth","gold","hp","strength","armor","experience","hunger"]);
  for(const [index,item] of hud.items.entries()){
    assert.equal(item.rect.y,hud.row.y);assert.ok(item.rect.x>=hud.row.x-.01);
    assert.ok(item.rect.x+item.rect.w<=hud.row.x+hud.row.w+.01,item.id+" fits in the row");
    assert.ok(item.valueRect.x+item.valueRect.w<=item.rect.x+item.rect.w+.1,item.id+" value fits its target");
    assert.ok(item.iconRect.y>=item.rect.y&&item.iconRect.y+item.iconRect.h<=item.rect.y+item.rect.h);
    if(index)assert.ok(item.rect.x>=hud.items[index-1].rect.x+hud.items[index-1].rect.w-.01);
    for(const control of s.controls.filter(control=>control.id.startsWith("touch-"))){
      const r=control.rect;assert.ok(item.rect.x+item.rect.w<=r.x||r.x+r.w<=item.rect.x||item.rect.y+item.rect.h<=r.y||r.y+r.h<=item.rect.y,"HUD and touch controls must not overlap");
    }
  }
  const gear=s.icons.find(icon=>icon.name==="settings"),button=s.controls.find(control=>control.id==="settings-toggle");
  assert.ok(gear&&button);for(const axis of ["x","y"]){const dimension=axis==="x"?"w":"h";assert.equal(gear.rect[axis]+gear.rect[dimension]/2,button.rect[axis]+button.rect[dimension]/2);}
}
function assertTooltip(s){
  const tooltip=s.hud.tooltip;assert.ok(tooltip);
  for(const control of s.controls.filter(control=>control.id.startsWith("touch-"))){
    const a=tooltip.rect,b=control.rect;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,"HUD detail must not hide touch controls");
  }
}

try{
  runtime=await prepareBrowserRuntime(root);
  browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:true,downloadsPath:runtime.downloadsPath,args:["--disable-gpu"]});
  evidence.browser=browser.version();
  for(const [lang,touch,scale] of [["ja",false,1],["ja",true,2],["en",true,1]]){
    await start(lang,touch,scale);
    for(const viewport of touch?[{width:320,height:844},{width:360,height:800},{width:390,height:844},{width:844,height:390}]:[{width:1240,height:900},{width:700,height:900}]){
      await check(`${lang} ${touch?"touch":"PC"} ${viewport.width}px HUD fits one row and gear stays centered`,async()=>{
        const before=await state();await page.setViewportSize(viewport);await paint();let s=await scene();assertLayout(s);
        assert.ok(s.hud.items.every(item=>item.size>=10));
        const args=await page.evaluate(()=>__rogueBrowserTest.frame.ui.status.args.map(arg=>arg.value));
        assert.equal(s.hud.items.find(item=>item.id==="hp").text,args[2]+"/"+args[3]);
        assert.ok(!s.text.some(text=>text.includes("所持金：")||text.includes("Gold:")));
        assert.deepEqual(await state(),before);
        evidence.layouts.push({lang,touch,scale,width:viewport.width,hud:s.hud});
        await shot(`${lang}-${touch?"touch":"pc"}-${viewport.width}`);
        if(lang==="ja"&&((touch&&viewport.width===320)||(!touch&&viewport.width===1240))){
          const r=s.hud.panel;await shot(`${lang}-${touch?"touch":"pc"}-hud`,{x:r.x-2,y:r.y-2,width:r.w+4,height:r.h+4});
        }
      });
    }
    await check(`${lang} HUD details use mouse/touch/keyboard without advancing the game`,async()=>{
      const before=await state();await click("hud-hp",touch);
      let s=await scene();assert.equal(s.hud.tooltip.id,"hp");assert.match(s.hud.tooltip.text,lang==="ja"?/体力：/u:/Health：/u);
      assertTooltip(s);
      await shot(`${lang}-${touch?"touch":"pc"}-details`);assert.deepEqual(await state(),before);
      await page.keyboard.press("Escape");await paint();assert.equal((await scene()).hud.tooltip,null);
      for(const id of ["depth","gold","strength","armor","experience","hunger"]){
        await click("hud-"+id,touch);const s=await scene();assert.equal(s.hud.tooltip.id,id);assertTooltip(s);
        await page.keyboard.press("Escape");await paint();
      }
      // Tab into status widgets and activate a detail with Enter.
      for(let n=0;n<25;n++){
        await page.keyboard.press("Tab");await paint();
        if((await scene()).pointer.focusId==="hud-strength")break;
      }
      assert.equal((await scene()).pointer.focusId,"hud-strength");await page.keyboard.press("Enter");await paint();
      assert.equal((await scene()).hud.tooltip.id,"strength");assert.deepEqual(await state(),before);
      await page.keyboard.press("Escape");await paint();
    });
    await check(`${lang} setting icon opens and close icon dismisses settings without C input`,async()=>{
      const before=await state();await click("settings-toggle",touch);assert.equal((await scene()).scope,"settings");
      const s=await scene(),icon=s.icons.find(icon=>icon.name==="close"),button=s.controls.find(control=>control.id==="settings-close");
      for(const [axis,dimension] of [["x","w"],["y","h"]])assert.equal(icon.rect[axis]+icon.rect[dimension]/2,button.rect[axis]+button.rect[dimension]/2);
      await shot(`${lang}-${touch?"touch":"pc"}-settings`);await click("settings-close",touch);assert.equal((await scene()).scope,"game");assert.deepEqual(await state(),before);
    });
    await check(`${lang} large values and all hunger states remain visible at 320px`,async()=>{
      await page.setViewportSize({width:320,height:844});await paint();const before=await state();
      const original=await page.evaluate(()=>structuredClone(__rogueBrowserTest.frame.ui.status.args));
      for(const hunger of ["0","1","2","3"]){
        // Presentation-only stress data: C state and input remain untouched.
        await page.evaluate(hunger=>{const values=[99,2147483647,12345,12345,31,31,-10,21,2147483647,"status.hunger."+hunger];const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args=values.map(value=>({value}));__hudPresentation(ui);},hunger);
        await paint();let s=await scene();assertLayout(s);assert.equal(s.hud.compact,true);assert.ok(s.hud.items.every(item=>item.size>=10));
        await click("hud-gold",touch);assert.match((await scene()).hud.tooltip.text,/2147483647/);
        await click("hud-hunger",touch);assert.ok((await scene()).hud.tooltip.text.length>5);
        await shot(`${lang}-${touch?"touch":"pc"}-large-hunger-${hunger}`);await page.keyboard.press("Escape");await paint();
        assert.deepEqual(await state(),before);
      }
      await page.evaluate(args=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args=args;__hudPresentation(ui);},original);await paint();
    });
    await check(`${lang} inventory and movement still work after HUD interactions`,async()=>{
      const before=await state();await page.keyboard.press("i");await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window);await paint();
      assert.ok((await scene()).controls.some(control=>control.id==="window-32"));assert.ok(!(await scene()).controls.some(control=>control.id==="hud-hp"));
      await click("window-32",touch);await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
      await page.keyboard.press(".");await page.waitForFunction(words=>__rogueBrowserTest.trace.words[13]>words[13],before.words);
      await paint();assertLayout(await scene());
    });
    assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.translationFallbacks),[]);
    assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.uiMissing),[]);
  }
  assert.deepEqual(evidence.errors,[]);
  evidence.files=await Promise.all(["web/app.js","web/canvas-ui.js","build/browser-ui.wasm","rust/crates/browser-display/src/controller.rs","rust/crates/browser-display/src/policies.rs","rust/crates/display/src/browser_ui/tiles.rs","rust/crates/display/src/widgets.rs","rust/crates/display/src/browser_ui/mod.rs","rust/crates/display/src/browser_ui/hud.rs","rust/crates/display/src/browser_ui/screens.rs","rust/crates/display/src/browser_ui/interaction.rs","web/index.html","locales/ui-web-ja.json","locales/ui-web-en.json"].map(async file=>({file,sha256:createHash("sha256").update(await readFile(path.join(root,file))).digest("hex")})));
  evidence.result="pass";
}catch(error){evidence.result="fail";evidence.failure=error.stack;if(page){evidence.scene=await scene().catch(()=>null);await shot("failure").catch(()=>{});}throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

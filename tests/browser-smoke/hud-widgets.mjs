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
async function swipe(from,to){
  const cdp=await context.newCDPSession(page);
  try{
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...from,id:1}]});
    for(let n=1;n<=6;n++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:from.x+(to.x-from.x)*n/6,y:from.y+(to.y-from.y)*n/6,id:1}]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await paint();
  }finally{await cdp.detach();}
}
async function click(id,touch=false){
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  if(id.startsWith("hud-")){
    for(let attempt=0;attempt<4;attempt++){
      const hud=(await scene()).hud,item=hud.items.find(item=>"hud-"+item.id===id),row=hud.row;
      const delta=item.rect.x<row.x?item.rect.x-row.x:Math.max(0,item.rect.x+item.rect.w-row.x-row.w);
      if(Math.abs(delta)<1)break;
      if(touch){
        const distance=Math.min(row.w-32,Math.max(12,Math.abs(delta))),y=row.y+row.h/2;
        const x=delta>0?row.x+row.w-16:row.x+16;
        await swipe({x,y},{x:x+(delta>0?-distance:distance),y});
      }else{
        const target=Math.max(0,Math.min(hud.maxScroll,hud.offset+delta));
        await page.mouse.move(row.x+row.w/2,row.y+row.h/2);await page.mouse.wheel(delta,0);
        await page.waitForFunction(target=>Math.abs(__rogueBrowserTest.canvas.hud.offset-target)<1,target);
        await paint();
      }
    }
  }
  const r=(await scene()).controls.find(c=>c.id===id).rect;
  if(touch)await page.touchscreen.tap(r.x+r.w/2,r.y+r.h/2);
  else await page.mouse.click(r.x+r.w/2,r.y+r.h/2);
  await paint();
}
async function shot(name,clip){await page.screenshot({path:path.join(output,name+".png"),...(clip?{clip}:{})});evidence.screenshots.push(name+".png");}
async function start(lang,touch=false,scale=1,fixture=""){
  await context?.close();context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1240,height:900},hasTouch:touch,isMobile:touch,deviceScaleFactor:scale});
  if(fixture){
    const worker=await readFile(path.join(root,"web/worker.js"),"utf8");
    const headers={"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp","Cross-Origin-Resource-Policy":"same-origin"};
    await context.route("**/web/worker.js",r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:"text/javascript",headers}));
    await context.route("**/build/game.js",r=>r.fulfill({path:path.join(root,"build/game-fixtures.js"),contentType:"text/javascript",headers}));
  }
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
  const hud=s.hud;assert.ok(hud);assert.equal(hud.items.length,8);
  assert.deepEqual(hud.items.map(item=>item.id),["depth","gold","hp","strength","armor","level","experience","hunger"]);
  assert.equal(hud.nameRect.y,hud.row.y);
  assert.ok(Math.abs(hud.nameRect.x-(hud.row.x-hud.offset))<.01);
  assert.ok(hud.offset>=0&&hud.offset<=hud.maxScroll+.01);
  let previous=hud.nameRect;
  for(const [index,item] of hud.items.entries()){
    assert.equal(item.rect.y,hud.row.y);
    const gap=item.id==="experience"?0:10;
    assert.ok(Math.abs(item.rect.x-(previous.x+previous.w+gap))<.01,item.id+" stays packed to the left");
    previous=item.rect;
    assert.ok(item.size>=18,item.id+" stays readable instead of shrinking");
    assert.ok(item.valueRect.x+item.valueRect.w<=item.rect.x+item.rect.w+.1,item.id+" value fits its target");
    assert.ok(item.iconRect.y>=item.rect.y&&item.iconRect.y+item.iconRect.h<=item.rect.y+item.rect.h);
    if(index)assert.ok(item.rect.x>=hud.items[index-1].rect.x+hud.items[index-1].rect.w-.01);
    for(const control of s.controls.filter(control=>control.id.startsWith("touch-"))){
      const r=control.rect;assert.ok(item.rect.x+item.rect.w<=r.x||r.x+r.w<=item.rect.x||item.rect.y+item.rect.h<=r.y||r.y+r.h<=item.rect.y,"HUD and touch controls must not overlap");
    }
  }
  const gear=s.icons.find(icon=>icon.name==="settings"),button=s.controls.find(control=>control.id==="settings-toggle");
  assert.ok(gear&&button);for(const axis of ["x","y"]){const dimension=axis==="x"?"w":"h";assert.equal(gear.rect[axis]+gear.rect[dimension]/2,button.rect[axis]+button.rect[dimension]/2);}
  const a=button.rect,b=hud.panel;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,"settings stays outside the name/status panel");
  assert.ok(s.icons.some(icon=>icon.name==="stairs"&&!icon.glyph));
  assert.ok(!s.icons.some(icon=>icon.glyph==="F"||icon.glyph==="Lv"));
  assert.equal(s.icons.find(icon=>icon.name==="strength").glyph,"💪");
  assert.equal(s.icons.find(icon=>icon.name==="level").glyph,"👑");
  assert.equal(s.icons.find(icon=>icon.name==="experience").glyph,"☆");
  const level=hud.items.find(item=>item.id==="level"),experience=hud.items.find(item=>item.id==="experience");
  assert.equal(experience.separator,"=");
  assert.ok(experience.separatorRect.x>=level.valueRect.x+level.valueRect.w);
  assert.ok(experience.separatorRect.x+experience.separatorRect.w<=experience.iconRect.x);
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
      await check(`${lang} ${touch?"touch":"PC"} ${viewport.width}px name and status form one readable left-aligned row outside settings`,async()=>{
        const before=await state();await page.setViewportSize(viewport);await paint();let s=await scene();assertLayout(s);
        const args=await page.evaluate(()=>__rogueBrowserTest.frame.ui.status.args.map(arg=>arg.value));
        assert.equal(s.hud.items.find(item=>item.id==="depth").text,String(-args[0]));
        assert.equal(s.hud.items.find(item=>item.id==="hp").text,args[2]+"/"+args[3]);
        assert.equal(s.hud.items.find(item=>item.id==="experience").text,String(args[8]));
        assert.equal(s.hud.items.find(item=>item.id==="level").text,String(args[7]));
        if(!s.fullscreen){
          const title=lang==="ja"?"元祖 ROGUE · 5.4.4":"ORIGINAL ROGUE · 5.4.4";
          assert.equal(s.text.filter(text=>text===title).length,1);
          assert.equal(await page.title(),title);
          const runs=await page.evaluate(()=>__rogueBrowserTest.commands.filter(command=>command.op==="text"));
          assert.ok(runs.every(run=>run.size>=16));
          assert.ok(runs.find(run=>run.text===title).y<72);
        }
        assert.ok(!s.text.some(text=>text.includes("所持金：")||text.includes("Gold:")));
        assert.deepEqual(await state(),before);
        evidence.layouts.push({lang,touch,scale,width:viewport.width,hud:s.hud});
        await shot(`${lang}-${touch?"touch":"pc"}-${viewport.width}`);
        if(lang==="ja"&&((touch&&viewport.width===320)||(!touch&&viewport.width===1240))){
          const r=s.hud.panel;await shot(`${lang}-${touch?"touch":"pc"}-hud`,{x:r.x-2,y:r.y-2,width:r.w+4,height:r.h+4});
        }
      });
    }
    await check(`${lang} horizontal HUD navigation keeps every value readable and does not pan the map or advance C`,async()=>{
      await page.setViewportSize({width:320,height:844});await paint();
      const before=await state(),camera=(await scene()).camera;
      await click("hud-hunger",touch);let s=await scene();assert.ok(s.hud.offset>0);assertTooltip(s);
      await shot(`${lang}-${touch?"touch":"pc"}-hud-scrolled`);
      await click("hud-depth",touch);s=await scene();assert.equal(s.hud.tooltip.id,"depth");
      assert.deepEqual(s.camera,camera);assert.deepEqual(await state(),before);
      await page.keyboard.press("Escape");await paint();
    });
    await check(`${lang} crown level and star experience read as 👑3=☆12 with separate details`,async()=>{
      const before=await state();
      const original=await page.evaluate(()=>structuredClone(__rogueBrowserTest.frame.ui.status.args));
      await page.evaluate(()=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args[0].value=2;ui.status.args[7].value=3;ui.status.args[8].value=12;__hudPresentation(ui);});
      await paint();let s=await scene();assertLayout(s);
      assert.equal(s.hud.items.find(item=>item.id==="depth").text,"-2");
      const items=s.hud.items.filter(item=>["level","experience"].includes(item.id));
      assert.equal(items.map(item=>item.separator+s.icons.find(icon=>icon.name===item.id).glyph+item.text).join(""),"👑3=☆12");
      await click("hud-level",touch);assert.equal((await scene()).hud.tooltip.text,lang==="ja"?"レベル：3":"Level：3");
      await click("hud-experience",touch);assert.equal((await scene()).hud.tooltip.text,lang==="ja"?"経験値：12":"Experience points：12");
      await page.keyboard.press("Escape");await paint();
      s=await scene();
      await shot(`${lang}-${touch?"touch":"pc"}-level-experience`);
      if(!touch){await page.setViewportSize({width:1240,height:900});await paint();s=await scene();const r=s.hud.panel;await shot("ja-pc-level3-hud",{x:r.x-2,y:r.y-2,width:r.w+4,height:r.h+4});}
      assert.deepEqual(await state(),before);
      await page.evaluate(args=>{const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args=args;__hudPresentation(ui);},original);await paint();
    });
    await check(`${lang} HUD details use mouse/touch/keyboard without advancing the game`,async()=>{
      const before=await state();await click("hud-hp",touch);
      let s=await scene();assert.equal(s.hud.tooltip.id,"hp");assert.match(s.hud.tooltip.text,lang==="ja"?/体力：/u:/Health：/u);
      assertTooltip(s);
      await shot(`${lang}-${touch?"touch":"pc"}-details`);assert.deepEqual(await state(),before);
      await page.keyboard.press("Escape");await paint();assert.equal((await scene()).hud.tooltip,null);
      for(const id of ["depth","gold","strength","armor","experience","level","hunger"]){
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
    if(touch)await check(`${lang} mobile fullscreen keeps settings outside the HUD and preserves game state`,async()=>{
      const before=await state();await click("settings-toggle",true);await click("fullscreen",true);
      await page.waitForFunction(()=>Boolean(document.fullscreenElement)&&__rogueBrowserTest.canvas.fullscreen);
      await click("settings-close",true);const s=await scene();assertLayout(s);
      assert.ok(!s.text.some(text=>text.includes("ROGUE")));
      await shot(`${lang}-touch-fullscreen`);
      await click("settings-toggle",true);await click("settings-close",true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(()=>!document.fullscreenElement&&!__rogueBrowserTest.canvas.fullscreen);
      assert.deepEqual(await state(),before);
    });
    await check(`${lang} large values and all hunger states remain visible at 320px`,async()=>{
      await page.setViewportSize({width:320,height:844});await paint();const before=await state();
      const original=await page.evaluate(()=>structuredClone(__rogueBrowserTest.frame.ui.status.args));
      for(const hunger of ["0","1","2","3"]){
        // Presentation-only stress data: C state and input remain untouched.
        await page.evaluate(hunger=>{const values=[99,2147483647,12345,12345,31,31,-10,21,2147483647,"status.hunger."+hunger];const ui=structuredClone(__rogueBrowserTest.frame.ui);ui.status.args=values.map(value=>({value}));__hudPresentation(ui);},hunger);
        await paint();let s=await scene();assertLayout(s);assert.equal(s.hud.compact,true);
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
  for(const touch of [false,true]){
    await check(`${touch?"mobile":"PC"} actual staircase descent displays -1 then -2`,async()=>{
      await start("ja",touch,touch?2:1,"plain");
      assert.equal((await scene()).hud.items.find(item=>item.id==="depth").text,"-1");
      for(const key of ["l","l","l","l","l",">"]){
        if(key===">")assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.map_player_underlay.tile),6);
        const before=(await state()).input;
        if(key===">"&&touch)await click("touch-action-action.descend",true);
        else await page.keyboard.press(key);
        await page.waitForFunction(input=>__rogueBrowserTest.inputRequestCount>input&&__rogueBrowserTest.queuePending===0,before);
        await paint();
      }
      assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.stats.level),2);
      assert.equal((await scene()).hud.items.find(item=>item.id==="depth").text,"-2");
      await click("hud-depth",touch);assert.match((await scene()).hud.tooltip.text,/-2$/);
      await page.keyboard.press("Escape");await paint();await shot(`${touch?"touch":"pc"}-descended-level2`);
    });
  }
  assert.deepEqual(evidence.errors,[]);
  evidence.files=await Promise.all(["web/app.js","web/canvas-ui.js","build/browser-ui.wasm","rust/crates/browser-display/src/controller.rs","rust/crates/browser-display/src/policies.rs","rust/crates/display/src/browser_ui/tiles.rs","rust/crates/display/src/widgets.rs","rust/crates/display/src/browser_ui/mod.rs","rust/crates/display/src/browser_ui/hud.rs","rust/crates/display/src/browser_ui/screens.rs","rust/crates/display/src/browser_ui/interaction.rs","web/index.html","locales/ui-web-ja.json","locales/ui-web-en.json"].map(async file=>({file,sha256:createHash("sha256").update(await readFile(path.join(root,file))).digest("hex")})));
  evidence.result="pass";
}catch(error){evidence.result="fail";evidence.failure=error.stack;if(page){evidence.scene=await scene().catch(()=>null);await shot("failure").catch(()=>{});}throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

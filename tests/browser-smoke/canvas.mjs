import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { createPreviewServer } from "../../../tools/server.mjs";
import { runGame } from "../run-game.mjs";
import { prepareBrowserRuntime } from "./browser-runtime.mjs";
const root=fileURLToPath(new URL("../../",import.meta.url)),output=artifactDirectory(path.join(root,"tests/browser-smoke/output/canvas"));
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+server.address().port+"/";
const headers={"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp","Cross-Origin-Resource-Policy":"same-origin"};
const worker=await readFile(path.join(root,"web/worker.js"),"utf8");
let browser,context,page,runtime;
const baseline=process.env.ROGUE_CANVAS_BASELINE||path.join(root,"tests/browser-smoke/output/canvas/before/build");
const hasBaseline=await Promise.all(["game.js","game.wasm","game-fixtures.js","game-fixtures.wasm"].map(file=>access(path.join(baseline,file)))).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
if(!hasBaseline)console.log("INFO Pre-Canvas archive unavailable: browser scenarios run without historical Wasm comparisons.");
const evidence={baseline:{directory:baseline,available:hasBaseline},started_at:new Date().toISOString(),checks:[],screenshots:[],errors:[]};
async function check(label,fn){await fn();evidence.checks.push(label);console.log("PASS "+label);}
async function open({fixture="",width=1240,height=900,lang="ja",scale=1}={}){
  await context?.close();context=await browser.newContext({viewport:{width,height},hasTouch:width<700,isMobile:width<700,deviceScaleFactor:scale,acceptDownloads:true});
  if(fixture){await context.route("**/web/worker.js",r=>r.fulfill({body:worker.replace('    module.FS.writeFile("/locale.txt",','    module.FS.writeFile("/fixture.id", '+JSON.stringify(fixture)+');\n    module.FS.writeFile("/locale.txt",'),contentType:"text/javascript",headers}));await context.route("**/build/game.js",r=>r.fulfill({path:path.join(root,"build/game-fixtures.js"),contentType:"text/javascript",headers}));}
  page=await context.newPage();await installBrowserTestAdapter(page);page.on("pageerror",e=>evidence.errors.push(e.message));
  await page.goto(base+"?trace=1&view=pixels&lang="+lang);
  await page.waitForFunction(()=>window.__rogueBrowserTest?.canvas?.paintCount>0);
}
async function scene(){return page.evaluate(()=>__rogueBrowserTest.canvas);}
async function click(id){
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  const c=(await scene()).controls.find(c=>c.id===id);await page.mouse.click(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2,{delay:80});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function field(id,text){
  await click(id);await page.keyboard.press("Control+a");await page.keyboard.insertText(text);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function settled(){await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.queuePending===0);}
async function start(name="Canvas勇者",seed="17"){await field("name",name);await field("seed",seed);await click("new-game");await settled();}
async function state(){return page.evaluate(()=>({words:__rogueBrowserTest.trace?.words,input:__rogueBrowserTest.inputRequestCount,frame:__rogueBrowserTest.frame,queue:__rogueBrowserTest.queuePending,exit:__rogueBrowserTest.diagnostics.exitCode,log:__rogueBrowserTest.canvas.text}));}
async function key(value){const before=(await state()).input;await page.keyboard.press(value);await page.waitForFunction(n=>__rogueBrowserTest.queuePending===0&&(__rogueBrowserTest.inputRequestCount>n||__rogueBrowserTest.diagnostics.exitCode!==null),before);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}
async function shot(name){await page.screenshot({path:path.join(output,name+".png")});evidence.screenshots.push(name+".png");}

// Decode the actual browser screenshot, including PNG scanline predictors.
// With the Canvas hidden every screenshot pixel must be the plain stage background.
function assertBlankScreenshot(png) {
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),channels=png[25]===2?3:4;
  assert.equal(png[24],8);assert.ok([2,6].includes(png[25]));assert.equal(png[28],0);
  const chunks=[];for(let i=8;i<png.length;){const n=png.readUInt32BE(i);if(png.toString("ascii",i+4,i+8)==="IDAT")chunks.push(png.subarray(i+8,i+8+n));i+=n+12;}
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,pixels=Buffer.alloc(stride*height);let position=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[position++];assert.ok(filter<=4);for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=x>=channels&&y?pixels[i-stride-channels]:0;pixels[i]=(raw[position++]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
  for(let i=0;i<pixels.length;i+=channels){assert.equal(pixels[i],16);assert.equal(pixels[i+1],21);assert.equal(pixels[i+2],24);if(channels===4)assert.equal(pixels[i+3],255);}
}
async function onlyCanvas() {
  await page.locator("#rogue-canvas").evaluate(e=>e.style.visibility="hidden");
  try {assertBlankScreenshot(await page.screenshot());}
  finally {await page.locator("#rogue-canvas").evaluate(e=>e.style.visibility="");}
}
async function touchDrag(from,to) {
  const cdp=await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:from.x,y:from.y,id:1}]});
  for(let n=1;n<=6;n++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:from.x+(to.x-from.x)*n/6,y:from.y+(to.y-from.y)*n/6,id:1}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await cdp.detach();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}

try{
  runtime=await prepareBrowserRuntime(root);evidence.runtime=runtime.diagnostics;
  browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:true,args:["--disable-gpu"],downloadsPath:runtime.downloadsPath});
  evidence.browser=browser.version();
  await open();
  await check("Title and fields are painted on the only visible Canvas",async()=>{
    assert.equal((await scene()).renderer,"canvas2d");assert.ok((await scene()).text.includes("冒険を始める"));
    assert.equal(await page.locator("#rogue-canvas").isVisible(),true);
    assert.equal(await page.locator("#semantic-host, #accessible-screen, button, select, form, [aria-live]").count(),0);
    assert.equal(await page.locator("canvas").count(),1);
    assert.equal(await page.locator("input").count(),4);
    assert.equal(await page.evaluate(()=>__rogueBrowserTest.generation),0);await shot("top-desktop");
  });
  await check("Hiding the title Canvas leaves a uniform screenshot with no DOM pixels",onlyCanvas);
  await check("Canvas footer opens its links directly without HTML anchors",async()=>{
    for(const [id,url] of [["credits-repository","https://github.com/cacazu/jrogue/tree/main/rogue-nihon"],["credits-license","https://github.com/cacazu/jrogue/blob/main/rogue-nihon/docs/LICENSES-ja.md"]]){
      await context.route(url,r=>r.fulfill({body:"Canvas link target",contentType:"text/plain"}));
      const opened=page.waitForEvent("popup");await click(id);const popup=await opened;await popup.waitForURL(url);assert.equal(popup.url(),url);await popup.close();
    }
    assert.equal(await page.locator("a,button,form,select").count(),0);
  });
  await start();
  await check("Native Canvas field editing starts the real Bevy/C game",async()=>{
    assert.equal((await state()).frame.ui.name,"Canvas勇者");await shot("game-desktop");
    if(hasBaseline){const old=await runGame(path.join(baseline,"game.js"),{seed:17,name:"Canvas勇者",locale:"ja",messagePaging:"log"});
      assert.deepEqual((await state()).words,old.traces.at(-1).words);}
  });
  await key("i");
  await check("Canvas inventory retains the map and exposes a Close hit target",async()=>{
    assert.equal((await state()).frame.ui.mode,"menu");assert.ok((await scene()).controls.some(c=>c.id==="window-32"));
    assert.ok((await scene()).text.some(t=>t.includes("食料")));await shot("inventory-desktop");
  });
  await check("Hiding the inventory Canvas also removes the map, HUD, log and window",onlyCanvas);
  await click("window-32");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);

  await check("Button, Enter and Escape close Canvas windows without changing C/RNG; item rows stay out of the log",async()=>{
    const before=await state(),gameLog=await page.evaluate(()=>__rogueBrowserTest.messages);
    for(const close of ["Enter","Escape","button"]){
      await key("i");const opened=await state();assert.equal(opened.frame.map_cells,before.frame.map_cells);
      assert.deepEqual(opened.words.slice(1,16),before.words.slice(1,16));
      assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.messages),gameLog);
      if(close==="button")await click("window-32");else await key(close);
      await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
      assert.deepEqual((await state()).words.slice(1,16),before.words.slice(1,16));
    }
  });
  await check("Canvas help wraps, scrolls and closes with its action",async()=>{
    await key("?");await click("window-42");await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.mode==="help");
    const before=await state(),s=await scene();assert.ok(s.regions.dialog.max>0);
    await page.mouse.move(s.regions.dialog.rect.x+80,s.regions.dialog.rect.y+80);await page.mouse.wheel(0,360);
    await page.waitForFunction(()=>__rogueBrowserTest.canvas.scrolls.dialog>0);
    assert.deepEqual((await state()).words,before.words);await shot("help-scrolled");
    await click("window-32");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
  });
  await check("Canvas option buttons apply the original C setting",async()=>{
    await key("o");await click("window-116");
    assert.ok((await state()).frame.ui.lines.some(l=>l.scope==="options"&&l.row===0&&l.id==="options.value.true"));
    await shot("game-options");await click("window-27");await click("window-32");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
  });
  await check("All 11 item operations use Canvas candidates and Cancel only",async()=>{
    for(const command of ["q","w","r","e","W","P","d","c","t","z","I"]){
      const before=await state();await key(command);
      if((await state()).frame.ui.input.kind==="direction"){if((await state()).frame.ui.movement_direction)await key("ArrowUp");else await click("window-107");}
      const choice=await state();assert.equal(choice.frame.ui.input.kind,"item",command);
      assert.deepEqual(choice.frame.ui.window.actions.map(a=>a.key),[27]);
      assert.ok(!(await scene()).controls.some(c=>c.id==="window-42"));
      assert.deepEqual(choice.words.slice(1,16),before.words.slice(1,16));
      await click("window-27");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
    }
    await key("w");await key("*");assert.equal((await state()).frame.ui.mode,"menu");
    await click("window-32");assert.equal((await state()).frame.ui.input.kind,"item");
    await shot("item-choice");await click("window-27");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
  });
  await check("Clicking a Canvas inventory candidate executes the original C wield action",async()=>{
    const turn=(await state()).words[13];await key("w");await click("item-d");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
    assert.equal((await state()).words[13],turn+1);
  });
  await check("Direction, symbol, discovery and quit confirmation accept Canvas actions",async()=>{
    await key("z");assert.equal((await state()).frame.ui.input.kind,"direction");await click("window-27");
    await key("/");assert.ok((await scene()).controls.some(c=>c.id==="command-key"));await field("command-key","@");await click("submit-text");
    await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
    await key("D");await click("window-27");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
    await key("Q");assert.equal((await state()).frame.ui.input.kind,"confirm");await click("window-110");
  });
  await check("Canvas settings isolate keys, switch all render modes and control zoom without C input",async()=>{
    const before=await state();await click("settings-toggle");
    for(const k of ["h","i","ArrowDown"]){await page.keyboard.press(k);}
    assert.deepEqual((await state()).words,before.words);assert.equal((await state()).input,before.input);
    for(const mode of ["ascii","tiles","pixels"]){await click("view-"+mode);assert.deepEqual((await state()).words,before.words);}
    await click("tile-zoom");await page.keyboard.press("Home");
    for(let n=0;n<3;n++)await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.tileSize),128);
    await page.keyboard.press("Home");assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.tileSize),32);
    await click("center-map");assert.equal((await state()).input,before.input);await shot("settings-desktop");
    await click("settings-close");await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==="game");
    await page.evaluate(()=>{for(let n=0;n<100;n++)__rogueBrowserTest.redraw();});
    assert.deepEqual((await state()).words,before.words);assert.equal((await state()).input,before.input);
  });
  await check("Fullscreen uses the whole Canvas for the game, hides title and credits, and Escape restores the layout without C input",async()=>{
    const before=await state(),normal=await scene();await click("header-fullscreen");
    await page.waitForFunction(()=>Boolean(document.fullscreenElement)&&__rogueBrowserTest.canvas.fullscreen);
    const full=await scene();
    assert.equal(full.mapRect.y,0);assert.equal(full.mapRect.h,full.height);
    assert.ok(!full.controls.some(c=>["credits-repository","credits-license"].includes(c.id)));
    assert.ok(!full.text.some(t=>t.includes("ROGUE")));
    for(const id of ["settings-toggle","header-fullscreen"]){
      const r=full.controls.find(c=>c.id===id).rect;
      assert.ok(r.x>=full.mapRect.x&&r.y>=full.mapRect.y&&r.x+r.w<=full.mapRect.x+full.mapRect.w&&r.y+r.h<=full.mapRect.y+full.mapRect.h);
    }
    await shot("game-fullscreen-desktop");
    assert.equal((await state()).input,before.input);assert.deepEqual((await state()).words,before.words);
    await page.keyboard.press("Escape");
    await page.waitForFunction(()=>!document.fullscreenElement&&!__rogueBrowserTest.canvas.fullscreen);
    assert.deepEqual((await scene()).mapRect,normal.mapRect);
    assert.ok((await scene()).controls.some(c=>c.id==="credits-license"));
    assert.equal((await state()).input,before.input);assert.deepEqual((await state()).words,before.words);
  });
  await check("In-game settings and fullscreen buttons remain clear of the inventory window",async()=>{
    await key("i");await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window);const before=await state();
    for(const fullscreen of [true,false]){
      const s=await scene();
      for(const id of ["settings-toggle","header-fullscreen"]){
        const a=s.controls.find(c=>c.id===id).rect,b=s.dialogRect;
        assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,"buttons must not cover inventory content");
      }
      await click("header-fullscreen");
      await page.waitForFunction(fullscreen=>Boolean(document.fullscreenElement)===fullscreen&&__rogueBrowserTest.canvas.fullscreen===fullscreen,fullscreen);
      assert.deepEqual((await state()).frame.ui.window,before.frame.ui.window);
      assert.equal((await state()).input,before.input);assert.deepEqual((await state()).words,before.words);
    }
    await click("settings-toggle");await click("settings-close");
    assert.deepEqual((await state()).frame.ui.window,before.frame.ui.window);
    await shot("inventory-in-game-buttons");await click("window-32");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
  });
  await check("Canvas map hit testing reaches an actual adjacent C floor cell",async()=>{
    const before=await state(),f=before.frame,s=await scene();
    const directions=[[-1,0,"h"],[1,0,"l"],[0,-1,"k"],[0,1,"j"]];
    const selected=directions.find(([dx,dy])=>[1,2].includes(f.map_tiles[(f.player.y+dy)*f.width+f.player.x+dx]));assert.ok(selected);
    const [dx,dy]=selected,x=f.player.x+dx,y=f.player.y+dy,c=s.camera,r=s.mapRect;
    await page.mouse.click(r.x+(x+.5)*c.size-c.left,r.y+(y-.5)*c.cellH-c.top);
    await page.waitForFunction(({x,y})=>__rogueBrowserTest.frame.player.x===x&&__rogueBrowserTest.frame.player.y===y&&__rogueBrowserTest.queuePending===0,{x,y});
    assert.equal((await state()).words[13],before.words[13]+1);await shot("map-click");
  });
  await check("Saving an open Canvas inventory and loading a fresh Worker restores its map and C/RNG state",async()=>{
    await key("i");const before=await state();await click("settings-toggle");await click("save");
    await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);
    const saved=await state();assert.deepEqual(saved.words,before.words);
    const downloaded=page.waitForEvent("download");await click("download-save");const download=await downloaded;
    assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),"rogue-save.json");
    await download.saveAs(path.join(output,"exported-save.json"));
    const bytes=await readFile(path.join(output,"exported-save.json"));assert.equal(bytes.length,await page.evaluate(()=>__rogueBrowserTest.savedLength));assert.equal(JSON.parse(bytes).version,2);
    evidence.download={result:"pass",file:"exported-save.json",bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
    await click("settings-top");await page.waitForFunction(()=>__rogueBrowserTest.topOpen);
    await click("load");await settled();const loaded=await state();
    assert.deepEqual(loaded.words.slice(1,16),saved.words.slice(1,16));assert.equal(loaded.frame.map_cells,before.frame.map_cells);
    assert.equal(loaded.frame.ui.mode,"menu");await shot("loaded-inventory");await click("window-32");
  });
  await check("Native IME input is drawn on Canvas, saves mid-edit, restores and commits to C",async()=>{
    await key("c");await click("item-c");await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.kind==="text");
    await field("prompt-text","日本語🗡");const before=await state();
    await page.evaluate(()=>document.getElementById("prompt-text").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:"日本"})));
    await page.keyboard.press("Enter");assert.equal((await state()).input,before.input);assert.equal((await state()).queue,0);
    await page.evaluate(()=>document.getElementById("prompt-text").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"日本語🗡"})));
    assert.ok((await scene()).text.includes("日本語🗡"));assert.equal(await page.locator("#prompt-text").evaluate(e=>getComputedStyle(e).opacity),"0");
    await shot("text-canvas");await click("settings-toggle");await click("save");
    await page.waitForFunction(()=>!__rogueBrowserTest.savePending);const saved=await state();
    await click("settings-top");await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await click("load");await settled();
    assert.equal(await page.locator("#prompt-text").inputValue(),"日本語🗡");assert.deepEqual((await state()).words,saved.words);
    await shot("text-restored");await click("submit-text");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
    await key("i");assert.ok((await state()).frame.ui.lines.some(l=>l.text.includes("日本語🗡")));await click("window-32");
  });
  await check("Escape cancels the Canvas text editor without committing the draft",async()=>{
    await key("c");await click("item-c");await field("prompt-text","破棄する");await page.keyboard.press("Escape");
    await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);await key("i");
    assert.ok(!(await state()).frame.ui.lines.some(l=>l.text.includes("破棄する")));await click("window-32");
  });
  await check("Canvas top validates UTF-8 name and seed, and random fields never touch C input",async()=>{
    await click("settings-toggle");await click("settings-top");await page.waitForFunction(()=>__rogueBrowserTest.topOpen);
    const input=(await state()).input;await click("random-name");const name=await page.locator("#name").inputValue();
    await click("random-seed");assert.equal(await page.locator("#name").inputValue(),name);assert.equal((await state()).input,input);
    await field("seed","-1");await click("new-game");assert.ok((await scene()).text.some(t=>t.includes("4294967295")));
    await field("seed","17");await field("name","界".repeat(17));await click("new-game");assert.ok((await scene()).text.some(t=>t.includes("49")));
    assert.equal(await page.evaluate(()=>__rogueBrowserTest.topOpen),true);await shot("invalid-input");
  });
  for(const [fixture,command,item,id] of [["space-detection","q","f","ui.detect_magic"],["space-detection","r","g","ui.detect_food"]]){
    await check("Canvas detection map: "+id,async()=>{
      await open({fixture});await start();const before=await state();await key(command);await click("item-"+item);
      await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.input.id==="input.close");
      assert.ok((await state()).frame.ui.lines.some(l=>l.id===id));assert.equal((await state()).frame.map_cells,before.frame.map_cells);
      assert.equal((await state()).frame.ui.window.map_view,true);await shot(id);await click("window-32");
      await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);assert.equal((await state()).words[13],1);
    });
  }
  await check("Actual identification uses Canvas candidates and changes the C item",async()=>{
    await open({fixture:"item-identify"});await start();await key("r");await click("item-f");
    assert.ok((await scene()).controls.some(c=>c.id==="item-c"));await shot("identify-choice");
    await click("item-c");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);assert.equal((await state()).words[13],1);
  });
  await check("Canvas discovery pages distinguish Next and Close; item menu ignores terminal list style",async()=>{
    await open({fixture:"space-discoveries"});await start();await key("D");await click("window-42");let pages=0;
    while((await state()).frame.ui.input.id==="input.next_page"){assert.ok((await scene()).controls.some(c=>c.id==="window-32"&&c.label==="次のページ"));await click("window-32");if(++pages>10)throw Error("paging loop");}
    assert.ok(pages>=2);await click("window-32");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
    await open();await start();await key("o");for(let n=0;n<6;n++)await key("Enter");await click("window-115");await click("window-27");await click("window-32");
    await key("i");assert.equal((await state()).frame.ui.input.kind,"space");
    assert.equal((await state()).frame.ui.inventory,true);assert.ok((await state()).frame.ui.lines.every(line=>line.selectable));
    assert.ok((await scene()).controls.some(c=>c.id==="window-32"&&c.label==="閉じる"));await click("window-32");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
  });
  for(const fixture of ["ending-death","ending-no-tomb","ending-victory"]){
    await check("Canvas "+fixture+" returns to top after original C result accounting",async()=>{
      await open({fixture});await start("EndingAudit");await shot(fixture);await click("result-top");
      await page.waitForFunction(()=>__rogueBrowserTest.topOpen&&!__rogueBrowserTest.running);
      assert.notEqual((await state()).exit,null);
      if(hasBaseline){const old=await runGame(path.join(baseline,"game-fixtures.js"),{fixture,seed:17,name:"EndingAudit",locale:"ja",messagePaging:"log",text:fixture==="ending-victory"?" \n\n":"\n\n"});
      assert.deepEqual((await state()).words,old.traces.at(-1).words);assert.equal((await state()).exit,old.code);
      assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.traces.map(t=>t.words)),old.traces.map(t=>t.words));}
    });
  }
  await check("Canvas hallucination redraw, scrolling and close aliases retain the original RNG behavior",async()=>{
    const results=[];
    for(const close of ["Space","Enter","Escape","button"]){
      await open({fixture:"hallucination"});await start();await key("i");const before=await state();
      await page.evaluate(()=>{for(let n=0;n<100;n++)__rogueBrowserTest.redraw();});
      assert.deepEqual((await state()).words,before.words);assert.equal((await state()).input,before.input);
      if(close==="button")await click("window-32");else await key(close);
      await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);results.push((await state()).words);
    }
    for(const result of results)assert.deepEqual(result,results[0]);
    if(hasBaseline){const old=await runGame(path.join(baseline,"game-fixtures.js"),{fixture:"hallucination",seed:17,name:"Canvas勇者",locale:"ja",messagePaging:"log",text:"i "});
    assert.deepEqual(results[0],old.traces.at(-1).words);}await shot("hallucination");
  });
  await check("English mobile Canvas exposes all item paths, touch controls, scrolling and stable resize",async()=>{
    await open({width:390,height:844,lang:"en"});await shot("top-mobile");await start("MobileHero","0");
    assert.ok((await scene()).controls.some(c=>c.id==="touch-i"||c.id==="touch-action-action.inventory"));
    const inventory=(await scene()).controls.find(c=>c.id==="touch-action-action.inventory");await page.touchscreen.tap(inventory.rect.x+inventory.rect.w/2,inventory.rect.y+inventory.rect.h/2);await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.mode==="menu");await shot("inventory-mobile");await click("window-32");
    for(const command of ["q","w","r","e","W","P","d","c","t","z","I"]){await key(command);if((await state()).frame.ui.input.kind==="direction"){if((await state()).frame.ui.movement_direction)await key("ArrowUp");else await click("window-107");}assert.deepEqual((await state()).frame.ui.window.actions.map(a=>a.key),[27]);await click("window-27");await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);}
    const before=await state();await click("settings-toggle");await shot("settings-mobile");await page.keyboard.press("Escape");
    for(const viewport of [{width:320,height:844},{width:844,height:390},{width:390,height:844}]){await page.setViewportSize(viewport);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal((await scene()).width,viewport.width);assert.deepEqual((await state()).words,before.words);assert.equal((await state()).input,before.input);assert.ok((await scene()).controls.some(c=>c.id==="touch-k"));await shot("game-mobile-"+viewport.width);}
    await shot("game-mobile");await key("?");await click("window-42");await shot("help-mobile");await page.keyboard.press("PageDown");assert.ok((await scene()).scrolls.dialog>0);await click("window-32");
  });
  await check("Canvas combat log scroll preserves manual reading and never becomes a Space wait",async()=>{
    await open({fixture:"combat",width:390,height:844});await start();
    for(let n=1;n<=3;n++){await key("l");assert.equal((await state()).words[13],n);assert.equal((await state()).frame.ui.input.kind,"command");}
    const before=await state(),s=await scene();assert.ok(s.regions.log.max>0);
    await page.mouse.move(s.regions.log.rect.x+40,s.regions.log.rect.y+30);await page.mouse.wheel(0,-150);
    await page.waitForFunction(()=>__rogueBrowserTest.canvas.scrolls.log<__rogueBrowserTest.canvas.regions.log.max);
    const offset=(await scene()).scrolls.log;await page.evaluate(()=>{for(let n=0;n<100;n++)__rogueBrowserTest.redraw();});
    assert.equal((await scene()).scrolls.log,offset);assert.deepEqual((await state()).words,before.words);assert.equal((await state()).input,before.input);await shot("combat-log-mobile");
  });

  await check("Real touch drag pans the Canvas map without clicking a C command, and DPR 2 preserves hit testing",async()=>{
    await open({width:390,height:844,scale:2});await start("TouchHero","17");
    assert.equal(await page.evaluate(()=>document.getElementById("rogue-canvas").width),780);
    const before=await state(),s=await scene(),p={x:s.mapRect.x+195,y:s.mapRect.y+160};
    await touchDrag(p,{x:p.x+50,y:p.y+40});
    assert.notEqual((await scene()).camera.left,s.camera.left);assert.notEqual((await scene()).camera.top,s.camera.top);
    assert.deepEqual((await state()).words,before.words);assert.equal((await state()).input,before.input);
    const c=(await scene()).controls.find(c=>c.id==="settings-toggle");
    await page.touchscreen.tap(c.rect.x+c.rect.w/2,c.rect.y+c.rect.h/2);await page.waitForFunction(()=>__rogueBrowserTest.canvas.scope==="settings");
    await shot("settings-mobile-dpr2");await onlyCanvas();
    const close=(await scene()).controls.find(c=>c.id==="settings-close");await page.touchscreen.tap(close.rect.x+close.rect.w/2,close.rect.y+close.rect.h/2);
    assert.deepEqual((await state()).words,before.words);assert.equal((await state()).input,before.input);
  });
  await check("Running game and settings contain no readout mirror or HTML UI controls",async()=>{
    assert.equal(await page.locator("#semantic-host,#accessible-screen,button,form,select,a,pre,[aria-live],[role]").count(),0);
    assert.equal(await page.locator("canvas").count(),1);assert.equal(await page.locator("input").count(),4);
  });
  assert.deepEqual(evidence.errors,[]);
  assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.translationFallbacks),[]);
  assert.deepEqual(await page.evaluate(()=>__rogueBrowserTest.uiMissing),[]);
  evidence.files=await Promise.all(["web/app.js","web/canvas-ui.js","web/tiles.js","web/worker.js","build/browser-ui.wasm","rust/crates/browser-display/src/controller.rs","rust/crates/browser-display/src/policies.rs","rust/crates/display/src/browser_ui/tiles.rs","rust/crates/display/src/widgets.rs","rust/crates/display/src/browser_ui/mod.rs","rust/crates/display/src/browser_ui/hud.rs","rust/crates/display/src/browser_ui/screens.rs","rust/crates/display/src/browser_ui/interaction.rs","web/index.html","web/style.css","tests/browser-smoke/browser-runtime.mjs","rust/src/engine.rs","build/game.js","build/game.wasm"].map(async file=>({file,sha256:createHash("sha256").update(await readFile(path.join(root,file))).digest("hex")})));

  evidence.result="pass";
}catch(error){evidence.result="fail";evidence.failure=error.stack;if(page){evidence.diagnostics=await page.evaluate(()=>window.__rogueBrowserTest?.diagnostics).catch(()=>null);evidence.scene=await scene().catch(()=>null);await shot("failure").catch(()=>{});}throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

import { installBrowserTestAdapter } from "./test-adapter.mjs";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../../web/server.mjs";
const require = createRequire(import.meta.url);
const deps = path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(deps, "playwright"));
const sharp = require(path.join(deps, "sharp"));
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assets = path.join(project, "web/assets/pixels-v2");
const output = artifactDirectory(path.join(project, "tests/browser-smoke/output/pixels-v2"));
await mkdir(output, {recursive:true});
const manifest = JSON.parse(await readFile(path.join(assets, "manifest.json"), "utf8"));
const original = JSON.parse(await readFile(path.join(project, "web/assets/pixels/manifest.json"), "utf8"));
assert.equal(manifest.entries.length, 49);
assert.deepEqual(manifest.entries.map(e=>[e.id,e.image,e.rotation]), original.entries.map(e=>[e.id,e.image,e.rotation]));
const names = [...new Set(manifest.entries.map(e=>e.image))];
assert.equal(names.length,46);
const applicationResponses = [];
const evidence = {started_at:new Date().toISOString(), checks:[], images:[], screenshots:[], errors:[], application_mapping:"Production app loads pixels-v2 directly in pixel mode, without request routing."};
for (const name of names) {
  const bytes=await readFile(path.join(assets,name));
  const metadata=await sharp(bytes).metadata();
  assert.equal(metadata.width,32,name); assert.equal(metadata.height,32,name);
  assert.equal(metadata.channels,4,name);
  const data=await sharp(bytes).ensureAlpha().raw().toBuffer();
  const colors=new Set(), alpha=new Set();
  for(let i=0;i<data.length;i+=4){alpha.add(data[i+3]);if(data[i+3])colors.add(data.subarray(i,i+3).toString("hex"));}
  assert.ok(colors.size>0&&colors.size<=16,name);
  assert.ok([...alpha].every(a=>a===0||a===255),name);
  if(["terrain.floor.png","terrain.passage.png","terrain.unexplored.png"].includes(name)) {
    for(let n=0;n<32;n++){
      assert.deepEqual(data.subarray(n*128,n*128+4),data.subarray(n*128+124,n*128+128),name+" left/right");
      assert.deepEqual(data.subarray(n*4,n*4+4),data.subarray((31*32+n)*4,(31*32+n)*4+4),name+" top/bottom");
    }
  }
  evidence.images.push({file:name,width:metadata.width,height:metadata.height,colors:colors.size,alpha:[...alpha],sha256:createHash("sha256").update(bytes).digest("hex")});
}
assert.deepEqual(await readFile(path.join(assets,"actor.player.png")),await readFile(path.join(project,"web/assets/gameboy/actor.player.32.silver.png")));
assert.equal(JSON.parse(await readFile(path.join(assets,"generation-inputs.json"),"utf8")).length,45);
evidence.checks.push("46 PNGs: exact 32x32 RGBA, at most 16 opaque colors, binary alpha; periodic floor edges; approved soldier byte-identical; 49 IDs/order/rotations preserved.");
const scratch=await mkdtemp(path.join(output,"scratch-"));
process.env.TEMP=scratch;process.env.TMP=scratch;
const server=createPreviewServer();
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
let context;
try {
  context=await chromium.launchPersistentContext(path.join(scratch,"profile"),{
    executablePath:process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless:true,viewport:{width:1280,height:900},deviceScaleFactor:1,downloadsPath:path.join(scratch,"downloads"),
    args:["--disable-gpu","--no-first-run","--no-default-browser-check","--disable-background-networking","--disable-component-update"]
  });
  evidence.browser=context.browser().version();
  const page=await context.newPage();await installBrowserTestAdapter(page);
  page.on("pageerror",error=>evidence.errors.push(error.message));
  await page.goto(base+"/web/tiles.js");
  await page.setContent('<!doctype html><html lang="ja"><meta charset="utf-8"><body></body></html>');
  await page.addScriptTag({url:base+"/web/tiles.js"});
  const gallery=await page.evaluate(async()=>{
    const set=await RogueTiles.load("/web/assets/pixels-v2/manifest.json");
    document.title="Rogue 32px assets";
    document.head.insertAdjacentHTML("beforeend",'<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#10161e;color:#e1e7ef;font:14px sans-serif}h1{font-size:24px;margin:0 0 8px}p{color:#aab7c7;margin:0 0 22px}.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}.card{background:#202a35;border:1px solid #364456;border-radius:4px;text-align:center;padding:10px 4px;min-height:151px}.sprite{width:96px;height:96px;image-rendering:pixelated;display:block;margin:0 auto 5px}.name{font-size:13px;margin-bottom:4px}.id{font:9px monospace;color:#aab7c7}</style>');
    document.body.innerHTML='<h1>Rogue — 32 × 32 pixels</h1><p>全46画像・49種類の表示 ／ 銀色の鎧・自然な配色 ／ 下の一覧は3倍表示</p><div class="grid"></div>';
    const grid=document.querySelector(".grid"), rendered=[];
    for(const entry of set.entries){
      const card=document.createElement("div");card.className="card";
      const canvas=document.createElement("canvas");canvas.width=canvas.height=96;canvas.className="sprite";
      const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;set.drawImage(ctx,entry,0,0,96,96);
      const sample=ctx.getImageData(0,0,96,96).data;
      if(!sample.some((value,index)=>index%4===3&&value>0))throw new Error("Empty entry "+entry.id);
      card.append(canvas);
      const label=document.createElement("div");label.className="name";label.textContent=entry.labels.ja;card.append(label);
      const id=document.createElement("div");id.className="id";id.textContent=entry.id;card.append(id);grid.append(card);rendered.push(entry.id);
    }
    let blocks=0, maxColorDelta=0;
    for(const entry of set.entries){
      const native=document.createElement("canvas");native.width=native.height=32;
      const enlarged=document.createElement("canvas");enlarged.width=enlarged.height=128;
      const n=native.getContext("2d",{willReadFrequently:true}), e=enlarged.getContext("2d",{willReadFrequently:true});
      n.imageSmoothingEnabled=e.imageSmoothingEnabled=false;
      set.drawImage(n,entry,0,0,32,32);set.drawImage(e,entry,0,0,128,128);
      const src=n.getImageData(0,0,32,32).data,dst=e.getImageData(0,0,128,128).data;
      for(let y=0;y<128;y++)for(let x=0;x<128;x++)for(let c=0;c<4;c++){
        const actual=dst[(y*128+x)*4+c], expected=src[(Math.floor(y/4)*32+Math.floor(x/4))*4+c];
        maxColorDelta=Math.max(maxColorDelta,Math.abs(actual-expected));
        const anchor=dst[((Math.floor(y/4)*4)*128+Math.floor(x/4)*4)*4+c];
        if(actual!==anchor)throw new Error("Nonuniform 4x4 block "+entry.id+" x="+x+" y="+y+" channel="+c+" anchor="+anchor+" actual="+actual);
        if(actual!==expected)throw new Error("Pixel color changed "+entry.id);
      }
      blocks+=32*32;
    }
    return {rendered,images:set.images.size,rotations:set.rotated.size,pixelBlocks:blocks,maxColorDelta};
  });
  assert.equal(gallery.rendered.length,49);assert.equal(gallery.images,46);assert.equal(gallery.rotations,3);
  assert.equal(gallery.maxColorDelta,0); evidence.gallery=gallery;
  await page.screenshot({path:path.join(output,"contact-sheet.png"),fullPage:true});
  evidence.screenshots.push("tests/browser-smoke/output/pixels-v2/contact-sheet.png");
  evidence.checks.push("Playwright: all 49 renderer entries, including 3 beam rotations, visible; every native pixel becomes an exact 4x4 block at 128px.");
  page.on("response",response=>{
    const pathname=new URL(response.url()).pathname;
    if(pathname.startsWith("/web/assets/pixels-v2/")||pathname.startsWith("/web/assets/pixels/")) applicationResponses.push({path:pathname,status:response.status()});
  });
  await page.goto(base+"/?trace=1&view=pixels");
  await page.waitForFunction(()=>window.__rogueBrowserTest?.graphics?.images===46);
  assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.assetStyle),manifest.style);
  assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.mode),"pixels");
  assert.ok(applicationResponses.some(r=>r.path==="/web/assets/pixels-v2/manifest.json"&&r.status===200));
  for(const name of names)assert.ok(applicationResponses.some(r=>r.path==="/web/assets/pixels-v2/"+name&&r.status===200),"production asset loaded: "+name);
  assert.ok(applicationResponses.every(r=>!r.path.startsWith("/web/assets/pixels/")),"application does not load old pixel assets");
  evidence.assetResponses=applicationResponses.slice();
  evidence.checks.push("Production pixel mode loads the new manifest and all 46 PNGs directly, with no substituted requests.");
  await page.locator("#seed").fill("12345");await page.locator("#name").fill("銀鎧の兵士");
  await page.locator("#new-game").click();
  await page.waitForFunction(()=>__rogueBrowserTest.frame&&__rogueBrowserTest.trace&&__rogueBrowserTest.inputRequestCount>0&&__rogueBrowserTest.queuePending===0);
  const snapshot=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,player:__rogueBrowserTest.frame.player,input:__rogueBrowserTest.inputRequestCount,map:__rogueBrowserTest.frame.map_cells}));
  const before=await snapshot();
  if(await page.locator("#settings-panel").isHidden())await page.locator("#settings-toggle").click();
  evidence.displayModes=[];
  for(const mode of ["ascii","tiles","pixels"]){
    await page.locator("#display-mode").selectOption(mode);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.mode),mode);
    if(mode==="pixels")assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.assetStyle),manifest.style);
    assert.deepEqual(await snapshot(),before,"display switches do not advance a turn");
    evidence.displayModes.push(mode);
  }
  evidence.checks.push("ASCII, illustration and the new pixel display can be switched during play with unchanged C state and input count.");
  evidence.zooms=[];
  for(let index=0;index<4;index++){
    await page.locator("#tile-zoom").focus();
    await page.locator("#tile-zoom").press("Home");
    for(let n=0;n<index;n++)await page.locator("#tile-zoom").press("ArrowRight");
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const graphics=await page.evaluate(()=>__rogueBrowserTest.graphics);
    assert.equal(graphics.tileSize,[32,64,96,128][index]);
    assert.equal(graphics.mode,"pixels");assert.deepEqual(graphics.unknown,[]);
    assert.ok(graphics.drawCount>0);assert.deepEqual(await snapshot(),before,"zoom does not advance a turn");
    evidence.zooms.push(graphics.tileSize);
  }
  await page.locator("#settings-close").click();
  await page.screenshot({path:path.join(output,"game-128.png"),fullPage:false});
  evidence.screenshots.push("tests/browser-smoke/output/pixels-v2/game-128.png");
  const target=await page.evaluate(()=>{
    const f=__rogueBrowserTest.frame,c=__rogueBrowserTest.graphics.camera,r=document.getElementById("board").getBoundingClientRect();
    const delta=[[-1,0],[1,0],[0,-1],[0,1]].find(([dx,dy])=>f.map_tiles[(f.player.y+dy)*f.width+f.player.x+dx]===1);
    if(!delta)throw new Error("No adjacent floor");
    const x=f.player.x+delta[0],y=f.player.y+delta[1];
    return {x,y,cx:r.left+((x+.5)*c.size-c.left)*r.width/c.width,cy:r.top+((y-.5)*c.size-c.top)*r.height/c.height};
  });
  await page.mouse.click(target.cx,target.cy);
  await page.waitForFunction(input=>__rogueBrowserTest.inputRequestCount>input&&__rogueBrowserTest.queuePending===0,before.input);
  const after=await snapshot();assert.equal(after.player.x,target.x);assert.equal(after.player.y,target.y);
  evidence.movement={before:before.player,after:after.player,target};
  if(await page.locator("#settings-panel").isHidden())await page.locator("#settings-toggle").click();
  await page.locator("#tile-zoom").focus();await page.locator("#tile-zoom").press("Home");
  await page.locator("#settings-close").click();
  await page.screenshot({path:path.join(output,"game-32.png"),fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  if(await page.locator("#settings-panel").isHidden())await page.locator("#settings-toggle").click();
  await page.locator("#tile-zoom").focus();await page.locator("#tile-zoom").press("Home");await page.locator("#tile-zoom").press("ArrowRight");
  await page.locator("#center-map").click();await page.locator("#settings-close").click();
  await page.locator(".board-scroll").hover();await page.mouse.wheel(0,-2000);
  await page.waitForFunction(()=>document.querySelector(".board-scroll").scrollTop===0);
  evidence.mobilePlayer=await page.evaluate(()=>{const c=__rogueBrowserTest.graphics.camera,p=__rogueBrowserTest.frame.player;return {x:(p.x+.5)*c.size-c.left,y:(p.y-.5)*c.size-c.top,width:c.width,height:c.height,zoom:c.size};});
  assert.ok(evidence.mobilePlayer.x>0&&evidence.mobilePlayer.x<evidence.mobilePlayer.width&&evidence.mobilePlayer.y>80&&evidence.mobilePlayer.y<evidence.mobilePlayer.height);
  assert.deepEqual(await snapshot(),after,"mobile zoom and scrolling do not advance a turn");
  await page.screenshot({path:path.join(output,"game-mobile.png"),fullPage:false});
  assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.unknown.length),0);
  evidence.screenshots.push("tests/browser-smoke/output/pixels-v2/game-32.png","tests/browser-smoke/output/pixels-v2/game-mobile.png");
  evidence.checks.push("Playwright real game: native32/64/96/128 zooms without advancing turns; click movement reaches adjacent floor; desktop and 390px mobile screenshots.");
  await page.reload();
  await page.waitForFunction(()=>window.__rogueBrowserTest?.graphics?.images===46);
  assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.mode),"pixels");
  assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.assetStyle),manifest.style);
  assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.tileSize),64);
  evidence.checks.push("Pixel mode and zoom persist across page reload and continue using the new set.");
  evidence.files=await Promise.all(["web/app.js","web/tiles.js","web/view-settings.js","web/assets/pixels-v2/manifest.json"].map(async file=>({file,sha256:createHash("sha256").update(await readFile(path.join(project,file))).digest("hex")})));
  assert.deepEqual(evidence.errors,[]);
  evidence.passed=true;
  console.log(JSON.stringify({passed:true,images:evidence.images.length,ids:gallery.rendered.length,zooms:evidence.zooms,movement:evidence.movement,checks:evidence.checks}));
} catch(error) {evidence.failure=error.stack;throw error;}
finally {
  evidence.finished_at=new Date().toISOString();
  await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");
  await context?.close();
  await new Promise(resolve=>server.close(resolve));
}

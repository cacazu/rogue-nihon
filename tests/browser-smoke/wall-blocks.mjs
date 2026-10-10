import {installBrowserTestAdapter} from "./test-adapter.mjs";
import {prepareBrowserRuntime} from "./browser-runtime.mjs";
import {artifactDirectory} from "../../tools/temporary-artifacts.mjs";
import {createPreviewServer} from "../../web/server.mjs";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../../",import.meta.url));
const output=artifactDirectory(path.join(root,"tests/browser-smoke/output/wall-blocks"));
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
await mkdir(output,{recursive:true});
const manifests=Object.fromEntries(await Promise.all(["pixels-v2","tiles"].map(async set=>[set,JSON.parse(await readFile(path.join(root,"web/assets",set,"manifest.json"),"utf8"))])));
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
const evidence={started_at:new Date().toISOString(),checks:[],screenshots:[],errors:[],responses:[],pixels:[]};
let browser,context,page,runtime;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,player:__rogueBrowserTest.frame.player,map:__rogueBrowserTest.frame.map_cells}));
async function check(label,fn){await fn();evidence.checks.push(label);console.log("PASS "+label);}
async function click(id){
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  const r=(await scene()).controls.find(c=>c.id===id).rect;
  if((await scene()).width<700)await page.touchscreen.tap(r.x+r.w/2,r.y+r.h/2);
  else await page.mouse.click(r.x+r.w/2,r.y+r.h/2);
  await paint();
}
async function key(value){const before=(await state()).input;await page.keyboard.press(value);await page.waitForFunction(n=>__rogueBrowserTest.inputRequestCount>n&&__rogueBrowserTest.queuePending===0,before);await paint();}
async function shot(name,clip){await page.screenshot({path:path.join(output,name+".png"),...(clip?{clip}:{})});evidence.screenshots.push(name+".png");}
async function open(mobile=false){
  await context?.close();
  context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1240,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1});
  page=await context.newPage();await installBrowserTestAdapter(page);
  page.on("pageerror",error=>evidence.errors.push(error.message));
  page.on("response",response=>{const url=new URL(response.url());if(url.pathname.includes("terrain.wall"))evidence.responses.push({path:url.pathname,status:response.status()});});
  await page.goto(base+"/?trace=1&view=pixels");
  await page.waitForFunction(()=>__rogueBrowserTest?.graphics?.images===45&&__rogueBrowserTest.canvas.controls.some(c=>c.id==="new-game"&&!c.disabled));
  for(const [id,value] of [["name","石壁の勇者"],["seed","17"]]){await click(id);await page.keyboard.press("Control+a");await page.keyboard.insertText(value);await paint();}
  await click("new-game");await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);await paint();
}
async function zoom(mode,index){
  await click("settings-toggle");await click("view-"+mode);await click("tile-zoom");
  await page.keyboard.press("Home");for(let n=0;n<index;n++)await page.keyboard.press("ArrowRight");
  await click("center-map");await click("settings-close");await paint();
}
async function verifyWallPixels(){
  const result=await page.evaluate(async()=>{
    const s=__rogueBrowserTest.canvas,mode=__rogueBrowserTest.graphics.mode,canvas=document.getElementById("rogue-canvas"),ratio=canvas.width/s.width;
    const frame=__rogueBrowserTest.frame,ids=frame.map_tiles;
    const seen={horizontal:ids.filter(id=>id===4).length,vertical:ids.filter(id=>id===5).length};
    const commands=__rogueBrowserTest.commands.filter(c=>c.op==="image"&&c.image==="terrain.wall.png");
    if(commands.some(c=>c.rotation!==0))throw Error("Shared wall was rotated");
    const samples=commands.filter(c=>{const r=c.rect,m=s.mapRect;return r.x>=m.x&&r.y>=m.y+84&&r.x+r.w<=m.x+m.w&&r.y+r.h<=m.y+m.h&&!s.controls.some(control=>{const b=control.rect;return r.x<b.x+b.w&&b.x<r.x+r.w&&r.y<b.y+b.h&&b.y<r.y+r.h;});});
    if(!samples.length)throw Error("No fully visible wall tile to compare");
    const image=new Image();image.src="/web/assets/"+(mode==="pixels"?"pixels-v2":"tiles")+"/terrain.wall.png";await image.decode();
    const expected=document.createElement("canvas"),context=canvas.getContext("2d");let compared=0;
    for(const c of samples){
      const r=c.rect,w=Math.round(r.w*ratio),h=Math.round(r.h*ratio);expected.width=w;expected.height=h;
      const target=expected.getContext("2d");target.imageSmoothingEnabled=false;target.drawImage(image,0,0,w,h);
      const a=target.getImageData(0,0,w,h).data,b=context.getImageData(Math.round(r.x*ratio),Math.round(r.y*ratio),w,h).data;
      if(a.some((value,index)=>value!==b[index]))throw Error("Rendered wall differs from its square asset at "+JSON.stringify(r));
      if(a.some((value,index)=>index%4===3&&value!==255))throw Error("Wall has a transparent hole or edge");
      compared++;
    }
    return {mode,size:__rogueBrowserTest.graphics.tileSize,ratio,seen,commands:commands.length,compared};
  });
  assert.ok(result.seen.horizontal>0&&result.seen.vertical>0);evidence.pixels.push(result);
}
const directions=[[-1,0,"h"],[1,0,"l"],[0,-1,"k"],[0,1,"j"]];
try{
  runtime=await prepareBrowserRuntime(root);
  browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:true,args:["--disable-gpu"],downloadsPath:runtime.downloadsPath});
  evidence.browser=browser.version();
  await check("Both active sets share one unrotated square asset for the two original wall IDs",async()=>{
    for(const manifest of Object.values(manifests)){
      assert.equal(manifest.entries.length,49);assert.equal(new Set(manifest.entries.map(e=>e.image)).size,45);
      for(const id of ["terrain.wall_horizontal","terrain.wall_vertical"]){const e=manifest.entries.find(e=>e.id===id);assert.equal(e.image,"terrain.wall.png");assert.equal(e.rotation,0);}
    }
  });
  await open();
  await check("Real game loads the shared wall PNGs and both tile sets become ready",async()=>{
    for(const set of ["pixels-v2","tiles"])assert.ok(evidence.responses.some(r=>r.path==="/web/assets/"+set+"/terrain.wall.png"&&r.status===200));
    assert.ok(evidence.responses.every(r=>!r.path.includes("wall_horizontal")&&!r.path.includes("wall_vertical")));
    assert.equal(await page.evaluate(()=>__rogueBrowserTest.diagnostics.runtimeError),null);
  });
  const before=await state();
  for(const [mode,sizes] of [["pixels",[32,64,96,128]],["tiles",[16,24,32,48,64]]]){
    for(let index=0;index<sizes.length;index++)await check(`${mode} ${sizes[index]}px: actual wall pixels match the square asset without game input`,async()=>{
      await zoom(mode,index);await verifyWallPixels();assert.deepEqual(await state(),before);
      assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.tileSize),sizes[index]);
      if((mode==="pixels"&&index===1)||(mode==="tiles"&&index===2))await shot("pc-"+mode);
      if(mode==="pixels"&&index===1){
        const clip=await page.evaluate(()=>{const rects=__rogueBrowserTest.commands.filter(c=>c.op==="image"&&c.image==="terrain.wall.png").map(c=>c.rect),x=Math.min(...rects.map(r=>r.x))-8,y=Math.min(...rects.map(r=>r.y))-8;return {x,y,width:Math.max(...rects.map(r=>r.x+r.w))-x+8,height:Math.max(...rects.map(r=>r.y+r.h))-y+8};});
        await shot("pc-pixels-room",clip);
      }
    });
  }
  await check("ASCII and both graphic modes preserve the original perceived map and game state",async()=>{
    await click("settings-toggle");for(const mode of ["ascii","tiles","pixels"]){await click("view-"+mode);assert.deepEqual(await state(),before);}
    await click("tile-zoom");await page.keyboard.press("Home");await click("settings-close");
  });
  await check("Original C movement cannot enter a square wall block",async()=>{
    const f=await page.evaluate(()=>__rogueBrowserTest.frame),p=f.player;
    let route;
    for(const [dx,dy,key] of directions){let x=p.x,y=p.y,steps=0;while(steps<20&&f.map_tiles[(y+dy)*f.width+x+dx]===1){x+=dx;y+=dy;steps++;}if([4,5].includes(f.map_tiles[(y+dy)*f.width+x+dx])){route={key,steps,x,y};break;}}
    assert.ok(route,"visible unobstructed route to room wall");for(let i=0;i<route.steps;i++)await key(route.key);
    assert.deepEqual((await state()).player,{x:route.x,y:route.y});const atWall=await state();await key(route.key);
    assert.deepEqual((await state()).player,atWall.player);await shot("pc-wall-collision");
  });
  await check("Original C movement still crosses a visible room door",async()=>{
    const f=await page.evaluate(()=>__rogueBrowserTest.frame),start=f.player.y*f.width+f.player.x;
    const queue=[[start,[]]],visited=new Set([start]);let route,target;
    for(let n=0;n<queue.length&&!route;n++){
      const [cell,keys]=queue[n],x=cell%f.width,y=Math.floor(cell/f.width);
      for(const [dx,dy,key] of directions){const nx=x+dx,ny=y+dy,next=ny*f.width+nx;if(nx<0||nx>=f.width||ny<1||ny>=f.height-1||visited.has(next))continue;visited.add(next);const id=f.map_tiles[next];if(id===3){route=[...keys,key];target={x:nx,y:ny};break;}if([1,2,6].includes(id))queue.push([next,[...keys,key]]);}
    }
    assert.ok(route,"visible walkable route to door");for(const value of route)await key(value);assert.deepEqual((await state()).player,target);await shot("pc-door");
  });
  await open(true);
  for(const mode of ["pixels","tiles"])await check(`390px mobile DPR2 ${mode}: square wall painting and unchanged input`,async()=>{
    const before=await state();await zoom(mode,mode==="pixels"?0:2);await verifyWallPixels();assert.deepEqual(await state(),before);await shot("mobile-"+mode);
  });
  assert.deepEqual(evidence.errors,[]);evidence.passed=true;
  console.log(JSON.stringify({passed:true,checks:evidence.checks.length,errors:evidence.errors,pixelComparisons:evidence.pixels}));
}catch(error){evidence.failure=error.stack;throw error;}
finally{
  evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");
  await context?.close();await browser?.close();await new Promise(resolve=>server.close(resolve));await runtime?.dispose();
}

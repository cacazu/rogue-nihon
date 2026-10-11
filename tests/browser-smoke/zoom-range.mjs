import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createPreviewServer} from "../../../tools/server.mjs";
import {artifactDirectory} from "../../tools/temporary-artifacts.mjs";
import {prepareBrowserRuntime} from "./browser-runtime.mjs";
import {installBrowserTestAdapter} from "./test-adapter.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const output=artifactDirectory(path.join(root,"tests/browser-smoke/output/zoom-range"));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=createPreviewServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port+"/";
const evidence={checks:[],screenshots:[],errors:[],started_at:new Date().toISOString()};
let runtime,browser,context,page,cdp;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const scene=()=>page.evaluate(()=>__rogueBrowserTest.canvas);
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,player:__rogueBrowserTest.frame.player}));
async function shot(name){await page.screenshot({path:path.join(output,name+".png")});evidence.screenshots.push(name+".png");}
async function check(label,fn){await fn();evidence.checks.push(label);console.log("PASS "+label);}
async function pinch(ratio,cancel=false){
  const s=await scene(),b=await page.locator("#rogue-canvas").boundingBox(),r=s.mapRect,x=b.x+r.x+r.w/2,y=b.y+r.y+r.h/2,d=Math.min(40,r.w/5,r.h/5);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:x-d,y,id:1},{x:x+d,y,id:2}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-d*ratio,y,id:1},{x:x+d*ratio,y,id:2}]});await paint();
  if(!cancel)await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[{x:x-d*ratio,y,id:1}]});
  await cdp.send("Input.dispatchTouchEvent",{type:cancel?"touchCancel":"touchEnd",touchPoints:[]});await paint();
}
async function wheel(delta,deltaMode=0){
  const s=await scene(),b=await page.locator("#rogue-canvas").boundingBox(),r=s.mapRect;
  await page.mouse.move(b.x+r.x+r.w/2,b.y+r.y+r.h/2);
  if(deltaMode) await page.locator("#rogue-canvas").evaluate((el,{delta,deltaMode,x,y})=>{const b=el.getBoundingClientRect();el.dispatchEvent(new WheelEvent('wheel',{clientX:b.x+x,clientY:b.y+y,deltaY:delta,deltaMode,bubbles:true,cancelable:true}));},{delta,deltaMode,x:r.x+r.w/2,y:r.y+r.h/2});
  else await page.mouse.wheel(0,delta);
  await paint();
}
const snapshot=async()=>{const s=await scene();return {size:s.camera.size,cell_h:s.camera.cellH,columns:s.mapRect?.w/s.camera.size,rows:s.mapRect?.h/s.camera.cellH};};
try{
  runtime=await prepareBrowserRuntime(root);browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:true,args:["--disable-gpu"],downloadsPath:runtime.downloadsPath});
  evidence.zooms=[];
  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1200,height:800}])for(const mode of ["tiles","pixels","ascii"]){
    const mobile=viewport.width!==1200;
    await context?.close();context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});page=await context.newPage();page.setDefaultTimeout(10000);await installBrowserTestAdapter(page);page.on("pageerror",e=>evidence.errors.push(e.message));cdp=await context.newCDPSession(page);
    await page.goto(base+"?trace=1&view="+mode+"&lang=ja");await page.waitForFunction(()=>__rogueBrowserTest.canvas?.paintCount>0);
    const click=async id=>{const c=(await scene()).controls.find(c=>c.id===id&&!c.disabled),b=await page.locator('#rogue-canvas').boundingBox();assert.ok(c,id);if(mobile)await page.touchscreen.tap(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);else await page.mouse.click(b.x+c.rect.x+c.rect.w/2,b.y+c.rect.y+c.rect.h/2);await paint();};
    await check(`${viewport.width} ${mode} top language changes and remains on top only`,async()=>{
      await click('select-language');await click('select-language-en');assert.equal(await page.evaluate(()=>__rogueBrowserTest.language),'en');
      await click('select-language');await click('select-language-ja');assert.equal(await page.evaluate(()=>__rogueBrowserTest.language),'ja');assert.equal(await page.evaluate(()=>__rogueBrowserTest.generation),0);
      assert.ok(!(await scene()).text.some(t=>t==='冒険を始める'));
    });
    await click('seed');await page.keyboard.press('Control+a');await page.keyboard.insertText('123');await click('new-game');await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);await paint();
    const before=await state(),near=await snapshot(),expected=mode==='ascii'?6:16,max=mode==='pixels'?128:mode==='ascii'?24:64;
    await check(`${viewport.width} ${mode} wheel reaches wide range without game input`,async()=>{
      let broad={size:expected,cell_h:mode==='ascii'?9.5:16};
      if(mobile){await click('mobile-map');broad=await snapshot();assert.equal(broad.size,expected);await click('mobile-map');assert.deepEqual(await snapshot(),near);}
      for(let i=0;i<7;i++)await wheel(160);const low=await snapshot();assert.equal(low.size,broad.size);assert.equal(low.cell_h,broad.cell_h);
      for(let i=0;i<7;i++)await wheel(-160);assert.equal((await snapshot()).size,max);
      if(mobile){await click('mobile-map');assert.equal((await snapshot()).size,expected);await pinch(2);assert.equal((await snapshot()).size,near.size);await pinch(.5);assert.equal((await snapshot()).size,expected);await wheel(160);assert.equal((await snapshot()).size,expected);await wheel(-160);assert.ok((await snapshot()).size>expected);}
      for(let i=0;i<7;i++)await wheel(160);assert.equal((await snapshot()).size,expected);
      await wheel(-4,1);assert.ok((await snapshot()).size>expected);await wheel(1,2);assert.equal((await snapshot()).size,expected);
      assert.deepEqual(await state(),before);evidence.zooms.push({viewport,mode,near,broad,low});
    });
    if(mobile)await check(`${viewport.width} ${mode} pinch 2x and half match actual button scale`,async()=>{
      await click('mobile-map');assert.equal((await snapshot()).size,expected);await pinch(2);assert.equal((await snapshot()).size,near.size);
      await pinch(.5);assert.equal((await snapshot()).size,expected);
      for(const ratio of [2,.5,3,.2,2,.5])await pinch(ratio);assert.equal((await snapshot()).size,expected);
      await pinch(2,true);assert.equal((await snapshot()).size,near.size);assert.deepEqual(await state(),before);await shot(mode+'-'+viewport.width+'-zoom');
    });
    await check(`${viewport.width} ${mode} settings wheel stays within settings and keeps notices in log`,async()=>{
      const size=(await snapshot()).size;await click('settings-toggle');const s=await scene();assert.ok(!s.controls.some(c=>['select-language','tile-zoom','header-fullscreen'].includes(c.id)) || !mobile&&s.controls.some(c=>c.id==='header-fullscreen'));
      if(mobile)assert.ok(!s.text.some(t=>t.includes('迷宮に入りました')||t==='地図の表示'));
      assert.ok(await page.evaluate(()=>__rogueBrowserTest.diagnostics.entries.some(e=>e.text.includes('迷宮に入りました'))));
      const r=s.regions.settings.rect,b=await page.locator('#rogue-canvas').boundingBox();await page.mouse.move(b.x+r.x+30,b.y+r.y+40);await page.mouse.wheel(0,200);await paint();assert.equal((await snapshot()).size,size);assert.deepEqual(await state(),before);await shot(mode+'-'+viewport.width+'-settings');await click('settings-close');
    });
    const savedSize=await page.evaluate(()=>__rogueBrowserTest.graphics.tileSize);await page.reload();await page.waitForFunction(()=>__rogueBrowserTest.canvas?.paintCount>0);assert.equal(await page.evaluate(()=>__rogueBrowserTest.graphics.tileSize),savedSize);
  }
  assert.deepEqual(evidence.errors,[]);evidence.result="pass";
}catch(e){evidence.result="fail";evidence.failure=e.stack;throw e;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

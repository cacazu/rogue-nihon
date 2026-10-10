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

const root=fileURLToPath(new URL("../../",import.meta.url));
const browserName=process.env.ROGUE_CHROME?.includes("Brave")?"brave":"chrome",output=artifactDirectory(path.join(root,"tests/browser-smoke/output/save-export",browserName));
await mkdir(output,{recursive:true});
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=createPreviewServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port+"/",evidence={started_at:new Date().toISOString(),browser:browserName,checks:[],exports:[],screenshots:[],errors:[]};
let browser,context,page,runtime;
const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>({words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,frameCount:__rogueBrowserTest.frameCount}));
async function check(label,fn){await fn();evidence.checks.push(label);console.log("PASS "+label);}
async function click(id,touch=false){
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  const r=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id).rect,id);
  if(touch)await page.touchscreen.tap(r.x+r.w/2,r.y+r.h/2);else await page.mouse.click(r.x+r.w/2,r.y+r.h/2);
  await paint();
}
async function persistedBytes(){
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open("original-rogue-web",1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,transaction=db.transaction("saves","readonly"),save=transaction.objectStore("saves").get("manual");
      transaction.oncomplete=()=>{db.close();resolve(Array.from(new Uint8Array(save.result)));};
      transaction.onerror=()=>{db.close();reject(transaction.error);};
    };
  }));
}
try{
  runtime=await prepareBrowserRuntime(root);evidence.runtime=runtime.diagnostics;
  browser=await chromium.launch({executablePath:process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:true,args:["--disable-gpu"],downloadsPath:runtime.downloadsPath});
  evidence.version=browser.version();
  for(const [lang,touch] of [["ja",false],["ja",true],["en",true]]){
    const label=lang+"-"+(touch?"mobile":"pc");
    await context?.close();context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1240,height:900},hasTouch:touch,isMobile:touch,deviceScaleFactor:touch?2:1,acceptDownloads:true});
    page=await context.newPage();page.on("pageerror",error=>evidence.errors.push(error.message));
    await page.goto(base+"?trace=1&view=pixels&lang="+lang);await page.waitForFunction(()=>window.__rogueBrowserTest?.canvas?.paintCount>0);
    for(const [id,value] of [["name","書き出し勇者"],["seed","17"]]){await click(id,touch);await page.keyboard.press("Control+a");await page.keyboard.insertText(value);}
    await click("new-game",touch);await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0);await paint();
    await page.keyboard.press("i");await page.waitForFunction(()=>__rogueBrowserTest.frame.ui.window);await paint();
    const before=await state();await click("settings-toggle",touch);await click("save",touch);
    await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending);await paint();
    await page.waitForFunction(n=>__rogueBrowserTest.queuePending===0&&__rogueBrowserTest.inputRequestCount>n,before.input);
    const exportState=await state();assert.deepEqual(exportState.words,before.words);assert.equal(exportState.frameCount,before.frameCount);
    const saved=Buffer.from(await persistedBytes());assert.equal(JSON.parse(saved).version,2);
    await check(label+" exports the exact saved bytes twice without C/RNG input",async()=>{
      for(let n=1;n<=2;n++){
        const pending=page.waitForEvent("download");await click("download-save",touch);const download=await pending;
        assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),"rogue-save.json");
        const file=label+"-save-"+n+".json";await download.saveAs(path.join(output,file));const bytes=await readFile(path.join(output,file));
        assert.deepEqual(bytes,saved);assert.deepEqual(await state(),exportState);
        evidence.exports.push({file,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),failure:null});
      }
      const screenshot=label+"-export-settings.png";await page.screenshot({path:path.join(output,screenshot)});evidence.screenshots.push(screenshot);
    });
    await check(label+" exported JSON restores an inventory in a fresh Worker",async()=>{
      // Replace the saved slot with bytes read from the exported file before loading.
      const exported=await readFile(path.join(output,label+"-save-1.json"));
      await page.evaluate(bytes=>new Promise((resolve,reject)=>{
        const request=indexedDB.open("original-rogue-web",1);request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result,transaction=db.transaction("saves","readwrite");transaction.objectStore("saves").put(new Uint8Array(bytes).buffer,"manual");
          transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=()=>{db.close();reject(transaction.error);};};
      }),Array.from(exported));
      const generation=await page.evaluate(()=>__rogueBrowserTest.generation);
      await click("settings-top",touch);await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await click("load",touch);
      await page.waitForFunction(n=>__rogueBrowserTest.generation>n&&__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.queuePending===0,generation);await paint();
      assert.equal(await page.evaluate(()=>__rogueBrowserTest.frame.ui.mode),"menu");assert.deepEqual((await state()).words.slice(1,16),before.words.slice(1,16));
      await click("window-32",touch);await page.waitForFunction(()=>!__rogueBrowserTest.frame.ui.window);
      await page.keyboard.press(".");await page.waitForFunction(n=>__rogueBrowserTest.trace.words[13]===n+1,before.words[13]);
    });
  }
  assert.deepEqual(evidence.errors,[]);
  evidence.files=await Promise.all(["web/app.js","web/canvas-ui.js","web/worker.js","build/browser-ui.wasm","rust/crates/browser-display/src/controller.rs","rust/crates/browser-display/src/policies.rs","tests/browser-smoke/browser-runtime.mjs","tests/browser-smoke/save-export.mjs"].map(async file=>({file,sha256:createHash("sha256").update(await readFile(path.join(root,file))).digest("hex")})));
  evidence.result="pass";
}catch(error){evidence.result="fail";evidence.failure=error.stack;throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");await context?.close();await browser?.close();await runtime?.dispose();await new Promise(r=>server.close(r));}

import assert from "node:assert/strict";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadPlaywright, browserExecutable} from "../../tools/toolchain.mjs";
import {artifactDirectory} from "../../tools/temporary-artifacts.mjs";
import {createPreviewServer} from "../../../tools/server.mjs";
import {prepareBrowserRuntime} from "./browser-runtime.mjs";
import {installBrowserTestAdapter} from "./test-adapter.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const output=process.env.ROGUE_OWNERSHIP_OUTPUT ? path.resolve(process.env.ROGUE_OWNERSHIP_OUTPUT,"save") : artifactDirectory(path.join(root,"tests/browser-smoke/output/ownership-boundaries"));
await mkdir(output,{recursive:true});
const {chromium}=loadPlaywright(), report={checks:[],errors:[]};
const server=process.env.ROGUE_TEST_BASE?null:createPreviewServer();
if(server)await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base=process.env.ROGUE_TEST_BASE||`http://127.0.0.1:${server.address().port}/`;
let runtime,browser,context,page;
const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const state=()=>page.evaluate(()=>({generation:__rogueBrowserTest.generation,words:__rogueBrowserTest.trace.words,input:__rogueBrowserTest.inputRequestCount,pending:__rogueBrowserTest.queuePending}));
async function tap(id){
  await page.waitForFunction(id=>__rogueBrowserTest.canvas.controls.some(c=>c.id===id&&!c.disabled),id);
  const rect=await page.evaluate(id=>__rogueBrowserTest.canvas.controls.find(c=>c.id===id).rect,id);
  const bounds=await page.locator("#rogue-canvas").boundingBox();
  await page.mouse.click(bounds.x+rect.x+rect.w/2,bounds.y+rect.y+rect.h/2);await paint();
}
async function idle(){
  await page.waitForFunction(()=>__rogueBrowserTest.running&&__rogueBrowserTest.trace&&__rogueBrowserTest.frame?.ui.input.kind==="command"&&__rogueBrowserTest.queuePending===0);
  await paint();
}
async function check(label,operation){await operation();report.checks.push(label);console.log("PASS "+label);}
async function stored(bytes){
  return page.evaluate(bytes=>new Promise((resolve,reject)=>{
    const request=indexedDB.open("original-rogue-web",1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,transaction=db.transaction("saves",bytes?"readwrite":"readonly");
      const operation=bytes?transaction.objectStore("saves").put(new Uint8Array(bytes),"manual"):transaction.objectStore("saves").get("manual");
      transaction.oncomplete=()=>{db.close();resolve(bytes?null:Array.from(new Uint8Array(operation.result)));};
      transaction.onerror=()=>{db.close();reject(transaction.error);};
    };
  }),bytes?Array.from(bytes):null);
}
async function exported(label){
  const pending=page.waitForEvent("download");await tap("download-save");const download=await pending;
  assert.equal(await download.failure(),null);const file=path.join(output,label+".json");await download.saveAs(file);return readFile(file);
}
async function save(){
  await tap("settings-toggle");await tap("save");
  await page.waitForFunction(()=>__rogueBrowserTest.savedLength>0&&!__rogueBrowserTest.savePending&&__rogueBrowserTest.queuePending===0);await paint();
}
async function importFile(bytes){
  const pending=page.waitForEvent("filechooser");await tap("import-save");const chooser=await pending;
  await chooser.setFiles(bytes?{name:"rogue-save.json",mimeType:"application/json",buffer:bytes}:[]);
}

try {
  runtime=await prepareBrowserRuntime(root);
  browser=await chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
  context=await browser.newContext({viewport:{width:1240,height:900},acceptDownloads:true});
  await installBrowserTestAdapter(context);
  await context.addInitScript({content:`
    // Delay the actual first read transaction completion, before app.js receives bytes.
    const hold=new URLSearchParams(location.search).get("holdInit")==="1";
    let initial=null,readHeld=false,initResult=null;
    const transaction=IDBDatabase.prototype.transaction;
    const completed=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,"oncomplete");
    IDBDatabase.prototype.transaction=function(...args){
      const value=transaction.apply(this,args);
      if(hold&&!readHeld&&args[0]==="saves"&&args[1]==="readonly"){
        readHeld=true;
        Object.defineProperty(value,"oncomplete",{set(callback){
          completed.set.call(value,event=>{initial=()=>callback.call(value,event);});
        }});
      }
      return value;
    };
    globalThis.__ownership={get heldInit(){return Boolean(initial);},get starting(){return __rogueBrowserTest.diagnostics?.starting;},
      get initResult(){return initResult;},releaseInit(){const callback=initial;initial=null;callback();initResult=true;},
      repeatAssets(){const plan=__rogueUiAdapter.request({type:"asset-plan",mode:"tiles"});return __rogueUiAdapter.dispatchRequest({type:"api",operation:"assets",ok:true,set:"tiles",images:plan.expectedDimensions});}};
  `});
  page=await context.newPage();page.on("pageerror",error=>report.errors.push(error.message));
  await page.goto(base+"?trace=1");
  await page.waitForFunction(()=>__rogueBrowserTest.canvas?.controls.some(c=>c.id==="new-game"&&!c.disabled));
  await tap("new-game");await idle();
  const first=await state();let firstBytes,secondBytes,second;
  await check("save and export commit the completed IndexedDB bytes without a C turn",async()=>{
    await save();firstBytes=await exported("first");assert.deepEqual(firstBytes,Buffer.from(await stored()));
    assert.deepEqual((await state()).words,first.words);
    await tap("settings-close");await page.keyboard.press(".");
    await page.waitForFunction(turn=>__rogueBrowserTest.trace.words[13]===turn+1,first.words[13]);await idle();second=await state();
    await save();secondBytes=await exported("second");assert.deepEqual(secondBytes,Buffer.from(await stored()));assert.notDeepEqual(secondBytes,firstBytes);
  });
  await stored(firstBytes);
  await check("accepted load restores the stored checkpoint in a new Worker and advances normally",async()=>{
    await tap("settings-top");await page.waitForFunction(()=>__rogueBrowserTest.topOpen);await paint();
    await tap("load");await idle();const loaded=await state();
    assert.ok(loaded.generation>second.generation);assert.deepEqual(loaded.words,first.words);
    await tap("settings-toggle");assert.deepEqual(await exported("after-load"),firstBytes);await tap("settings-close");
    await page.keyboard.press(".");await page.waitForFunction(turn=>__rogueBrowserTest.trace.words[13]===turn+1,first.words[13]);await idle();
    assert.deepEqual((await state()).words,second.words);
  });
  await page.goto(base+"?trace=1&holdInit=1");
  await page.waitForFunction(()=>__ownership?.heldInit&&__rogueBrowserTest.canvas?.controls.some(c=>c.id==="import-save"&&!c.disabled));
  await check("a delayed init response cannot replace an accepted import or its export bytes",async()=>{
    await importFile(secondBytes);await idle();const imported=await state();
    assert.deepEqual(imported.words,second.words);
    await page.evaluate(()=>__ownership.releaseInit());await page.waitForFunction(()=>__ownership.initResult);
    await paint();
    assert.deepEqual(await state(),imported);
    await tap("settings-toggle");assert.deepEqual(await exported("after-stale-init"),secondBytes);
    await page.screenshot({path:path.join(output,"restored-after-stale-init.png")});
  });
  await check("cancelled and invalid imports keep the running Worker and accepted bytes",async()=>{
    const before=await state();
    await importFile(null);await page.waitForFunction(()=>!__ownership.starting);await paint();assert.deepEqual(await state(),before);
    await importFile(Buffer.from("invalid JSON save"));await page.waitForFunction(()=>!__ownership.starting);await paint();assert.deepEqual(await state(),before);
    assert.deepEqual(await exported("after-invalid-import"),secondBytes);
  });
  await check("duplicate asset acknowledgements preserve readiness and game state",async()=>{
    const before=await state();
    for(let index=0;index<3;index++)assert.equal((await page.evaluate(()=>__ownership.repeatAssets())).state.ready,true);
    assert.deepEqual(await state(),before);
  });
  assert.deepEqual(report.errors,[]);report.result="pass";
} catch(error) {report.result="fail";report.failure=error.stack;throw error;}
finally {
  await writeFile(path.join(output,"evidence.json"),JSON.stringify(report,null,2)+"\n");
  await context?.close();await browser?.close();await runtime?.dispose();
  if(server)await new Promise(resolve=>server.close(resolve));
}

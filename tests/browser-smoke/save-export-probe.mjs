import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";
import {createRequire} from "node:module";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import http from "node:http";

const root=fileURLToPath(new URL("../../",import.meta.url)),output=artifactDirectory(path.join(root,"tests/browser-smoke/output/save-export",process.env.ROGUE_PROBE_MODE||"restricted"));
await mkdir(output,{recursive:true});
if(process.env.ROGUE_PROBE_LOCAL_TEMP==="1") {
  const scratch=path.join(output,"scratch");await mkdir(scratch,{recursive:true});process.env.TEMP=scratch;process.env.TMP=scratch;
}
const {chromium}=createRequire(import.meta.url)(process.env.ROGUE_PLAYWRIGHT_MODULE||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=http.createServer((request,response)=>{
  if(request.url==="/file.json"){response.writeHead(200,{"Content-Type":"application/json","Content-Disposition":'attachment; filename="probe.json"'});response.end('{"probe":true}');}
  else{response.writeHead(200,{"Content-Type":"text/html"});response.end('<button id="download">Download probe</button>');}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const executable=process.env.ROGUE_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const evidence={started_at:new Date().toISOString(),executable,results:[]};
let browser;
try{
  browser=await chromium.launch({executablePath:executable,headless:true,downloadsPath:path.join(output,"downloads"),args:["--disable-gpu","--enable-logging","--log-file="+path.join(output,"chrome-download.log"),"--vmodule=*download*=2,quarantine*=2"]});
  evidence.browser=browser.version();const session=await browser.newBrowserCDPSession();
  const progress=[];session.on("Browser.downloadProgress",event=>progress.push(event));
  for(const type of ["blob-json","blob-binary","http-attachment"]){
    const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();
    await page.goto("http://127.0.0.1:"+server.address().port+"/");
    await page.evaluate(type=>document.getElementById("download").onclick=()=>{
      const link=document.createElement("a");link.download="probe.json";
      link.href=type==="http-attachment"?"/file.json":URL.createObjectURL(new Blob(['{"probe":true}'],{type:type==="blob-json"?"application/json":"application/octet-stream"}));
      document.body.append(link);link.click();link.remove();
    },type);
    const pending=page.waitForEvent("download");await page.locator("#download").click();const download=await pending;
    const failure=await download.failure();const file=failure?null:await download.path();
    await page.goto("chrome://downloads/");
    const ui=await page.evaluate(()=>{
      const manager=document.querySelector("downloads-manager");
      return manager?.items?.map(item=>({state:item.state,fileName:item.fileName,dangerType:item.dangerType,failState:item.failState,lastReasonText:item.lastReasonText}))||[];
    });
    const result={type,failure,bytes:file?(await readFile(file)).length:null,ui,progress:progress.splice(0)};
    evidence.results.push(result);console.log(JSON.stringify(result));await context.close();
  }
}finally{
  await browser?.close();await new Promise(r=>server.close(r));evidence.finished_at=new Date().toISOString();
  await writeFile(path.join(output,"probe.json"),JSON.stringify(evidence,null,2)+"\n");
}

import {mkdir,mkdtemp,realpath,rm} from "node:fs/promises";
import path from "node:path";
import { artifactDirectory } from "../../tools/temporary-artifacts.mjs";

// Windows terminal sandboxes can deny Chrome file renames in their default TEMP.
// Playwright creates profiles and download staging files there even when only
// downloadsPath is set. Give the whole test process a writable, isolated runtime.
export async function prepareBrowserRuntime(root) {
  const project=await realpath(root),base=artifactDirectory(path.join(project,".local","playwright"));
  await mkdir(base,{recursive:true});const baseReal=await realpath(base);
  const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative!==""&&!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative);};
  if(!inside(project,baseReal))throw Error("Browser runtime must stay inside the project");
  const scratch=await mkdtemp(path.join(baseReal,"run-")),temp=path.join(scratch,"temp"),downloadsPath=path.join(scratch,"downloads");
  await mkdir(temp);await mkdir(downloadsPath);
  const names=process.platform==="win32"?["TEMP","TMP"]:["TMPDIR"];
  const previous=new Map(names.map(name=>[name,process.env[name]]));
  for(const name of names)process.env[name]=temp;
  let disposed=false;
  return {
    downloadsPath,
    diagnostics:{platform:process.platform,scratch,temp,downloadsPath},
    async dispose() {
      if(disposed)return;disposed=true;
      for(const [name,value] of previous)if(value===undefined)delete process.env[name];else process.env[name]=value;
      const resolved=await realpath(scratch);
      // Verify the exact resolved target before recursively removing this run only.
      if(!inside(baseReal,resolved)||path.dirname(resolved)!==baseReal||!path.basename(resolved).startsWith("run-"))throw Error("Unsafe browser runtime cleanup target");
      await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  };
}

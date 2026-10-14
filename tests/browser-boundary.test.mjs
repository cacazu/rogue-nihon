import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {browserUiRuntime} from "./browser-ui-runtime.mjs";

async function webSources(directory = "") {
 const files=[];
 for(const entry of await readdir(new URL("../web/"+directory,import.meta.url),{withFileTypes:true})){
  const file=directory+entry.name;
  if(entry.isDirectory())files.push(...await webSources(file+"/"));
  else if(/\.(?:[cm]?js|html)$/i.test(entry.name))files.push(file);
 }
 return files.sort();
}

test("all handwritten production JS excludes UI/input policies and test imports",async()=>{
 const files=await webSources();
 const startupCalls=new Set(["init","browser_start","import","then","default","worker_boot","catch","postMessage","String"]);
 for(const file of files){
  const source=await readFile(new URL("../web/"+file,import.meta.url),"utf8");
  assert.doesNotMatch(source,/(?:import|require|importScripts).*\btests\//,file);
  if(file==="abi.js"){
   const declaration=source.replace(/\/\*[\s\S]*?\*\//g,"").trim().match(/^globalThis\.RG_ABI\s*=\s*Object\.freeze\((\{[\s\S]*\})\);$/);
   assert.ok(declaration,"ABI JavaScript must contain generated data only");
   const constants=JSON.parse(declaration[1]);
   assert.ok(Object.keys(constants).every(name=>/^RG_[A-Z0-9_]+$/.test(name)));
   assert.ok(Object.values(constants).every(Number.isInteger));
   continue;
  }
  if(/\.[cm]?js$/i.test(file)){
   assert.ok(file==="app.js"||file==="worker.js",file+" is not a Wasm startup entry point");
   const code=source.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"");
   assert.doesNotMatch(code,/\b(?:for|while|switch|class|function|eval)\b/,file+" must not define application processing");
   for(const [,call]of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g))
    assert.ok(startupCalls.has(call),file+" calls non-startup functionality: "+call);
  }
  if(file.endsWith(".html"))
   for(const [,attributes,body]of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    assert.match(attributes,/\bsrc\s*=\s*["']\/web\/app\.js["']/i,file+" must use the common Wasm startup");
    assert.equal(body.trim(),"",file+" must not contain inline application code");
   }
  assert.doesNotMatch(source,/\b(?:RogueViewSettings|RogueGameLog|RogueUiCatalog|validSeed|validName|textDraftDirty|returnAfterEnd|endingModes)\b/,file);
  assert.doesNotMatch(source,/\b(?:map_tiles|map_underlays|map_unknown_glyphs|RG_KEY_SAVE|RG_EVENT_SCALAR_MASK)\b/,file);
  assert.doesNotMatch(source,/"(?:notice\.[^"]+|error\.(?:seed|name|prompt_text|text_composing|queue_full)|ArrowUp|ArrowDown|Escape|Enter|new-game|random-name|settings-toggle)"/,file);
  assert.doesNotMatch(source,/codePointAt\s*\(/,file);
 }
 const html=await readFile(new URL("../web/index.html",import.meta.url),"utf8");
 assert.doesNotMatch(html,/(?:localization|view-settings|game-log|canvas-widgets|hud-widget)\.js/);
});
test("host snapshots cannot replace Rust session decisions",async()=>{
 const request=await browserUiRuntime();request({type:"boot",environment:{isolated:true,parameters:{}}});
 const result=request({type:"render",model:{running:true,topOpen:false,settingsOpen:true,displayMode:"secret"},view:{width:390,height:844,ratio:2,now:0}});
 assert.equal(result.state.running,false);assert.equal(result.state.topOpen,true);assert.equal(result.state.settingsOpen,false);assert.equal(result.state.displayMode,"tiles");
 assert.ok(result.diagnostics.controls.some(c=>c.id==="new-game"));
 assert.ok(!result.diagnostics.controls.some(c=>c.id==="settings-toggle"));
});

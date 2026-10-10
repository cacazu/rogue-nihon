import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {browserUiRuntime} from "./browser-ui-runtime.mjs";
test("all handwritten production JS excludes UI/input policies and test imports",async()=>{
 const files=(await readdir(new URL("../web/",import.meta.url))).filter(file=>/\.m?js$/.test(file));
 for(const file of files){
  const source=await readFile(new URL("../web/"+file,import.meta.url),"utf8");
  assert.doesNotMatch(source,/(?:import|require|importScripts).*\btests\//,file);
  if(file==="abi.js")continue; // Generated constant declarations, no executable policy.
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
});

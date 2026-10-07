import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("game history retains repeated events, ignores display clears, separates system notices", () => {
  const GameLog = require("../../web/game-log.js");
  const log = new GameLog(3);
  log.message({id:"hit",text:"Hit"});
  log.message({id:"hit",text:"Hit"});
  log.message({id:"message.clear",text:""});
  log.notice("saved",{},false);
  assert.deepEqual(log.entries.map(e=>e.source),["game","game","system"]);
  assert.equal(log.entries.length,3);
  log.notice("saved",{},false);
  assert.equal(log.entries.length,3);
  log.message({id:"miss",text:"Miss"});
  assert.equal(log.entries.length,3);
  assert.equal(log.entries.at(-1).message.id,"miss");
});
test("log following respects readers away from bottom", () => {
  const GameLog = require("../../web/game-log.js");
  assert.equal(GameLog.atBottom({scrollHeight:1000,clientHeight:200,scrollTop:400}),false);
  assert.equal(GameLog.atBottom({scrollHeight:1000,clientHeight:200,scrollTop:799}),true);
});

test("repeated actual notices remain visible as separate events", () => {
  const GameLog=require("../../web/game-log.js"), log=new GameLog();
  log.notice("adjacent",{},true); log.notice("adjacent",{},true);
  assert.equal(log.entries.length,2);
});

test("Rust platform notices belong to system history",()=>{
 const GameLog=require("../../web/game-log.js"),log=new GameLog();
 log.message({id:"platform.restore_error",text:"Could not restore"});
 assert.equal(log.entries[0].source,"system");
});

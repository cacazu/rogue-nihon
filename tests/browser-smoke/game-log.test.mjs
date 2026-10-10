import test from "node:test";
import assert from "node:assert/strict";
import {browserUiRuntime} from "../browser-ui-runtime.mjs";
async function session(){
 const request=await browserUiRuntime();request({type:"boot",environment:{isolated:true,parameters:{}}});
 for(const set of ["tiles","pixels"]){const pixels=set==="pixels"?32:96;request({type:"api",operation:"assets",ok:true,set,images:Array(46).fill({width:pixels,height:pixels})});}
 request({type:"event",event:{type:"invoke",id:"new-game"}});request({type:"worker",generation:1,data:{type:"ready"}});return request;
}
test("Rust history preserves duplicate events, ignores clears and classifies platform errors",async()=>{
 const request=await session(),message=data=>request({type:"worker",generation:1,data:{type:"message",...data}});
 message({id:"hit",text:"Hit"});message({id:"hit",text:"Hit"});let r=message({id:"message.clear",text:""});
 assert.deepEqual(r.state.entries.filter(e=>e.source==="game").map(e=>e.text),["Hit","Hit"]);
 r=message({id:"platform.restore_error",text:"Could not restore"});assert.equal(r.state.entries.at(-1).source,"system");assert.equal(r.state.entries.at(-1).error,true);
});
test("Rust caps history at 500 events without coalescing repeats",async()=>{
 const request=await session();let r;
 for(let n=0;n<501;n++)r=request({type:"worker",generation:1,data:{type:"message",id:"hit",text:"Hit"}});
 assert.equal(r.state.entries.length,500);assert.ok(r.state.entries.every(e=>e.text==="Hit"));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runGame,SAVE_EVENT,textEvents,originalFrames} from './run-game.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const module=path.join(root,'build/game.wasm');
const config={seed:17,name:'Checked',locale:'ja',messagePaging:'log'};
const checked=value=>{assert.equal(value.length,1920);assert.ok(value.every(mask=>Number.isInteger(mask)&&mask>=0&&mask<=256));assert.ok(value.slice(0,80).concat(value.slice(1840)).every(mask=>mask===256));};

test('Normal game checkpoints restore checked public positions in a fresh instance',async()=>{
 const result=await runGame(module,{...config,events:[...textEvents('hjklyubn..'),SAVE_EVENT]});
 const saved=result.stores.at(-1);assert.ok(saved);const memory=JSON.parse(saved).presentation.map_memory;
 checked(memory.checked);assert.ok(memory.checked.some(mask=>mask<256));
 const restored=await runGame(module,{...config,restore:saved,text:'.'});
 assert.ok(!restored.outcomes.some(o=>o.code===-4));
 const frame=restored.frames.filter(f=>f.ui.mode==='game').at(-1);checked(frame.map_checked);
 for(let i=0;i<1920;i++)if(memory.checked[i]<256)assert.ok(frame.map_checked[i]<256,'A previously confirmed position survives restore');
});

test('Checked public observations preserve the same normal C input, screens, state and RNG', {skip:!process.env.ROGUE_CHECKED_BEFORE}, async()=>{
 const request={...config,text:'hjklyubn..'};
 const current=await runGame(module,request),before=await runGame(process.env.ROGUE_CHECKED_BEFORE,request);
 assert.deepEqual(current.traces,before.traces);assert.deepEqual(originalFrames(current.frames),originalFrames(before.frames));
 assert.deepEqual(current.messages,before.messages);assert.deepEqual(current.final,before.final);
});

test('Normal checkpoints without checked knowledge remain readable by the new game', {skip:!process.env.ROGUE_CHECKED_BEFORE}, async()=>{
 const before=process.env.ROGUE_CHECKED_BEFORE;
 const savedRun=await runGame(before,{...config,events:[...textEvents('hjklyubn..'),SAVE_EVENT]});
 const saved=savedRun.stores.at(-1);assert.ok(saved);assert.equal(JSON.parse(saved).presentation.map_memory.checked,undefined);
 const current=await runGame(module,{...config,restore:saved,text:'.'});
 const previous=await runGame(before,{...config,restore:saved,text:'.'});
 assert.ok(!current.outcomes.some(o=>o.code===-4));
 checked(current.frames.filter(f=>f.ui.mode==='game').at(-1).map_checked);
 assert.deepEqual(current.traces,previous.traces);assert.deepEqual(originalFrames(current.frames),originalFrames(previous.frames));
 assert.deepEqual(current.final,previous.final);
});

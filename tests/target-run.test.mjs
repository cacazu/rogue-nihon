import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runGame,SAVE_EVENT} from './run-game.mjs';
const module=process.env.ROGUE_TARGET_RUN_MODULE||fileURLToPath(new URL('../build/game-fixtures.wasm',import.meta.url));
const BASE=0x120010, CONTINUE=0x120020, STOP=0x120021;
const cfg={seed:17,name:'Player',locale:'ja',messagePaging:'log',fixture:'autowalk-clear'};
const start=mode=>BASE+3+(mode-1)*8; // hjklyubn: right is l.
const continuations=n=>Array(n).fill(CONTINUE);
for(const [mode,steps,expected] of [[1,5,15],[2,4,14]])test('target-run keeps original run '+mode+' and natural stop',async()=>{
 const original=await runGame(module,{...cfg,events:[mode===1?76:0x100006c]});
 const targeted=await runGame(module,{...cfg,events:[start(mode),...continuations(steps)]});
 assert.deepEqual(targeted.final,original.final,'all twenty C words and RNG match original run');
 assert.equal(targeted.final[3],expected);
 const gates=targeted.input_contexts.filter(e=>e.input.kind==='run-boundary');
 assert.equal(gates.length,steps);assert.ok(gates.every(e=>e.input.direction===108));
 assert.equal(targeted.host_events.filter(e=>e.type==='target-run-ended').length,1);
 assert.equal(targeted.consumed,1+steps,'natural stop never restarts the run');
});

for(const [fixture,steps,mode]of [['autowalk-clear',2,1],['autowalk-haste',1,1],['autowalk-clear',3,2]])
 test('target-run save replay reaches live gate without moving: '+fixture+'/'+mode+'/'+steps,async()=>{
  const events=[start(mode),...continuations(steps),SAVE_EVENT,STOP,106,46];
  const live=await runGame(module,{...cfg,fixture,events});
  const saved=JSON.parse(live.stores[0]);assert.equal(saved.version,3);
  const resumed=await runGame(module,{...cfg,fixture:undefined,restore:live.stores[0],events:[STOP,106,46]});
  assert.deepEqual(resumed.final,live.final,'checkpoint, haste phase, journal, RNG and next command agree');
  const firstLive=resumed.reads[0];assert.equal(firstLive.event,STOP);
  assert.equal(resumed.traces[firstLive.trace].words[3],10+steps,'first live gate has no extra step');
  assert.equal(resumed.final[3],10+steps);assert.equal(resumed.final[4],11,'next j executes exactly once');
  assert.equal(resumed.consumed,3);
 });

test('a target start replaces an unfinished numeric prefix',async()=>{
 const expected=await runGame(module,{...cfg,events:[start(1),CONTINUE,STOP,106,46]});
 const replaced=await runGame(module,{...cfg,events:[50,start(1),CONTINUE,STOP,106,46]});
 assert.deepEqual(replaced.final,expected.final);assert.equal(replaced.final[3],11);assert.equal(replaced.final[4],11);
});

for(const mode of [1,2])test('intentional segment stop turns without bypassing C run semantics: '+mode,async()=>{
 const r=await runGame(module,{...cfg,fixture:'autowalk-turn',events:[start(mode),...continuations(4),STOP,BASE+1+(mode-1)*8,...continuations(4),STOP,46]});
 assert.equal(r.final[3],14);assert.equal(r.final[4],14);
 assert.equal(r.host_events.some(e=>e.type==='target-run-ended'),false);
 assert.equal(r.input_contexts.filter(e=>e.input.kind==='run-boundary').length,10);
});

test('manual gate fallback stops and forwards the raw key exactly once',async()=>{
 const explicit=await runGame(module,{...cfg,events:[start(1),CONTINUE,STOP,106,46]});
 const fallback=await runGame(module,{...cfg,events:[start(1),CONTINUE,106,46]});
 assert.deepEqual(fallback.final,explicit.final);assert.equal(fallback.final[3],11);assert.equal(fallback.final[4],11);
 assert.equal(fallback.consumed,4);
});

test('boundary tokens never become ordinary commands, item choices or text',async()=>{
 for(const [prefix,suffix] of [[[],[46]],[[119],[27,46]],[[99,99],[13,46]]]){
  const config={...cfg,fixture:undefined,seed:1};
  const plain=await runGame(module,{...config,events:[...prefix,...suffix]});
  const injected=await runGame(module,{...config,events:[...prefix,CONTINUE,STOP,...(prefix.length?[start(1)]:[]),...suffix]});
  assert.deepEqual(injected.final,plain.final);
  assert.equal(injected.input_contexts.some(e=>e.input.kind==='run-boundary'),false);
 }
});


for(const [mode,steps]of [[1,5],[2,4]])test('retired live STOP after natural stop preserves the next manual key: '+mode,async()=>{
 const expected=await runGame(module,{...cfg,events:[start(mode),...continuations(steps),106,46]});
 const raced=await runGame(module,{...cfg,events:[start(mode),...continuations(steps),STOP,106,46]});
 assert.deepEqual(raced.final,expected.final,'all twenty C words and RNG agree after the queued cancellation');
 assert.equal(raced.code,-1);assert.equal(raced.final[4],11,'manual j executes once');
 assert.equal(raced.consumed,steps+4);
 assert.equal(raced.host_events.filter(e=>e.type==='target-run-ended').length,1);
});

for(const [mode,steps]of [[1,5],[2,4]])test('no-command actions finish before target-run input boundaries: '+mode,async()=>{
 const config={...cfg,fixture:'autowalk-no-command'};
 const expected=await runGame(module,{...config,events:[mode===1?76:0x100006c]});
 const targeted=await runGame(module,{...config,events:[start(mode),...continuations(steps)]});
 assert.deepEqual(targeted.final,expected.final);
 assert.equal(targeted.traces[0].words[13],2,'both forced no-command actions finish before reading the start');
 assert.equal(targeted.input_contexts.filter(e=>e.input.kind==='run-boundary').length,steps);
 assert.equal(targeted.host_events.filter(e=>e.type==='target-run-ended').length,1);
});

const historicalModules=[['before',process.env.ROGUE_TARGET_RUN_BEFORE],['original',process.env.ROGUE_TARGET_RUN_ORIGINAL]];
for(const [label,oldModule]of historicalModules){
 for(const [mode,steps,x]of [[1,5,15],[2,4,14]])test('fixed '+label+' original run parity: '+mode,{skip:!oldModule},async()=>{
  const fixed=await runGame(oldModule,{...cfg,events:[mode===1?76:0x100006c]});
  const ordinary=await runGame(module,{...cfg,events:[mode===1?76:0x100006c]});
  const targeted=await runGame(module,{...cfg,events:[start(mode),...continuations(steps)]});
  assert.deepEqual(fixed.frames[0].player,{x:10,y:10});
  assert.equal(fixed.frames[0].map_cells,targeted.frames[0].map_cells,'same public autowalk-clear fixture');
  assert.equal(fixed.final[3],x);
  assert.deepEqual(ordinary.final,fixed.final,'ordinary C command remains equal to fixed original');
  assert.deepEqual(targeted.final,fixed.final,'target gate preserves all twenty fixed-original words and RNG');
 });
 for(const version of [1,2])test('fixed '+label+' save v'+version+' and runtime17 resume in current core',{skip:!oldModule},async()=>{
  const old=await runGame(oldModule,{...cfg,events:[108,108,SAVE_EVENT,106,46]});
  const saved=JSON.parse(old.stores[0]);assert.equal(saved.version,2);
  const checkpoint=Buffer.from(saved.checkpoint_hex,'hex');
  const runtime=44+checkpoint.readUInt32LE(24)+checkpoint.readUInt32LE(28);
  assert.equal(checkpoint.readUInt32LE(runtime+8),17,'actual fixed module emitted the legacy runtime');
  if(version===1){
   // Version 1 is the documented ASCII journal/checkpoint projection without presentation.
   saved.version=1;delete saved.presentation;saved.checksum=legacyDigest(saved);
  }
  const resumed=await runGame(module,{...cfg,fixture:undefined,restore:JSON.stringify(saved),events:[106,46]});
  assert.deepEqual(resumed.final,old.final,'legacy runtime and journal keep all twenty C words and RNG');
  assert.equal(resumed.consumed,2);assert.equal(resumed.final[3],12);assert.equal(resumed.final[4],11);
  assert.equal(resumed.input_contexts.some(e=>e.input.kind==='run-boundary'),false,'legacy save never creates a target run');
 });
}

function legacyDigest(saved){
 let digest=2166136261;
 const add=bytes=>{for(const byte of bytes)digest=Math.imul((digest^byte)>>>0,16777619)>>>0;digest=Math.imul((digest^255)>>>0,16777619)>>>0;};
 const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value>>>0);return bytes;};
 add(Buffer.from(saved.format));add(u32(saved.version));add(u32(saved.abi));add(Buffer.from(saved.source));
 add(u32(saved.seed));add(Buffer.from(saved.name));add(Buffer.from(saved.checkpoint_hex));
 for(const key of saved.inputs)add(u32(key));add(u32(saved.input_index));
 return digest;
}


// New transport permissions retain the exact consumed v3 run journal.
const permit=(steps,direction=3)=>0x130000+(steps-1)*8+direction;
for(const mode of [1,2])for(const steps of [1,2])test('one permit advances exactly '+steps+' original run steps in mode '+mode,async()=>{
 const expected=await runGame(module,{...cfg,events:[start(mode),...continuations(steps),STOP,46]});
 const actual=await runGame(module,{...cfg,events:[start(mode),permit(steps),STOP,46]});
 assert.deepEqual(actual.final,expected.final);
 assert.equal(actual.final[3],10+steps,'start itself advances zero cells');
 assert.equal(actual.consumed,4,'one raw permit replaces the step permissions');
 if(steps>1)assert.ok(actual.frames.length<expected.frames.length,'intermediate frames are coalesced');
});
for(const mode of [1,2])test('natural C stop discards a long permit in mode '+mode,async()=>{
 const actual=await runGame(module,{...cfg,events:[start(mode),permit(80),106,46]});
 const expected=await runGame(module,{...cfg,events:[mode===1?76:0x100006c,106,46]});
 assert.deepEqual(actual.final,expected.final);
 assert.equal(actual.host_events.filter(e=>e.type==='target-run-ended').length,1);
});
test('manual shared transport interrupt stops the next original action without consuming the queued command twice',async()=>{
 const actual=await runGame(module,{...cfg,interruptAtPoll:4,events:[start(1),permit(80),46]});
 const expected=await runGame(module,{...cfg,events:[start(1),CONTINUE,STOP,46]});
 assert.deepEqual(actual.final,expected.final);
 assert.equal(actual.final[3],11);
});
test('saving after a permit stores only consumed original continue keys and resumes the live gate',async()=>{
 const actual=await runGame(module,{...cfg,events:[start(1),permit(2),SAVE_EVENT,STOP,46]});
 const saved=JSON.parse(actual.stores[0]);
 assert.equal(saved.version,3);
 assert.equal(saved.inputs.some(k=>k>=0x130000),false,'permission transport is never serialized');
 const restored=await runGame(module,{...cfg,fixture:undefined,restore:actual.stores[0],events:[STOP,46]});
 assert.deepEqual(restored.final,actual.final);
 assert.equal(restored.traces[restored.reads[0].trace].words[3],12,'restore adds no action');
});

for(const fixture of ['autowalk-dragon-hit','autowalk-dragon-miss'])test('a long run permit preserves every original bolt drawing event: '+fixture,async()=>{
 const actual=await runGame(module,{...cfg,seed:0,fixture,events:[start(1),permit(80),46]});
 const expected=await runGame(module,{...cfg,seed:0,fixture,events:[start(1),CONTINUE,STOP,46]});
 assert.deepEqual(actual.final,expected.final,'source interruption stops at the same C action');
 const projectiles=result=>result.frames.flatMap(frame=>frame.map_projectile_events||[]);
 assert.ok(projectiles(expected).some(event=>event.kind==='magic'),'fixture actually fires a dragon bolt');
 assert.deepEqual(projectiles(actual),projectiles(expected),'coalescing must retain every important projectile frame');
});

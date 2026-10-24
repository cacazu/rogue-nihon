import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runGame,SAVE_EVENT,textEvents} from './run-game.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const module=process.env.ROGUE_MAP_MEMORY_MODULE||path.join(root,'build/game-fixtures.wasm');
const config={seed:17,name:'Memory',locale:'ja',messagePaging:'log'};
const at=(x,y)=>y*80+x;
const gameFrames=result=>result.frames.filter(frame=>frame.ui.mode==='game');

test('Observed memory preserves dark-room floor while unknown darkness stays black',async()=>{
 const result=await runGame(module,{...config,fixture:'animation-dark',text:'lll'});
 const frames=gameFrames(result),first=frames.find(frame=>frame.player.x===10),last=frames.at(-1);
 assert.equal(first.cells[at(9,10)],'.');assert.equal(first.map_visible[at(9,10)],true);
 assert.equal(last.player.x,13);assert.equal(last.cells[at(9,10)],' ');
 assert.equal(last.map_cells[at(9,10)],'.');assert.equal(last.map_visible[at(9,10)],false);
 assert.equal(last.map_cells[at(17,10)],' ');assert.equal(last.map_tiles[at(17,10)],0);
 assert.equal(last.map_visible[at(17,10)],false);
 assert.equal(last.map_visible.length,80*24);assert.ok(last.map_visible.every(value=>typeof value==='boolean'));
});

test('Observed memory separates blind monster detection from ordinary sight',async()=>{
 const result=await runGame(module,{...config,fixture:'actor-underfoot-detected',text:'.'});
 const frame=gameFrames(result).at(-1),enemies=frame.map_actors.filter(actor=>actor.id!==0);
 assert.equal(enemies.length,5);assert.equal(frame.map_visible[at(frame.player.x,frame.player.y)],true);
 assert.equal(frame.map_visible.filter(Boolean).length,1);
 for(const actor of enemies){assert.equal(frame.map_visible[at(actor.x,actor.y)],false);assert.equal(frame.map_cells.charCodeAt(at(actor.x,actor.y)),actor.glyph);}
});

test('Observed memory survives a fresh checkpoint restore and further original input',async()=>{
 const before=await runGame(module,{...config,fixture:'animation-dark',events:[...textEvents('lll'),SAVE_EVENT]});
 const saved=before.stores.at(-1);assert.ok(saved);
 const envelope=JSON.parse(saved);assert.equal(envelope.presentation.map_memory.level,1);
 if(process.env.ROGUE_MAP_MEMORY_BEFORE){
  const original=await runGame(process.env.ROGUE_MAP_MEMORY_BEFORE,{...config,fixture:'animation-dark',events:[...textEvents('lll'),SAVE_EVENT]});
  const originalEnvelope=JSON.parse(original.stores.at(-1));
  assert.equal(envelope.checkpoint_hex,originalEnvelope.checkpoint_hex,'C serializer bytes remain identical');
  assert.deepEqual(envelope.inputs,originalEnvelope.inputs,'Only the original consumed inputs enter the journal');
 }
 assert.equal(envelope.presentation.map_memory.cells[at(9,10)],'.');
 const restored=await runGame(module,{...config,restore:saved,text:'l'});
 const last=gameFrames(restored).at(-1);assert.equal(last.player.x,14);
 assert.equal(last.map_cells[at(9,10)],'.');assert.equal(last.map_visible[at(9,10)],false);
 assert.ok(!restored.outcomes.some(outcome=>outcome.code===-4));
});

for(const fixture of ['animation-dark','actor-underfoot','actor-underfoot-detected','animation-hallucination']){
 test('Observed memory leaves original C screen/messages/state/RNG unchanged: '+fixture,{skip:!process.env.ROGUE_MAP_MEMORY_BEFORE},async()=>{
  const request={...config,fixture,text:fixture==='animation-dark'?'lllh..':'.l.'};
  const [current,before]=await Promise.all([runGame(module,request),runGame(process.env.ROGUE_MAP_MEMORY_BEFORE,request)]);
  assert.deepEqual(current.traces,before.traces);
  assert.deepEqual(current.frames.map(({cells,width,height,player,stats})=>({cells,width,height,player,stats})),before.frames.map(({cells,width,height,player,stats})=>({cells,width,height,player,stats})));
  assert.deepEqual(current.messages,before.messages);
  assert.deepEqual(current.final,before.final);
 });
}

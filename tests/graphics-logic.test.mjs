import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runGame,SAVE_EVENT,textEvents} from './run-game.mjs';
const old=process.env.ROGUE_GRAPHICS_BASELINE;
const current=fileURLToPath(new URL('../build/game.js',import.meta.url));
test('graphical semantic observations preserve exact original rules, RNG, knowledge and save bytes',{skip:!old?'Set ROGUE_GRAPHICS_BASELINE to the pre-graphics build/game.js':false},async()=>{
 for(const seed of [1,12345,987654321]){
  const config={seed,text:'v .hljki \x1b..',repaint:25};
  const before=await runGame(old,config),after=await runGame(current,config);
  assert.deepEqual(after.final,before.final,'All 20 C snapshot words must match');
  assert.deepEqual(after.traces.map(t=>t.words),before.traces.map(t=>t.words));
  assert.deepEqual(after.frames.map(f=>f.cells),before.frames.map(f=>f.cells));
  assert.equal(after.repaint_pure,25);
  for(const frame of after.frames){assert.equal(frame.map_tiles.length,1920);assert.equal(frame.map_tile_ids.length,49);assert.deepEqual(frame.map_unknown_glyphs,[]);}
 }
 const config={seed:12345,locale:'ja',events:[...textEvents('.'),SAVE_EVENT,...textEvents('.') ]};
 const before=await runGame(old,config),after=await runGame(current,config);
 assert.equal(before.stores.length,1);assert.equal(after.stores.length,1);
 assert.equal(after.stores[0],before.stores[0],'Save envelope and normalized C checkpoint bytes must remain identical');
 const restored=await runGame(current,{locale:'ja',restore:after.stores[0],text:'.'});
 assert.deepEqual(restored.final,after.final,'New Worker-style restore preserves original rules');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runGame} from './run-game.mjs';
const modulePath=fileURLToPath(new URL('../build/graphics-fixtures.js',import.meta.url));
for(const [direction,index,glyph] of [['h',10,'-'],['v',11,'|'],['s',12,'/'],['b',13,'\\']]){
 test('actual C fire_bolt exposes only the perceived '+direction+' projectile',async()=>{
  const result=await runGame(modulePath,{seed:1,locale:'ja',fixture:'graphics-beam-'+direction});
  const beamFrames=result.frames.filter(frame=>frame.map_tiles.includes(index));
  assert.ok(beamFrames.length>0,'Real C bolt refresh must emit semantic effect');
  for(const frame of beamFrames){
   assert.deepEqual(frame.map_unknown_glyphs,[]);
   frame.map_tiles.forEach((id,position)=>{if(id===index)assert.equal(frame.cells[position],glyph);});
  }
  assert.ok(!result.frames.at(-1).map_tiles.some(id=>id>=10&&id<=13),'Transient effects must clear after C restores its map');
 });
}

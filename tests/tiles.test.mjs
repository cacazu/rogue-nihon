import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), Tiles=require('../web/tiles.js');
const manifest=JSON.parse(await readFile(new URL('../web/assets/tiles/manifest.json',import.meta.url),'utf8'));
const images=new Map(manifest.entries.map(e=>[e.image,{name:e.image}]));
const tiles=new Tiles(manifest,images);
const fixture=(width,height,ids=Array(width*height).fill(0))=>({width,height,map_tiles:ids,map_tile_ids:manifest.entries.map(e=>e.id),map_unknown_glyphs:[]});
test('all 49 semantic IDs have localized 96px raster assets; all 26 source monsters match',async()=>{
 assert.equal(new Set(manifest.entries.map(e=>e.id)).size,49);assert.equal(images.size,46);
 for(const entry of manifest.entries){
  const bytes=await readFile(new URL('../web/assets/tiles/'+entry.image,import.meta.url));
  assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),96);assert.equal(bytes.readUInt32BE(20),96);
  assert.equal(bytes[25],6);assert.match(entry.labels.ja,/[\u3040-\u30ff\u3400-\u9fff]/);
 }
 const source=await readFile(new URL('../logic/extern.c',import.meta.url),'utf8');
 const names=[...source.split('struct monster monsters[26]')[1].split('#undef ___')[0].matchAll(/\{\s*"([^"]+)"/g)].map(m=>'monster.'+m[1].replaceAll(' ','_'));
 assert.deepEqual(manifest.entries.filter(e=>e.group==='monster').map(e=>e.id),names);
});
test('mismatched vocabularies and unmapped cells fail visibly instead of ASCII fallback',()=>{
 const frame=fixture(3,3);tiles.validate(frame);
 assert.throws(()=>tiles.validate({...frame,map_unknown_glyphs:[97]}),/Unmapped/);
 assert.throws(()=>tiles.validate({...frame,map_tiles:[49]}),/Unmapped/);
 const ids=frame.map_tile_ids.slice();ids[1]='secret.floor';assert.throws(()=>tiles.validate({...frame,map_tile_ids:ids}),/Unmapped/);
});
test('hidden cells draw darkness only; image painting uses integer device rectangles and no text',()=>{
 const calls=[],context={imageSmoothingEnabled:true,drawImage:(image,...rectangle)=>calls.push({image,rectangle}),fillText:()=>assert.fail('ASCII fallback'),save(){},restore(){},translate(){},rotate(){}};
 const frame=fixture(4,4);tiles.draw(context,frame,{size:24,ratio:1.25,left:3,top:5,width:70,height:43});
 assert.equal(context.imageSmoothingEnabled,false);assert.ok(calls.length);
 for(const call of calls){assert.equal(call.image.name,'terrain.unexplored.png');assert.ok(call.rectangle.every(Number.isInteger));}
 assert.deepEqual(frame.map_tiles,Array(16).fill(0));
});
test('transparent entities overlay a neutral stage only after a perceived glyph exists',()=>{
 const calls=[],context={drawImage:image=>calls.push(image.name),save(){},restore(){},translate(){},rotate(){}};
 const frame=fixture(1,3,[0,8,0]);tiles.draw(context,frame,{size:32,ratio:1,left:0,top:0,width:32,height:32});
 assert.deepEqual(calls,['terrain.floor.png','actor.player.png']);assert.deepEqual(frame.map_tiles,[0,8,0]);
});
test('pointer hit testing preserves map coordinates through camera scroll and CSS zoom',()=>{
 const canvas={getBoundingClientRect:()=>({left:10,top:20,width:400,height:240})};
 const camera={size:32,left:320,top:64,width:200,height:120};
 assert.deepEqual(tiles.coordinate({clientX:42,clientY:52},canvas,fixture(80,24),camera),{x:10,y:3});
});

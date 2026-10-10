import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), Tiles=require('../web/tiles.js');
import {browserUiRuntime} from './browser-ui-runtime.mjs';
import {installTileTestAdapter} from './tile-test-adapter.mjs';
const request=await browserUiRuntime();
installTileTestAdapter(Tiles,request);
const manifest=JSON.parse(await readFile(new URL('../web/assets/tiles/manifest.json',import.meta.url),'utf8'));
const images=new Map(manifest.entries.map(e=>[e.image,{name:e.image}]));
const tiles=new Tiles(request({type:'asset-plan'}).manifest,images);
const fixture=(width,height,ids=Array(width*height).fill(0))=>({width,height,map_tiles:ids,map_tile_ids:manifest.entries.map(e=>e.id),map_unknown_glyphs:[]});
test('all 49 semantic IDs have localized 96px raster assets; all 26 source monsters match',async()=>{
 assert.equal(new Set(manifest.entries.map(e=>e.id)).size,49);assert.equal(images.size,45);
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
// Pointer/camera integration is exercised on the actual Canvas in canvas.mjs.

test('player and every enemy share terrain compositing, including darkness; stale coordinates never apply',()=>{
 const camera={size:32,ratio:1,left:0,top:0,width:32,height:32};
 for(const actor of [8,...Array.from({length:26},(_,i)=>23+i)]){
 const frame=fixture(1,3,[0,actor,0]);
 for(const [tile,filename] of [[0,'terrain.unexplored.png'],[1,'terrain.floor.png'],[2,'terrain.passage.png'],[3,'terrain.door.png'],[6,'terrain.stairs.png'],[7,'terrain.trap.png']]){
  const calls=[],context={drawImage:image=>calls.push(image.name),save(){},restore(){},translate(){},rotate(){}};
  tiles.draw(context,{...frame,map_underlays:[{x:0,y:1,tile}]},camera);
  assert.deepEqual(calls,[...([3,6,7].includes(tile)?['terrain.floor.png']:[]),filename,manifest.entries[actor].image]);
 }
 const calls=[],context={drawImage:image=>calls.push(image.name),save(){},restore(){},translate(){},rotate(){}};
 tiles.draw(context,{...frame,map_underlays:[{x:1,y:1,tile:3}]},camera);
 assert.deepEqual(calls,['terrain.floor.png',manifest.entries[actor].image]);
 assert.deepEqual(frame.map_tiles,[0,actor,0]);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Tiles=require('../web/tiles.js'),Settings=require('../web/view-settings.js');
const manifest=JSON.parse(await readFile(new URL('../web/assets/pixels/manifest.json',import.meta.url),'utf8'));
const original=JSON.parse(await readFile(new URL('../web/assets/tiles/manifest.json',import.meta.url),'utf8'));
function rgba(png){
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);assert.equal(png[24],8);assert.equal(png[25],6);assert.equal(png[28],0);
 const chunks=[];for(let i=8;i<png.length;){const size=png.readUInt32BE(i);if(png.subarray(i+4,i+8).toString()==='IDAT')chunks.push(png.subarray(i+8,i+8+size));i+=size+12;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*4,pixels=Buffer.alloc(height*stride);let position=0;
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){
  const filter=raw[position++];assert.ok(filter>=0&&filter<=4);
  for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y>0?pixels[i-stride]:0,c=x>=4&&y>0?pixels[i-stride-4]:0;const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];pixels[i]=(raw[position++]+predictor)&255;}
 }
 return {width,height,pixels};
}
const decoded=new Map();
for(const filename of new Set(manifest.entries.map(e=>e.image)))decoded.set(filename,rgba(await readFile(new URL('../web/assets/pixels/'+filename,import.meta.url))));
test('49 original semantic IDs map to 46 new native32 raster sprites with binary alpha and <=16 colors',async()=>{
 assert.deepEqual(manifest.entries.map(e=>e.id),original.entries.map(e=>e.id));assert.equal(decoded.size,46);
 for(const entry of manifest.entries){const image=decoded.get(entry.image);assert.equal(image.width,32);assert.equal(image.height,32);const colors=new Set(),alphas=new Set();for(let i=0;i<image.pixels.length;i+=4){const a=image.pixels[i+3];alphas.add(a);assert.ok(a===0||a===255);if(a)colors.add(image.pixels.subarray(i,i+3).toString('hex'));}assert.ok(colors.size>0&&colors.size<=16,entry.id+' palette '+colors.size);if(!['terrain.unexplored','terrain.floor','terrain.passage'].includes(entry.id))assert.ok(alphas.has(0),entry.id+' transparent');}
});
test('floor/passages are fully opaque and terrain edges align exactly across tile seams',()=>{
 for(const name of ['terrain.floor.png','terrain.passage.png']){const p=decoded.get(name).pixels;for(let i=3;i<p.length;i+=4)assert.equal(p[i],255);for(let i=0;i<32;i++){assert.deepEqual(p.subarray(i*128,i*128+4),p.subarray(i*128+124,i*128+128));assert.deepEqual(p.subarray(i*4,i*4+4),p.subarray(31*128+i*4,31*128+i*4+4));}}
 for(const [name,axis] of [['terrain.wall_horizontal.png','x'],['terrain.wall_vertical.png','y']]){const p=decoded.get(name).pixels;for(let i=0;i<32;i++){const a=axis==='x'?i*128:i*4,b=axis==='x'?i*128+124:31*128+i*4;assert.deepEqual(p.subarray(a,a+4),p.subarray(b,b+4));}assert.equal(p[axis==='x'?16*128+3:16*4+3],255,'Wall connects through the middle of its joining edge');}
});
test('view preferences validate all three modes and mode-specific native scales; corrupt/blocked storage is harmless',()=>{
 let stored=null;const storage={getItem:()=>stored,setItem:(key,value)=>{assert.equal(key,Settings.key);stored=value;}};
 assert.deepEqual(Settings.load(storage),{version:1,mode:'tiles',zoom:32});
 for(const mode of ['ascii','tiles','pixels']){assert.equal(Settings.save({version:1,mode,zoom:64},storage),true);assert.equal(Settings.load(storage).mode,mode);}
 assert.equal(Settings.save({version:1,mode:'pixels',zoom:48},storage),false);assert.equal(Settings.save({version:1,mode:'secret',zoom:32},storage),false);
 for(const invalid of ['invalid','{}','null','{"version":1,"mode":"pixels","zoom":24}']){stored=invalid;assert.equal(Settings.load(storage).mode,'tiles');}
 const blocked={getItem(){throw new Error('blocked')},setItem(){throw new Error('quota')}};assert.equal(Settings.load(blocked).mode,'tiles');assert.equal(Settings.save({version:1,mode:'pixels',zoom:32},blocked),false);
 assert.deepEqual(Settings.sizes('pixels'),[32,64,96,128]);
});
test('pixel-grid beam rotation preserves the palette and binary alpha before nearest-neighbor enlargement',()=>{
 const source=decoded.get('effect.bolt_horizontal.png').pixels;
 for(const angle of [90,-45,45]){
  let output;const factory=()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:source}),createImageData:()=>({data:new Uint8ClampedArray(4096)}),putImageData:data=>{output=data.data;}})});
  Tiles.pixelRotation({},angle,factory);const originalColors=new Set();for(let i=0;i<source.length;i+=4)originalColors.add(source.subarray(i,i+4).toString('hex'));
  for(let i=0;i<output.length;i+=4){assert.ok(output[i+3]===0||output[i+3]===255);if(output[i+3])assert.ok(originalColors.has(Buffer.from(output.subarray(i,i+4)).toString('hex')));}
  assert.ok(output.some((value,i)=>i%4===3&&value===255));
 }
});

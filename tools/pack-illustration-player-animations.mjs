import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {splitGeneratedIllustrationSheet} from './split-generated-illustration-sheet.mjs';

const sharp=createRequire(import.meta.url)(process.env.ROGUE_SHARP_MODULE||'sharp');
const root=fileURLToPath(new URL('../web/assets/tiles/',import.meta.url));
const destination=path.join(root,'animations-v1');
const base=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const characters=base.entries.filter(e=>e.id==='actor.player'||e.group==='monster');
const entries=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const character of characters){
let generated;
try{generated=await readFile(path.join(destination,`sources/${character.id}.generated.png`));}
catch(error){if(process.argv.includes('--partial')&&error.code==='ENOENT')continue;throw error;}
// Only package the AI-generated artwork: size the entire regular sheet, then
// split its twelve cells. No source-part movement, painting or recoloring.
const size=96;
let sheet=await sharp(generated).resize(size*3,size*4,{fit:'fill'}).ensureAlpha().png().toBuffer();
let separated;
if(character.id!=='actor.player'){
  separated=await splitGeneratedIllustrationSheet(sharp,generated,size);
  sheet=await sharp({create:{width:size*3,height:size*4,channels:4,background:'#00000000'}})
    .composite(separated.frames.map((input,i)=>({input,left:i%3*size,top:Math.floor(i/3)*size}))).png().toBuffer();
}
await mkdir(path.join(destination,character.id),{recursive:true});
const animations={};
for(const [row,state]of ['idle','move','attack','hurt'].entries()){
  const frames=[];
  for(let column=0;column<3;column++){
    const filename=`${character.id}/${state}.${column+1}.png`;
    await sharp(sheet).extract({left:column*size,top:row*size,width:size,height:size}).png().toFile(path.join(destination,filename));
    frames.push(filename);
  }
  animations[state]={frames,frame_ms:state==='idle'?200:120,loop:state==='idle'||state==='move'};
}
await writeFile(path.join(destination,character.id+'.sheet.png'),sheet);
if(character.id==='actor.player')await sharp(sheet).resize(576,768).png().toFile(path.join(destination,'player-preview.png'));
const source=await readFile(path.join(root,character.image));
entries.push({id:character.id,glyph:character.glyph,labels:character.labels,
  source:{image:'../'+character.image,sha256:hash(source)},sheet:character.id+'.sheet.png',animations,
  generated_source:{image:`sources/${character.id}.generated.png`,sha256:hash(generated)},
  ...(separated?{packaging:{pose_bounds:separated.bounds,uniform_scale:separated.scale,padding_pixels:6}}:{})});
console.log('Packaged '+character.id+': 12 generated illustration frames.');
}
const manifest={schema_version:1,source_release:'RRP Rogue 5.4.4',tile_pixels:96,character_count:entries.length,image_count:entries.length*12,
  layout:{columns:3,rows:['idle','move','attack','hurt'],frame_count:3,anchor:'cell-center'},
  generator:'OpenAI built-in image_gen: twelve newly drawn illustration poses using the original image as design reference',
  usage:'Animation assets. Gameplay renderer still uses its existing static image.',
  entries};
await writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(destination,'asset-data.js'),'window.ROGUE_ANIMATIONS = '+JSON.stringify(manifest)+';\n');
const prompts={mode:'built-in image_gen',entries:{}};
for(const entry of entries){
  prompts.entries[entry.id]=JSON.parse((await readFile(path.join(destination,'prompts',entry.id+'.json'),'utf8')).replace(/^\uFEFF/,''));
}
await writeFile(path.join(destination,'prompts.json'),JSON.stringify(prompts,null,2)+'\n');
const template=await readFile(new URL('../web/assets/pixels-v2/animations-v1/index.html',import.meta.url),'utf8');
const preview=template.replaceAll('全キャラアニメーション','イラスト版・全キャラアニメーション')
  .replace('32×32透過PNG','96×96透過PNG').replace('canvas.width = canvas.height = 32','canvas.width = canvas.height = manifest.tile_pixels')
  .replace('context.clearRect(0,0,32,32)','context.clearRect(0,0,manifest.tile_pixels,manifest.tile_pixels)')
  .replaceAll('image-rendering: pixelated;','').replace('context.imageSmoothingEnabled = false','context.imageSmoothingEnabled = true')
  .replaceAll('width: 64px;','width: 96px;').replace('<a href="poses.json">ポーズ定義</a>',
    '<a href="prompts.json">生成プロンプト</a><a href="../../pixels-v2/animations-v1/index.html">ドット絵版</a>');
await writeFile(path.join(destination,'index.html'),preview);
console.log(`Packaged ${entries.length} characters, ${entries.length*12} generated illustration frames.`);

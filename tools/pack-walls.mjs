// Authoring only: pack the generated square stone block for both active tile sets.
import {createRequire} from "node:module";
import {readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";

const require = createRequire(import.meta.url);
const sharp = require(process.env.ROGUE_SHARP_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "web/assets/walls");
const provenance = JSON.parse(await readFile(path.join(directory, "generation.json"), "utf8"));
const source = await readFile(path.join(directory, "source.png"));
const metadata = await sharp(source).metadata();
if (metadata.width !== metadata.height) throw new Error("Wall block source must be square");
// Restrict generated colors and sample on the native grid; do not redraw the artwork.
const indexed = await sharp(source).resize(32, 32, {kernel:"nearest"}).png({palette:true, colours:8, dither:0}).toBuffer();
const native = await sharp(indexed).ensureAlpha().raw().toBuffer();
for (let i = 3; i < native.length; i += 4) {
  if (native[i] !== 255) throw new Error("Wall block must fill its tile without holes or transparent margins");
}
const outputs = [];
for (const [set, pixels] of [["pixels-v2",32], ["tiles",96]]) {
  const assets = path.join(root, "web/assets", set);
  const bytes = await sharp(native, {raw:{width:32,height:32,channels:4}}).resize(pixels, pixels, {kernel:"nearest"}).png().toBuffer();
  await writeFile(path.join(assets, "terrain.wall.png"), bytes);
  const record = {id:"terrain.wall",file:"terrain.wall.png",set,source:"../walls/source.png",pixels,semantic_ids:["terrain.wall_horizontal","terrain.wall_vertical"],sha256:createHash("sha256").update(bytes).digest("hex")};
  outputs.push(record);
  const manifestPath = path.join(assets, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const entry of manifest.entries.filter(entry => record.semantic_ids.includes(entry.id))) {
    entry.image = record.file;
    entry.rotation = 0;
  }
  await writeFile(manifestPath, JSON.stringify(manifest,null,2)+"\n");
  const generationPath = path.join(assets, "generation.json");
  const generation = JSON.parse(await readFile(generationPath, "utf8"));
  const position = generation.images.findIndex(image => image.id.startsWith("terrain.wall"));
  generation.images = generation.images.filter(image => !image.id.startsWith("terrain.wall"));
  generation.images.splice(position,0,record);
  generation.unique_pngs = new Set(manifest.entries.map(entry => entry.image)).size;
  await writeFile(generationPath, JSON.stringify(generation,null,2)+"\n");
}
provenance.source_sha256 = createHash("sha256").update(source).digest("hex");
provenance.packing = "Nearest-neighbor 32x32 sampling, at most 8 colors, opaque RGBA, 96x96 nearest-neighbor enlargement. Both wall glyphs share one unrotated PNG per set.";
provenance.outputs = outputs;
await writeFile(path.join(directory,"generation.json"),JSON.stringify(provenance,null,2)+"\n");
console.log(JSON.stringify({outputs}));

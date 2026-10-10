import { createRequire } from "node:module";
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require(process.env.ROGUE_SHARP_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "web/assets/pixels-v2");
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const partial = process.argv.includes("--partial");
const records = [];
for (const entry of manifest.entries.filter((entry, index, all) => all.findIndex(other => other.image === entry.image) === index)) {
  const destination = path.join(directory, entry.image);
  if (entry.image === "terrain.wall.png") {
    const generation = JSON.parse(await readFile(path.join(root, "web/assets/walls/generation.json"), "utf8"));
    records.push(generation.outputs.find(output => output.set === "pixels-v2"));
    continue;
  }
  if (entry.id === "actor.player") {
    const bytes = await readFile(destination);
    records.push({ id: entry.id, file: entry.image, source: "../gameboy/actor.player.32.silver.png", sha256: createHash("sha256").update(bytes).digest("hex") });
    continue;
  }
  const filename = path.join(directory, "source", entry.id + ".png");
  try { await access(filename); } catch (error) { if (partial && error.code === "ENOENT") continue; throw error; }
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 128) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < x0) throw new Error("Empty generated asset: " + entry.id);
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const opaque = ["terrain.unexplored", "terrain.floor", "terrain.passage"].includes(entry.id);
  const horizontal = entry.id === "terrain.wall_horizontal", vertical = entry.id === "terrain.wall_vertical";
  const scale = horizontal ? 32 / width : vertical ? 32 / height : 28 / Math.max(width, height);
  const w = opaque ? 32 : Math.max(1, Math.min(32, Math.round(width * scale)));
  const h = opaque ? 32 : Math.max(1, Math.min(32, Math.round(height * scale)));
  const left = Math.floor((32 - w) / 2), top = Math.floor((32 - h) / 2);
  const sampled = await sharp(filename).extract({ left: x0, top: y0, width, height }).resize(w, h, { fit: "fill", kernel: "nearest" }).ensureAlpha().raw().toBuffer();
  let output = Buffer.alloc(32 * 32 * 4);
  if (opaque) for (let i = 0; i < output.length; i += 4) output.set(entry.id === "terrain.unexplored" ? [16, 22, 30, 255] : [45, 50, 58, 255], i);
  if (entry.id !== "terrain.unexplored") for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const from = (y * w + x) * 4, to = ((y + top) * 32 + x + left) * 4;
    if (sampled[from + 3] >= 128) output.set([sampled[from], sampled[from + 1], sampled[from + 2], 255], to);
  }
  // Format packing only: restrict generated colors, retain hard pixel edges and binary alpha.
  const indexed = await sharp(output, { raw: { width: 32, height: 32, channels: 4 } }).png({ palette: true, colours: 16, dither: 0 }).toBuffer();
  output = await sharp(indexed).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < output.length; i += 4) output[i] = output[i] < 128 ? 0 : 255;
  if (opaque) {
    for (let n = 0; n < 32; n++) {
      output.copy(output, (n * 32 + 31) * 4, n * 32 * 4, n * 32 * 4 + 4);
      output.copy(output, (31 * 32 + n) * 4, n * 4, n * 4 + 4);
    }
  }
  if (horizontal) for (let y = 0; y < 32; y++) {
    const row = y * 128; let first = -1, last = -1;
    for (let x = 0; x < 32; x++) if (output[row + x * 4 + 3]) { if (first < 0) first = x; last = x; }
    if (first >= 0) {
      for (let x = 0; x < first; x++) output.copy(output, row + x * 4, row + first * 4, row + first * 4 + 4);
      for (let x = last + 1; x < 32; x++) output.copy(output, row + x * 4, row + last * 4, row + last * 4 + 4);
    }
    output.copy(output, row + 124, row, row + 4);
  }
  if (vertical) for (let x = 0; x < 32; x++) {
    let first = -1, last = -1;
    for (let y = 0; y < 32; y++) if (output[(y * 32 + x) * 4 + 3]) { if (first < 0) first = y; last = y; }
    if (first >= 0) {
      for (let y = 0; y < first; y++) output.copy(output, (y * 32 + x) * 4, (first * 32 + x) * 4, (first * 32 + x) * 4 + 4);
      for (let y = last + 1; y < 32; y++) output.copy(output, (y * 32 + x) * 4, (last * 32 + x) * 4, (last * 32 + x) * 4 + 4);
    }
    output.copy(output, (31 * 32 + x) * 4, x * 4, x * 4 + 4);
  }
  const bytes = await sharp(output, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer();
  await writeFile(destination, bytes);
  const colors = new Set();
  for (let i = 0; i < output.length; i += 4) if (output[i + 3]) colors.add(output.subarray(i, i + 3).toString("hex"));
  if (colors.size > 16 || colors.size === 0) throw new Error("Invalid palette: " + entry.id);
  records.push({ id: entry.id, file: entry.image, source: "source/" + entry.id + ".png", crop: [x0, y0, width, height], colors: colors.size, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(path.join(directory, "generation.json"), JSON.stringify({
  tool: "built-in image_gen", native_pixels: 32, semantic_ids: 49, unique_pngs: records.length, max_colors_per_sprite: 16,
  alpha_values: [0, 255], packing: "Individual new ImageGen sprites; alpha bounds, nearest-neighbor native sampling, limited palette, binary alpha; periodic floor edges and shared opaque square wall block. Approved silver soldier copied unchanged.",
  images: records
}, null, 2) + "\n");
console.log(JSON.stringify({ packed: records.length, expected: new Set(manifest.entries.map(entry => entry.image)).size, partial }));

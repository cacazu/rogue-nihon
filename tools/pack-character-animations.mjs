import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monsterAnimation, transformPixels } from './character-animation-profiles.mjs';

const require = createRequire(import.meta.url);
const sharp = require(process.env.ROGUE_SHARP_MODULE || 'sharp');
const root = fileURLToPath(new URL('../web/assets/pixels-v2/', import.meta.url));
const destination = path.join(root, 'animations-v1');
const base = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const characters = base.entries.filter(e => e.id === 'actor.player' || e.group === 'monster');
const entries = [], poseRecords = {};
for (const player of characters) {
const originalPng = await readFile(path.join(root, player.image));
const original = await sharp(originalPng).ensureAlpha().raw().toBuffer();
let groups = { core: [], sword: [], shield: [], leftLeg: [], rightLeg: [] };
for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
  const rgba = original.subarray((y * 32 + x) * 4, (y * 32 + x + 1) * 4);
  if (!rgba[3]) continue;
  const name = ((x <= 8 && y >= 10) || (x <= 10 && y >= 15)) ? 'sword'
    : x >= 20 && y >= 17 && y <= 26 ? 'shield'
    : x >= 11 && x <= 15 && y >= 22 ? 'leftLeg'
    : x >= 16 && y >= 22 ? 'rightLeg' : 'core';
  groups[name].push({ x, y, rgba });
}

// Source pixels are the sole artwork. Articulate separate body parts on the
// native grid without resizing, recoloring or repainting the character.
let poses = {
  idle: [
    { sword: [0, -1] },
    { sword: [0, -2], shield: [0, -1] },
    { sword: [1, 0], shield: [-1, 0] }
  ],
  move: [
    { leftLeg: [-1, -1], rightLeg: [1, 0], sword: [0, 1], shield: [0, -1] },
    { leftLeg: [0, 1], rightLeg: [0, -1], sword: [-1, 0], shield: [-1, 0] },
    { leftLeg: [1, 0], rightLeg: [-1, -1], sword: [0, -1], shield: [0, 1] }
  ],
  attack: [
    { sword: [-1, -2], shield: [0, -1], leftLeg: [-1, 0] },
    { sword: { pivot: [9, 21], target: [12, 18], turn: 'left' }, shield: [-1, 0], leftLeg: [-1, 0] },
    { sword: [-2, -1], shield: [0, -1], leftLeg: [0, 1] }
  ],
  hurt: [
    { core: [1, 0], sword: [-1, 0], shield: [0, 1] },
    { core: [1, 1], sword: [0, 1], shield: [-1, 1], leftLeg: [0, 1] },
    { sword: [1, -1], shield: [-1, 0], leftLeg: [0, -1] }
  ]
};

let order = ['core', 'leftLeg', 'rightLeg', 'sword', 'shield'];
let profile = { kind: 'player' };
if (player.group === 'monster') {
  const monster = monsterAnimation(player.id, original);
  groups = monster.groups; poses = monster.poses; order = monster.order; profile = monster.profile;
}
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const frameHashes = new Set();

const animations = {}, sheet = Buffer.alloc(96 * 128 * 4);
await mkdir(path.join(destination, player.id), { recursive: true });
for (const [row, [state, statePoses]] of Object.entries(poses).entries()) {
  const frames = [];
  for (const [column, pose] of statePoses.entries()) {
    const output = Buffer.alloc(32 * 32 * 4);
    for (const name of order) {
      const change = pose[name] || [0, 0];
      for (const pixel of transformPixels(groups[name], change)) {
        const { x, y } = pixel;
        if (x < 0 || x >= 32 || y < 0 || y >= 32) throw Error(`${state}.${column + 1}: pixel outside tile`);
        pixel.rgba.copy(output, (y * 32 + x) * 4);
      }
    }
    const frameHash = hash(output);
    if (frameHash === hash(original) || frameHashes.has(frameHash)) throw Error(`${player.id}/${state}.${column + 1}: pose must differ from source and other frames`);
    frameHashes.add(frameHash);
    const filename = `${player.id}/${state}.${column + 1}.png`;
    await sharp(output, { raw: { width: 32, height: 32, channels: 4 } }).png()
      .toFile(path.join(destination, filename));
    for (let y = 0; y < 32; y++) output.copy(sheet,
      ((row * 32 + y) * 96 + column * 32) * 4, y * 128, (y + 1) * 128);
    frames.push(filename);
  }
  animations[state] = { frames, frame_ms: state === 'idle' ? 200 : 120, loop: state === 'idle' || state === 'move' };
}
await sharp(sheet, { raw: { width: 96, height: 128, channels: 4 } }).png()
  .toFile(path.join(destination, player.id + '.sheet.png'));
if (player.id === 'actor.player') await sharp(sheet, { raw: { width: 96, height: 128, channels: 4 } })
  .resize(576, 768, { kernel: 'nearest' }).png().toFile(path.join(destination, 'player-preview.png'));
poseRecords[player.id] = { source: '../' + player.image, profile, groups:
  Object.fromEntries(Object.entries(groups).map(([name, pixels]) => [name, pixels.map(p => [p.x, p.y])])), poses };
entries.push({ id: player.id, glyph: player.glyph, labels: player.labels,
  source: { image: '../' + player.image, sha256: hash(originalPng) },
  anatomy: profile.kind, sheet: player.id + '.sheet.png', animations });
console.log(`Exported ${player.id}: 12 distinct native poses.`);
}
await writeFile(path.join(destination, 'poses.json'), JSON.stringify({ entries: poseRecords }, null, 2) + '\n');
const manifest = {
  schema_version: 1, source_release: base.source_release, tile_pixels: 32,
  character_count: entries.length, image_count: entries.length * 12,
  layout: { columns: 3, rows: ['idle', 'move', 'attack', 'hurt'], frame_count: 3, anchor: 'original-tile' },
  generator: 'Native-grid articulation of the original sprite pixels; original palette and equipment retained',
  usage: 'Animation assets. Gameplay renderer still uses its existing static image.',
  entries
};
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (let page = 0; page < Math.ceil(entries.length / 9); page++) {
  const layers = [];
  for (const [slot, entry] of entries.slice(page * 9, page * 9 + 9).entries()) {
    const left = slot % 3 * 320, top = Math.floor(slot / 3) * 300;
    const source = await sharp(path.join(destination, entry.source.image)).resize(64, 64, { kernel: 'nearest' }).toBuffer();
    for (let row = 0; row < 4; row++) layers.push({ input: source, left: left + 16, top: top + 32 + row * 64 });
    layers.push({ input: await sharp(path.join(destination, entry.sheet)).resize(192, 256, { kernel: 'nearest' }).toBuffer(), left: left + 96, top: top + 32 });
    layers.push({ input: Buffer.from(`<svg width="320" height="28"><text x="16" y="20" fill="#e2e7ef" font-size="16">${entry.glyph} ${entry.id}</text></svg>`), left, top });
  }
  await sharp({ create: { width: 960, height: 900, channels: 4, background: '#171e28' } }).composite(layers).png()
    .toFile(path.join(destination, `characters-preview-${page + 1}.png`));
}
console.log(`Exported ${entries.length} characters, ${entries.length * 12} PNG frames.`);

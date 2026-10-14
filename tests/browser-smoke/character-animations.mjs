import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, browserExecutable } from '../../tools/toolchain.mjs';
import { prepareBrowserRuntime } from './browser-runtime.mjs';
import { createPreviewServer } from '../../../tools/server.mjs';

const require = createRequire(import.meta.url);
const galleryOnly = process.argv.includes('--gallery-only');
const sharp = galleryOnly ? null : require(process.env.ROGUE_SHARP_MODULE || 'sharp');
const root = fileURLToPath(new URL('../../', import.meta.url));
const onlyIllustrationPlayer = process.argv.includes('--illustration-player');
const illustration = onlyIllustrationPlayer || process.argv.includes('--illustrations');
const size = illustration ? 96 : 32;
const characters = onlyIllustrationPlayer ? 1 : 27;
const assets = path.join(root, `web/assets/${illustration ? 'tiles' : 'pixels-v2'}/animations-v1`);
const output = path.join(root, illustration ? '.local/illustration-player-animation-check' : '.local/character-animation-check');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
const baseManifest = JSON.parse(await readFile(path.join(assets, '../manifest.json'), 'utf8'));
const expectedIds = baseManifest.entries.filter(e => e.id === 'actor.player' || (!onlyIllustrationPlayer && e.group === 'monster')).map(e => e.id);
assert.deepEqual(manifest.entries.map(e => e.id), expectedIds);
assert.equal(manifest.character_count, characters); assert.equal(manifest.image_count, characters * 12);
if (illustration) assert.match(manifest.generator, /image_gen/);
assert.deepEqual(manifest.layout.rows, ['idle', 'move', 'attack', 'hurt']);
if (!galleryOnly) for (const entry of manifest.entries) {
if (illustration) {
  const generated = await readFile(path.join(assets, entry.generated_source.image));
  assert.equal(createHash('sha256').update(generated).digest('hex'), entry.generated_source.sha256);
  if (entry.packaging) {
    const dimensions = await sharp(generated).metadata();
    assert.equal(entry.packaging.pose_bounds.length, 12);
    for (const b of entry.packaging.pose_bounds) {
      assert.ok(b.maxX-b.minX+1 <= dimensions.width/3*1.5, entry.id + ': one complete pose per cell');
      assert.ok(b.maxY-b.minY+1 <= dimensions.height/4*1.5, entry.id + ': no joined adjacent rows');
    }
  }
}
const originalPng = await readFile(path.join(assets, entry.source.image));
assert.equal(createHash('sha256').update(originalPng).digest('hex'), entry.source.sha256);
const original = await sharp(originalPng).ensureAlpha().raw().toBuffer();
const palette = new Set();
for (let i = 0; i < original.length; i += 4) if (original[i + 3]) palette.add(original.subarray(i, i + 4).toString('hex'));
const hashes = new Set();
for (const [state, animation] of Object.entries(entry.animations)) {
  assert.equal(animation.frames.length, 3);
  for (const filename of animation.frames) {
    const { data, info } = await sharp(path.join(assets, filename)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, size); assert.equal(info.height, size);
    assert.notDeepEqual(data, original, filename + ': every new pose differs from the reference');
    hashes.add(createHash('sha256').update(data).digest('hex'));
    for (let i = 0; i < data.length; i += 4) {
      if (!illustration) {
        assert.ok(data[i + 3] === 0 || data[i + 3] === 255);
        if (data[i + 3]) assert.ok(palette.has(data.subarray(i, i + 4).toString('hex')), filename + ': original palette');
      }
    }
    assert.ok(data.some((v, i) => i % 4 === 3 && v === 0), filename + ': transparent background');
    if (illustration && entry.packaging) for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
      if (x<6||x>=size-6||y<6||y>=size-6) assert.equal(data[(y*size+x)*4+3],0,filename+': complete artwork has six-pixel clearance');
    }
    if (!illustration && entry.id === 'actor.player' && state !== 'hurt') for (let y = 3; y <= 13; y++) for (let x = 11; x <= 22; x++) {
      const i = (y * 32 + x) * 4;
      assert.deepEqual(data.subarray(i, i + 4), original.subarray(i, i + 4), filename + ': original helmet and face');
    }
  }
}
assert.equal(hashes.size, 12, '12 distinct new poses');
}
if (!galleryOnly) console.log(`PASS ${characters} character IDs, ${characters * 12} transparent ${size}px PNGs, 12 distinct new poses per character`);

const server = createPreviewServer({ root });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, runtime;
const errors = [], badResponses = [];
try {
  runtime = await prepareBrowserRuntime(root);
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, downloadsPath: runtime.downloadsPath });
  const page = await browser.newPage({ viewport: { width: 1000, height: 950 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (!r.ok()) badResponses.push(r.url()); });
  await page.goto(base + `/web/assets/${illustration ? 'tiles' : 'pixels-v2'}/animations-v1/index.html`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await page.locator('article').count(), characters);
  assert.equal(await page.locator('canvas[data-state]').count(), characters * 4);
  assert.equal(await page.locator('canvas.reference').count(), characters);
  await page.getByRole('button', { name: '一時停止' }).click();
  const paused = await page.locator('canvas[data-state]').evaluateAll(nodes => nodes.map(n => n.dataset.frame));
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('canvas[data-state]').evaluateAll(nodes => nodes.map(n => n.dataset.frame)), paused);
  for (let frame = 0; frame < 3; frame++) {
    const selected = await page.locator('#frame').selectOption({ value: String(frame) });
    assert.deepEqual(selected, [String(frame)], 'Selected requested frame');
    try {
      await page.waitForFunction(frame => [...document.querySelectorAll('canvas[data-state]')].every(c => c.dataset.frame === String(frame)), frame, { timeout: 5000 });
    } catch (error) {
      console.error(JSON.stringify({ selected: frame, errors, display: await page.evaluate(() => ({ value: document.getElementById('frame').value,
        canvases: [...document.querySelectorAll('canvas[data-state]')].map(c => ({ state: c.dataset.state, frame: c.dataset.frame })) })) }));
      throw error;
    }
    await page.evaluate(async ({ entries, frame, size }) => {
      for (const canvas of document.querySelectorAll('canvas[data-state]')) {
        const entry = entries.find(e => e.id === canvas.closest('article').dataset.id);
        const image = new Image(); image.src = entry.animations[canvas.dataset.state].frames[frame]; await image.decode();
        const expected = document.createElement('canvas'); expected.width = expected.height = size;
        expected.getContext('2d').drawImage(image, 0, 0);
        const a = expected.getContext('2d').getImageData(0, 0, size, size).data;
        const b = canvas.getContext('2d').getImageData(0, 0, size, size).data;
        // Smooth illustrations have fractional alpha. Separate GPU/CPU Canvas
        // readbacks can round an RGB channel by one; alpha must still match.
        const differs = (v,i) => Math.abs(v-b[i]) > (size===96 && i%4!==3 ? 1 : 0);
        if (a.some(differs)) {
          const deltas = [...a.keys()].filter(i => a[i] !== b[i]);
          throw Error('Displayed frame differs: ' + canvas.dataset.state + ' ' + JSON.stringify({canvas:[canvas.width,canvas.height],image:[image.width,image.height],count:deltas.length,samples:deltas.slice(0,8).map(i=>[i,a[i],b[i]])}));
        }
      }
    }, { entries: manifest.entries, frame, size });
  }
  await page.screenshot({ path: path.join(output, 'all-characters.png'), fullPage: true });
  const target = page.locator('article').nth(onlyIllustrationPlayer ? 0 : 2);
  if (await target.locator('details').evaluate(e => e.open)) await target.locator('summary').click();
  await target.locator('summary').click();
  assert.equal(await target.locator('details').evaluate(e => e.open), true);
  await target.screenshot({ path: path.join(output, 'reference-and-12-frames.png') });
  await target.locator('summary').click();
  await page.locator('#frame').selectOption('auto');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  const before = await page.locator('canvas[data-state]').first().getAttribute('data-frame');
  await page.waitForFunction(before => document.querySelector('canvas[data-state]').dataset.frame !== before, before);
  assert.deepEqual(errors, []); assert.deepEqual(badResponses, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', characters, frames: characters * 12, browser: browser.version(),
    checks: [illustration ? 'image_gen source provenance' : 'each original palette', '12 new distinct poses per character', `all ${characters * 12} displayed frames match PNGs`, 'pause, frame selection, resume', 'sheet expansion'], errors, badResponses }, null, 2));
  console.log(`PASS Playwright: all ${characters * 12} frames displayed correctly; pause, frame selection, resume, sheet expansion; screenshots: ` + output);
} finally {
  await browser?.close(); await runtime?.dispose(); await new Promise(resolve => server.close(resolve));
}

import { artifactDirectory } from "../tools/temporary-artifacts.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runGame, textEvents, SAVE_EVENT, originalFrames } from './run-game.mjs';
import { assertEquivalent } from './compare-traces.mjs';

const split = fileURLToPath(new URL('../build/game-fixtures.js', import.meta.url));
const baseline = fileURLToPath(new URL('../build/baseline-fixtures.js', import.meta.url));
const output = artifactDirectory(fileURLToPath(new URL('./fixture-results/', import.meta.url)));
await mkdir(output, { recursive: true });
const HASTE = 64, CONFUSED = 512, HALLUCINATION = 2048;

async function compare(label, fixture, seed, text) {
  const config = { fixture, seed, text };
  const expected = await runGame(baseline, config);
  const actual = await runGame(split, config);
  await writeFile(`${output}/${label}-baseline.json`, JSON.stringify(expected, null, 2));
  await writeFile(`${output}/${label}-split.json`, JSON.stringify(actual, null, 2));
  assert.equal(expected.code, -1, JSON.stringify(expected.outcomes));
  assert.equal(actual.code, -1, JSON.stringify(actual.outcomes));
  assert.equal(expected.consumed, text.length);
  assert.equal(actual.consumed, text.length);
  assertEquivalent(expected.traces, actual.traces, `${label} all 20 words and input position`);
  assertEquivalent(originalFrames(expected.frames), originalFrames(actual.frames), `${label} every original English frame`);
  assertEquivalent(expected.final, actual.final, `${label} final state`);
  return actual;
}

test('1 wall and free commands: only rest spends food/time', async () => {
  const result = await compare('wall-free', 'wall', 1, 'v \x1bh.');
  assert.equal(result.final[3], 10);
  assert.equal(result.final[8], 999);
  assert.equal(result.final[13], 1);
});
test('2 initial haste: free version keeps the second movement slot', async () => {
  const result = await compare('initial-haste', 'haste', 1, 'lvl');
  assert.equal(result.final[3], 12);
  assert.equal(result.final[8], 999);
  assert.ok(result.final[18] & HASTE);
});
test('3 haste potion is a free action followed by movement in the same turn', async () => {
  const result = await compare('haste-potion', 'haste-potion', 1, 'qfl');
  assert.equal(result.final[3], 11);
  assert.equal(result.final[8], 999);
  assert.ok(result.final[18] & HASTE);
});
test('4 double haste exhaustion preserves automatic sleep slots and More input', async () => {
  const result = await compare('double-haste', 'double-haste', 17, 'qf l');
  assert.equal(result.final[3], 11);
  assert.equal(result.final[8], 997);
  assert.equal(result.final[18] & HASTE, 0);
  assert.ok(result.messages.some((message) => message.fallback?.includes('faint from exhaustion')));
});
test('5 sleeping with haste finishes automatic rests before consuming movement', async () => {
  const result = await compare('sleep-haste', 'sleep-haste', 1, ' l');
  assert.equal(result.traces[0].input_index, 0);
  assert.equal(result.traces[0].words[8], 999);
  assert.equal(result.final[3], 11);
  assert.equal(result.final[8], 998);
});
test('6 numeric repetition clips to 255 without consuming sentinel input', async () => {
  const result = await compare('count-255', 'count', 1, '999.');
  assert.equal(result.final[8], 745);
  assert.equal(result.final[13], 255);
});
test('7 count on a free version command does not repeat or spend a turn', async () => {
  const result = await compare('count-free', 'count', 1, '3v.');
  assert.equal(result.final[8], 999);
  assert.equal(result.messages.filter((message) => message.fallback?.includes('mctesq')).length, 1);
});
test('8 repeated direction survives a canceled prompt', async () => {
  const result = await compare('direction-repeat', 'repeat', 1, 'mlm\x1ba');
  assert.equal(result.final[3], 12);
  assert.equal(result.final[8], 998);
});
test('9 armor waste_time consumes its original additional update units', async () => {
  const result = await compare('armor-time', 'armor', 1, 'TWb.');
  assert.equal(result.final[8], 995);
  assert.equal(result.final[13], 5);
});
test('10 free look wakes a mean enemy and advances the original RNG', async () => {
  const result = await compare('mean-wake', 'mean', 17, 'v.');
  assert.equal(result.traces[0].words[1], 202702);
  assert.equal(result.traces[1].words[1], 2251830367);
  assert.notEqual(result.traces[0].words[15], result.traces[1].words[15]);
  assert.equal(result.final[8], 999);
});
test('11 Medusa first sight applies confusion once in the original lookup path', async () => {
  const result = await compare('medusa-gaze', 'medusa', 1, '. ');
  assert.ok(result.traces[0].words[18] & CONFUSED);
  assert.equal(result.messages.filter((message) => message.fallback?.includes('gaze has confused you')).length, 1);
});
test('12 hallucination command redraw retains display-coupled random consumption', async () => {
  const result = await compare('hallu-more', 'hallucination', 17, 'vvx\x1b .');
  assert.ok(result.final[18] & HALLUCINATION);
  assert.equal(result.final[8], 999);
  assert.notEqual(result.traces[0].words[1], result.final[1]);
});

test('split-only named arrow split preserves independent label ownership', async () => {
  const result = await runGame(split, { fixture: 'label-split', seed: 1, text: '.' });
  await writeFile(`${output}/label-split.json`, JSON.stringify(result, null, 2));
  assert.equal(result.code, -1, JSON.stringify(result.outcomes));
});

async function restoreFixture(label, fixture, seed, prefix, suffix) {
  const original = await runGame(split, { fixture, seed, events: [...textEvents(prefix), SAVE_EVENT, ...textEvents(suffix)] });
  assert.equal(original.code, -1);
  assert.equal(original.stores.length, 1);
  const envelope = JSON.parse(original.stores[0]);
  const base = envelope.input_index - envelope.inputs.length;
  const start = original.traces.findIndex((trace) => trace.input_index === base);
  assert.notEqual(start, -1);
  const restored = await runGame(split, { seed: 999, text: suffix, restore: original.stores[0] });
  await writeFile(`${output}/${label}-original.json`, JSON.stringify(original, null, 2));
  await writeFile(`${output}/${label}-restored.json`, JSON.stringify(restored, null, 2));
  assert.equal(restored.code, -1, JSON.stringify(restored.outcomes));
  assertEquivalent(original.traces.slice(start), restored.traces, `${label} replay read states`);
  assertEquivalent(original.final, restored.final, `${label} final state`);
  assert.equal(original.frames.at(-1).sha256, restored.frames.at(-1).sha256);
}

test('fresh module resumes between the two haste movement slots', async () => {
  await restoreFixture('haste-midcommand', 'haste', 1, 'l', 'l');
});
test('fresh module resumes a haste potion selection with unchanged RNG timing', async () => {
  await restoreFixture('haste-midpotion', 'haste-potion', 1, 'q', 'fl');
});
test('fresh module resumes hallucination at a command boundary with unchanged RNG and view', async () => {
  await restoreFixture('hallu-midmore', 'hallucination', 17, 'vv', ' .');
});
test('split-only message recall treats user percent sequences as literal text', async () => {
  const result = await runGame(split, { fixture: 'percent-recall', seed: 1, text: '\x10' });
  await writeFile(`${output}/percent-recall.json`, JSON.stringify(result, null, 2));
  assert.equal(result.code, -1, JSON.stringify(result.outcomes));
  assert.equal(result.final[8], 1000);
  assert.equal(result.final[13], 0);
  assert.equal(result.messages.filter((message) => message.fallback === 'Item called %s%n%%').length, 1);
});

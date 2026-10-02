import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runGame, textEvents, originalFrames, SAVE_EVENT } from './run-game.mjs';
import { assertEquivalent } from './compare-traces.mjs';

const modulePath = fileURLToPath(new URL('../build/game.js', import.meta.url));
const output = fileURLToPath(new URL('./ui-results/', import.meta.url));
await mkdir(output, { recursive: true });
const scalarEvents = (text) => Array.from(text, (character) => character.codePointAt(0));

async function record(label, config) {
  const result = await runGame(modulePath, { ...config, locale: 'ja' });
  await writeFile(`${output}/${label}.json`, JSON.stringify(result, null, 2));
  assert.equal(result.code, -1, JSON.stringify(result.outcomes));
  assert.equal(result.consumed, config.events?.length ?? config.text.length);
  const frames = result.frames.filter((frame) => frame.ui);
  assert.ok(frames.length > 0, 'Actual Japanese frame UI must be present');
  for (const frame of frames) {
    assert.equal(frame.map_cells.length, frame.width * frame.height);
    assert.equal(frame.ui.fallback_used, false, JSON.stringify(frame.ui.missing_ids));
    for (const line of frame.ui.lines) assert.equal(line.fallback_used, false, line.id);
  }
  for (const message of result.messages) assert.equal(message.fallback_used, false, `${message.id}: ${JSON.stringify(message.missing_ids)}`);
  return result;
}

test('Japanese help/options/inventory preserve all English C frames and state', async () => {
  const config = { seed: 1, text: '?* ?h/|o\x1b i .' };
  const en = await runGame(modulePath, { ...config, locale: 'en' });
  const ja = await record('help-options-menu', config);
  await writeFile(`${output}/help-options-menu-en.json`, JSON.stringify(en, null, 2));
  assertEquivalent(en.traces, ja.traces, 'Locale must not change C input, state or RNG');
  assertEquivalent(en.final, ja.final);
  assertEquivalent(originalFrames(en.frames), originalFrames(ja.frames), 'Locale must not change raw English cells');
  for (const mode of ['help', 'options', 'menu']) assert.ok(ja.frames.some((frame) => frame.ui?.mode === mode), mode);
  assert.ok(ja.frames.flatMap((frame) => frame.ui?.lines ?? []).some((line) => line.text.includes('左へ移動')));
  assert.ok(ja.frames.flatMap((frame) => frame.ui?.lines ?? []).some((line) => line.text.includes('簡潔な表示')));
  assert.ok(ja.messages.some((message) => message.text.includes('部屋の壁')));
});

test('Japanese custom item label and scalar Backspace reach the real inventory', async () => {
  const events = [...textEvents('cc'), ...scalarEvents('名😀'), 127, ...scalarEvents('前\n'), ...textEvents('i ')];
  const result = await record('japanese-label-backspace', { seed: 1, events });
  const menu = result.frames.flatMap((frame) => frame.ui?.lines ?? []).filter((line) => line.scope === 'menu');
  assert.ok(menu.some((line) => line.text.includes('名前')), JSON.stringify(menu));
  assert.ok(menu.every((line) => !line.text.includes('😀')));
  assert.equal(result.final[8], 1300);
  assert.equal(result.final[13], 0);
});

test('Japanese mid-text checkpoint replays bytes and resumes the same label/state/UI', async () => {
  const prefix = [...textEvents('cc'), ...scalarEvents('名')];
  const suffix = [...scalarEvents('前\n'), ...textEvents('i ')];
  const original = await record('japanese-text-save', { seed: 1, events: [...prefix, SAVE_EVENT, ...suffix] });
  assert.equal(original.stores.length, 1);
  const envelope = JSON.parse(original.stores[0]);
  const base = envelope.input_index - envelope.inputs.length;
  const traceStart = original.traces.findIndex((trace) => trace.input_index === base);
  assert.notEqual(traceStart, -1);
  const restored = await record('japanese-text-restored', { seed: 999, events: suffix, restore: original.stores[0] });
  assertEquivalent(original.traces.slice(traceStart), restored.traces, 'Real UTF8 editor replay trace');
  assertEquivalent(original.final, restored.final);
  assertEquivalent(originalFrames(original.frames).at(-1), originalFrames(restored.frames).at(-1));
  assert.deepEqual(original.frames.at(-1).ui, restored.frames.at(-1).ui);
  assert.ok(restored.frames.flatMap((frame) => frame.ui?.lines ?? []).some((line) => line.text.includes('名前')));
});

test('Japanese player name editor preserves scalars and updates the visible name', async () => {
  // Six booleans and one inventory-style field precede the Name editor.
  const events = [...textEvents('o' + '\n'.repeat(7)), ...scalarEvents('勇者😀'), 127,
    ...scalarEvents('甲\n'), ...textEvents('\n\n .')];
  const result = await record('japanese-player-name', { seed: 1, name: '初期名', events });
  assert.equal(result.frames.at(-1).ui.name, '勇者甲');
  assert.ok(result.frames.flatMap((frame) => frame.ui?.lines ?? []).some((line) => line.text === '勇者甲'));
  assert.equal(result.final[8], 1299);
  assert.equal(result.final[13], 1);
});

test('Empty player name edit preserves the initial Japanese identity', async () => {
  const result = await record('japanese-player-name-unchanged', {
    seed: 1, name: '初期勇者', text: 'o' + '\n'.repeat(8) + '\x1b .',
  });
  assert.equal(result.frames.at(-1).ui.name, '初期勇者');
  assert.equal(result.final[8], 1299);
  assert.equal(result.final[13], 1);
});

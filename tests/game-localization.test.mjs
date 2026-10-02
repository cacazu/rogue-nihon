import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runGame, originalFrames } from './run-game.mjs';
import { assertEquivalent } from './compare-traces.mjs';

const split = fileURLToPath(new URL('../build/game-fixtures.js', import.meta.url));
const baseline = fileURLToPath(new URL('../build/baseline-fixtures.js', import.meta.url));
const output = fileURLToPath(new URL('./localization-results/', import.meta.url));
await mkdir(output, { recursive: true });
const name = '雪 %s%n%%';

async function compare(label, fixture, text, expectedCode, compareOriginal = true) {
  const config = { fixture, seed: 17, text, name };
  const english = await runGame(split, { ...config, locale: 'en' });
  const japanese = await runGame(split, { ...config, locale: 'ja' });
  await writeFile(`${output}/${label}-en.json`, JSON.stringify(english, null, 2));
  await writeFile(`${output}/${label}-ja.json`, JSON.stringify(japanese, null, 2));
  assert.equal(english.code, expectedCode, `${label}: ${JSON.stringify(english.outcomes)}`);
  assert.equal(japanese.code, expectedCode, `${label}: ${JSON.stringify(japanese.outcomes)}`);
  assert.equal(english.consumed, text.length);
  assert.equal(japanese.consumed, text.length);
  assertEquivalent(english.traces, japanese.traces, `${label} all 20 C words/RNG and input index`);
  assertEquivalent(english.final, japanese.final, `${label} final C state`);
  assertEquivalent(originalFrames(english.frames), originalFrames(japanese.frames), `${label} every original English C frame`);
  for (const frame of japanese.frames) {
    if (!frame.ui) continue;
    assert.equal(frame.ui.fallback_used, false, `${label}: ${JSON.stringify(frame.ui.missing_ids)}`);
    for (const line of frame.ui.lines) {
      assert.equal(line.fallback_used, false, `${label}: ${line.id} ${JSON.stringify(line.missing_ids)}`);
    }
  }
  for (const message of japanese.messages) {
    assert.equal(message.fallback_used, false, `${label}: ${message.id} ${JSON.stringify(message.missing_ids)}`);
  }
  if (compareOriginal) {
    await access(baseline);
    const original = await runGame(baseline, { ...config, locale: 'en' });
    await writeFile(`${output}/${label}-baseline.json`, JSON.stringify(original, null, 2));
    assert.equal(original.code, english.code);
    assert.equal(original.consumed, english.consumed);
    assertEquivalent(original.traces, english.traces, `${label} original-rule baseline 20 words/RNG`);
    assertEquivalent(original.final, english.final, `${label} original-rule final C state`);
    assertEquivalent(originalFrames(original.frames), originalFrames(english.frames), `${label} original-rule C frames`);
  }
  return japanese;
}

const lines = (result) => result.frames.flatMap((frame) => frame.ui?.lines ?? []);

test('actual tombstone/death/score use Japanese cause and the Unicode player identity', async () => {
  const result = await compare('tombstone', 'ending-death', '\n\n', 1);
  const text = lines(result);
  assert.ok(text.some((line) => line.scope === 'tombstone' && line.text === name));
  assert.ok(text.some((line) => line.id === 'ui.ending.cause' && /エミュー/.test(line.text)));
  assert.ok(text.some((line) => line.id === 'ui.ending.rest' && line.text === 'ここに'));
  assert.ok(text.some((line) => line.scope === 'score' && line.text.includes(name)));
  assert.ok(text.some((line) => line.id === 'ui.score.entry_death' && line.text.includes('倒された')));
  assert.ok(result.frames.some((frame) => frame.ui?.mode === 'tombstone'));
});

test('actual plain death uses the cause descriptor and Japanese gold/result text', async () => {
  const result = await compare('plain-death', 'ending-no-tomb', '\n\n', 1);
  assert.ok(lines(result).some((line) => line.id === 'ui.ending.death_summary'
    && line.text.includes('エミューに倒された') && line.text.includes('所持金：')));
  assert.ok(result.frames.some((frame) => frame.ui?.mode === 'death'
    && frame.ui.lines.some((line) => line.id === 'ui.ending.death_summary')
    && /^\s*$/.test(frame.map_cells)), 'Plain death must replace the full C screen');
});

test('actual victory and sale inventory use Japanese names, amounts and result', async () => {
  const result = await compare('victory', 'ending-victory', ' \n', 2);
  const text = lines(result);
  assert.ok(text.some((line) => line.id === 'ui.ending.victory_title' && line.text === '生還！'));
  assert.ok(text.some((line) => line.id === 'ui.ending.loot_item' && line.text.includes('メイス') && line.text.includes('価値：')));
  assert.ok(text.some((line) => line.id === 'ui.ending.gold_value' && line.text.includes('所持金：')));
  assert.ok(text.some((line) => line.scope === 'score' && line.text.includes(name) && line.text.includes('生還した')));
  assert.ok(result.frames.some((frame) => frame.ui?.mode === 'victory' && /^\s*$/.test(frame.map_cells)));
});

test('actual combat localizes actor, target and RNG-selected verb without changing C', async () => {
  const result = await compare('combat', 'combat', 'l l l l ', -1);
  const combat = result.messages.filter((message) => message.id === 'message.sequence'
    && JSON.stringify(message.args).includes('combat_verb'));
  assert.ok(combat.length > 0, 'The original hit/miss path must actually run');
  assert.ok(combat.some((message) => message.text.includes('エミュー')));
  assert.ok(combat.some((message) => /命中|殴|攻撃|外れ|打撃|叩|突/.test(message.text)), JSON.stringify(combat));
  assert.ok(combat.every((message) => !/\b(?:you|emu|hit|miss)\b/i.test(message.text)));
});

test('actual see-invisible potion preserves a custom Unicode fruit and percent sequences', async () => {
  /* Original msg(dynamic_format) interprets custom %s/%n as missing varargs.
   * Do not execute that undefined original behavior as a golden baseline. */
  const result = await compare('see-invisible-custom', 'see-invisible', 'qf', -1, false);
  const message = result.messages.find((event) => event.id === 'potion.effect.see_invisible'
    || JSON.stringify(event.args).includes('potion.effect.see_invisible'));
  assert.ok(message, 'The real dynamic potion string must be tagged');
  assert.ok(message.text.includes('竜果 %s%n%%'), message.text);
  assert.ok(message.text.includes('ジュース'), message.text);
});

test('actual default see-invisible potion also agrees with the original-rule baseline', async () => {
  const result = await compare('see-invisible-plain', 'see-invisible-plain', 'qf', -1);
  assert.ok(result.messages.some((message) => message.text.includes('ジュース')));
});

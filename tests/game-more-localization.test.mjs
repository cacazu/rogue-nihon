import { artifactDirectory } from "../tools/temporary-artifacts.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runGame, textEvents, originalFrames, SAVE_EVENT } from './run-game.mjs';
import { assertEquivalent } from './compare-traces.mjs';

const split = fileURLToPath(new URL('../build/game-fixtures.js', import.meta.url));
const baseline = fileURLToPath(new URL('../build/baseline-fixtures.js', import.meta.url));
const output = artifactDirectory(fileURLToPath(new URL('./more-localization-results/', import.meta.url)));
await mkdir(output, { recursive: true });

async function recorded(label, module, config) {
  const result = await runGame(module, config);
  // Preserve failures too, including actual UI/input/trace at the Save callback.
  await writeFile(`${output}/${label}.json`, JSON.stringify(result, null, 2));
  assert.equal(result.code, -1, JSON.stringify(result.outcomes));
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].code, -1);
  if (config.locale === 'ja') {
    assert.match(result.outcomes[0].text, /[\u3040-\u30ff]/, 'Japanese outcome must also be localized');
  } else {
    assert.equal(result.outcomes[0].text, 'input ended');
  }
  return result;
}

function completeJapanese(result) {
  for (const frame of result.frames) {
    if (!frame.ui) continue;
    assert.equal(frame.ui.fallback_used, false, JSON.stringify(frame.ui.missing_ids));
    for (const line of [...frame.ui.lines, frame.ui.more, frame.ui.status].filter(Boolean)) {
      assert.equal(line.fallback_used, false, `${line.id}: ${JSON.stringify(line.missing_ids)}`);
    }
  }
  for (const message of result.messages) {
    assert.equal(message.fallback_used, false, `${message.id}: ${JSON.stringify(message.missing_ids)}`);
  }
}

test('actual Japanese More wait saves and resumes in a fresh module with identical C/RNG/UI', async () => {
  const prefix = 'qf', suffix = ' l';
  const config = { fixture: 'double-haste', seed: 17, name: '勇者',
    events: [...textEvents(prefix), SAVE_EVENT, ...textEvents(suffix)] };
  const original = await recorded('actual-more-ja-original', split, { ...config, locale: 'ja' });
  assert.equal(original.stores.length, 1);
  assert.equal(original.store_contexts.length, 1);
  assert.equal(original.consumed, config.events.length);
  const context = original.store_contexts[0];
  assert.equal(context.read_position, prefix.length + 1);
  assert.equal(context.read.event, SAVE_EVENT);
  assert.equal(context.trace.words[19], 1, 'C must actually be waiting for input');
  assert.equal(context.trace.input_index, prefix.length);
  assert.ok(context.frame.cells.includes('--More--'), 'Save must occur while actual C More is visible');
  assert.equal(context.frame.ui.more.id, 'ui.more');
  assert.deepEqual(context.frame.ui.more.args, []);
  assert.equal(context.frame.ui.more.fallback_used, false);
  assert.ok(context.frame.ui.more.text.includes('続きを表示'));
  assert.equal(context.input_context.input.kind, 'space');
  assert.equal(context.input_context.input.id, 'input.next_message');
  assert.ok(context.input_context.input.text.includes('Space'));
  const envelope = JSON.parse(original.stores[0]);
  // Automatic sleep has already crossed an outer-command checkpoint. More is
  // reconstructed by running that command from its saved state, with no keys
  // consumed inside this command yet; q/f belong to the preceding command.
  assert.deepEqual(envelope.inputs, []);
  assert.equal(envelope.input_index, prefix.length);
  const base = envelope.input_index - envelope.inputs.length;
  const start = original.traces.findIndex((trace) => trace.input_index === base);
  assert.notEqual(start, -1);
  const restored = await recorded('actual-more-ja-restored', split, {
    seed: 999, locale: 'ja', text: suffix, restore: original.stores[0],
  });
  assert.equal(restored.consumed, suffix.length);
  assertEquivalent(original.traces.slice(start), restored.traces, 'More fresh-module replay all 20 words/RNG/input');
  assertEquivalent(original.final, restored.final, 'More final C state');
  const continued = original.frames.filter((frame, index) => original.frame_contexts[index].read_position > context.read_position);
  const resumed = restored.frames.filter((frame, index) => restored.frame_contexts[index].read_position > 0);
  assert.ok(continued.length > 0);
  assertEquivalent(originalFrames(continued), originalFrames(resumed), 'Every C frame after acknowledging actual More');
  assert.deepEqual(original.frames.at(-1).ui, restored.frames.at(-1).ui, 'Restored Japanese presentation history');
  assert.equal(original.frames.at(-1).sha256, restored.frames.at(-1).sha256);
  assert.ok(restored.frames.some((frame) => frame.cells.includes('--More--') && frame.ui?.more?.id === 'ui.more'),
    'Replay must actually reconstruct the More screen before accepting live Space');
  completeJapanese(original);
  completeJapanese(restored);

  const english = await recorded('actual-more-en-original', split, { ...config, locale: 'en' });
  const expected = await recorded('actual-more-baseline', baseline, {
    fixture: config.fixture, seed: config.seed, name: config.name, locale: 'en', text: prefix + suffix,
  });
  for (const [label, result] of [['English locale', english], ['Original-rule baseline', expected]]) {
    assertEquivalent(original.traces, result.traces, `${label} all 20 words/RNG/input`);
    assertEquivalent(original.final, result.final, `${label} final C state`);
    assertEquivalent(originalFrames(original.frames), originalFrames(result.frames), `${label} every English C frame`);
  }
});

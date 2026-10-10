import { artifactDirectory } from "../tools/temporary-artifacts.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runGame, textEvents, SAVE_EVENT, originalFrames } from './run-game.mjs';
import { assertEquivalent } from './compare-traces.mjs';

const split = fileURLToPath(new URL('../build/game.js', import.meta.url));
const instrumented = fileURLToPath(new URL('../build/game-fixtures.js', import.meta.url));
const output = artifactDirectory(fileURLToPath(new URL('./actual-results/', import.meta.url)));
await mkdir(output, { recursive: true });

async function recorded(label, config, module = split) {
  const result = await runGame(module, config);
  await writeFile(`${output}/${label}.json`, JSON.stringify(result, null, 2));
  assert.equal(result.code, -1, `${label}: ${JSON.stringify(result.outcomes)} ${JSON.stringify(result.messages.slice(-3))}`);
  assert.deepEqual(result.outcomes, [{ code: -1, text: 'input ended' }]);
  assert.equal(result.consumed, config.events?.length ?? config.text.length);
  return result;
}

test('actual game is deterministic and Rust repaint preserves every inspected C word', async () => {
  const config = { seed: 1, text: 'v .hljki w\x1ba', repaint: 100 };
  const first = await recorded('determinism-a', config, instrumented);
  const second = await recorded('determinism-b', config, instrumented);
  assertEquivalent(first.traces, second.traces);
  assertEquivalent(first.final, second.final);
  assert.equal(first.repaint_pure, 100);
  const production = await recorded('determinism-production', {...config, repaint: 0});
  assertEquivalent(production.traces, first.traces);
  assertEquivalent(production.final, first.final);
});

test('production game cannot call regression-only repaint hooks', async () => {
  await assert.rejects(runGame(split, {seed: 1, text: '.', repaint: 1}), /explicit test-hooks/);
});

test('free version/space/escape consume no game turn; successful moves consume food', async () => {
  const free = await recorded('free-commands', { seed: 1, text: 'v \x1b' });
  assert.equal(free.final[8], 1300);
  assert.equal(free.final[13], 0);
  assert.equal(free.final[1], free.traces[0].words[1]);
  const movement = await recorded('move-food', { seed: 1, text: 'hl' });
  assert.equal(movement.final[8], 1298);
  assert.equal(movement.final[13], 2);
  assert.equal(movement.final[3], movement.traces[0].words[3]);
});

async function restoreCase(label, prefix, suffix) {
  const original = await recorded(`${label}-original`, { seed: 1, events: [...textEvents(prefix), SAVE_EVENT, ...textEvents(suffix)] });
  assert.equal(original.stores.length, 1, `${label} must produce a checkpoint envelope`);
  const envelope = JSON.parse(original.stores[0]);
  const base = envelope.input_index - envelope.inputs.length;
  const traceStart = original.traces.findIndex((trace) => trace.input_index === base);
  assert.notEqual(traceStart, -1);
  const restored = await recorded(`${label}-restored`, { seed: 999, text: suffix, restore: original.stores[0] });
  assertEquivalent(original.traces.slice(traceStart), restored.traces, `${label} continued read states`);
  assertEquivalent(original.final, restored.final, `${label} continued final state`);
  assert.deepEqual(originalFrames([restored.frames.at(-1)]), originalFrames([original.frames.at(-1)]), 'complete original C frame restored');
  // V1 never stored semantic UI metadata; even the prior committed executable
  // loses ui.status at an unchanged C status cache. V2 checks retain full UI.
  if(envelope.version===2) assert.deepEqual(restored.frames.at(-1).ui,original.frames.at(-1).ui);
  return { original, restored, envelope };
}

test('fresh module resumes an item selection with the same journal, state and frame', async () => {
  await restoreCase('wield-midprompt', '.w', 'a .');
});

test('fresh module preserves food wielding and repeated direction after a move checkpoint', async () => {
  await restoreCase('food-equipped', 'wa ', '.w\x1b.');
  await restoreCase('direction-repeat', 'ml', 'a .');
});

test('fresh module resumes inventory paging without inserting an input or game turn', async () => {
  await restoreCase('inventory-midprompt', '.i', ' .');
});

test('altered envelope checksum is rejected before starting a game', async () => {
  const { envelope } = await restoreCase('checksum-source', '', '.');
  envelope.checksum = (envelope.checksum ^ 1) >>> 0;
  const result = await runGame(split, { seed: 1, text: '.', restore: JSON.stringify(envelope) });
  await writeFile(`${output}/checksum-rejected.json`, JSON.stringify(result, null, 2));
  assert.equal(result.code, -2);
  assert.equal(result.consumed, 0);
  assert.equal(result.traces.length, 0);
  assert.match(result.messages.at(-1).text, /checksum mismatch/);
});

test('actual original-rule baseline equals split module for fixed inputs and seeds', async (context) => {
  const baseline = process.env.ROGUE_BASELINE_MODULE;
  if (!baseline) { context.skip('Set ROGUE_BASELINE_MODULE after independently built original-rule overlay is ready'); return; }
  await access(baseline);
  const cases = [
    { seed: 1, text: 'v .hljk' },
    { seed: 17, text: 'i w\x1bq\x1bT Wb ml a .vv ', rustInventoryAt: 1 },
    { seed: 12345, text: '3.6s99.v.\x1b? 5.\x1b' },
  ];
  for (const seed of [2, 7, 31, 257, 65537]) {
    cases.push({ seed, text: 'hljkyubn'.repeat(6) + '2.3s' });
  }
  for (const [index, config] of cases.entries()) {
    const expected = await runGame(baseline, config);
    const actual = await runGame(split, config);
    await writeFile(`${output}/baseline-${index}.json`, JSON.stringify(expected, null, 2));
    await writeFile(`${output}/split-${index}.json`, JSON.stringify(actual, null, 2));
    assert.notEqual(expected.code, -2, 'Baseline must not abort invalid game state');
    assert.equal(expected.code, actual.code);
    assert.equal(expected.consumed, actual.consumed);
    assertEquivalent(expected.outcomes, actual.outcomes);
    assertEquivalent(expected.traces, actual.traces, `seed ${config.seed} original-rule trace`);
    assertEquivalent(expected.final, actual.final, `seed ${config.seed} original-rule final`);
    let expectedFrames = expected.frames;
    if (config.rustInventoryAt) {
      // i now publishes a Rust inventory window instead of drawing a C terminal
      // inventory frame. Keep the exact C comparison for every other frame,
      // including the first resumed frame, and retain all state/trace checks above.
      const atInventory = (_, index) => expected.frame_contexts[index].read_position === config.rustInventoryAt;
      const terminalInventory = expectedFrames.filter(atInventory).length;
      if (terminalInventory === 0) {
        assert.ok(expected.presentations.some(event => event.ui.inventory),
          'A baseline with Rust inventory must publish its inventory view');
      } else assert.equal(terminalInventory, 1);
      assert.equal(actual.frame_contexts.filter(frame => frame.read_position === config.rustInventoryAt).length, 0);
      expectedFrames = expectedFrames.filter((frame, index) => !atInventory(frame, index));
    }
    assertEquivalent(originalFrames(expectedFrames), originalFrames(actual.frames), `seed ${config.seed} original-rule English frames`);
  }
});

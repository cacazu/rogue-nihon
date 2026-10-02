import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEquivalent, assertHostWorkIsPure, firstDifference } from './compare-traces.mjs';

const trace = [{
  phase: 'need_command', inputIndex: 2,
  logic: { seed: -112321, food: 1298, hero: [6, 15], knowledge: { potion: false } },
  visibleCells: [{ x: 15, y: 6, glyph: 64 }],
  events: [{ id: 'combat.hit', variant: 2 }],
}];
const copy = () => structuredClone(trace);

test('key order does not affect JSON state equality', () => {
  assertEquivalent({ hero: [1, 2], seed: 19 }, { seed: 19, hero: [1, 2] });
});

test('extra RNG draw is reported at the first divergent seed', () => {
  const actual = copy();
  actual[0].logic.seed += 1;
  assert.throws(() => assertEquivalent(trace, actual), /\["seed"\]/);
});

test('same world state with different input or phase consumption fails', () => {
  const actual = copy();
  actual[0].inputIndex = 3;
  assert.throws(() => assertEquivalent(trace, actual), /\["inputIndex"\]/);
});

test('newly leaked visibility is a comparison failure', () => {
  const actual = copy();
  actual[0].visibleCells.push({ x: 1, y: 1, glyph: 77 });
  assert.throws(() => assertEquivalent(trace, actual), /\["visibleCells"\]\.length/);
});

test('event variant and event order are part of the trace', () => {
  const actual = copy();
  actual[0].events[0].variant = 1;
  assert.throws(() => assertEquivalent(trace, actual), /\["variant"\]/);
});

test('repaint must preserve C-owned state and identified knowledge', () => {
  const before = trace[0].logic;
  assertHostWorkIsPure(before, structuredClone(before));
  const after = structuredClone(before);
  after.knowledge.potion = true;
  assert.throws(() => assertHostWorkIsPure(before, after), /\["potion"\]/);
});

test('missing properties cannot be hidden by explicit undefined', () => {
  assert.notEqual(firstDifference({ seed: undefined }, {}), null);
});

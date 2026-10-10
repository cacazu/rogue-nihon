import test from 'node:test';
import assert from 'node:assert/strict';
import {runGame, SAVE_EVENT, textEvents} from './run-game.mjs';

test('nymph steals one missile without freeing the remaining stack; save/load continues', async () => {
  const result = await runGame('build/game-fixtures.js', {
    fixture: 'nymph-stack', seed: 17, messagePaging: 'log',
    events: [...textEvents('.'.repeat(12)), SAVE_EVENT, ...textEvents('i .')],
  });
  assert.equal(result.code, -1);
  const theft = result.messages.find(m => m.id === 'fight.attack.she_stole');
  assert.ok(theft, 'actual nymph attack must have stolen an item');
  assert.equal(theft.args[0].value.category, 'weapon');
  assert.equal(theft.args[0].value.which, 7);
  assert.equal(theft.args[0].value.count, 1);
  assert.equal(result.stores.length, 1, 'save must walk a valid pack');
  const hasRemainingStack = p => p.ui?.lines?.some(l => l.args?.some(a =>
    a.value?.category === 'weapon' && a.value.which === 7 && a.value.count === 13));
  assert.ok([...result.presentations, ...result.frames].some(hasRemainingStack),
    'remaining 13 missiles must still be listed');
  const restored = await runGame('build/game-fixtures.js', {restore: result.stores[0], messagePaging: 'log', text: '.'});
  assert.equal(restored.code, -1);
  assert.deepEqual(restored.stderr, []);
  assert.equal(restored.input_contexts.at(-1).input.kind, 'command');
});

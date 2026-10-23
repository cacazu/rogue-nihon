// Preserve original wall-impact landing rules: docs/ORIGINAL-SPEC-ja.md.
// Build all three modules with this same game-fixtures.c. The original uses
// tests/baseline-src; BEFORE independently archives the C before the wall change.
// ROGUE_THROW_ORIGINAL and ROGUE_THROW_BEFORE are required: missing comparisons
// must never turn an unverified original-rule claim into a passing test.
import assert from 'node:assert/strict';
import test from 'node:test';
import {runGame, originalFrames} from './run-game.mjs';

const original = process.env.ROGUE_THROW_ORIGINAL;
const before = process.env.ROGUE_THROW_BEFORE;
const current = process.env.ROGUE_THROW_WASM || 'build/game-fixtures.wasm';
assert.ok(original, 'Set ROGUE_THROW_ORIGINAL to an original-rule fixture Wasm');
assert.ok(before, 'Set ROGUE_THROW_BEFORE to an independent pre-fix fixture Wasm');
const categories = {food:':', potion:'!', scroll:'?', weapon:')', armor:']', ring:'=', stick:'/', amulet:','};
const vanishId = 'weapons.fall.vanishes_as_it_hits_the_ground';
const weaponVanishId = 'weapons.fall.the_vanishes_as_it_hits_the_ground';

function positions(result, glyph) {
  const frame = result.frames.at(-1), points = [];
  for (let y = 1; y < frame.height - 1; y++)
    for (let x = 0; x < frame.width; x++)
      if (frame.cells[y * frame.width + x] === glyph) points.push([x,y]);
  return points;
}
function config(category, scenario, seed = 17, text) {
  const direction = scenario === 'h' ? 'j' : scenario === 'd' ? 'n' : 'l';
  return {seed, fixture:`throw-wall-${category}-${scenario}`, text:text ?? `t${direction}a.`,
    locale:'en', messagePaging:'legacy', acknowledgeMore:true};
}
function completed(result, options) {
  assert.equal(result.code, -1, JSON.stringify(result.outcomes));
  assert.equal(result.consumed, options.text.length, options.fixture+' consumes only scripted actions');
  assert.deepEqual(result.stderr, []);
  assert.equal(result.final[13], 2, 'Throw/use and the next normal command both complete');
}
function sameRules(expected, actual, label) {
  assert.deepEqual(actual.traces, expected.traces, label+' every input index and all 20 state/RNG words');
  assert.deepEqual(originalFrames(actual.frames), originalFrames(expected.frames), label+' every original C frame');
  assert.deepEqual(actual.final, expected.final, label+' final state');
  assert.deepEqual(actual.outcomes, expected.outcomes, label+' outcomes');
}

// Wall impacts use the fixed original's landing candidates and RNG consumption,
// including landing beyond the impact wall when the 3x3 area contains floor.
test('Every throwable category preserves original wall/rock landing and C/RNG', async () => {
  let originalBackside = 0;
  for (const [category,glyph] of Object.entries(categories)) {
    for (const scenario of ['v','h','d','rock','secret']) {
      for (const seed of [1,17]) {
        const options = config(category, scenario, seed);
        const source = await runGame(original, options);
        const old = await runGame(before, options);
        const now = await runGame(current, options);
        for (const result of [source,old,now]) completed(result, options);
        sameRules(source, old, options.fixture+' pre-fix versus original');
        const isBackside = ([x,y]) => scenario === 'h' ? y > 12 : scenario === 'd' ? x + y > 24 : x > 12;
        sameRules(source, now, options.fixture+' current versus original');
        // The fixed baseline lacks intermediate semantic prompt instrumentation.
        const nextWait = result => {
          const input = result.input_contexts.at(-1).input;
          return {kind:input.kind,mode:input.mode};
        };
        assert.deepEqual(nextWait(now),nextWait(source),'The next input wait remains identical');
        const sourcePoints = positions(source,glyph), newPoints = positions(now,glyph);
        assert.equal(sourcePoints.length,1);
        assert.deepEqual(newPoints,sourcePoints,options.fixture+' original landing position');
        if (sourcePoints.some(isBackside)) originalBackside++;
        const flights = now.frames.flatMap(frame => frame.map_projectile_events || []);
        assert.equal(flights.length,1);
        assert.ok(!flights[0].path.some(point => isBackside([point.x,point.y])), 'Observed flight stops before the wall');
      }
    }
  }
  assert.ok(originalBackside > 0, 'Fixtures cover original landing beyond the impact wall');
});

test('No landing square uses safe public names for every highest valid subtype', async () => {
  for (const [category,glyph] of Object.entries(categories)) {
    const options = {...config(category,'blocked'),locale:'ja',messagePaging:'log',acknowledgeMore:false};
    const now = await runGame(current, options);
    completed(now, options);
    assert.deepEqual(positions(now,glyph), [], 'No item is placed across the wall');
    assert.equal(now.final[1],options.seed,'No landing candidate or public-name rendering consumes RNG');
    const message = now.messages.find(m => m.id === (category === 'weapon' ? weaponVanishId : vanishId));
    assert.ok(message,category+' has its own translated disappearance message');
    assert.equal(message.fallback_used,false);
    assert.deepEqual(message.missing_ids,[]);
    assert.ok(message.text.endsWith('は地面に落ちた途端に消えた。'));
    const item = message.args[0].value;
    assert.equal(item.category,category);
    if (['potion','scroll','ring','stick'].includes(category)) {
      assert.equal(item.which,null,'An unidentified subtype is never published');
      assert.equal(item.known,false,'Naming does not identify an item');
      assert.equal(item.identified,false);
      assert.ok(item.appearance);
      assert.ok(Object.values(item.visible_fields).every(value => !value));
    }
    if (category === 'weapon') {
      assert.equal(item.type,'item_name');
      assert.equal(item.which,8);
      assert.equal(message.fallback,'The spear vanishes as it hits the ground');
    }
  }
  for (const category of ['potion','scroll','ring','stick']) {
    const options = {...config(category,'blocked-called'),locale:'ja',messagePaging:'log',acknowledgeMore:false};
    const now = await runGame(current,options), message = now.messages.find(m => m.id === vanishId);
    completed(now,options);
    assert.equal(now.final[1],options.seed);
    assert.equal(message.args[0].value.which,null);
    assert.equal(message.args[0].value.known,false);
    assert.equal(message.args[0].value.called,'red %s-name');
    assert.ok(message.text.includes('red %s-name'),'A user label remains literal data');
  }
});

test('Doors, monster hit/miss, magic missiles, arrow traps and monster drops preserve original C/RNG', async () => {
  const cases = [
    ...Object.keys(categories).map(category => [category,'door','tla.']),
    ['food','hit','tla.'], ['food','miss','tla.'],
    ['stick','bolt','zla.'], ['food','trap','j.'], ['food','enemy-drop','l.'],
  ];
  for (const [category,scenario,text] of cases) {
    const options = config(category,scenario,17,text);
    const source = await runGame(original,options), old = await runGame(before,options), now = await runGame(current,options);
    for (const result of [source,old,now]) completed(result,options);
    sameRules(source,old,options.fixture+' original versus pre-fix');
    sameRules(old,now,options.fixture+' unchanged boundary');
    assert.deepEqual(now.input_contexts,old.input_contexts,'The next input wait remains identical');
    const messages=now.messages.map(m => m.fallback).join('\n');
    if (scenario === 'hit') assert.ok(messages.includes('You hit the zombie'));
    if (scenario === 'miss') assert.ok(messages.includes('You missed the zombie'));
    if (scenario === 'bolt') assert.ok(messages.includes('missle vanishes'));
    if (scenario === 'trap') assert.ok(messages.includes('An arrow shoots past you'));
    if (scenario === 'enemy-drop') assert.ok(messages.includes('defeated the zombie'));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runGame} from './run-game.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const module=path.join(root,'build/game-fixtures.wasm');
const options={seed:17,name:'Player',locale:'ja',messagePaging:'log'};
for(const [fixture,text,kind] of [['autowalk-miss','l','attacked'],['autowalk-invisible','l','attacked'],['autowalk-hit','l','attacked'],['autowalk-trap','ll','trap'],['autowalk-teleport','ll','trap'],['autowalk-enemy','llll','attack']]){
 test('C interruption '+fixture,async()=>{
  const r=await runGame(module,{...options,fixture,text});
  const event=r.player_events.find(e=>e.kind===kind);assert.ok(event);
  assert.deepEqual(Object.keys(event).sort(),['kind','sequence','type']);
  assert.ok(event.sequence>0);
  const i=r.host_events.findIndex(e=>e.type==='player-event'&&e.kind===kind);
  assert.ok(r.host_events.slice(i+1).some(e=>e.type==='input-request'),'Interruption precedes next actual C input read');
  if(fixture==='autowalk-hit')assert.ok(r.frames.at(-1).stats.hp<100);
  if(fixture.includes('miss')||fixture.includes('invisible'))assert.equal(r.frames.at(-1).stats.hp,100);
 });
}
for(const [fixture,text] of [['animation','llh..'],['combat','l..'],['pickup-quantity','llh...']]){
 test('Observation preserves prechange C/RNG '+fixture,{skip:!process.env.ROGUE_AUTOWALK_BEFORE},async()=>{
  const [a,b]=await Promise.all([runGame(module,{...options,fixture,text}),runGame(process.env.ROGUE_AUTOWALK_BEFORE,{...options,fixture,text})]);
  assert.deepEqual(a.traces,b.traces);assert.deepEqual(a.frames.map(f=>f.cells),b.frames.map(f=>f.cells));
 });
}

for(const fixture of ['autowalk-dragon-hit','autowalk-dragon-miss'])test('Actual dragon bolt '+fixture,async()=>{
 const r=await runGame(module,{...options,seed:0,fixture,text:'l'});
 assert.ok(r.frames.flatMap(f=>f.map_projectile_events||[]).some(e=>e.kind==='magic'),'Original dragon fire_bolt runs');
 assert.ok(r.player_events.some(e=>e.kind==='attacked'));
 if(fixture.endsWith('miss'))assert.equal(r.frames.at(-1).stats.hp,100);
 else assert.ok(r.frames.at(-1).stats.hp<100);
});

for(const fixture of ['autowalk-gaze-hit','autowalk-gaze-miss'])test('Actual newly visible M gaze '+fixture,async()=>{
 const r=await runGame(module,{...options,fixture,text:'l'});
 assert.ok(r.player_events.some(e=>e.kind==='attacked'));
 assert.equal(r.frames.at(-1).stats.hp,100);
 assert.equal(Boolean(r.traces.at(-1).words[18]&0o1000),fixture.endsWith('hit'),'Original confusion differs between effect and resistance');
});

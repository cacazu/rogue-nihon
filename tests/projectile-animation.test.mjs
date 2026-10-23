// Projectile visual observations preserve original C screens, all 20 state/RNG words,
// input waits and the next command. Contract: docs/MAP-DISPLAY-ja.md.
import assert from 'node:assert/strict';
import test from 'node:test';
import {runGame,originalFrames} from './run-game.mjs';
const current=process.env.ROGUE_PROJECTILE_WASM||'build/item-use-fixtures.wasm';
const baseline=process.env.ROGUE_PROJECTILE_BASELINE;
assert.ok(baseline,'Set ROGUE_PROJECTILE_BASELINE to an independent pre-change fixture Wasm');
async function equivalent(fixture,text){
 const options={seed:17,name:'ProjectileCheck',locale:'ja',messagePaging:'log',fixture,text};
 const before=await runGame(baseline,options),after=await runGame(current,options);
 assert.deepEqual(after.traces,before.traces,'Every input boundary has the same state/RNG');
 assert.deepEqual(originalFrames(after.frames),originalFrames(before.frames),'All original C cells, player positions and stats remain identical');
 assert.deepEqual(after.input_contexts,before.input_contexts);assert.deepEqual(after.outcomes,before.outcomes);assert.deepEqual(after.stderr,[]);
 return after.frames.flatMap(frame=>frame.map_projectile_events||[]);
}
test('All 14 staff effects, no-charge and weak failures preserve rules and waits',async()=>{
 for(let kind=0;kind<14;kind++)for(const direction of ['h','l']){
  const events=await equivalent('item-use-stick-'+kind+'-known','z'+direction+'f.');
  assert.ok(events.some(event=>event.kind==='magic'),'Staff '+kind+' has a directional magic flight');
 }
 assert.deepEqual(await equivalent('item-use-stick-3-empty','zhf.'),[]);
 assert.deepEqual(await equivalent('item-use-stick-9-weak','zhf.'),[]);
});
test('All item categories spin, arrows fly straight, and every direction uses the real path',async()=>{
 for(const [category,kind]of [['potion',5],['scroll',15],['food',0],['weapon',4],['armor',0],['ring',0],['stick',0]]){
  const events=await equivalent('item-use-'+category+'-'+kind+'-known','thf.');assert.ok(events.some(event=>event.kind==='item'),category+' throw');
 }
 for(const direction of 'hjklyubn'){
  const events=await equivalent('item-use-weapon-4-known','wdt'+direction+'e.');assert.ok(events.some(event=>event.kind==='arrow'),'Arrow '+direction);
 }
});
test('Reflection, target hit, cancellation and later commands preserve C/RNG',async()=>{
 const bounce=await equivalent('item-use-stick-2-known','hhhhhhzhf.');const path=bounce.find(event=>event.kind==='magic').path;
 assert.ok(path.some((p,i)=>i>1&&(p.x-path[i-1].x)*(path[i-1].x-path[i-2].x)<0),'Record the actual wall reflection');
 for(const text of ['zlf.','z\x1b.','zl\x1b.'])await equivalent('item-use-stick-11-known',text);
 for(const text of ['t\x1b.','th\x1b.'])await equivalent('item-use-weapon-4-known',text);
});

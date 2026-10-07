import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runGame,textEvents,SAVE_EVENT} from './run-game.mjs';
const module=fileURLToPath(new URL('../build/game-fixtures.js',import.meta.url));
for(const locale of ['ja','en']) test('ordinary combat narration needs no Space and preserves C/RNG: '+locale,async()=>{
 const config={fixture:'combat',seed:17,locale,text:'lll'};
 const live=await runGame(module,{...config,messagePaging:'log'});
 assert.equal(live.final[13],3,'three attacks complete without acknowledgement keys');
 assert.equal(live.input_contexts.some(e=>e.input.kind==='space'),false,'ordinary combat does not request Space');
 const legacy=await runGame(module,{...config,acknowledgeMore:true});
 assert.deepEqual(live.final,legacy.final,'all twenty C words, including RNG, agree at next command');
 const saved=await runGame(module,{...config,text:undefined,messagePaging:'log',events:[...textEvents('ll'),SAVE_EVENT,...textEvents('l')]});
 const envelope=JSON.parse(saved.stores[0]);
 assert.equal(envelope.version,2);
 assert.equal(envelope.presentation.input.message_paging,'log');
 assert.equal(envelope.inputs.includes(32),false,'no acknowledgement fabricated in journal');
 const resumed=await runGame(module,{locale,restore:saved.stores[0],text:'l'});
 assert.deepEqual(resumed.final,saved.final,'fresh module keeps policy and complete state');
 const selection=await runGame(module,{seed:17,locale,messagePaging:'log',text:'w'});
 assert.equal(selection.input_contexts.at(-1).input.kind,'item','important selection remains waiting');
});

for (const fixture of ['hallucination','combat']) test('continuous narration preserves RNG and all C state: '+fixture,async()=>{
 const cfg={fixture,seed:17,locale:'ja',text:'l'.repeat(fixture==='combat'?30:5)};
 const log=await runGame(module,{...cfg,messagePaging:'log'}), legacy=await runGame(module,{...cfg,acknowledgeMore:true});
 assert.deepEqual(log.final,legacy.final); assert.equal(log.code,legacy.code);
 if(fixture==='combat') assert.ok(log.messages.filter(e=>e.text).length>3,'multiple messages retained by host');
 else assert.notEqual(log.final[1],log.traces[0].words[1],'hallucination exercised RNG');
});
for (const fixture of ['ending-death','ending-no-tomb','ending-victory']) test('ending confirmation is preserved: '+fixture,async()=>{
 const cfg={fixture,seed:1,locale:'ja',text:'\n\n'};
 const log=await runGame(module,{...cfg,messagePaging:'log'}), legacy=await runGame(module,cfg);
 assert.deepEqual(log.final,legacy.final);assert.equal(log.code,legacy.code);
 assert.deepEqual(log.reads.map(e=>e.event),legacy.reads.map(e=>e.event),'same ending confirmations consumed');
 assert.ok(log.consumed>0,'ending consumed actual confirmation input');
});
test('cancel item selection remains free and inventory is not bypassed',async()=>{
 const cfg={seed:17,locale:'ja',text:'w\x1bi'};
 const log=await runGame(module,{...cfg,messagePaging:'log'}), legacy=await runGame(module,{...cfg,acknowledgeMore:true});
 assert.deepEqual(log.final,legacy.final);
 assert.equal(log.final[13],0,'selection cancellation consumes no turn');
 assert.ok(log.frames.at(-1).ui.mode==='inventory'||log.frames.at(-1).ui.mode==='menu');
});

for (const prefix of ['qf','qfll']) test('old saved More history replays but future input needs no Space: '+prefix,async()=>{
 const old=await runGame(module,{fixture:'double-haste',seed:17,locale:'ja',events:[...textEvents(prefix),SAVE_EVENT,...textEvents(' l')]});
 assert.equal(old.stores.length,1);
 const saved=JSON.parse(old.stores[0]);
 assert.ok(!saved.presentation.input?.message_paging,'old save fixture has no log policy');
 const migrated=await runGame(module,{locale:'ja',restore:old.stores[0],messagePaging:'log',text:'l'});
 assert.deepEqual(migrated.final,old.final,'all C/RNG words equal explicit acknowledgement continuation');
 assert.equal(migrated.consumed,1,'only the actual movement key consumed');
 const again=await runGame(module,{locale:'ja',restore:old.stores[0],messagePaging:'log',events:[SAVE_EVENT,...textEvents('l')]});
 assert.equal(again.stores.length,1);
 const fresh=await runGame(module,{locale:'ja',restore:again.stores[0],text:'l'});
 assert.deepEqual(fresh.final,again.final,'resaving migration preserves replay boundary');
});

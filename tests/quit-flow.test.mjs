import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runGame} from './run-game.mjs';
const module=process.env.ROGUE_QUIT_FLOW_MODULE||fileURLToPath(new URL('../build/game.wasm',import.meta.url));
const config={seed:17,name:'Player',locale:'ja',messagePaging:'log'};

test('confirmed quit reaches populated score without an intermediate acknowledgement',async()=>{
 const r=await runGame(module,{...config,text:'Qy'});
 assert.equal(r.code,3,'yes completes quit without another key');
 assert.equal(r.consumed,2);
 assert.ok(r.presentations.some(p=>p.ui?.lines?.some(l=>l.id==='ui.score.heading')),'the result contains the score');
 assert.equal(r.input_contexts.some(e=>e.input.id==='input.show_score'),false,'no pre-score wait');
 const firstResult=r.frames.findIndex(frame=>frame.ui.mode==='score');
 assert.ok(firstResult>=0);
 assert.ok(r.frames.slice(firstResult).every(frame=>frame.ui.mode==='score'),'terminal score cleanup must retain the result scope instead of exposing ASCII as dungeon glyphs');
});

for(const answer of ['n','\u001b'])test('cancel quit with '+JSON.stringify(answer)+' preserves the next command',async()=>{
 const actual=await runGame(module,{...config,text:'Q'+answer+'.'});
 const expected=await runGame(module,{...config,text:'Qn.'});
 assert.deepEqual(actual.final,expected.final,'next action and all twenty C/RNG words agree');
 assert.equal(actual.consumed,3);
 assert.equal(actual.input_contexts.some(e=>e.input.id==='input.show_score'),false);
 assert.equal(actual.outcomes.some(e=>e.code===3),false);
});

const fixtures=process.env.ROGUE_QUIT_FLOW_FIXTURES||fileURLToPath(new URL('../build/game-fixtures.wasm',import.meta.url));
for(const fixture of ['ending-death','ending-no-tomb','ending-victory'])test(fixture+' retains its meaningful result acknowledgements',async()=>{
 const text=fixture==='ending-victory'?' \n':'\n\n';
 const r=await runGame(fixtures,{...config,fixture,text});
 assert.equal(r.code,fixture==='ending-victory'?2:1);
 assert.equal(r.consumed,text.length);
 assert.ok(r.input_contexts.some(e=>e.input.id==='input.show_score'),'the result before score is still acknowledged');
 if(fixture==='ending-victory')assert.ok(r.input_contexts.some(e=>e.input.id==='input.results'),'victory still asks before calculating loot');
});

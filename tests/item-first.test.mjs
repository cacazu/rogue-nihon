import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runGame,SAVE_EVENT} from './run-game.mjs';
const module=process.env.ROGUE_ITEM_FIRST_MODULE||fileURLToPath(new URL('../build/game-fixtures.wasm',import.meta.url));
const cfg={seed:17,name:'Player',locale:'ja',messagePaging:'log',fixture:'inventory-all'};
const SELECT_THROW=0x120004,SELECT_ZAP=0x120005;
const keys=text=>Array.from(text,key=>key.charCodeAt(0));

for(const [event,command,item] of [[SELECT_THROW,'t','e'],[SELECT_ZAP,'z','j']]) {
 test('PC selects '+command+' item first but C consumes direction then item once',async()=>{
  const expected=await runGame(module,{...cfg,text:command+'l'+item+'.'});
  const actual=await runGame(module,{...cfg,events:[event,...keys(item+'l.') ]});
  assert.deepEqual(actual.final,expected.final,'all twenty C words, turn and RNG agree');
  assert.equal(actual.consumed,4);
  assert.ok(actual.presentations.some(p=>p.ui.input.kind==='item'&&p.ui.input.action===(command==='t'?'action.throw':'action.zap')),'item selection is shown before C direction');
  assert.ok(actual.input_contexts.some(p=>p.input.kind==='direction'),'C still asks for original direction');
 });
 test('PC cancels '+command+' before command and after direction without leaking an item',async()=>{
  const cancelled=await runGame(module,{...cfg,events:[event,27,46]});
  const untouched=await runGame(module,{...cfg,text:'.'});
  assert.deepEqual(cancelled.final,untouched.final,'preselection browsing never inserts a C command or look');
  const actual=await runGame(module,{...cfg,events:[event,...keys(item),27,46]});
  const expected=await runGame(module,{...cfg,text:command+'\x1b.'});
  assert.deepEqual(actual.final,expected.final,'direction cancellation removes reserved item and next rest executes');
 });
 test('PC '+command+' direction intent resumes in a fresh C instance',async()=>{
  const live=await runGame(module,{...cfg,events:[event,...keys(item),SAVE_EVENT,...keys('l.') ]});
  assert.equal(live.stores.length,1);
  const expected=await runGame(module,{...cfg,text:command+'l'+item+'.'});
  assert.deepEqual(live.final,expected.final,'saved path retains the original command result');
  const saved=JSON.parse(live.stores[0]);
  assert.deepEqual(saved.inputs,[command.charCodeAt(0)],'only C command has been consumed at direction wait');
  assert.equal(saved.presentation.input.inventory_intent.item,item.charCodeAt(0));
  assert.equal(saved.inputs.some(key=>key===SELECT_THROW||key===SELECT_ZAP),false,'only original consumed command keys are saved');
  const resumed=await runGame(module,{...cfg,fixture:undefined,restore:live.stores[0],text:'l.'});
  assert.deepEqual(resumed.final,live.final,'restored pending item executes once after direction');
 });
}

test('zap preselection rejects a weapon and still accepts the live public stick',async()=>{
 const actual=await runGame(module,{...cfg,events:[SELECT_ZAP,...keys('ejl.') ]});
 const expected=await runGame(module,{...cfg,text:'zlj.'});
 assert.deepEqual(actual.final,expected.final);
 assert.equal(actual.consumed,5);
});

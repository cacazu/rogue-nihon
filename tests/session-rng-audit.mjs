import { artifactDirectory } from "../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGame, originalFrames, textEvents, SAVE_EVENT } from './run-game.mjs';
import { assertEquivalent } from './compare-traces.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=artifactDirectory(path.join(root,'tests/browser-smoke/output/session-rng'));
const prior=path.join(output,'pre-conversation');await mkdir(prior,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(args,encoding)=>execFileSync('git',args,{cwd:root,encoding,maxBuffer:20*1024*1024});
const commit=git(['rev-parse','HEAD'],'utf8').trim();
const evidence={started_at:new Date().toISOString(),commit,comparisons:[],saveMigrations:[],inputChanges:[],files:[],unchangedSources:[]};
for(const name of ['game.js','game.wasm']) {
 const bytes=git(['show','HEAD:rogue-nihon/build/'+name]);await writeFile(path.join(prior,name),bytes);
 evidence.files.push({role:'pre-conversation',file:name,sha256:hash(bytes)});
}
for(const name of ['game','game-fixtures','baseline-fixtures'])for(const extension of ['js','wasm']) {
 const file='build/'+name+'.'+extension;evidence.files.push({role:name,file,sha256:hash(await readFile(path.join(root,file)))});
}
for(const name of ['core.c','fight.c','misc.c','potions.c','weapons.c','move.c','daemons.c','chase.c','scrolls.c','sticks.c','save_adapter.c']) {
 const file='logic/'+name,bytes=await readFile(path.join(root,file));
 assert.equal(hash(bytes),hash(git(['show','HEAD:rogue-nihon/'+file])),file+' unchanged since HEAD');
 evidence.unchangedSources.push({file,sha256:hash(bytes)});
}
async function compare(label,moduleA,moduleB,configA,configB=configA) {
 const expected=await runGame(moduleA,configA),actual=await runGame(moduleB,configB);
 assert.equal(actual.code,expected.code,label+' exit');assert.equal(actual.consumed,expected.consumed,label+' input count');
 assertEquivalent(expected.traces,actual.traces,label+' every input position and all 20 C/RNG words');
 assertEquivalent(expected.final,actual.final,label+' final C/RNG state');
 assertEquivalent(originalFrames(expected.frames),originalFrames(actual.frames),label+' original C frames');
 await writeFile(path.join(output,label+'-before.json'),JSON.stringify(expected));
 await writeFile(path.join(output,label+'-after.json'),JSON.stringify(actual));
 evidence.comparisons.push({label,configA,configB,checkpoints:actual.traces.length,rng:actual.final[1],turn:actual.final[13],repaints:actual.repaint_pure||0});
}
try {
 const old=path.join(prior,'game.js'),current=path.join(root,'build/game.js'),fixture=path.join(root,'build/game-fixtures.js'),original=path.join(root,'build/baseline-fixtures.js');
 const commands=[
  ['inventory','i .'],['help','?* ?h/| .'],['options','o\x1b .'],['discovery','D* .'],
  ['wield-list','w* \x1b .'],['drink-empty-list','q*\x1b .'],['item-cancel','q\x1br\x1be\x1bw\x1bW\x1bd\x1bP\x1bI\x1b.'],
  ['direction-cancel','t\x1bz\x1bm\x1bf\x1bF\x1b^\x1b.'],['quit-no','Qn.'],['wield-action','wd.'],
  ['named-item','ccAudit\nIci .'],['slow-list','o'+'\n'.repeat(6)+'s\x1b i  \x1b.'],
  ['clear-list','o'+'\n'.repeat(6)+'c\x1b i .']
 ];
 for(const locale of ['en','ja'])for(const [label,text] of commands)await compare('head-'+locale+'-'+label,old,current,{seed:17,locale,text,messagePaging:'log'});
 for(const seed of [1,2,7,31,257,12345,65537])await compare('head-movement-'+seed,old,current,{seed,locale:'ja',text:'hljkyubn'.repeat(4)+'2.3s',messagePaging:'log'});
 const fixtureCases=[
  ['hall-q-empty','hallucination','q*'],['hall-w-list','hallucination','w* \x1b.'],
  ['hall-i','hallucination','i .'],['hall-help','hallucination','?* .'],['hall-options','hallucination','o\x1b .'],
  ['hall-slow','hallucination','o'+'\n'.repeat(6)+'s\x1b i  \x1b.'],
  ['hall-cancel','hallucination','q\x1bw\x1br\x1be\x1b.'],['hall-redraw','hallucination','vvx\x1b .'],
  ['mean-look','mean','v.'],['medusa-look','medusa','. '],['haste-drink','haste-potion','qfl'],
  ['combat','combat','lll'],['armor-turns','armor','TWb.']
 ];
 for(const [label,state,text] of fixtureCases)await compare('original-'+label,original,fixture,{fixture:state,seed:17,locale:'en',text,repaint:20});
 for(const [label,state,text] of fixtureCases.filter(c=>c[1]==='hallucination'))await compare('locale-'+label,fixture,fixture,{fixture:state,seed:17,locale:'en',text,messagePaging:'log',repaint:20},{fixture:state,seed:17,locale:'ja',text,messagePaging:'log',repaint:20});
 for(const state of ['ending-death','ending-no-tomb']) {
  await compare('ending-canonical-'+state,original,fixture,{fixture:state,seed:17,locale:'en',text:'\n\n'});
  await compare('ending-escape-'+state,fixture,fixture,{fixture:state,seed:17,locale:'en',text:'\n\n'},{fixture:state,seed:17,locale:'en',text:'\x1b\x1b'});
 }
 await compare('ending-victory',original,fixture,{fixture:'ending-victory',seed:17,locale:'en',text:' \n\n'});
 await compare('slow-enter-alias',current,current,{seed:17,locale:'en',text:'o'+'\n'.repeat(6)+'s\x1b i  \x1b.'},{seed:17,locale:'en',text:'o'+'\n'.repeat(6)+'s\x1b i\r\r\x1b.'});
 for(const [label,prefix,suffix] of [['item','.w','d.'],['inventory','.i',' .'],['text','ccAudit','Name\n.']]) {
  const saved=await runGame(old,{seed:17,locale:'ja',messagePaging:'log',events:[...textEvents(prefix),SAVE_EVENT,...textEvents(suffix)]});
  assert.equal(saved.stores.length,1,label+' old save');const envelope=JSON.parse(saved.stores[0]);
  const base=envelope.input_index-envelope.inputs.length;const index=saved.traces.findIndex(t=>t.input_index===base);assert.notEqual(index,-1);
  const resumed=await runGame(current,{seed:999,locale:'ja',restore:saved.stores[0],text:suffix,messagePaging:'log'});
  assertEquivalent(saved.traces.slice(index),resumed.traces,label+' old save continued C/RNG trace');assertEquivalent(saved.final,resumed.final,label+' old save final C/RNG');
  evidence.saveMigrations.push({label,checkpoints:resumed.traces.length,rng:resumed.final[1],turn:resumed.final[13]});
  await writeFile(path.join(output,'save-'+label+'-before.json'),JSON.stringify(saved));await writeFile(path.join(output,'save-'+label+'-after.json'),JSON.stringify(resumed));
 }
 for(const key of ['\r','\x1b']) {
  await compare('close-equivalent-'+key.charCodeAt(0),old,current,{seed:17,text:'i .',messagePaging:'log'},{seed:17,text:'i'+key+'.',messagePaging:'log'});
  const expected=await runGame(old,{seed:17,text:'i'+key+'.',messagePaging:'log'}),actual=await runGame(current,{seed:17,text:'i'+key+'.',messagePaging:'log'});
  evidence.inputChanges.push({key:key.charCodeAt(0),old:{rng:expected.final[1],turn:expected.final[13]},current:{rng:actual.final[1],turn:actual.final[13]},reason:'Enter/Esc now close a Space acknowledgement; old version ignores them and subsequent rest while waiting.'});
  assert.equal(expected.final[13],0);assert.equal(actual.final[13],1);
 }
 evidence.passed=true;console.log(JSON.stringify({passed:true,comparisons:evidence.comparisons.length,checkpoints:evidence.comparisons.reduce((n,c)=>n+c.checkpoints,0),saveMigrations:evidence.saveMigrations.length,inputChanges:evidence.inputChanges}));
} catch(error){evidence.passed=false;evidence.failure=error.stack;throw error;}
finally{evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,'node-evidence.json'),JSON.stringify(evidence,null,2)+'\n');}

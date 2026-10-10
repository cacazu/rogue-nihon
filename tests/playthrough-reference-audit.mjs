// Requires preserved pre-fix sources and independently built reference modules.
// See tests/browser-smoke/README-ja.md for the baseline preparation commands.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runGame,SAVE_EVENT,textEvents} from './run-game.mjs';

const directory='tests/browser-smoke/output/playthrough-fixes/';
const audit={at:new Date().toISOString(),description:'Original pre-fix C source; only generated message_catalog.inc uses corrected multiline source mapping',source_changes:[],checks:[]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const file of await readdir(directory+'before/logic')){
 const before=await readFile(directory+'before/logic/'+file),reference=await readFile(directory+'catalog-reference/logic/'+file);
 if(!before.equals(reference))audit.source_changes.push(file);
}
assert.deepEqual(audit.source_changes,['message_catalog.inc']);

const config={fixture:'inventory-all',seed:17,name:'ItemAudit',locale:'ja',messagePaging:'log',text:'@\x10'};
const before=await runGame('build/playthrough-before.js',config);
const reference=await runGame('build/playthrough-catalog-reference.js',config);
const after=await runGame('build/game-fixtures.js',config);
assert.deepEqual(after.traces,reference.traces);
const old=before.frames.at(-1),fixed=after.frames.at(-1);
assert.match(old.cells.slice(0,80),/%d/);
assert.doesNotMatch(fixed.cells.slice(0,80),/%/);
assert.match(fixed.cells.slice(0,80),/Hp:\s*100\(100\)/);
assert.equal(old.cells.slice(80),fixed.cells.slice(80));
const differences=[];
assert.equal(before.traces.length,after.traces.length);
for(let checkpoint=0;checkpoint<before.traces.length;checkpoint++){
 assert.equal(before.traces[checkpoint].input_index,after.traces[checkpoint].input_index);
 for(let word=0;word<20;word++)if(before.traces[checkpoint].words[word]!==after.traces[checkpoint].words[word]){
  assert.equal(word,16,'only the corrected English message may change the historical knowledge-screen hash');
  differences.push({checkpoint,word,before:before.traces[checkpoint].words[word],after:after.traces[checkpoint].words[word]});
 }
}
audit.status={before_row:old.cells.slice(0,80),after_row:fixed.cells.slice(0,80),original_differences:differences,reference_checkpoints:after.traces.length};
audit.checks.push('status: all 20 words equal catalog-only reference; original difference only message-screen hash; other raw C rows equal');

for(const [fixture,prefix,expected,suffix] of [
 ['bug-identify-empty-potion','rb','command','h'],
 ['bug-identify-potion','rg','item','\x1bh'],
 ['bug-naming','i qf','text','\x1bh'],
]){
 const saved=await runGame('build/playthrough-before.js',{fixture,seed:17,name:'BugAudit',messagePaging:'log',events:[...textEvents(prefix),SAVE_EVENT]});
 assert.equal(saved.stores.length,1);
 const restored=await runGame('build/game-fixtures.js',{fixture,restore:saved.stores[0],messagePaging:'log'});
 assert.deepEqual(restored.stderr,[]);
 assert.equal(restored.input_contexts.at(-1).input.kind,expected);
 const continued=await runGame('build/game-fixtures.js',{fixture,restore:saved.stores[0],messagePaging:'log',text:suffix});
 assert.deepEqual(continued.stderr,[]);
 assert.equal(continued.input_contexts.at(-1).input.kind,'command');
 audit.checks.push('old save restored and continued: '+fixture);
}
audit.files=await Promise.all(['build/game.wasm','build/playthrough-before.wasm','build/playthrough-catalog-reference.wasm','tools/generate_catalog.py'].map(async file=>({file,sha256:sha(await readFile(file))})));
audit.result='pass';
await writeFile(directory+'reference-audit.json',JSON.stringify(audit,null,2)+'\n');
console.log('PASS independent pre-fix C reference provenance, status text and 3 legacy-save continuations');

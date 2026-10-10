import { artifactDirectory } from "../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGame, SAVE_EVENT } from './run-game.mjs';
// Capture a reviewed pre-migration build before rebuilding. It is deliberately
// outside Git. Set ROGUE_PRE_BEVY to that directory when repeating this audit.
const root=fileURLToPath(new URL('../',import.meta.url));
const output=artifactDirectory(process.env.ROGUE_MIGRATION_OUTPUT||path.join(root,'tests/browser-smoke/output/bevy'));
const before=process.env.ROGUE_PRE_BEVY||path.join(output,'before/build');
await mkdir(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const evidence={started_at:new Date().toISOString(),comparisons:[],saveMigrations:[],files:[]};
for(const dir of [before,path.join(root,'build')]) for(const name of ['game','game-fixtures']) {
 for(const ext of ['js','wasm']) evidence.files.push({file:path.join(dir,name+'.'+ext),sha256:hash(await readFile(path.join(dir,name+'.'+ext)))});
}
// Ignore only added engine diagnostics and the raw-result transport hash.
const frames=values=>values.map(({engine,sha256,...frame})=>frame);
async function compare(label,config,fixture=false) {
 const name=fixture?'game-fixtures.js':'game.js';
 const expected=await runGame(path.join(before,name),config);
 const actual=await runGame(path.join(root,'build',name),config);
 for(const key of ['code','consumed','traces','final','reads','flushes','messages','input_contexts','outcomes','stores']) assert.deepEqual(actual[key],expected[key],label+' '+key);
 assert.deepEqual(frames(actual.frames),frames(expected.frames),label+' all UI, original cells, map tiles and cached repaints');
 assert.ok(actual.frames.length>0,label+' exercises actual frames');
 for(const f of actual.frames) assert.deepEqual(f.engine,{name:'Bevy',version:'0.19.1',renderer:'browser-canvas'});
 evidence.comparisons.push({label,config,checkpoints:actual.traces.length,repaints:actual.repaint_pure||0,frames:actual.frames.length});
 await writeFile(path.join(output,label+'-before.json'),JSON.stringify(expected));
 await writeFile(path.join(output,label+'-after.json'),JSON.stringify(actual));
}
try {
 const commands=[['inventory','i\r.'],['help','?*\x1b?i.'],['options','o\x1b.'],['candidates','q\x1bw\x1br\x1be\x1bW\x1bP\x1bd\x1bt\x1bz\x1bI\x1b.'],['lists','w* \x1b.'],['rename','ccAudit\nIci .'],['slow','o'+'\n'.repeat(6)+'s\x1bi\r\r\x1b.'],['quit','Qy\n']];
 for(const locale of ['en','ja']) for(const [label,text] of commands) await compare(locale+'-'+label,{seed:17,locale,text,messagePaging:'log',repaint:40});
 for(const seed of [1,2,7,31,257,12345,65537]) await compare('movement-'+seed,{seed,locale:'ja',text:'hljkyubn'.repeat(4)+'2.3s',messagePaging:'log',repaint:40});
 for(const [label,fixture,text] of [['hall-inventory','hallucination','i .'],['hall-candidates','hallucination','q\x1bw* \x1br\x1be\x1b.'],['hall-slow','hallucination','o'+'\n'.repeat(6)+'s\x1bi  \x1b.'],['combat','combat','lll'],['identify','item-identify','rf*\x1b'],['death','ending-death','\n\n'],['no-tomb','ending-no-tomb','\n\n'],['victory','ending-victory',' \n\n']]) await compare(label,{fixture,seed:17,locale:'ja',text,messagePaging:'log',repaint:40},true);
 await compare('unicode-name',{seed:17,name:'勇者🗡',locale:'ja',events:Array.from('cc日本語🗡\nIci\r.',c=>c.codePointAt(0)),messagePaging:'log',repaint:40});
 for(const [label,prefix,suffix] of [['inventory','.i','\r.'],['item','.w','d.'],['text','cc勇者','🗡\n.']]) {
  const events=s=>Array.from(s,c=>c.codePointAt(0));
  await compare('save-'+label,{seed:17,locale:'ja',messagePaging:'log',events:[...events(prefix),SAVE_EVENT,...events(suffix)],repaint:40});
 }
 for(const [label,prefix,suffix] of [['inventory','.i','\r.'],['item','.w','d.'],['text','cc勇者','🗡\n.']]) {
  const events=s=>Array.from(s,c=>c.codePointAt(0));
  const old=await runGame(path.join(before,'game.js'),{seed:17,locale:'ja',messagePaging:'log',events:[...events(prefix),SAVE_EVENT,...events(suffix)]});
  assert.equal(old.stores.length,1); const saved=JSON.parse(old.stores[0]);
  const base=saved.input_index-saved.inputs.length,index=old.traces.findIndex(t=>t.input_index===base);assert.notEqual(index,-1);
  const current=await runGame(path.join(root,'build/game.js'),{restore:old.stores[0],seed:999,locale:'ja',messagePaging:'log',events:events(suffix)});
  assert.deepEqual(current.traces,old.traces.slice(index),label+' continued old save C/RNG');
  assert.deepEqual(current.final,old.final,label+' continued old save final state');
  evidence.saveMigrations.push({label,checkpoints:current.traces.length});
 }
 evidence.passed=true;
 console.log(JSON.stringify({passed:true,comparisons:evidence.comparisons.length,checkpoints:evidence.comparisons.reduce((s,c)=>s+c.checkpoints,0),repaints:evidence.comparisons.reduce((s,c)=>s+c.repaints,0),saveMigrations:evidence.saveMigrations.length}));
} catch(error){evidence.passed=false;evidence.failure=error.stack;throw error;}
finally {evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,'migration-evidence.json'),JSON.stringify(evidence,null,2)+'\n');}

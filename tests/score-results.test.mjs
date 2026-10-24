// Final score observations preserve C rules and are distinct from save/restore.
import {runGame,originalFrames,SAVE_EVENT} from './run-game.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const output=process.env.ROGUE_SCORE_REPORT||path.join(root,'.local/rankings-20261024/c-results.json');
const baselinePath=process.env.ROGUE_SCORE_BASELINE||path.join(root,'.local/rankings-20261024/c-baseline.json');
const module=path.join(root,'build/game-fixtures.wasm');
const cases=[
 {id:'quit',fixture:'plain',events:[81,121],flags:1,amount:0},
 {id:'death',fixture:'ending-death',events:[13,13],flags:0,amount:111},
 {id:'winner',fixture:'ending-victory',events:[32,13],flags:2,amount:603},
 {id:'cancel',fixture:'plain',events:[81,110],none:true},
 {id:'save',fixture:'plain',events:[SAVE_EVENT],none:true},
];
const capture=async specification=>{
 const result=await runGame(module,{fixture:specification.fixture,seed:17,name:'Scores',locale:'ja',messagePaging:'log',events:specification.events});
 const lines=[...result.frames,...result.presentations].flatMap(frame=>frame.ui?.lines||[]);
 const entry=lines.find(line=>line.id==='ui.score.entry'||line.id==='ui.score.entry_death');
 return {code:result.code,consumed:result.consumed,traces:result.traces,frames:originalFrames(result.frames),records:result.host_events.filter(event=>event.type==='score-result'),awarded:specification.amount??entry?.args?.[1]?.value,module:result.module};
};
await mkdir(path.dirname(output),{recursive:true});
if(process.argv.includes('--baseline')){
 const baseline={};for(const specification of cases)baseline[specification.id]=await capture(specification);
 await writeFile(baselinePath,JSON.stringify(baseline,null,2));console.log('Saved original score/C baseline: '+baselinePath);
}else{
 const raw=await readFile(baselinePath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 const baseline=raw?JSON.parse(raw):null,report={comparedBaseline:!!baseline,cases:[],errors:[]};
 for(const specification of cases){
  const result=await capture(specification),previous=baseline?.[specification.id];report.cases.push({id:specification.id,...result});
  try{
   if(previous){assert.deepEqual(result.traces,previous.traces,'Score observations cannot consume C input or RNG');assert.deepEqual(result.frames,previous.frames,'Score observations cannot change C frames');}
   if(specification.none){assert.equal(result.records.length,0);}
   else {assert.equal(result.records.length,1,'A finalized original score emits exactly one result');const score=result.records[0];assert.equal(score.score,previous?.awarded??specification.amount);assert.equal(score.flags,specification.flags);assert.equal(score.name,'Scores');assert.equal(score.eligible,true);assert.ok(score.level>=1);}
  }catch(error){report.errors.push({id:specification.id,error:error.stack});}
 }
 await writeFile(output,JSON.stringify(report,null,2));
 for(const row of report.cases)console.log(row.id+': score records='+row.records.length+' code='+row.code);
 if(report.errors.length){for(const error of report.errors)console.error(error.id+': '+error.error);process.exitCode=1;}
}

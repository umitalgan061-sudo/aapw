import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlayerLocomotionStateIntent } from '../src/3d/gameplay/playerLocomotionStateSynthesis.js';
import { createPlayerLocomotionStateRuntimeController } from '../src/3d/gameplay/playerLocomotionStateRuntime.js';
import { resolvePlayerLocomotionStateQualityReport } from '../src/3d/gameplay/playerLocomotionStateQuality.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const fixtureDir=path.join(here,'../src/3d/gameplay/fixtures');
function num(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function bool(value){return value===true||value===1||value==='1';}
function parseRow(row,index){
  const fields=row.split(',').map(item=>item.trim());
  assert.ok(fields.length>=10,`row-${index}-fields`);
  return {
    planarSpeedMps:num(fields[1]),
    turnRateDegreesPerSecond:num(fields[2]),
    slopeDegrees:num(fields[3]),
    surfaceSlip:num(fields[4]),
    surfaceConfidence:num(fields[5]),
    grounded:bool(fields[6]),
    airTimeSeconds:num(fields[7]),
    landingImpactMps:num(fields[8]),
    traversalWeight:num(fields[9]),
  };
}
function readCsv(name){
  const file=fs.readFileSync(path.join(fixtureDir,name),'utf8').trim();
  const lines=file.split(/\r?\n/).filter(Boolean);
  assert.ok(lines[0].startsWith('id,'),`${name}:header`);
  return lines.slice(1).map(parseRow);
}
function readJsonl(name){
  const file=fs.readFileSync(path.join(fixtureDir,name),'utf8').trim();
  return file.split(/\r?\n/).filter(Boolean).map((line,index)=>{
    const item=JSON.parse(line);
    assert.equal(typeof item.id,'string',`${name}:${index}:id`);
    return {
      planarSpeedMps:num(item.speed),
      turnRateDegreesPerSecond:num(item.turn),
      slopeDegrees:num(item.slope),
      surfaceSlip:num(item.slip),
      surfaceConfidence:num(item.surface),
      grounded:item.grounded!==false,
      airTimeSeconds:num(item.air),
      landingImpactMps:num(item.impact),
      traversalWeight:num(item.traversal),
    };
  });
}
const corpora=[
  ['playerLocomotionStateCorpusA.jsonl',readJsonl],
  ['playerLocomotionStateCorpusB.jsonl',readJsonl],
  ['playerLocomotionStateCorpusC.csv',readCsv],
  ['playerLocomotionStateCorpusD.csv',readCsv],
  ['playerLocomotionStateCorpusE.csv',readCsv],
];
let total=0;
for(const [name,reader] of corpora){
  const rows=reader(name);
  assert.ok(rows.length>=100,`${name}:coverage`);
  for(let index=0;index<rows.length;index+=1){
    const input=rows[index];
    const intent=resolvePlayerLocomotionStateIntent({velocity:{x:0,y:1},facing:{x:0,y:1},deltaSeconds:1/60,...input});
    assert.equal(intent.validation.ok,true,`${name}:${index}:intent`);
    const report=resolvePlayerLocomotionStateQualityReport(intent,{progress:index%10/10,easedProgress:index%10/10,durationSeconds:0.16,cues:[]});
    assert.ok(report.score>=0&&report.score<=1,`${name}:${index}:quality`);
    total+=1;
  }
}
const runtime=createPlayerLocomotionStateRuntimeController({maxTelemetrySamples:96});
for(let index=0;index<total;index+=1){
  const speed=(index%120)/10;
  const result=runtime.update({planarSpeedMps:speed,turnRateDegreesPerSecond:(index%12)*45,slopeDegrees:(index%21)*4-40,surfaceSlip:(index%17)/16,surfaceConfidence:0.55+(index%8)/20,grounded:index%23!==0,airTimeSeconds:index%23===0?0.3:0,landingImpactMps:index%29===0?5.4:0,traversalWeight:index%11===0?0.9:0,traversalForwardDistance:index%11===0?3.1:1,traversalBlocked:index%31===0});
  assert.equal(result.validation.ok,true,`runtime:${index}`);
}
assert.equal(runtime.telemetry().length,Math.min(total,96));
console.log(`PLAYER_LOCOMOTION_STATE_FIXTURES_PASS:${total}`);

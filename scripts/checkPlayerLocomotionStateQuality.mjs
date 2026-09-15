import assert from 'node:assert/strict';
import { createPlayerLocomotionStateRuntimeController } from '../src/3d/gameplay/playerLocomotionStateRuntime.js';
import { resolvePlayerLocomotionStateQualityReport, summarizePlayerLocomotionStateQualityReports, comparePlayerLocomotionStateQualityRuns, classifyPlayerLocomotionStateQuality } from '../src/3d/gameplay/playerLocomotionStateQuality.js';

function base(overrides={}){return {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3,turnRateDegreesPerSecond:0,slopeDegrees:0,deltaSeconds:1/60,surfaceConfidence:1,surfaceSlip:0,grounded:true,airTimeSeconds:0,landingImpactMps:0,traversalWeight:0,...overrides};}
function assertRange(value,label){assert.ok(Number.isFinite(value),`${label}:finite`);assert.ok(value>=0&&value<=1,`${label}:range`);}

const controller=createPlayerLocomotionStateRuntimeController({maxTelemetrySamples:96});
const reports=[];
for(let index=0;index<320;index+=1){
  const result=controller.update(base({
    planarSpeedMps:(index%97)/10,
    turnRateDegreesPerSecond:(index*61)%541,
    slopeDegrees:(index*13)%111-55,
    surfaceConfidence:index%17===0?0.22:0.96,
    surfaceSlip:index%11===0?0.91:0.10,
    grounded:index%23!==0,
    airTimeSeconds:index%23===0?0.3:0,
    landingImpactMps:index%19===0?5.6:0,
    traversalWeight:index%7===0?0.88:0.08,
    traversalForwardDistance:index%7===0?3.4:0.9,
    traversalBlocked:index%37===0,
    guarding:index%43===0,
    attackKind:index%47===0?'heavy':undefined,
    dodgeRemaining:index%53===0?0.2:0,
    hitStaggerRemaining:index%59===0?0.2:0,
  }));
  assert.equal(result.validation.ok,true,`runtime-${index}`);
  const report=resolvePlayerLocomotionStateQualityReport(result.intent,result.timelineSample,index?result.state.previousIntent:null,true);
  reports.push(report);
  assertRange(report.score,`score-${index}`);
  assert.ok(['weak','warning','acceptable','strong','excellent'].includes(report.grade),`grade-${index}`);
}
const summary=summarizePlayerLocomotionStateQualityReports(reports);
assert.equal(summary.count,320);
assert.ok(summary.minimumScore>=0&&summary.maximumScore<=1);
assert.equal(summary.flaggedCount>=0,true);
const clone=reports.map(item=>({version:item.version,axes:{...item.axes},score:item.score,grade:item.grade,flags:[...item.flags]}));
assert.equal(comparePlayerLocomotionStateQualityRuns(reports,clone).deterministic,true);

const hostileReports=[];
for(let index=0;index<180;index+=1){
  const result=controller.update(base({
    planarSpeedMps:index%13===0?Infinity:index%12,
    turnRateDegreesPerSecond:index%17===0?Infinity:(index%10)*55,
    slopeDegrees:index%19===0?Infinity:(index%21)*4-40,
    surfaceConfidence:index%7===0?NaN:0.35+(index%7)/10,
    surfaceSlip:index%5===0?1:(index%8)/8,
    grounded:index%3!==0,
    airTimeSeconds:index%3===0?Infinity:0,
    landingImpactMps:index%11===0?Infinity:0,
    traversalWeight:index%4===0?1:0,
    traversalBlocked:index%9===0,
  }));
  assert.equal(result.validation.ok,true,`hostile-runtime-${index}`);
  const report=resolvePlayerLocomotionStateQualityReport(result.intent,result.timelineSample,true);
  hostileReports.push(report);
  assertRange(report.score,`hostile-score-${index}`);
}
assert.equal(summarizePlayerLocomotionStateQualityReports(hostileReports).count,180);
for(const score of [0,0.2,0.71,0.72,0.83,0.84,0.92,0.93,0.99,1])assert.ok(['weak','warning','acceptable','strong','excellent'].includes(classifyPlayerLocomotionStateQuality(score)));

const directional=[];
for(let index=0;index<160;index+=1){
  const angle=-Math.PI+index*Math.PI/80;
  const result=controller.update(base({planarSpeedMps:2+(index%60)/10,velocity:{x:Math.sin(angle),y:Math.cos(angle)},facing:{x:Math.cos(angle),y:Math.sin(angle)},turnRateDegreesPerSecond:(index%12)*45,surfaceSlip:(index%9)/10}));
  assert.equal(result.validation.ok,true,`directional-${index}`);
  directional.push(resolvePlayerLocomotionStateQualityReport(result.intent,result.timelineSample,true));
}
const directionalSummary=summarizePlayerLocomotionStateQualityReports(directional);
assert.equal(directionalSummary.count,160);
assert.ok(directionalSummary.averageScore>=0&&directionalSummary.averageScore<=1);
console.log(`PLAYER_LOCOMOTION_STATE_QUALITY_PASS:${reports.length+hostileReports.length+directional.length}`);

import assert from 'node:assert/strict';
import {
  createSettlementWorldCoverageContinuityTelemetry,
  appendSettlementWorldCoverageContinuityTelemetrySample,
  validateSettlementWorldCoverageContinuityTelemetry,
  summarizeSettlementWorldCoverageContinuityTelemetry,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityTelemetry.js';

const options={
  settlement:{id:'winterfell-edge',regionId:'the-north',anchor:{x:512,y:0,z:768},entrance:{x:518,y:0,z:768},services:['gate','market','tavern']},
  player:{position:{x:545,y:0,z:768},inSettlement:false},
  surface:{biome:'north-temperate',layer:'road',slopeDegrees:2},
  seed:77,hour:15,weather:{type:'clear'},roadClass:'gateway',
};
const telemetry=createSettlementWorldCoverageContinuityTelemetry(options,[
  {sequence:1,id:'prior:approach:1',type:'approach',stage:'approach',metadata:{road:'gateway'}},
]);
const next=appendSettlementWorldCoverageContinuityTelemetrySample(telemetry,{...options,hour:16});
const check=validateSettlementWorldCoverageContinuityTelemetry(next);
const summary=summarizeSettlementWorldCoverageContinuityTelemetry(next);

assert.equal(check.ok,true,check.errors.join(','));
assert.ok(next.sampleCount<=24);
assert.ok(next.events.length<=24);
assert.ok(next.eventTypes.includes('approach'));
assert.ok(next.latest.sequence>=2);
assert.ok(['low','medium','high'].includes(next.readinessBand));
assert.equal(next.ownership.readOnly,true);
assert.equal(next.ownership.noGameplayMutation,true);
assert.equal(typeof next.fingerprint,'string');
assert.equal(summary.settlementId,'winterfell-edge');
assert.equal(summary.latest.sequence,next.latest.sequence);

const replay=createSettlementWorldCoverageContinuityTelemetry(options,[
  {sequence:1,id:'prior:approach:1',type:'approach',stage:'approach',metadata:{road:'gateway'}},
]);
assert.equal(telemetry.fingerprint,replay.fingerprint);
console.log('Settlement World Coverage Continuity Telemetry: PASS');
console.log(JSON.stringify({ok:true,samples:next.sampleCount,stage:next.stage,latest:next.latest.type,fingerprint:next.fingerprint}));

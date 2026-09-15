import assert from 'node:assert/strict';
import { createPlayerLocomotionStateRuntimeController } from '../src/3d/gameplay/playerLocomotionStateRuntime.js';
import { resolvePlayerLocomotionStateQualityReport } from '../src/3d/gameplay/playerLocomotionStateQuality.js';
import { createPlayerLocomotionStateReplayController } from '../src/3d/gameplay/playerLocomotionStateReplay.js';
import { validatePlayerLocomotionStateTimelineSample } from '../src/3d/gameplay/playerLocomotionStateTimeline.js';

function sample(index){
  return {
    velocity:{x:Math.sin(index/11),y:Math.cos(index/17)},
    facing:{x:Math.cos(index/19),y:Math.sin(index/23)},
    planarSpeedMps:(index%100)/12,
    turnRateDegreesPerSecond:(index*47)%541,
    slopeDegrees:(index*9)%111-55,
    deltaSeconds:1/60,
    surfaceConfidence:index%13===0?0.28:0.95,
    surfaceSlip:index%11===0?0.84:0.08,
    grounded:index%19!==0,
    airTimeSeconds:index%19===0?0.3:0,
    landingImpactMps:index%29===0?5.6:0,
    traversalWeight:index%7===0?0.9:0.1,
    traversalForwardDistance:index%7===0?3.2:0.8,
    traversalHeight:index%8===0?0.5:0,
    traversalBlocked:index%31===0,
    guarding:index%37===0,
    attackKind:index%41===0?'heavy':'',
    dodgeRemaining:index%43===0?0.2:0,
    hitStaggerRemaining:index%47===0?0.2:0,
  };
}

const runtime=createPlayerLocomotionStateRuntimeController({maxTelemetrySamples:128});
const replay=createPlayerLocomotionStateReplayController();
let previous=null;
for(let index=0;index<240;index+=1){
  const input=sample(index);
  const runtimeResult=runtime.update(input);
  const replayResult=replay.update(input);
  assert.equal(runtimeResult.validation.ok,true,`runtime-${index}`);
  assert.equal(replayResult.intent.validation.ok,true,`replay-${index}`);
  assert.equal(runtimeResult.intent.state,replayResult.intent.state,`state-${index}`);
  assert.equal(runtimeResult.intent.event.type,replayResult.intent.event.type,`event-${index}`);
  assert.equal(runtimeResult.intent.direction.selected,replayResult.intent.direction.selected,`direction-${index}`);
  assert.equal(validatePlayerLocomotionStateTimelineSample(runtimeResult.timelineSample).ok,true,`timeline-${index}`);
  const quality=resolvePlayerLocomotionStateQualityReport(runtimeResult.intent,runtimeResult.timelineSample,previous,true);
  assert.ok(quality.score>=0&&quality.score<=1,`quality-${index}`);
  previous=runtimeResult.intent;
}
assert.equal(runtime.telemetry().length,128);
assert.equal(replay.read().count,240);
const last=runtime.read();
assert.ok(last.frame>=240);
assert.ok(last.state.length>0);
assert.ok(last.direction.length>0);

runtime.reset();
replay.reset();
assert.equal(runtime.read().frame,0);
assert.equal(replay.read().count,0);
for(let index=0;index<80;index+=1){
  const input=sample(index+400);
  const a=runtime.update(input);
  const b=replay.update(input);
  assert.equal(a.intent.state,b.intent.state,`reset-state-${index}`);
  assert.equal(a.intent.event.type,b.intent.event.type,`reset-event-${index}`);
}
assert.equal(runtime.read().frame,80);
assert.equal(replay.read().count,80);
console.log('PLAYER_LOCOMOTION_STATE_INTEGRATION_PASS');

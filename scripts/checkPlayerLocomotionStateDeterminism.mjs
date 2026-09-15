import assert from 'node:assert/strict';
import { createPlayerLocomotionStateRuntimeController } from '../src/3d/gameplay/playerLocomotionStateRuntime.js';

function build(index){
  return {
    velocity:{x:Math.sin(index/7),y:Math.cos(index/11)},
    facing:{x:Math.cos(index/13),y:Math.sin(index/17)},
    planarSpeedMps:(index%121)/10,
    turnRateDegreesPerSecond:(index*59)%541,
    slopeDegrees:(index*5)%111-55,
    deltaSeconds:1/60,
    surfaceConfidence:index%17===0?0.3:0.94,
    surfaceSlip:index%13===0?0.8:0.1,
    grounded:index%19!==0,
    airTimeSeconds:index%19===0?0.3:0,
    landingImpactMps:index%29===0?5.5:0,
    traversalWeight:index%11===0?0.9:0,
    traversalForwardDistance:index%11===0?3.3:1,
    traversalHeight:index%23===0?0.6:0,
    traversalBlocked:index%31===0,
    guarding:index%37===0,
    attackKind:index%41===0?'heavy':'',
    dodgeRemaining:index%43===0?0.2:0,
    hitStaggerRemaining:index%47===0?0.2:0,
    rootMotionAllowed:index%3!==0,
  };
}
function run(){
  const controller=createPlayerLocomotionStateRuntimeController({maxTelemetrySamples:128});
  const fingerprints=[];
  for(let index=0;index<420;index+=1){
    const result=controller.update(build(index));
    assert.equal(result.validation.ok,true,`validation-${index}`);
    fingerprints.push(`${result.intent.state}|${result.intent.event.type}|${result.intent.direction.selected}|${result.state.phase}|${result.timelineSample.progress}`);
  }
  return fingerprints;
}
const first=run();
const second=run();
assert.equal(first.length,420);
assert.deepEqual(first,second);
for(let index=1;index<first.length;index+=1){
  assert.equal(typeof first[index],'string');
  assert.ok(first[index].includes('|'));
}
console.log('PLAYER_LOCOMOTION_STATE_DETERMINISM_PASS:420');

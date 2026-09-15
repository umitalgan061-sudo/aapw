import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_TEMPORAL_TUNING_VERSION,
  PLAYER_LOCOMOTION_TEMPORAL_TUNING,
  listPlayerLocomotionTemporalModes,
  resolvePlayerLocomotionTemporalTuning,
  resolvePlayerLocomotionEnvironmentModifier,
  resolvePlayerLocomotionTemporalWindow,
  resolvePlayerLocomotionTemporalSample,
  resolvePlayerLocomotionTemporalVelocity,
  resolvePlayerLocomotionTemporalNextWeight,
  resolvePlayerLocomotionTemporalInterruptibility,
  resolvePlayerLocomotionTemporalStack,
  validatePlayerLocomotionTemporalTuning,
  auditPlayerLocomotionTemporalTuning,
} from '../src/3d/gameplay/playerLocomotionTemporalTuning.js';

assert.equal(PLAYER_LOCOMOTION_TEMPORAL_TUNING_VERSION,'2026-09-15-v1');
assert.equal(auditPlayerLocomotionTemporalTuning().valid,true);
assert.equal(Object.keys(PLAYER_LOCOMOTION_TEMPORAL_TUNING).length,16);
assert.equal(listPlayerLocomotionTemporalModes().length,16);

for(const mode of listPlayerLocomotionTemporalModes()){
  const tuning=resolvePlayerLocomotionTemporalTuning(mode);
  assert.equal(validatePlayerLocomotionTemporalTuning(tuning).ok,true);
  assert.equal(Object.isFrozen(tuning),true);
  for(const env of ['clear','soft','slippery','steep','unstable']){
    const modifier=resolvePlayerLocomotionEnvironmentModifier(env);
    assert.equal(Object.isFrozen(modifier),true);
    const window=resolvePlayerLocomotionTemporalWindow('cruise',mode,{environment:env,confidence:0.8,groundRisk:0.3,speedDeltaMps:-2});
    assert.ok(window>=0.04&&window<=0.46);
    for(const elapsed of [0,window*0.25,window*0.5,window*0.75,window,window*2]){
      const value=resolvePlayerLocomotionTemporalSample({elapsedSeconds:elapsed,windowSeconds:window,mode,confidence:0.8,directionWeight:0.7});
      assert.ok(value.progress>=0&&value.progress<=1);
      assert.ok(value.rawProgress>=0&&value.rawProgress<=1);
    }
  }
}

for(let index=0;index<300;index+=1){
  const mode=listPlayerLocomotionTemporalModes()[index%16];
  const env=['clear','soft','slippery','steep','unstable'][index%5];
  const previous=(index%10)/10; const target=((index*3)%11)/10;
  const velocity=resolvePlayerLocomotionTemporalVelocity({previousWeight:previous,targetWeight:target,deltaSeconds:0.016+index%4/100,mode,environment:env});
  assert.ok(velocity>=-0.22&&velocity<=0.22);
  const next=resolvePlayerLocomotionTemporalNextWeight({previousWeight:previous,targetWeight:target,deltaSeconds:0.016,mode,environment:env});
  assert.ok(next>=0&&next<=1);
  const interrupt=resolvePlayerLocomotionTemporalInterruptibility('cruise',mode,{groundRisk:(index%11)/10});
  assert.ok(interrupt.lockSeconds>=0.04&&interrupt.lockSeconds<=0.42);
  assert.ok(interrupt.priority>=0&&interrupt.priority<=1);
}

const stack=resolvePlayerLocomotionTemporalStack([
  {mode:'cruise',weight:1,priority:0.5},
  {mode:'pivot',weight:0.5,priority:1},
  {mode:'brake',weight:0.25,priority:0.8},
]);
assert.equal(stack.length,3);assert.equal(stack[0].mode,'pivot');assert.ok(Math.abs(stack.reduce((s,x)=>s+x.normalizedWeight,0)-1)<0.001);
assert.deepEqual(resolvePlayerLocomotionTemporalStack([]),[]);

const deterministicA=listPlayerLocomotionTemporalModes().map((mode)=>resolvePlayerLocomotionTemporalTuning(mode));
const deterministicB=listPlayerLocomotionTemporalModes().map((mode)=>resolvePlayerLocomotionTemporalTuning(mode));
assert.deepEqual(deterministicA,deterministicB);
console.log('PLAYER_LOCOMOTION_TEMPORAL_TUNING_PASS');

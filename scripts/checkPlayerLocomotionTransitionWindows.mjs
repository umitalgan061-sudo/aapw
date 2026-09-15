import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_MODES,
  resolvePlayerLocomotionTransitionWindow,
  classifyPlayerLocomotionTransition,
  resolvePlayerLocomotionTransitionEasing,
  resolvePlayerLocomotionTransitionProgress,
  resolvePlayerLocomotionTransitionEnvelope,
  resolvePlayerLocomotionTransitionSample,
  resolvePlayerLocomotionTransitionHistory,
  validatePlayerLocomotionTransitionEnvelope,
  createPlayerLocomotionTransitionController,
  auditPlayerLocomotionTransitionWindows,
} from '../src/3d/gameplay/playerLocomotionTransitionWindows.js';

assert.equal(auditPlayerLocomotionTransitionWindows().valid, true);
assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_MODES.includes('pivot'), true);
assert.equal(classifyPlayerLocomotionTransition('idle','start'),'acceleration');
assert.equal(classifyPlayerLocomotionTransition('cruise','brake'),'deceleration');
assert.equal(classifyPlayerLocomotionTransition('cruise','pivot'),'pivot');
assert.equal(classifyPlayerLocomotionTransition('dodge-recover','cruise'),'recovery');
assert.equal(classifyPlayerLocomotionTransition('guard-walk','combat-advance'),'combat');
assert.equal(classifyPlayerLocomotionTransition('cruise','cruise'),'steady');

for(let index=0;index<120;index+=1){
  const from=PLAYER_LOCOMOTION_ANTICIPATION_MODES[index%PLAYER_LOCOMOTION_ANTICIPATION_MODES.length];
  const to=PLAYER_LOCOMOTION_ANTICIPATION_MODES[(index*7)%PLAYER_LOCOMOTION_ANTICIPATION_MODES.length];
  const duration=resolvePlayerLocomotionTransitionWindow(from,to,{speedDeltaMps:(index%17)-8,turnWeight:(index%10)/10,surfaceSlip:(index%8)/8,confidence:(index%11)/10});
  assert.ok(duration>=0.04&&duration<=0.42);
  const kind=classifyPlayerLocomotionTransition(from,to);
  assert.ok(resolvePlayerLocomotionTransitionEasing(kind)>=0.2);
  assert.ok(resolvePlayerLocomotionTransitionEasing(kind)<=0.85);
  const envelope=resolvePlayerLocomotionTransitionEnvelope(from,to,{surfaceSlip:index%5/5,groundRisk:index%7/7});
  assert.equal(validatePlayerLocomotionTransitionEnvelope(envelope).ok,true);
  assert.equal(Object.isFrozen(envelope),true);
  for(const elapsed of [0,duration/4,duration/2,duration*0.75,duration,duration*2]){
    const sample=resolvePlayerLocomotionTransitionSample(envelope,elapsed);
    assert.ok(sample.progress>=0&&sample.progress<=1);
    assert.ok(sample.fromWeight>=0&&sample.fromWeight<=1);
    assert.ok(sample.toWeight>=0&&sample.toWeight<=1);
  }
}

for(let value=-1;value<=2;value+=0.05){const progress=resolvePlayerLocomotionTransitionProgress(value,0.1);assert.ok(progress>=0&&progress<=1);}
let history=[];for(let index=0;index<100;index+=1){history=resolvePlayerLocomotionTransitionHistory(history,{index});assert.ok(history.length<=20);}assert.equal(history.length,20);

const seen=[];const controller=createPlayerLocomotionTransitionController({onTransition:(envelope)=>seen.push(`${envelope.from}->${envelope.to}`)});
for(let index=0;index<80;index+=1){const mode=PLAYER_LOCOMOTION_ANTICIPATION_MODES[index%PLAYER_LOCOMOTION_ANTICIPATION_MODES.length];const result=controller.update(mode,1/30,{surfaceSlip:index%4/4,groundRisk:index%5/5});assert.ok(result.sample.progress>=0&&result.sample.progress<=1);}
assert.ok(seen.length>1);assert.ok(controller.read().history.length<=20);controller.reset();assert.equal(controller.read().mode,'idle');

const hostile=resolvePlayerLocomotionTransitionEnvelope('not-a-mode','also-not',{surfaceSlip:Infinity,groundRisk:NaN});
assert.equal(validatePlayerLocomotionTransitionEnvelope(hostile).ok,false);
const safe=resolvePlayerLocomotionTransitionEnvelope('idle','start',{surfaceSlip:Infinity,groundRisk:Infinity});
assert.equal(validatePlayerLocomotionTransitionEnvelope(safe).ok,true);
console.log('PLAYER_LOCOMOTION_TRANSITION_WINDOWS_PASS');

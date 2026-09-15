import assert from 'node:assert/strict';
import { createPlayerLocomotionStateReplayController, replayPlayerLocomotionStateInputs, diffPlayerLocomotionStateReplayResults, branchPlayerLocomotionStateReplay, validatePlayerLocomotionStateReplay, summarizePlayerLocomotionStateReplay } from '../src/3d/gameplay/playerLocomotionStateReplay.js';

function input(index){
  return {
    velocity:{x:Math.sin(index/13),y:Math.cos(index/17)},
    facing:{x:Math.cos(index/19),y:Math.sin(index/23)},
    planarSpeedMps:(index%97)/10,
    turnRateDegreesPerSecond:(index*43)%541,
    slopeDegrees:(index*7)%111-55,
    deltaSeconds:1/60,
    surfaceConfidence:index%13===0?0.25:0.94,
    surfaceSlip:index%11===0?0.82:0.1,
    grounded:index%17!==0,
    airTimeSeconds:index%17===0?0.25:0,
    landingImpactMps:index%23===0?5.5:0,
    traversalWeight:index%9===0?0.9:0,
    traversalForwardDistance:index%9===0?3.4:1,
    traversalBlocked:index%31===0,
    guarding:index%37===0,
    attackKind:index%41===0?'heavy':'',
    dodgeRemaining:index%47===0?0.2:0,
    hitStaggerRemaining:index%53===0?0.2:0,
  };
}
const inputs=Array.from({length:320},(_,index)=>input(index));
const first=replayPlayerLocomotionStateInputs(inputs);
const second=replayPlayerLocomotionStateInputs(inputs);
assert.equal(first.results.length,320);
assert.equal(second.results.length,320);
assert.equal(validatePlayerLocomotionStateReplay(first.state).ok,true);
assert.equal(validatePlayerLocomotionStateReplay(second.state).ok,true);
assert.equal(diffPlayerLocomotionStateReplayResults(first.results,second.results).deterministic,true);
const summary=summarizePlayerLocomotionStateReplay(first.state);
assert.equal(summary.count,320);
assert.ok(summary.averageConfidence>=0&&summary.averageConfidence<=1);
assert.ok(summary.averageQuality>=0&&summary.averageQuality<=1);

const controller=createPlayerLocomotionStateReplayController();
for(let index=0;index<120;index+=1){
  const result=controller.update(input(index),index%2===0?'fresh':'compare');
  assert.ok(result.intent.validation.ok,`controller-${index}`);
  assert.ok(result.quality.score>=0&&result.quality.score<=1);
}
const checkpoint=controller.snapshot();
const branch=branchPlayerLocomotionStateReplay(checkpoint,60);
assert.equal(branch.frame,60);
assert.equal(branch.intents.length,60);
assert.equal(branch.timeline.length,60);
assert.equal(branch.telemetry.length,60);
assert.equal(branch.quality.length,60);

const malformed=[];
for(let index=0;index<72;index+=1){
  malformed.push({
    planarSpeedMps:index%3===0?Infinity:-Infinity,
    turnRateDegreesPerSecond:index%4===0?NaN:540+index,
    slopeDegrees:index%5===0?Infinity:-70-index,
    surfaceConfidence:index%2===0?NaN:-1,
    surfaceSlip:index%7===0?Infinity:2,
    grounded:index%3!==0,
    airTimeSeconds:index%3===0?Infinity:-2,
    landingImpactMps:index%5===0?Infinity:-3,
    traversalWeight:index%4===0?Infinity:-1,
    traversalForwardDistance:index%6===0?Infinity:-4,
    traversalHeight:index%8===0?Infinity:-5,
    traversalBlocked:index%9===0,
  });
}
const hostile=replayPlayerLocomotionStateInputs(malformed);
assert.equal(hostile.results.length,72);
for(let index=0;index<hostile.results.length;index+=1){
  assert.equal(hostile.results[index].intent.validation.ok,true,`hostile-${index}`);
  assert.ok(hostile.results[index].quality.score>=0&&hostile.results[index].quality.score<=1);
}

const controllerA=createPlayerLocomotionStateReplayController();
const controllerB=createPlayerLocomotionStateReplayController();
for(let index=0;index<180;index+=1){
  const a=controllerA.update(input(index));
  const b=controllerB.update(input(index));
  assert.equal(a.intent.state,b.intent.state,`state-${index}`);
  assert.equal(a.intent.event.type,b.intent.event.type,`event-${index}`);
  assert.equal(a.intent.direction.selected,b.intent.direction.selected,`direction-${index}`);
  assert.equal(a.quality.grade,b.quality.grade,`quality-grade-${index}`);
}
assert.equal(diffPlayerLocomotionStateReplayResults(controllerA.snapshot().intents.map((intent,index)=>({intent,quality:controllerA.snapshot().quality[index],timeline:controllerA.snapshot().timeline[index]}),controllerB.snapshot().intents.map((intent,index)=>({intent,quality:controllerB.snapshot().quality[index],timeline:controllerB.snapshot().timeline[index]})).deterministic,true);

console.log('PLAYER_LOCOMOTION_STATE_REPLAY_PASS');

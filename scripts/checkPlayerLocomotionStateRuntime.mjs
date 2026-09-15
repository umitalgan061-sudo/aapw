import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES,
  createPlayerLocomotionStateRuntimeState,
  updatePlayerLocomotionStateRuntime,
  createPlayerLocomotionStateRuntimeController,
  runPlayerLocomotionStateRuntimeSequence,
  comparePlayerLocomotionStateRuntimeSequences,
  resolvePlayerLocomotionRuntimeHealth,
  normalizePlayerLocomotionRuntimeInput,
  validatePlayerLocomotionStateRuntimeResult,
} from '../src/3d/gameplay/playerLocomotionStateRuntime.js';

function finiteTree(value, path='root') {
  if (typeof value==='number') assert.equal(Number.isFinite(value),true,`${path}:finite`);
  if (value && typeof value==='object') for (const [key,child] of Object.entries(value)) finiteTree(child,`${path}.${key}`);
}
function input(overrides={}) {
  return { velocity:{x:0,y:1}, facing:{x:0,y:1}, planarSpeedMps:2.5, deltaSeconds:1/60, surfaceConfidence:1, surfaceSlip:0, grounded:true, ...overrides };
}

assert.equal(new Set(PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES).size,PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES.length);
const initial=createPlayerLocomotionStateRuntimeState({maxTelemetrySamples:32});
assert.equal(initial.frame,0);
assert.equal(initial.phase,'cold');
assert.equal(initial.telemetry.samples.length,0);
assert.equal(initial.options.maxTelemetrySamples,32);

for(let index=0;index<120;index+=1){
  const result=updatePlayerLocomotionStateRuntime(initial,input({planarSpeedMps:index%13,turnRateDegreesPerSecond:(index*41)%541,slopeDegrees:(index%19)*5-45,surfaceSlip:(index%12)/11,surfaceConfidence:0.5+(index%10)/20}));
  assert.ok(result.validation.ok,`single-${index}`);
  assert.ok(PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES.includes(result.state.phase));
  assert.ok(result.intent.validation.ok);
  assert.ok(result.timelineSample.progress>=0&&result.timelineSample.progress<=1);
  finiteTree(result);
}

const controller=createPlayerLocomotionStateRuntimeController({maxTelemetrySamples:48});
const phases=new Set();
for(let index=0;index<360;index+=1){
  const result=controller.update(input({
    planarSpeedMps:(index%91)/12,
    turnRateDegreesPerSecond:(index*67)%541,
    slopeDegrees:(index*9)%111-55,
    surfaceConfidence:index%17===0?0.2:0.95,
    surfaceSlip:index%13===0?0.92:0.08,
    grounded:index%23!==0,
    airTimeSeconds:index%23===0?0.4:0,
    landingImpactMps:index%29===0?6.3:0,
    traversalWeight:index%11===0?0.9:0.1,
    traversalForwardDistance:index%11===0?3.5:1,
    traversalHeight:index%11===0?0.5:0,
    traversalBlocked:index%31===0,
    attackKind:index%37===0?'heavy':undefined,
    dodgeRemaining:index%43===0?0.2:0,
    hitStaggerRemaining:index%47===0?0.2:0,
  }));
  assert.equal(result.validation.ok,true,`controller-${index}`);
  phases.add(result.state.phase);
  assert.ok(result.telemetry.sample.frame>0);
}
assert.equal(controller.telemetry().length,48);
assert.ok(phases.size>=4);
const health=resolvePlayerLocomotionRuntimeHealth(controller.update(input()).state);
assert.equal(health.healthy,true);
controller.reset();
assert.equal(controller.read().frame,0);

const sequence=[];
for(let index=0;index<180;index+=1) sequence.push(input({
  planarSpeedMps:(index%55)/7,
  turnRateDegreesPerSecond:(index%12)*45,
  slopeDegrees:(index%21)*4-40,
  surfaceSlip:index%9===0?0.8:0.12,
  surfaceConfidence:index%14===0?0.35:0.9,
  grounded:index%29!==0,
  airTimeSeconds:index%29===0?0.3:0,
  landingImpactMps:index%19===0?4.9:0,
  traversalWeight:index%10===0?0.8:0,
  traversalForwardDistance:index%10===0?3:0.7,
  traversalBlocked:index%41===0,
}));
const runA=runPlayerLocomotionStateRuntimeSequence(sequence,{maxTelemetrySamples:80});
const runB=runPlayerLocomotionStateRuntimeSequence(sequence,{maxTelemetrySamples:80});
assert.equal(runA.results.length,180);
assert.equal(runB.results.length,180);
assert.equal(comparePlayerLocomotionStateRuntimeSequences(runA.results,runB.results).deterministic,true);
assert.equal(runA.telemetry.length,80);

const malformed=[
  input({deltaSeconds:Infinity,planarSpeedMps:Infinity,surfaceConfidence:NaN,surfaceSlip:-Infinity}),
  input({deltaSeconds:-Infinity,planarSpeedMps:-Infinity,turnRateDegreesPerSecond:NaN,slopeDegrees:Infinity}),
  input({grounded:false,airTimeSeconds:Infinity,landingImpactMps:Infinity,traversalWeight:Infinity}),
];
for(let index=0;index<malformed.length;index+=1){
  const normalized=normalizePlayerLocomotionRuntimeInput(malformed[index]);
  assert.ok(normalized.deltaSeconds>=0.001&&normalized.deltaSeconds<=0.2);
  const result=updatePlayerLocomotionStateRuntime(createPlayerLocomotionStateRuntimeState(),malformed[index]);
  assert.equal(validatePlayerLocomotionStateRuntimeResult(result).ok,true,`malformed-${index}`);
  finiteTree(result);
}

for(let index=0;index<72;index+=1){
  const result=updatePlayerLocomotionStateRuntime(createPlayerLocomotionStateRuntimeState(),input({gameplayOverride:['guard','dodge','attack','stagger','air','land','traverse','blocked'][index%8]}));
  assert.equal(result.validation.ok,true,`override-${index}`);
  assert.ok(result.intent.source.source==='override');
}

for(let index=0;index<96;index+=1){
  const result=updatePlayerLocomotionStateRuntime(createPlayerLocomotionStateRuntimeState(),input({grounded:false,airTimeSeconds:0.2+index/100,planarSpeedMps:1+index/20}));
  assert.ok(result.state.phase==='airborne'||result.state.phase==='landing'||result.state.phase==='transitioning'||result.state.phase==='steady'||result.state.phase==='recovery');
}

console.log('PLAYER_LOCOMOTION_STATE_RUNTIME_PASS');

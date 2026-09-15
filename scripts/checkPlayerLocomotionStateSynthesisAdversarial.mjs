import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_STATE_STATES,
  PLAYER_LOCOMOTION_STATE_EVENTS,
  resolvePlayerLocomotionStateIntent,
  resolvePlayerLocomotionStateSource,
  normalizePlayerLocomotionStateInput,
} from '../src/3d/gameplay/playerLocomotionStateSynthesis.js';

function finiteTree(value) {
  if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
}
function base(overrides={}) { return { velocity:{x:0,y:1}, facing:{x:0,y:1}, planarSpeedMps:3, deltaSeconds:1/60, surfaceConfidence:1, surfaceSlip:0, grounded:true, ...overrides }; }
const hostile = [
  {planarSpeedMps:Infinity},{planarSpeedMps:-Infinity},{planarSpeedMps:NaN},{deltaSeconds:Infinity},{deltaSeconds:-Infinity},{deltaSeconds:NaN},
  {slopeDegrees:Infinity},{slopeDegrees:-Infinity},{slopeDegrees:NaN},{turnRateDegreesPerSecond:Infinity},{turnRateDegreesPerSecond:-Infinity},{turnRateDegreesPerSecond:NaN},
  {surfaceConfidence:Infinity},{surfaceConfidence:-Infinity},{surfaceConfidence:NaN},{surfaceSlip:Infinity},{surfaceSlip:-Infinity},{surfaceSlip:NaN},
  {landingImpactMps:Infinity},{landingImpactMps:-Infinity},{landingImpactMps:NaN},{airTimeSeconds:Infinity},{airTimeSeconds:-Infinity},{airTimeSeconds:NaN},
  {traversalWeight:Infinity},{traversalWeight:-Infinity},{traversalWeight:NaN},{traversalForwardDistance:Infinity},{traversalForwardDistance:-Infinity},{traversalForwardDistance:NaN},
  {traversalHeight:Infinity},{traversalHeight:-Infinity},{traversalHeight:NaN},{footPlantConfidence:Infinity},{footPlantConfidence:-Infinity},{footPlantConfidence:NaN},
  {footContactPhase:Infinity},{footContactPhase:-Infinity},{footContactPhase:NaN},{gameplayOverride:123},{gameplayOverride:null},{gameplayOverride:{}},
  {velocity:null},{facing:null},{velocity:{x:Infinity,y:NaN}},{facing:{x:NaN,y:Infinity}},{velocity:'bad'},{facing:'bad'},
];
for (let index=0; index<hostile.length; index+=1) {
  const normalized=normalizePlayerLocomotionStateInput(base(hostile[index]));
  assert.ok(normalized.planarSpeedMps>=0 && normalized.planarSpeedMps<=12,`speed-${index}`);
  assert.ok(normalized.turnRateDegreesPerSecond>=0 && normalized.turnRateDegreesPerSecond<=540,`turn-${index}`);
  assert.ok(normalized.surfaceConfidence>=0 && normalized.surfaceConfidence<=1,`confidence-${index}`);
  assert.ok(normalized.surfaceSlip>=0 && normalized.surfaceSlip<=1,`slip-${index}`);
  assert.ok(normalized.deltaSeconds>=0.001 && normalized.deltaSeconds<=0.2,`delta-${index}`);
  assert.ok(normalized.airTimeSeconds>=0 && normalized.airTimeSeconds<=4,`air-${index}`);
  finiteTree(normalized);
}
for (let index=0; index<120; index+=1) {
  const intent=resolvePlayerLocomotionStateIntent(base({planarSpeedMps:index%13,turnRateDegreesPerSecond:(index*73)%541,slopeDegrees:(index*11)%111-55,surfaceSlip:(index%9)/8,surfaceConfidence:(index%11)/10,grounded:index%7!==0,airTimeSeconds:index%7===0?0.2:0,landingImpactMps:index%19===0?8:0,traversalWeight:(index%5)/4,traversalForwardDistance:index%8,traversalHeight:(index%13)/4-1.5,traversalBlocked:index%17===0,rootMotionAllowed:index%3!==0}));
  assert.ok(PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state),`state-${index}`);
  assert.ok(PLAYER_LOCOMOTION_STATE_EVENTS.includes(intent.event.type),`event-${index}`);
  assert.ok(intent.validation.ok,`validation-${index}`);
  finiteTree(intent);
}
for (let index=0; index<160; index+=1) {
  const direction=index%8;
  const angle=direction*Math.PI/4;
  const intent=resolvePlayerLocomotionStateIntent(base({velocity:{x:Math.sin(angle),y:Math.cos(angle)},facing:{x:Math.cos(angle),y:Math.sin(angle)},planarSpeedMps:0.1+(index%120)/10,turnRateDegreesPerSecond:(index%12)*45}));
  assert.ok(intent.direction.current.length>0,`current-${index}`);
  assert.ok(intent.direction.anticipated.length>0,`anticipated-${index}`);
  assert.ok(intent.blend.directions.forward>=0,`blend-${index}`);
  assert.ok(Math.abs(Object.values(intent.blend.directions).reduce((a,b)=>a+b,0)-1)<0.002,`blend-sum-${index}`);
}
for (let index=0; index<120; index+=1) {
  const input=base({planarSpeedMps:1+index/20,turnRateDegreesPerSecond:540,surfaceSlip:1,surfaceConfidence:0,grounded:index%2===0,traversalBlocked:true,traversalWeight:1,traversalForwardDistance:8,traversalHeight:3,landingImpactMps:9,airTimeSeconds:4});
  const intent=resolvePlayerLocomotionStateIntent(input);
  const source=resolvePlayerLocomotionStateSource(intent.input,intent.profile);
  assert.ok(source.priority>=40,`priority-${index}`);
  assert.ok(intent.confidence>=0 && intent.confidence<=1,`conf-${index}`);
  assert.ok(intent.rootMotionAllowed===true,`root-motion-${index}`);
}
for (let index=0; index<140; index+=1) {
  const semantic=[undefined,'guard','dodge','heavy-attack','light-attack','hit-stagger'][index%6];
  const intent=resolvePlayerLocomotionStateIntent(base({planarSpeedMps:1+index%6,guarding:semantic==='guard',dodgeRemaining:semantic==='dodge'?0.2:0,attackKind:semantic?.includes('attack')?semantic.split('-')[0]:undefined,hitStaggerRemaining:semantic==='hit-stagger'?0.2:0}));
  assert.ok(PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state));
  assert.equal(typeof intent.semanticState,'string');
}
for (let index=0; index<140; index+=1) {
  const override=['guard','dodge','attack','stagger','air','land','traverse','blocked','cruise','pivot'][index%10];
  const intent=resolvePlayerLocomotionStateIntent(base({gameplayOverride:override,planarSpeedMps:4}));
  assert.ok(PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state),`override-state-${index}`);
  assert.equal(intent.source.source,'override',`override-source-${index}`);
}
console.log('PLAYER_LOCOMOTION_STATE_SYNTHESIS_ADVERSARIAL_PASS');

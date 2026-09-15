import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_FOOT_CONTACT_VERSION,
  PLAYER_LOCOMOTION_FOOT_CONTACT_PHASES,
  resolvePlayerLocomotionFootPhase,
  resolvePlayerLocomotionFootContactWeights,
  resolvePlayerLocomotionFootEventWindow,
  resolvePlayerLocomotionFootCadence,
  resolvePlayerLocomotionFootContactConfidence,
  resolvePlayerLocomotionFootContactPresentation,
  validatePlayerLocomotionFootContactPresentation,
  createPlayerLocomotionFootContactController,
  auditPlayerLocomotionFootContact,
} from '../src/3d/gameplay/playerLocomotionFootContactPolicy.js';

assert.equal(PLAYER_LOCOMOTION_FOOT_CONTACT_VERSION,'2026-09-15-v1');
assert.equal(PLAYER_LOCOMOTION_FOOT_CONTACT_PHASES.length,6);
assert.equal(auditPlayerLocomotionFootContact().valid,true);

const checkpoints=[0,0.04,0.08,0.16,0.24,0.25,0.41,0.42,0.5,0.58,0.64,0.74,0.75,0.91,0.92,0.99,1,1.25,-0.25];
for(const phase of checkpoints){const name=resolvePlayerLocomotionFootPhase(phase);assert.ok(PLAYER_LOCOMOTION_FOOT_CONTACT_PHASES.includes(name));const weights=resolvePlayerLocomotionFootContactWeights(phase,{surfaceConfidence:1,surfaceSlip:0,grounded:true});for(const key of ['left','right','heel','toe','confidence','slip'])assert.ok(Number.isFinite(weights[key]));const presentation=resolvePlayerLocomotionFootContactPresentation({phase,speedMps:4,playbackRate:1,cadenceScale:1,surfaceConfidence:1,groundedConfidence:1,surfaceSlip:0});assert.equal(validatePlayerLocomotionFootContactPresentation(presentation).ok,true);}

for(let index=0;index<500;index+=1){const phase=(index*0.037)%1;for(const confidence of [0,0.2,0.5,0.8,1])for(const slip of [0,0.25,0.5,0.75,1]){const weights=resolvePlayerLocomotionFootContactWeights(phase,{surfaceConfidence:confidence,surfaceSlip:slip,grounded:index%9!==0});assert.ok(weights.left>=0&&weights.left<=1);assert.ok(weights.right>=0&&weights.right<=1);assert.ok(weights.confidence>=0&&weights.confidence<=1);const contact=resolvePlayerLocomotionFootContactConfidence({phase,surfaceConfidence:confidence,groundedConfidence:(index%11)/10,surfaceSlip:slip});assert.ok(contact>=0&&contact<=1);}}

for(let speed=0;speed<=12;speed+=0.25){for(const rate of [0.72,0.9,1,1.2,1.35]){const cadence=resolvePlayerLocomotionFootCadence({speedMps:speed,playbackRate:rate,cadenceScale:1,surfaceSlip:0.5});assert.ok(cadence>=0&&cadence<=1.5);}}

for(let previous=0;previous<1;previous+=0.05){for(let next=0;next<1;next+=0.05){const event=resolvePlayerLocomotionFootEventWindow(previous,next);assert.ok(typeof event.wrapped==='boolean');assert.ok(Array.isArray(event.events));assert.equal(event.emitted,event.events.length>0);for(const item of event.events){assert.ok(['left','right'].includes(item.foot));assert.equal(typeof item.phase,'string');}}}

const controller=createPlayerLocomotionFootContactController();let last=controller.update(0);for(let index=1;index<=200;index+=1){last=controller.update((index*0.013)%1);assert.equal(validatePlayerLocomotionFootContactPresentation(last.presentation).ok,true);assert.ok(typeof last.events.emitted==='boolean');}assert.ok(controller.read().phase>=0&&controller.read().phase<1);controller.reset();assert.equal(controller.read().phase,0);

const malformed=resolvePlayerLocomotionFootContactPresentation({phase:Infinity,speedMps:Infinity,playbackRate:NaN,cadenceScale:Infinity,surfaceConfidence:NaN,groundedConfidence:-Infinity,surfaceSlip:Infinity});assert.equal(validatePlayerLocomotionFootContactPresentation(malformed).ok,true);
console.log('PLAYER_LOCOMOTION_FOOT_CONTACT_PASS');

import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_VERSION,
  PLAYER_LOCOMOTION_ANTICIPATION_LIMITS,
  PLAYER_LOCOMOTION_ANTICIPATION_MODES,
  normalizePlayerLocomotionAnticipationPrevious,
  resolvePlayerLocomotionDelta,
  resolvePlayerLocomotionAnticipationMode,
  resolvePlayerLocomotionAnticipatedDirection,
  resolvePlayerLocomotionAnticipatedBlend,
  resolvePlayerLocomotionAnticipationProfile,
  validatePlayerLocomotionAnticipationProfile,
  createPlayerLocomotionAnticipationState,
  validatePlayerLocomotionAnticipationState,
  auditPlayerLocomotionAnticipationPolicy,
} from '../src/3d/gameplay/playerLocomotionAnticipationPolicy.js';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION,
  PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS,
  resolvePlayerLocomotionAnimationRequest,
  validatePlayerLocomotionAnimationRequest,
  auditPlayerLocomotionAnimationBridge,
} from '../src/3d/gameplay/playerLocomotionAnimationBridge.js';

function input(overrides={}){return{velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3.5,slopeDegrees:0,turnRateDegreesPerSecond:0,deltaSeconds:1/60,surfaceConfidence:1,surfaceSlip:0,...overrides};}
function finiteTree(value,path='root'){if(typeof value==='number')assert.equal(Number.isFinite(value),true,`${path}-finite`);if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))finiteTree(v,`${path}.${k}`);}

assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_VERSION,'2026-09-15-v1');
assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION,'2026-09-15-v1');
assert.equal(auditPlayerLocomotionAnticipationPolicy().validProbe,true);
assert.equal(auditPlayerLocomotionAnimationBridge().valid,true);
assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_LIMITS.maxLookAheadSeconds,0.35);
assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_LIMITS.maxHistory,24);
assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_MODES.length,16);
assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.length,17);

const normalized=normalizePlayerLocomotionAnticipationPrevious({planarSpeedMps:Infinity,directionAngleRadians:NaN,semanticState:99,phase:3,turnRateDegreesPerSecond:Infinity,surfaceConfidence:-1,surfaceSlip:2});
assert.equal(normalized.planarSpeedMps,12);assert.equal(normalized.phase,1);assert.equal(normalized.turnRateDegreesPerSecond,540);assert.equal(normalized.surfaceConfidence,0);assert.equal(normalized.surfaceSlip,1);assert.equal(Object.isFrozen(normalized),true);

for(let index=0;index<512;index+=1){
  const angle=(index%32)*Math.PI/16;
  const current=input({velocity:{x:Math.sin(angle),y:Math.cos(angle)},planarSpeedMps:index%13,slopeDegrees:index%56,turnRateDegreesPerSecond:index%541,surfaceConfidence:(index%10)/10,surfaceSlip:(index%8)/8});
  const previous={planarSpeedMps:(index%11)*0.7,directionAngleRadians:angle-Math.PI/8,semanticState:index%4===0?'sprint':'locomotion',phase:(index%100)/100,turnRateDegreesPerSecond:index%350,surfaceConfidence:0.8,surfaceSlip:0.1};
  const delta=resolvePlayerLocomotionDelta(current,previous);
  assert.ok(Math.abs(delta.angleDeltaDegrees)<=180);assert.ok(Math.abs(delta.speedDeltaMps)<=8);assert.ok(Number.isFinite(delta.accelerationMps2));
  const profile=resolvePlayerLocomotionAnticipationProfile(current,previous);
  assert.equal(validatePlayerLocomotionAnticipationProfile(profile).ok,true);
  finiteTree(profile,`profile-${index}`);
}

for(const mode of PLAYER_LOCOMOTION_ANTICIPATION_MODES){
  const profile=resolvePlayerLocomotionAnticipationProfile(input({planarSpeedMps:5.4,turnRateDegreesPerSecond:180,slopeDegrees:25,surfaceConfidence:0.4,surfaceSlip:0.6}),{planarSpeedMps:4,directionAngleRadians:Math.PI/2,semanticState:mode,phase:0.4,turnRateDegreesPerSecond:120,surfaceConfidence:0.7,surfaceSlip:0.3});
  assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_MODES.includes(profile.mode),true);
  assert.ok(profile.confidence>=0&&profile.confidence<=1);
  assert.ok(profile.groundRisk>=0&&profile.groundRisk<=1);
}

for(let index=0;index<256;index+=1){
  const speed=8-index%9;const previous={planarSpeedMps:Math.max(speed,(index%6)*0.4),directionAngleRadians:index%2?Math.PI:0,semanticState:'cruise',phase:0.7,turnRateDegreesPerSecond:300,surfaceConfidence:1,surfaceSlip:0};
  const current=input({planarSpeedMps:speed,turnRateDegreesPerSecond:index%2?420:15});
  const direction=resolvePlayerLocomotionAnticipatedDirection(current,previous);assert.equal(typeof direction,'string');
  const blend=resolvePlayerLocomotionAnticipatedBlend(current,previous);assert.equal(Object.keys(blend).length,8);assert.ok(Math.abs(Object.values(blend).reduce((a,b)=>a+b,0)-1)<0.001);
}

const profile=input({planarSpeedMps:7,slopeDegrees:40,turnRateDegreesPerSecond:510,surfaceConfidence:0.1,surfaceSlip:0.9,attackKind:'heavy'});
const request=resolvePlayerLocomotionAnimationRequest(profile,{planarSpeedMps:6,directionAngleRadians:0,semanticState:'cruise',phase:0.4,turnRateDegreesPerSecond:400,surfaceConfidence:0.3,surfaceSlip:0.7});
assert.equal(validatePlayerLocomotionAnimationRequest(request).ok,true);assert.equal(Object.isFrozen(request),true);assert.equal(Object.isFrozen(request.channels),true);assert.equal(Object.isFrozen(request.envelope),true);finiteTree(request);

const state=createPlayerLocomotionAnticipationState();assert.equal(validatePlayerLocomotionAnticipationState(state).ok,true);assert.equal(Object.isFrozen(state),true);assert.equal(state.frameCount,0);assert.equal(state.history.length,0);

console.log('PLAYER_LOCOMOTION_ANTICIPATION_CONTRACT_PASS');

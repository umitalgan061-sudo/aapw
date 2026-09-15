import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS,
  resolvePlayerLocomotionAnimationRequest,
  resolvePlayerLocomotionChannelWeights,
  resolvePlayerLocomotionChannelEnvelope,
  normalizePlayerLocomotionAnimationDirectionalWeights,
  validatePlayerLocomotionAnimationRequest,
  auditPlayerLocomotionAnimationBridge,
} from '../src/3d/gameplay/playerLocomotionAnimationBridge.js';

function input(index = 0, overrides = {}) {
  const a = (index % 8) * Math.PI / 4;
  return { velocity:{x:Math.sin(a),y:Math.cos(a)}, facing:{x:0,y:1}, planarSpeedMps:index % 13, slopeDegrees:index % 12 * 4, turnRateDegreesPerSecond:index % 10 * 45, deltaSeconds:1/60, surfaceConfidence:(index % 11)/10, surfaceSlip:(index % 6)/6, ...overrides };
}

assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.length, 17);
assert.equal(auditPlayerLocomotionAnimationBridge().valid, true);

for (let index = 0; index < 360; index += 1) {
  const request = resolvePlayerLocomotionAnimationRequest(input(index));
  assert.equal(validatePlayerLocomotionAnimationRequest(request).ok, true, `request-${index}`);
  assert.equal(Object.keys(request.channels).length, 17);
  assert.ok(Object.values(request.channels).every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(request.phase >= 0 && request.phase < 1);
  assert.ok(request.playbackRate >= 0.72 && request.playbackRate <= 1.35);
  assert.ok(request.confidence >= 0 && request.confidence <= 1);
}

for (const caseInput of [
  input(1, { planarSpeedMps: Infinity, slopeDegrees: Infinity }),
  input(2, { turnRateDegreesPerSecond: NaN, surfaceConfidence: NaN, surfaceSlip: Infinity }),
  input(3, { velocity: {x:Infinity,y:NaN}, facing:{x:NaN,y:Infinity} }),
]) {
  const request = resolvePlayerLocomotionAnimationRequest(caseInput);
  assert.equal(validatePlayerLocomotionAnimationRequest(request).ok, true);
}

for (let index = 0; index < 80; index += 1) {
  const profile = {
    anticipatedBlendWeights:{forward:1, 'forward-right':0, right:0, 'back-right':0, back:0, 'back-left':0, left:0, 'forward-left':0},
    mode:index % 5 === 0 ? 'start' : index % 5 === 1 ? 'cruise' : index % 5 === 2 ? 'brake' : index % 5 === 3 ? 'pivot' : 'recover',
    startWeight:index/80, brakeWeight:1-index/100, pivotWeight:(index%10)/10,
    recoveryWeight:index%2, confidence:index%11/10, groundRisk:index%7/7, contact:{plant:index%9/9}, lookAheadSeconds:0.1 + index%5/20, anticipatedDirection:'forward', playbackRate:1, phase:0,
  };
  const channels = resolvePlayerLocomotionChannelWeights(profile);
  assert.equal(Object.keys(channels).length, 17);
  assert.ok(Object.values(channels).every((value) => value >= 0 && value <= 1));
  const envelope = resolvePlayerLocomotionChannelEnvelope(profile);
  assert.ok(envelope.directional >= 0.5 && envelope.directional <= 1);
  assert.ok(envelope.gait >= 0.5 && envelope.gait <= 1);
  assert.ok(envelope.contact >= 0 && envelope.contact <= 1);
  assert.ok(envelope.anticipation >= 0 && envelope.anticipation <= 1);
}

const normalizedZero = normalizePlayerLocomotionAnimationDirectionalWeights({});
assert.equal(normalizedZero.forward, 1);
assert.equal(Object.values(normalizedZero).reduce((a,b)=>a+b,0),1);
const normalized = normalizePlayerLocomotionAnimationDirectionalWeights({forward:2,right:2,back:-1});
assert.ok(Math.abs(Object.values(normalized).reduce((a,b)=>a+b,0)-1)<0.001);
assert.ok(Object.values(normalized).every((v)=>v>=0&&v<=1));

console.log('PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_PASS');

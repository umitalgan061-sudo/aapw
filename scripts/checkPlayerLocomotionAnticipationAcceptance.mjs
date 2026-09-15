import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_MODES,
  resolvePlayerLocomotionAnticipationProfile,
  resolvePlayerLocomotionAnticipationMode,
  resolvePlayerLocomotionAnticipatedDirection,
  resolvePlayerLocomotionAnticipatedBlend,
  resolvePlayerLocomotionStartWeight,
  resolvePlayerLocomotionBrakeWeight,
  resolvePlayerLocomotionPivotWeight,
  resolvePlayerLocomotionStopDistance,
  resolvePlayerLocomotionLookAheadSeconds,
  validatePlayerLocomotionAnticipationProfile,
  createPlayerLocomotionAnticipationController,
} from '../src/3d/gameplay/playerLocomotionAnticipationPolicy.js';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS,
  resolvePlayerLocomotionAnimationRequest,
  resolvePlayerLocomotionChannelWeights,
  validatePlayerLocomotionAnimationRequest,
  createPlayerLocomotionAnimationRequestController,
} from '../src/3d/gameplay/playerLocomotionAnimationBridge.js';

function finiteTree(value, path = 'root') {
  if (typeof value === 'number') assert.equal(Number.isFinite(value), true, `${path}-finite`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`);
}
function sample(overrides = {}) {
  return {
    velocity: { x: 0, y: 1 }, facing: { x: 0, y: 1 }, planarSpeedMps: 3.2,
    slopeDegrees: 0, turnRateDegreesPerSecond: 0, deltaSeconds: 1 / 60,
    surfaceConfidence: 1, surfaceSlip: 0, ...overrides,
  };
}

assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_MODES.length, 16);
const modes = new Set(PLAYER_LOCOMOTION_ANTICIPATION_MODES);
assert.equal(modes.size, PLAYER_LOCOMOTION_ANTICIPATION_MODES.length);

for (let speed = 0; speed <= 12; speed += 0.25) {
  const input = sample({ planarSpeedMps: speed });
  const profile = resolvePlayerLocomotionAnticipationProfile(input);
  assert.equal(validatePlayerLocomotionAnticipationProfile(profile).ok, true, `speed-${speed}`);
  assert.ok(modes.has(profile.mode));
  assert.ok(profile.lookAheadSeconds >= 0.05 && profile.lookAheadSeconds <= 0.35);
  assert.ok(profile.playbackRate >= 0.72 && profile.playbackRate <= 1.35);
  assert.ok(profile.phase >= 0 && profile.phase < 1);
  finiteTree(profile, `profile-${speed}`);
}

for (let angleIndex = 0; angleIndex < 72; angleIndex += 1) {
  const angle = -Math.PI + angleIndex * Math.PI / 36;
  const input = sample({ velocity: { x: Math.sin(angle), y: Math.cos(angle) }, planarSpeedMps: 5.2, turnRateDegreesPerSecond: (angleIndex % 12) * 42 });
  const direction = resolvePlayerLocomotionAnticipatedDirection(input);
  assert.ok(typeof direction === 'string');
  assert.ok(profileDirection(input, direction));
  const blend = resolvePlayerLocomotionAnticipatedBlend(input);
  const values = Object.values(blend);
  assert.equal(values.length, 8);
  assert.ok(values.every((value) => value >= 0 && value <= 1));
  assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 0.001);
}

function profileDirection(input, direction) {
  return direction.length > 0;
}

const transitions = [
  sample({ planarSpeedMps: 0 }), sample({ planarSpeedMps: 0.4 }), sample({ planarSpeedMps: 2 }),
  sample({ planarSpeedMps: 5.55 }), sample({ planarSpeedMps: 5.6 }), sample({ planarSpeedMps: 5.3 }),
  sample({ planarSpeedMps: 5.09 }), sample({ planarSpeedMps: 0.1 }),
];
let previous = 'idle';
for (const input of transitions) {
  const mode = resolvePlayerLocomotionAnticipationMode(input, { semanticState: previous, planarSpeedMps: input.planarSpeedMps, directionAngleRadians: 0, phase: 0, turnRateDegreesPerSecond: 0, surfaceConfidence: 1, surfaceSlip: 0 });
  assert.ok(modes.has(mode));
  previous = mode === 'stop' ? 'idle' : mode;
}
assert.equal(resolvePlayerLocomotionAnticipationMode(sample({ planarSpeedMps: 6.2, attackKind: 'heavy' })), 'combat-advance');
assert.equal(resolvePlayerLocomotionAnticipationMode(sample({ planarSpeedMps: 6.2, guarding: true })), 'guard-walk');
assert.equal(resolvePlayerLocomotionAnticipationMode(sample({ planarSpeedMps: 6.2, dodgeRemaining: 0.2 })), 'dodge-recover');
assert.equal(resolvePlayerLocomotionAnticipationMode(sample({ planarSpeedMps: 6.2, hitStaggerRemaining: 0.2 })), 'stagger-recover');

for (let speed = 0; speed <= 12; speed += 0.4) {
  const input = sample({ planarSpeedMps: speed, surfaceSlip: (speed % 1.2) / 1.2, slopeDegrees: speed * 4 });
  assert.ok(resolvePlayerLocomotionStartWeight(input) >= 0 && resolvePlayerLocomotionStartWeight(input) <= 1);
  assert.ok(resolvePlayerLocomotionBrakeWeight(input, { planarSpeedMps: Math.min(12, speed + 1) }) >= 0);
  assert.ok(resolvePlayerLocomotionPivotWeight(input, { planarSpeedMps: speed, directionAngleRadians: Math.PI }) >= 0);
  assert.ok(resolvePlayerLocomotionStopDistance(input, { planarSpeedMps: speed + 1 }) >= 0);
}

const malformed = [
  sample({ planarSpeedMps: Infinity, slopeDegrees: Infinity, turnRateDegreesPerSecond: NaN, surfaceConfidence: NaN, surfaceSlip: Infinity }),
  sample({ planarSpeedMps: -Infinity, velocity: { x: Infinity, y: NaN }, facing: { x: NaN, y: Infinity }, deltaSeconds: NaN }),
];
for (const input of malformed) {
  const profile = resolvePlayerLocomotionAnticipationProfile(input);
  assert.equal(validatePlayerLocomotionAnticipationProfile(profile).ok, true);
  finiteTree(profile);
}

const controllerSeen = [];
const controller = createPlayerLocomotionAnticipationController({ onProfile: (profile) => controllerSeen.push(profile.mode) });
for (let index = 0; index < 120; index += 1) controller.update(sample({ planarSpeedMps: index < 25 ? index / 10 : index < 70 ? 6.4 : 2, turnRateDegreesPerSecond: index % 9 === 0 ? 180 : 0 }));
assert.equal(controller.read().frameCount, 120);
assert.ok(controllerSeen.length > 0);
controller.reset();
assert.equal(controller.read().frameCount, 0);

for (let index = 0; index < 160; index += 1) {
  const request = resolvePlayerLocomotionAnimationRequest(sample({ planarSpeedMps: index % 13, turnRateDegreesPerSecond: index % 10 * 50, slopeDegrees: index % 11 * 4 }));
  assert.equal(validatePlayerLocomotionAnimationRequest(request).ok, true);
  assert.equal(Object.keys(request.channels).length, PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.length);
  const sum = Object.values(request.channels).reduce((a, b) => a + b, 0);
  assert.ok(sum >= 1);
  finiteTree(request);
}

const bridgeController = createPlayerLocomotionAnimationRequestController();
bridgeController.update(sample({ planarSpeedMps: 0 }));
bridgeController.update(sample({ planarSpeedMps: 6.4, turnRateDegreesPerSecond: 190 }));
assert.equal(bridgeController.read().frameCount, 2);
bridgeController.reset();
assert.equal(bridgeController.read().frameCount, 0);

console.log('PLAYER_LOCOMOTION_ANTICIPATION_ACCEPTANCE_PASS');

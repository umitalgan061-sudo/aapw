#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createGuardPerception, evaluateGuardStimulus, queryColliderLineOfSight } from '../src/3d/gameplay/npcPerception.js';

const front = evaluateGuardStimulus({
	observer: { x: 0, z: 0 }, target: { x: 0, z: 8 }, yawRadians: 0,
	visionRangeMeters: 10, fieldOfViewDegrees: 120, peripheralRadiusMeters: 3.25,
});
assert.equal(front.sensed, true);
assert.equal(front.reason, 'vision');

const behind = evaluateGuardStimulus({
	observer: { x: 0, z: 0 }, target: { x: 0, z: -8 }, yawRadians: 0,
	visionRangeMeters: 10, fieldOfViewDegrees: 120, peripheralRadiusMeters: 3.25,
});
assert.equal(behind.sensed, false);
assert.equal(behind.reason, 'behind');

const peripheral = evaluateGuardStimulus({
	observer: { x: 0, z: 0 }, target: { x: 0, z: -2 }, yawRadians: 0,
	visionRangeMeters: 10, fieldOfViewDegrees: 120, peripheralRadiusMeters: 3.25,
});
assert.equal(peripheral.sensed, true);
assert.equal(peripheral.reason, 'peripheral');

const occluded = evaluateGuardStimulus({
	observer: { x: 0, z: 0 }, target: { x: 0, z: 2 }, yawRadians: 0,
	visionRangeMeters: 10, hasLineOfSight: false,
});
assert.equal(occluded.sensed, false);
assert.equal(occluded.reason, 'occluded');

const wallCollider = {
	resolveXZ(x, z) {
		if (x > 2.25 && x < 2.75 && Math.abs(z) < 0.75) return { x: 2.25, z };
		return { x, z };
	},
};
const blockedSight = queryColliderLineOfSight({
	collider: wallCollider,
	observer: { x: 0, z: 0 },
	target: { x: 5, z: 0 },
	stepMeters: 0.25,
});
assert.equal(blockedSight.clear, false, 'a solid collider sample must block line of sight');
assert.equal(blockedSight.reason, 'blocked');
assert.ok(blockedSight.samples > 0 && blockedSight.samples <= 64);
assert.ok(blockedSight.blockedAt && blockedSight.blockedAt.x >= 2.25 && blockedSight.blockedAt.x <= 2.75);

const clearSight = queryColliderLineOfSight({
	collider: wallCollider,
	observer: { x: 0, z: 0 },
	target: { x: 0, z: 5 },
	stepMeters: 0.25,
});
assert.equal(clearSight.clear, true, 'an unobstructed segment must remain visible');
assert.equal(clearSight.reason, 'clear');

const noColliderSight = queryColliderLineOfSight({ observer: { x: 0, z: 0 }, target: { x: 5, z: 0 } });
assert.equal(noColliderSight.clear, true, 'tests/callers without a world collider preserve compatibility');
assert.equal(noColliderSight.reason, 'no-collider');

const hearingPerception = createGuardPerception({
	visionRangeMeters: 10,
	hearingRangeMeters: 8,
	investigationSpeedMps: 1,
	searchSeconds: 1,
	alertThreshold: 0.72,
});
let hearingState = hearingPerception.update({
	observer: { x: 0, z: 0 }, target: { x: 0, z: -20 }, yawRadians: 0,
	deltaSeconds: 0.1, hasLineOfSight: false, noisePosition: { x: 4, z: 0 }, noiseStrength: 1,
});
assert.equal(hearingState.sensed, false, 'hearing must not masquerade as visual sensing');
assert.equal(hearingState.heard, true, 'strong nearby movement noise must be heard');
assert.equal(hearingState.intent, 'investigate', 'heard movement should seed a last-known-position investigation');
assert.equal(hearingState.reason, 'hearing');
assert.deepEqual(hearingState.lastSeen, { x: 4, z: 0 });
assert.ok(hearingState.suspicion > 0 && hearingState.suspicion < 0.72, 'hearing raises suspicion without immediate combat alert');
hearingState = hearingPerception.update({
	observer: { x: 0, z: 0 }, target: { x: 0, z: -20 }, yawRadians: 0,
	deltaSeconds: 0.25, hasLineOfSight: false,
});
assert.equal(hearingState.intent, 'investigate', 'investigation must persist after the one-frame noise stimulus ends');
assert.equal(hearingState.reason, 'hearing', 'the last-known source remains classified as hearing while searching');
const weakHearing = createGuardPerception({ visionRangeMeters: 10, hearingRangeMeters: 8 });
const weakNoise = weakHearing.update({
	observer: { x: 0, z: 0 }, target: { x: 0, z: -20 }, hasLineOfSight: false,
	noisePosition: { x: 4, z: 0 }, noiseStrength: 0.25, deltaSeconds: 0.1,
});
assert.equal(weakNoise.heard, false, 'quiet movement beyond its strength-scaled hearing radius must be ignored');
assert.equal(weakNoise.intent, 'patrol');

const perception = createGuardPerception({
	visionRangeMeters: 10,
	acquireSeconds: 0.2,
	memorySeconds: 1.0,
	investigationSpeedMps: 100,
	searchSeconds: 0,
	alertThreshold: 0.7,
});
let state;
for (let i = 0; i < 4; i += 1) {
	state = perception.update({ observer: { x: 0, z: 0 }, target: { x: 0, z: 7 }, yawRadians: 0, deltaSeconds: 0.05 });
}
assert.equal(state.alerted, true, 'guard should acquire a visible target after suspicion builds');
assert.equal(state.intent, 'alert');
assert.ok(state.suspicion >= 0.7);

state = perception.update({
	observer: { x: 0, z: 0 },
	target: { x: 0, z: 7 },
	yawRadians: 0,
	deltaSeconds: 0.25,
	hasLineOfSight: false,
});
assert.equal(state.intent, 'investigate', 'lost/occluded target should transition to last-seen investigation');
assert.equal(state.reason, 'memory');
assert.deepEqual(state.lastSeen, { x: 0, z: 7 });
assert.ok(state.memoryFraction > 0 && state.memoryFraction < 1);
assert.ok(state.investigationRemaining > 0);

for (let i = 0; i < 12; i += 1) {
	state = perception.update({ observer: { x: 0, z: 0 }, target: { x: 0, z: -20 }, yawRadians: 0, deltaSeconds: 0.25 });
}
assert.equal(state.alerted, false, 'alert must decay after memory expires');
assert.equal(state.intent, 'patrol', 'guard must deterministically return to patrol after its bounded investigation expires');
assert.equal(state.memoryFraction, 0);
assert.equal(state.investigationFraction, 0);
assert.ok(state.suspicion < 0.7);

const travelBudgetPerception = createGuardPerception({
	visionRangeMeters: 10,
	acquireSeconds: 0.05,
	memorySeconds: 0.5,
	investigationSpeedMps: 1,
	searchSeconds: 1,
	alertThreshold: 0.2,
});
for (let i = 0; i < 3; i += 1) {
	travelBudgetPerception.update({ observer: { x: 0, z: 0 }, target: { x: 0, z: 8 }, yawRadians: 0, deltaSeconds: 0.05 });
}
let travelState;
for (let i = 0; i < 4; i += 1) {
	travelState = travelBudgetPerception.update({
		observer: { x: 0, z: 0 }, target: { x: 0, z: 8 }, yawRadians: 0, deltaSeconds: 0.25, hasLineOfSight: false,
	});
}
assert.equal(travelState.memoryRemaining, 0, 'short suspicion memory should be allowed to cool before investigation ends');
assert.equal(travelState.intent, 'investigate', '8m last-seen target must retain enough budget to walk there and search');
assert.ok(travelState.investigationRemaining > 7);
for (let i = 0; i < 40; i += 1) {
	travelState = travelBudgetPerception.update({ observer: { x: 0, z: 0 }, target: { x: 0, z: -20 }, yawRadians: 0, deltaSeconds: 0.25 });
}
assert.equal(travelState.intent, 'patrol', 'travel-sized investigation budget must still end deterministically');
assert.equal(travelState.investigationRemaining, 0);

const resetPerception = createGuardPerception({
	visionRangeMeters: 10,
	acquireSeconds: 0.05,
	memorySeconds: 1,
	alertThreshold: 0.2,
});
for (let i = 0; i < 3; i += 1) {
	resetPerception.update({ observer: { x: 0, z: 0 }, target: { x: 0, z: 4 }, deltaSeconds: 0.05 });
}
assert.equal(resetPerception.snapshot().lastSeen?.z, 4, 'precondition: target should be remembered before reset');
resetPerception.reset();
const resetSnapshot = resetPerception.snapshot();
assert.equal(resetSnapshot.suspicion, 0, 'reset must clear suspicion');
assert.equal(resetSnapshot.memoryRemaining, 0, 'reset must clear short-term memory');
assert.equal(resetSnapshot.investigationRemaining, 0, 'reset must clear travel/search budget');
assert.equal(resetSnapshot.lastSeen, null, 'reset must clear stale last-seen coordinates');
const reacquired = resetPerception.update({ observer: { x: 0, z: 0 }, target: { x: 4, z: 0 }, yawRadians: Math.PI / 2, deltaSeconds: 0.05 });
assert.equal(reacquired.sensed, true, 'a reset guard must immediately accept a fresh valid stimulus');
assert.deepEqual(reacquired.lastSeen, { x: 4, z: 0 }, 'reacquisition must replace the old target memory');

console.log('NPC_PERCEPTION_PASS', JSON.stringify({
	front: front.reason,
	behind: behind.reason,
	peripheral: peripheral.reason,
	blockedSightSamples: blockedSight.samples,
	hearingIntent: hearingState.intent,
	weakNoiseHeard: weakNoise.heard,
	travelBudgetExpiredTo: travelState.intent,
	resetReacquired: reacquired.reason,
	finalIntent: state.intent,
	finalSuspicion: Number(state.suspicion.toFixed(4)),
}));

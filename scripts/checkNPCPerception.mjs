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

console.log('NPC_PERCEPTION_PASS', JSON.stringify({
	front: front.reason,
	behind: behind.reason,
	peripheral: peripheral.reason,
	blockedSightSamples: blockedSight.samples,
	travelBudgetExpiredTo: travelState.intent,
	finalIntent: state.intent,
	finalSuspicion: Number(state.suspicion.toFixed(4)),
}));

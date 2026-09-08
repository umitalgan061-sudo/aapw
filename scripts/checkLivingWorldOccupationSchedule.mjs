import assert from 'node:assert/strict';
import {
	auditOccupationSchedule,
	chooseOccupationPhase,
	createOccupationScheduleState,
	advanceOccupationSchedule,
	estimateOccupationTravelSeconds,
	occupationPhaseTimeline,
	occupationSnapshot,
	occupationDigest,
} from '../src/3d/gameplay/livingWorldOccupationSchedule.js';

const definition = {
	id: 'guard-2',
	seed: 'guard-seed',
	transitionSeconds: 6,
	travelSpeedMps: 1.4,
	anchors: [
		{ id: 'gate', x: 100, z: 10, type: 'guard-post' },
		{ id: 'quarters', x: 96, z: 14, type: 'rest' },
	],
	schedule: [
		{ startSeconds: 0, endSeconds: 5 * 3600, phase: 'sleep', locationId: 'quarters', activityId: 'sleep' },
		{ startSeconds: 5 * 3600, endSeconds: 6 * 3600, phase: 'travel', locationId: 'gate', activityId: 'gate-travel' },
		{ startSeconds: 6 * 3600, endSeconds: 12 * 3600, phase: 'guard', locationId: 'gate', activityId: 'gate-guard' },
		{ startSeconds: 12 * 3600, endSeconds: 18 * 3600, phase: 'patrol', locationId: 'gate', activityId: 'gate-patrol' },
		{ startSeconds: 18 * 3600, endSeconds: 22 * 3600, phase: 'travel', locationId: 'quarters', activityId: 'quarters-travel' },
		{ startSeconds: 22 * 3600, endSeconds: 24 * 3600, phase: 'rest', locationId: 'quarters', activityId: 'rest' },
	],
};

assert.equal(auditOccupationSchedule(definition).ok, true);
assert.equal(chooseOccupationPhase(definition, 6 * 3600 + 1).phase, 'guard');
assert.equal(chooseOccupationPhase(definition, 13 * 3600).phase, 'patrol');
assert.equal(chooseOccupationPhase(definition, 23 * 3600).phase, 'rest');
assert.equal(occupationSnapshot(definition, 6 * 3600 + 1, { x: 90, z: 10 }).target.id, 'gate');
assert(estimateOccupationTravelSeconds(definition, 5 * 3600 + 10, { x: 50, z: 10 }).travelSeconds > 0);
assert.equal(occupationPhaseTimeline(definition).length, 6);
assert.equal(occupationDigest(definition), occupationDigest(JSON.parse(JSON.stringify(definition))));

const state = createOccupationScheduleState(definition, 5 * 3600 + 50);
const before = state.phase;
const first = advanceOccupationSchedule(state, 20, { currentPosition: { x: 96, z: 14 } });
assert.equal(first.phase, before);
assert(first.nextChangeSeconds > 0);
const transition = advanceOccupationSchedule(state, 3600, { currentPosition: { x: 98, z: 13 } });
assert.equal(transition.phase, 'guard');
assert.equal(transition.changed, true);
assert.equal(transition.previousPhase, 'travel');
assert(transition.transitionProgress < 1);
const invalid = auditOccupationSchedule({ id: 'bad', schedule: [{ start: 0, end: 30, phase: 'not-real' }] });
assert.equal(invalid.ok, false);
assert(invalid.errors.some((entry) => entry.includes('unknown-phase')));

console.log(JSON.stringify({
	pass: true,
	before,	after: transition.phase,
	nextChangeSeconds: transition.nextChangeSeconds,
	digest: occupationDigest(definition),
}, null, 2));

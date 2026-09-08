import assert from 'node:assert/strict';
import {
	LIVING_WORLD_EVENT_DIRECTOR_POLICY,
	scoreAmbientEvent,
	createEventDirectorState,
	advanceEventDirector,
	createWorldEventPublisherAdapter,
	buildAmbientWorldEventReceipt,
	auditEventDirectorState,
} from '../src/3d/gameplay/livingWorldEventDirectorAdapter.js';

const context = {
	worldSeed: 'westeros-seed',
	clockSeconds: 20 * 3600,
	playerX: 120,
	playerZ: -80,
	biome: 'forest',
	threatLevel: 0.92,
	populationDensity: 0.6,
	weatherPressure: 0.65,
	settlementActivity: 0.5,
	wildlifeActivity: 0.85,
	roadActivity: 0.55,
	nearestSettlementDistanceMeters: 260,
	nearestRoadDistanceMeters: 30,
};

for (const type of LIVING_WORLD_EVENT_DIRECTOR_POLICY.ambientTypes) {
	const scored = scoreAmbientEvent(type, context);
	assert.equal(scored.type, type);
	assert(Number.isFinite(scored.score));
	assert(scored.score >= 0 && scored.score <= 1);
}

const forestWildlife = scoreAmbientEvent('wildlife_surge', context);
assert.equal(forestWildlife.accepted, true);
const invalid = scoreAmbientEvent('not-an-event', context);
assert.equal(invalid.accepted, false);
assert.equal(invalid.reasons[0], 'unknown-type');

const state = createEventDirectorState('seed-a', context.clockSeconds);
assert.equal(auditEventDirectorState(state).ok, true);
const first = advanceEventDirector(state, 1, context, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
assert(first.emitted >= 0 && first.emitted <= 2);
for (const event of first.candidates) {
	assert(event.sequence > 0);
	assert(event.location && Number.isFinite(event.location.x) && Number.isFinite(event.location.z));
	assert.equal(buildAmbientWorldEventReceipt(event, context)?.deterministic, true);
}
const beforeSequence = state.sequence;
const cooldownResult = advanceEventDirector(state, 1, context, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
assert(cooldownResult.sequence >= beforeSequence);

const publisherCalls = [];
const publisher = createWorldEventPublisherAdapter({
	publish: (payload) => { publisherCalls.push(payload); return payload.id; },
});
if (first.candidates[0]) {
	const receipt = buildAmbientWorldEventReceipt(first.candidates[0], context);
	assert.equal(publisher.emit(receipt).accepted, true);
	assert.equal(publisherCalls.length, 1);
}
const badPublisher = createWorldEventPublisherAdapter({ publish: () => { throw new Error('boom'); } });
assert.equal(badPublisher.emit({ type: 'guard_alert' }).accepted, false);

const repeatA = createEventDirectorState('same', context.clockSeconds);
const repeatB = createEventDirectorState('same', context.clockSeconds);
const resultA = advanceEventDirector(repeatA, 1, context, { types: ['guard_alert', 'wildlife_surge', 'traveller_sighting'], maxEmissions: 3 });
const resultB = advanceEventDirector(repeatB, 1, context, { types: ['guard_alert', 'wildlife_surge', 'traveller_sighting'], maxEmissions: 3 });
assert.deepEqual(resultA, resultB);

console.log(JSON.stringify({
	pass: true,
	firstEmitted: first.emitted,
	sequence: state.sequence,
	published: publisherCalls.length,
	digest: JSON.stringify(resultA),
}, null, 2));

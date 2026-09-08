import assert from 'node:assert/strict';
import {
	LIVING_WORLD_RUNTIME_OBSERVATION_POLICY,
	normalizeRuntimeObservationSample,
	summarizeRuntimeObservationWindow,
	buildRuntimeObservationReceipt,
	auditRuntimeObservationSummary,
} from '../src/3d/gameplay/livingWorldRuntimeObservationPolicy.js';

const base = (overrides = {}) => normalizeRuntimeObservationSample({
	frameMs: 12,
	tickMs: 1.5,
	actors: 20,
	activeActors: 18,
	skippedActors: 2,
	errors: 0,
	worldEvents: 2,
	eventCandidates: 4,
	threatRatio: 0.25,
	cohesionRatio: 0.92,
	materialValidated: true,
	placementValidated: true,
	...overrides,
});

const a = summarizeRuntimeObservationWindow([base(), base({ frameMs: 15 }), base({ frameMs: 16 })], { windowId: 'window-a' });
const b = summarizeRuntimeObservationWindow([base(), base({ frameMs: 15 }), base({ frameMs: 16 })], { windowId: 'window-a' });
assert.deepEqual(a, b);
assert.equal(a.accepted, true);
assert.equal(a.performance.withinFrameBudget, true);
assert.equal(a.performance.withinTickBudget, true);
assert.equal(a.population.peakActors, 20);
assert.equal(a.world.errorTotal, 0);
assert.equal(a.evidence.materialValidated, true);
assert.equal(a.evidence.placementValidated, true);
assert.equal(a.sampleCount, 3);
assert.equal(a.windowId, 'window-a');
assert.equal(a.digest, b.digest);
assert.equal(auditRuntimeObservationSummary(a).ok, true);

const badFrame = summarizeRuntimeObservationWindow([base({ frameMs: 24 })], { windowId: 'frame-bad' });
assert.equal(badFrame.accepted, false);
assert.equal(badFrame.reason, 'frame-budget');

const badTick = summarizeRuntimeObservationWindow([base({ tickMs: 5 })], { windowId: 'tick-bad' });
assert.equal(badTick.accepted, false);
assert.equal(badTick.reason, 'tick-budget');

const badEvidence = summarizeRuntimeObservationWindow([base({ materialValidated: false })], { windowId: 'material-bad' });
assert.equal(badEvidence.accepted, false);
assert.equal(badEvidence.reason, 'material-evidence');

const badPlacement = summarizeRuntimeObservationWindow([base({ placementValidated: false })], { windowId: 'placement-bad' });
assert.equal(badPlacement.accepted, false);
assert.equal(badPlacement.reason, 'placement-evidence');

const badErrors = summarizeRuntimeObservationWindow([base({ errors: 9 })], { windowId: 'errors-bad' });
assert.equal(badErrors.accepted, false);
assert.equal(badErrors.reason, 'errors');

const empty = summarizeRuntimeObservationWindow([], { windowId: 'empty' });
assert.equal(empty.accepted, false);
assert.equal(empty.reason, 'empty-window');

const bounded = summarizeRuntimeObservationWindow(Array.from({ length: 150 }, (_, index) => base({ frameMs: 10 + index / 100 })), { windowId: 'bounded' });
assert.equal(bounded.sampleCount, LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.maxWindowSamples);
assert.equal(bounded.accepted, true);

const malformed = normalizeRuntimeObservationSample({
	frameMs: Number.NaN,
	tickMs: Infinity,
	actors: 99999,
	activeActors: -4,
	skippedActors: 99999,
	errors: -5,
	threatRatio: 9,
	cohesionRatio: -2,
	materialValidated: false,
	placementValidated: false,
});
assert.equal(malformed.frameMs, 0);
assert.equal(malformed.tickMs, 0);
assert.equal(malformed.actors, LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.maxActorCount);
assert.equal(malformed.activeActors, 0);
assert.equal(malformed.skippedActors, malformed.actors);
assert.equal(malformed.errors, 0);
assert.equal(malformed.threatRatio, 1);
assert.equal(malformed.cohesionRatio, 0);

const receipt = buildRuntimeObservationReceipt(a, { source: 'test' });
assert.equal(receipt.policyId, LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.id);
assert.equal(receipt.deterministic, true);
assert.equal(receipt.source, 'test');
assert.equal(receipt.accepted, true);
assert.equal(receipt.windowId, 'window-a');
assert.equal(receipt.sampleCount, 3);
assert.equal(receipt.digest, a.digest);

const invalidAudit = auditRuntimeObservationSummary({
	sampleCount: 121,
	performance: { frameP95Ms: -1, tickP95Ms: 2 },
	population: { peakActors: 700 },
	world: { errorTotal: -1 },
});
assert.equal(invalidAudit.ok, false);
assert(invalidAudit.errors.includes('sample-overflow'));
assert(invalidAudit.errors.includes('negative-latency'));
assert(invalidAudit.errors.includes('actor-overflow'));
assert(invalidAudit.errors.includes('negative-errors'));

console.log(JSON.stringify({
	pass: true,
	windowDigest: a.digest,
	frameP95Ms: a.performance.frameP95Ms,
	tickP95Ms: a.performance.tickP95Ms,
	peakActors: a.population.peakActors,
}, null, 2));
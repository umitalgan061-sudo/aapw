import assert from 'node:assert/strict';
import * as THREE from '../src/3d/vendor/three/three.module.js';
import { createLivingWorldDirector, auditDirectorPolicy, directorDigest } from '../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js';
import { normalizeOccupationDefinition, buildOccupationDirective, occupationDigest } from '../src/3d/gameplay/livingWorldOccupationSchedule.js';
import { evaluateHabitat, planFaunaGroup, auditEcologyPlan, normalizeEcologyContext } from '../src/3d/gameplay/livingWorldEcologyPolicy.js';
import { createEventDirectorState, advanceEventDirector, buildAmbientWorldEventReceipt, LIVING_WORLD_EVENT_DIRECTOR_POLICY } from '../src/3d/gameplay/livingWorldEventDirectorAdapter.js';
import { collectLivingWorldRuntimeEvidence, validateLivingWorldRuntimeEvidence, buildLivingWorldAcceptanceSummary, runtimeEvidenceDigest, LIVING_WORLD_RUNTIME_EVIDENCE_POLICY, summarizeLivingWorldObservationWindow, buildLivingWorldObservationReceipt, validateLivingWorldObservationSummary, analyzeLivingWorldObservationTrend, buildLivingWorldObservationAcceptance } from '../src/3d/gameplay/livingWorldRuntimeEvidence.js';

const occupation = normalizeOccupationDefinition({
	id: 'farmer-1', seed: 'farmer-seed', travelSpeedMps: 1.5,
	anchors: [{ id: 'field', x: 40, z: 25, type: 'worksite' }, { id: 'home', x: 5, z: 8, type: 'home' }],
	schedule: [
		{ startSeconds: 6 * 3600, endSeconds: 12 * 3600, phase: 'travel', locationId: 'field', activityId: 'field-travel' },
		{ startSeconds: 12 * 3600, endSeconds: 18 * 3600, phase: 'work', locationId: 'field', activityId: 'field-work' },
		{ startSeconds: 18 * 3600, endSeconds: 22 * 3600, phase: 'travel', locationId: 'home', activityId: 'home-travel' },
		{ startSeconds: 22 * 3600, endSeconds: 6 * 3600, phase: 'rest', locationId: 'home', activityId: 'sleep' },
	],
});
assert.equal(occupation.id, 'farmer-1');
assert.equal(occupation.schedule.length, 4);
assert.equal(occupationDigest(occupation), occupationDigest(normalizeOccupationDefinition(occupation)));
const midday = buildOccupationDirective(occupation, 13 * 3600, { x: 5, z: 8 });
assert.equal(midday.snapshot.phase, 'work');
assert.equal(midday.snapshot.locationId, 'field');
assert.equal(midday.snapshot.target.id, 'field');

const snowWolfContext = normalizeEcologyContext({ biome: 'snow', temperatureC: -5, moisture: 0.5, slopeDegrees: 24, waterDepthMeters: 0, distanceToSettlementMeters: 450, distanceToRoadMeters: 80, clockSeconds: 2 * 3600 });
assert.equal(evaluateHabitat('wolf', snowWolfContext).accepted, true);
const wolfGroup = planFaunaGroup({ species: 'wolf', centerX: 100, centerZ: -120, radiusMeters: 30, seed: 'wolf-pack-1', context: snowWolfContext });
assert.equal(wolfGroup.accepted, true);
assert(wolfGroup.groupSize >= 2 && wolfGroup.groupSize <= 6);
assert.equal(auditEcologyPlan(wolfGroup).ok, true);
const badHabitat = evaluateHabitat('wolf', normalizeEcologyContext({ biome: 'desert', temperatureC: 42, distanceToSettlementMeters: 12, distanceToRoadMeters: 3 }));
assert.equal(badHabitat.accepted, false);

const eventContext = { worldSeed: 'world-seed', playerX: 100, playerZ: 100, biome: 'forest', threatLevel: 0.9, wildlifeActivity: 0.9, roadActivity: 0.5, populationDensity: 0.6, nearestSettlementDistanceMeters: 240, nearestRoadDistanceMeters: 30, clockSeconds: 19 * 3600 };
const eventStateA = createEventDirectorState('world-seed', 19 * 3600);
const eventStateB = createEventDirectorState('world-seed', 19 * 3600);
const eventsA = advanceEventDirector(eventStateA, 1, eventContext, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
const eventsB = advanceEventDirector(eventStateB, 1, eventContext, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
assert.deepEqual(eventsA, eventsB);
for (const event of eventsA.candidates) assert.equal(buildAmbientWorldEventReceipt(event, eventContext).deterministic, true);
assert.equal(LIVING_WORLD_EVENT_DIRECTOR_POLICY.maxCandidates, 24);

function makeController(id, x, z, state = 'patrol') {
	const object3D = new THREE.Object3D();
	object3D.name = id;
	object3D.position.set(x, 0, z);
	object3D.userData = {
		kind: id.includes('wolf') ? 'animal' : 'npc',
		npcPerception: { intent: state, suspicion: state === 'chase' ? 0.92 : 0.15, heard: state === 'investigate', lineOfSight: state !== 'investigate' },
		wildlifeFlee: { phase: id.includes('wolf') ? (state === 'flee' ? 'flee' : 'roam') : null, direct: state === 'flee', pack: false, recovering: false },
		materialEvidence: { validated: true, surfaceCount: 5, roles: ['skin', 'hair', 'cloth', 'leather', 'metal'], materialSlotCount: 5, uvPresent: true, paletteIds: ['human-1'], textures: [{ name: 'albedo', width: 1024, height: 1024, map: 'map' }] },
		placementEvidence: { accepted: true, groundAligned: true, navAligned: true, habitatAccepted: true, waterSafe: true, slopeSafe: true, placementDigest: 'p1', materialDigest: 'm1', provenance: '#590' },
	};
	return { id, object3D, currentState: state, updates: 0, update(delta) { assert(Number.isFinite(delta) && delta >= 0); this.updates += 1; } };
}

const npc = makeController('npc-farmer', 5, 8, 'patrol');
const wolf = makeController('wolf-1', 18, 18, 'flee');
const published = [];
const director = createLivingWorldDirector({ seed: 'director-seed', clockSeconds: 13 * 3600, worldEventPublisher: (payload) => { published.push(payload); return { accepted: true, id: payload.id }; } });
const tick = director.tick({ deltaSeconds: 0.16, collections: { npcs: [npc], animals: [wolf], creatures: [], dragons: [] }, playerPosition: { x: 0, z: 0 }, occupations: [{ controller: npc, definition: occupation }], faunaRequests: [{ species: 'wolf', centerX: 60, centerZ: 60, radiusMeters: 16, seed: 'group-1', context: snowWolfContext }], eventContext, eventTypes: ['guard_alert', 'wildlife_surge'] });
assert.equal(tick.accepted, true);
assert.equal(tick.actorsUpdated, 2);
assert.equal(npc.updates, 1);
assert.equal(wolf.updates, 1);
assert.equal(tick.occupations[0].accepted, true);
assert.equal(tick.fauna[0].audit.ok, true);
assert(auditDirectorPolicy(tick).ok);
assert.equal(directorDigest(tick), directorDigest(JSON.parse(JSON.stringify(tick))));
assert(published.every((payload) => payload?.deterministic === true));

const evidence = collectLivingWorldRuntimeEvidence({ actors: [npc, wolf], frameMs: 12.5, tickMs: 1.8, playerPosition: { x: 0, z: 0 } });
assert.equal(evidence.policyId, LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.id);
assert.equal(evidence.actorCount, 2);
assert.equal(evidence.placement.missingAssets, 0);
assert.equal(evidence.performance.withinFrameBudget, true);
assert.equal(validateLivingWorldRuntimeEvidence(evidence).ok, true);
const acceptance = buildLivingWorldAcceptanceSummary(evidence, tick);
assert.equal(acceptance.accepted, true);
assert.equal(acceptance.proof.assetMaterialValidated, true);
assert.equal(acceptance.proof.groundHabitatAligned, true);
assert.equal(runtimeEvidenceDigest(evidence), runtimeEvidenceDigest(JSON.parse(JSON.stringify(evidence))));
assert.equal(validateLivingWorldRuntimeEvidence({ ...evidence, placement: { ...evidence.placement, missingAssets: 1 } }).ok, false);

const observationSamples = [
	{ frameMs: 11.2, tickMs: 1.1, actors: 12, activeActors: 10, errors: 0, worldEvents: 1, eventCandidates: 2, threatRatio: 0.2, cohesionRatio: 0.9, materialValidated: true, placementValidated: true },
	{ frameMs: 14.4, tickMs: 1.8, actors: 18, activeActors: 17, errors: 0, worldEvents: 1, eventCandidates: 3, threatRatio: 0.35, cohesionRatio: 0.88, materialValidated: true, placementValidated: true },
	{ frameMs: 16.1, tickMs: 2.2, actors: 24, activeActors: 20, errors: 0, worldEvents: 2, eventCandidates: 4, threatRatio: 0.4, cohesionRatio: 0.86, materialValidated: true, placementValidated: true },
];
const observationA = summarizeLivingWorldObservationWindow(observationSamples, { windowId: 'director-window' });
const observationB = summarizeLivingWorldObservationWindow(observationSamples, { windowId: 'director-window' });
assert.deepEqual(observationA, observationB);
assert.equal(observationA.accepted, true);
assert.equal(observationA.performance.withinFrameBudget, true);
assert.equal(observationA.performance.withinTickBudget, true);
assert.equal(observationA.population.peakActors, 24);
assert.equal(observationA.world.errorTotal, 0);
assert.equal(observationA.evidence.materialValidated, true);
assert.equal(observationA.evidence.placementValidated, true);
assert.equal(observationA.sampleCount, 3);
assert.equal(observationA.digest, observationB.digest);
assert.equal(validateLivingWorldObservationSummary(observationA).ok, true);
const observationReceipt = buildLivingWorldObservationReceipt(observationA, { source: 'director-runtime' });
assert.equal(observationReceipt.policyId, `${LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.id}:observation`);
assert.equal(observationReceipt.deterministic, true);
assert.equal(observationReceipt.digest, observationA.digest);
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 24, tickMs: 1, actors: 1, materialValidated: true, placementValidated: true }]).reason, 'frame-budget');
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 5, actors: 1, materialValidated: true, placementValidated: true }]).reason, 'tick-budget');
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 1, actors: 1, materialValidated: false, placementValidated: true }]).reason, 'material-evidence');
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 1, actors: 1, materialValidated: true, placementValidated: false }]).reason, 'placement-evidence');
assert.equal(validateLivingWorldObservationSummary({ sampleCount: 121, performance: { frameP95Ms: -1, tickP95Ms: 1 }, population: { peakActors: 999 }, world: { errorTotal: -1 } }).ok, false);

const stableTrendSamples = Array.from({ length: 12 }, (_, index) => ({
	frameMs: 11.5 + (index % 2) * 0.4,
	tickMs: 1.2 + (index % 3) * 0.1,
	actors: 18 + (index % 3),
	activeActors: 16 + (index % 2),
	errors: 0,
	worldEvents: index % 2,
	eventCandidates: 2 + (index % 3),
	threatRatio: 0.2,
	cohesionRatio: 0.9,
	materialValidated: true,
	placementValidated: true,
}));
const stableTrendA = analyzeLivingWorldObservationTrend(stableTrendSamples, { windowId: 'stable-window' });
const stableTrendB = analyzeLivingWorldObservationTrend(stableTrendSamples, { windowId: 'stable-window' });
assert.deepEqual(stableTrendA, stableTrendB);
assert.equal(stableTrendA.degrading, false);
assert.equal(stableTrendA.reason, 'stable');
assert.equal(stableTrendA.sampleCount, 12);
assert.equal(stableTrendA.warnings.frame, false);
assert.equal(stableTrendA.warnings.tick, false);
assert.equal(stableTrendA.digest, stableTrendB.digest);
const stableAcceptance = buildLivingWorldObservationAcceptance(observationA, stableTrendA);
assert.equal(stableAcceptance.accepted, true);
assert.equal(stableAcceptance.reason, 'stable');
assert.equal(stableAcceptance.proof.performanceStable, true);
assert.equal(stableAcceptance.proof.materialValidated, true);
assert.equal(stableAcceptance.proof.placementValidated, true);

const frameRegressionSamples = stableTrendSamples.map((sample, index) => ({ ...sample, frameMs: index < 6 ? 12 : 15 + index * 0.35 }));
const frameTrend = analyzeLivingWorldObservationTrend(frameRegressionSamples, { windowId: 'frame-regression' });
assert.equal(frameTrend.degrading, true);
assert.equal(frameTrend.reason, 'frame-regression');
assert(frameTrend.frameDeltaMs > 1);
assert.equal(frameTrend.warnings.frame, true);
assert.equal(buildLivingWorldObservationAcceptance(observationA, frameTrend).accepted, false);

const tickRegressionSamples = stableTrendSamples.map((sample, index) => ({ ...sample, tickMs: index < 6 ? 1.2 : 2.5 + index * 0.2 }));
const tickTrend = analyzeLivingWorldObservationTrend(tickRegressionSamples, { windowId: 'tick-regression' });
assert.equal(tickTrend.degrading, true);
assert.equal(tickTrend.reason, 'tick-regression');
assert(tickTrend.tickDeltaMs > 0.75);
assert.equal(tickTrend.warnings.tick, true);

const errorBurstSamples = stableTrendSamples.map((sample, index) => ({ ...sample, errors: index < 4 ? 1 : 0 }));
const errorTrend = analyzeLivingWorldObservationTrend(errorBurstSamples, { windowId: 'error-burst' });
assert.equal(errorTrend.degrading, true);
assert.equal(errorTrend.reason, 'error-burst');
assert.equal(errorTrend.errorBurstCount, 4);

const actorPressureSamples = stableTrendSamples.map((sample) => ({ ...sample, actors: 500, activeActors: 490 }));
const actorTrend = analyzeLivingWorldObservationTrend(actorPressureSamples, { windowId: 'actor-pressure' });
assert.equal(actorTrend.degrading, true);
assert.equal(actorTrend.reason, 'actor-pressure');
assert(actorTrend.actorPressure > 0.9);

const warningThresholdTrend = analyzeLivingWorldObservationTrend([
	{ frameMs: 20.01, tickMs: 4.01, actors: 10, activeActors: 10, errors: 0, materialValidated: true, placementValidated: true },
	{ frameMs: 19.8, tickMs: 4.5, actors: 10, activeActors: 10, errors: 0, materialValidated: true, placementValidated: true },
], { windowId: 'warning-threshold', warningFrameMs: 20, warningTickMs: 5 });
assert.equal(warningThresholdTrend.warnings.frame, true);
assert.equal(warningThresholdTrend.warnings.tick, false);

const malformedObservationSummary = summarizeLivingWorldObservationWindow([
	{ frameMs: Number.NaN, tickMs: Infinity, actors: 99999, activeActors: -10, errors: -4, threatRatio: 8, cohesionRatio: -2, materialValidated: false, placementValidated: false },
], { windowId: 'malformed' });
assert.equal(malformedObservationSummary.sampleCount, 1);
assert.equal(malformedObservationSummary.population.peakActors, 512);
assert.equal(malformedObservationSummary.world.errorTotal, 0);
assert.equal(malformedObservationSummary.world.averageThreatRatio, 1);
assert.equal(malformedObservationSummary.world.averageCohesionRatio, 0);
assert.equal(malformedObservationSummary.evidence.materialValidated, false);
assert.equal(malformedObservationSummary.evidence.placementValidated, false);
assert.equal(validateLivingWorldObservationSummary(malformedObservationSummary).ok, true);

for (const actorCount of [0, 1, 8, 64, 512, 700]) {
	const result = summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 1, actors: actorCount, activeActors: actorCount, materialValidated: true, placementValidated: true }], { windowId: `actors-${actorCount}` });
	assert(result.population.peakActors <= 512);
	if (actorCount <= 512) assert.equal(result.accepted, true);
	else assert.equal(result.accepted, false);
}

for (const frameMs of [0, 5, 16.67, 16.68, 20, 33.34]) {
	const result = summarizeLivingWorldObservationWindow([{ frameMs, tickMs: 1, actors: 2, activeActors: 2, materialValidated: true, placementValidated: true }], { windowId: `frame-${frameMs}` });
	assert.equal(result.performance.withinFrameBudget, frameMs <= 16.67);
}

const alternatingTrendA = analyzeLivingWorldObservationTrend([
	{ frameMs: 10, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
	{ frameMs: 21, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
	{ frameMs: 10, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
	{ frameMs: 21, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
], { windowId: 'alternating' });
const alternatingTrendB = analyzeLivingWorldObservationTrend([
	{ frameMs: 10, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
	{ frameMs: 21, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
	{ frameMs: 10, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
	{ frameMs: 21, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true },
], { windowId: 'alternating' });
assert.deepEqual(alternatingTrendA, alternatingTrendB);
assert.equal(alternatingTrendA.degrading, false);
assert.equal(analyzeLivingWorldObservationTrend([]).reason, 'stable');
const rejectedAcceptance = buildLivingWorldObservationAcceptance({ accepted: false, reason: 'frame-budget', digest: 'x', performance: {}, evidence: {} }, stableTrendA);
assert.equal(rejectedAcceptance.accepted, false);
assert.equal(rejectedAcceptance.reason, 'frame-budget');

assert.equal(director.reset(), true);
assert.equal(director.audit().tickCount, 0);
assert.equal(director.dispose(), true);
assert.equal(director.tick({ deltaSeconds: 0.1 }).accepted, false);

console.log(JSON.stringify({ pass: true, occupationPhase: midday.snapshot.phase, wolfGroupSize: wolfGroup.groupSize, eventsPublished: published.length, actorsUpdated: tick.actorsUpdated, evidenceDigest: runtimeEvidenceDigest(evidence), observationDigest: observationA.digest, observationTrendDigest: stableTrendA.digest, acceptanceDigest: directorDigest(tick) }, null, 2));

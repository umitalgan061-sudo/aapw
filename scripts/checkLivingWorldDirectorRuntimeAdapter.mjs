import assert from 'node:assert/strict';
import * as THREE from '../src/3d/vendor/three/three.module.js';
import { createLivingWorldDirector, auditDirectorPolicy, directorDigest } from '../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js';
import { normalizeOccupationDefinition, buildOccupationDirective, occupationDigest } from '../src/3d/gameplay/livingWorldOccupationSchedule.js';
import { evaluateHabitat, planFaunaGroup, auditEcologyPlan, normalizeEcologyContext } from '../src/3d/gameplay/livingWorldEcologyPolicy.js';
import { createEventDirectorState, advanceEventDirector, buildAmbientWorldEventReceipt, LIVING_WORLD_EVENT_DIRECTOR_POLICY } from '../src/3d/gameplay/livingWorldEventDirectorAdapter.js';
import { collectLivingWorldRuntimeEvidence, validateLivingWorldRuntimeEvidence, buildLivingWorldAcceptanceSummary, runtimeEvidenceDigest, LIVING_WORLD_RUNTIME_EVIDENCE_POLICY, summarizeLivingWorldObservationWindow, buildLivingWorldObservationReceipt, validateLivingWorldObservationSummary, analyzeLivingWorldObservationTrend, buildLivingWorldObservationAcceptance } from '../src/3d/gameplay/livingWorldRuntimeEvidence.js';

const assertHealthyObservation = (summary) => {
	assert.equal(validateLivingWorldObservationSummary(summary).ok, true);
	assert.equal(summary.accepted, true);
};

const occupation = normalizeOccupationDefinition({ id: 'farmer-1', seed: 'farmer-seed', travelSpeedMps: 1.5, anchors: [{ id: 'field', x: 40, z: 25 }, { id: 'home', x: 5, z: 8 }], schedule: [{ startSeconds: 21600, endSeconds: 43200, phase: 'travel', locationId: 'field', activityId: 'field-travel' }, { startSeconds: 43200, endSeconds: 64800, phase: 'work', locationId: 'field', activityId: 'field-work' }, { startSeconds: 64800, endSeconds: 79200, phase: 'travel', locationId: 'home', activityId: 'home-travel' }, { startSeconds: 79200, endSeconds: 21600, phase: 'rest', locationId: 'home', activityId: 'sleep' }] });
assert.equal(occupationDigest(occupation), occupationDigest(normalizeOccupationDefinition(occupation)));
const midday = buildOccupationDirective(occupation, 46800, { x: 5, z: 8 });
assert.equal(midday.snapshot.phase, 'work');
assert.equal(midday.snapshot.target.id, 'field');

const snowWolfContext = normalizeEcologyContext({ biome: 'snow', temperatureC: -5, moisture: 0.5, slopeDegrees: 24, waterDepthMeters: 0, distanceToSettlementMeters: 450, distanceToRoadMeters: 80, clockSeconds: 7200 });
const wolfHabitat = evaluateHabitat('wolf', snowWolfContext);
assert.equal(wolfHabitat.accepted, true);
const wolfGroup = planFaunaGroup({ species: 'wolf', centerX: 100, centerZ: -120, radiusMeters: 30, seed: 'wolf-pack-1', context: snowWolfContext });
assert.equal(wolfGroup.accepted, true);
assert(wolfGroup.groupSize >= 2 && wolfGroup.groupSize <= 6);
assert.equal(auditEcologyPlan(wolfGroup).ok, true);
assert.equal(evaluateHabitat('wolf', normalizeEcologyContext({ biome: 'desert', temperatureC: 42, distanceToSettlementMeters: 12, distanceToRoadMeters: 3 })).accepted, false);

const eventContext = { worldSeed: 'world-seed', playerX: 100, playerZ: 100, biome: 'forest', threatLevel: 0.9, wildlifeActivity: 0.9, roadActivity: 0.5, populationDensity: 0.6, nearestSettlementDistanceMeters: 240, nearestRoadDistanceMeters: 30, clockSeconds: 68400 };
const eventsA = advanceEventDirector(createEventDirectorState('world-seed', 68400), 1, eventContext, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
const eventsB = advanceEventDirector(createEventDirectorState('world-seed', 68400), 1, eventContext, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
assert.deepEqual(eventsA, eventsB);
for (const event of eventsA.candidates) assert.equal(buildAmbientWorldEventReceipt(event, eventContext).deterministic, true);
assert.equal(LIVING_WORLD_EVENT_DIRECTOR_POLICY.maxCandidates, 24);

function makeController(id, x, z, state = 'patrol') {
	const object3D = new THREE.Object3D();
	object3D.name = id;
	object3D.position.set(x, 0, z);
	object3D.userData = { kind: id.includes('wolf') ? 'animal' : 'npc', npcPerception: { intent: state, suspicion: state === 'chase' ? 0.92 : 0.15, heard: state === 'investigate', lineOfSight: state !== 'investigate' }, wildlifeFlee: { phase: id.includes('wolf') ? (state === 'flee' ? 'flee' : 'roam') : null, direct: state === 'flee' }, materialEvidence: { validated: true, surfaceCount: 5, roles: ['skin', 'hair', 'cloth', 'leather', 'metal'], materialSlotCount: 5, uvPresent: true, paletteIds: ['human-1'], textures: [{ name: 'albedo', width: 1024, height: 1024, map: 'map' }] }, placementEvidence: { accepted: true, groundAligned: true, navAligned: true, habitatAccepted: true, waterSafe: true, slopeSafe: true, placementDigest: 'p1', materialDigest: 'm1', provenance: '#590' } };
	return { id, object3D, currentState: state, updates: 0, update(delta) { assert(Number.isFinite(delta) && delta >= 0); this.updates += 1; } };
}

const npc = makeController('npc-farmer', 5, 8);
const wolf = makeController('wolf-1', 18, 18, 'flee');
const published = [];
const director = createLivingWorldDirector({ seed: 'director-seed', clockSeconds: 46800, worldEventPublisher: (payload) => { published.push(payload); return { accepted: true, id: payload.id }; } });
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
assert.equal(validateLivingWorldRuntimeEvidence(evidence).ok, true);
const acceptance = buildLivingWorldAcceptanceSummary(evidence, tick);
assert.equal(acceptance.accepted, true);
assert.equal(acceptance.proof.assetMaterialValidated, true);
assert.equal(acceptance.proof.groundHabitatAligned, true);
assert.equal(runtimeEvidenceDigest(evidence), runtimeEvidenceDigest(JSON.parse(JSON.stringify(evidence))));
assert.equal(validateLivingWorldRuntimeEvidence({ ...evidence, placement: { ...evidence.placement, missingAssets: 1 } }).ok, false);

const samples = Array.from({ length: 12 }, (_, index) => ({ frameMs: 11.5 + (index % 2) * 0.4, tickMs: 1.2 + (index % 3) * 0.1, actors: 18 + (index % 3), activeActors: 16 + (index % 2), errors: 0, worldEvents: index % 2, eventCandidates: 2 + (index % 3), threatRatio: 0.2, cohesionRatio: 0.9, materialValidated: true, placementValidated: true }));
const observation = summarizeLivingWorldObservationWindow(samples, { windowId: 'director-window' });
assertHealthyObservation(observation);
const receipt = buildLivingWorldObservationReceipt(observation, { source: 'director-runtime' });
assert.equal(receipt.deterministic, true);
assert.equal(receipt.digest, observation.digest);
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 24, tickMs: 1, actors: 1, materialValidated: true, placementValidated: true }]).reason, 'frame-budget');
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 5, actors: 1, materialValidated: true, placementValidated: true }]).reason, 'tick-budget');
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 1, actors: 1, materialValidated: false, placementValidated: true }]).reason, 'material-evidence');
assert.equal(summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 1, actors: 1, materialValidated: true, placementValidated: false }]).reason, 'placement-evidence');

const stableTrendA = analyzeLivingWorldObservationTrend(samples, { windowId: 'stable-window' });
const stableTrendB = analyzeLivingWorldObservationTrend(samples, { windowId: 'stable-window' });
assert.deepEqual(stableTrendA, stableTrendB);
assert.equal(stableTrendA.degrading, false);
assert.equal(stableTrendA.reason, 'stable');
assert.equal(buildLivingWorldObservationAcceptance(observation, stableTrendA).accepted, true);

const frameTrend = analyzeLivingWorldObservationTrend(samples.map((sample, index) => ({ ...sample, frameMs: index < 6 ? 12 : 15 + index * 0.35 })), { windowId: 'frame-regression' });
assert.equal(frameTrend.degrading, true);
assert.equal(frameTrend.reason, 'frame-regression');
assert.equal(buildLivingWorldObservationAcceptance(observation, frameTrend).accepted, false);
const tickTrend = analyzeLivingWorldObservationTrend(samples.map((sample, index) => ({ ...sample, tickMs: index < 6 ? 1.2 : 2.5 + index * 0.2 })), { windowId: 'tick-regression' });
assert.equal(tickTrend.degrading, true);
assert.equal(tickTrend.reason, 'tick-regression');
const errorTrend = analyzeLivingWorldObservationTrend(samples.map((sample, index) => ({ ...sample, errors: index < 4 ? 1 : 0 })), { windowId: 'error-burst' });
assert.equal(errorTrend.degrading, true);
assert.equal(errorTrend.reason, 'error-burst');
const actorTrend = analyzeLivingWorldObservationTrend(samples.map((sample) => ({ ...sample, actors: 500, activeActors: 490 })), { windowId: 'actor-pressure' });
assert.equal(actorTrend.degrading, true);
assert.equal(actorTrend.reason, 'actor-pressure');
assert(analyzeLivingWorldObservationTrend([10, 21, 10, 21].map((frameMs) => ({ frameMs, tickMs: 1, actors: 8, activeActors: 8, errors: 0, materialValidated: true, placementValidated: true }))).degrading === false);

for (const actorCount of [0, 1, 8, 64, 512, 700]) {
	const result = summarizeLivingWorldObservationWindow([{ frameMs: 10, tickMs: 1, actors: actorCount, activeActors: actorCount, materialValidated: true, placementValidated: true }], { windowId: `actors-${actorCount}` });
	assert(result.population.peakActors <= 512);
	assert.equal(result.accepted, actorCount <= 512 && actorCount > 0);
}

assert.equal(director.reset(), true);
assert.equal(director.audit().tickCount, 0);
assert.equal(director.dispose(), true);
assert.equal(director.tick({ deltaSeconds: 0.1 }).accepted, false);

console.log(JSON.stringify({ pass: true, occupationPhase: midday.snapshot.phase, wolfGroupSize: wolfGroup.groupSize, eventsPublished: published.length, actorsUpdated: tick.actorsUpdated, evidenceDigest: runtimeEvidenceDigest(evidence), observationDigest: observation.digest, observationTrendDigest: stableTrendA.digest, acceptanceDigest: directorDigest(tick) }, null, 2));

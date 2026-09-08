import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	createLivingWorldDirector,
	auditDirectorPolicy,
	directorDigest,
} from '../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js';
import {
	normalizeOccupationDefinition,
	buildOccupationDirective,
	occupationDigest,
} from '../src/3d/gameplay/livingWorldOccupationSchedule.js';
import {
	evaluateHabitat,
	planFaunaGroup,
	auditEcologyPlan,
	normalizeEcologyContext,
} from '../src/3d/gameplay/livingWorldEcologyPolicy.js';
import {
	createEventDirectorState,
	advanceEventDirector,
	buildAmbientWorldEventReceipt,
	LIVING_WORLD_EVENT_DIRECTOR_POLICY,
} from '../src/3d/gameplay/livingWorldEventDirectorAdapter.js';
import {
	collectLivingWorldRuntimeEvidence,
	validateLivingWorldRuntimeEvidence,
	buildLivingWorldAcceptanceSummary,
	runtimeEvidenceDigest,
	LIVING_WORLD_RUNTIME_EVIDENCE_POLICY,
} from '../src/3d/gameplay/livingWorldRuntimeEvidence.js';

const approx = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

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
	return {
		id,
		object3D,
		currentState: state,
		updates: 0,
		update(delta) {
			assert(Number.isFinite(delta) && delta >= 0);
			this.updates += 1;
		},
	};
}

const occupation = normalizeOccupationDefinition({
	id: 'farmer-1',
	seed: 'farmer-seed',
	travelSpeedMps: 1.5,
	anchors: [
		{ id: 'field', x: 40, z: 25, type: 'worksite' },
		{ id: 'home', x: 5, z: 8, type: 'home' },
	],
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
assert.equal(midday.snapshot.locomotion, 'walk');
assert.equal(midday.snapshot.target.id, 'field');
assert(midday.snapshot.target.distanceMeters > 0);

const snowWolfContext = normalizeEcologyContext({ biome: 'snow', temperatureC: -5, moisture: 0.5, slopeDegrees: 24, waterDepthMeters: 0, distanceToSettlementMeters: 450, distanceToRoadMeters: 80, clockSeconds: 2 * 3600 });
const wolfHabitat = evaluateHabitat('wolf', snowWolfContext);
assert.equal(wolfHabitat.accepted, true);
const wolfGroup = planFaunaGroup({ species: 'wolf', centerX: 100, centerZ: -120, radiusMeters: 30, seed: 'wolf-pack-1', context: snowWolfContext });
assert.equal(wolfGroup.accepted, true);
assert(wolfGroup.groupSize >= 2 && wolfGroup.groupSize <= 6);
assert.equal(auditEcologyPlan(wolfGroup).ok, true);

const badHabitat = evaluateHabitat('wolf', normalizeEcologyContext({ biome: 'desert', temperatureC: 42, distanceToSettlementMeters: 12, distanceToRoadMeters: 3 }));
assert.equal(badHabitat.accepted, false);
assert(badHabitat.reasons.length > 0);

const eventStateA = createEventDirectorState('world-seed', 19 * 3600);
const eventStateB = createEventDirectorState('world-seed', 19 * 3600);
const eventContext = { worldSeed: 'world-seed', playerX: 100, playerZ: 100, biome: 'forest', threatLevel: 0.9, wildlifeActivity: 0.9, roadActivity: 0.5, populationDensity: 0.6, nearestSettlementDistanceMeters: 240, nearestRoadDistanceMeters: 30, clockSeconds: 19 * 3600 };
const eventsA = advanceEventDirector(eventStateA, 1, eventContext, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
const eventsB = advanceEventDirector(eventStateB, 1, eventContext, { types: ['guard_alert', 'wildlife_surge'], maxEmissions: 2 });
assert.deepEqual(eventsA, eventsB);
for (const event of eventsA.candidates) assert.equal(buildAmbientWorldEventReceipt(event, eventContext).deterministic, true);
assert.equal(LIVING_WORLD_EVENT_DIRECTOR_POLICY.maxCandidates, 24);

const npc = makeController('npc-farmer', 5, 8, 'patrol');
const wolf = makeController('wolf-1', 18, 18, 'flee');
const published = [];
const director = createLivingWorldDirector({
	seed: 'director-seed',
	clockSeconds: 13 * 3600,
	worldEventPublisher: (payload) => { published.push(payload); return { accepted: true, id: payload.id }; },
});
const tick = director.tick({
	deltaSeconds: 0.16,
	collections: { npcs: [npc], animals: [wolf], creatures: [], dragons: [] },
	playerPosition: { x: 0, z: 0 },
	occupations: [{ controller: npc, definition: occupation }],
	faunaRequests: [{ species: 'wolf', centerX: 60, centerZ: 60, radiusMeters: 16, seed: 'group-1', context: snowWolfContext }],
	eventContext,
	eventTypes: ['guard_alert', 'wildlife_surge'],
});
assert.equal(tick.accepted, true);
assert.equal(tick.actorsUpdated, 2);
assert.equal(npc.updates, 1);
assert.equal(wolf.updates, 1);
assert.equal(tick.occupations[0].accepted, true);
assert.equal(tick.fauna[0].audit.ok, true);
assert(auditDirectorPolicy(tick).ok);
const tickDigest = directorDigest(tick);
assert.equal(tickDigest, directorDigest(JSON.parse(JSON.stringify(tick))));
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

const invalidEvidence = { ...evidence, placement: { ...evidence.placement, missingAssets: 1 } };
assert.equal(validateLivingWorldRuntimeEvidence(invalidEvidence).ok, false);

const postReset = director.reset();
assert.equal(postReset, true);
assert.equal(director.audit().tickCount, 0);
assert.equal(director.dispose(), true);
assert.equal(director.tick({ deltaSeconds: 0.1 }).accepted, false);

console.log(JSON.stringify({
	pass: true,
	occupationPhase: midday.snapshot.phase,
	wolfGroupSize: wolfGroup.groupSize,
	eventsPublished: published.length,
	actorsUpdated: tick.actorsUpdated,
	evidenceDigest: runtimeEvidenceDigest(evidence),
	acceptanceDigest: directorDigest(tick),
}, null, 2));

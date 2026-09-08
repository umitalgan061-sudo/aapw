import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
	if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
	await page.goto(`${baseUrl}/game3d.html?livingWorldDirectorProof=1`, { waitUntil: 'domcontentloaded' });
	const result = await page.evaluate(async () => {
		const THREE = await import('./src/3d/vendor/three/three.module.js');
		const {
			createLivingWorldDirector,
			directorDigest,
			auditDirectorPolicy,
		} = await import('./src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js');
		const {
			collectLivingWorldRuntimeEvidence,
			validateLivingWorldRuntimeEvidence,
			buildLivingWorldAcceptanceSummary,
		} = await import('./src/3d/gameplay/livingWorldRuntimeEvidence.js');
		const {
			buildGroupFormationTargets,
			evaluateGroupCohesion,
			summarizeGroupThreat,
		} = await import('./src/3d/gameplay/livingWorldGroupAiPolicy.js');

		const makeActor = (name, x, z, kind, state) => {
			const object3D = new THREE.Object3D();
			object3D.name = name;
			object3D.position.set(x, 0, z);
			object3D.userData = {
				kind,
				npcPerception: { intent: state, suspicion: state === 'chase' ? 0.9 : 0.12, heard: state === 'investigate', lineOfSight: true },
				wildlifeFlee: { phase: state === 'flee' ? 'flee' : 'roam', direct: state === 'flee', pack: false, recovering: false },
				materialEvidence: {
					validated: true,
					surfaceCount: kind === 'npc' ? 5 : 4,
					roles: kind === 'npc' ? ['skin', 'hair', 'cloth', 'boots', 'gear'] : ['fur', 'eye', 'claw', 'tooth'],
					materialSlotCount: kind === 'npc' ? 5 : 4,
					uvPresent: true,
					paletteIds: [kind === 'npc' ? 'npc-real-1' : 'wolf-real-1'],
					textures: [{ name: 'albedo', width: 1024, height: 1024, map: 'map' }],
				},
				placementEvidence: {
					accepted: true,
					groundAligned: true,
					navAligned: true,
					habitatAccepted: true,
					waterSafe: true,
					slopeSafe: true,
					placementDigest: `placement-${name}`,
					materialDigest: `material-${name}`,
					provenance: '#590',
				},
			};
			return {
				id: name,
				object3D,
				currentState: state,
				updates: 0,
				update(delta) {
					this.updates += Number(delta >= 0);
				},
			};
		};

		const npc = makeActor('guard-1', 6, 4, 'npc', 'patrol');
		const wolf = makeActor('wolf-1', 18, 12, 'animal', 'flee');
		const occupation = {
			id: 'guard-shift',
			seed: 'browser-seed',
			anchors: [{ id: 'gate', x: 12, z: 8, type: 'guard-post' }],
			schedule: [
				{ startSeconds: 0, endSeconds: 21600, phase: 'rest', locationId: 'gate' },
				{ startSeconds: 21600, endSeconds: 64800, phase: 'guard', locationId: 'gate', activityId: 'gate-watch' },
				{ startSeconds: 64800, endSeconds: 86400, phase: 'rest', locationId: 'gate', activityId: 'gate-rest' },
			],
		};
		const published = [];
		const director = createLivingWorldDirector({
			seed: 'browser-director',
			clockSeconds: 22000,
			worldEventPublisher: (payload) => { published.push(payload); return payload.id; },
		});
		const before = [npc.updates, wolf.updates];
		const snapshot = director.tick({
			deltaSeconds: 0.1,
			collections: { npcs: [npc], animals: [wolf], creatures: [], dragons: [] },
			playerPosition: { x: 0, z: 0 },
			occupations: [{ controller: npc, definition: occupation }],
			faunaRequests: [{ species: 'wolf', centerX: 100, centerZ: 90, radiusMeters: 18, seed: 'browser-wolf', context: {
				biome: 'forest', temperatureC: 8, moisture: 0.55, slopeDegrees: 12, waterDepthMeters: 0,
				distanceToSettlementMeters: 320, distanceToRoadMeters: 90, clockSeconds: 22000,
			} }],
			eventContext: {
				worldSeed: 'browser-director', playerX: 0, playerZ: 0, biome: 'forest', threatLevel: 0.75,
				populationDensity: 0.4, weatherPressure: 0.4, settlementActivity: 0.6, wildlifeActivity: 0.8,
				roadActivity: 0.7, nearestSettlementDistanceMeters: 250, nearestRoadDistanceMeters: 30,
				clockSeconds: 22000,
			},
			eventTypes: ['wildlife_surge', 'traveller_sighting', 'guard_alert'],
		});
		const after = [npc.updates, wolf.updates];
		if (after[0] !== before[0] + 1 || after[1] !== before[1] + 1) throw new Error('controller tick contract failed');
		if (!auditDirectorPolicy(snapshot).ok) throw new Error('director audit failed');

		const evidence = collectLivingWorldRuntimeEvidence({ actors: [npc, wolf], frameMs: 11.6, tickMs: 1.2, playerPosition: { x: 0, z: 0 } });
		const evidenceValidation = validateLivingWorldRuntimeEvidence(evidence);
		if (!evidenceValidation.ok) throw new Error(`evidence invalid: ${evidenceValidation.errors.join(',')}`);
		const acceptance = buildLivingWorldAcceptanceSummary(evidence, snapshot);
		if (!acceptance.accepted || acceptance.proof.assetMaterialValidated !== true) throw new Error('acceptance summary failed');

		const groupMembers = [npc, makeActor('guard-2', 8, 5, 'npc', 'patrol'), makeActor('guard-3', 10, 6, 'npc', 'patrol')];
		const cohesion = evaluateGroupCohesion(groupMembers, { cohesionRadiusMeters: 7, leaderId: 'guard-1' });
		const threat = summarizeGroupThreat(groupMembers, [{ x: 7, z: 5 }], { threatRadiusMeters: 5 });
		const formation = buildGroupFormationTargets(groupMembers, { leaderId: 'guard-1', seed: 'browser-formation' });
		if (!cohesion.accepted || threat.groupIntent !== 'investigate' || formation.length !== 2) throw new Error('group policy failed');

		return {
			directorDigest: directorDigest(snapshot),
			evidenceDigest: acceptance.digest,
			actorsUpdated: snapshot.actorsUpdated,
			eventsEmitted: published.length,
			groupIntent: threat.groupIntent,
			cohesionRatio: cohesion.cohesionRatio,
			formationCount: formation.length,
		};
	});

	assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
	assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
	assert.equal(result.actorsUpdated, 2);
	assert.equal(result.groupIntent, 'investigate');
	assert.equal(result.formationCount, 2);
	console.log(JSON.stringify({ pass: true, ...result }, null, 2));
} finally {
	await browser.close();
}

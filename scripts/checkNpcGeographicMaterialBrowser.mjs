#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

function assertFiniteRecord(record, label) {
	assert.ok(record && Object.values(record).every(Number.isFinite), `${label} contains non-finite values: ${JSON.stringify(record)}`);
}

const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	const pageErrors = [];
	const consoleErrors = [];
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	await page.goto(`${baseUrl}/service-worker.js`, { waitUntil: 'domcontentloaded', timeout: 10000 });
	await page.addScriptTag({
		type: 'importmap',
		content: JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} }),
	});

	const proof = await page.evaluate(async () => {
		const { NPC_CONFIG } = await import('/src/3d/gameplay/npcConfig.js');
		const { spawnConfiguredNPCs } = await import('/src/3d/gameplay/npc.js');
		const {
			resolveConfiguredNpcPatrol,
			resolveConfiguredNpcSpawnPlacement,
		} = await import('/src/3d/gameplay/npcWorldPlacement.js');
		const { AssetLoader } = await import('/src/3d/assetLoader.js');
		const { EventBus } = await import('/src/3d/eventBus.js');
		const { EVENTS, SETTLEMENT_CONFIG, WORLD_DEFAULTS, WORLD_SCALE } = await import('/src/3d/config.js');
		const { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
		const { createHeightSampler } = await import('/src/3d/world/terrain.js');

		const events = new EventBus();
		const assetErrors = [];
		events.on(EVENTS.ASSET_ERROR, (payload) => assetErrors.push(payload?.url ?? 'unknown'));
		const assetLoader = new AssetLoader({ events });
		const rawHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
		const flattenPads = computeSettlementFlattenPads({
			sampleHeightMeters: rawHeight,
			seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
			minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
			mapBounds: WORLD_SCALE.MAP_BOUNDS,
			metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
		});
		const gameplayHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
		const seatsById = new Map(KINGDOM_SEATS.map((seat) => {
			const world = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
			return [seat.id, { ...seat, x: world.x, z: world.z }];
		}));
		const groundCollider = { getGroundHeight: gameplayHeight };
		const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };

		const distributionAudit = NPC_CONFIG.SPAWNS.map((spawn) => {
			const seat = seatsById.get(spawn.seatId);
			if (!seat) return { id: spawn.id, ok: false, error: 'missing-seat' };
			const placement = resolveConfiguredNpcSpawnPlacement({ spawn, seat, sampleGroundHeight: gameplayHeight });
			const patrol = placement.ok ? resolveConfiguredNpcPatrol(spawn, seat, placement, gameplayHeight) : null;
			return {
				id: spawn.id,
				modelUrl: spawn.modelUrl,
				seatId: spawn.seatId,
				ok: placement.ok,
				error: placement.error ?? null,
				baseSurface: placement.geography?.baseSurface ?? null,
				rawBaseSurface: placement.geography?.rawBaseSurface ?? null,
				seatProtectedLand: placement.geography?.seatProtectedLand ?? false,
				seatProtectedLandWeight: placement.geography?.seatProtectedLandWeight ?? 0,
				biome: placement.geography?.surface?.biome ?? null,
				slopeDegrees: placement.geography?.surface?.slopeDegrees ?? null,
				relocated: placement.relocated ?? null,
				relocationMode: placement.relocationMode ?? null,
				relocationMeters: placement.relocationMeters ?? null,
				displacementFromDesiredMeters: placement.displacementFromDesiredMeters ?? null,
				seatDistanceMeters: placement.seatDistanceMeters ?? null,
				patrolEnabled: Boolean(patrol?.waypoints),
				patrolDisabledByGeography: Boolean(patrol?.route?.disabled),
				patrolError: patrol?.route?.error ?? null,
				routeSampleCount: patrol?.route?.routeSampleCount ?? 0,
			};
		});

		const auditById = new Map(distributionAudit.map((entry) => [entry.id, entry]));
		const representativeByModel = new Map();
		for (const spawn of NPC_CONFIG.SPAWNS) {
			const existing = representativeByModel.get(spawn.modelUrl);
			const existingPatrolReady = existing ? auditById.get(existing.id)?.patrolEnabled === true : false;
			const candidatePatrolReady = auditById.get(spawn.id)?.patrolEnabled === true;
			if (!existing || (!existingPatrolReady && candidatePatrolReady)) representativeByModel.set(spawn.modelUrl, spawn);
		}
		const representativeSpawns = [...representativeByModel.values()];
		const seenModels = new Set(representativeSpawns.map((spawn) => spawn.modelUrl));
		const config = { ...NPC_CONFIG, SPAWNS: representativeSpawns };
		const controllers = await spawnConfiguredNPCs({
			assetLoader,
			npcConfig: config,
			seatsById,
			sampleGroundY: gameplayHeight,
			groundCollider,
			playerCollider,
		});

		function inspectController(controller) {
			const root = controller.object3D;
			const palettes = new Set();
			const layeredBands = new Set();
			const textureSizes = [];
			let meshes = 0;
			let materialSlots = 0;
			root.traverse((node) => {
				if (!node?.isMesh) return;
				meshes += 1;
				for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
					materialSlots += 1;
					if (material?.userData?.paletteId) palettes.add(material.userData.paletteId);
					for (const band of material?.userData?.layeredBands ?? []) layeredBands.add(band.palette ?? band);
					for (const field of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
						const texture = material?.[field];
						if (!texture?.isTexture) continue;
						const image = texture.image ?? texture.source?.data;
						textureSizes.push({ field, width: image?.width ?? null, height: image?.height ?? null });
					}
				}
			});
			return {
				id: root.name,
				placeholder: root.userData?.isPlaceholder === true,
				position: { x: root.position.x, y: root.position.y, z: root.position.z },
				placement: root.userData.npcWorldPlacement ?? null,
				patrolPlacement: root.userData.npcPatrolPlacement ?? null,
				manifest: root.userData.worldPlacementManifest ?? null,
				materialReadyForWorld: root.userData.materialReadyForWorld === true,
				meshes,
				materialSlots,
				palettes: [...palettes].sort(),
				layeredBands: [...layeredBands].sort(),
				textureSizes,
			};
		}

		const assetProofs = controllers.map(inspectController);
		const patrolReady = (controller) => {
			const patrolPlacement = controller.object3D.userData?.npcPatrolPlacement;
			return patrolPlacement?.enabled === true
				&& patrolPlacement.disabledByGeography !== true
				&& Number.isFinite(patrolPlacement.routeSampleCount)
				&& patrolPlacement.routeSampleCount > 0;
		};
		const representative = controllers.find((controller) => controller.object3D.name === 'stannis-guard-1' && patrolReady(controller))
			?? controllers.find(patrolReady)
			?? controllers[0];
		let lifecycle = null;
		let tickBudget = null;
		if (representative) {
			const root = representative.object3D;
			const intents = new Set();
			const start = { x: root.position.x, z: root.position.z };
			let previous = { ...start };
			let movementMeters = 0;
			let maxDistanceFromHomeMeters = 0;
			const recordMotion = () => {
				movementMeters += Math.hypot(root.position.x - previous.x, root.position.z - previous.z);
				previous = { x: root.position.x, z: root.position.z };
				maxDistanceFromHomeMeters = Math.max(maxDistanceFromHomeMeters, Math.hypot(root.position.x - start.x, root.position.z - start.z));
			};
			const front = {
				x: root.position.x + Math.sin(root.rotation.y) * 8,
				z: root.position.z + Math.cos(root.rotation.y) * 8,
			};
			const far = { x: root.position.x + 80, z: root.position.z + 80 };
			const startTime = performance.now();
			for (let tick = 0; tick < 45; tick += 1) {
				representative.update(1 / 60, front);
				recordMotion();
				if (root.userData.npcPerception?.intent) intents.add(root.userData.npcPerception.intent);
			}
			for (let tick = 0; tick < 900; tick += 1) {
				representative.update(1 / 60, far);
				recordMotion();
				if (root.userData.npcPerception?.intent) intents.add(root.userData.npcPerception.intent);
			}
			const elapsedMs = performance.now() - startTime;
			lifecycle = {
				id: root.name,
				patrolReady: patrolReady(representative),
				intents: [...intents],
				finalIntent: root.userData.npcPerception?.intent ?? null,
				movementMeters,
				maxDistanceFromHomeMeters,
				finalDistanceFromHomeMeters: Math.hypot(root.position.x - start.x, root.position.z - start.z),
			};
			tickBudget = { ticks: 945, elapsedMs, averageMs: elapsedMs / 945 };
		}

		for (const controller of controllers) controller.dispose();
		events.clear();
		return {
			configuredCount: NPC_CONFIG.SPAWNS.length,
			uniqueConfiguredModels: seenModels.size,
			representativeSpawnCount: representativeSpawns.length,
			spawnedRepresentativeCount: controllers.length,
			assetErrors,
			distributionAudit,
			assetProofs,
			lifecycle,
			tickBudget,
		};
	});

	const npcConsoleErrors = consoleErrors.filter((message) => message.includes('[gameplay/npc]') || message.includes('npcWorldPlacement'));
	assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
	assert.equal(npcConsoleErrors.length, 0, `NPC console errors: ${npcConsoleErrors.join(' | ')}`);
	assert.deepEqual(proof.assetErrors, [], `configured NPC asset load failures: ${proof.assetErrors.join(', ')}`);
	assert.ok(proof.configuredCount >= 10, `expected broad configured guard distribution, got ${proof.configuredCount}`);
	assert.equal(proof.uniqueConfiguredModels, 6, `expected six configured Mixamo character assets, got ${proof.uniqueConfiguredModels}`);
	assert.equal(proof.representativeSpawnCount, proof.uniqueConfiguredModels, 'one representative per configured model was not selected');
	assert.equal(proof.spawnedRepresentativeCount, proof.representativeSpawnCount, 'one or more real configured character assets were rejected');

	const invalidSpawns = proof.distributionAudit.filter((entry) => !entry.ok);
	assert.deepEqual(invalidSpawns, [], `configured NPCs contain geography-invalid spawns: ${JSON.stringify(invalidSpawns)}`);
	for (const entry of proof.distributionAudit) {
		assert.ok(!['sea', 'lake'].includes(entry.baseSurface), `${entry.id} is placed on ${entry.baseSurface}`);
		assert.ok(Number.isFinite(entry.slopeDegrees) && entry.slopeDegrees <= 26, `${entry.id} slope ${entry.slopeDegrees} exceeds guard policy`);
		assert.ok(Number.isFinite(entry.seatDistanceMeters) && entry.seatDistanceMeters >= 10 && entry.seatDistanceMeters <= 30, `${entry.id} left settlement guard envelope`);
		assert.ok(['local', 'settlement-ring'].includes(entry.relocationMode), `${entry.id} has invalid relocation mode ${entry.relocationMode}`);
		if (entry.relocationMode === 'local') assert.ok(entry.relocationMeters <= 8, `${entry.id} relocation exceeded true local radius`);
	}
	const protectedFalseWater = proof.distributionAudit.filter((entry) => ['sea', 'lake'].includes(entry.rawBaseSurface));
	assert.ok(protectedFalseWater.length >= 2, `expected Balon/Jon false-water recoveries, got ${JSON.stringify(protectedFalseWater)}`);
	for (const entry of protectedFalseWater) {
		assert.equal(entry.seatProtectedLand, true, `${entry.id} false-water cell was not protected by shared seat hydrology`);
		assert.ok(entry.seatProtectedLandWeight > 0, `${entry.id} protected land weight is zero`);
		assert.equal(entry.baseSurface, 'soil', `${entry.id} false-water cell was not composed back to dry soil`);
	}
	for (const requiredId of ['balon-guard-1', 'jon-guard-1']) {
		assert.ok(protectedFalseWater.some((entry) => entry.id === requiredId), `${requiredId} no longer exercises shared protected-seat hydrology`);
	}
	assert.ok(proof.distributionAudit.some((entry) => entry.patrolEnabled), 'no configured patrol survived canonical route validation');

	for (const asset of proof.assetProofs) {
		assert.equal(asset.placeholder, false, `${asset.id} resolved to placeholder instead of hydrated FBX`);
		assert.equal(asset.materialReadyForWorld, true, `${asset.id} bypassed shared WorldAssetPlacementPipeline`);
		assert.equal(asset.manifest?.validation?.ok, true, `${asset.id} material manifest failed validation: ${JSON.stringify(asset.manifest?.validation)}`);
		assert.ok(asset.meshes > 0 && asset.materialSlots > 0, `${asset.id} has no renderable material slots`);
		assert.ok(asset.placement?.generatedMaterialCount > 0, `${asset.id} produced no shared generated guard material`);
		assert.ok(['named-parts', 'named-parts-preserve-authored', 'layered-fallback', 'soldier-kit-fallback'].includes(asset.placement?.materialMode), `${asset.id} has unknown material mode ${asset.placement?.materialMode}`);
		if (asset.placement?.materialMode === 'named-parts-preserve-authored') {
			assert.ok(asset.placement.preservedHighQualitySurfaceCount > 0, `${asset.id} preserve-authored mode reported no high-quality authored surfaces`);
		}
		assert.ok(!['sea', 'lake'].includes(asset.placement?.baseSurface), `${asset.id} placement telemetry reports ${asset.placement?.baseSurface}`);
		assert.ok(asset.placement?.slopeDegrees <= 26, `${asset.id} placement telemetry slope exceeds policy`);
		assertFiniteRecord(asset.position, `${asset.id} transform`);
		const paletteDistribution = new Set([...asset.palettes, ...asset.layeredBands]);
		const preservedSurfaceCount = asset.placement?.materialMode === 'named-parts-preserve-authored'
			? asset.placement.preservedHighQualitySurfaceCount
			: 0;
		assert.ok(paletteDistribution.size + preservedSurfaceCount >= 2, `${asset.id} collapsed below two visual surfaces: generated=${JSON.stringify([...paletteDistribution])} preserved=${preservedSurfaceCount}`);
		if (asset.placement?.materialMode === 'layered-fallback') {
			assert.ok(asset.layeredBands.length >= 5, `${asset.id} layered fallback did not separate boots/trousers/belt/clothing/skin/hair`);
		}
		const generatedTextures = asset.textureSizes.filter(({ width, height }) => width === 256 && height === 256);
		assert.ok(generatedTextures.length > 0, `${asset.id} exposed no decoded 256x256 generated material texture`);
	}

	assert.ok(proof.lifecycle, 'representative guard lifecycle proof missing');
	assert.equal(proof.lifecycle.patrolReady, true, `representative guard ${proof.lifecycle.id} is not canonical-patrol ready`);
	assert.ok(proof.lifecycle.intents.includes('chase') || proof.lifecycle.intents.includes('combat'), `guard never entered chase/combat: ${JSON.stringify(proof.lifecycle)}`);
	assert.ok(proof.lifecycle.intents.includes('investigate') || proof.lifecycle.intents.includes('return') || proof.lifecycle.finalIntent === 'patrol', `guard never left combat toward investigation/return: ${JSON.stringify(proof.lifecycle)}`);
	assert.ok(proof.lifecycle.movementMeters > 0.25, `guard did not move through shipped runtime (${proof.lifecycle.movementMeters}m)`);
	assert.ok(proof.tickBudget?.averageMs < 2, `guard AI tick average ${proof.tickBudget?.averageMs?.toFixed?.(3)}ms exceeds 2ms budget`);

	const evidence = {
		configuredCount: proof.configuredCount,
		uniqueConfiguredModels: proof.uniqueConfiguredModels,
		spawnedRepresentativeCount: proof.spawnedRepresentativeCount,
		missingAssets: proof.assetErrors.length,
		distribution: proof.distributionAudit.map(({ id, seatId, baseSurface, rawBaseSurface, biome, slopeDegrees, relocationMode, relocationMeters, seatDistanceMeters, patrolEnabled }) => ({ id, seatId, baseSurface, rawBaseSurface, biome, slopeDegrees, relocationMode, relocationMeters, seatDistanceMeters, patrolEnabled })),
		assets: proof.assetProofs.map((asset) => ({
			id: asset.id,
			materialMode: asset.placement?.materialMode ?? null,
			generatedMaterialCount: asset.placement?.generatedMaterialCount ?? 0,
			preservedHighQualitySurfaceCount: asset.placement?.preservedHighQualitySurfaceCount ?? 0,
			manifestValid: asset.manifest?.validation?.ok === true,
			meshes: asset.meshes,
			materialSlots: asset.materialSlots,
			palettes: asset.palettes,
			layeredBands: asset.layeredBands,
			generated256Textures: asset.textureSizes.filter(({ width, height }) => width === 256 && height === 256).length,
		})),
		lifecycle: proof.lifecycle,
		tickBudget: proof.tickBudget,
	};
	console.log('NPC_GEOGRAPHIC_MATERIAL_BROWSER_PASS', JSON.stringify(evidence));
} finally {
	await browser.close();
}

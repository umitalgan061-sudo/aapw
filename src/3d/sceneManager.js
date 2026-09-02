/**
 * Scene bootstrap: builds the renderer/camera/scene and the one-time boot-preview world (terrain,
 * water, sky, stars, lighting, river/waterfalls, settlements, colliders, the F4 debug free-fly
 * camera) around `#game3d-canvas`. Extracted out of `game3d.js` (which owns the tick loop and
 * lifecycle wiring instead) once `game3d.js` hit the project's 600-line-per-file cap — see
 * DECISIONS.md ADR-0052. Only setup-time factories live here; the per-frame `update*`/`dispose*`
 * calls those factories pair with stay in `game3d.js`, next to the tick loop that actually calls
 * them every frame.
 * @module sceneManager
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG, SETTLEMENT_CONFIG, STORAGE_KEYS } from './config.js';
import { PLAYER_CONFIG } from './gameplay/gameplayConfig.js';
import { ChunkManager } from './world/chunkManager.js';
import { installRuntimePindexTerrainPolish } from './world/worldReferenceSurfaceTerrainVisual.js';
import { createGroundCollider, createSettlementCollider, createCircleCollider, createComposedCollider } from './physics.js';
import {
	createWater,
	setWaterDepthField,
	WATER_PLANE_SEGMENTS_DESKTOP,
	WATER_PLANE_SEGMENTS_MOBILE,
} from './world/water.js';
import { createWaterDepthField } from './world/waterDepthField.js';
import { generateRiverPath, createRiverMesh, detectWaterfalls, createWaterfallMesh } from './world/rivers.js';
import { createHeightSampler, mulberry32 } from './world/terrain.js';
import { createSettlements, computeSettlementFlattenPads } from './world/settlements.js';
import { buildRoadNetwork } from './world/roads.js';
import {
	installCanonicalRoadBridgeRuntime,
	createCanonicalRoadBridgeGroundHeightResolver,
} from './world/canonicalRoadBridgeRuntime.js';
import { createRoadsideWaystones } from './world/roadsideWaystones.js';
import { createNaturalGeology, upgradeNaturalGeologyAssets } from './world/naturalGeology.js';
import {
	createValyriaBarrenEcologyPlacementProbe,
	VALYRIA_ECOLOGY_PLACEMENT_SYSTEMS,
} from './world/valyriaEcology.js';
import { createVegetation } from './world/vegetation.js';
import { upgradeWinterVegetationAssets } from './world/winterVegetationAsset.js';
import { createWindGrassRun180 } from './world/windGrass.js';
import { createVillages } from './world/villages.js';
import { createIceLandmarks } from './world/iceLandmarks.js';
import { createOrbitCamera } from './camera.js';
import { createFreeCameraController } from './debug/freeCamera.js';
import { createAuroraSky } from './sky.js';
import { createStarfield } from './stars.js';
import { createDayNightLighting } from './lighting.js';
import { createFog } from './fog.js';
import { resolveRenderQuality, configureRendererRealism, configureSunShadow, applyShadowRoles } from './renderQuality.js';

// Compatibility export: existing Run-180 browser contracts and any external callers import this
// factory from sceneManager. The implementation itself now belongs to world/windGrass.js.
export { createWindGrassRun180 };

export function isCoarsePointerDevice() {
	try {
		return window.matchMedia('(pointer: coarse)').matches;
	} catch {
		return false;
	}
}

function readManualQualityLevel() {
	try {
		return window.localStorage.getItem(STORAGE_KEYS.QUALITY_SETTING);
	} catch {
		return null;
	}
}

export function worldToChunkCoord(worldCoord, chunkSizeMeters) {
	return Math.round(worldCoord / chunkSizeMeters);
}

export function createScene(canvas) {
	const canonicalMapSurface = installRuntimePindexTerrainPolish();
	if (!canonicalMapSurface?.installed) throw new Error('[sceneManager] canonical map surface installation failed');
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	const renderQuality = resolveRenderQuality({
		coarsePointer: isCoarsePointerDevice(),
		manualLevel: readManualQualityLevel(),
	});
	configureRendererRealism(renderer, renderQuality);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, renderQuality.preset.pixelRatioCap));

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0c0805);
	scene.fog = createFog();

	const camera = new THREE.PerspectiveCamera(
		WORLD_DEFAULTS.FOV_DEGREES,
		window.innerWidth / window.innerHeight,
		WORLD_DEFAULTS.NEAR_PLANE,
		WORLD_DEFAULTS.FAR_PLANE,
	);
	camera.position.set(0, 700, 1200);
	const controls = createOrbitCamera(camera, canvas, {
		minDistance: PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS,
		maxDistance: PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS,
	});
	const freeCamera = createFreeCameraController({ sourceCamera: camera, domElement: canvas });

	const sky = createAuroraSky();
	scene.add(sky);
	const stars = createStarfield(WORLD_DEFAULTS.WORLD_SEED);
	scene.add(stars);
	const water = createWater(
		WORLD_DEFAULTS.WATER_LEVEL_METERS,
		isCoarsePointerDevice() ? WATER_PLANE_SEGMENTS_MOBILE : WATER_PLANE_SEGMENTS_DESKTOP,
	);
	scene.add(water);
	const clock = new THREE.Clock();

	const lights = createDayNightLighting(scene);
	configureSunShadow(lights.sun, renderQuality);

	const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
	const flattenPads = computeSettlementFlattenPads({
		sampleHeightMeters: baseSampleHeightMeters,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
		mapBounds: WORLD_SCALE.MAP_BOUNDS,
		metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
	});

	const isMobileClass = isCoarsePointerDevice();
	const chunkManager = new ChunkManager({
		scene,
		chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
		segments: isMobileClass ? CHUNK_CONFIG.TERRAIN_SEGMENTS_MOBILE : CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		flattenPads,
	});
	const previewRadiusChunks = isMobileClass ? CHUNK_CONFIG.STREAM_RADIUS_CHUNKS : CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS;
	const generationStart = performance.now();
	chunkManager.loadSquare(0, 0, previewRadiusChunks);
	const generationMs = performance.now() - generationStart;
	console.info(
		`[sceneManager] Loaded ${chunkManager.loadedCount} terrain chunks ` +
			`(~${chunkManager.getCoveredAreaKm2().toFixed(2)} km²) in ${generationMs.toFixed(0)}ms ` +
			`(${isMobileClass ? 'touch/mobile-class device — mobile-budget radius' : 'desktop-class device — full preview radius'}).`,
	);

	const groundCollider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
	// Valyria ecology is placement-only: all three consumers share the same canonical terrain sampler
	// and refugia field, but each consumes its own survival threshold. This keeps grass, trees and
	// villages geographically coherent without leaking ecology into physics, water, roads or geology.
	const createValyriaPlacementFor = (ecologySystem) => createValyriaBarrenEcologyPlacementProbe({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		ecologySystem,
	});
	const valyriaEcologyPlacement = createValyriaPlacementFor(VALYRIA_ECOLOGY_PLACEMENT_SYSTEMS.GRASS);
	const valyriaVegetationPlacement = createValyriaPlacementFor(VALYRIA_ECOLOGY_PLACEMENT_SYSTEMS.VEGETATION);
	const valyriaVillagePlacement = createValyriaPlacementFor(VALYRIA_ECOLOGY_PLACEMENT_SYSTEMS.VILLAGE);
	console.info(
		`[sceneManager] Valyria ecology policy active: ${valyriaEcologyPlacement.policyId} ` +
		`(${valyriaVegetationPlacement.ecologySystem}/${valyriaVillagePlacement.ecologySystem}/${valyriaEcologyPlacement.ecologySystem}).`,
	);

	// The Wall and cave use the same collider-owned terrain sampler as every live grounded system.
	const iceLandmarksResult = createIceLandmarks({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	scene.add(iceLandmarksResult.group);
	console.info(`[sceneManager] Ice landmarks: ${iceLandmarksResult.stats.wallLengthMeters.toFixed(0)}m Wall, ${iceLandmarksResult.stats.cave.tunnelDepthMeters}m cave.`);

	const waterDepthField = createWaterDepthField({
		sampleHeightMeters: groundCollider.getGroundHeight,
		waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
	});
	setWaterDepthField(water, waterDepthField);
	console.info(
		`[sceneManager] Water depth field baked: ${waterDepthField.resolution}² texels over ` +
			`${waterDepthField.extentMeters}m in ${waterDepthField.bakeMs.toFixed(0)}ms ` +
			`(${(waterDepthField.deepTexelRatio * 100).toFixed(1)}% deep water, ` +
			`${(waterDepthField.dryTexelRatio * 100).toFixed(1)}% dry land).`,
	);
	const { points: riverPoints, endReason: riverEndReason } = generateRiverPath({
		seed: WORLD_DEFAULTS.WORLD_SEED,
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
	});
	const river = createRiverMesh(riverPoints);
	if (river) scene.add(river);
	console.info(`[sceneManager] River path traced: ${riverPoints.length} points, ended via "${riverEndReason}".`);

	const waterfalls = detectWaterfalls(riverPoints).map((waterfall) => createWaterfallMesh(waterfall));
	waterfalls.forEach((mesh) => scene.add(mesh));
	console.info(`[sceneManager] Detected ${waterfalls.length} waterfall-grade drop(s) along the river.`);

	const settlementsResult = createSettlements({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		mapBounds: WORLD_SCALE.MAP_BOUNDS,
		metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
		settlementConfig: SETTLEMENT_CONFIG,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	scene.add(settlementsResult.group);
	if (!isMobileClass) {
		for (const seat of settlementsResult.seats) {
			const seatChunkX = worldToChunkCoord(seat.x, CHUNK_CONFIG.CHUNK_SIZE_METERS);
			const seatChunkZ = worldToChunkCoord(seat.z, CHUNK_CONFIG.CHUNK_SIZE_METERS);
			chunkManager.loadSquare(seatChunkX, seatChunkZ, 1);
		}
	}
	console.info(
		`[sceneManager] Placed ${settlementsResult.seats.length} kingdom-seat settlements; ` +
			`${chunkManager.loadedCount} terrain chunks resident ` +
			`(~${chunkManager.getCoveredAreaKm2().toFixed(2)} km²)${isMobileClass ? ' (mobile — grounding skipped, see ADR-0013)' : ' after grounding them'}.`,
	);

	const settlementCollider = createSettlementCollider(settlementsResult.seats, SETTLEMENT_CONFIG);

	const roadsResult = buildRoadNetwork({
		seats: settlementsResult.seats,
		sampleHeightMeters: groundCollider.getGroundHeight,
	});
	installCanonicalRoadBridgeRuntime(roadsResult, { sampleHeightMeters: groundCollider.getGroundHeight });
	const roadsideWaystonesResult = createRoadsideWaystones({
		roadEdges: roadsResult.edges,
		seats: settlementsResult.seats,
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		isMobileClass,
	});
	roadsResult.group.add(roadsideWaystonesResult.mesh);
	scene.add(roadsResult.group);
	console.info(
		`[sceneManager] Built road network: ${roadsResult.edges.length} segment(s) connecting ` +
			`${settlementsResult.seats.length} kingdom seats, ${(roadsResult.totalLengthMeters / 1000).toFixed(2)} km total, ` +
			`steepest actual segment grade ${roadsResult.maxGradeDegrees.toFixed(1)}°.`,
	);
	console.info(
		`[sceneManager] Roadside waystones: ${roadsideWaystonesResult.stats.placedCount}/${roadsideWaystonesResult.stats.candidateCount} ` +
			`dry slope-safe marker(s), profiles ${JSON.stringify(roadsideWaystonesResult.stats.profiles)}.`,
	);
	if (roadsResult.bridgeRuntime?.status === 'active-render-topology') {
		console.info(
			`[sceneManager] Canonical bridges: ${roadsResult.bridgeRuntime.bridgeCount} stone arch bridge(s) across ` +
			`${roadsResult.bridgeRuntime.affectedEdgeCount} road edge(s), ${roadsResult.bridgeRuntime.approachCount} bounded approach(es), ` +
			`water suppression ${roadsResult.bridgeRuntime.waterSuppression.covered}/${roadsResult.bridgeRuntime.waterSuppression.total}.`,
		);
	}

	// Asset-informed geology is deliberately created after roads/settlements so placement can reserve
	// their corridors, but before vegetation so the geological read remains visually primary. The
	// canonical collider/terrain sampler stays the only height authority; this layer is render-only.
	const naturalGeologyResult = createNaturalGeology({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
		worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
		isMobileClass,
	});
	scene.add(naturalGeologyResult.group);
	console.info(
		`[sceneManager] Natural geology: ${naturalGeologyResult.stats.placedCount} outcrop/talus placement(s), ` +
		`${naturalGeologyResult.stats.valyriaPlacementCount ?? 0} in Valyria.`,
	);
	const naturalGeologyAbortController = new AbortController();
	window.addEventListener('pagehide', () => naturalGeologyAbortController.abort(), { once: true });
	void upgradeNaturalGeologyAssets(naturalGeologyResult.group, {
		signal: naturalGeologyAbortController.signal,
		isMobileClass,
	}).then((upgrade) => {
		if (upgrade.status === 'active') {
			console.info(`[sceneManager] Hydrated ${upgrade.hydratedPlacementCount} natural geology placement(s) from repository GLB assets.`);
		} else if (upgrade.status === 'procedural-fallback') {
			console.info('[sceneManager] Natural geology GLBs unavailable/pointer-only/mobile; deterministic procedural fallback remains active.');
		}
	}).catch((error) => {
		console.warn('[sceneManager] Optional natural geology asset hydration failed; procedural fallback remains active.', error);
	});

	const vegetationResult = createVegetation({
		sampleHeightMeters: valyriaVegetationPlacement.sampleHeightMeters,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		radiusMeters: previewRadiusChunks * CHUNK_CONFIG.CHUNK_SIZE_METERS,
	});
	scene.add(vegetationResult.group);
	console.info(
		`[sceneManager] Scattered vegetation: ${vegetationResult.placedCount}/${vegetationResult.targetCount} tree(s) placed ` +
			`(${vegetationResult.clusterSeatCount} seat(s) with a local cluster ring).`,
	);
	const winterVegetationAbortController = new AbortController();
	window.addEventListener('pagehide', () => winterVegetationAbortController.abort(), { once: true });
	void upgradeWinterVegetationAssets(vegetationResult.group, {
		signal: winterVegetationAbortController.signal,
	}).then((upgrade) => {
		if (upgrade.status === 'active') {
			console.info(
				`[sceneManager] Upgraded ${upgrade.treeCount} northern snow tree(s) from ${upgrade.assetUrl} ` +
				`using ${upgrade.meshCount} instanced GLB primitive(s).`,
			);
		} else if (upgrade.status === 'procedural-fallback') {
			console.info('[sceneManager] Winter GLB unavailable/pointer-only; procedural snow-pine fallback remains active.');
		}
	}).catch((error) => {
		console.warn('[sceneManager] Optional winter vegetation asset upgrade failed; procedural fallback remains active.', error);
	});

	const villagesResult = createVillages({
		sampleHeightMeters: valyriaVillagePlacement.sampleHeightMeters,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		radiusMeters: previewRadiusChunks * CHUNK_CONFIG.CHUNK_SIZE_METERS,
		mulberry32,
	});
	scene.add(villagesResult.group);
	console.info(
		`[sceneManager] Built villages: ${villagesResult.houseCount} house(s) and ${villagesResult.wallCount} field wall(s) ` +
			`across ${villagesResult.villageCount} village(s).`,
	);

	// Install the bridge-aware player ground surface only after all geography/biome placement has
	// consumed the canonical terrain sampler. Bridge decks/approaches are traversal surfaces, not new
	// terrain, so they must never become geology, tree, grass or village placement height authority.
	if (roadsResult.bridgeGroundSurfaces?.length) {
		const sampleCanonicalTerrainHeight = groundCollider.getGroundHeight.bind(groundCollider);
		groundCollider.getGroundHeight = createCanonicalRoadBridgeGroundHeightResolver(
			roadsResult.bridgeGroundSurfaces,
			sampleCanonicalTerrainHeight,
		);
	}

	const villageCollider = createCircleCollider(villagesResult.houses);
	const iceLandmarkCollider = createCircleCollider(iceLandmarksResult.blockers);
	const playerCollider = createComposedCollider([settlementCollider, villageCollider, iceLandmarkCollider]);

	applyShadowRoles(settlementsResult.group, { quality: renderQuality });
	applyShadowRoles(villagesResult.group, { quality: renderQuality });
	applyShadowRoles(iceLandmarksResult.group, { quality: renderQuality });
	applyShadowRoles(naturalGeologyResult.group, { quality: renderQuality });
	applyShadowRoles(vegetationResult.group, { quality: renderQuality });
	applyShadowRoles(roadsResult.group, { quality: renderQuality, cast: false });
	applyShadowRoles(roadsideWaystonesResult.mesh, { quality: renderQuality });

	return {
		renderer, scene, camera, controls, freeCamera, chunkManager, groundCollider, playerCollider, sky, stars, water, river, waterfalls,
		renderQuality,
		settlements: settlementsResult.group,
		roads: roadsResult.group,
		roadEdges: roadsResult.edges,
		bridgeRuntime: roadsResult.bridgeRuntime ?? null,
		roadsideWaystoneStats: roadsideWaystonesResult.stats,
		naturalGeology: naturalGeologyResult.group,
		naturalGeologyStats: naturalGeologyResult.stats,
		valyriaEcologyPlacement,
		vegetation: vegetationResult.group,
		villages: villagesResult.group,
		iceLandmarks: iceLandmarksResult.group,
		iceLandmarkStats: iceLandmarksResult.stats,
		settlementSeats: settlementsResult.seats,
		lights, clock, elapsedSeconds: 0, lastStreamChunk: null,
		cameraCollisionRaycaster: new THREE.Raycaster(),
	};
}

const _createSceneBeforeWindGrassRun180 = createScene;
createScene = function createSceneWithWindGrassRun180(canvas) {
	const state = _createSceneBeforeWindGrassRun180(canvas);
	const mobile = isCoarsePointerDevice();
	const grass = createWindGrassRun180({
		sampleHeightMeters: state.valyriaEcologyPlacement.sampleHeightMeters,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: state.settlementSeats,
		roadEdges: state.roadEdges,
		isMobileClass: mobile,
		centerX: state.camera.position.x,
		centerZ: state.camera.position.z,
	});
	state.scene.add(grass.group);
	state.vegetation.userData.run180GrassGroup = grass.group;
	state.grass = grass.group;
	state.grassStats = grass.group.userData.run180WindGrass;
	return state;
};
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
import { createNaturalGeology, upgradeNaturalGeologyAssets } from './world/naturalGeology.js';
import { createValyriaBarrenEcologyPlacementProbe } from './world/valyriaEcology.js';
import { createVegetation } from './world/vegetation.js';
import { upgradeWinterVegetationAssets } from './world/winterVegetationAsset.js';
import { createWindGrassRun180 } from './world/windGrass.js';
import { createVillages } from './world/villages.js';
import { createGeographicSettlementPropLayer } from './world/geographicSettlementProps.js';
import {
	decorateGeographicSettlementPropGroup,
	auditGeographicSettlementPropGroup,
	buildGeographicSettlementPropRuntimeSummary,
} from './world/geographicSettlementPropQuality.js';
import { createIceLandmarks } from './world/iceLandmarks.js';
import { createOrbitCamera } from './camera.js';
import { createFreeCameraController } from './debug/freeCamera.js';
import { createAuroraSky } from './sky.js';
import { createStarfield } from './stars.js';
import { createDayNightLighting } from './lighting.js';
import { createFog } from './fog.js';
import { applyCameraRelativeSkyAdoption } from './world/cameraRelativeSkyAdoption.js';
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
	const skyAdoption = applyCameraRelativeSkyAdoption({
		scene,
		fog: scene.fog,
		requestedClearHex: 0x243746,
		requestedFogHex: 0x596979,
	});
	console.info(`[sceneManager] Camera-relative sky adoption: ${skyAdoption.policyId}, black-sky guard=${skyAdoption.blackSkyGuard}.`);

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
	// One placement-only adapter keeps the Doom barren without lying to physics, water, roads or
	// natural geology about the actual volcanic terrain height.
	const valyriaEcologyPlacement = createValyriaBarrenEcologyPlacementProbe({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
	});
	console.info(`[sceneManager] Valyria barren ecology policy active: ${valyriaEcologyPlacement.policyId}.`);

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
	scene.add(roadsResult.group);
	console.info(
		`[sceneManager] Built road network: ${roadsResult.edges.length} segment(s) connecting ` +
			`${settlementsResult.seats.length} kingdom seats, ${(roadsResult.totalLengthMeters / 1000).toFixed(2)} km total, ` +
			`steepest actual segment grade ${roadsResult.maxGradeDegrees.toFixed(1)}°.`,
	);

	// Asset-informed geology is deliberately created after roads/settlements so placement can reserve
	// their spaces and does not punch through player-accessible infrastructure.
	const geology = createNaturalGeology({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		settlementSeats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
	});
	scene.add(geology.group);
	const winterVegetation = upgradeWinterVegetationAssets({
		group: geology.group,
		assetLoader: null,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	void winterVegetation;
	const vegetation = createVegetation({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		radiusMeters: previewRadiusChunks * CHUNK_CONFIG.CHUNK_SIZE_METERS,
	});
	scene.add(vegetation.group);
	console.info(`[sceneManager] Vegetation placed: ${vegetation.placedCount}/${vegetation.targetCount} instance(s).`);

	const windGrass = createWindGrassRun180({
		seed: WORLD_DEFAULTS.WORLD_SEED,
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		roadEdges: roadsResult.edges,
		settlementSeats: settlementsResult.seats,
	});
	scene.add(windGrass.group);
	console.info(`[sceneManager] Wind grass placed: ${windGrass.stats?.placedCount ?? 0} patch(es).`);

	const villages = createVillages({
		seats: settlementsResult.seats,
		sampleHeightMeters: groundCollider.getGroundHeight,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	scene.add(villages.group);

	const geographicSettlementProps = createGeographicSettlementPropLayer({
		seats: settlementsResult.seats,
		sampleHeightMeters: groundCollider.getGroundHeight,
		roadEdges: roadsResult.edges,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	decorateGeographicSettlementPropGroup(geographicSettlementProps.group);
	scene.add(geographicSettlementProps.group);
	console.info(`[sceneManager] Geographic settlement props: ${buildGeographicSettlementPropRuntimeSummary(geographicSettlementProps).placedCount} placed.`);

	const state = {
		renderer,
		scene,
		camera,
		controls,
		freeCamera,
		clock,
		lights,
		sky,
		stars,
		water,
		chunkManager,
		groundCollider,
		settlementCollider,
		settlementSeats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		geology,
		vegetation,
		windGrass,
		villages,
		geographicSettlementProps,
		iceLandmarks: iceLandmarksResult,
		waterDepthField,
		valyriaEcologyPlacement,
		freeCameraController: freeCamera,
		renderQuality,
		skyAdoption,
	};

	applyShadowRoles(state);
	return state;
}

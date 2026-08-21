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
import { createVegetation } from './world/vegetation.js';
import { northGroundCoverProfileAtWorldZ, NORTH_GROUND_COVER_POLICY } from './world/northGroundCoverClimate.js';
import { createVillages } from './world/villages.js';
import { createOrbitCamera } from './camera.js';
import { createFreeCameraController } from './debug/freeCamera.js';
import { createAuroraSky } from './sky.js';
import { createStarfield } from './stars.js';
import { createDayNightLighting } from './lighting.js';
import { createFog } from './fog.js';
import { resolveRenderQuality, configureRendererRealism, configureSunShadow, applyShadowRoles } from './renderQuality.js';

/**
 * Detects a touch-primary (phone/tablet-class) device via the standard `(pointer: coarse)` media
 * query — more reliable than user-agent sniffing, and the same signal a CSS media query would use.
 * Falls back to `false` (treat as desktop) if `matchMedia` itself is unavailable, so this can never
 * throw and block scene creation.
 * @returns {boolean}
 */
export function isCoarsePointerDevice() {
	try {
		return window.matchMedia('(pointer: coarse)').matches;
	} catch {
		return false;
	}
}

/**
 * Reads the player's manual graphics-quality override (`ui/pauseMenu.js`'s settings screen, run 341,
 * ADR-0289) — try/catch-wrapped the same way `isCoarsePointerDevice()` above is, so a blocked/absent
 * `localStorage` (private browsing, some embedded webviews) falls back to `null` ("no override")
 * instead of throwing and blocking scene creation.
 * @returns {string|null}
 */
function readManualQualityLevel() {
	try {
		return window.localStorage.getItem(STORAGE_KEYS.QUALITY_SETTING);
	} catch {
		return null;
	}
}

/**
 * Converts a world-space coordinate to the chunk grid coordinate it falls in, matching the
 * `world/README.md` convention (chunk `(cx, cz)` centered at world `(cx * size, 0, cz * size)`).
 * Exported so `gameLoopHelpers.js`'s own per-frame chunk-coordinate lookups
 * (`collectCameraCollidables`, `streamAroundOrbitTarget`) share this single definition instead of
 * a second copy.
 * @param {number} worldCoord
 * @param {number} chunkSizeMeters
 * @returns {number}
 */
export function worldToChunkCoord(worldCoord, chunkSizeMeters) {
	return Math.round(worldCoord / chunkSizeMeters);
}

/**
 * Creates the renderer/scene/camera (with interactive orbit controls) and loads a one-time
 * boot-preview neighborhood of terrain chunks around the origin against `canvas`, via
 * `ChunkManager`. The radius is `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` on desktop-class
 * (fine/no pointer) devices, or the much smaller mobile-budget `STREAM_RADIUS_CHUNKS` on
 * touch-primary devices — see DECISIONS.md ADR-0010 for why this split exists: without it, a
 * phone loaded the same chunk count as desktop and blew the mobile triangle budget several times
 * over. Fixed one-time load, not position-based streaming yet — see 3D_GAME_PROGRESS.md FAZ 1 for
 * what's next.
 * @param {HTMLCanvasElement} canvas
 * @returns {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: import('./camera.js').OrbitControls, freeCamera: {camera: THREE.PerspectiveCamera, active: boolean, update: (delta: number) => void, dispose: () => void}, chunkManager: ChunkManager, groundCollider: {getGroundHeight: (x: number, z: number) => number}, playerCollider: {resolveXZ: (x: number, z: number) => {x: number, z: number}}, sky: THREE.Mesh, stars: THREE.Points, water: THREE.Mesh, river: THREE.Mesh | null, waterfalls: THREE.Mesh[], settlements: THREE.Group, roads: THREE.Group, roadEdges: {fromId: string, toId: string, points: {x: number, y: number, z: number}[], lengthMeters: number, maxGradeDegrees: number}[], vegetation: THREE.Group, villages: THREE.Group, settlementSeats: {id: string, name: string, x: number, z: number, groundY: number}[], lights: {sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight}, clock: THREE.Clock, elapsedSeconds: number, lastStreamChunk: {x: number, z: number} | null, cameraCollisionRaycaster: THREE.Raycaster}}
 */
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

	const vegetationResult = createVegetation({
		sampleHeightMeters: groundCollider.getGroundHeight,
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

	const villagesResult = createVillages({
		sampleHeightMeters: groundCollider.getGroundHeight,
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

	const villageCollider = createCircleCollider(villagesResult.houses);
	const playerCollider = createComposedCollider([settlementCollider, villageCollider]);

	applyShadowRoles(settlementsResult.group, { quality: renderQuality });
	applyShadowRoles(villagesResult.group, { quality: renderQuality });
	applyShadowRoles(vegetationResult.group, { quality: renderQuality });
	applyShadowRoles(roadsResult.group, { quality: renderQuality, cast: false });

	return {
		renderer, scene, camera, controls, freeCamera, chunkManager, groundCollider, playerCollider, sky, stars, water, river, waterfalls,
		renderQuality,
		settlements: settlementsResult.group,
		roads: roadsResult.group,
		roadEdges: roadsResult.edges,
		vegetation: vegetationResult.group,
		villages: villagesResult.group,
		settlementSeats: settlementsResult.seats,
		lights, clock, elapsedSeconds: 0, lastStreamChunk: null,
		cameraCollisionRaycaster: new THREE.Raycaster(),
	};
}

// Run 180 / ADR-0201 — bounded deterministic physical grass with shader-only natural wind.
const RUN180_WIND_GRASS_CONFIG = Object.freeze({
	desktop: Object.freeze({ radiusMeters: 350, maxPatches: 4000 }),
	mobile: Object.freeze({ radiusMeters: 260, maxPatches: 1200 }),
	cellMeters: 120,
	bladesPerPatch: 10,
	patchRadiusMeters: 4.5,
	roadClearanceMeters: 10,
	seatClearanceMeters: 100,
	shoreMarginMeters: 1.5,
	maxSlopeDegrees: 38,
});

function run180GrassRng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function run180GrassSegmentDistance(px, pz, a, b) {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const lengthSq = dx * dx + dz * dz;
	if (!lengthSq) return Math.hypot(px - a.x, pz - a.z);
	const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lengthSq));
	return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

function run180GrassAllowed(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges }) {
	for (const seat of seats) {
		if (Math.hypot(x - seat.x, z - seat.z) < RUN180_WIND_GRASS_CONFIG.seatClearanceMeters) return false;
	}
	for (const edge of roadEdges) {
		for (let i = 1; i < edge.points.length; i++) {
			if (run180GrassSegmentDistance(x, z, edge.points[i - 1], edge.points[i]) < RUN180_WIND_GRASS_CONFIG.roadClearanceMeters) return false;
		}
	}
	const y = sampleHeightMeters(x, z);
	if (y <= seaLevelMeters + RUN180_WIND_GRASS_CONFIG.shoreMarginMeters) return false;
	const d = 4;
	const dx = sampleHeightMeters(x + d, z) - y;
	const dz = sampleHeightMeters(x, z + d) - y;
	return Math.atan2(Math.max(Math.abs(dx), Math.abs(dz)), d) * 180 / Math.PI <= RUN180_WIND_GRASS_CONFIG.maxSlopeDegrees;
}

function run180GrassGeometry() {
	const positions = [];
	const indices = [];
	const flex = [];
	const phase = [];
	const count = RUN180_WIND_GRASS_CONFIG.bladesPerPatch;
	const radius = RUN180_WIND_GRASS_CONFIG.patchRadiusMeters;
	for (let i = 0; i < count; i++) {
		const angle = i * 2.3999632297;
		const r = radius * Math.sqrt((i + 0.35) / count);
		const cx = Math.cos(angle) * r;
		const cz = Math.sin(angle) * r;
		const height = 0.58 + 0.42 * ((i * 37 % 101) / 100);
		const width = 0.11 + 0.07 * ((i * 53 % 97) / 96);
		const sideX = Math.cos(angle + Math.PI / 2) * width;
		const sideZ = Math.sin(angle + Math.PI / 2) * width;
		const base = positions.length / 3;
		positions.push(cx - sideX, 0, cz - sideZ, cx + sideX, 0, cz + sideZ, cx - sideX, height, cz - sideZ, cx + sideX, height, cz + sideZ);
		indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
		flex.push(0, 0, 1, 1);
		phase.push(i / count, i / count, i / count, i / count);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('run180Flex', new THREE.Float32BufferAttribute(flex, 1));
	geometry.setAttribute('run180Phase', new THREE.Float32BufferAttribute(phase, 1));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

function run180PopulateGrass(mesh, params, cellX, cellZ) {
	const config = params.isMobileClass ? RUN180_WIND_GRASS_CONFIG.mobile : RUN180_WIND_GRASS_CONFIG.desktop;
	const seed = (params.seed ^ Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663) ^ 0x47524153) >>> 0;
	const random = run180GrassRng(seed);
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const position = new THREE.Vector3();
	const color = new THREE.Color();
	const up = new THREE.Vector3(0, 1, 0);
	const centerX = cellX * RUN180_WIND_GRASS_CONFIG.cellMeters;
	const centerZ = cellZ * RUN180_WIND_GRASS_CONFIG.cellMeters;
	let placed = 0;
	let climateRejected = 0;
	for (let i = 0; i < config.maxPatches; i++) {
		for (let attempt = 0; attempt < 8; attempt++) {
			const angle = random() * Math.PI * 2;
			const radius = config.radiusMeters * Math.sqrt(random());
			const x = centerX + Math.cos(angle) * radius;
			const z = centerZ + Math.sin(angle) * radius;
			if (!run180GrassAllowed(x, z, params)) continue;
			const cover = northGroundCoverProfileAtWorldZ(z);
			if (cover.grassDensity <= 0) {
				climateRejected++;
				continue;
			}
			if (cover.grassDensity < 1 && random() >= cover.grassDensity) {
				climateRejected++;
				continue;
			}
			position.set(x, params.sampleHeightMeters(x, z) + 0.03, z);
			quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
			const uniformScale = (0.78 + random() * 0.47) * cover.heightScale;
			scale.set(uniformScale, uniformScale, uniformScale);
			matrix.compose(position, quaternion, scale);
			mesh.setMatrixAt(placed, matrix);
			color.setRGB(cover.rgb.r, cover.rgb.g, cover.rgb.b);
			mesh.setColorAt(placed, color);
			placed++;
			break;
		}
	}
	mesh.count = placed;
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere();
	mesh.userData.run180Cell = { x: cellX, z: cellZ };
	mesh.userData.northGroundCover = {
		policyId: NORTH_GROUND_COVER_POLICY.id,
		climateRejected,
	};
	return placed;
}

export function createWindGrassRun180({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, isMobileClass = false, centerX = 0, centerZ = 0 }) {
	const config = isMobileClass ? RUN180_WIND_GRASS_CONFIG.mobile : RUN180_WIND_GRASS_CONFIG.desktop;
	const geometry = run180GrassGeometry();
	const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide });
	const mesh = new THREE.InstancedMesh(geometry, material, config.maxPatches);
	const group = new THREE.Group();
	const params = { sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, isMobileClass };
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.frustumCulled = false;
	mesh.userData.run180FirstFrameSafe = true;
	material.userData.run180WindGrass = Object.freeze({
		key: 'run180-wind-grass-v2-north-climate',
		radiusMeters: config.radiusMeters,
		maxPatches: config.maxPatches,
		bladesPerPatch: RUN180_WIND_GRASS_CONFIG.bladesPerPatch,
		climatePolicyId: NORTH_GROUND_COVER_POLICY.id,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uRun180WindTime = { value: 0 };
		shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uRun180WindTime;\nattribute float run180Flex;\nattribute float run180Phase;\nvarying float vRun180GrassVariation;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvec2 run180XZ=instanceMatrix[3].xz;\nfloat run180P=dot(run180XZ,vec2(0.021,0.017))+run180Phase*6.2831853;\nfloat run180Wave=sin(uRun180WindTime*1.05+run180P)+0.35*sin(uRun180WindTime*2.15+run180P*1.73);\ntransformed.xz+=vec2(0.78,0.62)*run180Wave*run180Flex*run180Flex*0.24;\nvRun180GrassVariation=fract(sin(dot(run180XZ,vec2(12.9898,78.233)))*43758.5453);');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRun180GrassVariation;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(0.84,1.10,vRun180GrassVariation);');
		material.userData.run180Shader = shader;
	};
	material.customProgramCacheKey = () => 'run180-wind-grass-v2-north-climate';
	const initialX = Math.round(centerX / RUN180_WIND_GRASS_CONFIG.cellMeters);
	const initialZ = Math.round(centerZ / RUN180_WIND_GRASS_CONFIG.cellMeters);
	let placed = run180PopulateGrass(mesh, params, initialX, initialZ);
	mesh.onBeforeRender = (_renderer, _scene, camera) => {
		const shader = material.userData.run180Shader;
		if (shader) shader.uniforms.uRun180WindTime.value = performance.now() * 0.001;
		const cellX = Math.round(camera.position.x / RUN180_WIND_GRASS_CONFIG.cellMeters);
		const cellZ = Math.round(camera.position.z / RUN180_WIND_GRASS_CONFIG.cellMeters);
		if (cellX !== mesh.userData.run180Cell.x || cellZ !== mesh.userData.run180Cell.z) {
			placed = run180PopulateGrass(mesh, params, cellX, cellZ);
			group.userData.run180WindGrass.placedCount = placed;
			group.userData.run180WindGrass.centerCell = { x: cellX, z: cellZ };
			group.userData.run180WindGrass.climateRejected = mesh.userData.northGroundCover?.climateRejected ?? 0;
		}
	};
	group.add(mesh);
	group.userData.run180WindGrass = {
		active: true,
		isMobileClass,
		placedCount: placed,
		maxPatches: config.maxPatches,
		radiusMeters: config.radiusMeters,
		centerCell: { x: initialX, z: initialZ },
		climatePolicyId: NORTH_GROUND_COVER_POLICY.id,
		climateRejected: mesh.userData.northGroundCover?.climateRejected ?? 0,
	};
	return { group, mesh };
}

const _createSceneBeforeWindGrassRun180 = createScene;
createScene = function createSceneWithWindGrassRun180(canvas) {
	const state = _createSceneBeforeWindGrassRun180(canvas);
	const mobile = isCoarsePointerDevice();
	const grass = createWindGrassRun180({
		sampleHeightMeters: state.groundCollider.getGroundHeight,
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

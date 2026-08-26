/**
 * Scene bootstrap: builds the renderer/camera/scene and the one-time boot-preview world (terrain,
 * water, sky, stars, lighting, river/water features, settlements, colliders, the F4 debug free-fly
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
import { generateRiverPath, createRiverMesh, buildRiverSurface, createNamedRiverMeshes, detectWaterfalls, createWaterfallMesh } from './world/rivers.js';
import { createHeightSampler, mulberry32 } from './world/terrain.js';
import { createSettlements, computeSettlementFlattenPads, KINGDOM_SEATS, mapToWorldXZ } from './world/settlements.js';
import { computeRoadCorridor } from './world/roadCorridorSmoothing.js';
import { computeRiverValleys } from './world/terrainValleyCarving.js';
import { createReferenceRoadMeshes } from './world/worldReferenceRoadNetwork.js';
import { buildWorldFoundation } from './worldFoundation.js';
import { buildRoadNetwork } from './world/roads.js';
import { createVegetation } from './world/vegetation.js';
import { createWindGrassRun180 } from './world/windGrass.js';
import { createVillages } from './world/villages.js';
import { createOrbitCamera } from './camera.js';
import { createFreeCameraController } from './debug/freeCamera.js';
import { createAuroraSky } from './sky.js';
import { createStarfield } from './stars.js';
import { createDayNightLighting } from './lighting.js';
import { createSkyBodies } from './skyBodies.js';
import { AssetLoader } from './assetLoader.js';
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
 * @returns {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: import('./camera.js').OrbitControls, freeCamera: {camera: THREE.PerspectiveCamera, active: boolean, update: (delta: number) => void, dispose: () => void}, chunkManager: ChunkManager, groundCollider: {getGroundHeight: (x: number, z: number) => number}, playerCollider: {resolveXZ: (x: number, z: number) => {x: number, z: number}}, sky: THREE.Mesh, stars: THREE.Points, water: THREE.Mesh, river: THREE.Mesh | null, waterFeatures: THREE.Mesh[], settlements: THREE.Group, roads: THREE.Group, roadEdges: {fromId: string, toId: string, points: {x: number, y: number, z: number}[], lengthMeters: number, maxGradeDegrees: number}[], vegetation: THREE.Group, villages: THREE.Group, settlementSeats: {id: string, name: string, x: number, z: number, groundY: number}[], lights: {sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight}, clock: THREE.Clock, elapsedSeconds: number, lastStreamChunk: {x: number, z: number} | null, cameraCollisionRaycaster: THREE.Raycaster}}
 */
export function createScene(canvas) {
	// Canonical owner-map rendering is a scene invariant, not an HTML-entrypoint option. Keeping
	// this install here means every real createScene() caller gets the same map.png/Pindex surface
	// before its first ChunkManager load; an omitted external pre-install can no longer expose the
	// legacy green procedural rectangle. The installer is intentionally idempotent.
	const canonicalMapSurface = installRuntimePindexTerrainPolish();
	if (!canonicalMapSurface?.installed) throw new Error('[sceneManager] canonical map surface installation failed');
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	// Filmic tone mapping + (desktop only) real sun shadows, finally consuming `QUALITY_PRESETS` —
	// see `renderQuality.js` for why that config sat unread since FAZ 0 and what each knob buys.
	const renderQuality = resolveRenderQuality({
		coarsePointer: isCoarsePointerDevice(),
		manualLevel: readManualQualityLevel(),
	});
	configureRendererRealism(renderer, renderQuality);
	// `pixelRatioCap` (run 343, ADR-0291): was a hardcoded `2` regardless of device or quality level —
	// the second of `QUALITY_PRESETS`'s three still-unread knobs (see `renderQuality.js`'s own module
	// doc). Desktop `AUTOMATIC` (-> HIGH, cap 2) is byte-identical to the old hardcoded behavior; a
	// touch-primary device now renders at native resolution capped to 1x instead of up to 2x, which
	// only ever reduces fragment-shader fill cost — never a risk to the fixed mobile
	// DrawCalls/Triangles budget (ADR-0010), which this doesn't touch. A desktop MEDIUM/LOW manual
	// override (`ui/pauseMenu.js` settings screen, ADR-0289) now also lowers pixel ratio, not just
	// shadow-map size.
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, renderQuality.preset.pixelRatioCap));

	const scene = new THREE.Scene();
	// Fallback only — the aurora sky sphere (added below) fully covers the viewport every frame.
	scene.background = new THREE.Color(0x0c0805);
	scene.fog = createFog(); // color/density synced to day/night every frame — see updateFog() in the tick loop below.

	const camera = new THREE.PerspectiveCamera(
		WORLD_DEFAULTS.FOV_DEGREES,
		window.innerWidth / window.innerHeight,
		WORLD_DEFAULTS.NEAR_PLANE,
		WORLD_DEFAULTS.FAR_PLANE,
	);
	// Starting position; overwritten once the player loads (see initGame3D) with a proper
	// third-person framing. OrbitControls (created below) takes over from here on user input.
	camera.position.set(0, 700, 1200);
	const controls = createOrbitCamera(camera, canvas, {
		minDistance: PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS,
		maxDistance: PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS,
	});
	// F4 debug free-fly camera (debug/README.md, ADR-0049) — self-contained, never touches `controls`.
	const freeCamera = createFreeCameraController({ sourceCamera: camera, domElement: canvas });

	const sky = createAuroraSky();
	scene.add(sky);
	const stars = createStarfield(WORLD_DEFAULTS.WORLD_SEED);
	scene.add(stars);
	// Desktop-class hardware gets a finer water grid so ADR-0270's swell reads as a smooth
	// undulation rather than a faceted one; touch devices keep the historical segment count so
	// the 500K mobile triangle budget is untouched. The depth field that actually enables the
	// swell is baked and attached further down, once the ground collider exists.
	const water = createWater(
		WORLD_DEFAULTS.WATER_LEVEL_METERS,
		isCoarsePointerDevice() ? WATER_PLANE_SEGMENTS_MOBILE : WATER_PLANE_SEGMENTS_DESKTOP,
	);
	scene.add(water);
	const clock = new THREE.Clock();

	const lights = createDayNightLighting(scene);
	// The sun and moon as visible bodies, plus the light the moon casts. Built from the same direction
	// the sun light already uses, so the disc can never drift out of step with the lighting — see
	// `skyBodies.js`. `game3d.js` places them each frame in the same tick that orbits the sun.
	const skyBodies = createSkyBodies(scene, new AssetLoader());
	// The sun becomes the world's single shadow caster. Its frustum has to be re-anchored onto the
	// player every frame (`focusSunShadow` in game3d.js's tick) — `updateDayNightLighting` orbits it
	// around the world origin, which is nowhere near where the player actually stands.
	configureSunShadow(lights.sun, renderQuality);

	// Every terrain-shaping layer, in the order each one requires the previous — see
	// `worldFoundation.js` for why that order is load-bearing rather than incidental.
	const { flattenPads, valleyField, roadCorridor, referenceRoads, droppedReferenceRoutes } = buildWorldFoundation();
	const isMobileClass = isCoarsePointerDevice();
	const chunkManager = new ChunkManager({
		scene,
		chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
		segments: isMobileClass ? CHUNK_CONFIG.TERRAIN_SEGMENTS_MOBILE : CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		flattenPads,
		roadCorridor,
		valleyField,
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

	// Single ground-height source for the whole scene (physics.js — also what FAZ 4's player
	// snaps to). Static, generated once — see world/rivers.js module doc for why the river itself
	// doesn't stream/update per frame yet. Same `flattenPads` as `chunkManager` above (ADR-0118) so
	// this never disagrees with the rendered ground mesh under a castle.
	const groundCollider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads, roadCorridor, valleyField);

	// Bathymetry for the water surface (ADR-0270). Baked once, from the *same* flattened height
	// field the rendered chunks and every gameplay query use, so the swell's amplitude taper can
	// never disagree with the ground it is tapering against. Until this is attached the water plane
	// stays exactly as flat as the ADR-0048 version.
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
	// Run 376: the historical river goes through `buildRiverSurface` too. Measured on the untouched
	// tree, **70.9% of it was underground** — worse than any of the ten new rivers, and the same cause:
	// a ribbon laid on the traced polyline's 40 m chords while the ground between those points rose
	// through it (worst 37 m). Nobody had looked closely at it in 376 runs. Leaving it would make the
	// one original river the only broken one in a world of eleven. Its *path* is untouched, so the
	// waterfall thresholds ADR-0011 calibrated against this exact course still see what they measured.
	const river = createRiverMesh(
		buildRiverSurface(riverPoints, groundCollider.getGroundHeight),
		undefined,
		groundCollider.getGroundHeight,
	);
	if (river) scene.add(river);
	console.info(
		`[sceneManager] River path traced: ${riverPoints.length} points, ended via "${riverEndReason}".`,
	);

	// The map's named rivers (run 376 / ADR-0323). `terrainValleyCarving.js` has already cut their
	// valleys into the ground `groundCollider` samples; these are the ribbons of water that run in them.
	const namedRiverMeshes = createNamedRiverMeshes({
		namedRivers: valleyField.namedRivers,
		sampleHeightMeters: groundCollider.getGroundHeight,
	});
	namedRiverMeshes.forEach((mesh) => scene.add(mesh));
	console.info(
		`[sceneManager] Named rivers: ${namedRiverMeshes.length} traced — ` +
			`${namedRiverMeshes.map((mesh) => mesh.userData.namedRiver.id).join(', ')}.`,
	);

	// Waterfall "curtains" mark the river's steepest segments — see world/rivers.js module doc /
	// DECISIONS.md ADR-0011 for why the visual is schematic rather than a physically-carved cliff.
	const waterfallMeshes = detectWaterfalls(riverPoints).map((waterfall) => createWaterfallMesh(waterfall));
	waterfallMeshes.forEach((mesh) => scene.add(mesh));
	console.info(`[sceneManager] Detected ${waterfallMeshes.length} waterfall-grade drop(s) along the river.`);

	// One array for every flow-animated water mesh that is not the primary river. Its consumers —
	// `game3d.js`, `rtsGame.js` and the editor's sync/cleanup — each do exactly two generic things with
	// it, advance the flow uniform and dispose geometry + material, so named-river ribbons and waterfall
	// curtains ride together. It was called `waterfalls` when curtains were the only thing in it.
	const waterFeatures = [...namedRiverMeshes, ...waterfallMeshes];

	// One procedural castle per kingdom seat (FAZ 3) — see world/settlements.js and DECISIONS.md ADR-0013.
	const settlementsResult = createSettlements({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		mapBounds: WORLD_SCALE.MAP_BOUNDS,
		metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
		settlementConfig: SETTLEMENT_CONFIG,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	scene.add(settlementsResult.group);
	// Most seats sit outside both the boot-preview and mobile streaming radii (measured — see
	// DECISIONS.md ADR-0013). Force-loading a neighborhood under each one is desktop-only: doing
	// it unconditionally was measured to add ~92 extra chunks (~753K triangles) on the mobile path
	// alone — 1.9x the *entire* mobile triangle budget by itself, on top of the terrain already
	// loaded. Caught by this run's own smoke test before commit, not shipped and fixed later — see
	// DECISIONS.md ADR-0013's Consequence. Mobile-class devices place settlements at their correct
	// sampled height regardless (still uses the real terrain height, just may render without a
	// visible ground mesh directly beneath until the player-streaming system reaches that chunk).
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

	// FAZ 3's "Basit ... collider": keeps the player from walking through a castle's keep/towers —
	// see physics.js's createSettlementCollider doc comment for the box+circle shape this uses.
	const settlementCollider = createSettlementCollider(settlementsResult.seats, SETTLEMENT_CONFIG);

	// GOVERNANCE.md §18 priority #2: a road network (minimum spanning tree, 13 edges) connecting all
	// 14 kingdom seats, each edge routed by world/roads.js's slope-aware A* over the same real,
	// combined (fine-FBM + macro-relief) height field every other world system already reads through
	// `groundCollider.getGroundHeight` — see DECISIONS.md ADR-0076.
	const roadsResult = buildRoadNetwork({
		seats: settlementsResult.seats,
		sampleHeightMeters: groundCollider.getGroundHeight,
	});
	scene.add(roadsResult.group);
	// Canonical highways, re-projected onto the bedded ground the chunks actually draw.
	const referenceRoadsOnBed = referenceRoads.map((road) => ({
		...road,
		points: road.points.map((point) => ({ x: point.x, y: groundCollider.getGroundHeight(point.x, point.z), z: point.z })),
	}));
	const referenceRoadMeshes = createReferenceRoadMeshes(referenceRoadsOnBed, groundCollider.getGroundHeight);
	scene.add(referenceRoadMeshes.group);
	console.info(
		`[sceneManager] Owner-map roads: ${referenceRoadMeshes.roadCount} canonical route(s), ` +
			`${(referenceRoadMeshes.totalLengthMeters / 1000).toFixed(2)} km, read from resimler/map.png` +
			`${droppedReferenceRoutes.length ? `; dropped ${droppedReferenceRoutes.map((r) => r.id).join(', ')} — no dry path` : ''}.`,
	);
	console.info(
		`[sceneManager] Built road network: ${roadsResult.edges.length} segment(s) connecting ` +
			`${settlementsResult.seats.length} kingdom seats, ${(roadsResult.totalLengthMeters / 1000).toFixed(2)} km total, ` +
			`steepest actual segment grade ${roadsResult.maxGradeDegrees.toFixed(1)}°.`,
	);

	// Villages (run 330, ADR-0276) — houses, stone stoops and field walls in a ring around each seat,
	// so a castle stands over a settlement instead of over empty grass. Same `isPlaceablePosition`
	// exclusion rules and same radius guard as the vegetation scatter below; five instanced meshes for
	// the whole world, not one per building.
	//
	// Built *before* vegetation as of run 358 / ADR-0305: the forest pass now covers every piece of land
	// that is not a seat, a road or a village, so it needs these house positions to keep clear. Villages
	// depend only on terrain, seats and roads, so moving them earlier changes nothing about them.
	// Every river course in one list, for the placement predicate shared by villages and vegetation.
	// Measured before this: 52 of 14344 scattered instances stood inside a channel, some 0.3 m from the
	// centreline. `isPlaceablePosition` knew the sea and the roads but not the rivers, and a river runs
	// above sea level so the waterline test could never catch one.
	const riverCourses = [{ points: riverPoints }, ...(valleyField.namedRivers ?? []).map((river) => ({ points: river.points }))];

	const villagesResult = createVillages({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		riverCourses,
		radiusMeters: previewRadiusChunks * CHUNK_CONFIG.CHUNK_SIZE_METERS,
		mulberry32,
	});
	scene.add(villagesResult.group);
	console.info(
		`[sceneManager] Built villages: ${villagesResult.houseCount} house(s) and ${villagesResult.wallCount} field wall(s) ` +
			`across ${villagesResult.villageCount} village(s).`,
	);

	// Procedural vegetation (GOVERNANCE.md §3's long-named-but-never-built "Vegetation" world
	// system — see world/vegetation.js's own module doc). Scatter radius matches whatever terrain
	// radius this device class actually loaded above (`previewRadiusChunks`), so trees never render
	// over a chunk that was never generated and density naturally scales down on the mobile-budget
	// path with no separate device-specific knob — see DECISIONS.md's newest ADR. Also layers in
	// run 113/ADR-0140's seat-local clustering ring for whichever seats qualify (see
	// `createVegetation`'s own doc comment) — `clusterSeatCount` reports how many, so this log line
	// stays honest about mobile's expected 0.
	const vegetationResult = createVegetation({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		riverCourses,
		radiusMeters: previewRadiusChunks * CHUNK_CONFIG.CHUNK_SIZE_METERS,
		villageHouses: villagesResult.houses,
	});
	scene.add(vegetationResult.group);
	console.info(
		`[sceneManager] Scattered vegetation: ${vegetationResult.placedCount}/${vegetationResult.targetCount} tree(s) placed ` +
			`(${vegetationResult.forestCount} of them forest, ${vegetationResult.clusterSeatCount} seat(s) with a local cluster ring).`,
	);

	// Run 330's own "no collision" technical debt, fixed: one circle per house (physics.js's
	// createCircleCollider), same default player half-width as the castle collider above. Combined
	// with the castle collider into one `playerCollider` (physics.js's `createComposedCollider`, run
	// 337 — replaces this file's own hand-rolled two-collider chain object with the same behavior)
	// so gameplay/player.js only ever needs to call a single resolveXZ — it doesn't need to know how
	// many separate obstacle systems exist. `registerDynamicCollider` also lets a later-spawned,
	// moving obstacle (`gameplay/cartBrain.js`'s carts, added by `gameplay/livingWorldSpawner.js`
	// after this function has already returned) join the same chain without this function needing to
	// know about it in advance.
	const villageCollider = createCircleCollider(villagesResult.houses);
	const playerCollider = createComposedCollider([settlementCollider, villageCollider]);

	// Standing world geometry both casts and receives: a keep should shadow the ground beside it *and*
	// take its own towers' shadows. Deliberately excluded: `sky`/`stars` (they are the light source's
	// backdrop, not lit geometry), `water`/`river`/`waterFeatures` (a shadow-receiving flat plane at a
	// fixed sea level shows the shadow-acne banding `SHADOW_BIAS` cannot fully hide on a surface that
	// large, and the Gerstner displacement means its shadow-map depth would not match its rendered
	// surface anyway — see ADR-0048's own note about that vertex/fragment split).
	applyShadowRoles(settlementsResult.group, { quality: renderQuality });
	applyShadowRoles(villagesResult.group, { quality: renderQuality });
	applyShadowRoles(vegetationResult.group, { quality: renderQuality });
	// Roads are flat decals laid on the terrain — they should take a tree's or a cart's shadow, but
	// casting from them would only produce depth-fighting artifacts against the ground they sit on.
	applyShadowRoles(roadsResult.group, { quality: renderQuality, cast: false });

	return {
		renderer, scene, camera, controls, freeCamera, chunkManager, groundCollider, playerCollider, sky, stars, water, river, waterFeatures,
		/** Village greens, so `world/villageBuildings.js` raises its church in the same village. */
		villageHamlets: villagesResult.hamlets,
		// Exposed so game3d.js can focus the sun's shadow frustum on the player each frame and opt
		// later-spawned entities (player, NPCs, animals, dragons, carts) into shadows with the same
		// resolved budget this function used — rather than re-deriving the device tier a second time.
		renderQuality,
		settlements: settlementsResult.group,
		roads: roadsResult.group,
		roadEdges: roadsResult.edges,
		vegetation: vegetationResult.group,
		villages: villagesResult.group,
		// Exposed (not just the settlements.group mesh) so initGame3D can place FAZ 5 NPCs relative to
		// a named kingdom seat's real world position/ground height without re-deriving mapToWorldXZ.
		settlementSeats: settlementsResult.seats,
		lights, skyBodies, clock, elapsedSeconds: 0, lastStreamChunk: null,
		// Reused every frame by resolveCameraCollision() — a fresh Raycaster per frame would be
		// needless garbage for a purely synchronous, single-frame query.
		cameraCollisionRaycaster: new THREE.Raycaster(),
	};
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

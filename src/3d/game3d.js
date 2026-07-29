/**
 * Entry point for the 3D Westeros world.
 *
 * Phase 1 scope: on top of the Phase 0 architecture (EventBus, GameState, AssetLoader), boots a
 * bare Three.js renderer/scene/camera against `#game3d-canvas` (see `game3d.html`), loads a
 * `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` neighborhood of real, seeded terrain chunks around
 * the origin via `world/chunkManager.js`, and then additively streams in more chunks
 * (`STREAM_RADIUS_CHUNKS`) as the interactive `OrbitControls` camera's target (`camera.js`) moves
 * into new chunks — World Coverage now grows by exploring, not just by a bigger boot-time load.
 * A procedural aurora skybox (`sky.js`) surrounds the camera. FAZ 2 is in progress: a Gerstner-wave
 * sea-level water plane (`world/water.js`) floods low-lying terrain, a real-time day/night cycle
 * (`lighting.js`) animates the sun/hemisphere lights and the sky's colors/aurora visibility
 * together, a starfield (`stars.js`) fades in over the same night state, distance fog (`fog.js`)
 * — synced to the same day/night state — fades terrain into the horizon, and one static river
 * (`world/rivers.js`) traces a deterministic downhill path from high ground near the origin down
 * to sea level, with vertical "curtain" meshes marking its steepest (waterfall-grade) segments.
 * FAZ 4 (in progress): a playable character (`gameplay/player.js`) spawns at the world origin,
 * moves via WASD/arrow keys (`input.js`) or an on-screen joystick on touch-primary devices
 * (`ui/touchJoystick.js`) relative to the camera's facing, snaps to ground height (`physics.js`),
 * and the same `OrbitControls` instance becomes its chase camera — see DECISIONS.md ADR-0016 and
 * ADR-0017.
 * See 3D_GAME_PROGRESS.md for what's next.
 * @module game3d
 */

import * as THREE from 'three';
import { gameEvents } from './eventBus.js';
import { gameState } from './state.js';
import { AssetLoader } from './assetLoader.js';
import { EVENTS, WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG, SETTLEMENT_CONFIG, PLAYER_CONFIG } from './config.js';
import { ChunkManager } from './world/chunkManager.js';
import { createGroundCollider } from './physics.js';
import { KeyboardInput } from './input.js';
import { TouchJoystick } from './ui/touchJoystick.js';
import { createPlayer } from './gameplay/player.js';
import { createWater, updateWater, disposeWater } from './world/water.js';
import {
	generateRiverPath,
	createRiverMesh,
	disposeRiverMesh,
	detectWaterfalls,
	createWaterfallMesh,
	disposeWaterfallMesh,
} from './world/rivers.js';
import { createSettlements, disposeSettlements } from './world/settlements.js';
import { createOrbitCamera } from './camera.js';
import { createAuroraSky, updateAuroraSky, disposeAuroraSky } from './sky.js';
import { createStarfield, updateStarfield, disposeStarfield } from './stars.js';
import { createDayNightLighting, updateDayNightLighting, disposeDayNightLighting } from './lighting.js';
import { createFog, updateFog } from './fog.js';

/** Shared asset loader instance for the whole 3D mode. */
export const assetLoader = new AssetLoader({ events: gameEvents });

gameEvents.on(EVENTS.ASSET_PROGRESS, ({ ratio }) => {
	gameState.set('loadProgress', ratio);
});

gameEvents.on(EVENTS.ASSETS_READY, () => {
	gameState.set('isLoading', false);
});

gameEvents.on(EVENTS.ASSET_ERROR, (payload) => {
	console.error('[game3d] asset error', payload);
});

/**
 * Detects a touch-primary (phone/tablet-class) device via the standard `(pointer: coarse)` media
 * query — more reliable than user-agent sniffing, and the same signal a CSS media query would use.
 * Falls back to `false` (treat as desktop) if `matchMedia` itself is unavailable, so this can never
 * throw and block scene creation.
 * @returns {boolean}
 */
function isCoarsePointerDevice() {
	try {
		return window.matchMedia('(pointer: coarse)').matches;
	} catch {
		return false;
	}
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
 * @returns {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: import('./camera.js').OrbitControls, chunkManager: ChunkManager, groundCollider: {getGroundHeight: (x: number, z: number) => number}, sky: THREE.Mesh, stars: THREE.Points, water: THREE.Mesh, river: THREE.Mesh | null, waterfalls: THREE.Mesh[], settlements: THREE.Group, lights: {sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight}, clock: THREE.Clock, elapsedSeconds: number, lastStreamChunk: {x: number, z: number} | null}}
 */
function createScene(canvas) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);

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

	const sky = createAuroraSky();
	scene.add(sky);
	const stars = createStarfield(WORLD_DEFAULTS.WORLD_SEED);
	scene.add(stars);
	const water = createWater(WORLD_DEFAULTS.WATER_LEVEL_METERS);
	scene.add(water);
	const clock = new THREE.Clock();

	const lights = createDayNightLighting(scene);

	const chunkManager = new ChunkManager({
		scene,
		chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	// Touch-primary devices get the mobile-budget STREAM_RADIUS_CHUNKS instead of the desktop-only
	// PHASE1_PREVIEW_RADIUS_CHUNKS boot preview — see this function's own doc comment / ADR-0010.
	const isMobileClass = isCoarsePointerDevice();
	const previewRadiusChunks = isMobileClass ? CHUNK_CONFIG.STREAM_RADIUS_CHUNKS : CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS;
	const generationStart = performance.now();
	chunkManager.loadSquare(0, 0, previewRadiusChunks);
	const generationMs = performance.now() - generationStart;
	console.info(
		`[game3d] Loaded ${chunkManager.loadedCount} terrain chunks ` +
			`(~${chunkManager.getCoveredAreaKm2().toFixed(2)} km²) in ${generationMs.toFixed(0)}ms ` +
			`(${isMobileClass ? 'touch/mobile-class device — mobile-budget radius' : 'desktop-class device — full preview radius'}).`,
	);

	// Single ground-height source for the whole scene (physics.js — also what FAZ 4's player
	// snaps to). Static, generated once — see world/rivers.js module doc for why the river itself
	// doesn't stream/update per frame yet.
	const groundCollider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED);
	const { points: riverPoints, endReason: riverEndReason } = generateRiverPath({
		seed: WORLD_DEFAULTS.WORLD_SEED,
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
	});
	const river = createRiverMesh(riverPoints);
	if (river) scene.add(river);
	console.info(
		`[game3d] River path traced: ${riverPoints.length} points, ended via "${riverEndReason}".`,
	);

	// Waterfall "curtains" mark the river's steepest segments — see world/rivers.js module doc /
	// DECISIONS.md ADR-0011 for why the visual is schematic rather than a physically-carved cliff.
	const waterfalls = detectWaterfalls(riverPoints).map((waterfall) => createWaterfallMesh(waterfall));
	waterfalls.forEach((mesh) => scene.add(mesh));
	console.info(`[game3d] Detected ${waterfalls.length} waterfall-grade drop(s) along the river.`);

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
		`[game3d] Placed ${settlementsResult.seats.length} kingdom-seat settlements; ` +
			`${chunkManager.loadedCount} terrain chunks resident ` +
			`(~${chunkManager.getCoveredAreaKm2().toFixed(2)} km²)${isMobileClass ? ' (mobile — grounding skipped, see ADR-0013)' : ' after grounding them'}.`,
	);

	return { renderer, scene, camera, controls, chunkManager, groundCollider, sky, stars, water, river, waterfalls, settlements: settlementsResult.group, lights, clock, elapsedSeconds: 0, lastStreamChunk: null };
}

/**
 * Computes a normalized (or zero) world-space `(x, z)` movement direction from raw input axes and
 * the camera's current facing — kept here (not in `gameplay/player.js`) so gameplay code stays
 * camera-agnostic (see `gameplay/README.md`'s Conventions).
 * @param {THREE.PerspectiveCamera} camera
 * @param {import('./camera.js').OrbitControls} controls
 * @param {{forward: number, strafe: number}} axes
 * @returns {{x: number, z: number}}
 */
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
function computeCameraRelativeMove(camera, controls, axes) {
	if (axes.forward === 0 && axes.strafe === 0) return { x: 0, z: 0 };

	_forward.subVectors(controls.target, camera.position);
	_forward.y = 0;
	if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
	else _forward.normalize();
	_right.crossVectors(_forward, _worldUp).normalize();

	_move.set(0, 0, 0).addScaledVector(_forward, axes.forward).addScaledVector(_right, axes.strafe);
	if (_move.lengthSq() < 1e-6) return { x: 0, z: 0 };
	_move.normalize();
	return { x: _move.x, z: _move.z };
}

/**
 * Combines keyboard and (optional) touch-joystick axes into one `{forward, strafe, running}`,
 * summing the continuous forward/strafe components (clamped back to [-1, 1]) and OR-ing `running`
 * — lets a touch-capable device with a plugged-in keyboard use either without one silently
 * overriding the other, and costs nothing extra on devices with no joystick (`joystickAxes` is
 * `null` there, so this just returns `keyboardAxes` unchanged).
 * @param {{forward: number, strafe: number, running: boolean}} keyboardAxes
 * @param {{forward: number, strafe: number, running: boolean} | null} joystickAxes
 * @returns {{forward: number, strafe: number, running: boolean}}
 */
function combineAxes(keyboardAxes, joystickAxes) {
	if (!joystickAxes) return keyboardAxes;
	return {
		forward: Math.max(-1, Math.min(1, keyboardAxes.forward + joystickAxes.forward)),
		strafe: Math.max(-1, Math.min(1, keyboardAxes.strafe + joystickAxes.strafe)),
		running: keyboardAxes.running || joystickAxes.running,
	};
}

/**
 * Converts a world-space coordinate to the chunk grid coordinate it falls in, matching the
 * `world/README.md` convention (chunk `(cx, cz)` centered at world `(cx * size, 0, cz * size)`).
 * @param {number} worldCoord
 * @param {number} chunkSizeMeters
 * @returns {number}
 */
function worldToChunkCoord(worldCoord, chunkSizeMeters) {
	return Math.round(worldCoord / chunkSizeMeters);
}

/**
 * Streams in new chunks around the orbit target, but only when it has actually crossed into a
 * different chunk since the last check — cheap to call every frame since the common case (camera
 * orbiting, target not panned) is a no-op integer comparison.
 * @param {{controls: import('./camera.js').OrbitControls, chunkManager: ChunkManager, lastStreamChunk: {x: number, z: number} | null}} state
 */
function streamAroundOrbitTarget(state) {
	const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const targetChunkX = worldToChunkCoord(state.controls.target.x, chunkSize);
	const targetChunkZ = worldToChunkCoord(state.controls.target.z, chunkSize);

	if (
		state.lastStreamChunk &&
		state.lastStreamChunk.x === targetChunkX &&
		state.lastStreamChunk.z === targetChunkZ
	) {
		return;
	}
	state.lastStreamChunk = { x: targetChunkX, z: targetChunkZ };

	const beforeCount = state.chunkManager.everGeneratedCount;
	state.chunkManager.streamTowards(targetChunkX, targetChunkZ, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS);
	const newlyGenerated = state.chunkManager.everGeneratedCount - beforeCount;
	if (newlyGenerated > 0) {
		console.info(
			`[game3d] Streamed in ${newlyGenerated} new chunk(s) near (${targetChunkX}, ${targetChunkZ}) ` +
				`— cumulative World Coverage now ${state.chunkManager.getCumulativeCoveredAreaKm2().toFixed(2)} km².`,
		);
	}
}

/**
 * Wires window resize handling for a render state's camera/renderer.
 * @param {{renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera}} state
 * @returns {() => void} Call to remove the listener.
 */
function bindResize(state) {
	const onResize = () => {
		const { innerWidth, innerHeight } = window;
		state.camera.aspect = innerWidth / innerHeight;
		state.camera.updateProjectionMatrix();
		state.renderer.setSize(innerWidth, innerHeight);
	};
	window.addEventListener('resize', onResize);
	return () => window.removeEventListener('resize', onResize);
}

/**
 * Bootstraps the 3D mode: Phase 0 architecture, then — only if a `#game3d-canvas` element is
 * present on the page — the Phase 1 renderer/scene/camera and render loop. Callers without a
 * canvas (tests, future non-rendering contexts) get a warning and Phase 0 behavior, not a throw.
 * @returns {Promise<void>}
 */
export async function initGame3D() {
	try {
		gameState.set('currentPhase', 'phase0-architecture');
		gameEvents.emit(EVENTS.GAME_READY, { phase: 'phase0-architecture' });
		console.info('[game3d] Phase 0 architecture initialized: EventBus, GameState, AssetLoader ready.');

		const canvas = document.getElementById('game3d-canvas');
		if (!canvas) {
			console.warn('[game3d] No #game3d-canvas found — skipping renderer setup.');
			return;
		}

		const state = createScene(canvas);
		const unbindResize = bindResize(state);

		// FAZ 4: playable character. Loaded after the terrain/sky/water scene so the loading overlay
		// (hidden only once GAME_READY's "phase1-scene" fires below) stays up for the ~6MB of
		// character/animation FBX downloads too — no half-loaded player pop-in mid-view.
		const keyboardInput = new KeyboardInput(window);
		// Touch-primary devices get an on-screen joystick alongside keyboard support (which stays
		// harmlessly inert there — no physical keyboard to trigger it). Same isCoarsePointerDevice()
		// gate createScene() already uses for the mobile chunk-radius split, so both mobile-only
		// behaviors agree on what counts as "mobile" from one signal.
		const touchJoystick = isCoarsePointerDevice() ? new TouchJoystick() : null;
		const player = await createPlayer({
			assetLoader,
			groundCollider: state.groundCollider,
			spawn: { x: PLAYER_CONFIG.SPAWN_X_METERS, z: PLAYER_CONFIG.SPAWN_Z_METERS },
		});
		state.scene.add(player.object3D);
		state.player = player;
		state.keyboardInput = keyboardInput;
		state.touchJoystick = touchJoystick;
		// A player now exists — panning the target would just get overwritten next frame (the
		// camera chases the player instead), so free-pan is no longer meaningful. See camera.js.
		state.controls.enablePan = false;
		// Frame the camera behind/above the player before the first render (subsequent frames only
		// move controls.target — see the tick loop below — letting OrbitControls preserve whatever
		// relative orbit offset the user has dragged to).
		const { x: offsetX, y: offsetY, z: offsetZ } = PLAYER_CONFIG.CAMERA_INITIAL_OFFSET_METERS;
		state.camera.position.set(
			player.object3D.position.x + offsetX,
			player.object3D.position.y + offsetY,
			player.object3D.position.z + offsetZ,
		);
		state.controls.target.set(
			player.object3D.position.x,
			player.object3D.position.y + PLAYER_CONFIG.CAMERA_TARGET_HEIGHT_METERS,
			player.object3D.position.z,
		);
		state.controls.update();

		let frameId;
		const tick = () => {
			frameId = requestAnimationFrame(tick);
			const delta = state.clock.getDelta();
			state.elapsedSeconds += delta;

			const axes = combineAxes(state.keyboardInput.getAxes(), state.touchJoystick?.getAxes() ?? null);
			const moveDirection = computeCameraRelativeMove(state.camera, state.controls, axes);
			// OrbitControls computes its offset as (camera.position - target) every update() call —
			// moving `target` alone (without moving `camera.position` by the same amount) cancels
			// itself out and leaves the camera stationary while it re-aims at the new target (found
			// via this run's own headless-browser movement test: the player visibly walked away from
			// a camera that never followed). Translating both by the player's per-frame delta
			// preserves the user's current orbit/zoom offset while actually chasing the player.
			const previousTargetX = state.controls.target.x;
			const previousTargetZ = state.controls.target.z;
			state.player.update(delta, moveDirection, axes.running);
			const playerPos = state.player.object3D.position;
			state.camera.position.x += playerPos.x - previousTargetX;
			state.camera.position.z += playerPos.z - previousTargetZ;
			state.controls.target.set(playerPos.x, playerPos.y + PLAYER_CONFIG.CAMERA_TARGET_HEIGHT_METERS, playerPos.z);

			state.controls.update(); // required every frame: enableDamping is on
			streamAroundOrbitTarget(state);
			const elapsedSeconds = state.elapsedSeconds;
			const dayNight = updateDayNightLighting(
				state.lights,
				elapsedSeconds,
				WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
				WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO,
			);
			updateAuroraSky(state.sky, state.camera.position, elapsedSeconds, dayNight);
			updateStarfield(state.stars, state.camera.position, dayNight.nightFactor);
			updateFog(state.scene.fog, dayNight);
			updateWater(state.water, state.camera.position, elapsedSeconds);
			state.renderer.render(state.scene, state.camera);
		};
		tick();

		window.addEventListener('pagehide', () => {
			cancelAnimationFrame(frameId);
			unbindResize();
			state.keyboardInput.dispose();
			state.touchJoystick?.dispose();
			state.player.dispose();
			state.controls.dispose();
			state.chunkManager.disposeAll();
			disposeAuroraSky(state.sky);
			disposeStarfield(state.stars);
			disposeWater(state.water);
			if (state.river) disposeRiverMesh(state.river);
			state.waterfalls.forEach(disposeWaterfallMesh);
			disposeSettlements(state.settlements);
			disposeDayNightLighting(state.scene, state.lights);
			state.renderer.dispose();
		}, { once: true });

		gameState.set('currentPhase', 'phase1-scene');
		gameEvents.emit(EVENTS.GAME_READY, { phase: 'phase1-scene' });
		console.info(
			`[game3d] Phase 1 scene bootstrap ready: renderer/scene/camera + chase-cam controls live, ` +
				`${state.chunkManager.loadedCount} terrain chunks rendering, player spawned at ` +
				`(${player.object3D.position.x.toFixed(1)}, ${player.object3D.position.y.toFixed(1)}, ${player.object3D.position.z.toFixed(1)}).`,
		);
	} catch (error) {
		gameState.set('error', error.message);
		gameEvents.emit(EVENTS.GAME_ERROR, { error });
		console.error('[game3d] initialization failed', error);
	}
}

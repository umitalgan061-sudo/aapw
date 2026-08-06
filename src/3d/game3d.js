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
 * to sea level, with vertical "curtain" meshes marking its steepest (waterfall-grade) segments. A
 * slope-aware road network (`world/roads.js`, run 56, DECISIONS.md ADR-0076) connects all 14
 * kingdom seats via a minimum-spanning-tree of A*-routed cart roads, rendered as one merged dirt-
 * colored ribbon mesh.
 * FAZ 4 (in progress): a playable character (`gameplay/player.js`) spawns at the world origin,
 * moves via WASD/arrow keys (`input.js`) or an on-screen joystick on touch-primary devices
 * (`ui/touchJoystick.js`) relative to the camera's facing, snaps to ground height (`physics.js`),
 * and the same `OrbitControls` instance becomes its chase camera, with `camera.js`'s
 * `resolveCameraCollision` pulling it in front of any terrain/castle it would otherwise clip
 * through — see DECISIONS.md ADR-0016, ADR-0017, and ADR-0018. FAZ 5 (in progress, run 20): a
 * first pass of static, idling NPCs (`gameplay/npc.js`) reusing the same Mixamo FBX pipeline
 * stands near the `stannis` kingdom seat — see ADR-0019. FAZ 5/6 NPC and animal spawn-resolution
 * wiring now lives in `gameplay/npc.js`'s `spawnConfiguredNPCs` / `gameplay/animals.js`'s
 * `spawnConfiguredAnimals` (run 29), not this file — see ADR-0028. The renderer/scene/camera
 * bootstrap itself (terrain boot-preview, water/sky/stars/lighting, river/settlements, colliders,
 * the F4 debug camera) lives in `sceneManager.js`'s `createScene` (run 40, ADR-0052) — this file
 * owns the tick loop and lifecycle wiring that calls it, not scene construction.
 * See 3D_GAME_PROGRESS.md for what's next.
 * @module game3d
 */

import * as THREE from 'three';
import { gameEvents } from './eventBus.js';
import { gameState } from './state.js';
import { AssetLoader } from './assetLoader.js';
import { EVENTS, WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG, SETTLEMENT_CONFIG } from './config.js';
import { PLAYER_CONFIG, NPC_CONFIG, ANIMAL_CONFIG, DRAGON_CONFIG, INTERACTION_CONFIG } from './gameplay/gameplayConfig.js';
import { KeyboardInput } from './input.js';
import { TouchJoystick } from './ui/touchJoystick.js';
import { InteractionPrompt } from './ui/interactionPrompt.js';
import { DialogueBox } from './ui/dialogueBox.js';
import { WorldEventToast } from './ui/worldEventToast.js';
import { HealthBar } from './ui/healthBar.js';
import { createPlayer } from './gameplay/player.js';
import { createHealthState } from './gameplay/health.js';
import { spawnConfiguredNPCs } from './gameplay/npc.js';
import { spawnConfiguredAnimals } from './gameplay/animals.js';
import { spawnConfiguredDragons } from './gameplay/dragons.js';
import { createInteractionController } from './gameplay/interaction.js';
import { createWorldEventSystem } from './gameplay/worldEvents.js';
import { updateWater, disposeWater } from './world/water.js';
import { disposeRiverMesh, disposeWaterfallMesh } from './world/rivers.js';
import { disposeSettlements, disposeRealCastleModels, spawnRealCastleModels, mapToWorldXZ } from './world/settlements.js';
import { disposeRoadNetwork } from './world/roads.js';
import { resolveCameraCollision } from './camera.js';
import { updateAuroraSky, disposeAuroraSky } from './sky.js';
import { updateStarfield, disposeStarfield } from './stars.js';
import { updateDayNightLighting, disposeDayNightLighting } from './lighting.js';
import { updateFog } from './fog.js';
import { createScene, isCoarsePointerDevice, worldToChunkCoord } from './sceneManager.js';
import { updateEntitiesSafely, updateSystemSafely } from './safeMode.js';
import { createPerfPanel } from './debug/perfPanel.js';

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

/** Reused across frames by `collectCameraCollidables` — cleared and refilled each call rather than
 * allocated fresh, since it only needs to live for the duration of that frame's raycast. */
const _cameraCollidables = [];

/**
 * Gathers the small set of meshes `camera.js`'s `resolveCameraCollision` should test the chase
 * camera's line of sight against: the terrain chunk the player currently stands in (plus its 8
 * immediate neighbors, so a ray started near a chunk boundary can't miss the chunk it should hit)
 * and every settlement part (`state.settlements`' 3 `InstancedMesh` children — cheap regardless of
 * distance, only 14 castles total). Deliberately excludes water/river meshes (not "walls" in the
 * FAZ 4 Known Issues sense this exists to fix) and the wider unloaded world (the chase camera's
 * `CAMERA_MAX_DISTANCE_METERS` is 40m, far short of even one 500m chunk, so anything farther out
 * can never be the actual occluder).
 * @param {{chunkManager: import('./world/chunkManager.js').ChunkManager, settlements: THREE.Group}} state
 * @param {number} worldX Player's current world-space X.
 * @param {number} worldZ Player's current world-space Z.
 * @returns {THREE.Object3D[]} A reused array — valid only until the next call.
 */
function collectCameraCollidables(state, worldX, worldZ) {
	_cameraCollidables.length = 0;
	const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const centerChunkX = worldToChunkCoord(worldX, chunkSize);
	const centerChunkZ = worldToChunkCoord(worldZ, chunkSize);
	for (let dz = -1; dz <= 1; dz++) {
		for (let dx = -1; dx <= 1; dx++) {
			const mesh = state.chunkManager.getLoadedChunkMesh(centerChunkX + dx, centerChunkZ + dz);
			if (mesh) _cameraCollidables.push(mesh);
		}
	}
	for (const part of state.settlements.children) _cameraCollidables.push(part);
	for (const realCastle of state.realCastles.children) _cameraCollidables.push(realCastle);
	return _cameraCollidables;
}

/**
 * Streams in new chunks around the orbit target, but only when it has actually crossed into a
 * different chunk since the last check — cheap to call every frame since the common case (camera
 * orbiting, target not panned) is a no-op integer comparison.
 * @param {{controls: import('./camera.js').OrbitControls, chunkManager: import('./world/chunkManager.js').ChunkManager, lastStreamChunk: {x: number, z: number} | null}} state
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

		// FAZ 3: real, decimated Meshy AI castle models at 7 kingdom seats (DECISIONS.md ADR-0074),
		// replacing the procedural keep/tower/roof `createSettlements` already skipped for these same
		// seats (see `world/settlements.js`'s `CASTLE_MODEL_ASSIGNMENTS`). Loaded after the scene but
		// before the player/loading-overlay hide, same "keep the overlay up for every model download"
		// reasoning the player/NPC/animal/dragon spawns below already use.
		state.realCastles = await spawnRealCastleModels({
			assetLoader,
			seats: state.settlementSeats,
			seed: WORLD_DEFAULTS.WORLD_SEED,
		});
		state.scene.add(state.realCastles);

		// FAZ 4: playable character. Loaded after the terrain/sky/water scene so the loading overlay
		// (hidden only once GAME_READY's "phase1-scene" fires below) stays up for the ~6MB of
		// character/animation FBX downloads too — no half-loaded player pop-in mid-view.
		const keyboardInput = new KeyboardInput(window);
		// Touch-primary devices get an on-screen joystick alongside keyboard support (which stays
		// harmlessly inert there — no physical keyboard to trigger it). Same isCoarsePointerDevice()
		// gate createScene() already uses for the mobile chunk-radius split, so both mobile-only
		// behaviors agree on what counts as "mobile" from one signal.
		const touchJoystick = isCoarsePointerDevice() ? new TouchJoystick() : null;
		// Converted from map units (not stored pre-converted in gameplayConfig.js, to avoid a
		// gameplayConfig.js -> world/settlements.js import cycle) — see PLAYER_CONFIG.SPAWN_MAP_X/
		// SPAWN_MAP_Y's doc comment and DECISIONS.md ADR-0046 for why the spawn point lives next
		// to a kingdom seat instead of the world origin.
		const spawnWorld = mapToWorldXZ(
			PLAYER_CONFIG.SPAWN_MAP_X,
			PLAYER_CONFIG.SPAWN_MAP_Y,
			WORLD_SCALE.MAP_BOUNDS,
			WORLD_SCALE.METERS_PER_MAP_UNIT,
		);
		const player = await createPlayer({
			assetLoader,
			groundCollider: state.groundCollider,
			settlementCollider: state.settlementCollider,
			spawn: { x: spawnWorld.x, z: spawnWorld.z },
		});
		state.scene.add(player.object3D);
		state.player = player;
		state.keyboardInput = keyboardInput;
		state.touchJoystick = touchJoystick;
		state.interactionPrompt = new InteractionPrompt();
		// FAZ 7 dragon combat (run 90, DECISIONS.md ADR-0116): the health bar is constructed
		// *before* the health state below so its own initial (full-bar) paint isn't missed — see
		// `gameplay/health.js`'s own doc comment on `healthChangedEventName`'s synchronous emit.
		state.healthBar = new HealthBar({
			eventsBus: gameEvents,
			healthChangedEventName: EVENTS.PLAYER_HEALTH_CHANGED,
			damageEventName: EVENTS.PLAYER_DAMAGED,
		});
		state.playerHealth = createHealthState({
			eventsBus: gameEvents,
			maxHealth: PLAYER_CONFIG.MAX_HEALTH,
			damageEventName: EVENTS.PLAYER_DAMAGED,
			healthChangedEventName: EVENTS.PLAYER_HEALTH_CHANGED,
			diedEventName: EVENTS.PLAYER_DIED,
		});
		// Respawn-on-death: teleports back to the original spawn point and heals to full. No
		// SaveSystem exists yet (GOVERNANCE.md §16's Save Game Uyumluluk Kapısı isn't active until
		// one does), so this is a plain in-memory reset, not a persisted checkpoint. Also reuses the
		// existing world-event toast (no new UI) for a real "you were defeated" cue.
		const unsubscribePlayerDied = gameEvents.on(EVENTS.PLAYER_DIED, () => {
			const groundY = state.groundCollider.getGroundHeight(spawnWorld.x, spawnWorld.z);
			player.object3D.position.set(spawnWorld.x, groundY, spawnWorld.z);
			state.playerHealth.reset();
			gameEvents.emit(EVENTS.WORLD_EVENT_TRIGGERED, {
				id: 'player_defeated',
				icon: '💀',
				title: 'Yenildin',
				desc: 'Ejderha saldırısı seni alt etti — kaleye geri döndün.',
				color: '#e04040',
			});
		});
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

		// FAZ 5/6: NPCs and wild animals at kingdom-seat settlements. Loaded after the player (same
		// "keep the loading overlay up for every character download" reasoning as the player itself).
		// Spawn resolution itself (seat lookup, patrol-waypoint construction, per-spawn model loading)
		// lives in `gameplay/npc.js`'s `spawnConfiguredNPCs` / `gameplay/animals.js`'s
		// `spawnConfiguredAnimals` (run 29, DECISIONS.md ADR-0028) — moved out of this file to keep it
		// under the project's 600-line cap and let each gameplay system own its own spawn wiring.
		const seatsById = new Map(state.settlementSeats.map((seat) => [seat.id, seat]));
		// Same sea-level-clamp convention world/settlements.js's own placement uses (see
		// world/README.md's "Sea level" convention), so a spawned character never ends up sitting
		// below the water plane if an offset happens to land somewhere lower than the keep itself.
		const sampleClampedGroundY = (worldX, worldZ) => Math.max(
			state.groundCollider.getGroundHeight(worldX, worldZ),
			WORLD_DEFAULTS.WATER_LEVEL_METERS + SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
		);
		state.npcs = await spawnConfiguredNPCs({
			assetLoader,
			npcConfig: NPC_CONFIG,
			seatsById,
			sampleGroundY: sampleClampedGroundY,
			groundCollider: state.groundCollider,
		});
		for (const npc of state.npcs) state.scene.add(npc.object3D);
		console.info(`[game3d] Spawned ${state.npcs.length} FAZ 5 NPC(s).`);

		state.animals = await spawnConfiguredAnimals({
			assetLoader,
			animalConfig: ANIMAL_CONFIG,
			seatsById,
			sampleGroundY: sampleClampedGroundY,
			groundCollider: state.groundCollider,
		});
		for (const animal of state.animals) state.scene.add(animal.object3D);
		console.info(`[game3d] Spawned ${state.animals.length} FAZ 6 animal(s).`);

		// FAZ 7 (run 53): first dragon, circling a kingdom seat at a fixed altitude — see
		// `gameplay/dragons.js` and DECISIONS.md ADR-0071. Same spawn-wiring shape as NPCs/animals
		// above; altitude is ground-height-relative, not absolute, so `sampleClampedGroundY` is reused
		// even though a flying creature never touches the ground itself.
		state.dragons = await spawnConfiguredDragons({
			assetLoader,
			dragonConfig: DRAGON_CONFIG,
			seatsById,
			sampleGroundY: sampleClampedGroundY,
			// Player-awareness (run 54, ADR-0072): reuses the same EventBus + toast UI
			// `gameplay/worldEvents.js`'s ambient flavor events already fire through.
			eventsBus: gameEvents,
			eventName: EVENTS.WORLD_EVENT_TRIGGERED,
			// FAZ 7 dragon combat (run 90, DECISIONS.md ADR-0116) — shared across every spawn the same
			// way `eventName` is; only `DRAGON_CONFIG.SPAWNS[0]` actually configures `biteDamage`, so
			// this alone doesn't activate biting for a future spawn that doesn't opt in.
			biteEventName: EVENTS.PLAYER_DAMAGED,
		});
		for (const dragon of state.dragons) state.scene.add(dragon.object3D);
		console.info(`[game3d] Spawned ${state.dragons.length} FAZ 7 dragon(s).`);

		state.dialogueBox = new DialogueBox();
		// Owns the nearest-NPC tracking, keypress handling, and distance-based auto-close — see
		// `gameplay/interaction.js` (extracted from here to stay under the 600-line cap, ADR-0033).
		state.interaction = createInteractionController({
			interactionPrompt: state.interactionPrompt,
			dialogueBox: state.dialogueBox,
			greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE, greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
			choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
			radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
		});
		const handleInteractKeyDown = (event) => state.interaction.handleKeyDown(event);
		window.addEventListener('keydown', handleInteractKeyDown);
		state.interactionPrompt.setActivateHandler(() => state.interaction.handleKeyDown({ code: 'KeyE', repeat: false }));

		// F2 debug/profiling panel (debug/README.md, ADR-0053) — same isCoarsePointerDevice() signal
		// sceneManager.js's own chunk-radius split already used, so both agree on the device class.
		state.perfPanel = createPerfPanel({ renderer: state.renderer, isMobileClass: isCoarsePointerDevice() });

		// Priority 9.5: periodic world-flavor events routed through the EventBus (DECISIONS.md
		// ADR-0056) — worldEvents.js only emits, worldEventToast.js is the (only, for now) listener.
		state.worldEvents = createWorldEventSystem({
			eventsBus: gameEvents,
			seed: WORLD_DEFAULTS.WORLD_SEED,
			eventName: EVENTS.WORLD_EVENT_TRIGGERED,
		});
		state.worldEventToast = new WorldEventToast({ eventsBus: gameEvents, eventName: EVENTS.WORLD_EVENT_TRIGGERED });

		let frameId;
		const tick = () => {
			frameId = requestAnimationFrame(tick);
			const delta = state.clock.getDelta();
			state.elapsedSeconds += delta;

			const keyboardAxes = state.keyboardInput.getAxes();
			const axes = combineAxes(keyboardAxes, state.touchJoystick?.getAxes() ?? null);
			const moveDirection = computeCameraRelativeMove(state.camera, state.controls, axes);
			// OrbitControls computes its offset as (camera.position - target) every update() call —
			// moving `target` alone (without moving `camera.position` by the same amount) cancels
			// itself out and leaves the camera stationary while it re-aims at the new target (found
			// via this run's own headless-browser movement test: the player visibly walked away from
			// a camera that never followed). Translating both by the player's per-frame delta
			// preserves the user's current orbit/zoom offset while actually chasing the player.
			const previousTargetX = state.controls.target.x;
			const previousTargetZ = state.controls.target.z;
			// Jump is keyboard-only for now (`touchJoystick.js` has no jump button yet — see
			// 3D_GAME_PROGRESS.md Known Issues) — read straight off `keyboardAxes`, not the merged `axes`.
			state.player.update(delta, moveDirection, axes.running, keyboardAxes.jumpRequested);
			// player.update() above already moved player.object3D synchronously this frame, so this
			// read is current — safe to feed into each NPC's combat-stance check and each animal's
			// flee-awareness check below.
			const playerPos = state.player.object3D.position;
			// Every gameplay-subsystem update below goes through `safeMode.js` (GOVERNANCE.md §8.13:
			// one subsystem throwing disables only itself, never the whole frame loop). Dragons got
			// this at run 64, the other four at run 81; run 82 extracted the five near-identical
			// try/catch blocks into that module — see its own doc comment for the two shapes.
			// Run 73 (ADR-0096): playerPos feeds each NPC's combat-stance proximity check — see
			// `gameplay/npc.js`'s `createNPC` doc comment.
			state.npcs = updateEntitiesSafely({
				entities: state.npcs,
				scene: state.scene,
				label: 'NPC',
				update: (npc) => npc.update(delta, playerPos),
			});
			// FAZ 5 interaction (run 32-33, ADR-0032/ADR-0033): nearest-NPC tracking, prompt
			// visibility, and dialogue auto-close all live in `gameplay/interaction.js`.
			state.interactionDisabledDueToError = updateSystemSafely({
				disabled: state.interactionDisabledDueToError,
				label: 'Interaction controller',
				update: () => state.interaction.update(state.npcs, playerPos),
			});
			// Pack awareness (run 29, DECISIONS.md ADR-0029): each animal gets the positions of every
			// *other* animal already flagged `isFleeing` this frame. O(n²) over `state.animals` — fine
			// at today's 2-wolf count (see ADR-0029's Consequence for the revisit threshold if the
			// animal count grows a lot in a future run).
			state.animals = updateEntitiesSafely({
				entities: state.animals,
				scene: state.scene,
				label: 'Animal',
				update: (animal) => animal.update(
					delta,
					playerPos,
					state.animals
						.filter((other) => other !== animal && other.isFleeing)
						.map((other) => ({ x: other.object3D.position.x, z: other.object3D.position.z })),
				),
			});
			// FAZ 7 dragons (run 53 flight path, run 54 player-awareness, run 64 dive) — see
			// `gameplay/dragons.js`'s own doc comment. `playerPos` already reflects this frame's
			// post-movement position (set above).
			state.dragons = updateEntitiesSafely({
				entities: state.dragons,
				scene: state.scene,
				label: 'Dragon',
				update: (dragon) => dragon.update(delta, playerPos),
			});
			state.camera.position.x += playerPos.x - previousTargetX;
			state.camera.position.z += playerPos.z - previousTargetZ;
			state.controls.target.set(playerPos.x, playerPos.y + PLAYER_CONFIG.CAMERA_TARGET_HEIGHT_METERS, playerPos.z);

			state.controls.update(); // required every frame: enableDamping is on
			streamAroundOrbitTarget(state);
			// Computed here (moved up from its original position just below, run 86/ADR-0111) so
			// `dayNight.nightFactor` exists before the world-event block right below needs it to gate
			// time-of-day-restricted events (no aurora at high noon, no midday eclipse at 3am). Nothing
			// between here and its old call site reads `state.lights`/`elapsedSeconds` first, so the
			// reorder is inert for every other caller of `dayNight` further down.
			const elapsedSeconds = state.elapsedSeconds;
			const dayNight = updateDayNightLighting(
				state.lights,
				elapsedSeconds,
				WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
				WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO,
			);
			// Same §8.13 safe mode as the four subsystems above, singleton shape like `interaction` —
			// but this one does own something to release on failure (its countdown), so it passes a
			// `disposeOnError`. `worldEvents.dispose()` is idempotent, so the unconditional teardown
			// call further down stays safe even after this path already disposed it. `dayNight.
			// nightFactor` (run 86/ADR-0111) lets the picker gate day/night-restricted flavor events
			// against the real sky state instead of firing at any hour.
			state.worldEventsDisabledDueToError = updateSystemSafely({
				disabled: state.worldEventsDisabledDueToError,
				label: 'World-event system',
				update: () => state.worldEvents.update(delta, dayNight.nightFactor),
				disposeOnError: () => state.worldEvents.dispose(),
			});
			// F4 debug free-cam (ADR-0049): no-op while inactive; `viewCamera` is what renders below.
			state.freeCamera.update(delta);
			const viewCamera = state.freeCamera.active ? state.freeCamera.camera : state.camera;
			updateAuroraSky(state.sky, viewCamera.position, elapsedSeconds, dayNight);
			updateStarfield(state.stars, viewCamera.position, elapsedSeconds, dayNight.nightFactor);
			updateFog(state.scene.fog, dayNight);
			if (state.freeCamera.active) state.scene.fog.density = 0; // see debug/README.md's Conventions.
			updateWater(state.water, viewCamera.position, elapsedSeconds);

			// Wall-avoidance: pull the camera in front of any terrain/castle occluding the line from
			// the player to it. Applied last (after sky/stars/water already used the true free-orbit
			// position above) and undone right after render — see camera.js's resolveCameraCollision
			// doc comment / DECISIONS.md ADR-0018 for why this never touches OrbitControls' own
			// spherical radius, so the user's actual zoom distance is preserved across occlusions.
			const desiredCameraX = state.camera.position.x;
			const desiredCameraY = state.camera.position.y;
			const desiredCameraZ = state.camera.position.z;
			const collidables = collectCameraCollidables(state, playerPos.x, playerPos.z);
			const resolvedPosition = resolveCameraCollision(
				state.cameraCollisionRaycaster,
				state.controls.target,
				state.camera.position,
				collidables,
				PLAYER_CONFIG.CAMERA_COLLISION_MARGIN_METERS,
				PLAYER_CONFIG.CAMERA_COLLISION_MIN_DISTANCE_METERS,
			);
			state.camera.position.copy(resolvedPosition);
			state.renderer.render(state.scene, viewCamera);
			state.camera.position.set(desiredCameraX, desiredCameraY, desiredCameraZ);
			// After render(): renderer.info.render.calls/.triangles reset on every render() call, so
			// reading them any earlier this frame would report the *previous* frame's numbers.
			state.perfPanel.update(delta);
		};
		tick();

		window.addEventListener('pagehide', () => {
			cancelAnimationFrame(frameId);
			unbindResize();
			state.keyboardInput.dispose();
			state.touchJoystick?.dispose();
			state.interactionPrompt.dispose();
			window.removeEventListener('keydown', handleInteractKeyDown);
			state.dialogueBox.dispose();
			state.player.dispose();
			state.npcs.forEach((npc) => npc.dispose());
			state.animals.forEach((animal) => animal.dispose());
			state.dragons.forEach((dragon) => dragon.dispose());
			state.controls.dispose();
			state.freeCamera.dispose();
			state.perfPanel.dispose();
			state.worldEvents.dispose();
			state.worldEventToast.dispose();
			unsubscribePlayerDied();
			state.playerHealth.dispose();
			state.healthBar.dispose();
			state.chunkManager.disposeAll();
			disposeAuroraSky(state.sky);
			disposeStarfield(state.stars);
			disposeWater(state.water);
			if (state.river) disposeRiverMesh(state.river);
			state.waterfalls.forEach(disposeWaterfallMesh);
			disposeSettlements(state.settlements);
			disposeRealCastleModels(state.realCastles);
			disposeRoadNetwork(state.roads);
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

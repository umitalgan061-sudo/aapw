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
 * colored ribbon mesh. Procedural instanced trees (`world/vegetation.js`, run 111) scatter over the
 * same loaded terrain, avoiding water/steep slopes/kingdom seats/roads.
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
 * owns the tick loop and lifecycle wiring that calls it, not scene construction. The tick loop's
 * pure per-frame helpers (camera-relative movement, axis merging, chase-camera occluder
 * collection, chunk streaming, resize wiring) live in `gameLoopHelpers.js` (run 105) — split out
 * purely to stay under the 600-line file cap, no behavior change. The NPC/animal/procedural-
 * creature/dragon spawn wiring likewise moved to `gameplay/livingWorldSpawner.js` (run 332),
 * same reasoning, same no-behavior-change guarantee.
 * See 3D_GAME_PROGRESS.md for what's next.
 * @module game3d
 */

import { gameEvents } from './eventBus.js';
import { gameState } from './state.js';
import { AssetLoader } from './assetLoader.js';
import { EVENTS, WORLD_DEFAULTS, WORLD_SCALE } from './config.js';
import { PLAYER_CONFIG, INTERACTION_CONFIG } from './gameplay/gameplayConfig.js';
import { KeyboardInput } from './input.js';
import { TouchJoystick } from './ui/touchJoystick.js';
import { InteractionPrompt } from './ui/interactionPrompt.js';
import { DialogueBox } from './ui/dialogueBox.js';
import { WorldEventToast } from './ui/worldEventToast.js';
import { HealthBar } from './ui/healthBar.js';
import { ControlsHelp } from './ui/controlsHelp.js';
import { PauseMenu } from './ui/pauseMenu.js';
import { createAudioManager, readStoredMuted } from './audio/audioManager.js';
import { SettlementCompass } from './ui/settlementCompass.js';
import { SettlementDiscovery } from './ui/settlementDiscovery.js';
import { DayNightClock } from './ui/dayNightClock.js';
import { createPlayer } from './gameplay/player.js';
import { createHealthState } from './gameplay/health.js';
import { spawnLivingWorld } from './gameplay/livingWorldSpawner.js';
import { attachLivingWorldDirector, tickLivingWorldDirector } from './gameplay/livingWorldRuntimeAdapter.js';
import { attachLivingWorldGroups, tickLivingWorldGroups } from './gameplay/livingWorldGroupDirector.js';
import { createInteractionController } from './gameplay/interaction.js';
import { focusSunShadow, applyShadowRoles } from './renderQuality.js';
import { createWorldEventSystem } from './gameplay/worldEvents.js';
import { updateWater, disposeWater } from './world/water.js';
import { disposeRiverMesh, disposeWaterfallMesh, updateFlowAnimation } from './world/rivers.js';
import { disposeSettlements, disposeRealCastleModels, spawnRealCastleModels, mapToWorldXZ } from './world/settlements.js';
import { disposeRoadNetwork } from './world/roads.js';
import { disposeVegetation } from './world/vegetation.js';
import { disposeVillages } from './world/villages.js';
import { disposeIceLandmarks } from './world/iceLandmarks.js';
// Run 135 / ADR-0159 — new import, additive: `createVegetation` itself is unchanged, this file just
// also calls it a second time (see the mobile spawn-anchored vegetation block below).
import { createVegetation } from './world/vegetation.js';
// Run 135 / ADR-0159 — new import, additive: needed for the mobile spawn-anchored vegetation disc's
// own radius (matches `sceneManager.js`'s own mobile disc sizing, not a fresh constant).
import { CHUNK_CONFIG } from './config.js';
import { resolveCameraCollision } from './camera.js';
import { updateAuroraSky, disposeAuroraSky } from './sky.js';
import { updateStarfield, disposeStarfield } from './stars.js';
import { updateDayNightLighting, disposeDayNightLighting } from './lighting.js';
import { updateFog } from './fog.js';
import { updateMobileVegetationDistanceCullingRun141 } from './world/mobileVegetationCulling.js';
import { createScene, isCoarsePointerDevice } from './sceneManager.js';
import { updateEntitiesSafely, updateSystemSafely } from './safeMode.js';
import { createPerfPanel } from './debug/perfPanel.js';
import {
	computeCameraRelativeMove,
	combineAxes,
	collectCameraCollidables,
	streamAroundOrbitTarget,
	bindResize,
} from './gameLoopHelpers.js';

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

		state.realCastles = await spawnRealCastleModels({
			assetLoader,
			seats: state.settlementSeats,
			seed: WORLD_DEFAULTS.WORLD_SEED,
		});
		state.scene.add(state.realCastles);

		const keyboardInput = new KeyboardInput(window);
		const touchJoystick = isCoarsePointerDevice() ? new TouchJoystick() : null;
		const spawnWorld = mapToWorldXZ(
			PLAYER_CONFIG.SPAWN_MAP_X,
			PLAYER_CONFIG.SPAWN_MAP_Y,
			WORLD_SCALE.MAP_BOUNDS,
			WORLD_SCALE.METERS_PER_MAP_UNIT,
		);
		let mobileSpawnVegetation = null;
		if (isCoarsePointerDevice()) {
			const shiftedSampleHeightMeters = (x, z) => state.groundCollider.getGroundHeight(x + spawnWorld.x, z + spawnWorld.z);
			const shiftedSeats = state.settlementSeats.map((seat) => ({ x: seat.x - spawnWorld.x, z: seat.z - spawnWorld.z }));
			const shiftedRoadEdges = state.roadEdges.map((edge) => ({
				points: edge.points.map((point) => ({ x: point.x - spawnWorld.x, z: point.z - spawnWorld.z })),
			}));
			const spawnVegetationResult = createVegetation({
				sampleHeightMeters: shiftedSampleHeightMeters,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				seed: WORLD_DEFAULTS.WORLD_SEED ^ 0x5350574e,
				seats: shiftedSeats,
				roadEdges: shiftedRoadEdges,
				radiusMeters: CHUNK_CONFIG.STREAM_RADIUS_CHUNKS * CHUNK_CONFIG.CHUNK_SIZE_METERS,
			});
			spawnVegetationResult.group.position.set(spawnWorld.x, 0, spawnWorld.z);
			state.scene.add(spawnVegetationResult.group);
			mobileSpawnVegetation = spawnVegetationResult.group;
			console.info(`[game3d] Mobile spawn-anchored vegetation: ${spawnVegetationResult.placedCount}/${spawnVegetationResult.targetCount} tree(s) near spawn (${spawnWorld.x.toFixed(0)}, ${spawnWorld.z.toFixed(0)}).`);
		}
		state.mobileSpawnVegetation = mobileSpawnVegetation;
		const player = await createPlayer({
			assetLoader,
			groundCollider: state.groundCollider,
			playerCollider: state.playerCollider,
			spawn: { x: spawnWorld.x, z: spawnWorld.z },
		});
		state.scene.add(player.object3D);
		state.player = player;
		state.keyboardInput = keyboardInput;
		state.touchJoystick = touchJoystick;
		state.interactionPrompt = new InteractionPrompt();
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
		state.controls.enablePan = false;
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

		await spawnLivingWorld({ assetLoader, state, spawnWorld, eventsBus: gameEvents });
		state.livingWorldRuntime = attachLivingWorldDirector({ state, eventsBus: gameEvents, worldSeed: WORLD_DEFAULTS.WORLD_SEED });
		state.livingWorldGroups = attachLivingWorldGroups({ state, maxGroupSize: 6, onGroupEvent: (event) => gameEvents.emit('living-world-group', event) });

		const shadowOpts = { quality: state.renderQuality };
		applyShadowRoles(state.player?.object3D, shadowOpts);
		for (const collection of [state.npcs, state.animals, state.creatures, state.carts, state.dragons]) {
			for (const entity of collection ?? []) applyShadowRoles(entity?.object3D ?? entity?.model ?? entity?.group, shadowOpts);
		}

		state.dialogueBox = new DialogueBox();
		state.interaction = createInteractionController({
			interactionPrompt: state.interactionPrompt,
			dialogueBox: state.dialogueBox,
			greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE, greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
			choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
			radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
			isPaused: () => state.paused,
		});
		const handleInteractKeyDown = (event) => state.interaction.handleKeyDown(event);
		window.addEventListener('keydown', handleInteractKeyDown);
		state.interactionPrompt.setActivateHandler(() => state.interaction.handleKeyDown({ code: 'KeyE', repeat: false }));
		state.dialogueBox.setChoiceHandler((index) => state.interaction.handleChoice(index));
		state.dialogueBox.setCloseHandler(() => state.interaction.handleKeyDown({ code: 'KeyE', repeat: false }));

		state.perfPanel = createPerfPanel({ renderer: state.renderer, isMobileClass: isCoarsePointerDevice() });
		state.worldEvents = createWorldEventSystem({ eventsBus: gameEvents, seed: WORLD_DEFAULTS.WORLD_SEED, eventName: EVENTS.WORLD_EVENT_TRIGGERED });
		state.worldEventToast = new WorldEventToast({ eventsBus: gameEvents, eventName: EVENTS.WORLD_EVENT_TRIGGERED });
		state.controlsHelp = new ControlsHelp({ isMobileClass: isCoarsePointerDevice() });
		state.paused = false;
		state.audioManager = createAudioManager({ camera: state.camera, initialMuted: readStoredMuted() });
		state.pauseMenu = new PauseMenu({
			onOpenChange: (open) => { state.paused = open; state.audioManager.playClick(); },
			isMobileClass: isCoarsePointerDevice(),
			onMuteChange: (muted) => state.audioManager.setMuted(muted),
		});
		state.settlementCompass = new SettlementCompass({ seats: state.settlementSeats });
		state.settlementDiscovery = new SettlementDiscovery({ seats: state.settlementSeats, onDiscover: () => state.audioManager.playDiscoveryChime() });
		state.settlementCompass.setSeatFilter((seat) => !state.settlementDiscovery.isDiscovered(seat.id));
		state.dayNightClock = new DayNightClock();

		let frameId;
		const tick = () => {
			frameId = requestAnimationFrame(tick);
			const rawDelta = state.clock.getDelta();
			const delta = state.paused ? 0 : rawDelta;
			state.elapsedSeconds += delta;

			const keyboardAxes = state.keyboardInput.getAxes();
			const axes = combineAxes(keyboardAxes, state.touchJoystick?.getAxes() ?? null);
			const moveDirection = computeCameraRelativeMove(state.camera, state.controls, axes);
			const previousTargetX = state.controls.target.x;
			const previousTargetZ = state.controls.target.z;
			if (state.touchJoystick?.consumeJumpRequested()) keyboardAxes.jumpRequested = true;
			state.player.update(delta, moveDirection, axes.running, keyboardAxes.jumpRequested);
			const playerPos = state.player.object3D.position;
			state.settlementCompass.update(playerPos, state.player.object3D.rotation.y);
			state.settlementDiscovery.update(playerPos);
			state.npcs = updateEntitiesSafely({
				entities: state.npcs,
				scene: state.scene,
				label: 'NPC',
				update: (npc) => npc.update(delta, playerPos),
			});
			state.interactionDisabledDueToError = updateSystemSafely({
				disabled: state.interactionDisabledDueToError,
				label: 'Interaction controller',
				update: () => state.interaction.update(state.npcs, playerPos),
			});
			state.animals = updateEntitiesSafely({
				entities: state.animals,
				scene: state.scene,
				label: 'Animal',
				update: (animal) => animal.update(
					delta,
					playerPos,
					state.animals.filter((other) => other !== animal && other.isFleeing).map((other) => ({ x: other.object3D.position.x, z: other.object3D.position.z })),
				),
			});
			state.creatures = updateEntitiesSafely({
				entities: state.creatures,
				scene: state.scene,
				label: 'Creature',
				update: (creature) => creature.update(
					delta,
					playerPos,
					state.creatures.filter((other) => other !== creature && other.isFleeing).map((other) => ({ x: other.object3D.position.x, z: other.object3D.position.z })),
				),
			});
			state.carts = updateEntitiesSafely({ entities: state.carts, scene: state.scene, label: 'Cart', update: (cart) => cart.update(delta) });
			state.dragons = updateEntitiesSafely({ entities: state.dragons, scene: state.scene, label: 'Dragon', update: (dragon) => dragon.update(delta, playerPos) });

			const livingWorldTick = tickLivingWorldDirector(state, delta, playerPos);
			const livingWorldGroupTick = tickLivingWorldGroups(state, delta, playerPos, { threat: Boolean(playerPos) && state.livingWorldRuntime?.agents?.some((entry) => entry.kind === 'creature' && entry.agent?.state === 'threatened') });
			state.lastLivingWorldTick = livingWorldTick;
			state.lastLivingWorldGroupTick = livingWorldGroupTick;

			state.camera.position.x += playerPos.x - previousTargetX;
			state.camera.position.z += playerPos.z - previousTargetZ;
			state.controls.target.set(playerPos.x, playerPos.y + PLAYER_CONFIG.CAMERA_TARGET_HEIGHT_METERS, playerPos.z);
			state.controls.update();
			streamAroundOrbitTarget(state);
			updateMobileVegetationDistanceCullingRun141(playerPos, [
				{ id: 'origin', group: state.vegetation },
				{ id: 'spawn', group: state.mobileSpawnVegetation },
			], Boolean(state.touchJoystick));
			const elapsedSeconds = state.elapsedSeconds;
			const dayNight = updateDayNightLighting(
				state.lights,
				elapsedSeconds,
				WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
				WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO,
			);
			state.dayNightClock.update(dayNight.timeRatio, dayNight.nightFactor);
			if (state.player?.object3D) {
				const focus = state.player.object3D.position;
				focusSunShadow(state.lights.sun, focus.x, focus.y, focus.z);
			}
			state.worldEventsDisabledDueToError = updateSystemSafely({
				disabled: state.worldEventsDisabledDueToError,
				label: 'World-event system',
				update: () => state.worldEvents.update(delta, dayNight.nightFactor),
				disposeOnError: () => state.worldEvents.dispose(),
			});
			state.freeCamera.update(delta);
			const viewCamera = state.freeCamera.active ? state.freeCamera.camera : state.camera;
			updateAuroraSky(state.sky, viewCamera.position, elapsedSeconds, dayNight);
			updateStarfield(state.stars, viewCamera.position, elapsedSeconds, dayNight.nightFactor);
			updateFog(state.scene.fog, dayNight);
			if (state.freeCamera.active) state.scene.fog.density = 0;
			updateWater(state.water, viewCamera.position, elapsedSeconds);
			updateFlowAnimation(state.river, elapsedSeconds);
			for (const waterfall of state.waterfalls) updateFlowAnimation(waterfall, elapsedSeconds);
			const desiredCameraX = state.camera.position.x;
			const desiredCameraY = state.camera.position.y;
			const desiredCameraZ = state.camera.position.z;
			const cameraCollision = resolveCameraCollision({
				camera: state.camera,
				player: state.player.object3D,
				collidables: collectCameraCollidables(state),
				worldYOffset: PLAYER_CONFIG.CAMERA_TARGET_HEIGHT_METERS,
			});
			state.camera.position.copy(cameraCollision.position);
			state.renderer.render(state.scene, viewCamera);
			state.camera.position.set(desiredCameraX, desiredCameraY, desiredCameraZ);
			state.freeCamera.renderOverlay?.();
			state.perfPanel.update(rawDelta);
		};
		tick();

		gameEvents.emit(EVENTS.GAME_READY, { phase: 'phase1-scene' });
		state.ready = true;
		state.gameEventsCleanup = () => {
			unsubscribePlayerDied?.();
			window.removeEventListener('keydown', handleInteractKeyDown);
			cancelAnimationFrame(frameId);
			unbindResize();
			state.livingWorldRuntime?.dispose?.();
			state.audioManager?.dispose?.();
			state.perfPanel?.dispose?.();
		};
	} catch (error) {
		console.error('[game3d] initialization failed', error);
		gameState.set('isLoading', false);
	}
}

initGame3D();

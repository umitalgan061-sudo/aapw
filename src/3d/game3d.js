/**
 * Entry point for the 3D Westeros world.
 *
 * Phase 1 scope: on top of the Phase 0 architecture (EventBus, GameState, AssetLoader), boots a
 * bare Three.js renderer/scene/camera against `#game3d-canvas` (see `game3d.html`) and renders
 * chunk `(0, 0)` from `world/terrain.js` — the first real, seeded terrain chunk, counted toward
 * World Coverage. Sky and camera controls are separate Phase 1 sub-tasks — see
 * 3D_GAME_PROGRESS.md for what's next.
 * @module game3d
 */

import * as THREE from 'three';
import { gameEvents } from './eventBus.js';
import { gameState } from './state.js';
import { AssetLoader } from './assetLoader.js';
import { EVENTS, WORLD_DEFAULTS, CHUNK_CONFIG } from './config.js';
import { createTerrainChunk, disposeTerrainChunk } from './world/terrain.js';

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
 * Creates the renderer/scene/camera and renders terrain chunk `(0, 0)` against `canvas`. Only
 * one chunk exists so far — no chunk-manager/streaming yet, see 3D_GAME_PROGRESS.md FAZ 1.
 * @param {HTMLCanvasElement} canvas
 * @returns {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, ground: THREE.Mesh}}
 */
function createScene(canvas) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0c0805);

	const camera = new THREE.PerspectiveCamera(
		WORLD_DEFAULTS.FOV_DEGREES,
		window.innerWidth / window.innerHeight,
		WORLD_DEFAULTS.NEAR_PLANE,
		WORLD_DEFAULTS.FAR_PLANE,
	);
	camera.position.set(0, 220, 380);
	camera.lookAt(0, 0, 0);

	scene.add(new THREE.HemisphereLight(0xffe8c0, 0x1a140a, 1.1));
	const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
	sun.position.set(300, 400, 200);
	scene.add(sun);

	const ground = createTerrainChunk({
		chunkX: 0,
		chunkZ: 0,
		size: CHUNK_CONFIG.CHUNK_SIZE_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	scene.add(ground);

	return { renderer, scene, camera, ground };
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

		let frameId;
		const tick = () => {
			frameId = requestAnimationFrame(tick);
			state.renderer.render(state.scene, state.camera);
		};
		tick();

		window.addEventListener('pagehide', () => {
			cancelAnimationFrame(frameId);
			unbindResize();
			disposeTerrainChunk(state.ground);
			state.renderer.dispose();
		}, { once: true });

		gameState.set('currentPhase', 'phase1-scene');
		gameEvents.emit(EVENTS.GAME_READY, { phase: 'phase1-scene' });
		console.info('[game3d] Phase 1 scene bootstrap ready: renderer/scene/camera live, terrain chunk (0,0) rendering.');
	} catch (error) {
		gameState.set('error', error.message);
		gameEvents.emit(EVENTS.GAME_ERROR, { error });
		console.error('[game3d] initialization failed', error);
	}
}

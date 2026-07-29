/**
 * Entry point for the 3D Westeros world.
 *
 * Phase 0 scope only: wire up the shared architecture (EventBus, GameState, AssetLoader) with
 * no rendering yet. The Three.js scene, camera and canvas arrive in Phase 1 — see
 * 3D_GAME_PROGRESS.md for the current phase and next steps.
 * @module game3d
 */

import { gameEvents } from './eventBus.js';
import { gameState } from './state.js';
import { AssetLoader } from './assetLoader.js';
import { EVENTS } from './config.js';

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
 * Bootstraps the 3D mode's core architecture. Phase 1 will extend this function to also
 * create the renderer/scene/camera and start the render loop.
 * @returns {Promise<void>}
 */
export async function initGame3D() {
	try {
		gameState.set('currentPhase', 'phase0-architecture');
		gameEvents.emit(EVENTS.GAME_READY, { phase: 'phase0-architecture' });
		console.info('[game3d] Phase 0 architecture initialized: EventBus, GameState, AssetLoader ready.');
	} catch (error) {
		gameState.set('error', error.message);
		gameEvents.emit(EVENTS.GAME_ERROR, { error });
		console.error('[game3d] initialization failed', error);
	}
}

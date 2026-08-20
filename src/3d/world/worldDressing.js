/**
 * World dressing — the authored-asset layer that sits on top of the generated geography.
 *
 * **Why one module for two things.** `world/worldLandmarkScatter.js` (docks, ruins, windmills, standing
 * stones) and `world/heroTrees.js` (the repository's real tree models) are the same *kind* of layer:
 * both load authored `.glb` files, both place them by biome over ground that
 * `worldFoundation.js` has already finished shaping, both degrade to nothing when the models are
 * unreadable. `game3d.js` sits exactly on the 600-line cap GOVERNANCE.md §5 sets, so composing them
 * here costs the game module nothing — it keeps calling one init and one dispose — while each layer
 * keeps its own file, its own policy and its own tests.
 *
 * **Failure is per-layer.** A layer that throws is logged and skipped; the other still dresses the
 * world, and the game boots either way. Nothing here is load-bearing for gameplay.
 *
 * @module world/worldDressing
 */

import { initWorldLandmarks, disposeWorldLandmarks } from './worldLandmarkScatter.js';
import { initHeroTrees, disposeHeroTrees } from './heroTrees.js';

/** The layers, in the order they are added to the scene. */
const DRESSING_LAYERS = Object.freeze([
	Object.freeze({ id: 'landmarks', init: initWorldLandmarks, dispose: disposeWorldLandmarks }),
	Object.freeze({ id: 'hero-trees', init: initHeroTrees, dispose: disposeHeroTrees }),
]);

/**
 * Builds every dressing layer and adds it to the live scene.
 *
 * Each layer's own `init` does its `scene.add`, so this returns only what teardown needs.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {object} options.state Live game state — needs `scene`, `camera`, `groundCollider`,
 *   `settlementSeats`.
 * @returns {Promise<{id: string, group: import('three').Group, dispose: (group: import('three').Group) => void}[]>}
 */
export async function initWorldDressing({ assetLoader, state }) {
	const built = [];
	for (const layer of DRESSING_LAYERS) {
		try {
			const group = await layer.init({ assetLoader, state });
			if (group) built.push({ id: layer.id, group, dispose: layer.dispose });
		} catch (error) {
			console.warn(`[game3d] World dressing layer "${layer.id}" failed; continuing without it.`, error);
		}
	}
	return built;
}

/** Disposes everything `initWorldDressing` built. */
export function disposeWorldDressing(layers) {
	for (const layer of layers ?? []) {
		layer.group.parent?.remove(layer.group);
		layer.dispose(layer.group);
	}
}

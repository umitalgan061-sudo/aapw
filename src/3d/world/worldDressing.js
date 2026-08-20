/**
 * World dressing — the authored-asset layer that sits on top of the generated geography.
 *
 * **Why this indirection exists.** A dressing layer loads authored `.glb` files and places them by
 * biome over ground `worldFoundation.js` has already finished shaping, degrading to nothing when the
 * models are unreadable. `game3d.js` sits exactly on the 600-line cap GOVERNANCE.md §5 sets, so
 * composing layers here costs the game module nothing — it keeps calling one init and one dispose —
 * while each layer keeps its own file, its own policy and its own tests. Run 370 leaves one layer, but
 * the seam is what let three become one without `game3d.js` changing at all.
 *
 * **Failure is per-layer.** A layer that throws is logged and skipped; any others still dress the
 * world, and the game boots either way. Nothing here is load-bearing for gameplay.
 *
 * @module world/worldDressing
 */

import { initWorldProps, disposeWorldProps } from './worldPropScatter.js';

/**
 * The layers, in the order they are added to the scene.
 *
 * **Run 370 folded three layers into one.** `worldLandmarkScatter.js` placed fourteen hand-picked models
 * in a disc around the player and `heroTrees.js` placed ninety trees in a smaller one. The owner asked
 * for the whole library across the whole map, and `worldPropScatter.js` does that — same biome rules,
 * same placeholder discipline, but the full catalogue and chunk-streamed over the entire world. Keeping
 * the old two alongside it would place the same trees and barns twice in the near field, so they are
 * retired rather than layered.
 */
const DRESSING_LAYERS = Object.freeze([
	Object.freeze({ id: 'world-props', init: initWorldProps, dispose: disposeWorldProps }),
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

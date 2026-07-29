/**
 * Minimal ground-collision resolution for the 3D world (FAZ 4's "Zemin çarpışması").
 *
 * `world/terrain.js` owns the actual height-field math (the same FBM sampler `world/rivers.js`
 * traces its downhill path over) — this module exists so gameplay code depends on "physics", not
 * directly on a world-generation internal, keeping the project's per-folder ownership boundaries
 * clean (see ARCHITECTURE.md). Only ground snapping exists so far: no gravity/velocity simulation,
 * no wall/collider raycast against settlements yet — both are real future work once there's a
 * concrete need (jumping, castle collision), not built speculatively now.
 * @module physics
 */

import { createHeightSampler } from './world/terrain.js';

/**
 * @param {number} seed Must match the world's terrain seed (`WORLD_DEFAULTS.WORLD_SEED`) so
 *   collision agrees with what actually rendered.
 * @param {{octaves?: number, lacunarity?: number, gain?: number}} [fbmOptions] Forwarded to
 *   `createHeightSampler` — leave unset to match `world/terrain.js`'s own chunk-baking defaults.
 * @returns {{getGroundHeight: (worldX: number, worldZ: number) => number}}
 */
export function createGroundCollider(seed, fbmOptions) {
	const sampleHeightMeters = createHeightSampler(seed, fbmOptions);
	return {
		/** Terrain height, in meters, at the given world-space (x, z). */
		getGroundHeight(worldX, worldZ) {
			return sampleHeightMeters(worldX, worldZ);
		},
	};
}

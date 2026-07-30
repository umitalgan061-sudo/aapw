/**
 * Minimal ground- and settlement-collision resolution for the 3D world (FAZ 4's "Zemin
 * çarpışması" and FAZ 3's "Basit ... collider").
 *
 * `world/terrain.js` owns the actual height-field math (the same FBM sampler `world/rivers.js`
 * traces its downhill path over) — this module exists so gameplay code depends on "physics", not
 * directly on a world-generation internal, keeping the project's per-folder ownership boundaries
 * clean (see ARCHITECTURE.md). Ground snapping and horizontal castle collision exist; no gravity/
 * velocity simulation or jumping yet — real future work once there's a concrete need, not built
 * speculatively now.
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

/** Corner-tower offsets shared by every seat, in the same `(dx, dz)` order
 * `world/settlements.js`'s `createSettlements` places its 4 towers at — kept in sync by hand since
 * both derive from the same `SETTLEMENT_CONFIG.TOWER_CORNER_OFFSET_METERS` value, not duplicated
 * data with two independent sources of truth. */
function towerOffsets(cornerOffsetMeters) {
	return [
		[cornerOffsetMeters, cornerOffsetMeters],
		[cornerOffsetMeters, -cornerOffsetMeters],
		[-cornerOffsetMeters, cornerOffsetMeters],
		[-cornerOffsetMeters, -cornerOffsetMeters],
	];
}

/**
 * Horizontal (X/Z only — no vertical collision, the player always stays on the ground plane)
 * collider against every kingdom-seat castle built by `world/settlements.js`: an axis-aligned box
 * for the keep and a circle for each of its 4 corner towers, both grown by `playerRadiusMeters` so
 * the player's own body doesn't visually clip the wall/tower surface. "Basit" (simple) by design —
 * matches the roadmap's own wording and this project's established pattern of cheap analytic
 * shapes (see `camera.js`'s raycast-based `resolveCameraCollision` for the camera's own, different,
 * approach) rather than a general physics engine, since castles are static axis-aligned primitives,
 * not arbitrary meshes. Cost is O(seat count) per call (14 seats today) — negligible against any
 * per-frame budget.
 * @param {{x: number, z: number}[]} seats `world/settlements.js`'s `createSettlements` return
 *   value's `seats` (real world-space centers, already ground-sampled).
 * @param {import('./config.js').SETTLEMENT_CONFIG} settlementConfig `config.js`'s
 *   `SETTLEMENT_CONFIG` — same keep/tower dimensions the visible geometry was built from, so the
 *   collider matches what's actually rendered.
 * @param {number} [playerRadiusMeters=0.4] Half the player's rough shoulder width — keeps the
 *   character's mesh from visually poking into the wall even while "outside" it by the letter of
 *   the collision test.
 * @returns {{resolveXZ: (worldX: number, worldZ: number) => {x: number, z: number}}}
 */
export function createSettlementCollider(seats, settlementConfig, playerRadiusMeters = 0.4) {
	const halfWidth = settlementConfig.KEEP_WIDTH_METERS / 2 + playerRadiusMeters;
	const halfDepth = settlementConfig.KEEP_DEPTH_METERS / 2 + playerRadiusMeters;
	const towerRadius = settlementConfig.TOWER_RADIUS_BOTTOM_METERS + playerRadiusMeters;
	const offsets = towerOffsets(settlementConfig.TOWER_CORNER_OFFSET_METERS);

	return {
		/**
		 * Pushes `(worldX, worldZ)` out of any castle it's currently penetrating, along the
		 * shallowest escape axis (keep box) or radially (tower circles). A no-op — returns the
		 * input unchanged — when the point isn't inside anything, which is true almost every frame
		 * for almost every seat, so this stays cheap in the common case.
		 */
		resolveXZ(worldX, worldZ) {
			let x = worldX;
			let z = worldZ;
			for (const seat of seats) {
				const localX = x - seat.x;
				const localZ = z - seat.z;
				if (Math.abs(localX) < halfWidth && Math.abs(localZ) < halfDepth) {
					const penetrationX = halfWidth - Math.abs(localX);
					const penetrationZ = halfDepth - Math.abs(localZ);
					if (penetrationX < penetrationZ) {
						x = seat.x + Math.sign(localX || 1) * halfWidth;
					} else {
						z = seat.z + Math.sign(localZ || 1) * halfDepth;
					}
				}
				for (const [dx, dz] of offsets) {
					const towerX = seat.x + dx;
					const towerZ = seat.z + dz;
					const diffX = x - towerX;
					const diffZ = z - towerZ;
					const distance = Math.hypot(diffX, diffZ);
					if (distance < towerRadius) {
						// Degenerate case (landed exactly on the tower's center, distance ~0, no
						// direction to push along) — kick out along +X rather than leave the point
						// stuck inside; the exact escape axis doesn't matter, only that it always
						// escapes. Real per-frame movement essentially never lands exactly on a
						// single point, but a collider that can silently fail to resolve isn't safe.
						if (distance < 1e-6) {
							x = towerX + towerRadius;
							z = towerZ;
						} else {
							const scale = towerRadius / distance;
							x = towerX + diffX * scale;
							z = towerZ + diffZ * scale;
						}
					}
				}
			}
			return { x, z };
		},
	};
}

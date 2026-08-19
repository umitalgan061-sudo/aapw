/**
 * Minimal ground- and settlement-collision resolution for the 3D world (FAZ 4's "Zemin
 * çarpışması" and FAZ 3's "Basit ... collider").
 *
 * `world/terrain.js` owns the actual height-field math (the same FBM sampler `world/rivers.js`
 * traces its downhill path over) — this module exists so gameplay code depends on "physics", not
 * directly on a world-generation internal, keeping the project's per-folder ownership boundaries
 * clean (see ARCHITECTURE.md). Ground snapping, horizontal castle collision, and a simple jump/
 * gravity arc (`integrateJumpArc`, run 36) all live here.
 * @module physics
 */

import { createHeightSampler } from './world/terrain.js';

/**
 * @param {number} seed Must match the world's terrain seed (`WORLD_DEFAULTS.WORLD_SEED`) so
 *   collision agrees with what actually rendered.
 * @param {{octaves?: number, lacunarity?: number, gain?: number}} [fbmOptions] Forwarded to
 *   `createHeightSampler` — leave unset to match `world/terrain.js`'s own chunk-baking defaults.
 * @param {{x: number, z: number, innerRadiusMeters: number, outerRadiusMeters: number, anchorHeightMeters: number}[]} [flattenPads]
 *   Forwarded to `createHeightSampler` (DECISIONS.md ADR-0118) — `sceneManager.js` passes the exact
 *   same array here and into `world/chunkManager.js`'s `ChunkManager`, so this collider's height
 *   (what settlements/roads/NPCs/animals/dragons/the player all snap to) agrees with the rendered
 *   ground mesh under every kingdom seat's castle.
 * @returns {{getGroundHeight: (worldX: number, worldZ: number) => number}}
 */
export function createGroundCollider(seed, fbmOptions, flattenPads, roadCorridor = null) {
	// `roadCorridor` (ADR-0304) must be the same one the rendered chunks get, or every gameplay height
	// query would disagree with the drawn ground exactly where roads are — the ADR-0118 failure mode.
	const sampleHeightMeters = createHeightSampler(seed, fbmOptions, flattenPads, roadCorridor);
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

/**
 * Pushes `(worldX, worldZ)` radially out of any of `circles` it's currently penetrating — shared by
 * `createCircleCollider` (a fixed list, resolved once) and `createDynamicCircleCollider` (a list
 * re-fetched fresh on every call, for obstacles that move). Same degenerate-center handling as
 * `createSettlementCollider`'s tower loop: always escape somewhere rather than leave the point stuck
 * exactly on a circle's center.
 * @param {{x: number, z: number, radius: number}[]} circles
 * @param {number} playerRadiusMeters
 * @param {number} worldX
 * @param {number} worldZ
 * @returns {{x: number, z: number}}
 */
function pushOutOfCircles(circles, playerRadiusMeters, worldX, worldZ) {
	let x = worldX;
	let z = worldZ;
	for (const circle of circles) {
		const totalRadius = circle.radius + playerRadiusMeters;
		const diffX = x - circle.x;
		const diffZ = z - circle.z;
		const distance = Math.hypot(diffX, diffZ);
		if (distance < totalRadius) {
			if (distance < 1e-6) {
				x = circle.x + totalRadius;
				z = circle.z;
			} else {
				const scale = totalRadius / distance;
				x = circle.x + diffX * scale;
				z = circle.z + diffZ * scale;
			}
		}
	}
	return { x, z };
}

/**
 * Horizontal circle collider for a flat list of point obstacles — the same "Basit" (simple) analytic
 * shape `createSettlementCollider` already uses for castle towers, generalized so it isn't tied to
 * castles specifically. Added for `world/villages.js`'s houses (run 330's "no player collision"
 * technical debt, GOVERNANCE.md §33.2 item 5 "dolu dünya"): a house has a yaw (it faces its hamlet's
 * centre, see `villages.js`), so an axis-aligned box test would be wrong at most rotations, and
 * `physics.js` deliberately has no rotated-box math (see this module's doc comment on why castles use
 * cheap analytic shapes instead of a general physics engine). A circle sized to each house's own
 * footprint diagonal is a little generous at the corners but never lets the player clip through a
 * wall, and stays exactly as cheap as the tower loop this mirrors.
 * @param {{x: number, z: number, radius: number}[]} circles Obstacle centers and their own solid
 *   radius (before adding the player's own half-width) — e.g. `createVillages`'s returned `houses`.
 *   Captured once at construction — use `createDynamicCircleCollider` instead for obstacles that move.
 * @param {number} [playerRadiusMeters=0.4] Same default/meaning as `createSettlementCollider`'s.
 * @returns {{resolveXZ: (worldX: number, worldZ: number) => {x: number, z: number}}}
 */
export function createCircleCollider(circles, playerRadiusMeters = 0.4) {
	return {
		/** Pushes `(worldX, worldZ)` radially out of any circle it's currently inside — a no-op for
		 * every circle the point isn't penetrating, which is true almost every frame. */
		resolveXZ(worldX, worldZ) {
			return pushOutOfCircles(circles, playerRadiusMeters, worldX, worldZ);
		},
	};
}

/**
 * Same shape/math as `createCircleCollider`, but `getCircles()` is called fresh on every
 * `resolveXZ()` instead of once at construction — for obstacles whose position changes every frame
 * (run 337's own reason to add this: `gameplay/cartBrain.js`'s carts move continuously along a road
 * edge, unlike every prior obstacle this project collided against — castle keep/towers and village
 * houses are both fixed the instant the scene is built). Cost is the same O(circle count) per call;
 * the only difference from `createCircleCollider` is *when* each circle's `{x, z, radius}` is read.
 * @param {() => {x: number, z: number, radius: number}[]} getCircles Called once per `resolveXZ()`
 *   call — cheap to call often (e.g. `() => carts.map((cart) => cart.getCollisionCircle())`).
 * @param {number} [playerRadiusMeters=0.4] Same default/meaning as `createCircleCollider`'s.
 * @returns {{resolveXZ: (worldX: number, worldZ: number) => {x: number, z: number}}}
 */
export function createDynamicCircleCollider(getCircles, playerRadiusMeters = 0.4) {
	return {
		resolveXZ(worldX, worldZ) {
			return pushOutOfCircles(getCircles(), playerRadiusMeters, worldX, worldZ);
		},
	};
}

/**
 * Composes any number of `resolveXZ`-shaped colliders into one, applied in the order given — the
 * same chaining `sceneManager.js`'s own `playerCollider` used to hand-roll inline for exactly two
 * colliders (castle + village, run 330/331). Also exposes `registerDynamicCollider` so a collider
 * that doesn't exist yet when the composed object is built (e.g. `gameplay/cartBrain.js`'s carts,
 * spawned later by `gameplay/livingWorldSpawner.js`, well after `sceneManager.js` has already
 * returned `playerCollider` to its caller) can still join the same chain — every caller
 * (`gameplay/player.js` and now any future obstacle-aware controller) always calls the same object's
 * `resolveXZ`, which composes whatever has been registered by the time that call actually happens,
 * without the caller needing to know how many obstacle systems exist or when each was added.
 * @param {{resolveXZ: (worldX: number, worldZ: number) => {x: number, z: number}}[]} [initialColliders]
 * @returns {{
 *   resolveXZ: (worldX: number, worldZ: number) => {x: number, z: number},
 *   registerDynamicCollider: (collider: {resolveXZ: (worldX: number, worldZ: number) => {x: number, z: number}}) => void,
 * }}
 */
export function createComposedCollider(initialColliders = []) {
	const colliders = [...initialColliders];
	return {
		resolveXZ(worldX, worldZ) {
			let x = worldX;
			let z = worldZ;
			for (const collider of colliders) {
				({ x, z } = collider.resolveXZ(x, z));
			}
			return { x, z };
		},
		/** Appends `collider` to the chain — takes effect on every subsequent `resolveXZ()` call,
		 * including calls made through a reference obtained before this was called (the chain lives
		 * inside this object, not copied out to each caller). */
		registerDynamicCollider(collider) {
			colliders.push(collider);
		},
	};
}

/**
 * One frame of a simple ballistic jump arc, expressed as height *above the ground* rather than an
 * absolute world Y — this way a caller (`gameplay/player.js`) can add the result on top of
 * whatever `getGroundHeight` reports at the character's *current* XZ every frame, so normal
 * walking (which already snaps straight to ground height) keeps following slopes/steps exactly as
 * before and this only ever adds an offset on top, never replaces the ground-following behavior.
 * Pure function, no shared state — a caller owns `heightAboveGroundMeters`/`velocityYMps` between
 * calls (see `gameplay/player.js`'s `update`).
 * @param {number} heightAboveGroundMeters Current height above the ground, meters (0 when standing).
 * @param {number} velocityYMps Current vertical velocity, m/s (positive = up).
 * @param {number} delta Seconds since the last frame.
 * @param {number} gravityMps2 `PLAYER_CONFIG.GRAVITY_MPS2` — negative (downward acceleration).
 * @returns {{heightAboveGroundMeters: number, velocityYMps: number, isGrounded: boolean}}
 *   `isGrounded` is true exactly when the arc has landed back at height 0 this frame (velocity
 *   reset to 0 too) — the caller uses this to gate whether a new jump can start.
 */
export function integrateJumpArc(heightAboveGroundMeters, velocityYMps, delta, gravityMps2) {
	const nextVelocityYMps = velocityYMps + gravityMps2 * delta;
	const nextHeightAboveGroundMeters = heightAboveGroundMeters + nextVelocityYMps * delta;
	if (nextHeightAboveGroundMeters <= 0) {
		return { heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true };
	}
	return { heightAboveGroundMeters: nextHeightAboveGroundMeters, velocityYMps: nextVelocityYMps, isGrounded: false };
}

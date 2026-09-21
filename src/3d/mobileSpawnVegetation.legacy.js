/**
 * Mobile spawn-anchored vegetation disc — extracted verbatim out of `game3d.js`'s `initGame3D` (run
 * 371) purely to keep that file under the project's 600-line cap, no behavior change. See
 * `game3d.js`'s own history: `gameLoopHelpers.js` (run 105) and `gameplay/livingWorldSpawner.js`
 * (run 332) already established the same "split for line budget, identical output" precedent for
 * this exact file.
 * @module mobileSpawnVegetation
 */

import { WORLD_DEFAULTS, CHUNK_CONFIG } from './config.js';
import { createVegetation } from './world/vegetation.js';

/**
 * Run 135 / ADR-0159 — mobile spawn-anchored vegetation disc. `createScene`'s own vegetation scatter
 * (`state.vegetation`) is a disc centered on the world origin (0,0), sized to whatever terrain radius
 * that device class loaded (see `sceneManager.js`'s own doc comment) — on desktop that disc is
 * `PHASE1_PREVIEW_RADIUS_CHUNKS`'s own 5500m, comfortably past `spawnWorld`'s own ~4.1km distance
 * from the origin, but on mobile it shrinks to `STREAM_RADIUS_CHUNKS`'s own 1000m radius, which falls
 * roughly 3km short — measured, not assumed (see DECISIONS.md ADR-0159's own "Neden" section for the
 * exact numbers) — so a mobile player never actually walked past a tree during ordinary play, the
 * origin-disc scatter sitting far outside where mobile's own bounded terrain-streaming radius
 * (ADR-0154) ever reaches. This second, purely additive scatter reuses the exact same
 * `createVegetation` placement algorithm (never a second, drifting copy of the water/slope/seat/road
 * exclusion rules) through a coordinate-shifted view of the same real sampler/seats/roads, then
 * repositions the returned group by the same shift so each instance's *rendered* world position is
 * exactly where its height was actually sampled from — a naive post-hoc `group.position` translate of
 * an origin-sampled scatter would instead leave every tree floating or sunk relative to the real,
 * non-flat terrain at the new location, since the heights baked into its instance matrices would
 * still be the *origin* area's heights, not the spawn area's.
 * Returns the created `THREE.Group` (added to `state.scene` by the caller, same as before this
 * extraction) or `null` on desktop, where this disc is skipped entirely (the origin disc already
 * covers the spawn area there).
 * @param {import('./sceneManager.js').SceneState} state
 * @param {{x: number, z: number}} spawnWorld
 * @returns {import('three').Group | null}
 */
export function spawnMobileVegetationDisc(state, spawnWorld) {
	const shiftedSampleHeightMeters = (x, z) => state.groundCollider.getGroundHeight(x + spawnWorld.x, z + spawnWorld.z);
	const shiftedSeats = state.settlementSeats.map((seat) => ({ x: seat.x - spawnWorld.x, z: seat.z - spawnWorld.z }));
	const shiftedRoadEdges = state.roadEdges.map((edge) => ({
		points: edge.points.map((point) => ({ x: point.x - spawnWorld.x, z: point.z - spawnWorld.z })),
	}));
	const spawnVegetationResult = createVegetation({
		sampleHeightMeters: shiftedSampleHeightMeters,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		// XOR-tagged so this disc's own instance layout never collides with the origin disc's draw
		// sequence — same "independent tagged stream" convention `world/vegetation.js`'s own
		// seat-cluster pass already established for itself (ADR-0140).
		seed: WORLD_DEFAULTS.WORLD_SEED ^ 0x5350574e, // "SPWN"-ish tag
		seats: shiftedSeats,
		roadEdges: shiftedRoadEdges,
		radiusMeters: CHUNK_CONFIG.STREAM_RADIUS_CHUNKS * CHUNK_CONFIG.CHUNK_SIZE_METERS,
	});
	spawnVegetationResult.group.position.set(spawnWorld.x, 0, spawnWorld.z);
	state.scene.add(spawnVegetationResult.group);
	console.info(
		`[game3d] Mobile spawn-anchored vegetation: ${spawnVegetationResult.placedCount}/` +
			`${spawnVegetationResult.targetCount} tree(s) near spawn (${spawnWorld.x.toFixed(0)}, ` +
			`${spawnWorld.z.toFixed(0)}).`,
	);
	return spawnVegetationResult.group;
}

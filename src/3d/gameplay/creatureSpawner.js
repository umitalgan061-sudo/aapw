/**
 * `gameplay/creatureSpawner.js` — deterministic world placement for `gameplay/creatureBrain.js`'s
 * procedural creatures. Deliberately separate from `creatureBrain.js` itself: this module only decides
 * *where* a species goes (reusing `world/vegetation.js`'s own placement exclusion rules, never a second
 * drifting copy of them), `creatureBrain.js` only decides *how* a spawned being behaves once placed —
 * the same "world system decides where, gameplay system decides how" split this project already keeps
 * between `world/vegetation.js` and `gameplay/animals.js`'s wolf.
 *
 * **Population size — a real performance budget, not "as many as fit".** Unlike `world/vegetation.js`'s
 * instanced trees (one draw call *per species*, regardless of tree count), every creature here is its
 * own unique `THREE.SkinnedMesh` with its own skeleton — one draw call *per creature*, plus a real
 * per-frame bone-rotation cost while it moves. `DESKTOP_SPECIES_COUNTS` below sums to 80 creatures
 * (≈1-2k triangles each per `creatureRig.js`'s own accounting, so ≈80-150k triangles total) — trivial
 * against this project's existing desktop budget (`GOVERNANCE.md` §7: DrawCalls<2500, Triangles<5M) but
 * a deliberate, explicit ceiling rather than an unbounded scatter, chosen so "populate the world
 * generously" doesn't quietly become a frame-budget regression. `MOBILE_SPECIES_COUNTS` sums to 12,
 * anchored to the player's own spawn point (mirrors `game3d.js`'s existing `mobileSpawnVegetation`
 * pattern) rather than the full-world desktop disc, consistent with mobile's own already-much-smaller
 * `STREAM_RADIUS_CHUNKS` world-coverage footprint (`GOVERNANCE.md`'s World Coverage line: 96.2% desktop
 * vs 4.5% mobile) and its own DrawCalls<500/Triangles<500K ceiling. `kuzgun`/`kartal`/`tavuk` (birds,
 * `gameplay/creatureBrain.js`'s new flight species) get modest counts of their own — small bodies, so
 * cheap even at a slightly higher count than the four-legged species above.
 *
 * Placement reuses `world/vegetation.js`'s exported `isPlaceablePosition` (water/slope/seat/road
 * exclusion — unchanged, not reimplemented) over a uniform-disc rejection sample, same `r=R*sqrt(u)`
 * formula and same bounded-attempt-count discipline `createVegetation`'s own base pass uses. On top of
 * that canonical physical gate, this module owns only the fauna-specific habitat envelope: domestic
 * animals stay within settlement hinterlands, large wild animals do not spawn beside keeps, and a few
 * broad lowland/highland preferences use the same canonical terrain height sampler already supplied to
 * placement. These are deterministic rejection filters, not a second terrain/biome system.
 *
 * Determinism: one `mulberry32(seed ^ tag)` stream per call, drawn in species-declaration order — same
 * seed always reproduces the same spawn list (GOVERNANCE.md §8.9), same "XOR-tagged independent stream"
 * convention `world/vegetation.js`/`world/rivers.js` already established.
 * @module gameplay/creatureSpawner
 */

import { isPlaceablePosition } from '../world/vegetation.js';

/** Rejection-sampling attempts per creature before it's dropped — same bounded-search guarantee
 * `world/vegetation.js`'s `MAX_ATTEMPTS_PER_TREE` gives itself, so a heavily-excluded disc (e.g. mostly
 * water) terminates instead of looping forever. */
const MAX_ATTEMPTS_PER_CREATURE = 10;

/**
 * Fauna-only habitat envelopes layered on top of the canonical water/slope/seat/road placement gate.
 * Distances are measured to the nearest canonical settlement seat. Elevation is meters above the same
 * sea level used by terrain placement. Missing keys intentionally mean "canonical physical gate only".
 * This keeps the rules small and auditable instead of pretending to be a second biome framework.
 */
export const CREATURE_HABITAT_RULES = Object.freeze({
	kedi: Object.freeze({ maxSeatDistanceMeters: 420, maxElevationAboveSeaMeters: 650 }),
	kopek: Object.freeze({ maxSeatDistanceMeters: 520, maxElevationAboveSeaMeters: 800 }),
	at: Object.freeze({ maxSeatDistanceMeters: 850, maxElevationAboveSeaMeters: 1050 }),
	koyun: Object.freeze({ maxSeatDistanceMeters: 900, maxElevationAboveSeaMeters: 1300 }),
	inek: Object.freeze({ maxSeatDistanceMeters: 700, maxElevationAboveSeaMeters: 900 }),
	keci: Object.freeze({ maxSeatDistanceMeters: 950, maxElevationAboveSeaMeters: 1800 }),
	domuz: Object.freeze({ minSeatDistanceMeters: 120, maxElevationAboveSeaMeters: 950 }),
	tavuk: Object.freeze({ maxSeatDistanceMeters: 360, maxElevationAboveSeaMeters: 600 }),
	geyik: Object.freeze({ minSeatDistanceMeters: 180, maxElevationAboveSeaMeters: 1450 }),
	ayi: Object.freeze({ minSeatDistanceMeters: 320, minElevationAboveSeaMeters: 80 }),
	aslan: Object.freeze({ minSeatDistanceMeters: 420, maxElevationAboveSeaMeters: 700 }),
	zurafa: Object.freeze({ minSeatDistanceMeters: 500, maxElevationAboveSeaMeters: 520 }),
	fil: Object.freeze({ minSeatDistanceMeters: 450, maxElevationAboveSeaMeters: 520 }),
	tavsan: Object.freeze({ minSeatDistanceMeters: 80, maxElevationAboveSeaMeters: 1200 }),
});

function nearestSeatDistanceMeters(x, z, seats) {
	let nearest = Infinity;
	for (const seat of seats ?? []) nearest = Math.min(nearest, Math.hypot(x - seat.x, z - seat.z));
	return nearest;
}

/**
 * Evaluates only fauna-specific habitat constraints. Callers must still pass the canonical
 * `isPlaceablePosition()` water/slope/seat/road gate separately.
 */
export function isCreatureHabitatCompatible(speciesId, x, z, {
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	habitatRules = CREATURE_HABITAT_RULES,
} = {}) {
	const rule = habitatRules?.[speciesId];
	if (!rule) return true;
	const seatDistance = nearestSeatDistanceMeters(x, z, seats);
	if (rule.minSeatDistanceMeters != null && seatDistance < rule.minSeatDistanceMeters) return false;
	if (rule.maxSeatDistanceMeters != null && seatDistance > rule.maxSeatDistanceMeters) return false;
	if (typeof sampleHeightMeters !== 'function') return false;
	const elevationAboveSea = sampleHeightMeters(x, z) - seaLevelMeters;
	if (!Number.isFinite(elevationAboveSea)) return false;
	if (rule.minElevationAboveSeaMeters != null && elevationAboveSea < rule.minElevationAboveSeaMeters) return false;
	if (rule.maxElevationAboveSeaMeters != null && elevationAboveSea > rule.maxElevationAboveSeaMeters) return false;
	return true;
}

/** Desktop population — see this module's own doc comment for the draw-call/triangle budget math this
 * total (80) was chosen against. Herd-tagged species (per `creatureSpeciesConfig.js`) get a slightly
 * higher count than solitary ones; this run's own judgment, not a calibrated density. */
export const DESKTOP_SPECIES_COUNTS = Object.freeze({
	kedi: 4, kopek: 4, at: 6, fil: 2, geyik: 8, koyun: 10, inek: 5,
	keci: 6, domuz: 5, tavsan: 8, ayi: 3, aslan: 3, zurafa: 2,
	kuzgun: 6, kartal: 2, tavuk: 6,
});

/** Mobile population — small and spawn-anchored, see this module's own doc comment. Only the two
 * lightest/most-recognizable birds are included (a raven and a chicken); `kartal` (eagle) is skipped
 * on mobile to keep the already-small budget from growing further for a species that reads similarly
 * to `kuzgun` at mobile's short view distance. */
export const MOBILE_SPECIES_COUNTS = Object.freeze({
	kedi: 1, kopek: 1, at: 1, geyik: 1, koyun: 2, inek: 1, keci: 1, domuz: 1, tavsan: 1,
	kuzgun: 1, tavuk: 1,
});

/**
 * Deterministically scatters `speciesCounts` across a disc centered on `(centerX, centerZ)`, reusing
 * `world/vegetation.js`'s own placement-exclusion rule. A species/count entry that can't place every
 * requested individual within `MAX_ATTEMPTS_PER_CREATURE` attempts each drops the unplaced remainder
 * with a single summarizing `console.warn` (no silent cap — GOVERNANCE.md's "no silent truncation"
 * expectation, same as this module's own doc comment promises).
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @param {number} options.seaLevelMeters
 * @param {{x: number, z: number}[]} options.seats
 * @param {{points: {x: number, z: number}[]}[]} options.roadEdges
 * @param {number} options.seed
 * @param {number} options.seedTag XOR tag distinguishing this call's stream from any other (desktop vs
 *   mobile calls use different tags so neither perturbs the other's draw sequence).
 * @param {(seed: number) => () => number} options.mulberry32
 * @param {number} options.centerX
 * @param {number} options.centerZ
 * @param {number} options.radiusMeters
 * @param {Record<string, number>} options.speciesCounts
 * @returns {{id: string, speciesId: string, x: number, z: number, rotationYRadians: number}[]}
 */
export function scatterCreatures({
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	roadEdges,
	seed,
	seedTag,
	mulberry32,
	centerX,
	centerZ,
	radiusMeters,
	speciesCounts,
}) {
	const rng = mulberry32(seed ^ seedTag);
	const spawns = [];
	let spawnIndex = 0;

	for (const [speciesId, count] of Object.entries(speciesCounts)) {
		let placedForSpecies = 0;
		for (let i = 0; i < count; i++) {
			let placed = false;
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CREATURE; attempt++) {
				const angle = rng() * Math.PI * 2;
				const radius = radiusMeters * Math.sqrt(rng());
				const x = centerX + Math.cos(angle) * radius;
				const z = centerZ + Math.sin(angle) * radius;
				const rotationYRadians = rng() * Math.PI * 2;
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
				if (!isCreatureHabitatCompatible(speciesId, x, z, { sampleHeightMeters, seaLevelMeters, seats })) continue;
				spawns.push({ id: `creature-${speciesId}-${spawnIndex++}`, speciesId, x, z, rotationYRadians });
				placed = true;
				placedForSpecies++;
				break;
			}
			// A dropped individual (placed === false) still consumed its rng draws above (angle/radius/
			// rotation per attempt), so it never desyncs the stream the *next* species reads from.
		}
		if (placedForSpecies < count) {
			console.warn(
				`[gameplay/creatureSpawner] "${speciesId}": placed ${placedForSpecies}/${count} — remainder dropped ` +
					`(no valid physical+habitat position found within ${MAX_ATTEMPTS_PER_CREATURE} attempts each; not a silent cap).`,
			);
		}
	}
	return spawns;
}

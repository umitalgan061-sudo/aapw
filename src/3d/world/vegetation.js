/**
 * Procedural instanced trees — closes a real, long-standing gap: `GOVERNANCE.md` §3's target
 * architecture has named "Vegetation" as a `world/` system since this project's very first
 * architecture doc, and `config.js`'s `WORLD_DEFAULTS.WORLD_SEED` comment ("terrain, later
 * vegetation/rivers/etc.") has said so since before rivers even existed. Run 111/ADR-0138 shipped
 * the first pass (scatter-only, one species). Run 112/ADR-0139 added the "species variety" follow-up
 * ADR-0138 itself named as the natural next step: two low-poly species (a narrow conical "pine" —
 * ADR-0138's original tree, unchanged — and a rounder "round-crown" tree with a sphere foliage cap)
 * mixed by a deterministic per-tree weighted roll, so the scatter no longer reads as visually
 * uniform. Run 113/ADR-0140 adds the other follow-up ADR-0139 itself named: seat-local clustering —
 * a denser ring of trees just outside each kingdom seat's flattened footprint (reads as a managed
 * treeline/windbreak/hunting ground near a castle, not open wild forest), an independent *second*
 * placement pass layered on top of the unchanged base disc scatter (own tagged rng stream, own
 * annulus sampling, same shared `isPlaceablePosition`/`pickSpeciesIndex` — see `createVegetation`'s
 * own doc comment for why only seats near the loaded terrain disc qualify). Still no per-species
 * rig/animation/UV-mapped texture needed — same "primitives + a shared material, no external file"
 * technique `world/settlements.js`'s procedural castle and `world/materials.js`'s procedural
 * stone/roof already established.
 *
 * Two low-poly primitives per tree (a trunk + a foliage cap) rendered as instanced meshes — each
 * species gets its own trunk/foliage `THREE.InstancedMesh` pair (one draw call per part per species,
 * regardless of tree count within that species), the same "one draw call per part, not per object"
 * technique `world/settlements.js`'s keep/tower/roof `InstancedMesh`es already use for the procedural
 * castle silhouette. With `SPECIES.length` species that's `SPECIES.length * 2` total draw calls for
 * the whole forest (4 today), still trivial against the desktop/mobile draw-call budgets.
 *
 * Placement is deterministic rejection-sampling over a disc centered on the world origin (uniform-
 * disc sampling, not naive polar coordinates, which would bias density toward the center — same
 * `r = R*sqrt(u)` formula every standard "random point in a disc" derivation uses): reads the same
 * shared `sampleHeightMeters` every other world system reads through, skips points below sea level
 * (no trees in the water), on ground steeper than `MAX_GROUND_SLOPE_DEGREES` (no trees floating off
 * a near-vertical cliff face), inside `SEAT_EXCLUSION_RADIUS_METERS` of a kingdom seat (no trees
 * poking up through a castle's flattened footprint pad), or within `ROAD_EXCLUSION_RADIUS_METERS`
 * of any road-network edge segment (no trees blocking the road itself). This placement logic is
 * entirely species-agnostic (species is chosen only *after* a position is accepted) — this module
 * never modifies terrain height/noise/world-scale, it only *reads* the existing, unmodified height
 * field to decide where an additional, purely additive render object goes — so GOVERNANCE.md §8.4's
 * "Arazi Değişiklik Güvenlik Kontrolü" (which gates changes to the height sampler itself) doesn't
 * apply the way it did for ADR-0075's macro relief; the *placement* exclusion logic below is this
 * module's own equivalent safety net instead, verified by this module's own smoke checks.
 * @module world/vegetation
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

/**
 * Two low-poly species, each a self-contained silhouette recipe. `weight` values are relative and
 * need not sum to 1 — `pickSpeciesIndex` normalizes against their running total, so adding a third
 * species later is a pure addition (one more array entry), never a rebalance of the existing two.
 * `pine` is exactly ADR-0138's original v1 tree, unchanged, so every run-111 visual/placement
 * assumption about "the tree" still holds for this species specifically. `round` is new: a shorter
 * trunk and a sphere foliage cap (a simple, low-poly "deciduous-ish" read, not a specific real
 * species) in a distinguishably lighter green, so the two species are easy to tell apart even at
 * typical camera distance.
 */
const SPECIES = [
	{
		id: 'pine',
		weight: 0.6,
		trunk: { radiusTop: 0.22, radiusBottom: 0.38, height: 3.4, radialSegments: 6, color: 0x5b4028 },
		foliage: { kind: 'cone', radius: 2.15, height: 5.6, radialSegments: 7, overlapMeters: 0.3, color: 0x2f5c26 },
	},
	{
		id: 'round',
		weight: 0.4,
		trunk: { radiusTop: 0.2, radiusBottom: 0.34, height: 2.8, radialSegments: 6, color: 0x5b4028 },
		foliage: { kind: 'sphere', radius: 2.4, widthSegments: 7, heightSegments: 6, overlapMeters: 0.7, color: 0x4a7a2e },
	},
];

/** Trees per km² of the scatter disc — this run's own engineering judgment (sparse scatter, not a
 * dense forest — a first pass establishing the system), not calibrated against a real playtest. See
 * `QUESTIONS_FOR_OWNER.md`'s density entry (run 111) and species-mix entry (run 112) — the same
 * "feel constant nobody has played against yet" pattern ADR-0089/ADR-0096/ADR-0111/ADR-0116 already
 * logged there for their own tuning values. */
const TARGET_DENSITY_PER_KM2 = 30;
/** Rejection-sampling attempts allowed per tree still needed, so a heavily-excluded disc (e.g. one
 * that happens to be mostly water) terminates in bounded time instead of looping forever — same
 * "finite, bounded search" guarantee `world/roadPathfinder.js`'s padded-corridor A* already commits
 * to for its own search space. */
const MAX_ATTEMPTS_PER_TREE = 8;
/** Hand-copied from `world/settlements.js`'s `SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS` (75) + a 15m
 * margin — same "hand-copied constant with a comment citing its source" convention that file's own
 * `KINGDOM_SEATS` (copied from `script.js`'s `INIT_KINGDOMS`) already established, not a fresh
 * cross-file import (this module only takes `seats`' plain `{x, z}` positions as data, per the
 * `world/README.md` blast-radius rule — every generator here stays independently testable). Keeps
 * trees off a castle's flattened footprint pad, whose own outer radius is 75m. */
const SEAT_EXCLUSION_RADIUS_METERS = 90;
/** Hand-copied from `world/roads.js`'s `ROAD_WIDTH_METERS` (8, so half-width 4) + a 6m margin, same
 * reasoning as `SEAT_EXCLUSION_RADIUS_METERS` above — keeps trees from visibly blocking the road
 * ribbon or crowding right up against its edge. */
const ROAD_EXCLUSION_RADIUS_METERS = 10;
/** Minimum height above `seaLevelMeters` a tree may be placed at — keeps trees off the exact
 * shoreline edge, not just fully submerged points. */
const SHORE_MARGIN_METERS = 1.5;
/** Ground steeper than this (either sampled axis) is rejected — generous on purpose (real forests
 * do grow on real slopes); this is only meant to reject near-cliff-face placements, not ordinary
 * hillside ground. Distinct from, and deliberately much looser than, `QUESTIONS_FOR_OWNER.md` run
 * 55's 35° foot-*walkable* limit — a tree doesn't need to be walkable, just not visually floating
 * off a vertical face. */
const MAX_GROUND_SLOPE_DEGREES = 45;
/** World-space offset, in meters, used to sample two extra height points (one per axis) for the
 * simple two-tap slope estimate above — small enough to catch a genuinely steep local face, large
 * enough to stay well clear of this project's per-vertex noise texel scale. */
const SLOPE_SAMPLE_OFFSET_METERS = 3;
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.35;

/** Margin, in meters, past `SEAT_EXCLUSION_RADIUS_METERS` before a seat's clustering ring begins —
 * keeps a visible "walls, then bare flattened ground, then trees" transition instead of the ring's
 * inner edge immediately hugging the exclusion boundary. */
const CLUSTER_RING_INNER_MARGIN_METERS = 10;
/** Outer radius, in meters, of a seat's clustering ring, measured from the seat's own center — well
 * inside a single `CHUNK_CONFIG.CHUNK_SIZE_METERS` (500) chunk, so a ring around any qualifying seat
 * (see `createVegetation`'s doc comment for the qualification rule) never reaches past terrain that
 * seat's own neighborhood already has grounded. */
const CLUSTER_RING_OUTER_RADIUS_METERS = 260;
/** Trees per km² *within a seat's own ring* — deliberately denser than `TARGET_DENSITY_PER_KM2`
 * (reads as a managed treeline near a castle, not open wild forest); this run's own engineering
 * judgment, not calibrated against a real playtest — same "feel constant nobody has played against
 * yet" pattern as `TARGET_DENSITY_PER_KM2` and `SPECIES`' `weight` values above (see
 * `QUESTIONS_FOR_OWNER.md`'s newest entry). */
const CLUSTER_DENSITY_PER_KM2 = 220;

/**
 * Shortest 2D (X/Z-plane) distance from point `(px, pz)` to the line segment `(ax, az)-(bx, bz)`.
 * Pure function, exported for this module's own smoke checks (no THREE.js/scene dependency, so it's
 * trivially unit-testable in isolation).
 * @returns {number} Distance in the same units as the inputs (meters here).
 */
export function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
	const abx = bx - ax;
	const abz = bz - az;
	const lengthSquared = abx * abx + abz * abz;
	if (lengthSquared === 0) return Math.hypot(px - ax, pz - az);
	let t = ((px - ax) * abx + (pz - az) * abz) / lengthSquared;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

/**
 * Whether `(x, z)` is a valid tree-placement point: above the shore margin, not too steep, not
 * inside any kingdom seat's exclusion radius, and not within any road-network edge's exclusion
 * corridor. Pure/stateless (given the sampler and data arrays), and species-agnostic — species is
 * decided only after a position passes this check (see `pickSpeciesIndex`). Exported so this
 * module's own smoke checks can assert known good/bad points directly, without spinning up a full
 * `createVegetation` scatter pass.
 * @param {number} x World-space X, meters.
 * @param {number} z World-space Z, meters.
 * @param {object} params
 * @param {(x: number, z: number) => number} params.sampleHeightMeters
 * @param {number} params.seaLevelMeters
 * @param {{x: number, z: number}[]} params.seats
 * @param {{points: {x: number, z: number}[]}[]} params.roadEdges
 * @returns {boolean}
 */
export function isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges }) {
	for (const seat of seats) {
		if (Math.hypot(x - seat.x, z - seat.z) < SEAT_EXCLUSION_RADIUS_METERS) return false;
	}
	for (const edge of roadEdges) {
		const points = edge.points;
		for (let i = 1; i < points.length; i++) {
			const distance = distancePointToSegment2D(x, z, points[i - 1].x, points[i - 1].z, points[i].x, points[i].z);
			if (distance < ROAD_EXCLUSION_RADIUS_METERS) return false;
		}
	}
	const groundY = sampleHeightMeters(x, z);
	if (groundY <= seaLevelMeters + SHORE_MARGIN_METERS) return false;

	const dxHeight = sampleHeightMeters(x + SLOPE_SAMPLE_OFFSET_METERS, z) - groundY;
	const dzHeight = sampleHeightMeters(x, z + SLOPE_SAMPLE_OFFSET_METERS) - groundY;
	const gradeXDegrees = (Math.atan2(Math.abs(dxHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
	const gradeZDegrees = (Math.atan2(Math.abs(dzHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
	if (Math.max(gradeXDegrees, gradeZDegrees) > MAX_GROUND_SLOPE_DEGREES) return false;

	return true;
}

/**
 * Deterministically picks a `SPECIES` index from one `[0, 1)` random draw, weighted by each entry's
 * `weight` (normalized against the running total so weights need not sum to 1). Pure function,
 * exported for this module's own smoke checks. Falls through to the last species on any floating-
 * point edge case at `roll === 1` (unreachable from `rng()`'s own `[0, 1)` contract, but kept as a
 * defensive bound rather than an off-by-one risk).
 * @param {number} roll A `[0, 1)` random draw.
 * @returns {number} Index into `SPECIES`.
 */
export function pickSpeciesIndex(roll) {
	const totalWeight = SPECIES.reduce((sum, species) => sum + species.weight, 0);
	let cumulative = 0;
	for (let i = 0; i < SPECIES.length; i++) {
		cumulative += SPECIES[i].weight / totalWeight;
		if (roll < cumulative) return i;
	}
	return SPECIES.length - 1;
}

/**
 * Uniform random point inside the annulus (ring) `[innerRadius, outerRadius)` centered on
 * `(centerX, centerZ)` — `r = sqrt(u * (R_outer² - R_inner²) + R_inner²)`, the direct generalization
 * of the base disc scatter's own `r = R*sqrt(u)` uniform-disc formula (that formula is this one's own
 * `innerRadius = 0` case): uniform *area* density across the ring, not biased toward either edge.
 * Pure function, exported for this module's own smoke checks.
 * @param {() => number} rng A `[0, 1)` seeded random source.
 * @param {number} centerX
 * @param {number} centerZ
 * @param {number} innerRadius
 * @param {number} outerRadius
 * @returns {{x: number, z: number}}
 */
export function sampleAnnulusPoint(rng, centerX, centerZ, innerRadius, outerRadius) {
	const angle = rng() * Math.PI * 2;
	const radius = Math.sqrt(rng() * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);
	return { x: centerX + Math.cos(angle) * radius, z: centerZ + Math.sin(angle) * radius };
}

/**
 * Builds one species' trunk + foliage geometry/material pair. Both primitives are Y-centered by
 * THREE.js default — each is translated so the whole silhouette's local origin sits at the tree's
 * actual base (y=0), matching every other placed-by-ground-height object in this project
 * (settlements/NPCs/animals all place at a ground-Y that means "feet", not "center"). The foliage
 * cap's translate additionally overlaps the trunk top by `overlapMeters` so no visible seam shows
 * between trunk and foliage at any scale/angle, regardless of which `kind` of cap this species uses.
 * @param {(typeof SPECIES)[number]} species
 * @returns {{trunkGeometry: THREE.BufferGeometry, foliageGeometry: THREE.BufferGeometry, trunkMaterial: THREE.Material, foliageMaterial: THREE.Material}}
 */
function buildSpeciesAssets(species) {
	const { trunk, foliage } = species;
	const trunkGeometry = new THREE.CylinderGeometry(trunk.radiusTop, trunk.radiusBottom, trunk.height, trunk.radialSegments);
	trunkGeometry.translate(0, trunk.height / 2, 0);

	let foliageGeometry;
	if (foliage.kind === 'cone') {
		foliageGeometry = new THREE.ConeGeometry(foliage.radius, foliage.height, foliage.radialSegments);
		foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
	} else if (foliage.kind === 'sphere') {
		foliageGeometry = new THREE.SphereGeometry(foliage.radius, foliage.widthSegments, foliage.heightSegments);
		foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
	} else {
		throw new Error(`world/vegetation.js: unknown foliage kind "${foliage.kind}" for species "${species.id}"`);
	}

	const trunkMaterial = new THREE.MeshStandardMaterial({ color: trunk.color, roughness: 1, metalness: 0 });
	const foliageMaterial = new THREE.MeshStandardMaterial({ color: foliage.color, roughness: 0.9, metalness: 0 });
	return { trunkGeometry, foliageGeometry, trunkMaterial, foliageMaterial };
}

/**
 * Places one tree's transform into `entry`'s trunk+foliage instance buffers at `entry.placedCount`,
 * then increments it — the exact per-tree body both the base scatter pass and the seat-cluster pass
 * below share, factored out so the two passes can never silently drift apart on how a tree is
 * actually written (ground-snap/scale/yaw all identical regardless of which pass placed it).
 * @param {{trunkMesh: THREE.InstancedMesh, foliageMesh: THREE.InstancedMesh, placedCount: number}} entry
 * @param {number} x
 * @param {number} z
 * @param {(x: number, z: number) => number} sampleHeightMeters
 * @param {() => number} rng
 * @param {THREE.Vector3} up
 * @param {THREE.Matrix4} matrix
 * @param {THREE.Vector3} position
 * @param {THREE.Quaternion} quaternion
 * @param {THREE.Vector3} scaleVector
 */
function placeTreeInstance(entry, x, z, sampleHeightMeters, rng, up, matrix, position, quaternion, scaleVector) {
	const groundY = sampleHeightMeters(x, z);
	const scale = SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN);
	const yaw = rng() * Math.PI * 2;
	position.set(x, groundY, z);
	quaternion.setFromAxisAngle(up, yaw);
	scaleVector.set(scale, scale, scale);
	matrix.compose(position, quaternion, scaleVector);
	entry.trunkMesh.setMatrixAt(entry.placedCount, matrix);
	entry.foliageMesh.setMatrixAt(entry.placedCount, matrix);
	entry.placedCount++;
}

/**
 * Scatters deterministic procedural trees, mixed across `SPECIES`, in two layered passes:
 *
 * 1. **Base scatter** — over a disc of radius `radiusMeters` centered on the world origin, matching
 *    whatever radius the caller actually loaded terrain for (`sceneManager.js` passes its own
 *    boot-preview radius, so trees never render over a chunk that was never generated, on either
 *    desktop or mobile-budget devices), so tree count naturally scales down with the smaller mobile
 *    preview area instead of needing a second, device-specific density knob. Unchanged since
 *    ADR-0138/ADR-0139 — same rng draw order, same output for the same inputs.
 * 2. **Seat-local clustering** (run 113/ADR-0140) — an additive second pass placing extra trees in an
 *    annulus ring (`CLUSTER_RING_INNER_MARGIN_METERS` past `SEAT_EXCLUSION_RADIUS_METERS`, out to
 *    `CLUSTER_RING_OUTER_RADIUS_METERS`) around each seat in `seats`, at `CLUSTER_DENSITY_PER_KM2` —
 *    denser than the base scatter, reading as a managed treeline near a castle. Draws from its own
 *    XOR-tagged rng stream (never perturbs the base pass's own draw sequence, so passing `seats: []`
 *    reproduces ADR-0138/ADR-0139's scatter bit-for-bit) and reuses the same `isPlaceablePosition`
 *    exclusion check (so a cluster point too close to a *different* seat, or on water/a steep
 *    slope/a road, is rejected exactly like a base-pass point would be). **Only seats whose entire
 *    ring already fits inside the base scatter disc get one** — `Math.hypot(seat.x, seat.z) +
 *    CLUSTER_RING_OUTER_RADIUS_METERS <= radiusMeters` — the same "no trees over a chunk that was
 *    never generated" guarantee the base pass already gives itself, generalized to the ring's own
 *    outer edge. In this project's actual geography this means most of the 14 kingdom seats qualify
 *    on desktop (`PHASE1_PREVIEW_RADIUS_CHUNKS` 11 * 500m = 5500m disc) and none qualify on mobile
 *    (`STREAM_RADIUS_CHUNKS` 2 * 500m = 1000m disc, smaller than every seat's own distance from
 *    origin) — an honest, expected consequence of the existing mobile-budget scoping, not a bug; see
 *    DECISIONS.md's newest ADR.
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters Same shared sampler every
 *   other world system reads through (`physics.js`'s ground collider).
 * @param {number} options.seaLevelMeters `WORLD_DEFAULTS.WATER_LEVEL_METERS`.
 * @param {number} options.seed World seed — same seed always reproduces the same scatter (both
 *   position/rejection AND species mix — species is drawn from the same seeded stream).
 * @param {{x: number, z: number}[]} options.seats Kingdom-seat positions (exclusion + cluster centers).
 * @param {{points: {x: number, z: number}[]}[]} options.roadEdges Road-network edges (exclusion).
 * @param {number} options.radiusMeters Scatter disc radius, meters.
 * @param {number} [options.densityPerKm2] Overridable for testing; defaults to `TARGET_DENSITY_PER_KM2`.
 * @returns {{group: THREE.Group, targetCount: number, placedCount: number, clusterSeatCount: number}}
 *   `targetCount`/`placedCount` are combined totals across both passes. `group.children` is
 *   `SPECIES.length * 2` meshes long (trunk+foliage per species, in `SPECIES` order), even if a
 *   species happens to place zero trees for a given seed/area (that species' pair simply renders
 *   nothing — `.count` stays 0 — rather than being omitted, so `group.children.length` is always
 *   predictable from `SPECIES.length` alone). `clusterSeatCount` is how many seats actually qualified
 *   for a ring (0 on mobile-sized discs — see above).
 */
export function createVegetation({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, radiusMeters, densityPerKm2 = TARGET_DENSITY_PER_KM2 }) {
	const group = new THREE.Group();
	const areaKm2 = (Math.PI * radiusMeters * radiusMeters) / 1_000_000;
	const baseTargetCount = Math.max(0, Math.round(areaKm2 * densityPerKm2));

	const clusterInnerRadius = SEAT_EXCLUSION_RADIUS_METERS + CLUSTER_RING_INNER_MARGIN_METERS;
	const clusterSeats = seats.filter((seat) => Math.hypot(seat.x, seat.z) + CLUSTER_RING_OUTER_RADIUS_METERS <= radiusMeters);
	const ringAreaKm2 = (Math.PI * (CLUSTER_RING_OUTER_RADIUS_METERS ** 2 - clusterInnerRadius ** 2)) / 1_000_000;
	const clusterTargetPerSeat = Math.max(0, Math.round(ringAreaKm2 * CLUSTER_DENSITY_PER_KM2));
	const clusterTargetTotal = clusterSeats.length * clusterTargetPerSeat;

	const targetCount = baseTargetCount + clusterTargetTotal;
	if (targetCount === 0) return { group, targetCount: 0, placedCount: 0, clusterSeatCount: 0 };

	// XOR-tagged seed, independent random stream from terrain's own noise / rivers' own tagged
	// stream — same convention `world/rivers.js` already established for `mulberry32(seed ^ tag)`.
	const rng = mulberry32(seed ^ 0x56454745); // "VEGE"-ish tag
	// Its own independent tag/stream so the cluster pass's rng draws never perturb the base pass's
	// own draw order above — this is what keeps `seats: []` reproducing ADR-0138/ADR-0139's scatter
	// bit-for-bit (see this function's own doc comment).
	const clusterRng = mulberry32(seed ^ 0x434c5354); // "CLST" tag
	const up = new THREE.Vector3(0, 1, 0);

	// Instance buffers are allocated at the combined disc-plus-ring `targetCount` per species (the
	// true worst case: every tree from both passes happens to roll the same species) — trivial extra
	// memory for a few thousand 4x4 matrices, and avoids a two-pass "count per species first" scan.
	// `.count` is trimmed down to each species' real placed count below, same "unused trailing slots
	// never rendered" reasoning `world/settlements.js`'s own `proceduralSeatCount`-sized
	// `InstancedMesh` comment documents.
	const perSpecies = SPECIES.map((species) => {
		const { trunkGeometry, foliageGeometry, trunkMaterial, foliageMaterial } = buildSpeciesAssets(species);
		const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, targetCount);
		const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, targetCount);
		// Placed once at scene-build time, never moved afterward — same "static, no per-frame update"
		// category `world/rivers.js`'s river/waterfall meshes are already in, unlike `water.js`'s ripple.
		trunkMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		foliageMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		return { trunkMesh, foliageMesh, placedCount: 0 };
	});

	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scaleVector = new THREE.Vector3();

	let placedCount = 0;
	for (let treeIndex = 0; treeIndex < baseTargetCount; treeIndex++) {
		for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE; attempt++) {
			// Uniform-disc sampling: r = R*sqrt(u), not r = R*u (which would over-concentrate points
			// near the center) — see this module's own header comment.
			const angle = rng() * Math.PI * 2;
			const radius = radiusMeters * Math.sqrt(rng());
			const x = Math.cos(angle) * radius;
			const z = Math.sin(angle) * radius;
			if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;

			// Species is drawn only for an accepted position, from the same seeded stream, so v1's
			// (ADR-0138) position/count behavior is unaffected in shape — only which species-specific
			// mesh a given placed tree's matrix lands in changes from what was a single-species module.
			const speciesIndex = pickSpeciesIndex(rng());
			const entry = perSpecies[speciesIndex];
			placeTreeInstance(entry, x, z, sampleHeightMeters, rng, up, matrix, position, quaternion, scaleVector);
			placedCount++;
			break;
		}
	}

	// Seat-local clustering ring (run 113/ADR-0140) — see this function's own doc comment for the
	// qualification rule and the reasoning behind it.
	for (const seat of clusterSeats) {
		for (let treeIndex = 0; treeIndex < clusterTargetPerSeat; treeIndex++) {
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE; attempt++) {
				const { x, z } = sampleAnnulusPoint(clusterRng, seat.x, seat.z, clusterInnerRadius, CLUSTER_RING_OUTER_RADIUS_METERS);
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;

				const speciesIndex = pickSpeciesIndex(clusterRng());
				const entry = perSpecies[speciesIndex];
				placeTreeInstance(entry, x, z, sampleHeightMeters, clusterRng, up, matrix, position, quaternion, scaleVector);
				placedCount++;
				break;
			}
		}
	}

	for (const entry of perSpecies) {
		entry.trunkMesh.count = entry.placedCount;
		entry.foliageMesh.count = entry.placedCount;
		entry.trunkMesh.instanceMatrix.needsUpdate = true;
		entry.foliageMesh.instanceMatrix.needsUpdate = true;
		group.add(entry.trunkMesh, entry.foliageMesh);
	}

	return { group, targetCount, placedCount, clusterSeatCount: clusterSeats.length };
}

/**
 * Disposes a `createVegetation` group's geometry + materials — same `disposeSettlements`/
 * `disposeRoadNetwork`/`disposeWater` single-argument convention every other `world/` disposer here
 * already follows. Iterates all `group.children` regardless of species count, so this needs no
 * change if `SPECIES` grows a third entry later.
 * @param {THREE.Group} group
 */
export function disposeVegetation(group) {
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		mesh.material.dispose();
	}
}


// Run 136 / ADR-0160 — mobile-only vegetation geometry LOD. The deterministic placement, species
// rolls, instance transforms, materials, and desktop geometry above remain untouched. On coarse-
// pointer devices only, this wrapper swaps each already-built InstancedMesh geometry for a lower-
// segment equivalent while preserving the exact instance matrices/counts. Old geometries are
// disposed immediately so the lower-detail path does not retain a full-resolution GPU duplicate.
const MOBILE_VEGETATION_LOD_RUN136 = Object.freeze({
	trunkRadialSegments: 4,
	coneRadialSegments: 5,
	sphereWidthSegments: 5,
	sphereHeightSegments: 4,
});

function geometryTriangleCountRun136(geometry) {
	if (geometry.index) return geometry.index.count / 3;
	const positions = geometry.getAttribute('position');
	return positions ? positions.count / 3 : 0;
}

function buildMobileVegetationGeometryRun136(species) {
	const { trunk, foliage } = species;
	const trunkGeometry = new THREE.CylinderGeometry(
		trunk.radiusTop,
		trunk.radiusBottom,
		trunk.height,
		MOBILE_VEGETATION_LOD_RUN136.trunkRadialSegments,
	);
	trunkGeometry.translate(0, trunk.height / 2, 0);

	let foliageGeometry;
	if (foliage.kind === 'cone') {
		foliageGeometry = new THREE.ConeGeometry(
			foliage.radius,
			foliage.height,
			MOBILE_VEGETATION_LOD_RUN136.coneRadialSegments,
		);
		foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
	} else if (foliage.kind === 'sphere') {
		foliageGeometry = new THREE.SphereGeometry(
			foliage.radius,
			MOBILE_VEGETATION_LOD_RUN136.sphereWidthSegments,
			MOBILE_VEGETATION_LOD_RUN136.sphereHeightSegments,
		);
		foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
	} else {
		throw new Error(`world/vegetation.js: unknown mobile LOD foliage kind "${foliage.kind}" for species "${species.id}"`);
	}
	return { trunkGeometry, foliageGeometry };
}

const _createVegetationBeforeMobileLodRun136 = createVegetation;
createVegetation = function createVegetationWithMobileLodRun136(options) {
	const result = _createVegetationBeforeMobileLodRun136(options);
	const isMobileCoarsePointer = typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
	if (!isMobileCoarsePointer || result.group.children.length === 0) return result;

	let desktopTriangles = 0;
	let mobileTriangles = 0;
	for (let speciesIndex = 0; speciesIndex < SPECIES.length; speciesIndex++) {
		const trunkMesh = result.group.children[speciesIndex * 2];
		const foliageMesh = result.group.children[speciesIndex * 2 + 1];
		desktopTriangles += geometryTriangleCountRun136(trunkMesh.geometry) * trunkMesh.count;
		desktopTriangles += geometryTriangleCountRun136(foliageMesh.geometry) * foliageMesh.count;

		const oldTrunkGeometry = trunkMesh.geometry;
		const oldFoliageGeometry = foliageMesh.geometry;
		const mobileGeometry = buildMobileVegetationGeometryRun136(SPECIES[speciesIndex]);
		trunkMesh.geometry = mobileGeometry.trunkGeometry;
		foliageMesh.geometry = mobileGeometry.foliageGeometry;
		oldTrunkGeometry.dispose();
		oldFoliageGeometry.dispose();

		mobileTriangles += geometryTriangleCountRun136(trunkMesh.geometry) * trunkMesh.count;
		mobileTriangles += geometryTriangleCountRun136(foliageMesh.geometry) * foliageMesh.count;
	}

	result.group.userData.mobileVegetationLodRun136 = Object.freeze({
		active: true,
		desktopTriangles,
		mobileTriangles,
		reductionRatio: desktopTriangles > 0 ? 1 - mobileTriangles / desktopTriangles : 0,
		placedCount: result.placedCount,
	});
	return result;
};

/** Read-only diagnostics used by the Run 136 mobile vegetation regression gate. */
export function getMobileVegetationLodStatsRun136(group) {
	return group?.userData?.mobileVegetationLodRun136 ?? null;
}


// Run 180 — dispose the bounded wind-grass resource through the existing vegetation teardown.
const _disposeVegetationBeforeWindGrassRun180 = disposeVegetation;
disposeVegetation = function disposeVegetationWithWindGrassRun180(group) {
	const grass = group?.userData?.run180GrassGroup;
	if (grass) {
		grass.parent?.remove(grass);
		for (const mesh of grass.children) {
			mesh.geometry?.dispose();
			mesh.material?.dispose();
		}
		delete group.userData.run180GrassGroup;
	}
	return _disposeVegetationBeforeWindGrassRun180(group);
};

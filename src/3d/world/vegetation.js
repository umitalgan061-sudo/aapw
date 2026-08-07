/**
 * Procedural instanced trees — closes a real, long-standing gap: `GOVERNANCE.md` §3's target
 * architecture has named "Vegetation" as a `world/` system since this project's very first
 * architecture doc, and `config.js`'s `WORLD_DEFAULTS.WORLD_SEED` comment ("terrain, later
 * vegetation/rivers/etc.") has said so since before rivers even existed — but no code for it has
 * ever been written (confirmed: no `world/vegetation.js`, DECISIONS.md's only two "Vegetation"
 * mentions both say "not started"). Unlike FAZ 6/FAZ 11's still-missing horse/bird/etc. models,
 * a tree needs no rig/animation/UV-mapped texture to read correctly, so — same "primitives + a
 * shared material, no external file" technique `world/settlements.js`'s procedural castle and
 * `world/materials.js`'s procedural stone/roof already established — this ships a real first pass
 * now instead of waiting indefinitely for a tree/foliage model to arrive. v1 scope is scatter-only
 * (no per-species variety, no seat-local clustering) — see DECISIONS.md's newest ADR for the full
 * reasoning and what a future pass could add.
 *
 * Two low-poly primitives per tree (a narrow cylinder trunk, a cone foliage cap) rendered as two
 * `THREE.InstancedMesh`es (one draw call each, regardless of tree count) — the same "one draw call
 * per part, not per object" technique `world/settlements.js`'s keep/tower/roof `InstancedMesh`es
 * already use for the procedural castle silhouette.
 *
 * Placement is deterministic rejection-sampling over a disc centered on the world origin (uniform-
 * disc sampling, not naive polar coordinates, which would bias density toward the center — same
 * `r = R*sqrt(u)` formula every standard "random point in a disc" derivation uses): reads the same
 * shared `sampleHeightMeters` every other world system reads through, skips points below sea level
 * (no trees in the water), on ground steeper than `MAX_GROUND_SLOPE_DEGREES` (no trees floating off
 * a near-vertical cliff face), inside `SEAT_EXCLUSION_RADIUS_METERS` of a kingdom seat (no trees
 * poking up through a castle's flattened footprint pad), or within `ROAD_EXCLUSION_RADIUS_METERS`
 * of any road-network edge segment (no trees blocking the road itself). This module never modifies
 * terrain height/noise/world-scale — it only *reads* the existing, unmodified height field to decide
 * where an additional, purely additive render object goes — so GOVERNANCE.md §8.4's "Arazi
 * Değişiklik Güvenlik Kontrolü" (which gates changes to the height sampler itself) doesn't apply the
 * way it did for ADR-0075's macro relief; the *placement* exclusion logic below is this module's own
 * equivalent safety net instead, verified by this module's own smoke checks.
 * @module world/vegetation
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

/** Trunk/foliage silhouette, in meters — a simple, low-poly "pine-ish" shape (narrow cylinder +
 * cone), not a specific real species. Same 6-8 sided low-poly primitive count `world/settlements.js`'s
 * castle towers/roofs already use for its own procedural silhouette, for the same reason: cheap
 * enough to instance by the hundreds without a real triangle-budget cost. */
const TRUNK_RADIUS_TOP_METERS = 0.22;
const TRUNK_RADIUS_BOTTOM_METERS = 0.38;
const TRUNK_HEIGHT_METERS = 3.4;
const TRUNK_RADIAL_SEGMENTS = 6;
const FOLIAGE_RADIUS_METERS = 2.15;
const FOLIAGE_HEIGHT_METERS = 5.6;
const FOLIAGE_RADIAL_SEGMENTS = 7;
/** How far the foliage cone's base drops below its own full height above the trunk top — a small
 * deliberate overlap so no visible gap/seam shows between trunk and foliage at any scale/angle. */
const FOLIAGE_TRUNK_OVERLAP_METERS = 0.3;
const TRUNK_COLOR = 0x5b4028;
const FOLIAGE_COLOR = 0x2f5c26;

/** Trees per km² of the scatter disc — this run's own engineering judgment (sparse scatter, not a
 * dense forest — a first pass establishing the system), not calibrated against a real playtest. See
 * `QUESTIONS_FOR_OWNER.md`'s newest entry: the same "feel constant nobody has played against yet"
 * pattern ADR-0089/ADR-0096/ADR-0111/ADR-0116 already logged there for their own tuning values. */
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
 * corridor. Pure/stateless (given the sampler and data arrays) — exported so this module's own
 * smoke checks can assert known good/bad points directly, without spinning up a full
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
 * Scatters deterministic procedural trees over a disc of radius `radiusMeters` centered on the
 * world origin — matching whatever radius the caller actually loaded terrain for (`sceneManager.js`
 * passes its own boot-preview radius, so trees never render over a chunk that was never generated,
 * on either desktop or mobile-budget devices), so tree count naturally scales down with the smaller
 * mobile preview area instead of needing a second, device-specific density knob.
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters Same shared sampler every
 *   other world system reads through (`physics.js`'s ground collider).
 * @param {number} options.seaLevelMeters `WORLD_DEFAULTS.WATER_LEVEL_METERS`.
 * @param {number} options.seed World seed — same seed always reproduces the same scatter.
 * @param {{x: number, z: number}[]} options.seats Kingdom-seat positions (exclusion).
 * @param {{points: {x: number, z: number}[]}[]} options.roadEdges Road-network edges (exclusion).
 * @param {number} options.radiusMeters Scatter disc radius, meters.
 * @param {number} [options.densityPerKm2] Overridable for testing; defaults to `TARGET_DENSITY_PER_KM2`.
 * @returns {{group: THREE.Group, targetCount: number, placedCount: number}}
 */
export function createVegetation({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, radiusMeters, densityPerKm2 = TARGET_DENSITY_PER_KM2 }) {
	const group = new THREE.Group();
	const areaKm2 = (Math.PI * radiusMeters * radiusMeters) / 1_000_000;
	const targetCount = Math.max(0, Math.round(areaKm2 * densityPerKm2));
	if (targetCount === 0) return { group, targetCount: 0, placedCount: 0 };

	// XOR-tagged seed, independent random stream from terrain's own noise / rivers' own tagged
	// stream — same convention `world/rivers.js` already established for `mulberry32(seed ^ tag)`.
	const rng = mulberry32(seed ^ 0x56454745); // "VEGE"-ish tag
	const up = new THREE.Vector3(0, 1, 0);

	const trunkGeometry = new THREE.CylinderGeometry(TRUNK_RADIUS_TOP_METERS, TRUNK_RADIUS_BOTTOM_METERS, TRUNK_HEIGHT_METERS, TRUNK_RADIAL_SEGMENTS);
	const foliageGeometry = new THREE.ConeGeometry(FOLIAGE_RADIUS_METERS, FOLIAGE_HEIGHT_METERS, FOLIAGE_RADIAL_SEGMENTS);
	// Both primitives are Y-centered by default — shift each so the whole silhouette's local origin
	// sits at the tree's actual base (y=0), matching every other placed-by-ground-height object in
	// this project (settlements/NPCs/animals all place at a ground-Y that means "feet", not "center").
	trunkGeometry.translate(0, TRUNK_HEIGHT_METERS / 2, 0);
	foliageGeometry.translate(0, TRUNK_HEIGHT_METERS + FOLIAGE_HEIGHT_METERS / 2 - FOLIAGE_TRUNK_OVERLAP_METERS, 0);

	const trunkMaterial = new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, roughness: 1, metalness: 0 });
	const foliageMaterial = new THREE.MeshStandardMaterial({ color: FOLIAGE_COLOR, roughness: 0.9, metalness: 0 });

	const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, targetCount);
	const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, targetCount);
	// Placed once at scene-build time, never moved afterward — same "static, no per-frame update"
	// category `world/rivers.js`'s river/waterfall meshes are already in, unlike `water.js`'s ripple.
	trunkMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
	foliageMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scaleVector = new THREE.Vector3();

	let placedCount = 0;
	for (let treeIndex = 0; treeIndex < targetCount; treeIndex++) {
		for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE; attempt++) {
			// Uniform-disc sampling: r = R*sqrt(u), not r = R*u (which would over-concentrate points
			// near the center) — see this module's own header comment.
			const angle = rng() * Math.PI * 2;
			const radius = radiusMeters * Math.sqrt(rng());
			const x = Math.cos(angle) * radius;
			const z = Math.sin(angle) * radius;
			if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;

			const groundY = sampleHeightMeters(x, z);
			const scale = SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN);
			const yaw = rng() * Math.PI * 2;
			position.set(x, groundY, z);
			quaternion.setFromAxisAngle(up, yaw);
			scaleVector.set(scale, scale, scale);
			matrix.compose(position, quaternion, scaleVector);
			trunkMesh.setMatrixAt(placedCount, matrix);
			foliageMesh.setMatrixAt(placedCount, matrix);
			placedCount++;
			break;
		}
	}
	// Instance buffers were allocated at `targetCount`; `.count` caps actual rendering/iteration to
	// the (possibly smaller, if some attempts were exhausted) real placed count — unused trailing
	// instance-matrix slots are simply never drawn, not zeroed/identity-rendered at the origin (same
	// "count must match what's actually written" reasoning `world/settlements.js`'s own
	// `proceduralSeatCount`-sized `InstancedMesh` comment already documents for its own case).
	trunkMesh.count = placedCount;
	foliageMesh.count = placedCount;
	trunkMesh.instanceMatrix.needsUpdate = true;
	foliageMesh.instanceMatrix.needsUpdate = true;

	group.add(trunkMesh, foliageMesh);
	return { group, targetCount, placedCount };
}

/**
 * Disposes a `createVegetation` group's geometry + materials — same `disposeSettlements`/
 * `disposeRoadNetwork`/`disposeWater` single-argument convention every other `world/` disposer here
 * already follows.
 * @param {THREE.Group} group
 */
export function disposeVegetation(group) {
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		mesh.material.dispose();
	}
}

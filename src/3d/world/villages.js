/**
 * Villages — the houses, boundary walls and stone steps that turn a lone castle on an empty hillside
 * into a place people live. Owner directive 2026-08-13
 * (`GOVERNANCE_FULL_GAME_DIRECTIVE.md` §3, item 5: "dolu yerleşim — ev, ahır, çit, kalabalık").
 *
 * **Procedural, not asset-based, and why.** The owner asked for houses to be placed from `assets/`.
 * There are none: every model in `assets_manifest.json` is a character, a creature or a whole castle,
 * and the castle `.glb`s are single fused meshes with no separable house, wall or stair parts (run 330
 * verified this by reading every GLB's node/mesh table). Scaling a whole citadel down to cottage size
 * would read as a doll's-house castle, not a village. So the same answer this project already reached
 * for creatures in ADR-0272 applies here: generate the geometry. Recorded in `QUESTIONS_FOR_OWNER.md`
 * in case the owner meant something else by it.
 *
 * **One draw call per part, not per building.** Every piece is a `THREE.InstancedMesh` — the technique
 * `world/settlements.js` and `world/vegetation.js` already use. A 14-seat world of ~10 buildings each
 * costs 5 draw calls in total, not 140, which is what makes a populated world affordable at all
 * against `GOVERNANCE.md` §7's budgets.
 *
 * **Placement** reuses `world/vegetation.js`'s exported `isPlaceablePosition` rather than a second,
 * drifting copy of the water/slope/seat/road exclusion rules. Each seat picks one seeded bearing and
 * grows a hamlet in a disc on that side of its castle, rather than ringing the castle evenly: real
 * settlements cluster, and a uniform ring scatter (this module's own first pass) put one house per
 * ~9,000 m², which reads as isolated farmsteads. Houses face their hamlet's own centre, so the cluster
 * reads as buildings around a common green rather than as a parade facing a distant keep.
 *
 * Determinism: one `mulberry32(seed ^ tag)` stream, drawn in seat order (GOVERNANCE.md §8.9).
 * @module world/villages
 */

import * as THREE from 'three';
import { isPlaceablePosition } from './vegetation.js';
import { createStoneMaterial, createRoofMaterial } from './materials.js';

/** Bound on how far from a seat any part of its village may sit. Kept well inside a single 500m
 * terrain chunk so a village never reaches ground the seat's neighbourhood hasn't generated — the
 * same guarantee `createVegetation`'s cluster ring gives itself — and used to decide seat eligibility. */
const VILLAGE_OUTER_RADIUS_METERS = 210;
/** Note on the castle's own exclusion zone: it is not re-implemented here. A hamlet's nearest possible
 * house is `HAMLET_DISTANCE_MIN_METERS - HAMLET_RADIUS_METERS` = 77m from the seat, inside
 * `vegetation.js`'s 90m `SEAT_EXCLUSION_RADIUS_METERS`, and `isPlaceablePosition` rejects exactly
 * those — one shared rule, a few wasted samples, no second copy to drift. */
/** How far the hamlet's own centre sits from the castle, and how wide the hamlet itself is.
 *
 * Scattering houses uniformly across the whole 95-210m ring (the first pass) spread 12 buildings over
 * ~110,000 m² — one house per 9,000 m², which reads as isolated farmsteads, not a village. Real
 * settlements cluster on *one side* of their castle, so each seat now picks a single seeded bearing
 * and grows its hamlet in a disc there: same building count, roughly twenty times the density, and
 * neighbouring houses close enough for the field walls between them to make sense. */
const HAMLET_DISTANCE_MIN_METERS = 115;
const HAMLET_DISTANCE_MAX_METERS = 155;
const HAMLET_RADIUS_METERS = 38;
/** Minimum gap between two house centres, so a village reads as a street rather than a pile. */
const MIN_HOUSE_SPACING_METERS = 11;
/** Bounded rejection sampling, same discipline as `vegetation.js`'s `MAX_ATTEMPTS_PER_TREE`. */
const MAX_ATTEMPTS_PER_BUILDING = 12;
/** How far a house's base is pushed below the sampled ground height, so its flat footprint never
 * leaves a visible gap on the downhill side of a slope. */
const GROUND_BITE_METERS = 0.35;

/** Steps per stoop, and their size. Three risers is enough to read as "stairs" at gameplay distance
 * without becoming a staircase the player expects to be able to climb (there is no step collision —
 * `physics.js` snaps to the terrain height field, not to placed geometry). */
const STOOP_STEP_COUNT = 3;
const STOOP_STEP_RISE_METERS = 0.18;
const STOOP_STEP_RUN_METERS = 0.34;
const STOOP_WIDTH_METERS = 1.6;

/**
 * House archetypes. Sizes are real meters at medieval village scale — a cottage is genuinely small
 * (a person is 1.7m), which matters because a village of oversized houses next to a 46m castle
 * silently destroys the sense of scale the whole world is built on.
 */
const HOUSE_TYPES = [
	{ id: 'cottage', weight: 0.55, width: 5.2, depth: 4.4, wallHeight: 2.5, roofHeight: 2.2 },
	{ id: 'longhouse', weight: 0.3, width: 8.6, depth: 4.8, wallHeight: 2.7, roofHeight: 2.4 },
	{ id: 'twostory', weight: 0.15, width: 5.6, depth: 5.0, wallHeight: 4.6, roofHeight: 2.6 },
];

/** Wall (daub/plaster) and roof (thatch) tints. Deliberately warmer and lighter than the castles'
 * stone so a village reads as a different kind of building from across a valley. */
const WALL_COLOR = new THREE.Color(0xbdae91);
const STONE_WALL_COLOR = new THREE.Color(0x8d8878);
const THATCH_COLOR = new THREE.Color(0x9c7b42);

/**
 * Picks a `HOUSE_TYPES` index from one `[0,1)` draw, weighted. Pure; exported for this module's own
 * checks. Mirrors `vegetation.js`'s `pickSpeciesIndex` exactly rather than inventing a second shape.
 * @param {number} roll
 * @returns {number}
 */
export function pickHouseTypeIndex(roll) {
	const total = HOUSE_TYPES.reduce((sum, type) => sum + type.weight, 0);
	let cumulative = 0;
	for (let i = 0; i < HOUSE_TYPES.length; i++) {
		cumulative += HOUSE_TYPES[i].weight / total;
		if (roll < cumulative) return i;
	}
	return HOUSE_TYPES.length - 1;
}

/**
 * Builds the four shared geometries. Roofs are 4-sided cones (i.e. pyramids) rotated an eighth turn
 * so a flat face points down each axis, which reads as a hipped roof rather than as a spike; the
 * radial segment count is what makes it a pyramid instead of a cone, so no separate geometry is
 * needed for the two silhouettes.
 * @returns {{body: THREE.BufferGeometry, roof: THREE.BufferGeometry, step: THREE.BufferGeometry, wall: THREE.BufferGeometry}}
 */
function buildVillageGeometries() {
	// Unit geometries, scaled per instance — one buffer serves every house size.
	const body = new THREE.BoxGeometry(1, 1, 1);
	body.translate(0, 0.5, 0); // origin at the base, matching every other ground-placed object here

	const roof = new THREE.ConeGeometry(0.72, 1, 4);
	roof.rotateY(Math.PI / 4);
	roof.translate(0, 0.5, 0);

	const step = new THREE.BoxGeometry(1, 1, 1);
	step.translate(0, 0.5, 0);

	const wall = new THREE.BoxGeometry(1, 1, 1);
	wall.translate(0, 0.5, 0);

	return { body, roof, step, wall };
}

/**
 * Places villages around every seat in `seats`.
 *
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters Shared terrain sampler.
 * @param {number} options.seaLevelMeters
 * @param {number} options.seed World seed.
 * @param {{x: number, z: number}[]} options.seats Kingdom seats — village centres and exclusion zones.
 * @param {{points: {x: number, z: number}[]}[]} options.roadEdges Road network (exclusion).
 * @param {{points: {x: number, z: number}[]}[]} [options.riverCourses] River courses (exclusion) — a
 *   house standing mid-stream is as wrong as a tree, and both passes share this predicate.
 * @param {number} options.radiusMeters Radius of terrain actually loaded; a seat whose whole ring
 *   doesn't fit inside it is skipped, so no house renders over ungenerated ground.
 * @param {(seed: number) => () => number} options.mulberry32
 * @param {number} [options.housesPerVillage]
 * @returns {{group: THREE.Group, villageCount: number, houseCount: number, wallCount: number, houses: {x: number, z: number, radius: number}[]}}
 *   `houses` — one circle per placed house (footprint half-diagonal, see `physics.js`'s
 *   `createCircleCollider`) — is the run-330-technical-debt fix: before this, `physics.js` had no
 *   idea a village existed and the player walked straight through every cottage.
 *   `hamlets` — one entry per village green, so `world/villageBuildings.js` can raise the church, the
 *   smithy and the barns in the same village these houses are in.
 */
export function createVillages({
	sampleHeightMeters,
	seaLevelMeters,
	seed,
	seats,
	roadEdges,
	riverCourses = [],
	radiusMeters,
	mulberry32,
	housesPerVillage = 10,
}) {
	const group = new THREE.Group();
	group.name = 'villages';

	const eligibleSeats = seats.filter((seat) => Math.hypot(seat.x, seat.z) + VILLAGE_OUTER_RADIUS_METERS <= radiusMeters);
	const maxHouses = eligibleSeats.length * housesPerVillage;
	const maxWalls = eligibleSeats.length * 14;
	if (maxHouses === 0) return { group, villageCount: 0, houseCount: 0, wallCount: 0, houses: [] };

	const rng = mulberry32(seed ^ 0x56494c4c); // "VILL" tag — its own stream, perturbs nothing else
	const geometries = buildVillageGeometries();

	// `repeat` here is blocks-per-house-wall, and the first pass got it badly wrong: the stone texture
	// paints 8x8 blocks per tile, so `repeat: 2` put 16 blocks across a 5.2m wall — 30cm units that
	// rendered as bathroom tiling, not masonry. Below 1 the tile is *stretched*, which is what gives
	// the ~1m rustic blocks a cottage wall should have.
	const wallMaterial = createStoneMaterial({ seed: seed + 41, baseColor: WALL_COLOR, repeat: 0.6 });
	const roofMaterial = createRoofMaterial({ seed: seed + 42, repeat: 3 });
	const stoneMaterial = createStoneMaterial({ seed: seed + 43, baseColor: STONE_WALL_COLOR, repeat: 0.8 });

	const bodyMesh = new THREE.InstancedMesh(geometries.body, wallMaterial, maxHouses);
	const roofMesh = new THREE.InstancedMesh(geometries.roof, roofMaterial, maxHouses);
	const stepMesh = new THREE.InstancedMesh(geometries.step, stoneMaterial, maxHouses * STOOP_STEP_COUNT);
	const wallMesh = new THREE.InstancedMesh(geometries.wall, stoneMaterial, maxWalls);
	bodyMesh.name = 'village-houses';
	roofMesh.name = 'village-roofs';
	stepMesh.name = 'village-steps';
	wallMesh.name = 'village-walls';
	for (const mesh of [bodyMesh, roofMesh, stepMesh, wallMesh]) {
		mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		mesh.castShadow = true;
	}

	const dummy = new THREE.Object3D();
	const thatch = new THREE.Color();
	let houseCount = 0;
	let stepCount = 0;
	let wallCount = 0;
	let villageCount = 0;
	/** One collision circle per placed house — see this function's own JSDoc `houses` return note. */
	const houses = [];
	/**
	 * Where each village's green actually ended up.
	 *
	 * Returned because the hamlet centre is drawn from this module's own RNG stream in seat order and
	 * cannot be recomputed from outside without copying that draw — and a copy would drift the moment
	 * either side changed. `world/villageBuildings.js` needs it to put the church, the smithy and the
	 * barns in the same village as the houses rather than in a field somewhere near it.
	 */
	const hamlets = [];

	for (const seat of eligibleSeats) {
		const placedHere = [];

		// One seeded bearing per seat: the hamlet grows on that side of the castle rather than ringing
		// it. Drawn before the house loop so the whole village shares one centre.
		const hamletBearing = rng() * Math.PI * 2;
		const hamletDistance = HAMLET_DISTANCE_MIN_METERS + rng() * (HAMLET_DISTANCE_MAX_METERS - HAMLET_DISTANCE_MIN_METERS);
		const hamletX = seat.x + Math.cos(hamletBearing) * hamletDistance;
		const hamletZ = seat.z + Math.sin(hamletBearing) * hamletDistance;
		hamlets.push({ seatId: seat.id, x: hamletX, z: hamletZ, radiusMeters: HAMLET_RADIUS_METERS });

		for (let i = 0; i < housesPerVillage; i++) {
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_BUILDING; attempt++) {
				// Uniform disc around the hamlet centre (`r = R*sqrt(u)`, the same formula the tree
				// scatter uses to avoid over-concentrating toward the middle).
				const spreadAngle = rng() * Math.PI * 2;
				const spreadRadius = HAMLET_RADIUS_METERS * Math.sqrt(rng());
				const x = hamletX + Math.cos(spreadAngle) * spreadRadius;
				const z = hamletZ + Math.sin(spreadAngle) * spreadRadius;
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges, riverCourses })) continue;
				// Keep neighbours apart. Only this village's own houses are checked: two seats are far
				// enough apart that their rings cannot overlap.
				let tooClose = false;
				for (const other of placedHere) {
					if (Math.hypot(x - other.x, z - other.z) < MIN_HOUSE_SPACING_METERS) {
						tooClose = true;
						break;
					}
				}
				if (tooClose) continue;

				const type = HOUSE_TYPES[pickHouseTypeIndex(rng())];
				const groundY = sampleHeightMeters(x, z);
				// Face the hamlet's own centre (not the distant castle) with a little slop — that is what
				// makes the cluster read as houses around a common green rather than as a parade.
				const yaw = Math.atan2(hamletX - x, hamletZ - z) + (rng() - 0.5) * 0.5;

				// Sunk slightly so the flat base never floats over the downhill side of sloped ground.
				// Cheaper and steadier than skirting each house to the terrain, and invisible at any
				// camera angle a player actually has.
				dummy.position.set(x, groundY - GROUND_BITE_METERS, z);
				dummy.rotation.set(0, yaw, 0);
				dummy.scale.set(type.width, type.wallHeight + GROUND_BITE_METERS, type.depth);
				dummy.updateMatrix();
				bodyMesh.setMatrixAt(houseCount, dummy.matrix);

				// Hipped roof matching the house's own rectangular footprint. Scaling the 4-sided cone
				// by one square span (the first pass) put a square hat on a rectangular cottage and
				// overhung the short axis by nearly a metre. The pyramid's corners sit at radius 0.72,
				// so its side length is `0.72 * sqrt(2) * scale` — hence the 1.04 factor to land a
				// deliberate ~4% eave overhang on *each* axis independently.
				dummy.position.set(x, groundY + type.wallHeight, z);
				dummy.rotation.set(0, yaw, 0);
				dummy.scale.set(type.width * 1.04, type.roofHeight, type.depth * 1.04);
				dummy.updateMatrix();
				roofMesh.setMatrixAt(houseCount, dummy.matrix);
				// Thatch varies per house so a row of roofs doesn't read as one extruded ribbon. The
				// roof map is deliberately grey-ish (see `createRoofMaterial`) so this multiply lands
				// as a real colour rather than tinting an already-coloured texture twice.
				thatch.copy(THATCH_COLOR).offsetHSL(0, 0, (rng() - 0.5) * 0.12);
				roofMesh.setColorAt(houseCount, thatch);

				// Stoop: steps climbing toward the door, on the castle-facing side.
				const frontX = Math.sin(yaw);
				const frontZ = Math.cos(yaw);
				for (let s = 0; s < STOOP_STEP_COUNT; s++) {
					const outward = type.depth / 2 + (STOOP_STEP_COUNT - s) * STOOP_STEP_RUN_METERS;
					dummy.position.set(x + frontX * outward, groundY, z + frontZ * outward);
					dummy.rotation.set(0, yaw, 0);
					dummy.scale.set(STOOP_WIDTH_METERS, STOOP_STEP_RISE_METERS * (s + 1), STOOP_STEP_RUN_METERS);
					dummy.updateMatrix();
					stepMesh.setMatrixAt(stepCount, dummy.matrix);
					stepCount++;
				}

				placedHere.push({ x, z });
				// Bounding circle over the house's own footprint diagonal (yaw-independent, so no
				// rotated-box math is needed — see physics.js's createCircleCollider doc comment).
				houses.push({ x, z, radius: Math.hypot(type.width, type.depth) / 2 });
				houseCount++;
				break;
			}
		}

		if (placedHere.length === 0) continue;
		villageCount++;

		// Low field walls between neighbouring houses — the cheapest thing that turns scattered
		// buildings into enclosed plots. Neighbour order is by angle around the seat, NOT placement
		// order: houses are sampled randomly across the whole ring, so consecutive *placements* are
		// typically ~100m apart and almost every pair failed the span test below (the first pass built
		// 1 wall for 120 houses). Sorting by bearing makes "the next house" mean the one actually next
		// to it, and closes the ring by walking one extra step back to the first.
		const ringOrder = [...placedHere].sort(
			(p, q) => Math.atan2(p.z - hamletZ, p.x - hamletX) - Math.atan2(q.z - hamletZ, q.x - hamletX),
		);
		for (let i = 0; i < ringOrder.length && wallCount < maxWalls; i++) {
			const a = ringOrder[i];
			const b = ringOrder[(i + 1) % ringOrder.length];
			const span = Math.hypot(b.x - a.x, b.z - a.z);
			if (span > 26) continue;
			const midX = (a.x + b.x) / 2;
			const midZ = (a.z + b.z) / 2;
			if (!isPlaceablePosition(midX, midZ, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
			dummy.position.set(midX, sampleHeightMeters(midX, midZ), midZ);
			dummy.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
			dummy.scale.set(0.45, 0.95, span * 0.6);
			dummy.updateMatrix();
			wallMesh.setMatrixAt(wallCount, dummy.matrix);
			wallCount++;
		}
	}

	bodyMesh.count = houseCount;
	roofMesh.count = houseCount;
	stepMesh.count = stepCount;
	wallMesh.count = wallCount;
	for (const mesh of [bodyMesh, roofMesh, stepMesh, wallMesh]) mesh.instanceMatrix.needsUpdate = true;
	if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
	group.add(bodyMesh, roofMesh, stepMesh, wallMesh);

	return { group, villageCount, houseCount, wallCount, houses, hamlets };
}

/**
 * Disposes a `createVillages` group — same single-argument convention as every other `world/`
 * disposer. Materials are shared between meshes (steps and field walls use one stone material), so
 * they are deduped before disposal, matching `disposeSettlements`.
 * @param {THREE.Group} group
 */
export function disposeVillages(group) {
	const disposedMaterials = new Set();
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		if (disposedMaterials.has(mesh.material)) continue;
		disposedMaterials.add(mesh.material);
		for (const key of ['map', 'roughnessMap', 'normalMap']) {
			if (mesh.material[key]) mesh.material[key].dispose();
		}
		mesh.material.dispose();
	}
}

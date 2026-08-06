/**
 * Kingdom-seat settlements: one procedural castle (box keep + 4 corner towers + conical roofs)
 * per 2D-map kingdom capital, positioned in world space via the map->world convention this module
 * establishes (see DECISIONS.md ADR-0013) and sampled onto `world/terrain.js`'s real height field
 * so each castle sits on the ground it actually renders, not a guessed flat height. FAZ 3's first
 * pass: modular primitive geometry, not an external model — matches this project's established
 * "geography/gameplay shape first, asset-based detail later" pattern (terrain/water/rivers all
 * did the same before any model asset was consumed). Materials (stone walls/towers, slate roofs)
 * are seeded procedural PBR maps from `world/materials.js` (color/roughness/normal for stone,
 * color/roughness for roofs) -- FAZ 3's second pass, see that module's doc comment for why
 * procedural rather than an external texture file. Per-kingdom roof/banner color via
 * `InstancedMesh` per-instance color, multiplied over the roof's grayscale-ish shingle map — one
 * draw call per geometry (keep/tower/roof), not one per castle.
 * @module world/settlements
 */

import * as THREE from 'three';
import { createStoneMaterial, createRoofMaterial, disposeCastleMaterial } from './materials.js';

/**
 * Kingdom seats: `id`/`name`/`house`/`color`/2D-map `mapX`/`mapY` only, derived from `script.js`'s
 * `INIT_KINGDOMS` on 2026-07-29 (the same 14 entries ADR-0001's world-scale bounding box was
 * computed from). Deliberately a frozen, hand-copied snapshot — not a live import of `script.js`:
 * `script.js` is the 2D game's own top-level script, executing immediately against 2D-game DOM
 * elements (`#map-canvas`, etc.); importing it as an ES module here would run 2D-game logic inside
 * the 3D page's context, a real risk to the "keep the existing 2D game intact" golden rule, not a
 * hypothetical one. Gameplay state (army/navy/gold/territory/conquered/alliances/...) is 2D-game-
 * only and intentionally not copied — this module only needs "where is this kingdom's castle."
 * Hand-sync if `INIT_KINGDOMS` changes materially — same rule `config.js`'s `WORLD_SCALE` doc
 * comment already states for the bounding box it was derived from.
 */
export const KINGDOM_SEATS = Object.freeze([
	Object.freeze({ id: 'umit', name: 'Ümit Targeryan', house: 'Targeryan', color: '#c8430a', mapX: 3885, mapY: 5370 }),
	Object.freeze({ id: 'berkalp', name: 'Berkalp Stark', house: 'Stark', color: '#8faabb', mapX: 1525, mapY: 1750 }),
	Object.freeze({ id: 'ziya', name: 'Ziya Tyrell', house: 'Tyrell', color: '#4a9c30', mapX: 1185, mapY: 4040 }),
	Object.freeze({ id: 'berk', name: 'Berk Tyrell', house: 'Tyrell', color: '#20c8a0', mapX: 1095, mapY: 4040 }),
	Object.freeze({ id: 'olena', name: 'Olena Tyrell', house: 'Tyrell', color: '#c8386a', mapX: 1145, mapY: 3990 }),
	Object.freeze({ id: 'cersei', name: 'Cersei Lannister', house: 'Lannister', color: '#c8960a', mapX: 1750, mapY: 3580 }),
	Object.freeze({ id: 'stannis', name: 'Stannis Baratheon', house: 'Baratheon', color: '#e8b050', mapX: 2100, mapY: 3270 }),
	Object.freeze({ id: 'doran', name: 'Doran Martell', house: 'Martell', color: '#e06090', mapX: 1610, mapY: 4560 }),
	Object.freeze({ id: 'balon', name: 'Balon Greyjoy', house: 'Greyjoy', color: '#888888', mapX: 920, mapY: 2900 }),
	Object.freeze({ id: 'robin', name: 'Robin Arryn', house: 'Arryn', color: '#4a88c8', mapX: 1850, mapY: 2790 }),
	Object.freeze({ id: 'jon', name: 'Jon Snow', house: 'Stark', color: '#5a78aa', mapX: 1650, mapY: 1060 }),
	Object.freeze({ id: 'twin', name: 'Twin Lannister', house: 'Lannister', color: '#d4a060', mapX: 1050, mapY: 3360 }),
	Object.freeze({ id: 'Xaro', name: 'Xaro Xhoan Daxos', house: 'Qarth', color: '#d4a060', mapX: 6190, mapY: 5140 }),
	Object.freeze({ id: 'Night King', name: 'Night King', house: 'Night King', color: '#88bbdd', mapX: 1400, mapY: 300 }),
]);

const STONE_COLOR = new THREE.Color(0x8a8578);

/**
 * Real, decimated castle models (DECISIONS.md ADR-0074, ADR-0086) — replace the procedural
 * keep/tower/roof at these 8 seats. Each `file` is a `gltf-transform weld -> simplify -> prune`
 * output (see `assets_manifest.json`'s own `_decimated` entries), not the raw multi-hundred-K-
 * triangle original — see ADR-0074 for why the raw files would blow the desktop triangle budget on
 * their own. Thematic seat matches: `jon` (northernmost seat) <- ice/frost citadel, `umit` (player's
 * own seat, largest/most-detailed model) <- walled city fortress, `cersei` (this world's reigning
 * "crown" character) <- fortress of the crown, `balon` (Greyjoy/Iron Islands) <- castle on a rock,
 * `ziya` (Tyrell, green/gold rose sigil) <- emerald citadel, `berkalp` (Stark, grey/direwolf) <-
 * greystone castle, `doran` (Martell/Dorne, sandstone) <- brickstone citadel, `twin` (the Twins'
 * river-crossing toll flavor, see `dialogueChoices.js`) <- a mislabeled Meshy/Hitem3d asset
 * (`dragon_reference_v1`, real content is a gatehouse with a wooden drawbridge — ADR-0086). The
 * remaining 6 seats keep the procedural castle unchanged, still blocked on a new manually-downloaded
 * castle-shaped asset (no further unused/mislabeled asset like `dragon_reference_v1` remains in the
 * manifest — confirmed by ADR-0086's own repo-wide check).
 */
export const CASTLE_MODEL_ASSIGNMENTS = Object.freeze([
	Object.freeze({ seatId: 'jon', assetId: 'castle_icebound_citadel_decimated', file: 'assets/models/settlements/castles/icebound_citadel_decimated.glb' }),
	Object.freeze({ seatId: 'umit', assetId: 'castle_walled_city_fortress_decimated', file: 'assets/models/settlements/castles/walled_city_fortress_decimated.glb' }),
	Object.freeze({ seatId: 'cersei', assetId: 'castle_fortress_of_the_crown_decimated', file: 'assets/models/settlements/castles/fortress_of_the_crown_decimated.glb' }),
	Object.freeze({ seatId: 'balon', assetId: 'castle_castle_on_a_rock_decimated', file: 'assets/models/settlements/castles/castle_on_a_rock_decimated.glb' }),
	Object.freeze({ seatId: 'ziya', assetId: 'castle_emerald_citadel_decimated', file: 'assets/models/settlements/castles/emerald_citadel_decimated.glb' }),
	Object.freeze({ seatId: 'berkalp', assetId: 'castle_greystone_castle_decimated', file: 'assets/models/settlements/castles/greystone_castle_decimated.glb' }),
	Object.freeze({ seatId: 'doran', assetId: 'castle_brickstone_citadel_decimated', file: 'assets/models/settlements/castles/brickstone_citadel_decimated.glb' }),
	Object.freeze({ seatId: 'twin', assetId: 'castle_reference_gatehouse_decimated', file: 'assets/models/settlements/castles/gatehouse_reference_decimated.glb' }),
]);

/** Target footprint (largest horizontal bounding-box dimension), in meters, real castle models are
 * uniformly scaled to — close to the procedural castle's own ~40m tower-to-tower spread
 * (`SETTLEMENT_CONFIG.TOWER_CORNER_OFFSET_METERS` 20 * 2) so `physics.js`'s settlement collider
 * (sized from the same procedural constants, applied uniformly to every seat) stays a reasonable
 * approximation for these seats too, without needing a per-seat collider radius. */
const REAL_CASTLE_FOOTPRINT_METERS = 46;

/**
 * Ground-flatten pad radii (DECISIONS.md ADR-0118), in meters, applied around every kingdom seat —
 * see `world/terrain.js`'s `createHeightSampler` `flattenPads` param for the actual blend math.
 * `INNER` is fully flat (no residual slope anywhere under the castle) and sized to comfortably clear
 * the farthest point either castle shape actually reaches from its own center: the procedural
 * silhouette's own corner towers reach `hypot(TOWER_CORNER_OFFSET_METERS, TOWER_CORNER_OFFSET_METERS)
 * + TOWER_RADIUS_BOTTOM_METERS` = `hypot(20, 20) + 6.5` ≈ 34.8m (`SETTLEMENT_CONFIG`, `config.js`);
 * a real model's own scaled bounding box reaches at most `REAL_CASTLE_FOOTPRINT_METERS / 2 * Math.SQRT2`
 * ≈ 32.5m (a square footprint's own worst-case corner distance — real footprints are usually
 * narrower than that on at least one axis, so this is already a conservative upper bound, not a
 * measured-per-model number). `OUTER` is where the pad has fully eased back to untouched natural
 * terrain — picked wide enough (a 37m blend ring) that the transition reads as a gentle grade rather
 * than a visible seam given this world's typical local relief (`DEFAULT_MAX_HEIGHT_METERS` 24m over
 * ~167m noise-cell wavelengths — see `terrain.js`'s `NOISE_SCALE`), not derived from a stricter
 * formula since "how wide before a blend looks natural" is a visual judgment call, not a physical
 * constant. One shared radius pair for every seat (not per-shape) — simpler to reason about than a
 * real-model-vs-procedural branch, and both shapes fit comfortably inside it either way.
 */
const SETTLEMENT_FLATTEN_INNER_RADIUS_METERS = 38;
const SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS = 75;

/**
 * Builds the `flattenPads` list `world/terrain.js`'s `createHeightSampler` consumes to flatten the
 * ground under/around every kingdom seat's castle (DECISIONS.md ADR-0118) — call once, before
 * building the *final* sampler that `world/chunkManager.js`/`physics.js`'s `createGroundCollider`
 * both then use, and pass the same `flattenPads` array to both (see `sceneManager.js`) so the
 * rendered ground mesh and every gameplay height query agree on the exact same flattened field.
 *
 * Each pad's `anchorHeightMeters` deliberately mirrors `createSettlements`'s own `groundY` formula
 * (`Math.max(sampleHeightMeters(x, z), seaLevelMeters + minGroundClearanceMeters)`) exactly — not
 * the *raw* unclamped terrain sample — so the flattened pad settles at precisely the height a castle
 * actually rests at, clamp included. Using the raw sample instead would silently reintroduce the
 * exact bug this exists to fix for any seat the clamp actually lifts (e.g. `jon`, whose raw terrain
 * sample sits a mere ~4mm above `WORLD_DEFAULTS.WATER_LEVEL_METERS` — the castle itself is clamped
 * up to `MIN_GROUND_CLEARANCE_METERS` above that, so a pad flattened to the *unclamped* height would
 * leave the castle floating ~1.5m above its own supposedly-flattened ground).
 * @param {object} options
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters The *base*
 *   (unflattened) sampler — i.e. `createHeightSampler(seed)` called with no `flattenPads` of its
 *   own. Passing an already-flattened sampler here would be circular.
 * @param {number} options.seaLevelMeters `WORLD_DEFAULTS.WATER_LEVEL_METERS`.
 * @param {number} options.minGroundClearanceMeters `SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS`.
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} options.mapBounds `WORLD_SCALE.MAP_BOUNDS`.
 * @param {number} options.metersPerMapUnit `WORLD_SCALE.METERS_PER_MAP_UNIT`.
 * @returns {{x: number, z: number, innerRadiusMeters: number, outerRadiusMeters: number, anchorHeightMeters: number}[]}
 */
export function computeSettlementFlattenPads({ sampleHeightMeters, seaLevelMeters, minGroundClearanceMeters, mapBounds, metersPerMapUnit }) {
	return KINGDOM_SEATS.map((seat) => {
		const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, mapBounds, metersPerMapUnit);
		const anchorHeightMeters = Math.max(sampleHeightMeters(x, z), seaLevelMeters + minGroundClearanceMeters);
		return {
			x,
			z,
			innerRadiusMeters: SETTLEMENT_FLATTEN_INNER_RADIUS_METERS,
			outerRadiusMeters: SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS,
			anchorHeightMeters,
		};
	});
}

/**
 * Converts a 2D-map coordinate (same space as `INIT_KINGDOMS`' `x`/`y`) to a world-space `(x, z)`
 * in meters. The padded kingdom bounding box's *center* (`mapBounds`) maps to the world origin
 * `(0, 0)` — the same origin `world/chunkManager.js`'s chunk `(0, 0)` is centered on — so this
 * stays consistent with every other world system without a second, independent origin convention.
 * See DECISIONS.md ADR-0013.
 * @param {number} mapX
 * @param {number} mapY
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} mapBounds `WORLD_SCALE.MAP_BOUNDS`.
 * @param {number} metersPerMapUnit `WORLD_SCALE.METERS_PER_MAP_UNIT`.
 * @returns {{x: number, z: number}}
 */
export function mapToWorldXZ(mapX, mapY, mapBounds, metersPerMapUnit) {
	const centerMapX = (mapBounds.minX + mapBounds.maxX) / 2;
	const centerMapY = (mapBounds.minY + mapBounds.maxY) / 2;
	return {
		x: (mapX - centerMapX) * metersPerMapUnit,
		z: (mapY - centerMapY) * metersPerMapUnit,
	};
}

/**
 * Builds one `InstancedMesh` per castle part (keep, corner towers, roofs) covering every seat in
 * `KINGDOM_SEATS` — 3 draw calls total, not 3 per castle. Each castle is placed at its seat's
 * mapped world `(x, z)`, resting on `sampleHeightMeters`'s real terrain height (clamped up to
 * `SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS` above sea level — see `world/README.md`'s "Sea
 * level" convention).
 * @param {object} options
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters `world/terrain.js`'s `createHeightSampler` output.
 * @param {number} options.seaLevelMeters `WORLD_DEFAULTS.WATER_LEVEL_METERS`.
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} options.mapBounds `WORLD_SCALE.MAP_BOUNDS`.
 * @param {number} options.metersPerMapUnit `WORLD_SCALE.METERS_PER_MAP_UNIT`.
 * @param {import('../config.js').SETTLEMENT_CONFIG} options.settlementConfig `config.js`'s `SETTLEMENT_CONFIG`.
 * @param {number} options.seed `WORLD_DEFAULTS.WORLD_SEED` — seeds the procedural stone/roof
 *   texture generation in `world/materials.js` so castle materials are deterministic like every
 *   other generator in this folder (see `world/README.md`'s "Determinism" convention).
 * @returns {{group: THREE.Group, seats: {id: string, name: string, x: number, z: number, groundY: number}[]}}
 *   `seats` is exposed so `game3d.js` can force-load the terrain chunk under each castle — most
 *   seats fall outside both the boot-preview and mobile streaming radii (measured, not assumed:
 *   5 of 14 sit beyond even the desktop 17x17 boot preview) and would otherwise render floating
 *   over unrendered ground.
 */
export function createSettlements({ sampleHeightMeters, seaLevelMeters, mapBounds, metersPerMapUnit, settlementConfig, seed }) {
	const {
		KEEP_WIDTH_METERS,
		KEEP_HEIGHT_METERS,
		KEEP_DEPTH_METERS,
		TOWER_RADIUS_TOP_METERS,
		TOWER_RADIUS_BOTTOM_METERS,
		TOWER_HEIGHT_METERS,
		TOWER_CORNER_OFFSET_METERS,
		ROOF_RADIUS_METERS,
		ROOF_HEIGHT_METERS,
		MIN_GROUND_CLEARANCE_METERS,
	} = settlementConfig;

	// Seats in CASTLE_MODEL_ASSIGNMENTS get a real model instead (spawnRealCastleModels, loaded
	// async by the caller) — excluded here so the procedural InstancedMesh count matches exactly
	// what it actually places, not the full 14 (an InstancedMesh sized larger than the matrices
	// actually written to it would render leftover identity-matrix instances at the world origin).
	const realModelSeatIds = new Set(CASTLE_MODEL_ASSIGNMENTS.map((assignment) => assignment.seatId));
	const proceduralSeatCount = KINGDOM_SEATS.length - realModelSeatIds.size;
	const towerCount = proceduralSeatCount * 4;

	const keepGeometry = new THREE.BoxGeometry(KEEP_WIDTH_METERS, KEEP_HEIGHT_METERS, KEEP_DEPTH_METERS);
	const towerGeometry = new THREE.CylinderGeometry(TOWER_RADIUS_TOP_METERS, TOWER_RADIUS_BOTTOM_METERS, TOWER_HEIGHT_METERS, 8);
	const roofGeometry = new THREE.ConeGeometry(ROOF_RADIUS_METERS, ROOF_HEIGHT_METERS, 8);

	// Repeat counts tuned so a texture tile (8 stone blocks / 10 shingle rows) reads at roughly a
	// 1-1.5m real-world scale against the keep/roof's actual meters, not an arbitrary default —
	// see world/materials.js's module doc for why these are procedural rather than external files.
	const stoneRepeat = Math.max(2, Math.round(KEEP_WIDTH_METERS / 11));
	const roofRepeat = Math.max(2, Math.round(ROOF_HEIGHT_METERS / 3));
	const stoneMaterial = createStoneMaterial({ seed, baseColor: STONE_COLOR, repeat: stoneRepeat });
	const roofMaterial = createRoofMaterial({ seed: seed + 1, repeat: roofRepeat });

	const keepMesh = new THREE.InstancedMesh(keepGeometry, stoneMaterial, proceduralSeatCount);
	const towerMesh = new THREE.InstancedMesh(towerGeometry, stoneMaterial, towerCount);
	const roofMesh = new THREE.InstancedMesh(roofGeometry, roofMaterial, towerCount);
	keepMesh.name = 'settlements-keeps';
	towerMesh.name = 'settlements-towers';
	roofMesh.name = 'settlements-roofs';

	const dummy = new THREE.Object3D();
	const roofColor = new THREE.Color();
	const seats = [];
	let keepIndex = 0;
	let towerIndex = 0;

	KINGDOM_SEATS.forEach((seat) => {
		const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, mapBounds, metersPerMapUnit);
		const groundY = Math.max(sampleHeightMeters(x, z), seaLevelMeters + MIN_GROUND_CLEARANCE_METERS);

		seats.push({ id: seat.id, name: seat.name, x, z, groundY });

		if (realModelSeatIds.has(seat.id)) return; // real model placed separately — see spawnRealCastleModels.

		dummy.position.set(x, groundY + KEEP_HEIGHT_METERS / 2, z);
		dummy.updateMatrix();
		keepMesh.setMatrixAt(keepIndex, dummy.matrix);
		keepIndex++;

		roofColor.set(seat.color);
		const cornerOffsets = [
			[TOWER_CORNER_OFFSET_METERS, TOWER_CORNER_OFFSET_METERS],
			[TOWER_CORNER_OFFSET_METERS, -TOWER_CORNER_OFFSET_METERS],
			[-TOWER_CORNER_OFFSET_METERS, TOWER_CORNER_OFFSET_METERS],
			[-TOWER_CORNER_OFFSET_METERS, -TOWER_CORNER_OFFSET_METERS],
		];
		for (const [dx, dz] of cornerOffsets) {
			const towerX = x + dx;
			const towerZ = z + dz;

			dummy.position.set(towerX, groundY + TOWER_HEIGHT_METERS / 2, towerZ);
			dummy.updateMatrix();
			towerMesh.setMatrixAt(towerIndex, dummy.matrix);

			dummy.position.set(towerX, groundY + TOWER_HEIGHT_METERS + ROOF_HEIGHT_METERS / 2, towerZ);
			dummy.updateMatrix();
			roofMesh.setMatrixAt(towerIndex, dummy.matrix);
			roofMesh.setColorAt(towerIndex, roofColor);

			towerIndex++;
		}
	});

	keepMesh.instanceMatrix.needsUpdate = true;
	towerMesh.instanceMatrix.needsUpdate = true;
	roofMesh.instanceMatrix.needsUpdate = true;
	if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;

	const group = new THREE.Group();
	group.name = 'settlements';
	group.add(keepMesh, towerMesh, roofMesh);

	return { group, seats };
}

/**
 * Loads the real castle models named in `CASTLE_MODEL_ASSIGNMENTS`, applies a seeded stone
 * material (`world/materials.js`'s `createStoneMaterial` — same technique/look as the procedural
 * castles, just sized to each model's own real footprint), scales each to
 * `REAL_CASTLE_FOOTPRINT_METERS`, and positions it at its assigned seat's real `(x, groundY, z)`
 * (from `createSettlements`'s returned `seats`, so real models sit on the same terrain height the
 * procedural castles use — see `world/README.md`'s "Sea level" convention). Async because it goes
 * through `AssetLoader.loadModel` — call after `createSettlements` and add the returned group to
 * the scene the same way `gameplay/npc.js`'s/`gameplay/dragons.js`'s spawn functions are awaited in
 * `game3d.js`'s init sequence, not from `sceneManager.js`'s synchronous `createScene`.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {{id: string, x: number, z: number, groundY: number}[]} options.seats `createSettlements`'s returned `seats`.
 * @param {number} options.seed Same world seed every other procedural generator here uses, offset
 *   so each model's stone material tiles independently rather than all sharing one canvas texture.
 * @returns {Promise<THREE.Group>} One group containing all successfully-loaded real castles —
 *   already positioned/scaled/materialed, ready to `scene.add()`.
 */
export async function spawnRealCastleModels({ assetLoader, seats, seed }) {
	const seatsById = new Map(seats.map((seat) => [seat.id, seat]));
	const group = new THREE.Group();
	group.name = 'settlements-real-castles';

	const box = new THREE.Box3();
	const size = new THREE.Vector3();
	const center = new THREE.Vector3();

	await Promise.all(CASTLE_MODEL_ASSIGNMENTS.map(async (assignment, index) => {
		const seat = seatsById.get(assignment.seatId);
		if (!seat) {
			console.warn(`[settlements] spawnRealCastleModels: no seat found for id "${assignment.seatId}", skipping.`);
			return;
		}

		const model = await assetLoader.loadModel(assignment.file, { fallbackColor: 0x8a8578, fallbackSize: REAL_CASTLE_FOOTPRINT_METERS });

		box.setFromObject(model);
		box.getSize(size);
		box.getCenter(center);
		const largestDimension = Math.max(size.x, size.y, size.z) || 1;
		const scale = REAL_CASTLE_FOOTPRINT_METERS / largestDimension;

		// Repeat tuned the same way createSettlements does (texture tile vs. real meters), against
		// this model's own post-scale real-world footprint rather than the procedural keep's fixed
		// KEEP_WIDTH_METERS — each model is a different real size before scaling.
		const stoneRepeat = Math.max(2, Math.round(REAL_CASTLE_FOOTPRINT_METERS / 11));
		const stoneMaterial = createStoneMaterial({ seed: seed + 2 + index, baseColor: STONE_COLOR, repeat: stoneRepeat });
		model.traverse((node) => {
			if (node.isMesh) node.material = stoneMaterial;
		});

		model.scale.setScalar(scale);
		// Center horizontally on the seat and rest the model's own lowest point on the ground —
		// these Meshy AI exports aren't guaranteed to have their origin at their own base.
		model.position.set(
			seat.x - center.x * scale,
			seat.groundY - box.min.y * scale,
			seat.z - center.z * scale,
		);
		model.userData.kingdomSeatId = seat.id;
		group.add(model);
	}));

	return group;
}

/**
 * Disposes every geometry/material (and each material's procedural texture maps, via
 * `world/materials.js`'s `disposeCastleMaterial`) created by `createSettlements` (memory-leak
 * checklist). Call on scene teardown. `keepMesh`/`towerMesh` share one material instance, so
 * materials are deduped through a `Set` before disposing — `THREE.Material.dispose()` is itself
 * idempotent, but disposing the same textures twice is needless work, not just harmless.
 * @param {THREE.Group} group `createSettlements`'s returned `group`.
 */
export function disposeSettlements(group) {
	const disposedMaterials = new Set();
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		if (!disposedMaterials.has(mesh.material)) {
			disposedMaterials.add(mesh.material);
			disposeCastleMaterial(mesh.material);
		}
	}
}

/**
 * Disposes every real castle model `spawnRealCastleModels` loaded (geometry + its own
 * `createStoneMaterial` instance/maps — each model got a unique one, unlike the procedural
 * castles' shared `InstancedMesh` material, since `disposeCastleMaterial` is safe to call once per
 * mesh here with no dedup needed). Call on scene teardown, alongside `disposeSettlements`.
 * @param {THREE.Group} group `spawnRealCastleModels`'s returned group.
 */
export function disposeRealCastleModels(group) {
	for (const model of group.children) {
		model.traverse((node) => {
			if (node.isMesh) {
				node.geometry.dispose();
				disposeCastleMaterial(node.material);
			}
		});
	}
}

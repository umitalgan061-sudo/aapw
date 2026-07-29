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

	const seatCount = KINGDOM_SEATS.length;
	const towerCount = seatCount * 4;

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

	const keepMesh = new THREE.InstancedMesh(keepGeometry, stoneMaterial, seatCount);
	const towerMesh = new THREE.InstancedMesh(towerGeometry, stoneMaterial, towerCount);
	const roofMesh = new THREE.InstancedMesh(roofGeometry, roofMaterial, towerCount);
	keepMesh.name = 'settlements-keeps';
	towerMesh.name = 'settlements-towers';
	roofMesh.name = 'settlements-roofs';

	const dummy = new THREE.Object3D();
	const roofColor = new THREE.Color();
	const seats = [];
	let towerIndex = 0;

	KINGDOM_SEATS.forEach((seat, seatIndex) => {
		const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, mapBounds, metersPerMapUnit);
		const groundY = Math.max(sampleHeightMeters(x, z), seaLevelMeters + MIN_GROUND_CLEARANCE_METERS);

		dummy.position.set(x, groundY + KEEP_HEIGHT_METERS / 2, z);
		dummy.updateMatrix();
		keepMesh.setMatrixAt(seatIndex, dummy.matrix);

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

		seats.push({ id: seat.id, name: seat.name, x, z, groundY });
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

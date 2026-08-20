/**
 * Hero trees — the repository's real tree models, standing in place of procedural cones.
 *
 * **What this replaces.** `world/vegetation.js` builds every tree from a cone and a cylinder. That was
 * right while nothing better existed, but the repository ships a dozen authored tree models — the
 * Quaternius pine/birch/palm/dead-tree packs, a twisted tree, a big tree, a stump — sitting unused in
 * `assets/models/fbx/`. This puts them in the world.
 *
 * **Why it falls back instead of replacing outright.** `AssetLoader.loadModel` returns a visible
 * placeholder box when a file cannot be read, and marks it `userData.isPlaceholder`. In a checkout
 * without Git LFS objects — which is what a fresh remote clone gets (RCA_RUN344) — every one of these
 * `.glb` files is a 132-byte pointer stub, so loading them all and using them regardless would turn the
 * forests into a field of boxes: strictly worse than the cones. So each model is checked, placeholders
 * are discarded, and if none survive this layer simply does nothing and `vegetation.js`'s procedural
 * trees carry the world exactly as before. Where LFS resolves, real trees appear.
 *
 * **Where they go.** Only the near field. A hero tree is a full mesh with its own material, so it is
 * spent where the player can actually see the difference; the procedural instanced trees keep covering
 * the distance, which is what they are good at.
 *
 * **Species follow the map.** Palms in arid country, pines and dead trees on cold upland, broadleaf
 * elsewhere — read from `world/worldReferenceBiomeField.js`, the same per-cell answer the ground colour
 * and the forest mask use.
 *
 * **Deterministic.** Its own XOR-tagged `mulberry32` stream.
 * @module world/heroTrees
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { sampleMapAridity01, sampleMapForest01 } from './worldReferenceBiomeField.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';

const ASSET_ROOT = 'assets/models/fbx/';

/**
 * The authored tree models, with the country each suits. `heightMeters` is the trunk-to-crown height
 * the model is scaled to, so a pine and a palm are not the same size just because their source meshes
 * happened to be.
 */
export const HERO_TREE_SPECIES = Object.freeze([
	Object.freeze({ file: 'Tree by Quaternius - aVOxaHRPWe.glb', climate: 'temperate', heightMeters: 9 }),
	Object.freeze({ file: 'Tree by Quaternius - QVOop92WmG.glb', climate: 'temperate', heightMeters: 11 }),
	Object.freeze({ file: 'Tree by Quaternius - qZtx0AHhcy.glb', climate: 'temperate', heightMeters: 8 }),
	Object.freeze({ file: 'Big Tree by 3Donimus - dNWh762PN-6.glb', climate: 'temperate', heightMeters: 16 }),
	Object.freeze({ file: 'Fall Tree by Danni Bittman - 4GYen9Xm3Kj.glb', climate: 'temperate', heightMeters: 10 }),
	Object.freeze({ file: 'Birch Trees by Quaternius - R7qMWzb7nk.glb', climate: 'temperate', heightMeters: 12 }),
	Object.freeze({ file: 'Pine by Quaternius - Zt62gceKXZ.glb', climate: 'cold', heightMeters: 14 }),
	Object.freeze({ file: 'low_poly_winter_tree_pack.glb', climate: 'cold', heightMeters: 12 }),
	Object.freeze({ file: 'Dead Trees by Quaternius - F5I0Q7TwO5.glb', climate: 'cold', heightMeters: 9 }),
	Object.freeze({ file: 'Twisted Tree by Quaternius - 8oraKn9m0x.glb', climate: 'arid', heightMeters: 7 }),
	Object.freeze({ file: 'Dead Tree by Quaternius - n8FhMgMldD.glb', climate: 'arid', heightMeters: 6 }),
	Object.freeze({ file: 'Palm Trees by Quaternius - VYslw9DEi6.glb', climate: 'arid', heightMeters: 11 }),
	Object.freeze({ file: 'Tree stump by Poly by Google - esFOngb0uwl.glb', climate: 'any', heightMeters: 1.2 }),
]);

export const HERO_TREE_POLICY = Object.freeze({
	id: 'hero-trees-2026-08-20-v1',
	/** Radius around the boot camera within which hero trees are placed. Near field only — see header. */
	radiusMeters: 900,
	/** How many to place. Each is a real mesh with its own material, so this is a draw-call budget as
	 * much as a look decision. */
	targetCount: 90,
	maxAttempts: 40,
	/**
	 * Coverage at which a spot is accepted every time — real forest.
	 *
	 * Coverage below it does *not* reject: it scales the chance of acceptance, with `openCountryChance`
	 * as the floor. A hard `minForestCoverage: 0.28` gate was measured against the live field and threw
	 * away 99.9% of the near-field, leaving four trees, because the boot camera stands in open country:
	 * of 3447 dry samples inside the placement radius, 3106 read below 0.1 coverage and none read above
	 * 0.4. The field is not wrong — 89.6% of the whole map's cells are below 0.1, most of it sea and
	 * grassland — the gate was. Open grassland with no tree in it looks as artificial as forest with
	 * none, so open country keeps a scattering of lone trees and copses and the mask still decides where
	 * the woods are.
	 */
	fullForestCoverage: 0.5,
	/** Acceptance floor in open country — lone trees and copses, not a forest. */
	openCountryChance: 0.22,
	/** Acceptance in arid country, where the forest mask is correctly near zero but palms, twisted and
	 * dead trees still belong. */
	aridChance: 0.4,
	/** Clearance from a kingdom seat, so a hero tree never lands inside a castle's pad. */
	seatClearanceMeters: 120,
	/** Minimum spacing between two hero trees. */
	spacingMeters: 22,
	/** Above this aridity a spot takes the arid species list. */
	aridThreshold: 0.3,
	/** Above this height a spot takes the cold species list. */
	coldMinHeightMeters: 320,
});

function normalizedMapPoint(worldX, worldZ) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	const nx = (worldX / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
	const ny = (worldZ / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
}

/**
 * Chooses hero-tree placements. Pure sampling — no asset loading.
 *
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @param {number} options.seed
 * @param {{x: number, z: number}[]} [options.seats]
 * @param {number} [options.centerX]
 * @param {number} [options.centerZ]
 * @returns {{climate: string, x: number, z: number, y: number, rotationY: number, scaleJitter: number}[]}
 */
export function planHeroTreePlacements({ sampleHeightMeters, seed, seats = [], centerX = 0, centerZ = 0 }) {
	const P = HERO_TREE_POLICY;
	const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;
	const rng = mulberry32(seed ^ 0x48524f54); // "HROT"
	const placements = [];
	const seatClearanceSquared = P.seatClearanceMeters ** 2;
	const spacingSquared = P.spacingMeters ** 2;

	for (let index = 0; index < P.targetCount; index += 1) {
		for (let attempt = 0; attempt < P.maxAttempts; attempt += 1) {
			const angle = rng() * Math.PI * 2;
			const radius = P.radiusMeters * Math.sqrt(rng());
			const x = centerX + Math.cos(angle) * radius;
			const z = centerZ + Math.sin(angle) * radius;
			const height = sampleHeightMeters(x, z);
			if (height <= seaLevel + 1) continue;

			const { nx, ny } = normalizedMapPoint(x, z);
			const arid = sampleMapAridity01(nx, ny);
			const forest = sampleMapForest01(nx, ny);
			// Coverage sets the *chance*, not a pass/fail — see `fullForestCoverage`. Arid country takes
			// its own flat chance because the forest mask is correctly near zero there while a palm or a
			// dead tree is exactly what stands in open desert.
			const chance = arid > P.aridThreshold
				? P.aridChance
				: Math.max(P.openCountryChance, Math.min(1, forest / P.fullForestCoverage));
			if (rng() >= chance) continue;
			if (seats.some((seat) => (x - seat.x) ** 2 + (z - seat.z) ** 2 < seatClearanceSquared)) continue;
			if (placements.some((other) => (x - other.x) ** 2 + (z - other.z) ** 2 < spacingSquared)) continue;

			const climate = arid > P.aridThreshold ? 'arid'
				: height - seaLevel > P.coldMinHeightMeters ? 'cold' : 'temperate';
			placements.push({
				climate, x, z, y: height,
				rotationY: rng() * Math.PI * 2,
				scaleJitter: 0.78 + rng() * 0.5,
			});
			break;
		}
	}
	return placements;
}

/**
 * Loads the authored tree models and places them.
 *
 * Returns an empty group when no model survives loading, which is the normal outcome in a checkout
 * without LFS objects — the caller keeps its procedural trees and nothing looks worse than before.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {ReturnType<typeof planHeroTreePlacements>} options.placements
 * @returns {Promise<{group: THREE.Group, placedCount: number, speciesLoaded: number}>}
 */
export async function spawnHeroTrees({ assetLoader, placements }) {
	const group = new THREE.Group();
	group.name = 'hero-trees';

	const loaded = await Promise.all(HERO_TREE_SPECIES.map(async (species) => {
		const model = await assetLoader.loadModel(ASSET_ROOT + species.file, {
			fallbackColor: 0x3b6b2a, fallbackSize: species.heightMeters,
		});
		// A placeholder box is worse than the procedural cone it would replace, so it is discarded
		// rather than planted. See this module's header.
		return model && !model.userData?.isPlaceholder ? { species, model } : null;
	}));
	const usable = loaded.filter(Boolean);
	if (usable.length === 0) return { group, placedCount: 0, speciesLoaded: 0 };

	const byClimate = new Map();
	for (const entry of usable) {
		const keys = entry.species.climate === 'any' ? ['temperate', 'cold', 'arid'] : [entry.species.climate];
		for (const key of keys) {
			if (!byClimate.has(key)) byClimate.set(key, []);
			byClimate.get(key).push(entry);
		}
	}

	const box = new THREE.Box3();
	const size = new THREE.Vector3();
	let placedCount = 0;
	for (const placement of placements) {
		const candidates = byClimate.get(placement.climate) ?? usable;
		if (candidates.length === 0) continue;
		// Index derived from position rather than a fresh draw, so species choice stays deterministic
		// even if the usable set differs between environments.
		const entry = candidates[Math.abs(Math.round(placement.x * 7 + placement.z * 13)) % candidates.length];
		const model = entry.model.clone(true);
		box.setFromObject(model);
		box.getSize(size);
		const scale = (entry.species.heightMeters / (size.y || 1)) * placement.scaleJitter;
		model.scale.setScalar(scale);
		box.setFromObject(model);
		model.position.set(placement.x, placement.y - box.min.y, placement.z);
		model.rotation.y = placement.rotationY;
		model.userData.heroTree = Object.freeze({ file: entry.species.file, climate: placement.climate });
		group.add(model);
		placedCount += 1;
	}
	return { group, placedCount, speciesLoaded: usable.length };
}

/**
 * Plans, spawns and adds hero trees to a live scene, logging the outcome.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {{scene: THREE.Scene, camera: THREE.Camera, groundCollider: {getGroundHeight: (x: number, z: number) => number}, settlementSeats: {x: number, z: number}[]}} options.state
 * @returns {Promise<THREE.Group>}
 */
export async function initHeroTrees({ assetLoader, state }) {
	const placements = planHeroTreePlacements({
		sampleHeightMeters: state.groundCollider.getGroundHeight,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: state.settlementSeats,
		centerX: state.camera.position.x,
		centerZ: state.camera.position.z,
	});
	const { group, placedCount, speciesLoaded } = await spawnHeroTrees({ assetLoader, placements });
	state.scene.add(group);
	console.info(
		speciesLoaded === 0
			? `[game3d] Hero trees: none — no authored tree model loaded (LFS pointer stubs?); procedural trees stand.`
			: `[game3d] Hero trees: ${placedCount} placed from ${speciesLoaded} authored model(s).`,
	);
	return group;
}

/** Disposes a hero-tree group — same single-argument convention as every other `world/` disposer. */
export function disposeHeroTrees(group) {
	group.traverse((node) => {
		if (!node.isMesh) return;
		node.geometry?.dispose?.();
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) material?.dispose?.();
	});
}

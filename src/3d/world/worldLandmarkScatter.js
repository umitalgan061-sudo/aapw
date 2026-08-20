/**
 * Landmark scatter — the repository's model library, spread across the map by biome.
 *
 * **What the owner asked for.** "Blend dosyalarını haritaya serpiştir." The five `.blend` files under
 * `assets/models/fbx/` cannot be used directly: `.blend` is Blender's own project format, and nothing
 * in a browser — three.js included — can read it. What *can* be used is the 233 prop-shaped `.glb`
 * files those source files were exported to, which is what this module places.
 *
 * **Why placement is biome-driven rather than random.** Scattering props uniformly would put a barn in
 * the Red Waste and a ruined pillar in the middle of the Reach's farmland. The owner map now answers
 * "what is this ground" per cell (`world/worldReferenceBiomeField.js`), so each catalogue entry names
 * the country it belongs in and is only placed where the map agrees: docks on the coast, weathered
 * stone in arid country, farm buildings on open grassland, waymarks along the highways.
 *
 * **Deterministic.** Its own XOR-tagged `mulberry32` stream, so adding this cannot perturb the draw
 * order of vegetation, villages or any other seeded generator. Same world seed, same landmarks.
 *
 * **Async, like the castles.** Models come through `AssetLoader.loadModel`, so this is called from
 * `game3d.js`'s init sequence — the same place `spawnRealCastleModels` is awaited — not from
 * `sceneManager.js`'s synchronous `createScene`.
 *
 * **Known environment limitation.** In a fresh remote clone the `.glb` files arrive as 131-byte Git
 * LFS pointer stubs (RCA_RUN344), so `loadModel` falls back to a placeholder box for each. That is a
 * checkout condition, not a defect here: the placement, grounding and biome logic run identically, and
 * the real meshes appear wherever LFS objects resolve.
 * @module world/worldLandmarkScatter
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { sampleMapAridity01, sampleMapForest01 } from './worldReferenceBiomeField.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } from '../config.js';

const ASSET_ROOT = 'assets/models/settlements/';

/**
 * What goes where. `terrain` is checked against the owner map's own per-cell biome answer plus the
 * live height field, so an entry only lands in country the map agrees with.
 */
export const LANDMARK_CATALOGUE = Object.freeze([
	Object.freeze({ file: 'docks_F7twMHWPXY.glb', terrain: 'coast', footprintMeters: 14, weight: 3 }),
	Object.freeze({ file: 'greek_pillar_intact.glb', terrain: 'arid', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'greek_pillar_broken_half.glb', terrain: 'arid', footprintMeters: 5, weight: 2 }),
	Object.freeze({ file: 'greek_arch_single.glb', terrain: 'arid', footprintMeters: 9, weight: 1 }),
	Object.freeze({ file: 'greek_parthenon_base.glb', terrain: 'arid', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'big_barn_q1N3xn2SpC.glb', terrain: 'farmland', footprintMeters: 15, weight: 3 }),
	Object.freeze({ file: 'barn_0QTh_KUZRYE.glb', terrain: 'farmland', footprintMeters: 12, weight: 3 }),
	Object.freeze({ file: 'silo_house_ZgstejsAcN.glb', terrain: 'farmland', footprintMeters: 10, weight: 2 }),
	Object.freeze({ file: 'fantasy_stable_qhNQSOGGbi.glb', terrain: 'farmland', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'small_wooden_house.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'cabin_shed_HTx7PZt6Zm.glb', terrain: 'woodland', footprintMeters: 7, weight: 3 }),
	Object.freeze({ file: 'church_GHzPfvoyzX.glb', terrain: 'farmland', footprintMeters: 18, weight: 1 }),
	Object.freeze({ file: 'wall_segment_muro.glb', terrain: 'upland', footprintMeters: 10, weight: 2 }),
	Object.freeze({ file: 'barracks_UXCOwRBSxx.glb', terrain: 'upland', footprintMeters: 14, weight: 1 }),
]);

export const LANDMARK_SCATTER_POLICY = Object.freeze({
	id: 'world-landmark-scatter-2026-08-20-v1',
	/** How many landmarks to place across the scatter disc. Deliberately modest: these are landmarks,
	 * not settlement filler — `world/villages.js` already handles density around seats, and every one
	 * of these is a separate draw call. */
	targetCount: 64,
	/** Attempts per landmark before giving up on finding country that suits it. */
	maxAttempts: 24,
	/** Clearance kept from a kingdom seat, so a barn never lands inside a castle's flatten pad. */
	seatClearanceMeters: 160,
	/** Minimum spacing between two landmarks, so they read as scattered rather than clustered. */
	spacingMeters: 220,
	/** Height above sea below which ground counts as coast for the docks. */
	coastMaxHeightMeters: 9,
	/** Height above which ground counts as upland. */
	uplandMinHeightMeters: 240,
});

/** World X/Z to normalized owner-map coordinates — the same projection every canonical consumer uses. */
function normalizedMapPoint(worldX, worldZ) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	const nx = (worldX / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
	const ny = (worldZ / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
}

/**
 * Does this spot suit that kind of landmark?
 * @returns {boolean}
 */
function terrainSuits(kind, { heightAboveSea, forest, arid, nearWater }) {
	const P = LANDMARK_SCATTER_POLICY;
	switch (kind) {
		case 'coast': return nearWater && heightAboveSea > 0.5 && heightAboveSea < P.coastMaxHeightMeters;
		case 'arid': return arid > 0.35;
		case 'woodland': return forest > 0.45 && arid < 0.1;
		case 'farmland': return forest < 0.25 && arid < 0.12 && heightAboveSea > 12 && heightAboveSea < P.uplandMinHeightMeters;
		case 'upland': return heightAboveSea >= P.uplandMinHeightMeters && forest < 0.4;
		default: return false;
	}
}

/**
 * Chooses landmark placements. Pure geometry and sampling — no asset loading — so it can be tested and
 * measured without a browser asset pipeline.
 *
 * @param {object} options
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @param {number} options.seed
 * @param {number} options.radiusMeters Scatter disc, matching whatever terrain radius was loaded.
 * @param {{x: number, z: number}[]} options.seats
 * @returns {{file: string, x: number, z: number, y: number, footprintMeters: number, terrain: string, rotationY: number}[]}
 */
export function planLandmarkPlacements({ sampleHeightMeters, seed, radiusMeters, seats = [] }) {
	const P = LANDMARK_SCATTER_POLICY;
	const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;
	const rng = mulberry32(seed ^ 0x4c4d4b53); // "LMKS"
	const weighted = LANDMARK_CATALOGUE.flatMap((entry) => Array.from({ length: entry.weight }, () => entry));
	const placements = [];
	const seatClearanceSquared = P.seatClearanceMeters ** 2;
	const spacingSquared = P.spacingMeters ** 2;

	for (let index = 0; index < P.targetCount; index += 1) {
		const entry = weighted[Math.floor(rng() * weighted.length) % weighted.length];
		for (let attempt = 0; attempt < P.maxAttempts; attempt += 1) {
			const angle = rng() * Math.PI * 2;
			const radius = radiusMeters * Math.sqrt(rng());
			const x = Math.cos(angle) * radius;
			const z = Math.sin(angle) * radius;
			const height = sampleHeightMeters(x, z);
			if (height <= seaLevel) continue;

			const { nx, ny } = normalizedMapPoint(x, z);
			// "Near water" is asked of the height field rather than the coarse mask, so a dock lands on a
			// shore the player can actually see the sea from.
			const nearWater = [[70, 0], [-70, 0], [0, 70], [0, -70]]
				.some(([dx, dz]) => sampleHeightMeters(x + dx, z + dz) <= seaLevel);
			if (!terrainSuits(entry.terrain, {
				heightAboveSea: height - seaLevel,
				forest: sampleMapForest01(nx, ny),
				arid: sampleMapAridity01(nx, ny),
				nearWater,
			})) continue;

			if (seats.some((seat) => (x - seat.x) ** 2 + (z - seat.z) ** 2 < seatClearanceSquared)) continue;
			if (placements.some((other) => (x - other.x) ** 2 + (z - other.z) ** 2 < spacingSquared)) continue;

			placements.push({
				file: entry.file, x, z, y: height,
				footprintMeters: entry.footprintMeters, terrain: entry.terrain,
				rotationY: rng() * Math.PI * 2,
			});
			break;
		}
	}
	return placements;
}

/**
 * Loads and positions the planned landmarks.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {ReturnType<typeof planLandmarkPlacements>} options.placements
 * @returns {Promise<{group: THREE.Group, placedCount: number}>}
 */
export async function spawnWorldLandmarks({ assetLoader, placements }) {
	const group = new THREE.Group();
	group.name = 'world-landmarks';

	// Each distinct file is fetched and parsed once; repeats are `clone()`d, which shares geometry and
	// material by reference — the same reasoning `spawnRealCastleModels` documents.
	const loadedByFile = new Map();
	const loadOnce = (file, footprintMeters) => {
		if (!loadedByFile.has(file)) {
			loadedByFile.set(file, assetLoader.loadModel(ASSET_ROOT + file, {
				fallbackColor: 0x8a8578, fallbackSize: footprintMeters,
			}));
		}
		return loadedByFile.get(file);
	};

	const box = new THREE.Box3();
	const size = new THREE.Vector3();
	const loaded = await Promise.all(placements.map(async (placement) => ({
		placement, original: await loadOnce(placement.file, placement.footprintMeters),
	})));

	let placedCount = 0;
	for (const { placement, original } of loaded) {
		if (!original) continue;
		const model = original.clone(true);
		box.setFromObject(model);
		box.getSize(size);
		const largest = Math.max(size.x, size.z) || 1;
		const scale = placement.footprintMeters / largest;
		model.scale.setScalar(scale);
		// Re-measure after scaling so the model is seated on the ground rather than floating or sunk.
		box.setFromObject(model);
		model.position.set(placement.x, placement.y - box.min.y, placement.z);
		model.rotation.y = placement.rotationY;
		model.userData.worldLandmark = Object.freeze({ file: placement.file, terrain: placement.terrain });
		group.add(model);
		placedCount += 1;
	}
	return { group, placedCount };
}

/**
 * Plans and spawns the landmarks for a live scene, and logs what landed where.
 *
 * Exists so `game3d.js` spends two lines on this rather than sixteen — that file sits right against
 * the project's 600-line cap, and this block had just pushed it over.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {{scene: THREE.Scene, groundCollider: {getGroundHeight: (x: number, z: number) => number},
 *   settlementSeats: {x: number, z: number}[]}} options.state
 * @returns {Promise<THREE.Group>} The group, already added to `state.scene`.
 */
export async function initWorldLandmarks({ assetLoader, state }) {
	const placements = planLandmarkPlacements({
		sampleHeightMeters: state.groundCollider.getGroundHeight,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		radiusMeters: CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS * CHUNK_CONFIG.CHUNK_SIZE_METERS,
		seats: state.settlementSeats,
	});
	const { group, placedCount } = await spawnWorldLandmarks({ assetLoader, placements });
	state.scene.add(group);
	console.info(
		`[game3d] World landmarks: ${placedCount}/${placements.length} placed ` +
			`(${[...new Set(placements.map((placement) => placement.terrain))].join(', ')}).`,
	);
	return group;
}

/** Disposes a landmark group — same single-argument convention as every other `world/` disposer. */
export function disposeWorldLandmarks(group) {
	group.traverse((node) => {
		if (!node.isMesh) return;
		node.geometry?.dispose?.();
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) material?.dispose?.();
	});
}

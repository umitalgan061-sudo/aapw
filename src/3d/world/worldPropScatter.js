/**
 * World prop scatter — the whole model library, placed across the whole map.
 *
 * **What this replaces.** `world/worldLandmarkScatter.js` put fourteen hand-picked models in a disc
 * around the player, and `world/heroTrees.js` put ninety trees in a smaller disc. This places the
 * `world/worldPropCatalogue.js` catalogue — every model in `assets/` that belongs on the ground — over
 * the entire world, streamed by chunk as the player moves.
 *
 * **Why chunk-streamed rather than one pass.** The map is 27x21 chunks of 500 m. Placing the catalogue
 * everywhere at boot would mean thousands of separate meshes resident at once, each its own draw call,
 * for scenery almost all of which is beyond sight. So placement is *defined* for every chunk in the
 * world — deterministically, from the chunk's own coordinates — but only chunks within
 * `streamRadiusChunks` of the camera are built, and they are torn down as the player leaves. The world
 * is furnished everywhere; only the near part of it is resident.
 *
 * **Placement is a claim the map has to agree with.** A candidate point resolves to a biome from four
 * measured facts — height above sea, local slope, the owner map's forest coverage and its aridity — and
 * only entries that claim that biome are eligible. That is why a barn cannot appear in the Red Waste and
 * a palm cannot appear on the Wall. Points are also kept clear of open water, of kingdom seats (whose
 * flatten pads belong to the castles) and of ground too steep to build on.
 *
 * **"Dogru dokularla" — the textures.** A glTF's base-colour, emissive and specular textures are authored
 * in sRGB; its normal, roughness, metalness and AO maps are linear data. three.js will happily decode all
 * of them the same way, which is the usual reason imported props render washed out or too bright. Every
 * model loaded here goes through `normalisePropMaterials`, which sets the colour space per map role,
 * gives colour maps anisotropic filtering so they hold up at grazing angles, and turns on shadow casting
 * and receiving so a prop sits in the world's light instead of floating in it.
 *
 * **Placeholders are never planted.** `AssetLoader` returns a visible box when a file cannot be read, and
 * marks it `userData.isPlaceholder`. In a checkout without Git LFS objects every `.glb` is a 132-byte
 * pointer stub (RCA_RUN344), so planting those would carpet the world in boxes — strictly worse than
 * empty ground. Such models are discarded and the entry is skipped; where LFS resolves, the real models
 * appear. The placement, biome and grounding logic is identical either way.
 *
 * **Deterministic.** Every chunk seeds its own `mulberry32` from its coordinates, so a chunk's props are
 * the same however the player reached it, and streaming cannot perturb any other seeded generator.
 *
 * @module world/worldPropScatter
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { sampleMapAridity01, sampleMapForest01 } from './worldReferenceBiomeField.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { PROP_CATALOGUE_BY_BIOME, PROP_CATALOGUE_POLICY } from './worldPropCatalogue.js';
import { valyriaInfluence01 } from './worldReferenceValyria.js';
import { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } from '../config.js';

export const PROP_SCATTER_POLICY = Object.freeze({
	id: 'world-prop-scatter-2026-08-20-v1',
	/** Chunks either side of the camera's chunk that are built. 3 => a 7x7 block, 3.5 km across. */
	streamRadiusChunks: 3,
	/** Candidate points drawn per chunk. Most are rejected by biome, water, slope or spacing. */
	candidatesPerChunk: 20,
	/** Hard ceiling on props actually built per chunk, whatever the candidates allow. */
	maxPropsPerChunk: 6,
	/** Hard ceiling on live props across all resident chunks — a draw-call budget. */
	maxLiveProps: 220,
	/** Clearance from a kingdom seat: its flatten pad belongs to the castle, not to scenery. */
	seatClearanceMeters: 170,
	/** Ground steeper than this takes nothing built; trees and rocks still accept more. */
	maxBuildSlopeDegrees: 14,
	/** Ground steeper than this takes nothing at all. */
	maxAnySlopeDegrees: 34,
	/** Metres above sea below which ground counts as shoreline. */
	coastMaxHeightMeters: 9,
	/** Metres above sea above which ground counts as upland. */
	uplandMinHeightMeters: 240,
	/** Metres above sea above which ground counts as snowline. */
	snowlineMinHeightMeters: 470,
	/** Aridity above which the owner map calls this desert. */
	aridMinimum: 0.3,
	/** Forest coverage above which the owner map calls this woodland. */
	woodlandMinForest: 0.4,
	/** Forest coverage below which open country is meadow or farmland. */
	openMaxForest: 0.22,
	/**
	 * Band around a kingdom seat, in metres, where roadside clutter belongs.
	 *
	 * Barrels, crates, bonfires, benches and waymarks are not wilderness objects — they are things people
	 * leave beside the ways they travel. The roads of this world radiate from the fourteen seats, so the
	 * ring just outside a seat's own clearance is where its traffic passes. The inner edge is
	 * `seatClearanceMeters`, so this never intrudes on the castle's own pad.
	 *
	 * Added in run 370 because `scripts/checkWorldPropScatter.js` caught the catalogue declaring a
	 * `roadside` biome that `resolvePropBiome` never returned — eight entries that could not have
	 * appeared anywhere in the world.
	 */
	roadsideOuterMeters: 650,
	/** Valyrian influence above which the ground is barren — see `world/worldReferenceValyria.js`. The
	 * rim still takes scenery, so the Doom fades out rather than ending at a line. */
	valyriaBarrenAbove: 0.25,
});

const ASSET_ROOT = PROP_CATALOGUE_POLICY.assetRoot;
const SEA_LEVEL = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const CHUNK_METERS = CHUNK_CONFIG.CHUNK_SIZE_METERS;

/** World X/Z to normalized owner-map coordinates — the projection every canonical consumer uses. */
function normalizedMapPoint(worldX, worldZ) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	const nx = (worldX / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
	const ny = (worldZ / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
}

/**
 * Which country is this, per the owner map and the live height field?
 *
 * Ordered most specific first: snow and desert are climate facts that override how wooded a place is,
 * shoreline is decided by height, and only then does forest coverage separate woodland from open ground.
 *
 * @returns {string|null} A `PROP_BIOMES` name, or null if nothing should stand here.
 */
export function resolvePropBiome({ heightAboveSeaMeters, slopeDegrees, forest01, aridity01, nearSeatMeters = Infinity }) {
	const P = PROP_SCATTER_POLICY;
	if (heightAboveSeaMeters <= 0.5) return null;
	if (slopeDegrees > P.maxAnySlopeDegrees) return null;
	// Traffic first: within reach of a seat, on ground gentle enough to set a barrel down on, this is
	// roadside rather than whatever wilderness it would otherwise be.
	if (nearSeatMeters <= P.roadsideOuterMeters && slopeDegrees <= P.maxBuildSlopeDegrees) return 'roadside';
	if (heightAboveSeaMeters >= P.snowlineMinHeightMeters) return 'snowline';
	if (aridity01 > P.aridMinimum) return 'arid';
	if (heightAboveSeaMeters < P.coastMaxHeightMeters) return 'coast';
	if (heightAboveSeaMeters >= P.uplandMinHeightMeters) return 'upland';
	if (forest01 >= P.woodlandMinForest) return 'woodland';
	if (forest01 <= P.openMaxForest) return heightAboveSeaMeters > 60 ? 'farmland' : 'meadow';
	return 'woodland';
}

/** Biomes whose entries are buildings, and therefore need ground gentle enough to build on. */
const BUILT_BIOMES = new Set(['farmland', 'coast', 'upland', 'roadside']);

/**
 * Per-biome rotation arrays: every entry once, then extra copies by weight.
 *
 * **Why a rotation and not a random draw.** Both a weighted cumulative draw and rejection sampling were
 * tried and measured, and both leave part of the catalogue on the floor — 86.7% and 93.0% of entries
 * placed respectively, because in a biome with forty entries competing for seventy-five placements,
 * chance alone will never reach some of them. "Distribute all the models" is the requirement, so
 * coverage cannot be left to chance.
 *
 * Putting each entry in the array *once* first guarantees that stepping through it reaches every entry
 * within `entries.length` steps; appending `weight - 1` further copies afterwards keeps weight
 * meaningful, since a heavy entry still occupies more of the array overall. The step index is derived
 * from the chunk's own coordinates, so neighbouring chunks advance through the rotation and the whole
 * catalogue is walked across the map — while any single chunk remains a pure function of where it is.
 */
const BIOME_ROTATIONS = Object.freeze(Object.fromEntries(
	Object.entries(PROP_CATALOGUE_BY_BIOME).map(([biome, entries]) => {
		const rotation = entries.slice();
		for (const entry of entries) {
			for (let extra = 1; extra < entry.weight; extra += 1) rotation.push(entry);
		}
		return [biome, Object.freeze(rotation)];
	}),
));

/**
 * Picks one entry for a biome, by rotation.
 *
 * `ordinal` mixes the chunk's coordinates with the slot being filled, so successive placements — within
 * a chunk and across neighbouring chunks — step through the rotation rather than resampling it.
 */
function pickEntry(biome, chunkX, chunkZ, slot) {
	const rotation = BIOME_ROTATIONS[biome];
	if (!rotation || rotation.length === 0) return null;
	// A linear index over the chunk grid, so neighbouring chunks advance through the rotation instead of
	// landing on the same offset. The first attempt multiplied the chunkZ term by `rotation.length`,
	// which made it vanish under the modulo and left only chunkX varying — measured coverage fell to
	// 85.9%, worse than the random draw it replaced. The guard is what reported that.
	const linear = (chunkZ + 512) * 1024 + (chunkX + 512);
	const ordinal = Math.abs(linear * PROP_SCATTER_POLICY.maxPropsPerChunk + slot);
	return rotation[ordinal % rotation.length];
}

/** Deterministic per-chunk stream. Coordinates hashed so a chunk is identical however it was reached. */
function chunkRng(seed, chunkX, chunkZ) {
	return mulberry32((seed ^ Math.imul(chunkX, 73856093) ^ Math.imul(chunkZ, 19349663) ^ 0x50524f50) >>> 0);
}

function slopeDegreesAt(sampleHeightMeters, x, z, own) {
	const d = 6;
	const dx = (sampleHeightMeters(x + d, z) - sampleHeightMeters(x - d, z)) / (2 * d);
	const dz = (sampleHeightMeters(x, z + d) - sampleHeightMeters(x, z - d)) / (2 * d);
	return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
}

/**
 * Chooses one chunk's props. Pure sampling — no asset loading — so it is measurable without a browser
 * asset pipeline, which is what `scripts/checkWorldPropScatter.js` relies on.
 *
 * @param {object} options
 * @param {number} options.chunkX
 * @param {number} options.chunkZ
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @param {number} options.seed
 * @param {{x: number, z: number}[]} [options.seats]
 * @returns {{file: string, terrain: string, x: number, y: number, z: number, rotationY: number, scale: number, footprintMeters: number}[]}
 */
export function planChunkProps({ chunkX, chunkZ, sampleHeightMeters, seed, seats = [] }) {
	const P = PROP_SCATTER_POLICY;
	const rng = chunkRng(seed, chunkX, chunkZ);
	const originX = chunkX * CHUNK_METERS;
	const originZ = chunkZ * CHUNK_METERS;
	const seatClearanceSquared = P.seatClearanceMeters ** 2;
	const placed = [];

	for (let attempt = 0; attempt < P.candidatesPerChunk && placed.length < P.maxPropsPerChunk; attempt += 1) {
		const x = originX + (rng() - 0.5) * CHUNK_METERS;
		const z = originZ + (rng() - 0.5) * CHUNK_METERS;
		const height = sampleHeightMeters(x, z);
		const heightAboveSeaMeters = height - SEA_LEVEL;
		const slopeDegrees = slopeDegreesAt(sampleHeightMeters, x, z, height);
		let nearSeatMeters = Infinity;
		for (const seat of seats) {
			const distanceSquared = (x - seat.x) ** 2 + (z - seat.z) ** 2;
			if (distanceSquared < seatClearanceSquared) { nearSeatMeters = -1; break; }
			nearSeatMeters = Math.min(nearSeatMeters, Math.sqrt(distanceSquared));
		}
		// Inside a seat's clearance nothing is placed at all: that pad belongs to the castle.
		if (nearSeatMeters < 0) continue;
		const { nx, ny } = normalizedMapPoint(x, z);
		// Nothing has grown or stood in Valyria since the Doom. Barns, trees, statues and cattle all
		// belong to a living country; the Freehold's ruin is ash and slag. See `worldReferenceValyria.js`.
		if (valyriaInfluence01(nx, ny) > PROP_SCATTER_POLICY.valyriaBarrenAbove) continue;
		const biome = resolvePropBiome({
			heightAboveSeaMeters,
			slopeDegrees,
			forest01: sampleMapForest01(nx, ny),
			aridity01: sampleMapAridity01(nx, ny),
			nearSeatMeters,
		});
		if (!biome) continue;
		if (BUILT_BIOMES.has(biome) && slopeDegrees > P.maxBuildSlopeDegrees) continue;

		const chosen = pickEntry(biome, chunkX, chunkZ, placed.length);
		if (!chosen) continue;

		// Spacing: a church must not grow out of a barn, so each keeps its own footprint clear.
		const tooClose = placed.some((other) => {
			const clearance = (other.footprintMeters + chosen.footprintMeters) * 0.5;
			return (x - other.x) ** 2 + (z - other.z) ** 2 < clearance * clearance;
		});
		if (tooClose) continue;

		placed.push({
			file: chosen.file,
			terrain: biome,
			x,
			y: height,
			z,
			rotationY: rng() * Math.PI * 2,
			scale: 0.85 + rng() * 0.4,
			footprintMeters: chosen.footprintMeters,
		});
	}
	return placed;
}

/**
 * Puts an imported model's textures into the colour spaces glTF actually specifies.
 *
 * Base-colour, emissive and specular textures carry sRGB-encoded colour; normal, roughness, metalness
 * and AO maps carry linear data. Decoding the second group as sRGB — or the first as linear — is the
 * usual reason an imported prop looks washed out, too dark, or oddly lit. Shadow flags are set here too,
 * so a prop sits in the world's light rather than floating in it.
 *
 * @param {THREE.Object3D} model Mutated in place.
 * @returns {THREE.Object3D} `model`.
 */
export function normalisePropMaterials(model) {
	const COLOUR_MAPS = ['map', 'emissiveMap', 'specularMap'];
	const DATA_MAPS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'displacementMap', 'alphaMap'];
	model.traverse((node) => {
		if (!node.isMesh) return;
		node.castShadow = true;
		node.receiveShadow = true;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) {
			if (!material) continue;
			for (const key of COLOUR_MAPS) {
				const texture = material[key];
				if (!texture) continue;
				texture.colorSpace = THREE.SRGBColorSpace;
				texture.anisotropy = Math.max(texture.anisotropy ?? 1, 8);
				texture.needsUpdate = true;
			}
			for (const key of DATA_MAPS) {
				const texture = material[key];
				if (!texture) continue;
				texture.colorSpace = THREE.NoColorSpace;
				texture.needsUpdate = true;
			}
			material.needsUpdate = true;
		}
	});
	return model;
}

/**
 * Loads one catalogue model with the loader its file format actually needs.
 *
 * **This routed everything through `loadModel` — the glTF loader — until run 379.** `AssetLoader` has
 * two loaders and `loadModel` is glTF-only; handing it an `.fbx` throws, the catch swallowed it, and
 * the model was quietly treated as unreadable. **68 of the catalogue's 195 entries are FBX**, so a
 * third of the library the owner asked to see across the map could never appear no matter how well
 * the placement worked. The failure was invisible from every direction: the scatter reported the entry
 * as "never placed", which looks identical to a Git LFS stub, and this environment has 498 of those.
 *
 * FBX keeps its textures in sibling files rather than embedded, so it also needs `resourcePath` — the
 * directory the model came from — or it loads geometry with no maps on it.
 *
 * Exported so `world/villageBuildings.js` uses the same routing rather than a second copy that can
 * drift back into being glTF-only.
 *
 * @param {import('../assetLoader.js').AssetLoader} assetLoader
 * @param {Map<string, Promise<THREE.Object3D|null>>} cache Placeholders cache as `null`, so a stub is
 *   attempted once rather than on every chunk that wants it.
 * @param {string} file Path relative to `assets/models/`.
 * @returns {Promise<THREE.Object3D|null>}
 */
export async function loadPropModel(assetLoader, cache, file) {
	if (cache.has(file)) return cache.get(file);
	const url = ASSET_ROOT + file;
	const isFbx = /\.fbx$/i.test(file);
	const options = { fallbackColor: 0x8a8378, fallbackSize: 4 };
	const pending = (isFbx
		? assetLoader.loadFBXModel(url, { ...options, resourcePath: url.slice(0, url.lastIndexOf('/') + 1) })
		: assetLoader.loadModel(url, options)
	)
		.then((model) => {
			if (!model || model.userData?.isPlaceholder) return null;
			return normalisePropMaterials(model);
		})
		.catch(() => null);
	cache.set(file, pending);
	return pending;
}

const scratchBox = new THREE.Box3();
const scratchSize = new THREE.Vector3();

/** Builds one chunk's props into a group, or an empty group if none of its models are readable. */
async function buildChunkGroup({ assetLoader, cache, placements, liveBudget, sampleHeightMeters }) {
	const group = new THREE.Group();
	group.name = 'world-props-chunk';
	let built = 0;
	for (const placement of placements) {
		if (liveBudget.remaining <= 0) break;
		const source = await loadPropModel(assetLoader, cache, placement.file);
		if (!source) continue;
		const model = source.clone(true);
		scratchBox.setFromObject(model);
		scratchBox.getSize(scratchSize);
		// Scale so the model's footprint matches what the catalogue reserved for it, then ground it.
		const widest = Math.max(scratchSize.x, scratchSize.z) || 1;
		model.scale.setScalar((placement.footprintMeters / widest) * placement.scale);
		model.rotation.y = placement.rotationY;
		model.updateMatrixWorld(true);
		scratchBox.setFromObject(model);
		// Found the base on the lowest ground under the whole footprint, not just the centre — same fix
		// as `villageBuildings.groundModel`. A prop grounded at its centre height floats on a slope: its
		// downhill corner sits over lower ground with open air beneath it. Sampling the rotated box's
		// four corners and taking the minimum guarantees no corner floats. `placement.y` is the centre
		// height already, so it seeds the minimum without an extra sample there.
		scratchBox.getSize(scratchSize);
		const halfX = scratchSize.x * 0.5;
		const halfZ = scratchSize.z * 0.5;
		let lowestGroundY = placement.y;
		if (sampleHeightMeters) {
			for (const dx of [-halfX, halfX]) {
				for (const dz of [-halfZ, halfZ]) {
					const cornerY = sampleHeightMeters(placement.x + dx, placement.z + dz);
					if (cornerY < lowestGroundY) lowestGroundY = cornerY;
				}
			}
		}
		model.position.set(placement.x, lowestGroundY - scratchBox.min.y, placement.z);
		model.userData.worldProp = Object.freeze({ file: placement.file, terrain: placement.terrain });
		group.add(model);
		built += 1;
		liveBudget.remaining -= 1;
	}
	group.userData.builtCount = built;
	return group;
}

/** Disposes one chunk group's clones. Geometry and materials are shared with the cached source, so only
 * the clone wrappers are released here; the cache keeps the originals for the next chunk that wants them. */
function releaseChunkGroup(group) {
	group.parent?.remove(group);
	group.clear();
}

/**
 * Builds the streaming prop layer and adds it to the scene.
 *
 * Streaming is driven from a sentinel mesh's `onBeforeRender` — the same mechanism `world/windGrass.js`
 * uses — because it is the one hook that fires every frame without the game loop needing a new call site,
 * and `game3d.js` sits on the project's 600-line cap.
 *
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {object} options.state Needs `scene`, `camera`, `groundCollider`, `settlementSeats`.
 * @returns {Promise<THREE.Group>} The group, already added to `state.scene`.
 */
export async function initWorldProps({ assetLoader, state }) {
	const P = PROP_SCATTER_POLICY;
	const group = new THREE.Group();
	group.name = 'world-props';
	const cache = new Map();
	const resident = new Map();
	const liveBudget = { remaining: P.maxLiveProps };
	const sampleHeightMeters = state.groundCollider.getGroundHeight;
	const seats = state.settlementSeats ?? [];
	const seed = WORLD_DEFAULTS.WORLD_SEED;
	let streaming = false;
	let lastCell = null;

	const streamTo = async (cellX, cellZ) => {
		const wanted = new Set();
		for (let dz = -P.streamRadiusChunks; dz <= P.streamRadiusChunks; dz += 1) {
			for (let dx = -P.streamRadiusChunks; dx <= P.streamRadiusChunks; dx += 1) {
				wanted.add(`${cellX + dx},${cellZ + dz}`);
			}
		}
		for (const [key, chunkGroup] of resident) {
			if (wanted.has(key)) continue;
			liveBudget.remaining += chunkGroup.userData.builtCount ?? 0;
			releaseChunkGroup(chunkGroup);
			resident.delete(key);
		}
		for (const key of wanted) {
			if (resident.has(key)) continue;
			const [chunkX, chunkZ] = key.split(',').map(Number);
			const placements = planChunkProps({ chunkX, chunkZ, sampleHeightMeters, seed, seats });
			if (placements.length === 0) { resident.set(key, new THREE.Group()); continue; }
			const chunkGroup = await buildChunkGroup({ assetLoader, cache, placements, liveBudget, sampleHeightMeters });
			resident.set(key, chunkGroup);
			if (chunkGroup.children.length > 0) group.add(chunkGroup);
		}
		group.userData.worldProps = {
			residentChunks: resident.size,
			liveProps: P.maxLiveProps - liveBudget.remaining,
			loadedModels: cache.size,
		};
	};

	// Sentinel: never culled, so its onBeforeRender runs every frame and can follow the camera.
	const sentinel = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
	sentinel.name = 'world-props-stream-sentinel';
	sentinel.frustumCulled = false;
	sentinel.onBeforeRender = (_renderer, _scene, camera) => {
		if (streaming) return;
		const cellX = Math.round(camera.position.x / CHUNK_METERS);
		const cellZ = Math.round(camera.position.z / CHUNK_METERS);
		if (lastCell && lastCell.x === cellX && lastCell.z === cellZ) return;
		lastCell = { x: cellX, z: cellZ };
		streaming = true;
		streamTo(cellX, cellZ).finally(() => { streaming = false; });
	};
	group.add(sentinel);

	// Build the camera's own block before the loading overlay lifts, so the player never sees the world
	// furnish itself in front of them.
	const bootX = Math.round(state.camera.position.x / CHUNK_METERS);
	const bootZ = Math.round(state.camera.position.z / CHUNK_METERS);
	lastCell = { x: bootX, z: bootZ };
	await streamTo(bootX, bootZ);

	state.scene.add(group);
	const stats = group.userData.worldProps ?? { residentChunks: 0, liveProps: 0, loadedModels: 0 };
	console.info(
		stats.liveProps === 0
			? '[game3d] World props: none built — no catalogue model loaded (LFS pointer stubs?).'
			: `[game3d] World props: ${stats.liveProps} placed across ${stats.residentChunks} chunks from ${stats.loadedModels} model(s).`,
	);
	return group;
}

/** Disposes the prop layer — clones share the cache's geometry/materials, so this releases both. */
export function disposeWorldProps(group) {
	group.traverse((node) => {
		if (!node.isMesh) return;
		node.geometry?.dispose?.();
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) material?.dispose?.();
	});
	group.clear();
}

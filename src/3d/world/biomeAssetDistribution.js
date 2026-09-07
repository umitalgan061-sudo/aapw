/**
 * Canonical geography -> asset distribution policy.
 *
 * This module is intentionally data-first. It does not create meshes, mutate terrain height, or own
 * physics. It answers one question for world producers: given a canonical normalized map position,
 * what families of real/procedural assets belong there, how dense should they be, and which surfaces
 * should be preferred? The output is deterministic and can therefore be consumed by vegetation,
 * natural geology, villages, wildlife scenery, or future streaming systems without each system
 * inventing its own biome map.
 *
 * Source authority: worldReferenceMap.js. Spatial alignment authority: worldReferenceAlignment.js.
 * Material authority remains MaterialAssignmentCore.js. Placement authority remains
 * WorldAssetPlacementPipeline.js. This module deliberately does not duplicate any of those jobs.
 *
 * @module world/biomeAssetDistribution
 */

import {
	REFERENCE_BIOME_ZONES,
	REFERENCE_RELIEF_CHAINS,
	REFERENCE_WATER_ZONES,
	sampleReferenceInfluence,
} from './worldReferenceMap.js';

const VERSION = '2026-09-07-v1';
const MAP_SHA256 = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const MIN = 0;
const MAX = 1;
const EPSILON = 1e-9;

function clamp01(value) {
	return value < MIN ? MIN : value > MAX ? MAX : value;
}

function finite(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function normalizePoint(x, y) {
	const normalizedX = finite(Number(x), NaN);
	const normalizedY = finite(Number(y), NaN);
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
		throw new TypeError('canonical biome asset coordinates must be finite');
	}
	if (normalizedX < MIN || normalizedX > MAX || normalizedY < MIN || normalizedY > MAX) {
		throw new RangeError('canonical biome asset coordinates must be inside [0,1]');
	}
	return Object.freeze({ x: normalizedX, y: normalizedY });
}

function hashString(value) {
	let hash = 2166136261;
	const text = String(value ?? '');
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function mixSeed(seed, salt) {
	const left = hashString(seed);
	const right = hashString(salt);
	let value = (left ^ right ^ 0x9e3779b9) >>> 0;
	value = Math.imul(value ^ (value >>> 16), 2246822519) >>> 0;
	value = Math.imul(value ^ (value >>> 13), 3266489917) >>> 0;
	return (value ^ (value >>> 16)) >>> 0;
}

function deterministic01(seed, salt = '') {
	return mixSeed(seed, salt) / 0xffffffff;
}

function freezeArray(values) {
	return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

function profile(id, label, values) {
	return Object.freeze({ id, label, ...values });
}

const COMMON = Object.freeze({
	avoidRoadMeters: 10,
	avoidSeatMeters: 90,
	avoidWaterMeters: 1.5,
	maxSlopeDegrees: 45,
	assetTextureSize: 256,
	maxDrawDistanceMeters: 1300,
	minimumAssetScale: 0.72,
	maximumAssetScale: 1.38,
});

/**
 * Asset path candidates already present in the repository. A candidate can be marked visual-only,
 * fallback-only, or preferred. Producers should still perform their own hydration/readiness check.
 */
export const REPOSITORY_ASSET_CANDIDATES = Object.freeze({
	winterPine: 'assets/models/vegetation/pine_Zt62gceKXZ.glb',
	winterBare: 'assets/models/vegetation/winter_tree.glb',
	winterDeadSnow: 'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
	northCabin: 'assets/models/settlements/log_cabin_et0OmFeZVkb.glb',
	northShed: 'assets/models/settlements/cabin_shed_HTx7PZt6Zm.glb',
	fertileHouse: 'assets/models/settlements/fantasy_house_dcPho4SUA3.glb',
	fertileSmallHouse: 'assets/models/settlements/small_wooden_house.glb',
	aridHouse: 'assets/models/settlements/house_fdaqERLQCc.glb',
	aridHouseAlt: 'assets/models/settlements/house_roqiHdrpgc.glb',
	mountainHouse: 'assets/models/settlements/medium_house_4hI5fNvl6z.glb',
	blacksmith: 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
});

/**
 * The profiles intentionally separate visible ecology from gameplay ownership. `landCover` is what
 * should be seen, `scenery` is what can be scattered, `architecture` is what village generators may
 * request, and `geology` describes natural rock/ground props. No profile can alter height, route, water,
 * collider or settlement seat coordinates.
 */
export const BIOME_ASSET_PROFILES = Object.freeze({
	snow: profile('snow', 'Permanent winter / ice', {
		climateFamily: 'polar',
		landCover: Object.freeze({ primary: 'snow', secondary: 'tundra', wetland: 'frozen-shore', exposed: 'ice', minimumCoverage: 0.94 }),
		scatter: freezeArray([
			{ family: 'snow-pine', weight: 0.76, densityPerKm2: 18, scaleMin: 0.74, scaleMax: 1.24 },
			{ family: 'dead-snow-tree', weight: 0.18, densityPerKm2: 8, scaleMin: 0.76, scaleMax: 1.18 },
			{ family: 'snow-rock', weight: 0.06, densityPerKm2: 7, scaleMin: 0.85, scaleMax: 1.42 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.northCabin, weight: 0.72, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.northShed, weight: 0.28, role: 'secondary-shed' },
		]),
		geology: freezeArray([
			{ family: 'dark-granite-outcrop', weight: 0.58, densityPerKm2: 11 },
			{ family: 'moraine-boulder', weight: 0.32, densityPerKm2: 8 },
			{ family: 'ice-rubble', weight: 0.10, densityPerKm2: 6 },
		]),
		materialSignals: Object.freeze({ ground: 'snow-cold', rock: 'granite-shadow', wood: 'aged-pine', metal: 'weathered-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.08, snowCover: 1, exposedEarth: 0.02, windExposure: 0.82 }),
		microPatch: Object.freeze({ groveChance: 0.16, clearingChance: 0.22, rockPatchChance: 0.44, edgeSoftness: 0.06 }),
	}),

	coldGrassland: profile('coldGrassland', 'Northern cold grassland', {
		climateFamily: 'boreal-steppe',
		landCover: Object.freeze({ primary: 'cold-grass', secondary: 'heath', wetland: 'bog-edge', exposed: 'gravel', minimumCoverage: 0.48 }),
		scatter: freezeArray([
			{ family: 'snow-pine', weight: 0.44, densityPerKm2: 14, scaleMin: 0.72, scaleMax: 1.30 },
			{ family: 'pine', weight: 0.36, densityPerKm2: 12, scaleMin: 0.76, scaleMax: 1.38 },
			{ family: 'round-tree', weight: 0.12, densityPerKm2: 5, scaleMin: 0.78, scaleMax: 1.24 },
			{ family: 'low-shrub', weight: 0.08, densityPerKm2: 25, scaleMin: 0.66, scaleMax: 1.10 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.northCabin, weight: 0.68, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.northShed, weight: 0.32, role: 'secondary-shed' },
		]),
		geology: freezeArray([
			{ family: 'slate-outcrop', weight: 0.42, densityPerKm2: 8 },
			{ family: 'granite-boulder', weight: 0.34, densityPerKm2: 11 },
			{ family: 'heath-stone', weight: 0.24, densityPerKm2: 15 },
		]),
		materialSignals: Object.freeze({ ground: 'heath-green', rock: 'slate-cool', wood: 'aged-pine', metal: 'weathered-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.38, snowCover: 0.42, exposedEarth: 0.12, windExposure: 0.66 }),
		microPatch: Object.freeze({ groveChance: 0.22, clearingChance: 0.18, rockPatchChance: 0.30, edgeSoftness: 0.11 }),
	}),

	marsh: profile('marsh', 'Neck / marshland', {
		climateFamily: 'wet-boreal',
		landCover: Object.freeze({ primary: 'marsh-grass', secondary: 'reed', wetland: 'wet-soil', exposed: 'mud', minimumCoverage: 0.56 }),
		scatter: freezeArray([
			{ family: 'willow', weight: 0.42, densityPerKm2: 18, scaleMin: 0.70, scaleMax: 1.26 },
			{ family: 'birch', weight: 0.22, densityPerKm2: 10, scaleMin: 0.78, scaleMax: 1.30 },
			{ family: 'dead-marsh-tree', weight: 0.16, densityPerKm2: 7, scaleMin: 0.70, scaleMax: 1.18 },
			{ family: 'reed-clump', weight: 0.20, densityPerKm2: 46, scaleMin: 0.60, scaleMax: 1.12 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.northCabin, weight: 0.80, role: 'elevated-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.northShed, weight: 0.20, role: 'dry-storage' },
		]),
		geology: freezeArray([
			{ family: 'wet-boulder', weight: 0.30, densityPerKm2: 9 },
			{ family: 'root-wrapped-stone', weight: 0.44, densityPerKm2: 13 },
			{ family: 'mud-rubble', weight: 0.26, densityPerKm2: 22 },
		]),
		materialSignals: Object.freeze({ ground: 'wet-marsh', rock: 'basalt-wet', wood: 'water-darkened', metal: 'rusted-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.58, snowCover: 0.16, exposedEarth: 0.18, windExposure: 0.40 }),
		microPatch: Object.freeze({ groveChance: 0.31, clearingChance: 0.08, rockPatchChance: 0.12, edgeSoftness: 0.18 }),
	}),

	mountain: profile('mountain', 'Mountain slope / highland', {
		climateFamily: 'montane',
		landCover: Object.freeze({ primary: 'short-grass', secondary: 'heather', wetland: 'snow-pocket', exposed: 'rock', minimumCoverage: 0.24 }),
		scatter: freezeArray([
			{ family: 'mountain-pine', weight: 0.34, densityPerKm2: 11, scaleMin: 0.72, scaleMax: 1.32 },
			{ family: 'wind-bent-conifer', weight: 0.24, densityPerKm2: 8, scaleMin: 0.70, scaleMax: 1.20 },
			{ family: 'heather-shrub', weight: 0.16, densityPerKm2: 34, scaleMin: 0.56, scaleMax: 0.94 },
			{ family: 'alpine-boulder', weight: 0.26, densityPerKm2: 18, scaleMin: 0.76, scaleMax: 1.50 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.mountainHouse, weight: 0.70, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.northCabin, weight: 0.30, role: 'secondary-house' },
		]),
		geology: freezeArray([
			{ family: 'granite-talus', weight: 0.38, densityPerKm2: 14 },
			{ family: 'schist-slab', weight: 0.34, densityPerKm2: 12 },
			{ family: 'quartz-boulder', weight: 0.18, densityPerKm2: 6 },
			{ family: 'scree', weight: 0.10, densityPerKm2: 32 },
		]),
		materialSignals: Object.freeze({ ground: 'mountain-heath', rock: 'granite-sunlit', wood: 'mountain-pine', metal: 'dark-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.34, snowCover: 0.28, exposedEarth: 0.08, windExposure: 0.88 }),
		microPatch: Object.freeze({ groveChance: 0.15, clearingChance: 0.08, rockPatchChance: 0.52, edgeSoftness: 0.08 }),
	}),

	rockyHills: profile('rockyHills', 'Rocky western hills', {
		climateFamily: 'temperate-upland',
		landCover: Object.freeze({ primary: 'rough-grass', secondary: 'scrub', wetland: 'stream-edge', exposed: 'stone', minimumCoverage: 0.36 }),
		scatter: freezeArray([
			{ family: 'round-tree', weight: 0.36, densityPerKm2: 18, scaleMin: 0.76, scaleMax: 1.34 },
			{ family: 'thorn-tree', weight: 0.22, densityPerKm2: 12, scaleMin: 0.68, scaleMax: 1.18 },
			{ family: 'hedge', weight: 0.16, densityPerKm2: 34, scaleMin: 0.62, scaleMax: 1.00 },
			{ family: 'field-boulder', weight: 0.26, densityPerKm2: 16, scaleMin: 0.74, scaleMax: 1.44 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileHouse, weight: 0.58, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileSmallHouse, weight: 0.42, role: 'secondary-house' },
		]),
		geology: freezeArray([
			{ family: 'limestone-knoll', weight: 0.46, densityPerKm2: 10 },
			{ family: 'brown-sandstone', weight: 0.34, densityPerKm2: 8 },
			{ family: 'weathered-boulder', weight: 0.20, densityPerKm2: 14 },
		]),
		materialSignals: Object.freeze({ ground: 'dry-heather', rock: 'warm-granite', wood: 'weathered-oak', metal: 'aged-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.82, snowCover: 0.08, exposedEarth: 0.16, windExposure: 0.46 }),
		microPatch: Object.freeze({ groveChance: 0.28, clearingChance: 0.20, rockPatchChance: 0.26, edgeSoftness: 0.14 }),
	}),

	lush: profile('lush', 'Fertile / lush lowlands', {
		climateFamily: 'humid-temperate',
		landCover: Object.freeze({ primary: 'lush-meadow', secondary: 'broadleaf', wetland: 'river-meadow', exposed: 'dark-soil', minimumCoverage: 0.62 }),
		scatter: freezeArray([
			{ family: 'round-tree', weight: 0.38, densityPerKm2: 28, scaleMin: 0.80, scaleMax: 1.38 },
			{ family: 'oak', weight: 0.24, densityPerKm2: 18, scaleMin: 0.82, scaleMax: 1.44 },
			{ family: 'beech', weight: 0.14, densityPerKm2: 15, scaleMin: 0.80, scaleMax: 1.30 },
			{ family: 'field-shrub', weight: 0.12, densityPerKm2: 32, scaleMin: 0.62, scaleMax: 1.04 },
			{ family: 'grass-tuft', weight: 0.12, densityPerKm2: 95, scaleMin: 0.56, scaleMax: 1.10 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileHouse, weight: 0.64, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileSmallHouse, weight: 0.36, role: 'secondary-house' },
		]),
		geology: freezeArray([
			{ family: 'fieldstone', weight: 0.54, densityPerKm2: 9 },
			{ family: 'river-boulder', weight: 0.30, densityPerKm2: 12 },
			{ family: 'soil-exposure', weight: 0.16, densityPerKm2: 18 },
		]),
		materialSignals: Object.freeze({ ground: 'meadow-green', rock: 'granite-warm', wood: 'green-oak', metal: 'clean-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.94, snowCover: 0.03, exposedEarth: 0.09, windExposure: 0.32 }),
		microPatch: Object.freeze({ groveChance: 0.40, clearingChance: 0.12, rockPatchChance: 0.16, edgeSoftness: 0.22 }),
	}),

	desert: profile('desert', 'Southern desert', {
		climateFamily: 'hot-arid',
		landCover: Object.freeze({ primary: 'sand', secondary: 'scrub', wetland: 'oasis', exposed: 'dry-rock', minimumCoverage: 0.68 }),
		scatter: freezeArray([
			{ family: 'dry-shrub', weight: 0.44, densityPerKm2: 15, scaleMin: 0.58, scaleMax: 1.00 },
			{ family: 'thorn-tree', weight: 0.22, densityPerKm2: 5, scaleMin: 0.68, scaleMax: 1.16 },
			{ family: 'dead-tree', weight: 0.10, densityPerKm2: 4, scaleMin: 0.62, scaleMax: 1.06 },
			{ family: 'sand-rock', weight: 0.24, densityPerKm2: 18, scaleMin: 0.70, scaleMax: 1.36 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.aridHouse, weight: 0.62, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.aridHouseAlt, weight: 0.38, role: 'secondary-house' },
		]),
		geology: freezeArray([
			{ family: 'sandstone-slab', weight: 0.40, densityPerKm2: 10 },
			{ family: 'red-weathered-rock', weight: 0.34, densityPerKm2: 9 },
			{ family: 'desert-gravel', weight: 0.26, densityPerKm2: 38 },
		]),
		materialSignals: Object.freeze({ ground: 'warm-sand', rock: 'desert-ochre', wood: 'sun-bleached', metal: 'oxidized-copper' }),
		seasonal: Object.freeze({ foliageRetention: 0.16, snowCover: 0, exposedEarth: 0.48, windExposure: 0.72 }),
		microPatch: Object.freeze({ groveChance: 0.02, clearingChance: 0.54, rockPatchChance: 0.46, edgeSoftness: 0.05 }),
	}),

	steppe: profile('steppe', 'Dothraki / open steppe', {
		climateFamily: 'continental-steppe',
		landCover: Object.freeze({ primary: 'steppe-grass', secondary: 'dry-grass', wetland: 'seasonal-basin', exposed: 'dust', minimumCoverage: 0.70 }),
		scatter: freezeArray([
			{ family: 'short-grass-tuft', weight: 0.46, densityPerKm2: 130, scaleMin: 0.56, scaleMax: 1.04 },
			{ family: 'scattered-tree', weight: 0.12, densityPerKm2: 4, scaleMin: 0.72, scaleMax: 1.20 },
			{ family: 'dry-shrub', weight: 0.18, densityPerKm2: 14, scaleMin: 0.56, scaleMax: 1.00 },
			{ family: 'steppe-boulder', weight: 0.24, densityPerKm2: 12, scaleMin: 0.72, scaleMax: 1.34 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileSmallHouse, weight: 0.64, role: 'seasonal-shelter' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.northShed, weight: 0.36, role: 'storage' },
		]),
		geology: freezeArray([
			{ family: 'steppe-boulder', weight: 0.56, densityPerKm2: 10 },
			{ family: 'low-ridge-stone', weight: 0.20, densityPerKm2: 5 },
			{ family: 'dusty-rubble', weight: 0.24, densityPerKm2: 22 },
		]),
		materialSignals: Object.freeze({ ground: 'dry-gold', rock: 'sun-baked', wood: 'weathered-raw', metal: 'dull-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.45, snowCover: 0.10, exposedEarth: 0.22, windExposure: 0.78 }),
		microPatch: Object.freeze({ groveChance: 0.04, clearingChance: 0.58, rockPatchChance: 0.20, edgeSoftness: 0.04 }),
	}),

	arid: profile('arid', 'Red Waste / dry basin', {
		climateFamily: 'hot-dry-basin',
		landCover: Object.freeze({ primary: 'red-sand', secondary: 'dry-scrub', wetland: 'oasis', exposed: 'red-rock', minimumCoverage: 0.74 }),
		scatter: freezeArray([
			{ family: 'dry-shrub', weight: 0.38, densityPerKm2: 11, scaleMin: 0.58, scaleMax: 0.96 },
			{ family: 'thorn-tree', weight: 0.12, densityPerKm2: 3, scaleMin: 0.64, scaleMax: 1.06 },
			{ family: 'dead-tree', weight: 0.12, densityPerKm2: 3, scaleMin: 0.62, scaleMax: 1.08 },
			{ family: 'red-boulder', weight: 0.38, densityPerKm2: 21, scaleMin: 0.72, scaleMax: 1.38 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.aridHouseAlt, weight: 0.58, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.aridHouse, weight: 0.42, role: 'secondary-house' },
		]),
		geology: freezeArray([
			{ family: 'red-sandstone', weight: 0.52, densityPerKm2: 13 },
			{ family: 'iron-rich-outcrop', weight: 0.20, densityPerKm2: 7 },
			{ family: 'dry-basin-rubble', weight: 0.28, densityPerKm2: 26 },
		]),
		materialSignals: Object.freeze({ ground: 'red-sand', rock: 'iron-earth', wood: 'sun-baked', metal: 'dark-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.10, snowCover: 0, exposedEarth: 0.62, windExposure: 0.84 }),
		microPatch: Object.freeze({ groveChance: 0.01, clearingChance: 0.62, rockPatchChance: 0.58, edgeSoftness: 0.04 }),
	}),

	coast: profile('coast', 'Temperate coastal belt', {
		climateFamily: 'maritime-temperate',
		landCover: Object.freeze({ primary: 'coastal-grass', secondary: 'dune-scrub', wetland: 'salt-marsh', exposed: 'shore-rock', minimumCoverage: 0.58 }),
		scatter: freezeArray([
			{ family: 'wind-bent-tree', weight: 0.24, densityPerKm2: 12, scaleMin: 0.70, scaleMax: 1.22 },
			{ family: 'round-tree', weight: 0.24, densityPerKm2: 15, scaleMin: 0.76, scaleMax: 1.32 },
			{ family: 'coastal-shrub', weight: 0.22, densityPerKm2: 34, scaleMin: 0.60, scaleMax: 1.02 },
			{ family: 'shore-boulder', weight: 0.30, densityPerKm2: 24, scaleMin: 0.74, scaleMax: 1.46 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.northShed, weight: 0.54, role: 'coastal-shed' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileSmallHouse, weight: 0.46, role: 'coastal-house' },
		]),
		geology: freezeArray([
			{ family: 'shore-boulder', weight: 0.50, densityPerKm2: 16 },
			{ family: 'weathered-cliff-rock', weight: 0.28, densityPerKm2: 9 },
			{ family: 'dune-gravel', weight: 0.22, densityPerKm2: 28 },
		]),
		materialSignals: Object.freeze({ ground: 'salt-green', rock: 'coastal-grey', wood: 'salt-weathered', metal: 'rusted-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.72, snowCover: 0.05, exposedEarth: 0.17, windExposure: 0.74 }),
		microPatch: Object.freeze({ groveChance: 0.18, clearingChance: 0.24, rockPatchChance: 0.40, edgeSoftness: 0.16 }),
	}),

	temperate: profile('temperate', 'General temperate countryside', {
		climateFamily: 'temperate',
		landCover: Object.freeze({ primary: 'meadow', secondary: 'mixed-woodland', wetland: 'stream-edge', exposed: 'field-soil', minimumCoverage: 0.60 }),
		scatter: freezeArray([
			{ family: 'round-tree', weight: 0.36, densityPerKm2: 24, scaleMin: 0.78, scaleMax: 1.38 },
			{ family: 'oak', weight: 0.22, densityPerKm2: 15, scaleMin: 0.82, scaleMax: 1.42 },
			{ family: 'pine', weight: 0.14, densityPerKm2: 10, scaleMin: 0.72, scaleMax: 1.34 },
			{ family: 'field-shrub', weight: 0.12, densityPerKm2: 30, scaleMin: 0.62, scaleMax: 1.02 },
			{ family: 'grass-tuft', weight: 0.16, densityPerKm2: 78, scaleMin: 0.56, scaleMax: 1.06 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileHouse, weight: 0.48, role: 'primary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileSmallHouse, weight: 0.32, role: 'secondary-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.northCabin, weight: 0.20, role: 'outer-house' },
		]),
		geology: freezeArray([
			{ family: 'fieldstone', weight: 0.44, densityPerKm2: 7 },
			{ family: 'forest-boulder', weight: 0.30, densityPerKm2: 9 },
			{ family: 'stream-rock', weight: 0.26, densityPerKm2: 16 },
		]),
		materialSignals: Object.freeze({ ground: 'neutral-meadow', rock: 'mixed-granite', wood: 'mixed-hardwood', metal: 'aged-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.88, snowCover: 0.06, exposedEarth: 0.12, windExposure: 0.38 }),
		microPatch: Object.freeze({ groveChance: 0.34, clearingChance: 0.16, rockPatchChance: 0.18, edgeSoftness: 0.20 }),
	}),

	jungle: profile('jungle', 'Humid tropical / jungle', {
		climateFamily: 'humid-tropical',
		landCover: Object.freeze({ primary: 'jungle-floor', secondary: 'dense-canopy', wetland: 'swamp', exposed: 'laterite', minimumCoverage: 0.82 }),
		scatter: freezeArray([
			{ family: 'broadleaf-tall', weight: 0.34, densityPerKm2: 72, scaleMin: 0.78, scaleMax: 1.46 },
			{ family: 'broadleaf-round', weight: 0.22, densityPerKm2: 58, scaleMin: 0.74, scaleMax: 1.34 },
			{ family: 'palm', weight: 0.18, densityPerKm2: 28, scaleMin: 0.76, scaleMax: 1.36 },
			{ family: 'fern-clump', weight: 0.16, densityPerKm2: 120, scaleMin: 0.52, scaleMax: 1.00 },
			{ family: 'moss-boulder', weight: 0.10, densityPerKm2: 22, scaleMin: 0.76, scaleMax: 1.36 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.fertileSmallHouse, weight: 0.74, role: 'canopy-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.northShed, weight: 0.26, role: 'utility-shelter' },
		]),
		geology: freezeArray([
			{ family: 'moss-covered-boulder', weight: 0.46, densityPerKm2: 20 },
			{ family: 'laterite-outcrop', weight: 0.34, densityPerKm2: 11 },
			{ family: 'wet-dark-rock', weight: 0.20, densityPerKm2: 9 },
		]),
		materialSignals: Object.freeze({ ground: 'humid-green', rock: 'basalt-wet', wood: 'rain-darkened', metal: 'patina-bronze' }),
		seasonal: Object.freeze({ foliageRetention: 0.99, snowCover: 0, exposedEarth: 0.16, windExposure: 0.22 }),
		microPatch: Object.freeze({ groveChance: 0.62, clearingChance: 0.04, rockPatchChance: 0.10, edgeSoftness: 0.28 }),
	}),

	aridSteppe: profile('aridSteppe', 'Eastern dry steppe / badlands', {
		climateFamily: 'semi-arid-continental',
		landCover: Object.freeze({ primary: 'dry-steppe', secondary: 'thorn-scrub', wetland: 'dry-basin', exposed: 'dusty-rock', minimumCoverage: 0.76 }),
		scatter: freezeArray([
			{ family: 'thorn-tree', weight: 0.18, densityPerKm2: 6, scaleMin: 0.68, scaleMax: 1.16 },
			{ family: 'dry-shrub', weight: 0.34, densityPerKm2: 18, scaleMin: 0.56, scaleMax: 1.00 },
			{ family: 'steppe-grass-tuft', weight: 0.18, densityPerKm2: 72, scaleMin: 0.52, scaleMax: 0.98 },
			{ family: 'badlands-rock', weight: 0.30, densityPerKm2: 18, scaleMin: 0.72, scaleMax: 1.46 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.aridHouse, weight: 0.58, role: 'dry-house' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.aridHouseAlt, weight: 0.42, role: 'dry-house-alt' },
		]),
		geology: freezeArray([
			{ family: 'badlands-strata', weight: 0.44, densityPerKm2: 12 },
			{ family: 'iron-stone', weight: 0.24, densityPerKm2: 8 },
			{ family: 'dust-rubble', weight: 0.32, densityPerKm2: 29 },
		]),
		materialSignals: Object.freeze({ ground: 'dry-ochre', rock: 'iron-ochre', wood: 'sun-bleached', metal: 'oxidized-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.20, snowCover: 0, exposedEarth: 0.54, windExposure: 0.82 }),
		microPatch: Object.freeze({ groveChance: 0.03, clearingChance: 0.50, rockPatchChance: 0.48, edgeSoftness: 0.05 }),
	}),

	valyria: profile('valyria', 'Volcanic / scorched rock', {
		climateFamily: 'volcanic',
		landCover: Object.freeze({ primary: 'black-rock', secondary: 'ash-scrub', wetland: 'lava-depression', exposed: 'basalt', minimumCoverage: 0.86 }),
		scatter: freezeArray([
			{ family: 'ash-shrub', weight: 0.30, densityPerKm2: 7, scaleMin: 0.54, scaleMax: 0.94 },
			{ family: 'dead-black-tree', weight: 0.10, densityPerKm2: 2, scaleMin: 0.62, scaleMax: 1.00 },
			{ family: 'basalt-boulder', weight: 0.34, densityPerKm2: 25, scaleMin: 0.68, scaleMax: 1.44 },
			{ family: 'volcanic-spire', weight: 0.26, densityPerKm2: 8, scaleMin: 0.72, scaleMax: 1.58 },
		]),
		architecture: freezeArray([
			{ asset: REPOSITORY_ASSET_CANDIDATES.aridHouseAlt, weight: 0.66, role: 'volcanic-ruin-adjacent' },
			{ asset: REPOSITORY_ASSET_CANDIDATES.mountainHouse, weight: 0.34, role: 'stone-house' },
		]),
		geology: freezeArray([
			{ family: 'basalt-outcrop', weight: 0.50, densityPerKm2: 17 },
			{ family: 'obsidian-rock', weight: 0.18, densityPerKm2: 6 },
			{ family: 'lava-talus', weight: 0.32, densityPerKm2: 28 },
		]),
		materialSignals: Object.freeze({ ground: 'ash-black', rock: 'basalt-wet', wood: 'charred-timber', metal: 'dark-forged-iron' }),
		seasonal: Object.freeze({ foliageRetention: 0.05, snowCover: 0, exposedEarth: 0.82, windExposure: 0.90 }),
		microPatch: Object.freeze({ groveChance: 0.01, clearingChance: 0.72, rockPatchChance: 0.78, edgeSoftness: 0.02 }),
	}),
});

const KIND_TO_PROFILE = Object.freeze({
	snow: 'snow',
	'cold-grassland': 'coldGrassland',
	marsh: 'marsh',
	mountain: 'mountain',
	'rocky-hills': 'rockyHills',
	'lush-grassland': 'lush',
	desert: 'desert',
	steppe: 'steppe',
	arid: 'arid',
	jungle: 'jungle',
	'temperate-coast': 'coast',
});

const SPECIAL_REGION_RULES = Object.freeze([
	Object.freeze({ id: 'red-waste-relief', x: 0.66, y: 0.68, radius: 0.12, profile: 'arid', boost: 0.18 }),
	Object.freeze({ id: 'valyria-volcanic', x: 0.83, y: 0.86, radius: 0.13, profile: 'valyria', boost: 0.42 }),
	Object.freeze({ id: 'sothoryos-jungle', x: 0.555, y: 0.90, radius: 0.19, profile: 'jungle', boost: 0.22 }),
	Object.freeze({ id: 'ulthos-jungle', x: 0.925, y: 0.945, radius: 0.12, profile: 'jungle', boost: 0.24 }),
	Object.freeze({ id: 'grey-waste-dry-steppe', x: 0.925, y: 0.555, radius: 0.11, profile: 'aridSteppe', boost: 0.22 }),
]);

function radialSpecialInfluence(point, rule) {
	const dx = (point.x - rule.x) / rule.radius;
	const dy = (point.y - rule.y) / rule.radius;
	const d = Math.sqrt(dx * dx + dy * dy);
	if (d >= 1) return 0;
	const t = 1 - d;
	return t * t * (3 - 2 * t) * rule.boost;
}

function reliefInfluence(point) {
	let best = Object.freeze({ signal: 0, id: null });
	for (const chain of REFERENCE_RELIEF_CHAINS) {
		const points = chain.points;
		for (let i = 1; i < points.length; i += 1) {
			const [ax, ay] = points[i - 1];
			const [bx, by] = points[i];
			const abx = bx - ax;
			const aby = by - ay;
			const lengthSquared = abx * abx + aby * aby;
			const t = lengthSquared <= EPSILON
				? 0
				: clamp01(((point.x - ax) * abx + (point.y - ay) * aby) / lengthSquared);
			const px = ax + abx * t;
			const py = ay + aby * t;
			const distance = Math.hypot(point.x - px, point.y - py);
			const signal = clamp01(1 - distance / 0.10);
			if (signal > best.signal) best = Object.freeze({ signal, id: chain.id });
		}
	}
	return best;
}

function waterInfluence(point) {
	let best = Object.freeze({ signal: 0, id: null, kind: null });
	for (const zone of REFERENCE_WATER_ZONES) {
		const influence = sampleReferenceInfluence(point.x, point.y, zone);
		if (influence > best.signal) {
			best = Object.freeze({ signal: influence, id: zone.id, kind: zone.kind });
		}
	}
	return best;
}

function candidateProfiles(point) {
	const entries = [];
	for (const zone of REFERENCE_BIOME_ZONES) {
		const influence = sampleReferenceInfluence(point.x, point.y, zone);
		if (influence <= 0) continue;
		const profileId = KIND_TO_PROFILE[zone.kind] || 'temperate';
		entries.push({ profileId, zoneId: zone.id, influence, source: 'canonical-zone' });
	}
	for (const rule of SPECIAL_REGION_RULES) {
		const influence = radialSpecialInfluence(point, rule);
		if (influence <= 0) continue;
		entries.push({ profileId: rule.profile, zoneId: rule.id, influence, source: 'special-rule' });
	}
	return entries.sort((a, b) => b.influence - a.influence || a.profileId.localeCompare(b.profileId) || a.zoneId.localeCompare(b.zoneId));
}

function mergeProfileWeights(entries) {
	const merged = new Map();
	for (const entry of entries) merged.set(entry.profileId, (merged.get(entry.profileId) || 0) + entry.influence);
	return [...merged.entries()]
		.map(([profileId, influence]) => ({ profileId, influence }))
		.sort((a, b) => b.influence - a.influence || a.profileId.localeCompare(b.profileId));
}

function chooseProfile(point, water, relief) {
	const entries = candidateProfiles(point);
	const merged = mergeProfileWeights(entries);
	if (merged.length === 0) {
		return { profileId: water.signal >= 0.1 ? 'coast' : 'temperate', entries: merged };
	}
	let winner = merged[0];
	if (water.signal > 0.56 && winner.profileId !== 'marsh') {
		const coastCandidate = merged.find((entry) => entry.profileId === 'coast' || entry.profileId === 'marsh');
		if (coastCandidate && coastCandidate.influence + 0.12 >= winner.influence) winner = coastCandidate;
	}
	if (relief.signal > 0.72 && winner.profileId === 'coldGrassland') winner = { profileId: 'mountain', influence: winner.influence + 0.10 };
	return { profileId: winner.profileId, entries: merged };
}

function weightedPick(items, seed, salt) {
	const valid = items.filter((item) => Number.isFinite(item.weight) && item.weight > 0);
	if (valid.length === 0) return null;
	const total = valid.reduce((sum, item) => sum + item.weight, 0);
	let cursor = deterministic01(seed, salt) * total;
	for (const item of valid) {
		cursor -= item.weight;
		if (cursor <= 0) return item;
	}
	return valid[valid.length - 1];
}

function scaleForEntry(entry, seed, salt) {
	const min = finite(entry.scaleMin, COMMON.minimumAssetScale);
	const max = finite(entry.scaleMax, COMMON.maximumAssetScale);
	return min + (max - min) * deterministic01(seed, salt);
}

function densityMultiplier(profileData, point, water, relief) {
	let multiplier = 1;
	const cover = profileData.landCover;
	if (cover.primary === 'sand' || cover.primary === 'red-sand') multiplier *= 0.74;
	if (cover.primary === 'jungle-floor') multiplier *= 1.36;
	if (cover.primary === 'black-rock') multiplier *= 0.62;
	if (water.signal > 0.55) multiplier *= 0.64;
	if (relief.signal > 0.72) multiplier *= 0.76;
	if (point.y < 0.18 && profileData.climateFamily === 'polar') multiplier *= 0.82;
	return multiplier;
}

function architectureBias(profileData, role) {
	const candidates = profileData.architecture.filter((item) => !role || item.role === role);
	return candidates.length > 0 ? candidates : profileData.architecture;
}

function makeScatterSelection(profileData, seed, count, salt) {
	const selections = [];
	for (let i = 0; i < count; i += 1) {
		const pick = weightedPick(profileData.scatter, seed, `${salt}:scatter:${i}`);
		if (!pick) continue;
		selections.push(Object.freeze({
			family: pick.family,
			scale: Number(scaleForEntry(pick, seed, `${salt}:scale:${i}`).toFixed(4)),
			weight: pick.weight,
			baseDensityPerKm2: pick.densityPerKm2,
		}));
	}
	return Object.freeze(selections);
}

export const BIOME_ASSET_DISTRIBUTION_POLICY = Object.freeze({
	id: `biome-asset-distribution-${VERSION}`,
	version: VERSION,
	sourceMapSha256: MAP_SHA256,
	deterministic: true,
	renderSemanticOnly: true,
	common: COMMON,
	profileCount: Object.keys(BIOME_ASSET_PROFILES).length,
});

export function resolveBiomeAssetDistribution(normalizedX, normalizedY, seed = 0, options = {}) {
	const point = normalizePoint(normalizedX, normalizedY);
	const water = waterInfluence(point);
	const relief = reliefInfluence(point);
	const choice = chooseProfile(point, water, relief);
	const profileData = BIOME_ASSET_PROFILES[choice.profileId] || BIOME_ASSET_PROFILES.temperate;
	const safeSeed = mixSeed(seed, `${point.x.toFixed(6)}:${point.y.toFixed(6)}`);
	const multiplier = densityMultiplier(profileData, point, water, relief);
	const requestedScatterCount = Number.isInteger(options.sampleCount) ? Math.max(0, Math.min(24, options.sampleCount)) : 8;
	const scatter = makeScatterSelection(profileData, safeSeed, requestedScatterCount, profileData.id);
	const architectureRole = options.architectureRole || null;
	const architecture = weightedPick(architectureBias(profileData, architectureRole), safeSeed, 'architecture');
	const geology = weightedPick(profileData.geology, safeSeed, 'geology');
	const winnerInfluence = choice.entries[0]?.influence || 0;
	const runnerInfluence = choice.entries[1]?.influence || 0;
	const confidence = clamp01(winnerInfluence + Math.max(0, winnerInfluence - runnerInfluence) * 0.30);
	return Object.freeze({
		policyId: BIOME_ASSET_DISTRIBUTION_POLICY.id,
		point,
		seed: safeSeed,
		profileId: profileData.id,
		profileLabel: profileData.label,
		climateFamily: profileData.climateFamily,
		zoneCandidates: Object.freeze(choice.entries.map((entry) => Object.freeze({ ...entry }))),
		confidence: Number(confidence.toFixed(4)),
		water: Object.freeze({ ...water }),
		relief: Object.freeze({ ...relief }),
		densityMultiplier: Number(multiplier.toFixed(4)),
		landCover: profileData.landCover,
		seasonal: profileData.seasonal,
		microPatch: profileData.microPatch,
		materialSignals: profileData.materialSignals,
		scatter,
		architecture: architecture ? Object.freeze({ ...architecture, scale: Number(scaleForEntry(architecture, safeSeed, 'architecture-scale').toFixed(4)) }) : null,
		geology: geology ? Object.freeze({ ...geology, scale: Number(scaleForEntry(geology, safeSeed, 'geology-scale').toFixed(4)) }) : null,
		constraints: Object.freeze({ ...COMMON }),
	});
}

export function resolveBiomeAssetProfileForZone(zoneId) {
	const zone = REFERENCE_BIOME_ZONES.find((entry) => entry.id === zoneId);
	if (!zone) return null;
	const profileId = KIND_TO_PROFILE[zone.kind] || 'temperate';
	return BIOME_ASSET_PROFILES[profileId] || BIOME_ASSET_PROFILES.temperate;
}

export function listBiomeAssetFamilies(profileId = null) {
	const profiles = profileId ? [BIOME_ASSET_PROFILES[profileId]].filter(Boolean) : Object.values(BIOME_ASSET_PROFILES);
	const result = new Set();
	for (const profileData of profiles) {
		for (const item of profileData.scatter) result.add(item.family);
		for (const item of profileData.geology) result.add(item.family);
	}
	return Object.freeze([...result].sort());
}

export function selectRegionalArchitectureAsset(profileId, seed = 0, role = null) {
	const profileData = BIOME_ASSET_PROFILES[profileId];
	if (!profileData) return null;
	const choice = weightedPick(architectureBias(profileData, role), seed, `architecture:${role || 'any'}`);
	return choice ? Object.freeze({ ...choice }) : null;
}

export function computeBiomeDensityPerKm2(profileId, baseDensityPerKm2, normalizedX, normalizedY) {
	const point = normalizePoint(normalizedX, normalizedY);
	const profileData = BIOME_ASSET_PROFILES[profileId];
	if (!profileData) throw new RangeError(`unknown biome profile: ${profileId}`);
	const water = waterInfluence(point);
	const relief = reliefInfluence(point);
	return Number((Math.max(0, finite(baseDensityPerKm2)) * densityMultiplier(profileData, point, water, relief)).toFixed(3));
}

export function classifySurfaceRole(profileId, role) {
	const profileData = BIOME_ASSET_PROFILES[profileId];
	if (!profileData) return null;
	const normalizedRole = String(role || '').toLowerCase();
	if (normalizedRole.includes('roof')) return profileData.materialSignals.wood;
	if (normalizedRole.includes('rock')) return profileData.materialSignals.rock;
	if (normalizedRole.includes('ground') || normalizedRole.includes('floor')) return profileData.materialSignals.ground;
	if (normalizedRole.includes('metal')) return profileData.materialSignals.metal;
	return null;
}

export function sampleAssetScale(profileId, family, seed = 0) {
	const profileData = BIOME_ASSET_PROFILES[profileId];
	if (!profileData) return null;
	const source = profileData.scatter.find((item) => item.family === family);
	if (!source) return null;
	return Number(scaleForEntry(source, seed, `scale:${family}`).toFixed(4));
}

export function auditBiomeDistributionContract() {
	const errors = [];
	if (BIOME_ASSET_DISTRIBUTION_POLICY.sourceMapSha256 !== MAP_SHA256) errors.push('map-sha-mismatch');
	if (!BIOME_ASSET_DISTRIBUTION_POLICY.deterministic) errors.push('policy-not-deterministic');
	for (const [id, profileData] of Object.entries(BIOME_ASSET_PROFILES)) {
		if (!profileData.label) errors.push(`${id}:missing-label`);
		if (!profileData.climateFamily) errors.push(`${id}:missing-climate-family`);
		if (!Array.isArray(profileData.scatter) || profileData.scatter.length === 0) errors.push(`${id}:missing-scatter`);
		if (!Array.isArray(profileData.geology) || profileData.geology.length === 0) errors.push(`${id}:missing-geology`);
		if (!Array.isArray(profileData.architecture) || profileData.architecture.length === 0) errors.push(`${id}:missing-architecture`);
		const weightSum = profileData.scatter.reduce((sum, item) => sum + finite(item.weight), 0);
		if (!(weightSum > 0)) errors.push(`${id}:scatter-weight-sum`);
		for (const item of profileData.scatter) {
			if (!(finite(item.densityPerKm2) >= 0)) errors.push(`${id}:${item.family}:density`);
			if (finite(item.scaleMin) <= 0 || finite(item.scaleMax) < finite(item.scaleMin)) errors.push(`${id}:${item.family}:scale-range`);
		}
	}
	const zoneCoverage = REFERENCE_BIOME_ZONES.map((zone) => {
		const sample = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'audit', { sampleCount: 2 });
		return { zoneId: zone.id, profileId: sample.profileId, confidence: sample.confidence };
	});
	return Object.freeze({
		ok: errors.length === 0,
		errors: Object.freeze(errors),
		zoneCoverage: Object.freeze(zoneCoverage.map((item) => Object.freeze(item))),
		profileCount: Object.keys(BIOME_ASSET_PROFILES).length,
		assetFamilyCount: listBiomeAssetFamilies().length,
	});
}

export function mapAssetDistributionToWorldXZ(normalizedX, normalizedY, mapBounds, metersPerMapUnit) {
	const point = normalizePoint(normalizedX, normalizedY);
	if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
		throw new TypeError('map bounds are required');
	}
	if (!Number.isFinite(metersPerMapUnit) || metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be positive');
	const mapX = mapBounds.minX + point.x * (mapBounds.maxX - mapBounds.minX);
	const mapY = mapBounds.minY + point.y * (mapBounds.maxY - mapBounds.minY);
	return Object.freeze({
		x: (mapX - (mapBounds.minX + mapBounds.maxX) * 0.5) * metersPerMapUnit,
		z: (mapY - (mapBounds.minY + mapBounds.maxY) * 0.5) * metersPerMapUnit,
	});
}

export function assertBiomeDistributionConsistency(context) {
	if (!context || typeof context !== 'object') throw new TypeError('distribution context is required');
	if (context.policyId !== BIOME_ASSET_DISTRIBUTION_POLICY.id) throw new Error('biome distribution policy mismatch');
	if (!BIOME_ASSET_PROFILES[context.profileId]) throw new Error(`unknown distribution profile: ${context.profileId}`);
	if (!Number.isFinite(context.confidence) || context.confidence < 0 || context.confidence > 1) throw new Error('distribution confidence outside [0,1]');
	if (!Number.isFinite(context.densityMultiplier) || context.densityMultiplier < 0) throw new Error('distribution density multiplier invalid');
	return true;
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	TERRAIN_FACIES_POLICY,
	TERRAIN_FACIES_NAMES,
	resolveTerrainSurfaceFacies,
	resolveTerrainSurfaceMaterialResponse,
	createTerrainFaciesDiagnostics,
} from '../src/3d/world/terrainSurfaceFacies.js';
import {
	TERRAIN_TRANSITION_POLICY,
	transitionNoise,
	transitionFbm,
	resolveShoreTransition,
	resolveCryosphereTransition,
	resolveVegetationEdgeTransition,
	resolveFullTransitionSample,
} from '../src/3d/world/terrainSurfaceTransitionField.js';
import {
	TERRAIN_ROCK_FABRIC_POLICY,
	resolveTerrainRockFabric,
	resolveRockMaterialResponse,
} from '../src/3d/world/terrainSurfaceRockFabric.js';
import {
	TERRAIN_LOWINLAND_FABRIC_POLICY,
	resolveTerrainLowlandFabric,
	resolveTerrainLowlandMaterialResponse,
} from '../src/3d/world/terrainSurfaceLowlandFabric.js';
import {
	TERRAIN_CRYOSPHERE_POLICY,
	resolveTerrainCryosphere,
	resolveCryosphereMaterialResponse,
} from '../src/3d/world/terrainSurfaceCryosphere.js';
import {
	TERRAIN_EROSION_FIELD_POLICY,
	resolveTerrainErosionField,
	resolveTerrainErosionResponse,
} from '../src/3d/world/terrainSurfaceErosionField.js';
import { TERRAIN_MICRO_SURFACE_POLICY } from '../src/3d/world/terrainMicroSurface.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function nearlyEqual(a, b, epsilon = 1e-12) {
	return Math.abs(a - b) <= epsilon;
}
function assertDeterministic(label, factory) {
	const first = factory();
	const second = factory();
	assert.deepEqual(second, first, `${label} must be deterministic`);
}
function assertBounded(label, value, min = 0, max = 1) {
	assert(Number.isFinite(value), `${label} must be finite`);
	assert(value >= min - 1e-9, `${label} must be >= ${min}: ${value}`);
	assert(value <= max + 1e-9, `${label} must be <= ${max}: ${value}`);
}
function makeBaseSample(overrides = {}) {
	return {
		worldX: 1420,
		worldZ: -880,
		heightMeters: 82,
		slopeDegrees: 8,
		coastHeightMeters: 61,
		color: { r: 0.18, g: 0.29, b: 0.12 },
		canonicalSnow: 0,
		northness: 0.1,
		...overrides,
	};
}

function testNoiseField() {
	for (const [x, z] of [[0, 0], [12.5, -81], [1134, 990], [-4500, 7500], [9281.25, -4102.75]]) {
		const value = transitionNoise(x, z, 74, 0x31a9);
		assertBounded('transition noise', value);
		assertDeterministic(`transition noise ${x},${z}`, () => transitionNoise(x, z, 74, 0x31a9));
	}
	for (const [scales, seed] of [[[640, 220, 74, 22], 0x51cf], [[820, 310, 94], 0x9921], [[680, 240, 68], 0x46d7]]) {
		assertBounded('transition fbm', transitionFbm(1725, -889, scales, seed));
	}
}

function testPolicyContracts() {
	for (const [name, policy] of [
		['facies', TERRAIN_FACIES_POLICY],
		['transitions', TERRAIN_TRANSITION_POLICY],
		['rock fabric', TERRAIN_ROCK_FABRIC_POLICY],
		['lowland fabric', TERRAIN_LOWINLAND_FABRIC_POLICY],
		['cryosphere', TERRAIN_CRYOSPHERE_POLICY],
		['erosion', TERRAIN_EROSION_FIELD_POLICY],
	]) {
		assert.equal(policy.renderOnly, true, `${name} must be render-only`);
		assert.equal(policy.deterministic, true, `${name} must be deterministic`);
		assert.equal(policy.canonicalHeightUnchanged, true, `${name} must not alter canonical height`);
		assert.equal(policy.canonicalHydrologyUnchanged, true, `${name} must not alter canonical hydrology`);
		assert.equal(policy.canonicalColliderUnchanged, true, `${name} must not alter colliders`);
		assert.equal(policy.newGeographyIntroduced, false, `${name} must not introduce geography`);
	}
	assert.equal(TERRAIN_TRANSITION_POLICY.canonicalWaterGeometryUnchanged, true);
	assert.equal(TERRAIN_TRANSITION_POLICY.canonicalIceGeometryUnchanged, true);
	assert.equal(TERRAIN_EROSION_FIELD_POLICY.canonicalRoadsUnchanged, true);
	assert.equal(TERRAIN_CRYOSPHERE_POLICY.canonicalIceGeometryUnchanged, true);
	assert.equal(TERRAIN_FACIES_POLICY.faciesCount, TERRAIN_FACIES_NAMES.length);
	assert.deepEqual(TERRAIN_MICRO_SURFACE_POLICY.worldSpaceMacroScaleMeters, [38, 92, 240, 620, 1450, 3200]);
	assert.deepEqual(TERRAIN_MICRO_SURFACE_POLICY.snowSurfaceScaleMeters, [2.6, 11, 34]);
	assert.equal(TERRAIN_MICRO_SURFACE_POLICY.uvChannel, 1);
}

function testFaciesDeterminismAndWeights() {
	const samples = [
		makeBaseSample(),
		makeBaseSample({ slopeDegrees: 33, heightMeters: 160, coastHeightMeters: 140, color: { r: 0.33, g: 0.33, b: 0.31 } }),
		makeBaseSample({ slopeDegrees: 41, heightMeters: 460, coastHeightMeters: 320, color: { r: 0.62, g: 0.68, b: 0.71 }, canonicalSnow: 0.8, northness: 0.7 }),
		makeBaseSample({ slopeDegrees: 14, heightMeters: 16, coastHeightMeters: 1.8, color: { r: 0.30, g: 0.34, b: 0.23 } }),
	];
	for (const sample of samples) {
		const facies = resolveTerrainSurfaceFacies(sample);
		assertDeterministic('facies sample', () => resolveTerrainSurfaceFacies(sample));
		const sum = facies.weights.reduce((a, b) => a + b, 0);
		assert(nearlyEqual(sum, 1, 1e-10), `facies weights must sum to 1: ${sum}`);
		facies.weights.forEach((value, index) => assertBounded(`${TERRAIN_FACIES_NAMES[index]} weight`, value));
		assert.equal(TERRAIN_FACIES_NAMES[facies.dominantIndex], facies.dominant);
		for (const key of ['moisture', 'drought', 'coastal', 'saltSpray', 'snow']) assertBounded(key, facies[key]);
		const response = resolveTerrainSurfaceMaterialResponse({ facies, baseColor: sample.color, heightMeters: sample.heightMeters, slopeDegrees: sample.slopeDegrees, coastHeightMeters: sample.coastHeightMeters });
		assertBounded('facies response roughness', response.roughness);
		assertBounded('facies response normal', response.normalStrength);
	}
}

function testTransitionBoundaries() {
	const beach = resolveShoreTransition({ worldX: 10, worldZ: 20, coastHeightMeters: 1.0, slopeDegrees: 4 });
	const upland = resolveShoreTransition({ worldX: 10, worldZ: 20, coastHeightMeters: 80, slopeDegrees: 4 });
	assert(beach.stain > upland.stain, 'shoreline stain must fade inland');
	assert(beach.intertidal > upland.intertidal, 'intertidal response must fade inland');
	assert(beach.alluvialWash >= upland.alluvialWash, 'alluvial wash must decay inland');
	assertBounded('beach wetness', beach.wetness);
	const steepSnow = resolveCryosphereTransition({ worldX: 50, worldZ: 80, heightMeters: 480, slopeDegrees: 39, northness: 0.7, baseSnow: 0.4 });
	const lowPlain = resolveCryosphereTransition({ worldX: 50, worldZ: 80, heightMeters: 60, slopeDegrees: 4, northness: -0.2, baseSnow: 0 });
	assert(steepSnow.snow > lowPlain.snow, 'cryosphere response must be height-aware');
	assert(steepSnow.scour > lowPlain.scour, 'snow scour must respond to steep terrain');
	assertBounded('snow deposition', steepSnow.deposition);
	const wetSlope = resolveVegetationEdgeTransition({ worldX: 55, worldZ: 92, heightMeters: 72, slopeDegrees: 7, moisture: 0.78, vegetationSignal: 0.82 });
	const dryCliff = resolveVegetationEdgeTransition({ worldX: 55, worldZ: 92, heightMeters: 260, slopeDegrees: 41, moisture: 0.23, vegetationSignal: 0.82 });
	assert(wetSlope.meadow > dryCliff.meadow, 'wet lowland should retain meadow continuity');
	assert(dryCliff.stress > wetSlope.stress, 'steep dry terrain must stress vegetation');
}

function testRockFabric() {
	const sample = { worldX: -220, worldZ: 915, heightMeters: 420, slopeDegrees: 41, moisture: 0.34, northness: -0.12 };
	const fabric = resolveTerrainRockFabric(sample);
	assertDeterministic('rock fabric', () => resolveTerrainRockFabric(sample));
	for (const key of ['rockExposure', 'cliff', 'scree', 'fractures', 'bedding', 'runoffStain', 'fractureExposure', 'screeCoverage']) assertBounded(`rock ${key}`, fabric[key]);
	const response = resolveRockMaterialResponse({ fabric, baseColor: { r: 0.31, g: 0.30, b: 0.28 } });
	assertBounded('rock roughness', response.roughness);
	assertBounded('rock normal', response.normalStrength);
	assert(response.roughness >= 0.70, 'weathered rock must remain in a coarse roughness family');
}

function testLowlandFabric() {
	const plain = { worldX: 920, worldZ: 320, heightMeters: 44, slopeDegrees: 5, moisture: 0.76 };
	const ridge = { ...plain, heightMeters: 190, slopeDegrees: 22, moisture: 0.28 };
	const low = resolveTerrainLowlandFabric(plain);
	const high = resolveTerrainLowlandFabric(ridge);
	assert(low.lowland > high.lowland, 'lowland fabric must fade toward higher/steeper terrain');
	assertDeterministic('lowland field', () => resolveTerrainLowlandFabric(plain));
	for (const key of ['lowland', 'wetSwale', 'dryBench', 'alluvialRibbon', 'soilAggregate', 'mineralLag']) assertBounded(`lowland ${key}`, low[key]);
	const response = resolveTerrainLowlandMaterialResponse({ fabric: low, baseColor: { r: 0.25, g: 0.35, b: 0.16 } });
	assertBounded('lowland roughness', response.roughness);
}

function testCryosphereFabric() {
	const snow = resolveTerrainCryosphere({ worldX: 420, worldZ: -770, heightMeters: 520, slopeDegrees: 36, northness: 0.66, snowSignal: 0.74 });
	const plain = resolveTerrainCryosphere({ worldX: 420, worldZ: -770, heightMeters: 80, slopeDegrees: 3, northness: -0.1, snowSignal: 0 });
	assert(snow.snow > plain.snow, 'cryosphere snow coverage must be higher at high elevation');
	assert(snow.scour > plain.scour, 'snow scour must be stronger on steep high terrain');
	for (const key of ['snow', 'scour', 'deposition', 'crustMask', 'granular', 'exposedSubstrate']) assertBounded(`cryosphere ${key}`, snow[key]);
	const response = resolveCryosphereMaterialResponse({ state: snow, baseColor: { r: 0.69, g: 0.74, b: 0.77 } });
	assertBounded('cryosphere roughness', response.roughness);
	assertBounded('cryosphere normal', response.normalStrength);
}

function testErosionField() {
	const wetSlope = resolveTerrainErosionField({ worldX: 710, worldZ: -410, heightMeters: 155, slopeDegrees: 31, moisture: 0.82, vegetationSignal: 0.22, aspect: 0.68 });
	const dryPlain = resolveTerrainErosionField({ worldX: 710, worldZ: -410, heightMeters: 28, slopeDegrees: 4, moisture: 0.20, vegetationSignal: 0.35, aspect: 0.68 });
	assert(wetSlope.rillEnergy > dryPlain.rillEnergy, 'steep wet terrain must show stronger runoff/rills');
	assert(dryPlain.deposition > 0, 'gentle terrain must retain depositional response');
	for (const key of ['runoffEnergy', 'rillEnergy', 'channelStain', 'deposition', 'soilSealing', 'weathering', 'aeolianDust']) assertBounded(`erosion ${key}`, wetSlope[key]);
	assertDeterministic('erosion field', () => resolveTerrainErosionField({ worldX: 710, worldZ: -410, heightMeters: 155, slopeDegrees: 31, moisture: 0.82, vegetationSignal: 0.22, aspect: 0.68 }));
	const response = resolveTerrainErosionResponse({ field: wetSlope, baseColor: { r: 0.29, g: 0.31, b: 0.22 } });
	assertBounded('erosion roughness', response.roughness);
	assertBounded('erosion normal', response.normalStrength);
}

function testTransitionPurity() {
	const sample = resolveFullTransitionSample({ worldX: 7, worldZ: 9, coastHeightMeters: 3, heightMeters: 340, slopeDegrees: 29, northness: 0.4, vegetationSignal: 0.72, moisture: 0.61 });
	assertBounded('full shore wetness', sample.shore.wetness);
	assertBounded('full cryosphere snow', sample.cryosphere.snow);
	assertBounded('full vegetation stress', sample.vegetation.stress);
}

function testDiagnostics() {
	const diagnostic = createTerrainFaciesDiagnostics(makeBaseSample({ heightMeters: 280, slopeDegrees: 29, coastHeightMeters: 72 }));
	assert.equal(diagnostic.policyId, TERRAIN_FACIES_POLICY.id);
	assert.equal(diagnostic.canonicalHeightUnchanged, true);
	assert.equal(diagnostic.canonicalHydrologyUnchanged, true);
	assert.equal(diagnostic.canonicalColliderUnchanged, true);
	assertBounded('diagnostic nonuniformity', diagnostic.nonUniformity);
	assert(diagnostic.roughness >= TERRAIN_FACIES_POLICY.roughnessRange[0]);
	assert(diagnostic.roughness <= TERRAIN_FACIES_POLICY.roughnessRange[1]);
}

async function testStaticProductionWiring() {
	const microSurface = await fs.readFile(path.join(repoRoot, 'src/3d/world/terrainMicroSurface.js'), 'utf8');
	const rockFabric = await fs.readFile(path.join(repoRoot, 'src/3d/world/terrainSurfaceRockFabric.js'), 'utf8');
	const expectedImports = [
		"from './terrainSurfaceFacies.js'",
		"from './terrainSurfaceTransitionField.js'",
		"from './terrainSurfaceRockFabric.js'",
		"from './terrainSurfaceLowlandFabric.js'",
		"from './terrainSurfaceCryosphere.js'",
	];
	for (const text of expectedImports) assert(microSurface.includes(text), `terrainMicroSurface missing import: ${text}`);
	for (const text of [
		'installTerrainSurfaceFacies(material)',
		'installTerrainTransitionField(material)',
		'installTerrainRockFabric(material)',
		'installTerrainLowlandFabric(material)',
		'installTerrainCryosphere(material)',
	]) assert(microSurface.includes(text), `terrainMicroSurface missing install: ${text}`);
	for (const text of [
		"from './terrainSurfaceErosionField.js'",
		'installTerrainErosionField(material)',
		'erosionalRunoffWired: true',
	]) assert(rockFabric.includes(text), `rock fabric missing erosion wiring: ${text}`);
	for (const text of [
		'canonicalHeightUnchanged: true',
		'canonicalHydrologyUnchanged: true',
		'canonicalColliderUnchanged: true',
		'newGeographyIntroduced: false',
		'snowGranularAlbedo: true',
		'coastalSaltSprayWeathering: true',
		'terrainLowlandFabricPolicyId:',
		'terrainCryospherePolicyId:',
	]) assert(microSurface.includes(text), `terrainMicroSurface metadata missing: ${text}`);
	for (const pathName of [
		'src/3d/world/terrainSurfaceFacies.js',
		'src/3d/world/terrainSurfaceTransitionField.js',
		'src/3d/world/terrainSurfaceRockFabric.js',
		'src/3d/world/terrainSurfaceLowlandFabric.js',
		'src/3d/world/terrainSurfaceCryosphere.js',
		'src/3d/world/terrainSurfaceErosionField.js',
	]) {
		const source = await fs.readFile(path.join(repoRoot, pathName), 'utf8');
		assert(source.length > 500, `${pathName} unexpectedly tiny`);
	}
}

async function main() {
	testNoiseField();
	testPolicyContracts();
	testFaciesDeterminismAndWeights();
	testTransitionBoundaries();
	testRockFabric();
	testLowlandFabric();
	testCryosphereFabric();
	testErosionField();
	testTransitionPurity();
	testDiagnostics();
	await testStaticProductionWiring();
	console.log('[checkTerrainSurfaceFacies] PASS', JSON.stringify({
		faciesPolicy: TERRAIN_FACIES_POLICY.id,
		transitionPolicy: TERRAIN_TRANSITION_POLICY.id,
		rockFabricPolicy: TERRAIN_ROCK_FABRIC_POLICY.id,
		lowlandPolicy: TERRAIN_LOWINLAND_FABRIC_POLICY.id,
		cryospherePolicy: TERRAIN_CRYOSPHERE_POLICY.id,
		erosionPolicy: TERRAIN_EROSION_FIELD_POLICY.id,
		faciesCount: TERRAIN_FACIES_NAMES.length,
		worldBandsMeters: TERRAIN_FACIES_POLICY.worldSpaceBandsMeters,
		transitionBandsMeters: TERRAIN_TRANSITION_POLICY.worldBandsMeters,
		canonicalHeightUnchanged: true,
		canonicalHydrologyUnchanged: true,
		canonicalColliderUnchanged: true,
	}));
}
main().catch((error) => {
	console.error('[checkTerrainSurfaceFacies] FAIL', error);
	process.exitCode = 1;
});

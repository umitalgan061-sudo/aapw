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

function testFaciesContract() {
	assert.equal(TERRAIN_FACIES_POLICY.renderOnly, true);
	assert.equal(TERRAIN_FACIES_POLICY.deterministic, true);
	assert.equal(TERRAIN_FACIES_POLICY.canonicalHeightUnchanged, true);
	assert.equal(TERRAIN_FACIES_POLICY.canonicalHydrologyUnchanged, true);
	assert.equal(TERRAIN_FACIES_POLICY.canonicalColliderUnchanged, true);
	assert.equal(TERRAIN_FACIES_POLICY.canonicalCoastlineUnchanged, true);
	assert.equal(TERRAIN_FACIES_POLICY.newGeographyIntroduced, false);
	assert.equal(TERRAIN_FACIES_POLICY.faciesCount, TERRAIN_FACIES_NAMES.length);
	assert.deepEqual(TERRAIN_MICRO_SURFACE_POLICY.worldSpaceMacroScaleMeters, [38, 92, 240, 620, 1450, 3200]);
	assert.equal(TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters, 22);
	assert.equal(TERRAIN_MICRO_SURFACE_POLICY.uvChannel, 1);
}

function testFaciesDeterminism() {
	const sample = makeBaseSample();
	assertDeterministic('facies sample', () => resolveTerrainSurfaceFacies(sample));
	assertDeterministic('material response', () => {
		const facies = resolveTerrainSurfaceFacies(sample);
		return resolveTerrainSurfaceMaterialResponse({
			facies,
			baseColor: sample.color,
			heightMeters: sample.heightMeters,
			slopeDegrees: sample.slopeDegrees,
			coastHeightMeters: sample.coastHeightMeters,
		});
	});
}

function testFaciesWeightIntegrity() {
	const samples = [
		makeBaseSample({ slopeDegrees: 3, heightMeters: 45, coastHeightMeters: 70, color: { r: 0.22, g: 0.38, b: 0.14 } }),
		makeBaseSample({ slopeDegrees: 33, heightMeters: 160, coastHeightMeters: 140, color: { r: 0.33, g: 0.33, b: 0.31 } }),
		makeBaseSample({ slopeDegrees: 41, heightMeters: 460, coastHeightMeters: 320, color: { r: 0.62, g: 0.68, b: 0.71 }, canonicalSnow: 0.8, northness: 0.7 }),
		makeBaseSample({ slopeDegrees: 14, heightMeters: 16, coastHeightMeters: 1.8, color: { r: 0.30, g: 0.34, b: 0.23 } }),
	];
	for (const sample of samples) {
		const facies = resolveTerrainSurfaceFacies(sample);
		assert.equal(facies.weights.length, TERRAIN_FACIES_NAMES.length);
		const sum = facies.weights.reduce((a, b) => a + b, 0);
		assert(nearlyEqual(sum, 1, 1e-10), `facies weights must sum to 1: ${sum}`);
		facies.weights.forEach((value, index) => assertBounded(`${TERRAIN_FACIES_NAMES[index]} weight`, value));
		assert.equal(TERRAIN_FACIES_NAMES[facies.dominantIndex], facies.dominant);
		assertBounded('moisture', facies.moisture);
		assertBounded('drought', facies.drought);
		assertBounded('coastal', facies.coastal);
		assertBounded('saltSpray', facies.saltSpray);
		assertBounded('snow', facies.snow);
	}
}

function testTransitionBoundaries() {
	const beach = resolveShoreTransition({ worldX: 10, worldZ: 20, coastHeightMeters: 1.0, slopeDegrees: 4 });
	const upland = resolveShoreTransition({ worldX: 10, worldZ: 20, coastHeightMeters: 80, slopeDegrees: 4 });
	assert(beach.stain > upland.stain, 'shoreline stain must fade away from the coast');
	assert(beach.intertidal > upland.intertidal, 'intertidal mask must fade inland');
	assert(beach.alluvialWash >= upland.alluvialWash, 'alluvial wash must be strongest near the water edge');

	const steepSnow = resolveCryosphereTransition({ worldX: 50, worldZ: 80, heightMeters: 480, slopeDegrees: 39, northness: 0.7, baseSnow: 0.4 });
	const lowPlain = resolveCryosphereTransition({ worldX: 50, worldZ: 80, heightMeters: 60, slopeDegrees: 4, northness: -0.2, baseSnow: 0 });
	assert(steepSnow.snow > lowPlain.snow, 'cryosphere snow response must be height-aware');
	assert(steepSnow.scour > lowPlain.scour, 'snow scour must respond to steep terrain');
	assert(steepSnow.exposedSubstrate >= 0, 'exposed substrate must remain bounded');

	const wetSlope = resolveVegetationEdgeTransition({ worldX: 55, worldZ: 92, heightMeters: 72, slopeDegrees: 7, moisture: 0.78, vegetationSignal: 0.82 });
	const dryCliff = resolveVegetationEdgeTransition({ worldX: 55, worldZ: 92, heightMeters: 260, slopeDegrees: 41, moisture: 0.23, vegetationSignal: 0.82 });
	assert(wetSlope.meadow > dryCliff.meadow, 'wet lowland should retain meadow continuity');
	assert(dryCliff.stress > wetSlope.stress, 'steep/dry ground should stress vegetation edges');
}

function testTransitionPurity() {
	assert.equal(TERRAIN_TRANSITION_POLICY.renderOnly, true);
	assert.equal(TERRAIN_TRANSITION_POLICY.canonicalHeightUnchanged, true);
	assert.equal(TERRAIN_TRANSITION_POLICY.canonicalHydrologyUnchanged, true);
	assert.equal(TERRAIN_TRANSITION_POLICY.canonicalWaterGeometryUnchanged, true);
	assert.equal(TERRAIN_TRANSITION_POLICY.canonicalIceGeometryUnchanged, true);
	const sample = resolveFullTransitionSample({ worldX: 7, worldZ: 9, coastHeightMeters: 3, heightMeters: 340, slopeDegrees: 29, northness: 0.4, vegetationSignal: 0.72, moisture: 0.61 });
	assert(sample.shore.wetness >= 0 && sample.shore.wetness <= 1);
	assert(sample.cryosphere.snow >= 0 && sample.cryosphere.snow <= 1);
	assert(sample.vegetation.stress >= 0 && sample.vegetation.stress <= 1);
}

function testDiagnostics() {
	const diagnostic = createTerrainFaciesDiagnostics(makeBaseSample({ heightMeters: 280, slopeDegrees: 29, coastHeightMeters: 72 }));
	assert.equal(diagnostic.policyId, TERRAIN_FACIES_POLICY.id);
	assert(Array.isArray(diagnostic.worldSpaceBandsMeters));
	assert.equal(diagnostic.canonicalHeightUnchanged, true);
	assert.equal(diagnostic.canonicalHydrologyUnchanged, true);
	assert.equal(diagnostic.canonicalColliderUnchanged, true);
	assertBounded('diagnostic nonuniformity', diagnostic.nonUniformity);
	assert(diagnostic.roughness >= TERRAIN_FACIES_POLICY.roughnessRange[0]);
	assert(diagnostic.roughness <= TERRAIN_FACIES_POLICY.roughnessRange[1]);
}

async function testStaticProductionWiring() {
	const microSurface = await fs.readFile(path.join(repoRoot, 'src/3d/world/terrainMicroSurface.js'), 'utf8');
	assert(microSurface.includes("from './terrainSurfaceFacies.js'"), 'terrainMicroSurface must import the facies layer');
	assert(microSurface.includes("from './terrainSurfaceTransitionField.js'"), 'terrainMicroSurface must import the transition layer');
	assert(microSurface.includes('installTerrainSurfaceFacies(material)'), 'facies layer must be installed in production');
	assert(microSurface.includes('installTerrainTransitionField(material)'), 'transition layer must be installed in production');
	assert(microSurface.includes('canonicalHeightUnchanged: true'), 'material proof must expose canonical-height neutrality');
	assert(microSurface.includes('newGeographyIntroduced: false'), 'material proof must explicitly prohibit new geography');
	assert(microSurface.includes('snowGranularAlbedo: true'), 'snow grain contract must remain visible to visual QA');
	assert(microSurface.includes('coastalSaltSprayWeathering: true'), 'coastal salt contract must remain visible to visual QA');
}

async function main() {
	testNoiseField();
	testFaciesContract();
	testFaciesDeterminism();
	testFaciesWeightIntegrity();
	testTransitionBoundaries();
	testTransitionPurity();
	testDiagnostics();
	await testStaticProductionWiring();
	console.log('[checkTerrainSurfaceFacies] PASS', JSON.stringify({
		faciesPolicy: TERRAIN_FACIES_POLICY.id,
		transitionPolicy: TERRAIN_TRANSITION_POLICY.id,
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

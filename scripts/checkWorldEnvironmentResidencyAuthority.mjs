#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS = [
	'src/3d/world/worldEnvironmentResidency.js',
	'src/3d/world/worldEnvironmentSurfaceProfiles.js',
	'src/3d/world/chunkManager.js',
];

let checks = 0;
let failures = 0;

function check(condition, message) {
	checks += 1;
	if (!condition) throw new Error(message);
}

function run(name, fn) {
	try {
		fn();
		console.log(`[residency-authority] PASS ${name}`);
	} catch (error) {
		failures += 1;
		console.error(`[residency-authority] FAIL ${name}: ${error.message}`);
	}
}

function read(relativePath) {
	return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

run('residency module stays below the authority boundary', () => {
	const source = read(TARGETS[0]);
	for (const forbidden of [
		"from './terrain.js'",
		"from './vegetation.js'",
		"from './settlements.js'",
		"from './roads.js'",
		"from './rivers.js'",
		"from './water.js'",
		"from './naturalGeology.js'",
	]) {
		check(!source.includes(forbidden), `residency must not import ${forbidden}`);
	}
	check(source.includes('selectionNeverInventsGeography'), 'geography guard missing');
	check(source.includes('assetSelectionAuthority'), 'asset selection boundary missing');
	check(source.includes('placementAuthority'), 'placement boundary missing');
});

run('surface profile module stays material-only', () => {
	const source = read(TARGETS[1]);
	for (const forbidden of [
		"from './terrain.js'",
		"from './chunkManager.js'",
		"from './vegetation.js'",
		"from './settlements.js'",
		"from './roads.js'",
		"from './water.js'",
	]) {
		check(!source.includes(forbidden), `surface profiles must not import ${forbidden}`);
	}
	check(source.includes('inventNewGeography: false'), 'surface geography guard missing');
	check(source.includes('assetTextureAuthority'), 'surface texture authority missing');
});

run('chunk manager owns residency application, not geometry authority', () => {
	const source = read(TARGETS[2]);
	check(source.includes("from './terrain.js'"), 'chunk manager must retain terrain authority import');
	check(source.includes("from './worldEnvironmentResidency.js'"), 'chunk manager residency integration missing');
	check(source.includes('applyEnvironmentResidency('), 'chunk manager residency application missing');
	check(source.includes('refreshEnvironmentResidency('), 'chunk manager residency refresh missing');
	check(source.includes('environmentResidencyCenter'), 'stream center state missing');
});

run('runtime never changes canonical terrain through residency metadata', () => {
	const source = read(TARGETS[2]);
	check(!source.includes('mesh.position.y ='), 'residency must not move terrain in Y');
	check(!source.includes('mesh.scale.y ='), 'residency must not rescale terrain height');
	check(!source.includes('WATER_LEVEL_METERS ='), 'residency must not rewrite sea level');
	check(!source.includes('sampleHeightMeters ='), 'residency must not replace the height sampler');
});

run('material distance response is bounded to render state', () => {
	const source = read(TARGETS[0]);
	check(source.includes('applyDistancePresetToMaterial'), 'distance material response missing');
	check(source.includes('normalScale'), 'normal-scale response missing');
	check(source.includes('roughnessBias'), 'roughness response missing');
	check(source.includes('receiveShadow'), 'shadow response missing');
	check(source.includes('castShadow: false'), 'terrain shadow cost guard missing');
});

run('asset fidelity gate forbids silent placeholder acceptance', () => {
	const source = read(TARGETS[0]);
	check(source.includes('single-color-material'), 'single-color failure code missing');
	check(source.includes('placeholder-material'), 'placeholder failure code missing');
	check(source.includes('missing-normal'), 'normal failure code missing');
	check(source.includes('missing-roughness'), 'roughness failure code missing');
});

run('distance bands remain world-space distances', () => {
	const source = read(TARGETS[0]);
	check(source.includes('chunkDeltaDistanceMeters'), 'world-space distance helper missing');
	check(source.includes('Math.hypot(dx * size, dz * size)'), 'Euclidean world-space distance missing');
	check(!source.includes('Pindex'), 'residency must not key visual bands by Pindex index');
	check(!source.includes('GeoCell'), 'residency must not key visual bands by GeoCell edge');
});

run('deterministic slot selection stays seed-derived', () => {
	const source = read(TARGETS[0]);
	check(source.includes('stableHash32'), 'stable hash missing');
	check(source.includes('stableUnitFloat'), 'stable unit random missing');
	check(source.includes("'slot'"), 'slot stream missing');
	check(!source.includes('Math.random'), 'Math.random forbidden in residency');
});

run('surface profiles expose macro and micro breakup', () => {
	const source = read(TARGETS[1]);
	check(source.includes('macroPattern'), 'macro pattern profiles missing');
	check(source.includes('microPattern'), 'micro pattern profiles missing');
	check(source.includes('antiTilingRotation'), 'anti-tiling response missing');
	check(source.includes('triplanar'), 'triplanar response missing');
});

run('quality degradation is monotonic', () => {
	const source = read(TARGETS[0]);
	check(source.includes("density: 1.0"), 'ultra baseline missing');
	check(source.includes("density: 0.56"), 'low baseline missing');
	check(source.includes('BAND_FACTORS'), 'distance factors missing');
	check(source.includes('MOBILE_BAND_FACTORS'), 'mobile factors missing');
});

run('runtime manifest is inspectable by downstream environment consumers', () => {
	const source = read(TARGETS[2]);
	check(source.includes('mesh.userData.environmentResidency'), 'runtime manifest storage missing');
	check(source.includes('environmentResidencyBand'), 'runtime band metadata missing');
	check(source.includes('environmentResidencyDistanceMeters'), 'runtime distance metadata missing');
	check(source.includes('getEnvironmentResidencyStats'), 'residency telemetry missing');
});

run('surface profiles preserve imported source material authority', () => {
	const source = read(TARGETS[1]);
	check(source.includes('allowSourceMaterialPreservation: true'), 'source material preservation missing');
	check(!source.includes('replaceSourceMaterial: true'), 'source material replacement authority detected');
});

run('contract remains explicit and versioned', () => {
	const residency = read(TARGETS[0]);
	const surface = read(TARGETS[1]);
	check(/world-environment-residency-\d{4}-\d{2}-\d{2}-v1/.test(residency), 'residency policy id missing/versionless');
	check(/environment-surface-response-profiles-\d{4}-\d{2}-\d{2}-v1/.test(surface), 'surface profile policy id missing/versionless');
});

if (failures > 0) process.exit(1);
console.log(`[residency-authority] PASS checks=${checks} failures=0`);

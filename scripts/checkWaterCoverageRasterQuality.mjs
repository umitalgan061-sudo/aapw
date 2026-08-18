import assert from 'node:assert/strict';
import {
	createWaterDepthField,
	disposeWaterDepthField,
} from '../src/3d/world/waterDepthField.js';

const CASES = [
	{
		name: 'diagonal',
		extentMeters: 420,
		resolution: 25,
		height: (x, z) => (x * 0.72 + z - 18 > 0 ? -3 : 4),
	},
	{
		name: 'curved-bay',
		extentMeters: 520,
		resolution: 29,
		height: (x, z) => {
			const coast = Math.hypot(x + 35, z - 20) - 142 + Math.sin(z * 0.035) * 9;
			return coast < 0 ? -2.5 : 5;
		},
	},
	{
		name: 'meandering-shore',
		extentMeters: 600,
		resolution: 31,
		height: (x, z) => {
			const coastX = Math.sin(z * 0.024) * 68 + Math.sin(z * 0.061) * 15;
			return x > coastX ? -4 : 3.5;
		},
	},
];

const TRUTH_SAMPLES_PER_AXIS = 20;

function decodeCoverage(field, row, column) {
	const { resolution } = field;
	const offset = (row * resolution + column) * 4;
	return field.texture.image.data[offset + 1] / 255;
}

function denseTruthCoverage(testCase, row, column) {
	const { extentMeters, resolution, height } = testCase;
	const stepMeters = extentMeters / (resolution - 1);
	const originMeters = -extentMeters / 2;
	const centreX = originMeters + column * stepMeters;
	const centreZ = originMeters + row * stepMeters;
	let wet = 0;
	const n = TRUTH_SAMPLES_PER_AXIS;

	for (let subRow = 0; subRow < n; subRow++) {
		for (let subColumn = 0; subColumn < n; subColumn++) {
			const offsetX = (subColumn + 0.5) / n - 0.5;
			const offsetZ = (subRow + 0.5) / n - 0.5;
			if (height(centreX + offsetX * stepMeters, centreZ + offsetZ * stepMeters) < 0) wet++;
		}
	}
	return wet / (n * n);
}

function legacyCentreCoverage(testCase, row, column) {
	const { extentMeters, resolution, height } = testCase;
	const stepMeters = extentMeters / (resolution - 1);
	const originMeters = -extentMeters / 2;
	const x = originMeters + column * stepMeters;
	const z = originMeters + row * stepMeters;
	return height(x, z) < 0 ? 1 : 0;
}

function evaluateCase(testCase) {
	const field = createWaterDepthField({
		waterLevelMeters: 0,
		fullWaveDepthMeters: 10,
		extentMeters: testCase.extentMeters,
		resolution: testCase.resolution,
		sampleHeightMeters: testCase.height,
	});

	try {
		let currentAbsoluteError = 0;
		let legacyAbsoluteError = 0;
		let boundaryTexels = 0;
		let currentHardMisses = 0;
		let legacyHardMisses = 0;
		let currentFractionalBoundaryTexels = 0;
		let wetInteriorLeaks = 0;
		let dryInteriorLeaks = 0;

		for (let row = 0; row < testCase.resolution; row++) {
			for (let column = 0; column < testCase.resolution; column++) {
				const truth = denseTruthCoverage(testCase, row, column);
				const current = decodeCoverage(field, row, column);
				const legacy = legacyCentreCoverage(testCase, row, column);

				currentAbsoluteError += Math.abs(current - truth);
				legacyAbsoluteError += Math.abs(legacy - truth);

				const isBoundary = truth > 0.001 && truth < 0.999;
				if (isBoundary) {
					boundaryTexels++;
					if (current > 0 && current < 1) currentFractionalBoundaryTexels++;
					if (Math.abs(current - truth) >= 0.5) currentHardMisses++;
					if (Math.abs(legacy - truth) >= 0.5) legacyHardMisses++;
				} else if (truth >= 0.999 && current < 0.999) {
					wetInteriorLeaks++;
				} else if (truth <= 0.001 && current > 0.001) {
					dryInteriorLeaks++;
				}
			}
		}

		const texelCount = testCase.resolution * testCase.resolution;
		return {
			name: testCase.name,
			currentMae: currentAbsoluteError / texelCount,
			legacyMae: legacyAbsoluteError / texelCount,
			boundaryTexels,
			currentHardMisses,
			legacyHardMisses,
			currentFractionalBoundaryTexels,
			wetInteriorLeaks,
			dryInteriorLeaks,
			mixedCoastTexelRatio: field.mixedCoastTexelRatio,
			meanWetCoverage: field.meanWetCoverage,
		};
	} finally {
		disposeWaterDepthField(field);
	}
}

const results = CASES.map(evaluateCase);

for (const result of results) {
	assert.ok(result.boundaryTexels >= 20, `${result.name}: fixture must exercise a meaningful coast`);
	assert.ok(
		result.currentFractionalBoundaryTexels >= Math.floor(result.boundaryTexels * 0.45),
		`${result.name}: at least 45% of true boundary texels should encode fractional wet area`,
	);
	assert.ok(
		result.currentMae < result.legacyMae * 0.72,
		`${result.name}: supersampled MAE ${result.currentMae.toFixed(4)} must beat legacy ${result.legacyMae.toFixed(4)} by >=28%`,
	);
	assert.ok(
		result.currentHardMisses <= result.legacyHardMisses,
		`${result.name}: supersampling must not create more >=50% boundary classification misses`,
	);
	assert.equal(result.wetInteriorLeaks, 0, `${result.name}: canonical wet interior must not lose coverage`);
	assert.equal(result.dryInteriorLeaks, 0, `${result.name}: canonical dry interior must not gain water coverage`);
	assert.ok(result.mixedCoastTexelRatio > 0, `${result.name}: production diagnostics must expose mixed coast cells`);
	assert.ok(result.meanWetCoverage > 0 && result.meanWetCoverage < 1, `${result.name}: fixture must contain both land and water`);
}

const aggregateCurrent = results.reduce((sum, result) => sum + result.currentMae, 0) / results.length;
const aggregateLegacy = results.reduce((sum, result) => sum + result.legacyMae, 0) / results.length;
const aggregateBoundary = results.reduce((sum, result) => sum + result.boundaryTexels, 0);
const aggregateFractional = results.reduce((sum, result) => sum + result.currentFractionalBoundaryTexels, 0);

assert.ok(
	aggregateCurrent < aggregateLegacy * 0.68,
	`aggregate supersampled coverage MAE ${aggregateCurrent.toFixed(4)} must beat legacy ${aggregateLegacy.toFixed(4)} by >=32%`,
);
assert.ok(
	aggregateFractional / aggregateBoundary >= 0.5,
	'combined coast fixtures must encode fractional coverage on at least half of true boundary texels',
);

for (const [name, height, expectedGreen] of [
	['all-dry', () => 12, 0],
	['all-wet', () => -12, 255],
]) {
	const field = createWaterDepthField({
		waterLevelMeters: 0,
		extentMeters: 160,
		resolution: 9,
		sampleHeightMeters: height,
	});
	try {
		const data = field.texture.image.data;
		for (let offset = 0; offset < data.length; offset += 4) {
			assert.equal(data[offset + 1], expectedGreen, `${name}: coverage must remain uniform`);
		}
		assert.equal(field.mixedCoastTexelRatio, 0, `${name}: uniform world must not report mixed coast`);
	} finally {
		disposeWaterDepthField(field);
	}
}

for (const result of results) {
	console.log(
		`${result.name}: currentMAE=${result.currentMae.toFixed(4)} legacyMAE=${result.legacyMae.toFixed(4)} ` +
		`boundary=${result.boundaryTexels} fractional=${result.currentFractionalBoundaryTexels}`,
	);
}
console.log(`aggregate: currentMAE=${aggregateCurrent.toFixed(4)} legacyMAE=${aggregateLegacy.toFixed(4)}`);
console.log('Water Coverage Raster Quality: PASS');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createWaterDepthField,
	disposeWaterDepthField,
	WATER_COVERAGE_SUBSAMPLES_PER_AXIS,
	WATER_OFFSHORE_OPTICAL_FULL_DISTANCE_METERS,
	WATER_OFFSHORE_SHORELINE_MAX_COVERAGE,
} from '../src/3d/world/waterDepthField.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WATER_SOURCE = readFileSync(resolve(HERE, '../src/3d/world/water.js'), 'utf8');
const texel = (field, row, column) => {
	const offset = (row * field.resolution + column) * 4;
	return Array.from(field.texture.image.data.slice(offset, offset + 4));
};
const offshore = (field, row, column) => field.offshoreTexture.image.data[row * field.resolution + column];
assert.equal(WATER_COVERAGE_SUBSAMPLES_PER_AXIS, 2);
assert.equal(WATER_OFFSHORE_OPTICAL_FULL_DISTANCE_METERS, 1100);
assert.equal(WATER_OFFSHORE_SHORELINE_MAX_COVERAGE, 0.5);

let probes = 0;
const coast = createWaterDepthField({
	waterLevelMeters: 0,
	fullWaveDepthMeters: 10,
	extentMeters: 40,
	resolution: 5,
	offshoreOpticalFullDistanceMeters: 20,
	sampleHeightMeters: (x) => {
		probes += 1;
		return x <= 0 ? 2 : (x < 20 ? -2 : -12);
	},
});
try {
	assert.equal(probes, 5 * 5 * 4, 'offshore field must add zero canonical terrain probes');
	for (let row = 0; row < 5; row += 1) {
		assert.deepEqual(texel(coast, row, 0), [0, 0, 255, 255]);
		assert.deepEqual(texel(coast, row, 1), [0, 0, 255, 255]);
		assert.deepEqual(texel(coast, row, 2), [51, 128, 255, 255]);
		assert.deepEqual(texel(coast, row, 3), [51, 255, 255, 255]);
		assert.deepEqual(texel(coast, row, 4), [153, 255, 255, 255]);
		assert.equal(offshore(coast, row, 2), 0, '50%-wet canonical shoreline must stay optical distance zero');
		assert.equal(offshore(coast, row, 3), 128, 'first marine interior cell should be half optical depth');
		assert.equal(offshore(coast, row, 4), 255, 'farther marine cell should reach the bounded optical cap');
	}
	assert.equal(coast.marineFractionOfWetCoverage, 1);
	assert.ok(coast.meanOffshoreOpticalFactor > 0.55 && coast.meanOffshoreOpticalFactor < 0.65);
	assert.equal(coast.offshoreFullTexelRatio, 5 / 25);
} finally {
	disposeWaterDepthField(coast);
}

const speckledOcean = createWaterDepthField({
	waterLevelMeters: 0,
	extentMeters: 60,
	resolution: 7,
	offshoreOpticalFullDistanceMeters: 20,
	sampleHeightMeters: (x, z) => (
		Math.abs(x) < 4 && Math.abs(z) < 4 && x > 0 && z > 0 ? 1 : -2
	),
});
try {
	assert.deepEqual(texel(speckledOcean, 3, 3), [51, 191, 255, 255], '75%-wet RGBA authority drifted');
	assert.equal(speckledOcean.marineFractionOfWetCoverage, 1);
	assert.equal(offshore(speckledOcean, 3, 3), 255, '75%-wet open marine texel must carry offshore distance');
} finally {
	disposeWaterDepthField(speckledOcean);
}

const lake = createWaterDepthField({
	waterLevelMeters: 0,
	extentMeters: 600,
	resolution: 61,
	sampleHeightMeters: (x, z) => Math.hypot(x, z) < 210 ? -6 : 8,
});
try {
	assert.ok(lake.meanWetCoverage > 0.30, 'lake fixture must contain substantial canonical water');
	assert.equal(lake.marineFractionOfWetCoverage, 0, 'enclosed lake must not be classified as marine');
	assert.equal(Math.max(...lake.offshoreTexture.image.data), 0, 'enclosed lake must have zero offshore optical depth');
	const centre = texel(lake, 30, 30);
	assert.ok(centre[0] > 0 && centre[1] === 255, 'lake must retain physical depth and canonical coverage');
} finally {
	disposeWaterDepthField(lake);
}

const ocean = createWaterDepthField({
	waterLevelMeters: 0,
	extentMeters: 800,
	resolution: 17,
	sampleHeightMeters: () => -3,
});
try {
	assert.equal(ocean.marineFractionOfWetCoverage, 1);
	assert.equal(Math.min(...ocean.offshoreTexture.image.data), 255);
	assert.equal(Math.max(...ocean.offshoreTexture.image.data), 255);
} finally {
	disposeWaterDepthField(ocean);
}

const fixture = {
	waterLevelMeters: 0,
	extentMeters: 520,
	resolution: 39,
	sampleHeightMeters: (x, z) => x > Math.sin(z * 0.025) * 80 ? -4 : 5,
};
const first = createWaterDepthField(fixture);
const second = createWaterDepthField(fixture);
try {
	assert.deepEqual(Array.from(first.texture.image.data), Array.from(second.texture.image.data));
	assert.deepEqual(Array.from(first.offshoreTexture.image.data), Array.from(second.offshoreTexture.image.data));
	assert.equal(first.meanOffshoreOpticalFactor, second.meanOffshoreOpticalFactor);
} finally {
	disposeWaterDepthField(first);
	disposeWaterDepthField(second);
}

assert.match(WATER_SOURCE, /uniform sampler2D uOffshoreMap;/);
assert.match(WATER_SOURCE, /sampleOffshoreOptical\(vWorldPosition\.xz\)/);
assert.match(WATER_SOURCE, /WATER_OFFSHORE_OPTICAL_GAIN = 0\.82;/);
assert.match(WATER_SOURCE, /offshoreGain = offshoreOptical \* \(1\.0 - fragmentDepth\)/);
assert.match(WATER_SOURCE, /bodyColor = mix\(bodyColor, uDeepColor, offshoreGain \* 0\.88\);/);
assert.match(WATER_SOURCE, /float amplitudeScale = depthFactor \* uSwellStrength/);
assert.match(WATER_SOURCE, /float shallowMask = 1\.0 - smoothstep\(0\.0, 0\.22, fragmentDepth\);/);
assert.match(WATER_SOURCE, /float opticalDepth = 1\.0 - exp\(-fragmentDepth \* 3\.2\);/);
assert.match(WATER_SOURCE, /offshoreAbsorption = 1\.0 - exp\(-offshoreGain \* 3\.4\)/);

const alphaAt = (fragmentDepth, offshoreOptical) => {
	const physical = 1 - Math.exp(-fragmentDepth * 3.2);
	const offshoreGain = offshoreOptical * (1 - fragmentDepth) * 0.82;
	const marine = 1 - Math.exp(-offshoreGain * 3.4);
	const optical = 1 - (1 - physical) * (1 - marine);
	return 0.14 + (0.90 - 0.14) * optical;
};
const shallowLakeAlpha = alphaAt(0.08, 0);
const offshoreShelfAlpha = alphaAt(0.08, 1);
assert(offshoreShelfAlpha > shallowLakeAlpha + 0.35, `marine shelf separation too weak: ${offshoreShelfAlpha}/${shallowLakeAlpha}`);
assert(offshoreShelfAlpha < 0.90, 'offshore shelf must remain bounded below fully opaque water');

console.log('[checkWaterOffshoreOptics] PASS', JSON.stringify({
	fullDistanceMeters: WATER_OFFSHORE_OPTICAL_FULL_DISTANCE_METERS,
	canonicalProbesIn25Texels: probes,
	lakeMarineFraction: 0,
	shallowLakeAlpha,
	offshoreShelfAlpha,
}));
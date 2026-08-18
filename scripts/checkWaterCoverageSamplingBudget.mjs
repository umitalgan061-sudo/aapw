import assert from 'node:assert/strict';
import {
	createWaterDepthField,
	disposeWaterDepthField,
	WATER_COVERAGE_SUBSAMPLES_PER_AXIS,
} from '../src/3d/world/waterDepthField.js';

const resolution = 19;
let probes = 0;
const field = createWaterDepthField({
	waterLevelMeters: 0,
	extentMeters: 360,
	resolution,
	sampleHeightMeters: (x, z) => {
		probes++;
		return x + z > 0 ? -4 : 4;
	},
});

try {
	const expectedProbes = resolution * resolution * WATER_COVERAGE_SUBSAMPLES_PER_AXIS ** 2;
	assert.equal(probes, expectedProbes, 'coverage bake must remain exactly four canonical height probes per texel');
	assert.equal(field.resolution, resolution);
	assert.equal(field.coverageSubsamplesPerAxis, 2);
	assert.ok(field.mixedCoastTexelRatio > 0, 'budget fixture must still exercise mixed shoreline texels');
	assert.ok(Number.isFinite(field.bakeMs) && field.bakeMs >= 0, 'bake timing diagnostic must remain available');
} finally {
	disposeWaterDepthField(field);
}

console.log(`Water Coverage Sampling Budget: PASS (${probes} canonical probes)`);

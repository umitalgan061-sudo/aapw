import assert from 'node:assert/strict';
import {
	createCoverageSubsampleOffsets,
	createWaterDepthField,
	disposeWaterDepthField,
	sampleWaterTexelFootprint,
	WATER_COVERAGE_SUBSAMPLES_PER_AXIS,
} from '../src/3d/world/waterDepthField.js';
import {
	createWater,
	setWaterDepthField,
	disposeWater,
} from '../src/3d/world/water.js';

function texel(texture, resolution, row, column) {
	const offset = (row * resolution + column) * 4;
	return Array.from(texture.image.data.slice(offset, offset + 4));
}

function green(texture, resolution, row, column) {
	return texel(texture, resolution, row, column)[1];
}

function countMixedCoverage(texture, resolution) {
	let mixed = 0;
	for (let row = 0; row < resolution; row++) {
		for (let column = 0; column < resolution; column++) {
			const value = green(texture, resolution, row, column);
			if (value > 0 && value < 255) mixed++;
		}
	}
	return mixed;
}

function bake(options) {
	return createWaterDepthField({
		waterLevelMeters: 0,
		fullWaveDepthMeters: 10,
		...options,
	});
}

assert.equal(WATER_COVERAGE_SUBSAMPLES_PER_AXIS, 2, 'production P0 coverage must use deterministic 2x2 strata');
assert.deepEqual(
	createCoverageSubsampleOffsets(),
	[
		[-0.25, -0.25],
		[0.25, -0.25],
		[-0.25, 0.25],
		[0.25, 0.25],
	],
	'2x2 probes must be symmetric within each texel footprint',
);
assert.throws(() => createCoverageSubsampleOffsets(0), /integer in \[1, 4\]/);
assert.throws(() => createCoverageSubsampleOffsets(5), /integer in \[1, 4\]/);

// A footprint bisected by a canonical vertical coast must encode fractional coverage instead of
// snapping the whole texel to a binary block. Wet-only depth averaging keeps genuine water depth.
const footprint = sampleWaterTexelFootprint({
	sampleHeightMeters: (x) => (x < 0 ? 2 : -4),
	waterLevelMeters: 0,
	fullWaveDepthMeters: 10,
	worldX: 0,
	worldZ: 0,
	stepMeters: 20,
	coverageOffsets: createCoverageSubsampleOffsets(),
});
assert.equal(footprint.coverage, 0.5);
assert.equal(footprint.normalizedDepth, 0.4);
assert.equal(footprint.hasAnyWater, true);
assert.equal(footprint.fullyDeep, false);

// Deterministic synthetic coast: left dry, right water. Unlike the old centre-only field, the
// shoreline column must become a 50% coverage texel because its footprint straddles the coast.
const resolution = 5;
const field = bake({
	extentMeters: 40,
	resolution,
	sampleHeightMeters: (x) => (x <= 0 ? 2 : (x < 20 ? -2 : -12)),
});

try {
	for (let row = 0; row < resolution; row++) {
		assert.deepEqual(texel(field.texture, resolution, row, 0), [0, 0, 255, 255], 'far dry land must stay uncovered');
		assert.deepEqual(texel(field.texture, resolution, row, 1), [0, 0, 255, 255], 'near dry land must stay uncovered');
		assert.deepEqual(texel(field.texture, resolution, row, 2), [51, 128, 255, 255], 'coast footprint must encode 50% wet coverage');
		assert.deepEqual(texel(field.texture, resolution, row, 3), [51, 255, 255, 255], 'shallow water must retain full coverage');
		assert.deepEqual(texel(field.texture, resolution, row, 4), [255, 255, 255, 255], 'deep water must retain full coverage');
	}
	assert.equal(field.coverageSubsamplesPerAxis, 2);
	assert.equal(field.mixedCoastTexelRatio, 5 / 25);
	assert.equal(field.dryTexelRatio, 10 / 25);
	assert.ok(field.meanWetCoverage > 0.45 && field.meanWetCoverage < 0.55, 'wet-area diagnostic should match the half-plane coast');

	const water = createWater(0, 8);
	try {
		const shader = water.material.fragmentShader;
		assert.match(shader, /return field\.rg;/, 'fragment shader must consume depth + canonical coverage together');
		assert.match(shader, /float waterCoverage = smoothstep\(0\.08, 0\.72, waterField\.y\);/);
		assert.match(shader, /if \(waterCoverage <= 0\.01\) discard;/, 'dry owner-world fragments must be rejected');
		assert.match(shader, /alpha \*= waterCoverage;/, 'shoreline opacity must be coverage-bounded');
		assert.doesNotMatch(shader, /vec2\(0\.85, 0\.51\)/, 'legacy sub-10m stripe-prone ripple phase must stay removed');
		assert.doesNotMatch(shader, /\* 2\.4 \+ time \* 1\.8/, 'legacy high-frequency moire component must stay removed');
		assert.match(shader, /float warp = sin\(dot\(worldXZ, vec2\(0\.014, -0\.011\)\)/, 'anti-band phase warp must stay present');
		assert.equal(water.material.uniforms.uShallowColor.value.getHex(), 0x527f79, 'shallow water must stay desaturated from old neon cyan');

		setWaterDepthField(water, field, 1);
		assert.equal(water.material.uniforms.uDepthMap.value, field.texture, 'near water must sample canonical field');
		assert.equal(water.userData.farWater.material.uniforms.uDepthMap.value, field.texture, 'full-world water must share canonical field');
		assert.equal(water.material.uniforms.uDepthFieldExtentMeters.value, 40);
		assert.equal(water.userData.farWater.material.uniforms.uDepthFieldExtentMeters.value, 40);

		// Ownership transfers to water after attachment; keep this unit fixture's explicit disposal path.
		water.userData.depthField = null;
	} finally {
		disposeWater(water);
	}
} finally {
	disposeWaterDepthField(field);
}

// Diagonal coast quality. A binary centre-sampled raster can only produce 0/255 cells. The current
// canonical supersampled field must produce a real band of fractional green texels along the same
// diagonal, reducing rectangular stair-step area without changing which side is land versus water.
const diagonalResolution = 17;
const diagonalField = bake({
	extentMeters: 160,
	resolution: diagonalResolution,
	sampleHeightMeters: (x, z) => (x + z > 3 ? -3 : 3),
});
try {
	const mixed = countMixedCoverage(diagonalField.texture, diagonalResolution);
	assert.ok(mixed >= 14, `diagonal coast must expose a broad fractional edge band; mixed=${mixed}`);
	assert.ok(diagonalField.mixedCoastTexelRatio > 0.04, 'mixed coast telemetry must reveal sub-texel edge coverage');

	let dryViolations = 0;
	let wetViolations = 0;
	const step = 160 / (diagonalResolution - 1);
	const origin = -80;
	for (let row = 0; row < diagonalResolution; row++) {
		const z = origin + row * step;
		for (let column = 0; column < diagonalResolution; column++) {
			const x = origin + column * step;
			const coverage = green(diagonalField.texture, diagonalResolution, row, column) / 255;
			if (x + z < 3 - step && coverage !== 0) dryViolations++;
			if (x + z > 3 + step && coverage !== 1) wetViolations++;
		}
	}
	assert.equal(dryViolations, 0, 'supersampling must not create cyan coverage well inside dry terrain');
	assert.equal(wetViolations, 0, 'supersampling must not punch holes well inside canonical water');
} finally {
	disposeWaterDepthField(diagonalField);
}

// Curved coast quality. This catches regressions where only axis-aligned edges look smooth while a
// lake/sea arc collapses back into chunky rectangular cells.
const curvedResolution = 33;
const radius = 72;
const curvedField = bake({
	extentMeters: 240,
	resolution: curvedResolution,
	sampleHeightMeters: (x, z) => (Math.hypot(x, z) < radius ? -2.5 : 4),
});
try {
	const mixed = countMixedCoverage(curvedField.texture, curvedResolution);
	assert.ok(mixed >= 40, `curved shoreline should contain many fractional cells; mixed=${mixed}`);

	const data = curvedField.texture.image.data;
	let wetPixels = 0;
	let dryPixels = 0;
	let mixedPixels = 0;
	for (let offset = 0; offset < data.length; offset += 4) {
		const coverage = data[offset + 1];
		if (coverage === 0) dryPixels++;
		else if (coverage === 255) wetPixels++;
		else mixedPixels++;
	}
	assert.equal(mixedPixels, mixed);
	assert.ok(wetPixels > 150, 'curved fixture must contain a meaningful water interior');
	assert.ok(dryPixels > 500, 'curved fixture must contain a meaningful dry exterior');
	assert.ok(curvedField.meanWetCoverage > 0.20 && curvedField.meanWetCoverage < 0.35);

	const repeat = bake({
		extentMeters: 240,
		resolution: curvedResolution,
		sampleHeightMeters: (x, z) => (Math.hypot(x, z) < radius ? -2.5 : 4),
	});
	try {
		assert.deepEqual(
			Array.from(repeat.texture.image.data),
			Array.from(curvedField.texture.image.data),
			'coverage supersampling must remain deterministic',
		);
		assert.equal(repeat.mixedCoastTexelRatio, curvedField.mixedCoastTexelRatio);
		assert.equal(repeat.meanWetCoverage, curvedField.meanWetCoverage);
	} finally {
		disposeWaterDepthField(repeat);
	}
} finally {
	disposeWaterDepthField(curvedField);
}

const shallowMixed = bake({
	extentMeters: 20,
	resolution: 3,
	sampleHeightMeters: (x) => (x <= 0 ? 8 : -1),
});
try {
	const center = texel(shallowMixed.texture, 3, 1, 1);
	assert.equal(center[1], 128, 'centre footprint must be 50% wet');
	assert.equal(center[0], 26, 'wet half must retain ~0.1 normalized depth rather than being diluted by dry terrain');
} finally {
	disposeWaterDepthField(shallowMixed);
}

assert.throws(
	() => bake({ extentMeters: 0, resolution: 5, sampleHeightMeters: () => 0 }),
	/extentMeters must be > 0/,
);
assert.throws(
	() => bake({ extentMeters: 20, resolution: 1, sampleHeightMeters: () => 0 }),
	/resolution must be an integer >= 2/,
);
assert.throws(
	() => createWaterDepthField({ waterLevelMeters: 0, sampleHeightMeters: null }),
	/sampleHeightMeters must be a function/,
);

console.log('World Water Coverage P0: PASS');

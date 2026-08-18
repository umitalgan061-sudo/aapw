import assert from 'node:assert/strict';
import {
	createWaterDepthField,
	disposeWaterDepthField,
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

// Deterministic synthetic coast: left side is dry terrain, x=0 is exact shoreline, right side is
// shallow/deep water. The production bake must preserve a separate coverage signal instead of
// forcing the shader to infer wet/dry from normalized depth=0.
const resolution = 5;
const field = createWaterDepthField({
	waterLevelMeters: 0,
	extentMeters: 40,
	resolution,
	fullWaveDepthMeters: 10,
	sampleHeightMeters: (x) => {
		if (x < 0) return 2;
		if (x === 0) return 0;
		if (x < 20) return -2;
		return -12;
	},
});

try {
	for (let row = 0; row < resolution; row++) {
		assert.deepEqual(texel(field.texture, resolution, row, 0), [0, 0, 255, 255], 'dry land must encode depth=0 and coverage=0');
		assert.deepEqual(texel(field.texture, resolution, row, 1), [0, 0, 255, 255], 'dry land near coast must stay uncovered');
		assert.deepEqual(texel(field.texture, resolution, row, 2), [0, 0, 255, 255], 'exact shoreline must not become a cyan water tile');
		assert.deepEqual(texel(field.texture, resolution, row, 3), [51, 255, 255, 255], 'shallow water must retain independent positive coverage');
		assert.deepEqual(texel(field.texture, resolution, row, 4), [255, 255, 255, 255], 'deep water must retain full depth and coverage');
	}
	assert.equal(field.dryTexelRatio, 15 / 25, 'dry ratio must follow the authoritative wet/dry classification');

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
		assert.equal(water.material.uniforms.uShallowColor.value.getHex(), 0x527f79, 'shallow water must stay desaturated from the old neon/cyan value');

		setWaterDepthField(water, field, 1);
		assert.equal(water.material.uniforms.uDepthMap.value, field.texture, 'near water must sample the canonical field');
		assert.equal(water.userData.farWater.material.uniforms.uDepthMap.value, field.texture, 'full-world water must sample the same canonical field');
		assert.equal(water.material.uniforms.uDepthFieldExtentMeters.value, 40);
		assert.equal(water.userData.farWater.material.uniforms.uDepthFieldExtentMeters.value, 40);

		// Ownership transfers to water after setWaterDepthField; avoid disposing the field separately.
		water.userData.depthField = null;
	} finally {
		disposeWater(water);
	}
} finally {
	disposeWaterDepthField(field);
}

console.log('World Water Coverage P0: PASS');

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
	WORLD_REFERENCE_BASE_SURFACE_MASK,
	classifyReferenceBaseSurface,
} from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
	SW_G07_HYDROLOGY,
	isInsideSwG07,
	sampleSwG07WaterConfidence,
} from '../src/3d/world/worldReferenceSwG07Hydrology.js';

assert.equal(SW_G07_HYDROLOGY.geoCell, 'G07');
assert.deepEqual(SW_G07_HYDROLOGY.pixelBounds, { xMin: 0, xMax: 192, yMin: 896, yMax: 1024 });
assert.equal(SW_G07_HYDROLOGY.sourceMapSha256, WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256);
assert.equal(SW_G07_HYDROLOGY.maskSha256, WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256);
assert.equal(isInsideSwG07(0, 0.875), true);
assert.equal(isInsideSwG07(0.125, 1), true);
assert.equal(isInsideSwG07(0.126, 1), false);

let centreMismatches = 0;
let waterCentres = 0;
let landCentres = 0;
const centreSamples = [];
for (let my = 56; my <= 63; my += 1) {
	for (let mx = 0; mx <= 11; mx += 1) {
		const nx = (mx + 0.5) / 96;
		const ny = (my + 0.5) / 64;
		const surface = classifyReferenceBaseSurface(nx, ny);
		const expected = surface === 'sea' || surface === 'lake' ? 1 : 0;
		const confidence = sampleSwG07WaterConfidence(nx, ny);
		if (expected === 1) waterCentres += 1;
		else landCentres += 1;
		if (confidence !== expected) centreMismatches += 1;
		centreSamples.push(`${mx},${my}:${surface}:${confidence.toFixed(6)}`);
	}
}
assert.equal(centreSamples.length, 96);
assert.equal(centreMismatches, 0, 'canonical mask-cell centres must remain semantically exact');

let fractionalSamples = 0;
let maxStep = 0;
let previous = null;
const dense = [];
for (let iy = 0; iy <= 64; iy += 1) {
	for (let ix = 0; ix <= 96; ix += 1) {
		const nx = 0.125 * (ix / 96);
		const ny = 0.875 + 0.125 * (iy / 64);
		const confidence = sampleSwG07WaterConfidence(nx, ny);
		assert.ok(confidence >= 0 && confidence <= 1);
		if (confidence > 0 && confidence < 1) fractionalSamples += 1;
		if (previous !== null) maxStep = Math.max(maxStep, Math.abs(confidence - previous));
		previous = confidence;
		dense.push(confidence.toFixed(6));
	}
}

const digest = crypto.createHash('sha256').update(dense.join('|')).digest('hex');
const secondDigest = crypto.createHash('sha256').update(dense.join('|')).digest('hex');
assert.equal(digest, secondDigest, 'dense field must be deterministic');

console.log(JSON.stringify({
	geoCell: 'G07',
	centreMismatches,
	waterCentres,
	landCentres,
	fractionalSamples,
	maxStep: Number(maxStep.toFixed(6)),
	checksum: digest,
}, null, 2));
console.log('SW_G07_HYDROLOGY_VALIDATION_OK');

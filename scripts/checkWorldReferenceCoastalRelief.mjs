#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { createHeightSampler, DEFAULT_MAX_HEIGHT_METERS } from '../src/3d/world/terrain.js';
import {
	WORLD_REFERENCE_COASTAL_RELIEF_POLICY,
	sampleWorldReferenceCoastalBaseMeters,
	sampleWorldReferenceCoastalProfile,
} from '../src/3d/world/worldReferenceCoastalRelief.js';

const median = (values) => {
	assert(values.length > 0, 'median requires samples');
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
};

const water = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS * 0.5;
const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;
const nearshore = [];
const inland = [];
const pureSea = [];
const dryPoints = [];
const wetPoints = [];

// 125m sampling is finer than one source-mask cell in world space while staying tiny enough for CI.
for (let z = -halfDepth; z <= halfDepth; z += 125) {
	for (let x = -halfWidth; x <= halfWidth; x += 125) {
		const profile = sampleWorldReferenceCoastalProfile(x, z);
		if (!profile.insideReference) continue;
		const base = sampleWorldReferenceCoastalBaseMeters(x, z, DEFAULT_MAX_HEIGHT_METERS * 0.5, DEFAULT_MAX_HEIGHT_METERS);
		if (profile.dryLandWeight >= 0.82) {
			dryPoints.push([x, z]);
			if (profile.landDistanceMeters <= 375) nearshore.push(base);
			if (profile.landDistanceMeters >= 1400) inland.push(base);
		}
		if (profile.dryLandWeight <= 0.08) {
			wetPoints.push([x, z]);
			if (profile.surface === 'sea') pureSea.push(base);
		}
	}
}

assert(nearshore.length >= 40, `insufficient nearshore samples: ${nearshore.length}`);
assert(inland.length >= 40, `insufficient inland samples: ${inland.length}`);
assert(pureSea.length >= 100, `insufficient pure-sea samples: ${pureSea.length}`);

const nearshoreMedian = median(nearshore);
const inlandMedian = median(inland);
const seaMaximum = Math.max(...pureSea);
assert(nearshoreMedian > water, `nearshore median must stay above water: ${nearshoreMedian.toFixed(2)}m`);
assert(
	inlandMedian >= nearshoreMedian + 20,
	`interior must rise materially above shore: shore=${nearshoreMedian.toFixed(2)}m inland=${inlandMedian.toFixed(2)}m`,
);
assert(seaMaximum < water, `canonical pure sea floor leaked above water: ${seaMaximum.toFixed(2)}m`);

const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
for (const [x, z] of dryPoints.filter((_, index) => index % 29 === 0)) {
	const a = sampleHeight(x, z);
	const b = sampleHeight(x, z);
	assert.equal(a, b, `height sampler lost determinism at ${x},${z}`);
}
for (const [x, z] of wetPoints.filter((_, index) => index % 17 === 0)) {
	const profile = sampleWorldReferenceCoastalProfile(x, z);
	if (profile.surface !== 'sea') continue;
	const height = sampleHeight(x, z);
	assert(height < water + 0.05, `pure-sea runtime terrain above water at ${x},${z}: ${height.toFixed(2)}m`);
}

console.log(JSON.stringify({
	policyId: WORLD_REFERENCE_COASTAL_RELIEF_POLICY.id,
	waterLevelMeters: water,
	nearshoreSampleCount: nearshore.length,
	inlandSampleCount: inland.length,
	seaSampleCount: pureSea.length,
	nearshoreMedianMeters: Number(nearshoreMedian.toFixed(3)),
	inlandMedianMeters: Number(inlandMedian.toFixed(3)),
	inlandRiseOverNearshoreMeters: Number((inlandMedian - nearshoreMedian).toFixed(3)),
	pureSeaMaximumMeters: Number(seaMaximum.toFixed(3)),
}, null, 2));

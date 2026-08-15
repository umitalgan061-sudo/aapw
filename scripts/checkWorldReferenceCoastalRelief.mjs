#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import {
	WORLD_REFERENCE_COASTAL_RELIEF_POLICY,
	sampleWorldReferenceCoastalBaseMeters,
	sampleWorldReferenceCoastalProfile,
} from '../src/3d/world/worldReferenceCoastalRelief.js';

const DEFAULT_MAX_HEIGHT_METERS = 24;

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

// 125m sampling is finer than one source-mask cell in world space while staying tiny enough for CI.
// This contract intentionally tests only the dependency-free coastal profile. The integrated
// terrain.js sampler is exercised in the browser/Playwright validation where the game's Three.js
// import map is available, matching the real runtime instead of installing a second npm Three copy.
for (let z = -halfDepth; z <= halfDepth; z += 125) {
	for (let x = -halfWidth; x <= halfWidth; x += 125) {
		const profile = sampleWorldReferenceCoastalProfile(x, z);
		if (!profile.insideReference) continue;
		const base = sampleWorldReferenceCoastalBaseMeters(
			x,
			z,
			DEFAULT_MAX_HEIGHT_METERS * 0.5,
			DEFAULT_MAX_HEIGHT_METERS,
		);
		if (profile.dryLandWeight >= 0.82) {
			if (profile.landDistanceMeters <= 375) nearshore.push(base);
			if (profile.landDistanceMeters >= 1400) inland.push(base);
		}
		if (profile.dryLandWeight <= 0.08 && profile.surface === 'sea') pureSea.push(base);
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

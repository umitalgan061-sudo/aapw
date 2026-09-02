#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import { WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY } from '../src/3d/world/worldReferenceMountainRelief.js';
import {
	WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY,
	sampleMountainLandformDetailContext,
	sampleMountainLandformDetailScale,
} from '../src/3d/world/worldReferenceMountainLandformDetail.js';
import {
	offsetMountainFramePoint,
	sampleMountainRidgeFrame,
} from '../src/3d/world/worldReferenceMountainRidgeFrame.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const DISTANCES = Object.freeze([0.04, 0.14, 0.28, 0.44, 0.60, 0.76, 0.90, 0.98]);
const rounded = (value, digits = 6) => Number(value.toFixed(digits));

function percentile(values, fraction) {
	assert(values.length > 0, 'percentile needs samples');
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
	return sorted[index];
}

function variance(values) {
	assert(values.length > 0, 'variance needs samples');
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function range(values) {
	return Math.max(...values) - Math.min(...values);
}

const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY;
assert.match(policy.id, /ridge-drainage-breakup/, 'landform policy lost ridge-local provenance');
assert(policy.scale.minimum >= 0.78, 'landform detail can erase too much canonical relief');
assert(policy.scale.maximum <= 1.12, 'landform detail can over-amplify canonical relief');
assert(policy.outerNeutralization.end < 1, 'landform modulation must neutralize before support edge');
assert(policy.branchingGullies.end < 1, 'gullies must finish inside canonical support');
assert(policy.interfluveRibs.end < 1, 'ribs must finish inside canonical support');
assert(policy.saddles.coreEnd <= 0.55, 'saddles must remain a ridge-core feature');
assert(policy.branchingGullies.strength <= 0.18, 'gully incision exceeds bounded erosion envelope');

const global = {
	scales: [],
	gullies: [],
	ribs: [],
	headwalls: [],
	saddles: [],
	cliffs: [],
	scree: [],
	deposition: [],
	snowRetention: [],
	bilateralDeltas: [],
	edgeDeltas: [],
};
const evidence = {};

for (const chain of REFERENCE_RELIEF_CHAINS) {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	assert(profile, `${chain.id}: missing live mountain profile`);
	assert(
		profile.landformDetailStrength >= 0.5 && profile.landformDetailStrength <= 1.35,
		`${chain.id}: landform intensity escaped module contract`,
	);
	const compiled = chain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
	const chainScales = [];
	const chainGullies = [];
	const chainRibs = [];
	const chainHeadwalls = [];
	const chainSaddles = [];
	const chainCliffs = [];
	const chainScree = [];
	const chainBilateral = [];
	const chainEdges = [];
	const progressBuckets = new Set();
	let scalarParitySamples = 0;

	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		const a = chain.points[segmentIndex];
		const b = chain.points[segmentIndex + 1];
		for (let step = 1; step <= 17; step += 1) {
			const t = step / 18;
			const centerX = a[0] + (b[0] - a[0]) * t;
			const centerY = a[1] + (b[1] - a[1]) * t;
			const frame = sampleMountainRidgeFrame(centerX, centerY, compiled, MAP_ASPECT);
			progressBuckets.add(Math.round(frame.progress * 24));

			for (const normalizedDistance of DISTANCES) {
				const lateralDistance = profile.outerWidthNormalized * normalizedDistance;
				const leftPoint = offsetMountainFramePoint(frame, -lateralDistance, 0, MAP_ASPECT);
				const rightPoint = offsetMountainFramePoint(frame, lateralDistance, 0, MAP_ASPECT);
				const seed = profile.seed + segmentIndex * 97;
				const left = sampleMountainLandformDetailContext(
					leftPoint.x,
					leftPoint.y,
					compiled,
					MAP_ASPECT,
					normalizedDistance,
					seed,
					profile.landformDetailStrength,
				);
				const right = sampleMountainLandformDetailContext(
					rightPoint.x,
					rightPoint.y,
					compiled,
					MAP_ASPECT,
					normalizedDistance,
					seed,
					profile.landformDetailStrength,
				);

				for (const context of [left, right]) {
					assert.equal(context.policyId, policy.id, `${chain.id}: context policy drift`);
					assert(context.heightScale >= policy.scale.minimum - 1e-12, `${chain.id}: scale below minimum`);
					assert(context.heightScale <= policy.scale.maximum + 1e-12, `${chain.id}: scale above maximum`);
					assert(context.progress >= 0 && context.progress <= 1, `${chain.id}: invalid progress`);
					assert([-1, 0, 1].includes(context.side), `${chain.id}: invalid ridge side`);
					for (const key of [
						'saddleExposure',
						'headwallExposure',
						'gullyExposure',
						'ribExposure',
						'concavity',
						'outerEdgeFade',
						'cliffPotential',
						'screePotential',
						'depositionPotential',
						'snowRetentionPotential',
					]) {
						assert(Number.isFinite(context[key]), `${chain.id}: ${key} is not finite`);
						assert(context[key] >= 0 && context[key] <= 1, `${chain.id}: ${key} escaped [0,1]`);
					}
					assert(Number.isFinite(context.massifScale) && context.massifScale > 0, `${chain.id}: invalid massif scale`);
					chainScales.push(context.heightScale);
					chainGullies.push(context.gullyExposure);
					chainRibs.push(context.ribExposure);
					chainHeadwalls.push(context.headwallExposure);
					chainSaddles.push(context.saddleExposure);
					chainCliffs.push(context.cliffPotential);
					chainScree.push(context.screePotential);
					global.deposition.push(context.depositionPotential);
					global.snowRetention.push(context.snowRetentionPotential);
				}

				const scalar = sampleMountainLandformDetailScale(
					leftPoint.x,
					leftPoint.y,
					compiled,
					MAP_ASPECT,
					normalizedDistance,
					seed,
					profile.landformDetailStrength,
				);
				assert.equal(scalar, left.heightScale, `${chain.id}: scalar/context deterministic parity drift`);
				scalarParitySamples += 1;
				const bilateral = Math.abs(left.heightScale - right.heightScale);
				chainBilateral.push(bilateral);
				if (normalizedDistance >= policy.outerNeutralization.end) {
					chainEdges.push(Math.abs(left.heightScale - 1), Math.abs(right.heightScale - 1));
				}
			}
		}
	}

	assert(chainScales.length >= 250, `${chain.id}: insufficient landform sampling`);
	assert(progressBuckets.size >= 10, `${chain.id}: longitudinal coverage too narrow`);
	assert(variance(chainScales) > 0.00004, `${chain.id}: landform field is effectively flat`);
	assert(range(chainScales) > 0.035, `${chain.id}: landform dynamic range is visually negligible`);
	assert(Math.max(...chainGullies) > 0.08, `${chain.id}: branching gullies never activate`);
	assert(Math.max(...chainRibs) > 0.08, `${chain.id}: interfluve ribs never activate`);
	assert(Math.max(...chainHeadwalls) > 0.015, `${chain.id}: headwall recesses never activate`);
	assert(Math.max(...chainSaddles) > 0.015, `${chain.id}: saddle segmentation never activates`);
	assert(Math.max(...chainCliffs) > 0.03, `${chain.id}: cliff context never activates`);
	assert(Math.max(...chainScree) > 0.03, `${chain.id}: scree context never activates`);
	assert(chainEdges.length > 0, `${chain.id}: no outer-neutralization samples`);
	assert(Math.max(...chainEdges) <= 1e-9, `${chain.id}: detail survives outside neutralization edge`);
	assert(Math.max(...chainBilateral) < 0.20, `${chain.id}: side breakup becomes a one-sided wall`);

	global.scales.push(...chainScales);
	global.gullies.push(...chainGullies);
	global.ribs.push(...chainRibs);
	global.headwalls.push(...chainHeadwalls);
	global.saddles.push(...chainSaddles);
	global.cliffs.push(...chainCliffs);
	global.scree.push(...chainScree);
	global.bilateralDeltas.push(...chainBilateral);
	global.edgeDeltas.push(...chainEdges);
	evidence[chain.id] = {
		intensity: profile.landformDetailStrength,
		samples: chainScales.length,
		scalarParitySamples,
		scaleMin: rounded(Math.min(...chainScales)),
		scaleP20: rounded(percentile(chainScales, 0.20)),
		scaleMedian: rounded(percentile(chainScales, 0.50)),
		scaleP80: rounded(percentile(chainScales, 0.80)),
		scaleMax: rounded(Math.max(...chainScales)),
		variance: rounded(variance(chainScales), 8),
		gullyP90: rounded(percentile(chainGullies, 0.90)),
		ribP90: rounded(percentile(chainRibs, 0.90)),
		cliffP90: rounded(percentile(chainCliffs, 0.90)),
		screeP90: rounded(percentile(chainScree, 0.90)),
		bilateralP90: rounded(percentile(chainBilateral, 0.90)),
	};
}

assert(variance(global.scales) > 0.00006, 'full-world landform field lacks useful variance');
assert(percentile(global.gullies, 0.90) > 0.02, 'full-world gully field is too sparse');
assert(percentile(global.ribs, 0.90) > 0.05, 'full-world rib field is too sparse');
assert(percentile(global.cliffs, 0.90) > 0.02, 'full-world cliff context is too weak');
assert(percentile(global.scree, 0.90) > 0.02, 'full-world scree context is too weak');
assert(percentile(global.deposition, 0.90) > 0.02, 'full-world deposition context is too weak');
assert(percentile(global.snowRetention, 0.90) > 0.02, 'snow-retention potential never becomes useful');
assert(percentile(global.bilateralDeltas, 0.95) < 0.16, 'global lateral breakup is too wall-like');
assert(Math.max(...global.edgeDeltas) <= 1e-9, 'global outer-edge neutralization drifted');

const firstChain = REFERENCE_RELIEF_CHAINS[0];
const firstCompiled = firstChain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
assert.throws(
	() => sampleMountainLandformDetailScale(0.2, 0.4, firstCompiled, MAP_ASPECT, -0.01, 1),
	/\[0,1\]/,
	'negative normalized distance must fail closed',
);
assert.throws(
	() => sampleMountainLandformDetailScale(0.2, 0.4, firstCompiled, MAP_ASPECT, 1.01, 1),
	/\[0,1\]/,
	'out-of-support normalized distance must fail closed',
);
assert.throws(
	() => sampleMountainLandformDetailScale(0.2, 0.4, firstCompiled, MAP_ASPECT, 0.5, 1, 0.49),
	/intensity/,
	'under-range landform intensity must fail closed',
);
assert.throws(
	() => sampleMountainLandformDetailScale(0.2, 0.4, firstCompiled, MAP_ASPECT, 0.5, 1, 1.36),
	/intensity/,
	'over-range landform intensity must fail closed',
);

console.log('MOUNTAIN_LANDFORM_DETAIL_OK', JSON.stringify({
	policyId: policy.id,
	chainCount: REFERENCE_RELIEF_CHAINS.length,
	globalScaleRange: [rounded(Math.min(...global.scales)), rounded(Math.max(...global.scales))],
	gullyP90: rounded(percentile(global.gullies, 0.90)),
	ribP90: rounded(percentile(global.ribs, 0.90)),
	cliffP90: rounded(percentile(global.cliffs, 0.90)),
	screeP90: rounded(percentile(global.scree, 0.90)),
	evidence,
}));

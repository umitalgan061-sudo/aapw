#!/usr/bin/env node
import assert from 'node:assert/strict';

import { REFERENCE_RELIEF_CHAINS, WORLD_REFERENCE_MAP } from '../src/3d/world/worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
} from '../src/3d/world/worldReferenceMountainRelief.js';
import { sampleMountainLandformDetailContext } from '../src/3d/world/worldReferenceMountainLandformDetail.js';
import { offsetMountainFramePoint, sampleMountainRidgeFrame } from '../src/3d/world/worldReferenceMountainRidgeFrame.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));

function percentile(values, fraction) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function countTurningPoints(values, epsilon = 0.0015) {
	let previousSign = 0;
	let turns = 0;
	for (let index = 1; index < values.length; index += 1) {
		const delta = values[index] - values[index - 1];
		const sign = delta > epsilon ? 1 : delta < -epsilon ? -1 : 0;
		if (sign === 0) continue;
		if (previousSign !== 0 && sign !== previousSign) turns += 1;
		previousSign = sign;
	}
	return turns;
}

function longestNearFlatRun(values, epsilon = 0.0012) {
	let current = 1;
	let longest = values.length ? 1 : 0;
	for (let index = 1; index < values.length; index += 1) {
		if (Math.abs(values[index] - values[index - 1]) <= epsilon) current += 1;
		else current = 1;
		longest = Math.max(longest, current);
	}
	return longest;
}

const evidence = {};
for (const chain of REFERENCE_RELIEF_CHAINS) {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	const compiled = chain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
	const coreScales = [];
	const shoulderScales = [];
	const crestHeights = [];
	const bilateralShoulder = [];
	const gullySamples = [];
	const ribSamples = [];
	const headwallSamples = [];
	let dryCrestSamples = 0;

	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		const a = chain.points[segmentIndex];
		const b = chain.points[segmentIndex + 1];
		for (let step = 1; step <= 23; step += 1) {
			const t = step / 24;
			const x = a[0] + (b[0] - a[0]) * t;
			const y = a[1] + (b[1] - a[1]) * t;
			const frame = sampleMountainRidgeFrame(x, y, compiled, MAP_ASPECT);
			const seed = profile.seed + segmentIndex * 61;
			const core = sampleMountainLandformDetailContext(
				x,
				y,
				compiled,
				MAP_ASPECT,
				0.05,
				seed,
				profile.landformDetailStrength,
			);
			coreScales.push(core.heightScale);

			const lateralDistance = profile.outerWidthNormalized * 0.58;
			const leftPoint = offsetMountainFramePoint(frame, -lateralDistance, 0, MAP_ASPECT);
			const rightPoint = offsetMountainFramePoint(frame, lateralDistance, 0, MAP_ASPECT);
			const left = sampleMountainLandformDetailContext(
				leftPoint.x,
				leftPoint.y,
				compiled,
				MAP_ASPECT,
				0.58,
				seed,
				profile.landformDetailStrength,
			);
			const right = sampleMountainLandformDetailContext(
				rightPoint.x,
				rightPoint.y,
				compiled,
				MAP_ASPECT,
				0.58,
				seed,
				profile.landformDetailStrength,
			);
			shoulderScales.push(left.heightScale, right.heightScale);
			bilateralShoulder.push(Math.abs(left.heightScale - right.heightScale));
			gullySamples.push(left.gullyExposure, right.gullyExposure);
			ribSamples.push(left.ribExposure, right.ribExposure);
			headwallSamples.push(left.headwallExposure, right.headwallExposure);

			if (sampleReferenceDryLandWeight(x, y) >= 0.90) {
				const height = sampleNormalizedReferenceMountainReliefMeters(x, y);
				if (height > 5) {
					crestHeights.push(height);
					dryCrestSamples += 1;
				}
			}
		}
	}

	const coreTurns = countTurningPoints(coreScales);
	const shoulderTurns = countTurningPoints(shoulderScales);
	const coreRange = Math.max(...coreScales) - Math.min(...coreScales);
	const shoulderRange = Math.max(...shoulderScales) - Math.min(...shoulderScales);
	const flatRun = longestNearFlatRun(coreScales);
	assert(coreScales.length >= 60, `${chain.id}: core silhouette sampling too small`);
	assert(coreRange > 0.025, `${chain.id}: core massing remains visually flat`);
	assert(shoulderRange > 0.045, `${chain.id}: shoulders lack erosion breakup`);
	assert(coreTurns >= 4, `${chain.id}: core profile has too few saddle/massif turns`);
	assert(shoulderTurns >= 8, `${chain.id}: shoulder profile has too few local-form turns`);
	assert(flatRun <= Math.ceil(coreScales.length * 0.30), `${chain.id}: an excessively long near-flat wall run remains`);
	assert(percentile(gullySamples, 0.90) > 0.04, `${chain.id}: gully signal too weak for wall breakup`);
	assert(percentile(ribSamples, 0.90) > 0.08, `${chain.id}: interfluve signal too weak for wall breakup`);
	assert(percentile(bilateralShoulder, 0.90) > 0.003, `${chain.id}: lateral shoulders remain mirror-symmetric`);
	assert(percentile(bilateralShoulder, 0.99) < 0.18, `${chain.id}: wall breakup became an extreme one-sided face`);
	assert(dryCrestSamples >= 8, `${chain.id}: insufficient dry actual-relief crest samples`);
	assert(Math.max(...crestHeights) - Math.min(...crestHeights) > 10, `${chain.id}: shipped crest heights remain unnaturally constant`);

	evidence[chain.id] = {
		coreSamples: coreScales.length,
		coreRange: rounded(coreRange),
		shoulderRange: rounded(shoulderRange),
		coreTurns,
		shoulderTurns,
		longestNearFlatRun: flatRun,
		gullyP90: rounded(percentile(gullySamples, 0.90)),
		ribP90: rounded(percentile(ribSamples, 0.90)),
		headwallP90: rounded(percentile(headwallSamples, 0.90)),
		bilateralP90: rounded(percentile(bilateralShoulder, 0.90)),
		dryCrestSamples,
		crestRangeMeters: rounded(Math.max(...crestHeights) - Math.min(...crestHeights), 3),
	};
}

for (const id of ['bone-mountains', 'eastern-chain']) {
	const chain = evidence[id];
	assert(chain.coreTurns >= 6, `${id}: shipped owner-RCA wall range needs stronger longitudinal segmentation`);
	assert(chain.shoulderTurns >= 12, `${id}: shipped owner-RCA wall range needs stronger shoulder erosion`);
	assert(chain.crestRangeMeters >= 35, `${id}: major range crest remains too plateau-like`);
}

console.log('MOUNTAIN_WALL_SILHOUETTE_BREAKUP_OK', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	evidence,
}));

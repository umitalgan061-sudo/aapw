#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const TARGETS = new Set(['bone-mountains', 'eastern-chain']);
const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const rounded = (value, digits = 4) => Number(value.toFixed(digits));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const standardDeviation = (values) => {
	const center = mean(values);
	return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
};
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
};

function longestFlatRun(values, toleranceMeters) {
	let longest = 1;
	let current = 1;
	for (let index = 1; index < values.length; index += 1) {
		if (Math.abs(values[index] - values[index - 1]) <= toleranceMeters) {
			current += 1;
			longest = Math.max(longest, current);
		} else {
			current = 1;
		}
	}
	return longest;
}

function localExtremaCount(values, minimumProminenceMeters) {
	let count = 0;
	for (let index = 1; index < values.length - 1; index += 1) {
		const left = values[index] - values[index - 1];
		const right = values[index + 1] - values[index];
		if (left * right >= 0) continue;
		if (Math.max(Math.abs(left), Math.abs(right)) >= minimumProminenceMeters) count += 1;
	}
	return count;
}

const evidence = {};
for (const chain of REFERENCE_RELIEF_CHAINS.filter(({ id }) => TARGETS.has(id))) {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	assert(profile, `${chain.id}: live mountain profile missing`);
	const centerline = [];
	const shoulderLeft = [];
	const shoulderRight = [];
	const bilateralDeltas = [];
	const crossSectionRelief = [];

	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		const a = chain.points[segmentIndex];
		const b = chain.points[segmentIndex + 1];
		const dxAspect = (b[0] - a[0]) * MAP_ASPECT;
		const dy = b[1] - a[1];
		const length = Math.hypot(dxAspect, dy);
		if (length <= 1e-12) continue;
		const normalX = -dy / length;
		const normalY = dxAspect / length;
		for (let step = 1; step <= 40; step += 1) {
			const t = step / 41;
			const x = a[0] + (b[0] - a[0]) * t;
			const y = a[1] + (b[1] - a[1]) * t;
			if (sampleReferenceDryLandWeight(x, y) < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;
			const center = sampleNormalizedReferenceMountainReliefMeters(x, y);
			if (center <= 2) continue;
			centerline.push(center);

			const lateral = profile.outerWidthNormalized * 0.42;
			const ox = normalX * lateral / MAP_ASPECT;
			const oy = normalY * lateral;
			const leftX = x + ox;
			const leftY = y + oy;
			const rightX = x - ox;
			const rightY = y - oy;
			if ([leftX, leftY, rightX, rightY].some((value) => value < 0 || value > 1)) continue;
			const left = sampleNormalizedReferenceMountainReliefMeters(leftX, leftY);
			const right = sampleNormalizedReferenceMountainReliefMeters(rightX, rightY);
			if (left <= 0 || right <= 0) continue;
			shoulderLeft.push(left);
			shoulderRight.push(right);
			bilateralDeltas.push(Math.abs(left - right));
			crossSectionRelief.push(center - Math.min(left, right));
		}
	}

	assert(centerline.length >= 25, `${chain.id}: insufficient source-owned centerline silhouette coverage`);
	assert(bilateralDeltas.length >= 15, `${chain.id}: insufficient two-sided shoulder coverage`);
	const centerMean = mean(centerline);
	const centerStd = standardDeviation(centerline);
	const p10 = percentile(centerline, 0.10);
	const p90 = percentile(centerline, 0.90);
	const dynamicRange = p90 - p10;
	const coefficientVariation = centerStd / Math.max(centerMean, 1e-9);
	const flatRun = longestFlatRun(centerline, 4);
	const extrema = localExtremaCount(centerline, 5);
	const bilateralP75 = percentile(bilateralDeltas, 0.75);
	const bilateralP95 = percentile(bilateralDeltas, 0.95);
	const sectionMedian = percentile(crossSectionRelief, 0.50);

	assert(dynamicRange > profile.peakMeters * 0.16,
		`${chain.id}: long-range crest remains too uniform (${dynamicRange.toFixed(1)}m p10-p90 range)`);
	assert(coefficientVariation > 0.09,
		`${chain.id}: centerline height variation is too low for a natural massif (${coefficientVariation.toFixed(3)})`);
	assert(flatRun <= Math.max(8, Math.floor(centerline.length * 0.24)),
		`${chain.id}: crest contains an excessively long <=4m flat run (${flatRun}/${centerline.length})`);
	assert(extrema >= 3, `${chain.id}: silhouette lacks measurable peaks/saddles (${extrema})`);
	assert(bilateralP75 > 4,
		`${chain.id}: left/right shoulders remain suspiciously mirror-symmetric (${bilateralP75.toFixed(1)}m p75)`);
	assert(bilateralP95 < profile.peakMeters * 0.70,
		`${chain.id}: bilateral asymmetry is so large that the range risks a one-sided wall`);
	assert(sectionMedian > profile.peakMeters * 0.10,
		`${chain.id}: center-to-shoulder profile is too flat to read as mountain relief`);

	evidence[chain.id] = {
		centerlineSamples: centerline.length,
		bilateralSections: bilateralDeltas.length,
		centerMeanMeters: rounded(centerMean, 2),
		centerStdMeters: rounded(centerStd, 2),
		centerCoefficientVariation: rounded(coefficientVariation),
		centerP10Meters: rounded(p10, 2),
		centerP90Meters: rounded(p90, 2),
		p10P90RangeMeters: rounded(dynamicRange, 2),
		longestFlatRun4m: flatRun,
		localExtrema5m: extrema,
		bilateralDeltaP75Meters: rounded(bilateralP75, 2),
		bilateralDeltaP95Meters: rounded(bilateralP95, 2),
		centerToShoulderMedianMeters: rounded(sectionMedian, 2),
	};
}

assert.deepEqual(Object.keys(evidence).sort(), [...TARGETS].sort());
console.log('MOUNTAIN_WALL_SILHOUETTE_BREAKUP_OK', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	evidence,
}));

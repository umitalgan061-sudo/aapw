#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY,
	sampleMountainGeomorphologyContext,
	sampleMountainGeomorphologyScale,
} from '../src/3d/world/worldReferenceMountainGeomorphology.js';
import {
	offsetMountainFramePoint,
	sampleMountainRidgeFrame,
} from '../src/3d/world/worldReferenceMountainRidgeFrame.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
};
const variance = (values) => {
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
};

const policy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY;
assert.match(policy.id, /eroded-ridge-frame/, 'geomorphology policy id lost ridge-frame provenance');
assert(policy.heightScale.minimum >= 0.70, 'geomorphology can erase too much canonical relief');
assert(policy.heightScale.maximum <= 1.15, 'geomorphology can over-amplify canonical relief');
assert(policy.ridgeAsymmetry.strength <= 0.10, 'ridge asymmetry exceeds bounded visual envelope');
assert(policy.shoulderIncision.end < 1, 'incision must finish inside canonical shoulder support');
assert(policy.outerEdgeFadeEnd < 1, 'geomorphology must return toward neutral before support edge');

const evidence = {};
const allScales = [];
const allTalus = [];
const allBedrock = [];
for (const chain of REFERENCE_RELIEF_CHAINS) {
	const compiled = chain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
	const scales = [];
	const leftRightDeltas = [];
	const edgeDeltas = [];
	const incisionScales = [];
	const spurScales = [];
	const talus = [];
	const bedrock = [];
	const progressBuckets = new Set();
	let deterministicSamples = 0;

	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		const a = chain.points[segmentIndex];
		const b = chain.points[segmentIndex + 1];
		for (let step = 1; step <= 19; step += 1) {
			const t = step / 20;
			const x = a[0] + (b[0] - a[0]) * t;
			const y = a[1] + (b[1] - a[1]) * t;
			const centerFrame = sampleMountainRidgeFrame(x, y, compiled, MAP_ASPECT);
			progressBuckets.add(Math.round(centerFrame.progress * 20));

			for (const normalizedDistance of [0.04, 0.18, 0.34, 0.52, 0.70, 0.88, 0.975]) {
				const physicalDistance = normalizedDistance * 0.08;
				const leftPoint = offsetMountainFramePoint(centerFrame, -physicalDistance, 0, MAP_ASPECT);
				const rightPoint = offsetMountainFramePoint(centerFrame, physicalDistance, 0, MAP_ASPECT);
				const left = sampleMountainGeomorphologyContext(
					leftPoint.x,
					leftPoint.y,
					compiled,
					MAP_ASPECT,
					normalizedDistance,
					17 + segmentIndex * 101,
				);
				const right = sampleMountainGeomorphologyContext(
					rightPoint.x,
					rightPoint.y,
					compiled,
					MAP_ASPECT,
					normalizedDistance,
					17 + segmentIndex * 101,
				);

				for (const context of [left, right]) {
					assert(context.heightScale >= policy.heightScale.minimum - 1e-12, `${chain.id}: scale below policy minimum`);
					assert(context.heightScale <= policy.heightScale.maximum + 1e-12, `${chain.id}: scale above policy maximum`);
					assert(context.progress >= 0 && context.progress <= 1, `${chain.id}: context progress escaped [0,1]`);
					assert(context.talusExposure >= 0 && context.talusExposure <= 1, `${chain.id}: talus exposure escaped [0,1]`);
					assert(context.bedrockExposure >= 0 && context.bedrockExposure <= 1, `${chain.id}: bedrock exposure escaped [0,1]`);
					for (const value of [
						context.longitudinalMassing,
						context.ridgeAsymmetry,
						context.crestNotch,
						context.shoulderIncision,
						context.secondarySpur,
						context.outerEdgeFade,
					]) {
						assert(Number.isFinite(value) && value > 0, `${chain.id}: invalid geomorphology component`);
					}
					scales.push(context.heightScale);
					talus.push(context.talusExposure);
					bedrock.push(context.bedrockExposure);
					if (normalizedDistance >= 0.24 && normalizedDistance <= 0.94) incisionScales.push(context.shoulderIncision);
					if (normalizedDistance >= 0.30 && normalizedDistance <= 0.88) spurScales.push(context.secondarySpur);
				}
				leftRightDeltas.push(Math.abs(left.heightScale - right.heightScale));
				if (normalizedDistance >= policy.outerEdgeFadeEnd) {
					edgeDeltas.push(Math.abs(left.heightScale - 1), Math.abs(right.heightScale - 1));
				}

				const repeat = sampleMountainGeomorphologyScale(
					leftPoint.x,
					leftPoint.y,
					compiled,
					MAP_ASPECT,
					normalizedDistance,
					17 + segmentIndex * 101,
				);
				assert.equal(repeat, left.heightScale, `${chain.id}: scalar/context deterministic parity drifted`);
				deterministicSamples += 1;
			}
		}
	}

	assert(scales.length >= 200, `${chain.id}: insufficient morphology sampling`);
	assert(progressBuckets.size >= 12, `${chain.id}: longitudinal field coverage is too narrow`);
	assert(variance(scales) > 0.00008, `${chain.id}: morphology field is effectively flat`);
	assert(Math.max(...scales) - Math.min(...scales) > 0.06, `${chain.id}: morphology has insufficient dynamic range`);
	assert(percentile(leftRightDeltas, 0.75) > 0.002, `${chain.id}: bilateral ridge asymmetry is not measurable`);
	assert(Math.max(...leftRightDeltas) < 0.18, `${chain.id}: bilateral ridge asymmetry becomes a wall`);
	assert(Math.max(...edgeDeltas) <= 0.012, `${chain.id}: morphology does not neutralize at outer support edge`);
	assert(Math.min(...incisionScales) < 0.995, `${chain.id}: shoulder incision never activates`);
	assert(Math.max(...spurScales) > 1.003, `${chain.id}: secondary spur signal never activates`);
	assert(talus.some((value) => value > 0.08), `${chain.id}: talus context never becomes meaningful`);
	assert(bedrock.some((value) => value > 0.18), `${chain.id}: bedrock context never becomes meaningful`);

	allScales.push(...scales);
	allTalus.push(...talus);
	allBedrock.push(...bedrock);
	evidence[chain.id] = {
		samples: scales.length,
		deterministicSamples,
		scaleMin: rounded(Math.min(...scales)),
		scaleP20: rounded(percentile(scales, 0.20)),
		scaleMedian: rounded(percentile(scales, 0.50)),
		scaleP80: rounded(percentile(scales, 0.80)),
		scaleMax: rounded(Math.max(...scales)),
		scaleVariance: rounded(variance(scales), 8),
		bilateralDeltaP75: rounded(percentile(leftRightDeltas, 0.75)),
		bilateralDeltaMax: rounded(Math.max(...leftRightDeltas)),
		maxOuterEdgeDelta: rounded(Math.max(...edgeDeltas)),
		talusMax: rounded(Math.max(...talus)),
		bedrockMax: rounded(Math.max(...bedrock)),
	};
}

assert(variance(allScales) > 0.0001, 'full-world mountain geomorphology field lacks useful variance');
assert(percentile(allTalus, 0.90) > 0.03, 'full-world talus field is too weak');
assert(percentile(allBedrock, 0.90) > 0.15, 'full-world bedrock field is too weak');

const chain = REFERENCE_RELIEF_CHAINS[0];
const compiled = chain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
assert.throws(
	() => sampleMountainGeomorphologyScale(0.2, 0.4, compiled, MAP_ASPECT, -0.01, 1),
	/\[0,1\]/,
	'negative normalized distance must fail closed',
);
assert.throws(
	() => sampleMountainGeomorphologyScale(0.2, 0.4, compiled, MAP_ASPECT, 1.01, 1),
	/\[0,1\]/,
	'out-of-support normalized distance must fail closed',
);

console.log('MOUNTAIN_GEOMORPHOLOGY_FIELD_OK', JSON.stringify({
	policyId: policy.id,
	chainCount: REFERENCE_RELIEF_CHAINS.length,
	globalScaleRange: [rounded(Math.min(...allScales)), rounded(Math.max(...allScales))],
	talusP90: rounded(percentile(allTalus, 0.90)),
	bedrockP90: rounded(percentile(allBedrock, 0.90)),
	evidence,
}));

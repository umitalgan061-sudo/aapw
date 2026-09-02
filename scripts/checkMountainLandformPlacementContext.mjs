#!/usr/bin/env node
import assert from 'node:assert/strict';

import { REFERENCE_RELIEF_CHAINS, WORLD_REFERENCE_MAP } from '../src/3d/world/worldReferenceMap.js';
import { WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY } from '../src/3d/world/worldReferenceMountainRelief.js';
import { sampleMountainLandformDetailContext } from '../src/3d/world/worldReferenceMountainLandformDetail.js';
import { offsetMountainFramePoint, sampleMountainRidgeFrame } from '../src/3d/world/worldReferenceMountainRidgeFrame.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const DISTANCES = Object.freeze([0.10, 0.22, 0.34, 0.48, 0.62, 0.76, 0.90, 0.985]);
const rounded = (value, digits = 6) => Number(value.toFixed(digits));

function mean(values) {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, fraction) {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) * fraction)];
}

const global = {
	upperCliff: [],
	midScree: [],
	lowerDeposition: [],
	upperSnowRetention: [],
	edgeCliff: [],
	edgeScree: [],
	edgeDeposition: [],
	cliffCandidates: 0,
	screeCandidates: 0,
	depositionCandidates: 0,
	snowRetentionCandidates: 0,
	samples: 0,
};
const evidence = {};

for (const chain of REFERENCE_RELIEF_CHAINS) {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	const compiled = chain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
	const chainEvidence = {
		upperCliff: [],
		midScree: [],
		lowerDeposition: [],
		edgePotential: [],
		cliffCandidates: 0,
		screeCandidates: 0,
		depositionCandidates: 0,
		snowRetentionCandidates: 0,
		samples: 0,
	};

	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		const a = chain.points[segmentIndex];
		const b = chain.points[segmentIndex + 1];
		for (let step = 1; step <= 13; step += 1) {
			const t = step / 14;
			const x = a[0] + (b[0] - a[0]) * t;
			const y = a[1] + (b[1] - a[1]) * t;
			const frame = sampleMountainRidgeFrame(x, y, compiled, MAP_ASPECT);
			for (const normalizedDistance of DISTANCES) {
				for (const side of [-1, 1]) {
					const point = offsetMountainFramePoint(
						frame,
						side * normalizedDistance * profile.outerWidthNormalized,
						0,
						MAP_ASPECT,
					);
					const context = sampleMountainLandformDetailContext(
						point.x,
						point.y,
						compiled,
						MAP_ASPECT,
						normalizedDistance,
						profile.seed + segmentIndex * 53,
						profile.landformDetailStrength,
					);
					chainEvidence.samples += 1;
					global.samples += 1;

					if (normalizedDistance <= 0.48) {
						chainEvidence.upperCliff.push(context.cliffPotential);
						global.upperCliff.push(context.cliffPotential);
						global.upperSnowRetention.push(context.snowRetentionPotential);
					}
					if (normalizedDistance >= 0.34 && normalizedDistance <= 0.76) {
						chainEvidence.midScree.push(context.screePotential);
						global.midScree.push(context.screePotential);
					}
					if (normalizedDistance >= 0.62 && normalizedDistance <= 0.90) {
						chainEvidence.lowerDeposition.push(context.depositionPotential);
						global.lowerDeposition.push(context.depositionPotential);
					}
					if (normalizedDistance >= 0.985) {
						const edgePotential = Math.max(
							context.cliffPotential,
							context.screePotential,
							context.depositionPotential,
						);
						chainEvidence.edgePotential.push(edgePotential);
						global.edgeCliff.push(context.cliffPotential);
						global.edgeScree.push(context.screePotential);
						global.edgeDeposition.push(context.depositionPotential);
					}
					if (context.cliffPotential >= 0.12) {
						chainEvidence.cliffCandidates += 1;
						global.cliffCandidates += 1;
					}
					if (context.screePotential >= 0.12) {
						chainEvidence.screeCandidates += 1;
						global.screeCandidates += 1;
					}
					if (context.depositionPotential >= 0.12) {
						chainEvidence.depositionCandidates += 1;
						global.depositionCandidates += 1;
					}
					if (context.snowRetentionPotential >= 0.12) {
						chainEvidence.snowRetentionCandidates += 1;
						global.snowRetentionCandidates += 1;
					}
				}
			}
		}
	}

	assert(chainEvidence.samples >= 150, `${chain.id}: placement-context coverage too small`);
	assert(chainEvidence.cliffCandidates > 0, `${chain.id}: no cliff candidates`);
	assert(chainEvidence.screeCandidates > 0, `${chain.id}: no scree candidates`);
	assert(chainEvidence.depositionCandidates > 0, `${chain.id}: no deposition candidates`);
	assert(chainEvidence.snowRetentionCandidates > 0, `${chain.id}: no snow-retention candidates`);
	assert(percentile(chainEvidence.upperCliff, 0.90) > 0.03, `${chain.id}: upper cliff context too weak`);
	assert(percentile(chainEvidence.midScree, 0.90) > 0.03, `${chain.id}: mid-slope scree context too weak`);
	assert(percentile(chainEvidence.lowerDeposition, 0.90) > 0.03, `${chain.id}: lower deposition context too weak`);
	evidence[chain.id] = {
		samples: chainEvidence.samples,
		upperCliffP90: rounded(percentile(chainEvidence.upperCliff, 0.90)),
		midScreeP90: rounded(percentile(chainEvidence.midScree, 0.90)),
		lowerDepositionP90: rounded(percentile(chainEvidence.lowerDeposition, 0.90)),
		edgePotentialMax: rounded(Math.max(...chainEvidence.edgePotential)),
		cliffCandidates: chainEvidence.cliffCandidates,
		screeCandidates: chainEvidence.screeCandidates,
		depositionCandidates: chainEvidence.depositionCandidates,
		snowRetentionCandidates: chainEvidence.snowRetentionCandidates,
	};
}

assert(global.samples >= 1000, 'full-world placement-context coverage too small');
assert(global.cliffCandidates >= 20, 'cliff candidates are too sparse for material/geology consumers');
assert(global.screeCandidates >= 30, 'scree candidates are too sparse for material/geology consumers');
assert(global.depositionCandidates >= 30, 'deposition candidates are too sparse for ground-detail consumers');
assert(global.snowRetentionCandidates >= 20, 'snow-retention candidates are too sparse for climate consumers');
assert(percentile(global.upperCliff, 0.90) > mean(global.edgeCliff) + 0.02, 'cliff context does not separate upper slope from edge');
assert(percentile(global.midScree, 0.90) > mean(global.edgeScree) + 0.02, 'scree context does not separate mid slope from edge');
assert(percentile(global.lowerDeposition, 0.90) > mean(global.edgeDeposition) + 0.02, 'deposition context does not separate lower slope from edge');

console.log('MOUNTAIN_LANDFORM_PLACEMENT_CONTEXT_OK', JSON.stringify({
	samples: global.samples,
	cliffCandidates: global.cliffCandidates,
	screeCandidates: global.screeCandidates,
	depositionCandidates: global.depositionCandidates,
	snowRetentionCandidates: global.snowRetentionCandidates,
	upperCliffP90: rounded(percentile(global.upperCliff, 0.90)),
	midScreeP90: rounded(percentile(global.midScree, 0.90)),
	lowerDepositionP90: rounded(percentile(global.lowerDeposition, 0.90)),
	upperSnowRetentionP90: rounded(percentile(global.upperSnowRetention, 0.90)),
	evidence,
}));

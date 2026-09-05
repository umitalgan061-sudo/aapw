#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_PLACEMENT_QUERY_POLICY,
	getMountainPlacementQueryChainPolicy,
	sampleNormalizedMountainPlacementQuery,
	sampleNormalizedMountainPlacementQueryInto,
} from '../src/3d/world/worldReferenceMountainPlacementQuery.js';

const policy = WORLD_REFERENCE_MOUNTAIN_PLACEMENT_QUERY_POLICY;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
};

assert.match(policy.id, /conservative-interior/, 'placement query lost conservative-interior contract');
assert.equal(policy.mapSha256, WORLD_REFERENCE_MAP.sha256, 'placement query map provenance drifted');
assert(policy.minimumDryLandWeight >= 0.90, 'placement query dry-land gate became permissive');
assert(policy.minimumReliefMeters > 0, 'placement query must require positive mountain relief');
assert(policy.lakeClearanceNormalized > 0, 'placement query must keep a canonical lake clearance');
assert(policy.interiorFadeStart < policy.interiorFadeEnd, 'placement query interior fade is inverted');

const contextKeys = [
	'talusExposure',
	'bedrockExposure',
	'headwallExposure',
	'gullyExposure',
	'interfluveRibExposure',
	'cliffPotential',
	'screePotential',
	'depositionPotential',
	'snowRetentionPotential',
];
const evidence = {};
const validContexts = [];
const validWeights = [];
const reliefValues = [];
let deterministicChecks = 0;
let rejectedNearLakes = 0;

for (const chain of REFERENCE_RELIEF_CHAINS) {
	const chainPolicy = getMountainPlacementQueryChainPolicy(chain.id);
	assert(chainPolicy, `${chain.id}: missing placement query chain policy`);
	assert(chainPolicy.queryRatio > 0 && chainPolicy.queryRatio <= 0.60,
		`${chain.id}: conservative query ratio escaped policy ceiling`);
	assert(chainPolicy.queryWidthNormalized > 0, `${chain.id}: query width is not positive`);
	assert(chainPolicy.queryWidthNormalized < chainPolicy.baseOuterWidthNormalized,
		`${chain.id}: query width is not conservative`);

	let valid = 0;
	let rejected = 0;
	let chainMaxCliff = 0;
	let chainMaxScree = 0;
	let chainMaxTalus = 0;
	let chainMaxBedrock = 0;
	const progresses = [];

	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		const a = chain.points[segmentIndex];
		const b = chain.points[segmentIndex + 1];
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const length = Math.hypot(dx, dy) || 1;
		const nx = -dy / length;
		const ny = dx / length;
		for (let step = 1; step <= 15; step += 1) {
			const t = step / 16;
			const centerX = a[0] + dx * t;
			const centerY = a[1] + dy * t;
			for (const lateral of [-0.006, -0.003, 0, 0.003, 0.006]) {
				const x = centerX + nx * lateral;
				const y = centerY + ny * lateral;
				if (x < 0 || x > 1 || y < 0 || y > 1) continue;
				const out = {};
				const result = sampleNormalizedMountainPlacementQueryInto(x, y, out);
				assert.equal(result, out, 'Into placement query must return caller-owned object');
				const repeat = sampleNormalizedMountainPlacementQuery(x, y);
				for (const key of ['valid', 'chainId', 'reliefMeters', 'dryLandWeight', 'lakeDistanceNormalized']) {
					assert.equal(result[key], repeat[key], `${chain.id}: deterministic placement query drifted for ${key}`);
				}
				deterministicChecks += 1;

				if (!result.valid) {
					rejected += 1;
					if (result.lakeDistanceNormalized < policy.lakeClearanceNormalized) rejectedNearLakes += 1;
					continue;
				}

				valid += 1;
				assert.equal(result.chainId, chain.id,
					`${chain.id}: conservative near-center sample resolved to another mountain chain`);
				assert(result.dryLandWeight >= policy.minimumDryLandWeight - 1e-12,
					`${chain.id}: valid query escaped dry-land gate`);
				assert(result.reliefMeters >= policy.minimumReliefMeters - 1e-12,
					`${chain.id}: valid query escaped relief gate`);
				assert(result.lakeDistanceNormalized >= policy.lakeClearanceNormalized - 1e-12,
					`${chain.id}: valid query escaped lake clearance`);
				assert(result.queryInteriorWeight > 0 && result.queryInteriorWeight <= 1,
					`${chain.id}: invalid query interior weight`);
				assert(result.baseShoulderDistance >= 0 && result.baseShoulderDistance <= chainPolicy.queryRatio + 1e-12,
					`${chain.id}: valid query escaped conservative shoulder`);
				assert(result.progress >= 0 && result.progress <= 1, `${chain.id}: progress escaped [0,1]`);
				assert([-1, 0, 1].includes(result.side), `${chain.id}: invalid ridge side`);
				assert(Number.isFinite(result.heightScale) && result.heightScale > 0,
					`${chain.id}: invalid morphology height scale`);
				for (const key of contextKeys) {
					assert(Number.isFinite(result[key]), `${chain.id}: ${key} became non-finite`);
					assert(result[key] >= -1e-12 && result[key] <= 1 + 1e-12,
						`${chain.id}: ${key} escaped [0,1]`);
				}
				chainMaxCliff = Math.max(chainMaxCliff, result.cliffPotential);
				chainMaxScree = Math.max(chainMaxScree, result.screePotential);
				chainMaxTalus = Math.max(chainMaxTalus, result.talusExposure);
				chainMaxBedrock = Math.max(chainMaxBedrock, result.bedrockExposure);
				progresses.push(result.progress);
				validContexts.push(result.cliffPotential + result.screePotential + result.talusExposure);
				validWeights.push(result.queryInteriorWeight);
				reliefValues.push(result.reliefMeters);
			}
		}
	}

	assert(valid >= 8, `${chain.id}: conservative query exposes too few source-owned mountain candidates (${valid})`);
	assert(progresses.length === valid, `${chain.id}: progress evidence count drifted`);
	assert(Math.max(...progresses) - Math.min(...progresses) > 0.15,
		`${chain.id}: placement query only exposes a tiny longitudinal slice`);
	evidence[chain.id] = {
		valid,
		rejected,
		progressRange: [rounded(Math.min(...progresses)), rounded(Math.max(...progresses))],
		maxCliff: rounded(chainMaxCliff),
		maxScree: rounded(chainMaxScree),
		maxTalus: rounded(chainMaxTalus),
		maxBedrock: rounded(chainMaxBedrock),
	};
}

for (const [x, y] of [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99], [0.50, 0.98]]) {
	const result = sampleNormalizedMountainPlacementQuery(x, y);
	assert.equal(result.valid, false, `off-mountain control ${x}/${y} unexpectedly became placeable`);
}

assert(validContexts.length >= 40, 'full-world mountain placement query has insufficient valid evidence');
assert(percentile(reliefValues, 0.50) > policy.minimumReliefMeters,
	'valid placement query relief collapses onto the minimum threshold');
assert(percentile(validWeights, 0.25) > 0.10,
	'valid placement candidates hug the conservative interior fade boundary');
assert(Math.max(...validContexts) > 0.12,
	'mountain placement query never exposes meaningful geology context');
assert(deterministicChecks > 100, 'placement query deterministic coverage is too small');

assert.throws(() => sampleNormalizedMountainPlacementQuery(-0.01, 0.5), /\[0,1\]/);
assert.throws(() => sampleNormalizedMountainPlacementQuery(0.5, 1.01), /\[0,1\]/);
assert.equal(getMountainPlacementQueryChainPolicy('not-a-chain'), null);

console.log('MOUNTAIN_PLACEMENT_QUERY_OK', JSON.stringify({
	policyId: policy.id,
	chainCount: REFERENCE_RELIEF_CHAINS.length,
	deterministicChecks,
	validCandidates: validContexts.length,
	rejectedNearLakes,
	meanInteriorWeight: rounded(mean(validWeights)),
	medianReliefMeters: rounded(percentile(reliefValues, 0.50), 3),
	maxCombinedGeologyContext: rounded(Math.max(...validContexts)),
	evidence,
}));

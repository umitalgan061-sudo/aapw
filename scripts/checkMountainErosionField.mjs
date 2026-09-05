#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY,
	sampleMountainErosionFieldInto,
	sampleMountainErosionScale,
} from '../src/3d/world/worldReferenceMountainErosionField.js';

const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const variance = (values) => {
	const center = mean(values);
	return mean(values.map((value) => (value - center) ** 2));
};
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
	return sorted[index];
};

assert.match(policy.id, /ridge-local-drainage/, 'erosion policy lost ridge-local provenance');
assert(policy.heightScale.minimum >= 0.78, 'erosion field can erase too much canonical relief');
assert(policy.heightScale.maximum <= 1.12, 'erosion field can over-amplify canonical relief');
assert(policy.outerFadeStart < policy.outerFadeEnd, 'erosion outer fade is inverted');
assert(policy.outerFadeEnd < 1, 'erosion must neutralize before mountain support edge');
assert(policy.headwall.end < 0.70, 'headwall recess extends too far down the shoulder');
assert(policy.gullies.end < 0.95, 'gully field reaches too close to the support edge');
assert(policy.interfluveRibs.end < 0.94, 'rib field reaches too close to the support edge');

const scratch = {};
const repeatScratch = {};
const scales = [];
const headwalls = [];
const gullies = [];
const ribs = [];
const cliffs = [];
const scree = [];
const deposition = [];
const snow = [];
const outerDeltas = [];
const lowerApronStructure = [];
const middleSlopeStructure = [];
const sidePairs = [];
let deterministicSamples = 0;

for (const seed of [11, 23, 37, 53]) {
	for (let progressIndex = 0; progressIndex <= 160; progressIndex += 1) {
		const progress = progressIndex / 160;
		for (const side of [-1, 1]) {
			for (const normalizedDistance of [0.04, 0.12, 0.22, 0.34, 0.48, 0.60, 0.72, 0.84, 0.91, 0.98, 0.995]) {
				const result = sampleMountainErosionFieldInto(
					progress,
					normalizedDistance,
					side,
					seed,
					1,
					scratch,
				);
				const repeat = sampleMountainErosionFieldInto(
					progress,
					normalizedDistance,
					side,
					seed,
					1,
					repeatScratch,
				);
				for (const key of [
					'heightScale',
					'headwallExposure',
					'gullyExposure',
					'ribExposure',
					'convexConcave',
					'concavity',
					'outerFade',
					'cliffPotential',
					'screePotential',
					'depositionPotential',
					'snowRetentionPotential',
				]) {
					assert(Number.isFinite(result[key]), `${key} became non-finite`);
					assert.equal(result[key], repeat[key], `${key} lost deterministic repeatability`);
				}
				assert(result.heightScale >= policy.heightScale.minimum - 1e-12, 'height scale below policy minimum');
				assert(result.heightScale <= policy.heightScale.maximum + 1e-12, 'height scale above policy maximum');
				for (const key of [
					'headwallExposure', 'gullyExposure', 'ribExposure', 'concavity', 'outerFade',
					'cliffPotential', 'screePotential', 'depositionPotential', 'snowRetentionPotential',
				]) {
					assert(result[key] >= -1e-12 && result[key] <= 1 + 1e-12, `${key} escaped [0,1]`);
				}
				assert(result.convexConcave >= -1 - 1e-12 && result.convexConcave <= 1 + 1e-12,
					'convex/concave field escaped [-1,1]');

				const scalar = sampleMountainErosionScale(progress, normalizedDistance, side, seed, 1);
				assert.equal(scalar, result.heightScale, 'scalar/context erosion scale parity drifted');
				deterministicSamples += 1;
				scales.push(result.heightScale);
				headwalls.push(result.headwallExposure);
				gullies.push(result.gullyExposure);
				ribs.push(result.ribExposure);
				cliffs.push(result.cliffPotential);
				scree.push(result.screePotential);
				deposition.push(result.depositionPotential);
				snow.push(result.snowRetentionPotential);
				if (normalizedDistance >= policy.outerFadeEnd) {
					outerDeltas.push(Math.abs(result.heightScale - 1));
					assert(result.cliffPotential <= 1e-10, 'cliff context leaked beyond outer fade');
					assert(result.screePotential <= 1e-10, 'scree context leaked beyond outer fade');
				}
				const structure = result.gullyExposure + result.ribExposure + Math.abs(result.convexConcave);
				if (normalizedDistance >= 0.84) lowerApronStructure.push(structure * result.outerFade);
				if (normalizedDistance >= 0.34 && normalizedDistance <= 0.72) middleSlopeStructure.push(structure);
			}
		}
	}
}

for (let index = 0; index <= 100; index += 1) {
	const progress = index / 100;
	const left = sampleMountainErosionFieldInto(progress, 0.58, -1, 37, 1, {});
	const right = sampleMountainErosionFieldInto(progress, 0.58, 1, 37, 1, {});
	sidePairs.push(Math.abs(left.heightScale - right.heightScale));
}

assert(scales.length > 10000, 'erosion field qualification coverage is too small');
assert(variance(scales) > 0.00002, 'erosion height field is effectively flat');
assert(Math.min(...scales) < 0.975, 'erosion field never cuts the mountain shoulder');
assert(Math.max(...scales) > 1.005, 'interfluve ribs never raise local relief');
assert(Math.max(...headwalls) > 0.15, 'headwall recess field never activates');
assert(Math.max(...gullies) > 0.20, 'branching gully field never activates');
assert(Math.max(...ribs) > 0.20, 'interfluve rib field never activates');
assert(Math.max(...cliffs) > 0.10, 'cliff placement context never activates');
assert(Math.max(...scree) > 0.08, 'scree placement context never activates');
assert(Math.max(...deposition) > 0.05, 'deposition placement context never activates');
assert(Math.max(...snow) > 0.05, 'snow-retention placement context never activates');
assert(outerDeltas.length > 0 && Math.max(...outerDeltas) <= 1e-10,
	'erosion height field does not return to neutral before support edge');
assert(percentile(sidePairs, 0.80) > 0.001, 'ridge erosion has no measurable bilateral variation');
assert(percentile(sidePairs, 0.99) < 0.20, 'ridge erosion creates an excessive side-to-side wall');
assert(mean(lowerApronStructure) < mean(middleSlopeStructure) * 0.80,
	'lower mountain apron retains too much high-frequency erosion structure');

assert.throws(() => sampleMountainErosionScale(-0.01, 0.5, 1, 1), /\[0,1\]/);
assert.throws(() => sampleMountainErosionScale(0.5, 1.01, 1, 1), /\[0,1\]/);
assert.throws(() => sampleMountainErosionScale(0.5, 0.5, 2, 1), /-1, 0, or 1/);
assert.throws(() => sampleMountainErosionScale(0.5, 0.5, 1, 1, 0.2), /\[0.5,1.35\]/);

console.log('MOUNTAIN_EROSION_FIELD_OK', JSON.stringify({
	policyId: policy.id,
	deterministicSamples,
	heightScale: {
		min: rounded(Math.min(...scales)),
		p10: rounded(percentile(scales, 0.10)),
		median: rounded(percentile(scales, 0.50)),
		p90: rounded(percentile(scales, 0.90)),
		max: rounded(Math.max(...scales)),
		variance: rounded(variance(scales), 8),
	},
	exposureMax: {
		headwall: rounded(Math.max(...headwalls)),
		gully: rounded(Math.max(...gullies)),
		rib: rounded(Math.max(...ribs)),
		cliff: rounded(Math.max(...cliffs)),
		scree: rounded(Math.max(...scree)),
		deposition: rounded(Math.max(...deposition)),
		snowRetention: rounded(Math.max(...snow)),
	},
	apronToMidStructureRatio: rounded(mean(lowerApronStructure) / mean(middleSlopeStructure)),
}));

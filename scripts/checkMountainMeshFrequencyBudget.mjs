#!/usr/bin/env node
import assert from 'node:assert/strict';
import { CHUNK_CONFIG } from '../src/3d/config.js';
import {
	WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY,
	sampleMountainErosionFieldInto,
} from '../src/3d/world/worldReferenceMountainErosionField.js';

const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
};
const range = (values) => Math.max(...values) - Math.min(...values);

const desktopSpacingMeters = CHUNK_CONFIG.CHUNK_SIZE_METERS / CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP;
const mobileSpacingMeters = CHUNK_CONFIG.CHUNK_SIZE_METERS / CHUNK_CONFIG.TERRAIN_SEGMENTS_MOBILE;
assert(desktopSpacingMeters > 0, 'desktop terrain vertex spacing is invalid');
assert(mobileSpacingMeters > 0, 'mobile terrain vertex spacing is invalid');
assert(CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP >= 32, 'desktop terrain resolution too low for morphology qualification');
assert(CHUNK_CONFIG.TERRAIN_SEGMENTS_MOBILE >= 32, 'mobile terrain resolution too low for morphology qualification');

function sampleSeries({ seed, side, distance, steps }) {
	const values = [];
	const gullies = [];
	const ribs = [];
	const scratch = {};
	for (let index = 0; index <= steps; index += 1) {
		const progress = index / steps;
		const result = sampleMountainErosionFieldInto(progress, distance, side, seed, 1, scratch);
		values.push(result.heightScale);
		gullies.push(result.gullyExposure);
		ribs.push(result.ribExposure);
	}
	return { values, gullies, ribs };
}

function adjacentDeltas(values) {
	return values.slice(1).map((value, index) => value - values[index]);
}

function secondDeltas(values) {
	const first = adjacentDeltas(values);
	return first.slice(1).map((value, index) => value - first[index]);
}

function signAlternationRatio(deltas) {
	let compared = 0;
	let alternations = 0;
	let previous = 0;
	for (const value of deltas) {
		const sign = value < -1e-7 ? -1 : value > 1e-7 ? 1 : 0;
		if (sign === 0) continue;
		if (previous !== 0) {
			compared += 1;
			if (sign !== previous) alternations += 1;
		}
		previous = sign;
	}
	return compared ? alternations / compared : 0;
}

function blockAverages(values, block) {
	const result = [];
	for (let index = 0; index < values.length; index += block) {
		const slice = values.slice(index, Math.min(values.length, index + block));
		result.push(mean(slice));
	}
	return result;
}

const evidence = [];
const coarseAdjacent = [];
const coarseSecond = [];
const alternationRatios = [];
const retainedRanges = [];
const retainedMeans = [];

for (const seed of [11, 23, 37, 53]) {
	for (const side of [-1, 1]) {
		for (const distance of [0.28, 0.42, 0.58, 0.72, 0.84]) {
			const dense = sampleSeries({ seed, side, distance, steps: 512 });
			const coarse = sampleSeries({ seed, side, distance, steps: 128 });
			const meshLike = sampleSeries({ seed, side, distance, steps: 64 });
			const repeat = sampleSeries({ seed, side, distance, steps: 64 });
			assert.deepEqual(meshLike.values, repeat.values, 'mesh-frequency erosion series lost determinism');

			const adjacent = adjacentDeltas(meshLike.values);
			const second = secondDeltas(meshLike.values);
			const maxAdjacent = Math.max(...adjacent.map(Math.abs));
			const p95Second = percentile(second.map(Math.abs), 0.95);
			const alternation = signAlternationRatio(adjacent);
			const denseRange = range(dense.values);
			const meshRange = range(meshLike.values);
			const retainedRange = denseRange > 1e-9 ? meshRange / denseRange : 1;
			const denseMean = mean(dense.values);
			const meshMean = mean(meshLike.values);
			const meanDrift = Math.abs(meshMean - denseMean);
			const denseBlocks = blockAverages(dense.values, 8);
			const envelopeDelta = Math.abs(range(denseBlocks) - meshRange);

			assert(maxAdjacent < 0.22,
				`seed ${seed} distance ${distance}: adjacent erosion jump ${maxAdjacent} risks comb geometry`);
			assert(p95Second < 0.28,
				`seed ${seed} distance ${distance}: second-difference energy ${p95Second} risks mesh zig-zag`);
			assert(alternation < 0.82,
				`seed ${seed} distance ${distance}: erosion derivative alternates every vertex like a stripe pattern`);
			assert(retainedRange > 0.45,
				`seed ${seed} distance ${distance}: mesh-rate sampling loses most morphology variation`);
			assert(retainedRange < 1.45,
				`seed ${seed} distance ${distance}: mesh-rate sampling exaggerates morphology variation`);
			assert(meanDrift < 0.025,
				`seed ${seed} distance ${distance}: mesh-rate sampling biases average mountain height`);
			assert(envelopeDelta < 0.12,
				`seed ${seed} distance ${distance}: mesh-rate envelope diverges from dense field`);

			coarseAdjacent.push(maxAdjacent);
			coarseSecond.push(p95Second);
			alternationRatios.push(alternation);
			retainedRanges.push(retainedRange);
			retainedMeans.push(meanDrift);
			evidence.push({
				seed,
				side,
				distance,
				maxAdjacent: rounded(maxAdjacent),
				p95Second: rounded(p95Second),
				alternation: rounded(alternation),
				retainedRange: rounded(retainedRange),
				meanDrift: rounded(meanDrift),
			});
		}
	}
}

assert(evidence.length === 40, 'mesh-frequency evidence matrix coverage drifted');
assert(percentile(coarseAdjacent, 0.95) < 0.18, 'erosion field has excessive vertex-to-vertex height-scale jumps');
assert(percentile(coarseSecond, 0.95) < 0.22, 'erosion field has excessive high-frequency curvature');
assert(percentile(alternationRatios, 0.95) < 0.75, 'erosion field trends toward alternating stripe/moire structure');
assert(percentile(retainedRanges, 0.10) > 0.55, 'terrain-rate samples commonly erase erosion variation');
assert(percentile(retainedMeans, 0.95) < 0.015, 'terrain-rate samples commonly bias erosion mean');

console.log('MOUNTAIN_MESH_FREQUENCY_BUDGET_OK', JSON.stringify({
	policyId: policy.id,
	terrain: {
		chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
		desktopSegments: CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP,
		mobileSegments: CHUNK_CONFIG.TERRAIN_SEGMENTS_MOBILE,
		desktopSpacingMeters: rounded(desktopSpacingMeters, 4),
		mobileSpacingMeters: rounded(mobileSpacingMeters, 4),
	},
	matrixCount: evidence.length,
	p95AdjacentScaleDelta: rounded(percentile(coarseAdjacent, 0.95)),
	p95SecondScaleDelta: rounded(percentile(coarseSecond, 0.95)),
	p95AlternationRatio: rounded(percentile(alternationRatios, 0.95)),
	p10RetainedDenseRange: rounded(percentile(retainedRanges, 0.10)),
	p95MeanDrift: rounded(percentile(retainedMeans, 0.95)),
}));

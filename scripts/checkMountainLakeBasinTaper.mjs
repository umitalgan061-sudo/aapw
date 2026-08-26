#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	WORLD_REFERENCE_LAKE_CELL_COUNT,
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceLakeBasinScale,
	sampleReferenceLakeDistanceNormalized,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, '../src/3d/world/worldReferenceMountainRelief.js'), 'utf8');
const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.lakeBasinTaper;

assert.equal(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id, 'owner-map-live-mountain-relief-2026-08-26-v7-lake-basin-cirques');
assert(WORLD_REFERENCE_LAKE_CELL_COUNT >= 10, `canonical mask unexpectedly has only ${WORLD_REFERENCE_LAKE_CELL_COUNT} lake cells`);
assert(policy.innerRadiusNormalized >= 0.010 && policy.innerRadiusNormalized <= 0.020);
assert(policy.outerRadiusNormalized >= 0.040 && policy.outerRadiusNormalized <= 0.060);
assert(policy.outerRadiusNormalized >= policy.innerRadiusNormalized * 2.5);
assert(policy.minimumScale >= 0.12 && policy.minimumScale <= 0.25);
assert(SOURCE.includes('const LAKE_DISTANCE_FIELD = buildLakeDistanceField();'), 'lake distance field is no longer precomputed');
assert(SOURCE.includes('* sampleReferenceLakeBasinScale(normalizedX, normalizedY);'), 'mountain relief no longer consumes lake-basin scale');

let minScale = 1;
let maxScale = 0;
let minDistance = Infinity;
let maxDistance = 0;
let basinSamples = 0;
let transitionSamples = 0;
let untouchedSamples = 0;
let reliefInBasinSamples = 0;
let strongestBasinReliefMeters = 0;
let strongestSuppressionPotentialMeters = 0;
let nearestReliefSample = null;

for (let y = 0; y <= 160; y += 1) {
	for (let x = 0; x <= 220; x += 1) {
		const nx = x / 220;
		const ny = y / 160;
		const distance = sampleReferenceLakeDistanceNormalized(nx, ny);
		const scale = sampleReferenceLakeBasinScale(nx, ny);
		const relief = sampleNormalizedReferenceMountainReliefMeters(nx, ny);
		assert(Number.isFinite(distance) && distance >= 0, `invalid lake distance at ${nx}/${ny}`);
		assert(Number.isFinite(scale) && scale >= policy.minimumScale - 1e-8 && scale <= 1 + 1e-8, `invalid basin scale at ${nx}/${ny}`);
		assert(Number.isFinite(relief) && relief >= 0, `invalid relief at ${nx}/${ny}`);
		minScale = Math.min(minScale, scale);
		maxScale = Math.max(maxScale, scale);
		minDistance = Math.min(minDistance, distance);
		maxDistance = Math.max(maxDistance, distance);
		if (scale < 0.95) basinSamples += 1;
		if (scale > policy.minimumScale + 0.08 && scale < 0.92) transitionSamples += 1;
		if (scale >= 0.999999) untouchedSamples += 1;
		if (relief > 0 && scale < 0.95) {
			reliefInBasinSamples += 1;
			strongestBasinReliefMeters = Math.max(strongestBasinReliefMeters, relief);
			const inferredUntapered = relief / Math.max(scale, 1e-6);
			strongestSuppressionPotentialMeters = Math.max(strongestSuppressionPotentialMeters, inferredUntapered - relief);
			if (!nearestReliefSample || distance < nearestReliefSample.distance) {
				nearestReliefSample = { nx, ny, distance, scale, relief };
			}
		}
	}
}

assert(minDistance <= 0.008, `dense grid failed to approach canonical lake cells: ${minDistance}`);
assert(minScale <= policy.minimumScale + 0.03, `lake center attenuation is too weak: ${minScale}`);
assert(maxScale >= 0.999999, 'far-land mountain relief must retain scale 1');
assert(basinSamples >= 250, `lake basin footprint is too small to remove crater rings: ${basinSamples}`);
assert(transitionSamples >= 120, `lake basin taper lacks a broad transition band: ${transitionSamples}`);
assert(untouchedSamples > basinSamples * 5, 'lake basin taper affects too much of the owner map');
assert(reliefInBasinSamples >= 8, `canonical mountain chains do not materially intersect lake basin taper: ${reliefInBasinSamples}`);
assert(strongestSuppressionPotentialMeters >= 35,
	`lake basin taper does not remove enough vertical relief to matter visually: ${strongestSuppressionPotentialMeters}`);
assert(nearestReliefSample && nearestReliefSample.scale < 0.90,
	'nearest mountain relief to a lake is not actually attenuated');

for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5], [0.95, 0.15]]) {
	const a = sampleReferenceLakeBasinScale(x, y);
	const b = sampleReferenceLakeBasinScale(x, y);
	assert.equal(a, b, 'lake basin scale must be deterministic');
}

console.log('[checkMountainLakeBasinTaper] PASS', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	lakeCellCount: WORLD_REFERENCE_LAKE_CELL_COUNT,
	innerRadiusNormalized: policy.innerRadiusNormalized,
	outerRadiusNormalized: policy.outerRadiusNormalized,
	minimumScale: policy.minimumScale,
	minScale: Number(minScale.toFixed(3)),
	basinSamples,
	transitionSamples,
	untouchedSamples,
	reliefInBasinSamples,
	strongestBasinReliefMeters: Number(strongestBasinReliefMeters.toFixed(2)),
	strongestSuppressionPotentialMeters: Number(strongestSuppressionPotentialMeters.toFixed(2)),
	nearestReliefSample: nearestReliefSample && {
		nx: Number(nearestReliefSample.nx.toFixed(4)),
		ny: Number(nearestReliefSample.ny.toFixed(4)),
		distance: Number(nearestReliefSample.distance.toFixed(4)),
		scale: Number(nearestReliefSample.scale.toFixed(3)),
		relief: Number(nearestReliefSample.relief.toFixed(2)),
	},
}));

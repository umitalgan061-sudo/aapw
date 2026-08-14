#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sampleReferenceWaterMask } from '../src/3d/world/worldReferenceWaterMask.js';
import {
	WORLD_REFERENCE_RELIEF_POLICY,
	sampleWorldReferenceRelief,
	createWorldReferenceReliefHeightSampler,
} from '../godot/terrain-authoring/lib/worldReferenceReliefField.mjs';

const G10 = Object.freeze({ xMin: 1 / 8, xMax: 2 / 8, yMin: 0, yMax: 1 / 8 });
const DENSE_SIZE = 257;
const EPSILON = 1e-5;

function hydrologyAt(x, y) {
	const water = sampleReferenceWaterMask(x, y);
	return Object.freeze({ water, land: !water, protectedLand: false });
}

function sampleDense() {
	let waterSamples = 0;
	let landSamples = 0;
	let maxWaterDelta = 0;
	let minLandDelta = Infinity;
	let maxLandDelta = -Infinity;
	let sumLandDelta = 0;
	let positiveLandSamples = 0;
	const values = [];

	for (let row = 0; row < DENSE_SIZE; row += 1) {
		const y = G10.yMin + (G10.yMax - G10.yMin) * row / (DENSE_SIZE - 1);
		for (let col = 0; col < DENSE_SIZE; col += 1) {
			const x = G10.xMin + (G10.xMax - G10.xMin) * col / (DENSE_SIZE - 1);
			const hydrology = hydrologyAt(x, y);
			const result = sampleWorldReferenceRelief(x, y, hydrology);
			values.push(Number(result.heightDeltaMeters.toFixed(6)));
			if (hydrology.water) {
				waterSamples += 1;
				maxWaterDelta = Math.max(maxWaterDelta, Math.abs(result.heightDeltaMeters));
				assert.equal(result.land, false, `water classified as relief land at ${x},${y}`);
				continue;
			}
			landSamples += 1;
			minLandDelta = Math.min(minLandDelta, result.heightDeltaMeters);
			maxLandDelta = Math.max(maxLandDelta, result.heightDeltaMeters);
			sumLandDelta += result.heightDeltaMeters;
			if (result.heightDeltaMeters > 0.01) positiveLandSamples += 1;
		}
	}

	return {
		waterSamples,
		landSamples,
		maxWaterDelta,
		minLandDelta,
		maxLandDelta,
		meanLandDelta: sumLandDelta / landSamples,
		positiveLandRatio: positiveLandSamples / landSamples,
		checksum: crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex'),
	};
}

function sourceFingerprint() {
	let water = 0;
	let land = 0;
	for (let row = 0; row < 8; row += 1) {
		const y = G10.yMin + (row + 0.5) / 8 * (G10.yMax - G10.yMin);
		for (let col = 0; col < 12; col += 1) {
			const x = G10.xMin + (col + 0.5) / 12 * (G10.xMax - G10.xMin);
			if (sampleReferenceWaterMask(x, y)) water += 1;
			else land += 1;
		}
	}
	return { water, land };
}

function derivativeContinuity() {
	const probes = [];
	const step = 1 / 8192;
	// Probe all G10 edges and several interior transects. The field has no special GeoCell term, so
	// one-sided derivative jumps should remain small wherever hydrology class is unchanged.
	for (let index = 1; index < 64; index += 1) {
		const t = index / 64;
		probes.push([G10.xMin + (G10.xMax - G10.xMin) * t, G10.yMin + 0.03125]);
		probes.push([G10.xMin + (G10.xMax - G10.xMin) * t, G10.yMin + 0.09375]);
	}

	let maxJump = 0;
	let checked = 0;
	for (const [x, y] of probes) {
		if (x - 2 * step <= 0 || x + 2 * step >= 1) continue;
		const h = [
			hydrologyAt(x - 2 * step, y),
			hydrologyAt(x - step, y),
			hydrologyAt(x, y),
			hydrologyAt(x + step, y),
			hydrologyAt(x + 2 * step, y),
		];
		if (!h.every((entry) => entry.water === h[0].water)) continue;
		const v = [
			sampleWorldReferenceRelief(x - 2 * step, y, h[0]).heightDeltaMeters,
			sampleWorldReferenceRelief(x - step, y, h[1]).heightDeltaMeters,
			sampleWorldReferenceRelief(x, y, h[2]).heightDeltaMeters,
			sampleWorldReferenceRelief(x + step, y, h[3]).heightDeltaMeters,
			sampleWorldReferenceRelief(x + 2 * step, y, h[4]).heightDeltaMeters,
		];
		const left = (v[2] - v[0]) / (2 * step);
		const right = (v[4] - v[2]) / (2 * step);
		maxJump = Math.max(maxJump, Math.abs(left - right));
		checked += 1;
	}
	return { checked, maxDerivativeJump: maxJump };
}

function wrapperContract() {
	const base = (x, z) => 10 + x * 0.001 + z * 0.001;
	const worldToNormalized = (x, z) => ({ x, y: z });
	const wrapper = createWorldReferenceReliefHeightSampler({
		baseHeightSampler: base,
		hydrologySampler: hydrologyAt,
		worldToNormalized,
	});
	const landPoint = { x: 0.145, y: 0.115 };
	const waterPoint = { x: 0.20, y: 0.02 };
	const landHydrology = hydrologyAt(landPoint.x, landPoint.y);
	const waterHydrology = hydrologyAt(waterPoint.x, waterPoint.y);
	const landRelief = sampleWorldReferenceRelief(landPoint.x, landPoint.y, landHydrology).heightDeltaMeters;
	const waterRelief = sampleWorldReferenceRelief(waterPoint.x, waterPoint.y, waterHydrology).heightDeltaMeters;
	assert.ok(Math.abs(wrapper(landPoint.x, landPoint.y) - (base(landPoint.x, landPoint.y) + landRelief)) < 1e-9);
	assert.ok(Math.abs(wrapper(waterPoint.x, waterPoint.y) - (base(waterPoint.x, waterPoint.y) + waterRelief)) < 1e-9);
}

const fingerprint = sourceFingerprint();
assert.deepEqual(fingerprint, { water: 60, land: 36 }, 'G10 canonical 12x8 hydrology fingerprint changed');

const first = sampleDense();
const second = sampleDense();
assert.deepEqual(second, first, 'canonical relief field is not deterministic');
assert.ok(first.landSamples > 0 && first.waterSamples > 0, 'G10 dense proof must include both land and water');
assert.ok(first.maxWaterDelta <= 1e-12, `relief moved canonical water by ${first.maxWaterDelta}m`);
assert.ok(first.maxLandDelta >= WORLD_REFERENCE_RELIEF_POLICY.minimumG10LandPeakMeters,
	`G10 land peak ${first.maxLandDelta.toFixed(3)}m is too flat for map.png northern relief`);
assert.ok(first.maxLandDelta - first.minLandDelta >= 45,
	`G10 land relief range ${(first.maxLandDelta - first.minLandDelta).toFixed(3)}m is visually compressed`);
assert.ok(first.positiveLandRatio >= 0.35,
	`only ${(first.positiveLandRatio * 100).toFixed(2)}% of G10 land carries canonical relief`);
assert.ok(first.meanLandDelta >= 12, `G10 mean land relief ${first.meanLandDelta.toFixed(3)}m is too weak`);

const continuity = derivativeContinuity();
assert.ok(continuity.checked >= 40, `insufficient same-class continuity probes: ${continuity.checked}`);
assert.ok(continuity.maxDerivativeJump < 6500,
	`continuous relief derivative jump ${continuity.maxDerivativeJump.toFixed(3)} exceeds guard`);
wrapperContract();

console.log(JSON.stringify({
	status: 'PASS',
	geoCell: 'G10',
	layer: 'Relief/Height Character refinement',
	policy: WORLD_REFERENCE_RELIEF_POLICY.id,
	mapSha256: WORLD_REFERENCE_RELIEF_POLICY.mapSha256,
	fingerprint,
	dense: first,
	continuity,
}, null, 2));

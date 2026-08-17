#!/usr/bin/env node
import assert from 'node:assert/strict';

import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
	sampleWorldReferenceMountainReliefMeters,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const rounded = (value, digits = 6) => Number(value.toFixed(digits));
const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
const toWorld = (normalizedX, normalizedY) => ({
	x: (normalizedX * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT,
	z: (normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT,
});
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const sourceDry = (weight) => weight > WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero;

const passRows = [];
for (const [chainId, profile] of Object.entries(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains)) {
	for (const pass of profile.passes ?? []) {
		assert(Array.isArray(pass.center) && pass.center.length === 2, `${pass.id}: normalized center missing`);
		assert(pass.center.every((value) => Number.isFinite(value) && value >= 0 && value <= 1), `${pass.id}: center outside owner map`);
		assert(pass.innerRadiusNormalized > 0, `${pass.id}: inner radius must be positive`);
		assert(pass.outerRadiusNormalized > pass.innerRadiusNormalized, `${pass.id}: outer radius must exceed inner radius`);
		assert(pass.minimumMultiplier >= 0 && pass.minimumMultiplier <= 0.12, `${pass.id}: pass relief multiplier is not a bounded cut`);

		const [cx, cy] = pass.center;
		const centerDry = sampleReferenceDryLandWeight(cx, cy);
		const centerHeight = sampleNormalizedReferenceMountainReliefMeters(cx, cy);
		assert(Number.isFinite(centerHeight) && centerHeight >= 0, `${pass.id}: invalid center relief`);
		if (!sourceDry(centerDry)) assert.equal(centerHeight, 0, `${pass.id}: source-owned water center gained mountain relief`);

		const ringHeights = [];
		for (let index = 0; index < 32; index += 1) {
			const angle = index / 32 * Math.PI * 2;
			const distance = pass.outerRadiusNormalized * 0.78;
			const x = cx + Math.cos(angle) * distance;
			const y = cy + Math.sin(angle) * distance;
			if (x < 0 || x > 1 || y < 0 || y > 1) continue;
			const dry = sampleReferenceDryLandWeight(x, y);
			if (!sourceDry(dry)) continue;
			ringHeights.push(sampleNormalizedReferenceMountainReliefMeters(x, y));
		}
		assert(ringHeights.length >= 6, `${pass.id}: insufficient dry flank samples around authored pass`);
		const flankHigh = percentile(ringHeights, 0.8);
		const flankMax = Math.max(...ringHeights);

		const world = toWorld(cx, cy);
		const worldHeight = sampleWorldReferenceMountainReliefMeters(world.x, world.z);
		assert(Math.abs(worldHeight - centerHeight) <= 1e-9, `${pass.id}: normalized/world pass projection drifted`);

		const innerHeights = [];
		for (const radiusFraction of [0.25, 0.55, 0.82]) {
			for (let index = 0; index < 24; index += 1) {
				const angle = index / 24 * Math.PI * 2;
				const distance = pass.innerRadiusNormalized * radiusFraction;
				const x = cx + Math.cos(angle) * distance;
				const y = cy + Math.sin(angle) * distance;
				if (x < 0 || x > 1 || y < 0 || y > 1) continue;
				const dry = sampleReferenceDryLandWeight(x, y);
				if (!sourceDry(dry)) continue;
				innerHeights.push(sampleNormalizedReferenceMountainReliefMeters(x, y));
			}
		}
		if (sourceDry(centerDry)) innerHeights.push(centerHeight);
		assert(innerHeights.length >= 6, `${pass.id}: pass core has too few source-dry samples`);
		const innerHigh = percentile(innerHeights, 0.8);
		const innerMax = Math.max(...innerHeights);
		assert(flankMax > innerHigh + 1, `${pass.id}: dry pass core no longer reads lower than surrounding mountain flank`);
		assert(innerHigh <= Math.max(32, flankHigh * 0.82), `${pass.id}: dry pass core is too high relative to surrounding flank`);
		assert(innerMax <= Math.max(48, flankMax * 0.95), `${pass.id}: dry pass core contains a local relief wall`);

		passRows.push({
			chainId,
			passId: pass.id,
			centerSourceDry: sourceDry(centerDry),
			centerHeightMeters: rounded(centerHeight),
			centerDryWeight: rounded(centerDry),
			flank80Meters: rounded(flankHigh),
			flankMaxMeters: rounded(flankMax),
			inner80Meters: rounded(innerHigh),
			innerMaxMeters: rounded(innerMax),
			innerDrySamples: innerHeights.length,
			worldX: rounded(world.x, 3),
			worldZ: rounded(world.z, 3),
		});
	}
}

assert(passRows.length === 5, `expected 5 canonical western mountain passes, found ${passRows.length}`);
assert(passRows.some((row) => row.chainId === 'vale-chain'), 'Vale authored passes missing');
assert(passRows.some((row) => row.chainId === 'red-mountains'), 'Red Mountains authored passes missing');
assert(passRows.every((row) => row.flankMaxMeters > row.inner80Meters), 'at least one authored pass dry core is no longer lower than its flank');

console.log('MOUNTAIN_PASS_RELIEF_SAFETY_OK', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	passes: passRows,
}));

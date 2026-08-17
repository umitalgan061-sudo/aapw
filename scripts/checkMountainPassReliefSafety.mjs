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
		assert(centerDry > WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero, `${pass.id}: authored pass center moved into source-owned water`);

		const ringHeights = [];
		const ringDryWeights = [];
		for (let index = 0; index < 24; index += 1) {
			const angle = index / 24 * Math.PI * 2;
			const distance = pass.outerRadiusNormalized * 0.78;
			const x = cx + Math.cos(angle) * distance;
			const y = cy + Math.sin(angle) * distance;
			if (x < 0 || x > 1 || y < 0 || y > 1) continue;
			const dry = sampleReferenceDryLandWeight(x, y);
			if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) continue;
			ringDryWeights.push(dry);
			ringHeights.push(sampleNormalizedReferenceMountainReliefMeters(x, y));
		}
		assert(ringHeights.length >= 6, `${pass.id}: insufficient dry flank samples around authored pass`);
		const sorted = [...ringHeights].sort((a, b) => a - b);
		const flankHigh = sorted[Math.floor(sorted.length * 0.8)];
		const flankMax = sorted[sorted.length - 1];
		assert(flankMax > centerHeight + 1, `${pass.id}: pass no longer reads lower than surrounding mountain flank`);
		assert(centerHeight <= Math.max(18, flankHigh * 0.72), `${pass.id}: pass center relief is too high relative to surrounding flank`);

		const world = toWorld(cx, cy);
		const worldHeight = sampleWorldReferenceMountainReliefMeters(world.x, world.z);
		assert(Math.abs(worldHeight - centerHeight) <= 1e-9, `${pass.id}: normalized/world pass projection drifted`);

		const innerHeights = [];
		for (let index = 0; index < 16; index += 1) {
			const angle = index / 16 * Math.PI * 2;
			const distance = pass.innerRadiusNormalized * 0.7;
			const x = cx + Math.cos(angle) * distance;
			const y = cy + Math.sin(angle) * distance;
			if (x < 0 || x > 1 || y < 0 || y > 1) continue;
			const dry = sampleReferenceDryLandWeight(x, y);
			if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) continue;
			innerHeights.push(sampleNormalizedReferenceMountainReliefMeters(x, y));
		}
		assert(innerHeights.length >= 4, `${pass.id}: pass core has too few dry samples`);
		const innerMax = Math.max(...innerHeights);
		assert(innerMax <= Math.max(32, flankMax * 0.86), `${pass.id}: inner pass core contains a relief wall`);

		passRows.push({
			chainId,
			passId: pass.id,
			centerHeightMeters: rounded(centerHeight),
			centerDryWeight: rounded(centerDry),
			flank80Meters: rounded(flankHigh),
			flankMaxMeters: rounded(flankMax),
			innerMaxMeters: rounded(innerMax),
			worldX: rounded(world.x, 3),
			worldZ: rounded(world.z, 3),
		});
	}
}

assert(passRows.length === 5, `expected 5 canonical western mountain passes, found ${passRows.length}`);
assert(passRows.some((row) => row.chainId === 'vale-chain'), 'Vale authored passes missing');
assert(passRows.some((row) => row.chainId === 'red-mountains'), 'Red Mountains authored passes missing');
assert(passRows.every((row) => row.flankMaxMeters > row.centerHeightMeters), 'at least one authored pass is no longer visibly lower than its flank');

console.log('MOUNTAIN_PASS_RELIEF_SAFETY_OK', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	passes: passRows,
}));

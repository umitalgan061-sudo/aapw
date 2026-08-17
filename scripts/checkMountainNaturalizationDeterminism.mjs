#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
	sampleWorldReferenceMountainReliefMeters,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
const samples = [];
for (let y = 0; y <= 52; y += 1) {
	for (let x = 0; x <= 68; x += 1) {
		const nx = x / 68;
		const ny = y / 52;
		samples.push({ nx, ny, key: `${x}:${y}` });
	}
}

function sampleOne({ nx, ny, key }) {
	const normalizedMeters = sampleNormalizedReferenceMountainReliefMeters(nx, ny);
	const worldX = (nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT;
	const worldZ = (ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
	const worldMeters = sampleWorldReferenceMountainReliefMeters(worldX, worldZ);
	const dry = sampleReferenceDryLandWeight(nx, ny);
	assert(Number.isFinite(normalizedMeters) && normalizedMeters >= 0, `${key}: normalized relief invalid`);
	assert(Number.isFinite(worldMeters) && worldMeters >= 0, `${key}: world relief invalid`);
	assert(Object.is(normalizedMeters, worldMeters) || Math.abs(normalizedMeters - worldMeters) <= 1e-12, `${key}: normalized/world relief mismatch`);
	if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) {
		assert.equal(normalizedMeters, 0, `${key}: source-owned water gained mountain relief`);
	}
	return { key, nx, ny, dry, meters: normalizedMeters };
}

function run(order) {
	const rows = order.map(sampleOne);
	const byKey = new Map(rows.map((row) => [row.key, row]));
	return { rows, byKey };
}

const forward = run(samples);
const reverse = run([...samples].reverse());
const interleavedOrder = [];
let low = 0;
let high = samples.length - 1;
while (low <= high) {
	interleavedOrder.push(samples[low]);
	if (low !== high) interleavedOrder.push(samples[high]);
	low += 1;
	high -= 1;
}
const interleaved = run(interleavedOrder);

for (const sample of samples) {
	const a = forward.byKey.get(sample.key);
	const b = reverse.byKey.get(sample.key);
	const c = interleaved.byKey.get(sample.key);
	assert(a && b && c, `${sample.key}: missing deterministic sample`);
	assert(Object.is(a.meters, b.meters), `${sample.key}: reverse-order sampling changed relief`);
	assert(Object.is(a.meters, c.meters), `${sample.key}: interleaved sampling changed relief`);
	assert(Object.is(a.dry, b.dry) && Object.is(a.dry, c.dry), `${sample.key}: dry-land ownership changed with evaluation order`);
}

function digest(rows) {
	const canonical = [...rows]
		.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }))
		.map((row) => `${row.key}:${row.meters.toFixed(9)}:${row.dry.toFixed(9)}`)
		.join('\n');
	return crypto.createHash('sha256').update(canonical).digest('hex');
}

const forwardDigest = digest(forward.rows);
const reverseDigest = digest(reverse.rows);
const interleavedDigest = digest(interleaved.rows);
assert.equal(forwardDigest, reverseDigest, 'reverse-order mountain digest drifted');
assert.equal(forwardDigest, interleavedDigest, 'interleaved mountain digest drifted');

const positive = forward.rows.filter((row) => row.meters > 0);
const dryPositive = positive.filter((row) => row.dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull);
assert(positive.length > 80, 'determinism grid did not exercise enough mountain relief');
assert(dryPositive.length > 60, 'determinism grid did not exercise enough source-owned dry relief');
assert(Math.max(...positive.map((row) => row.meters)) > 450, 'determinism grid missed major mountain relief');

for (let repeat = 0; repeat < 4; repeat += 1) {
	for (const index of [0, 317, 911, 1777, 2501, samples.length - 1]) {
		const target = samples[index];
		const expected = forward.byKey.get(target.key).meters;
		assert(Object.is(sampleNormalizedReferenceMountainReliefMeters(target.nx, target.ny), expected), `${target.key}: repeated hot-path sample mutated at repeat ${repeat}`);
	}
}

console.log('MOUNTAIN_NATURALIZATION_DETERMINISM_OK', JSON.stringify({
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	sampleCount: samples.length,
	positiveSamples: positive.length,
	dryPositiveSamples: dryPositive.length,
	digest: forwardDigest,
	orders: ['forward', 'reverse', 'interleaved'],
}));

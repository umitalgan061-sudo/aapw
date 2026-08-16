#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import { REFERENCE_RELIEF_CHAINS } from '../src/3d/world/worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
	sampleWorldReferenceMountainReliefMeters,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/world-reference-mountain-relief-v1.json'), 'utf8'));
const rounded = (value, digits = 6) => Number(value.toFixed(digits));
const { width, height, quantizationCentimeters } = fixture.grid;
const quantized = Buffer.alloc(width * height * 4);
let offset = 0;
let peakMeters = 0;
let nonZeroSamples = 0;
let wetLeakMaxMeters = 0;

for (let yIndex = 0; yIndex < height; yIndex += 1) {
	const normalizedY = yIndex / (height - 1);
	for (let xIndex = 0; xIndex < width; xIndex += 1) {
		const normalizedX = xIndex / (width - 1);
		const dryLandWeight = sampleReferenceDryLandWeight(normalizedX, normalizedY);
		const heightMeters = sampleNormalizedReferenceMountainReliefMeters(normalizedX, normalizedY);
		peakMeters = Math.max(peakMeters, heightMeters);
		if (heightMeters > 0) nonZeroSamples += 1;
		if (dryLandWeight <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) wetLeakMaxMeters = Math.max(wetLeakMaxMeters, heightMeters);
		quantized.writeInt32LE(Math.round(heightMeters * (100 / quantizationCentimeters)), offset);
		offset += 4;
	}
}

const chains = {};
for (const chain of REFERENCE_RELIEF_CHAINS) {
	let peak = 0;
	let dryOwnedSamples = 0;
	let dryPositiveSamples = 0;
	let minDryOwnedMeters = Infinity;
	for (let segment = 0; segment < chain.points.length - 1; segment += 1) {
		const a = chain.points[segment];
		const b = chain.points[segment + 1];
		for (let step = 0; step <= 100; step += 1) {
			const t = step / 100;
			const x = a[0] + (b[0] - a[0]) * t;
			const y = a[1] + (b[1] - a[1]) * t;
			const dryLandWeight = sampleReferenceDryLandWeight(x, y);
			const heightMeters = sampleNormalizedReferenceMountainReliefMeters(x, y);
			peak = Math.max(peak, heightMeters);
			if (dryLandWeight >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) {
				dryOwnedSamples += 1;
				if (heightMeters > 5) dryPositiveSamples += 1;
				minDryOwnedMeters = Math.min(minDryOwnedMeters, heightMeters);
			}
		}
	}
	chains[chain.id] = { peakMeters: rounded(peak), dryOwnedSamples, dryPositiveSamples, minDryOwnedMeters: rounded(minDryOwnedMeters) };
}

const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
let worldMappingMaxDeltaMeters = 0;
for (let yIndex = 0; yIndex <= 32; yIndex += 1) {
	for (let xIndex = 0; xIndex <= 48; xIndex += 1) {
		const x = xIndex / 48;
		const y = yIndex / 32;
		const worldX = (x * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT;
		const worldZ = (y * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
		worldMappingMaxDeltaMeters = Math.max(worldMappingMaxDeltaMeters, Math.abs(sampleNormalizedReferenceMountainReliefMeters(x, y) - sampleWorldReferenceMountainReliefMeters(worldX, worldZ)));
	}
}

const result = {
	policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
	heightChecksumSha256: crypto.createHash('sha256').update(quantized).digest('hex'),
	metrics: {
		peakMeters: rounded(peakMeters),
		nonZeroSamples,
		nonZeroRatio: rounded(nonZeroSamples / (width * height), 8),
		wetLeakMaxMeters: rounded(wetLeakMaxMeters),
		worldMappingMaxDeltaMeters: rounded(worldMappingMaxDeltaMeters, 12),
		chains,
	},
};
console.log('MOUNTAIN_RELIEF_MEASURE_OK', JSON.stringify(result));

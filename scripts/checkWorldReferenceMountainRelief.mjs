#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
	sampleWorldReferenceMountainReliefMeters,
} from '../src/3d/world/worldReferenceMountainRelief.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from '../src/3d/world/worldReferenceSurfacePindexes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/world-reference-mountain-relief-v1.json'), 'utf8'));

function fail(message) {
	throw new Error(`[checkWorldReferenceMountainRelief] ${message}`);
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function rounded(value, digits = 6) {
	return Number(value.toFixed(digits));
}

function buildMetrics() {
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
			if (dryLandWeight <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) {
				wetLeakMaxMeters = Math.max(wetLeakMaxMeters, heightMeters);
			}
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
		chains[chain.id] = {
			peakMeters: rounded(peak),
			dryOwnedSamples,
			dryPositiveSamples,
			minDryOwnedMeters: rounded(minDryOwnedMeters),
		};
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
			worldMappingMaxDeltaMeters = Math.max(
				worldMappingMaxDeltaMeters,
				Math.abs(
					sampleNormalizedReferenceMountainReliefMeters(x, y) -
					sampleWorldReferenceMountainReliefMeters(worldX, worldZ)
				),
			);
		}
	}

	return {
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
}

assert(fixture.schemaVersion === 1, 'unsupported fixture schema');
assert(fixture.policyId === WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id, 'policy id drift');
assert(fixture.sourceMapSha256 === WORLD_REFERENCE_MAP.sha256, 'owner map checksum drift');
assert(fixture.surfaceMaskSha256 === WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256, 'surface mask checksum drift');
assert(Object.keys(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains).length === REFERENCE_RELIEF_CHAINS.length, 'every canonical chain needs exactly one live profile');

const actual = buildMetrics();
assert(actual.heightChecksumSha256 === fixture.heightChecksumSha256, `height checksum drift: ${actual.heightChecksumSha256}`);
assert(JSON.stringify(actual.metrics) === JSON.stringify(fixture.metrics), `metric drift: ${JSON.stringify(actual.metrics)}`);
assert(actual.metrics.peakMeters >= 500, 'full reference has no large mountain peak');
assert(actual.metrics.wetLeakMaxMeters === 0, 'mountain relief leaked into sea/lake ownership');
assert(actual.metrics.worldMappingMaxDeltaMeters === 0, 'normalized/world projection mismatch');
const minimumPeakMeters = {
	'vale-chain': 200,
	'red-mountains': 240,
	'bone-mountains': 500,
	'eastern-chain': 350,
	'frostfangs': 300,
	'painted-mountains': 120,
	'jogos-spine': 180,
};
for (const [chainId, metrics] of Object.entries(actual.metrics.chains)) {
	assert(metrics.dryOwnedSamples > 0, `${chainId} has no source-owned dry centerline samples`);
	assert(metrics.dryPositiveSamples === metrics.dryOwnedSamples, `${chainId} is discontinuous on source-owned dry centerline`);
	assert(metrics.minDryOwnedMeters > 5, `${chainId} contains an unplanned zero-height cut; authored passes must remain traversable but connected`);
	assert(metrics.peakMeters >= minimumPeakMeters[chainId], `${chainId} does not reach its required visible relief`);
}

const outOfCanvas = [
	sampleWorldReferenceMountainReliefMeters(-WORLD_SCALE.WORLD_WIDTH_METERS * 4, 0),
	sampleWorldReferenceMountainReliefMeters(WORLD_SCALE.WORLD_WIDTH_METERS * 4, 0),
	sampleWorldReferenceMountainReliefMeters(0, -WORLD_SCALE.WORLD_DEPTH_METERS * 4),
	sampleWorldReferenceMountainReliefMeters(0, WORLD_SCALE.WORLD_DEPTH_METERS * 4),
];
assert(outOfCanvas.every((height) => height === 0), 'out-of-canvas sampler must preserve zero-addition behavior');

const terrainSource = fs.readFileSync(path.join(ROOT, 'src/3d/world/terrain.js'), 'utf8');
assert(
	terrainSource.includes("import { sampleWorldReferenceMountainReliefMeters } from './worldReferenceMountainRelief.js';"),
	'live terrain import missing',
);
const liveCalls = terrainSource.match(/sampleWorldReferenceMountainReliefMeters\(worldX, worldZ\)/g) ?? [];
assert(liveCalls.length === 1, `live terrain must consume canonical relief exactly once, found ${liveCalls.length}`);

const serviceWorkerSource = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
assert(
	serviceWorkerSource.includes("'./src/3d/world/worldReferenceMountainRelief.js'"),
	'offline shell is missing live mountain module',
);

console.log('[checkWorldReferenceMountainRelief] PASS', JSON.stringify({
	policyId: fixture.policyId,
	checksum: actual.heightChecksumSha256,
	peakMeters: actual.metrics.peakMeters,
	nonZeroRatio: actual.metrics.nonZeroRatio,
	wetLeakMaxMeters: actual.metrics.wetLeakMaxMeters,
	chains: actual.metrics.chains,
}));

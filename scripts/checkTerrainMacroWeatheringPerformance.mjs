#!/usr/bin/env node
/**
 * Hot-path + geomorphology regression for terrain macro weathering.
 *
 * This protects a visual-quality requirement that is easy to miss in micro tests: the field is
 * sampled for every terrain vertex and indirectly during several browser boot paths. A beautifully
 * detailed residual that makes the live world miss DOMContentLoaded/browser QA deadlines is not a
 * production improvement. The guard therefore checks both the no-allocation production structure
 * and the new hydrologic geography signals introduced by revision 2.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
	TERRAIN_MACRO_WEATHERING_POLICY,
	terrainDrainageSignals,
	terrainMacroWeatheringResidualMeters,
	terrainMacroWeatheringSignals,
} from '../src/3d/world/terrainMacroWeathering.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(HERE, '../src/3d/world/terrainMacroWeathering.js');
const source = readFileSync(SOURCE_PATH, 'utf8');
const P = TERRAIN_MACRO_WEATHERING_POLICY;
const EPSILON = 1e-10;

assert.equal(P.id, 'terrain-macro-hydrology-weathering-2026-08-26-v1');
assert.equal(P.revision, 2);
assert.equal(P.productionFastPath, true);
assert.equal(P.hydrologicHierarchy, true);
assert.equal(P.alluvialGeomorphology, true);

// Production must no longer delegate through the rich diagnostic object graph. That old path
// Object.freeze'd nested structures for every vertex and was the reason browser boot regressed.
const residualStart = source.indexOf('export function terrainMacroWeatheringResidualMeters');
const residualEnd = source.indexOf('export function terrainMacroWeatheringSlope', residualStart);
assert(residualStart > 0 && residualEnd > residualStart, 'production residual function markers missing');
const residualSource = source.slice(residualStart, residualEnd);
assert(!residualSource.includes('terrainMacroWeatheringSignals('), 'hot path regressed to diagnostic object graph');
assert(residualSource.includes('context.dryness <= 0 || context.shoreGate <= 0'), 'water/shore early-out disappeared');
assert(residualSource.includes('componentMeters('), 'production residual lost shared geomorphology components');

const upland = Object.freeze({
	heightAboveSeaMeters: 125,
	reliefInfluence: 0.38,
	rockWeight: 0.28,
	snowWeight: 0,
	waterWeight: 0,
});
const lowland = Object.freeze({
	heightAboveSeaMeters: 28,
	reliefInfluence: 0.08,
	rockWeight: 0.08,
	snowWeight: 0,
	waterWeight: 0,
});
const water = Object.freeze({
	heightAboveSeaMeters: -3,
	reliefInfluence: 0,
	rockWeight: 0,
	snowWeight: 0,
	waterWeight: 1,
});

// Fast scalar path and diagnostic path must remain numerically identical on dry terrain.
for (let i = 0; i < 512; i += 1) {
	const nx = ((i * 0.61803398875) + 0.113) % 1;
	const ny = ((i * 0.41421356237) + 0.271) % 1;
	const fast = terrainMacroWeatheringResidualMeters(nx, ny, upland);
	const diagnostic = terrainMacroWeatheringSignals(nx, ny, upland).residualMeters;
	assert(
		Math.abs(fast - diagnostic) <= EPSILON,
		`fast/diagnostic drift at ${nx.toFixed(5)},${ny.toFixed(5)}: ${fast} vs ${diagnostic}`,
	);
}

// Open water is exact-neutral, including bizarre coordinates, and must hit the early-out.
for (const [nx, ny] of [[0, 0], [0.5, 0.5], [1, 1], [-2.4, 7.1]]) {
	assert.equal(terrainMacroWeatheringResidualMeters(nx, ny, water), 0);
}

// Hydrologic hierarchy: confluences are sparse, divides are broad, floodplains occupy the zone beside
// basin channels rather than every dry vertex. This is what makes the field read as geography instead
// of two overlaid noise textures.
let samples = 0;
let confluenceActive = 0;
let floodplainActive = 0;
let divideActive = 0;
let branchWithBasin = 0;
for (let y = 0; y < 96; y += 1) {
	for (let x = 0; x < 128; x += 1) {
		const signal = terrainDrainageSignals((x + 0.37) / 128, (y + 0.61) / 96);
		if (signal.confluence > 0.15) confluenceActive += 1;
		if (signal.floodplain > 0.35) floodplainActive += 1;
		if (signal.divide > 0.50) divideActive += 1;
		if (signal.fine > 0.65 && signal.broad > 0.25) branchWithBasin += 1;
		samples += 1;
	}
}
const confluenceFraction = confluenceActive / samples;
const floodplainFraction = floodplainActive / samples;
const divideFraction = divideActive / samples;
assert(confluenceFraction > 0.005 && confluenceFraction < 0.12, `confluence coverage ${confluenceFraction}`);
assert(floodplainFraction > 0.08 && floodplainFraction < 0.50, `floodplain coverage ${floodplainFraction}`);
assert(divideFraction > 0.25 && divideFraction < 0.75, `divide coverage ${divideFraction}`);
assert(branchWithBasin > 250, 'tributaries no longer nest inside basin-scale drainage');

// Alluvial fans must activate in lowlands around confluences, while high mountains suppress them.
let lowlandFans = 0;
let mountainFans = 0;
let lowlandFloodplainCuts = 0;
let interfluveLifts = 0;
const mountain = Object.freeze({
	heightAboveSeaMeters: 440,
	reliefInfluence: 0.88,
	rockWeight: 0.74,
	snowWeight: 0.22,
	waterWeight: 0,
});
for (let y = 0; y < 72; y += 1) {
	for (let x = 0; x < 96; x += 1) {
		const nx = (x + 0.5) / 96;
		const ny = (y + 0.5) / 72;
		const low = terrainMacroWeatheringSignals(nx, ny, lowland);
		const high = terrainMacroWeatheringSignals(nx, ny, mountain);
		if (low.alluvial.fanDeposit > 0.05) lowlandFans += 1;
		if (high.alluvial.fanDeposit > 0.05) mountainFans += 1;
		if (low.alluvial.floodplainCut > 0.10) lowlandFloodplainCuts += 1;
		if (low.alluvial.interfluveLift > 0.20) interfluveLifts += 1;
	}
}
assert(lowlandFans > 50, `alluvial fan population too small: ${lowlandFans}`);
assert(mountainFans < lowlandFans * 0.08, `alluvial fans leaked into mountains: ${mountainFans}/${lowlandFans}`);
assert(lowlandFloodplainCuts > 500, `floodplain carving is not geographically legible: ${lowlandFloodplainCuts}`);
assert(interfluveLifts > 1200, `drainage divides are not expressed: ${interfluveLifts}`);

// Timing is intentionally very generous for shared CI runners. The main guard is structural above;
// this catches catastrophic regressions (for example restoring four multi-octave aspect probes).
function benchmark(context, iterations) {
	let checksum = 0;
	const start = performance.now();
	for (let i = 0; i < iterations; i += 1) {
		const nx = ((i * 0.754877666) + 0.123) % 1;
		const ny = ((i * 0.569840296) + 0.417) % 1;
		checksum += terrainMacroWeatheringResidualMeters(nx, ny, context);
	}
	return { elapsedMs: performance.now() - start, checksum };
}

// Warm JIT before measuring.
benchmark(upland, 5000);
benchmark(water, 5000);
const landPerf = benchmark(upland, 50000);
const waterPerf = benchmark(water, 50000);
assert(Number.isFinite(landPerf.checksum));
assert.equal(waterPerf.checksum, 0);
assert(landPerf.elapsedMs < 5000, `50k dry-land weathering samples took ${landPerf.elapsedMs.toFixed(1)}ms`);
assert(waterPerf.elapsedMs < 1200, `50k open-water fast-path samples took ${waterPerf.elapsedMs.toFixed(1)}ms`);
assert(
	waterPerf.elapsedMs < landPerf.elapsedMs * 0.45,
	`open-water early-out is not materially cheaper (${waterPerf.elapsedMs.toFixed(1)} vs ${landPerf.elapsedMs.toFixed(1)}ms)`,
);

console.log('[checkTerrainMacroWeatheringPerformance] PASS');
console.log(JSON.stringify({
	policyId: P.id,
	revision: P.revision,
	coverage: {
		confluenceFraction,
		floodplainFraction,
		divideFraction,
		lowlandFans,
		mountainFans,
		lowlandFloodplainCuts,
		interfluveLifts,
	},
	performance: {
		land50kMs: Number(landPerf.elapsedMs.toFixed(2)),
		water50kMs: Number(waterPerf.elapsedMs.toFixed(2)),
	},
}, null, 2));

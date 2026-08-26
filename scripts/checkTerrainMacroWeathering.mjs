#!/usr/bin/env node
/**
 * Contract check for deterministic macro hydrology/weathering.
 *
 * This script deliberately exercises the production module directly. It does not copy noise
 * constants or rebuild masks, so a future implementation change must continue to satisfy the same
 * invariants: water neutrality, shoreline protection, deterministic chunk continuity, bounded
 * residual amplitude, hierarchical drainage, and stronger-but-still-bounded mountain weathering.
 */

import assert from 'node:assert/strict';
import {
	TERRAIN_MACRO_WEATHERING_POLICY,
	terrainDrainageSignals,
	terrainMacroWeatheringResidualMeters,
	terrainMacroWeatheringSignals,
	terrainMacroWeatheringSlope,
	summarizeTerrainMacroWeathering,
} from '../src/3d/world/terrainMacroWeathering.js';

const P = TERRAIN_MACRO_WEATHERING_POLICY;
const EPS = 1e-12;

function close(actual, expected, tolerance, label) {
	assert(
		Math.abs(actual - expected) <= tolerance,
		`${label}: ${actual} not within ${tolerance} of ${expected}`,
	);
}

function finite(value, label) {
	assert(Number.isFinite(value), `${label} must be finite, got ${value}`);
}

function context(overrides = {}) {
	return {
		heightAboveSeaMeters: 120,
		reliefInfluence: 0.35,
		rockWeight: 0.25,
		snowWeight: 0,
		waterWeight: 0,
		...overrides,
	};
}

assert.equal(P.id, 'terrain-macro-hydrology-weathering-2026-08-26-v1');
assert.equal(P.ownerWorldWidthMeters, 13296);
assert.equal(P.ownerWorldHeightMeters, 10341);
assert(P.shoreFadeStartMeters > 0);
assert(P.shoreFadeFullMeters > P.shoreFadeStartMeters);
assert(P.negativeCutFullElevationMeters > P.shoreFadeFullMeters);
assert(P.drainageFineFrequency > P.drainageBroadFrequency);
assert(P.drainageFineWidth < P.drainageBroadWidth);
assert(P.channelCutHighMeters > P.channelCutLowMeters);
assert(P.channelCutMountainMeters > 0);
assert(P.maxPositiveResidualMeters <= 20);
assert(P.maxNegativeResidualMeters <= 16);

// Open water must be exactly neutral. This is stronger than "small": the residual may never become
// a second bathymetry authority.
for (const waterWeight of [1, 1.2, 7]) {
	for (const point of [[0, 0], [0.123, 0.456], [0.5, 0.5], [1, 1], [-0.25, 1.4]]) {
		const value = terrainMacroWeatheringResidualMeters(point[0], point[1], context({
			heightAboveSeaMeters: 420,
			reliefInfluence: 1,
			rockWeight: 1,
			snowWeight: 1,
			waterWeight,
		}));
		close(value, 0, EPS, `open-water neutrality ${point}`);
	}
}

// The exact shoreline floor stays neutral as well. Negative and positive components are both gated
// out before the first protected metre so the sea edge cannot acquire scalloped vertical teeth.
for (const height of [-8, -1, 0, P.shoreFadeStartMeters]) {
	for (let i = 0; i < 20; i += 1) {
		const nx = (i * 0.173) % 1;
		const ny = (i * 0.287) % 1;
		const value = terrainMacroWeatheringResidualMeters(nx, ny, context({
			heightAboveSeaMeters: height,
			reliefInfluence: 0.9,
			rockWeight: 0.8,
		}));
		close(value, 0, EPS, `shore gate @${height}m ${i}`);
	}
}

// Four metres above sea should only carry a tiny fraction of inland amplitude.
const coastal = summarizeTerrainMacroWeathering({
	width: 48,
	height: 36,
	contextAt: () => context({
		heightAboveSeaMeters: 4,
		reliefInfluence: 0.05,
		rockWeight: 0.05,
	}),
});
assert(coastal.meanAbsolute < 0.15, `coastal residual too strong: ${coastal.meanAbsolute}`);
assert(coastal.max < 0.8, `coastal positive residual too strong: ${coastal.max}`);
assert(coastal.min > -0.15, `coastal negative cut too strong: ${coastal.min}`);
assert(coastal.maxSlopeDegrees < 1.5, `coastal added grade too strong: ${coastal.maxSlopeDegrees}`);

// Determinism: repeat exact points with object identities and key order changed.
const deterministicPoints = [];
for (let y = 0; y <= 12; y += 1) {
	for (let x = 0; x <= 16; x += 1) {
		deterministicPoints.push([x / 16, y / 12]);
	}
}
for (const [nx, ny] of deterministicPoints) {
	const a = terrainMacroWeatheringSignals(nx, ny, context());
	const b = terrainMacroWeatheringSignals(nx, ny, {
		waterWeight: 0,
		snowWeight: 0,
		rockWeight: 0.25,
		reliefInfluence: 0.35,
		heightAboveSeaMeters: 120,
	});
	close(a.residualMeters, b.residualMeters, EPS, `deterministic residual ${nx},${ny}`);
	close(a.drainage.channel, b.drainage.channel, EPS, `deterministic channel ${nx},${ny}`);
	close(a.bench.hardness, b.bench.hardness, EPS, `deterministic bench ${nx},${ny}`);
	close(a.aspect.signedExposure, b.aspect.signedExposure, EPS, `deterministic aspect ${nx},${ny}`);
	close(a.talus.scarp, b.talus.scarp, EPS, `deterministic talus ${nx},${ny}`);
}

// Chunk-border continuity: sampling the same world-normalized coordinate from two conceptual chunk
// owners must be bit-identical. Also probe a one-millimetre offset to reject discontinuous hash-cell
// jumps in the final residual.
const oneMillimeterX = 0.001 / P.ownerWorldWidthMeters;
const oneMillimeterY = 0.001 / P.ownerWorldHeightMeters;
for (const nx of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
	for (const ny of [0.2, 0.4, 0.6, 0.8]) {
		const ownerA = terrainMacroWeatheringResidualMeters(nx, ny, context());
		const ownerB = terrainMacroWeatheringResidualMeters(nx, ny, context());
		close(ownerA, ownerB, EPS, `seam exact ${nx},${ny}`);
		const east = terrainMacroWeatheringResidualMeters(nx + oneMillimeterX, ny, context());
		const north = terrainMacroWeatheringResidualMeters(nx, ny + oneMillimeterY, context());
		assert(Math.abs(east - ownerA) < 0.02, `1mm east discontinuity at ${nx},${ny}`);
		assert(Math.abs(north - ownerA) < 0.02, `1mm north discontinuity at ${nx},${ny}`);
	}
}

// Drainage hierarchy must actually exist. Broad channels are sparse, fine channels add branches, and
// the combined channel field cannot collapse to either all-zero or all-one.
let broadActive = 0;
let fineActive = 0;
let combinedActive = 0;
let broadOnly = 0;
let fineExtension = 0;
let drainageSamples = 0;
let channelMean = 0;
let shoulderMean = 0;
for (let y = 0; y < 96; y += 1) {
	for (let x = 0; x < 128; x += 1) {
		const signal = terrainDrainageSignals((x + 0.37) / 128, (y + 0.61) / 96);
		finite(signal.broad, 'broad drainage');
		finite(signal.fine, 'fine drainage');
		finite(signal.channel, 'combined drainage');
		finite(signal.shoulder, 'drainage shoulder');
		assert(signal.broad >= 0 && signal.broad <= 1);
		assert(signal.fine >= 0 && signal.fine <= 1);
		assert(signal.channel >= 0 && signal.channel <= 1);
		assert(signal.shoulder >= 0 && signal.shoulder <= 1);
		if (signal.broad > 0.7) broadActive += 1;
		if (signal.fine > 0.7) fineActive += 1;
		if (signal.channel > 0.7) combinedActive += 1;
		if (signal.broad > 0.7 && signal.fine < 0.3) broadOnly += 1;
		if (signal.fine > 0.7 && signal.broad < 0.45 && signal.channel > 0.4) fineExtension += 1;
		channelMean += signal.channel;
		shoulderMean += signal.shoulder;
		drainageSamples += 1;
	}
}
channelMean /= drainageSamples;
shoulderMean /= drainageSamples;
assert(broadActive > drainageSamples * 0.08, 'broad drainage network is too sparse');
assert(broadActive < drainageSamples * 0.45, 'broad drainage network is too dense');
assert(fineActive > drainageSamples * 0.05, 'fine tributary network is too sparse');
assert(combinedActive > broadActive, 'fine tributaries must extend the broad network');
assert(broadOnly > 20, 'broad channels must retain independent basin-scale corridors');
assert(fineExtension > 20, 'fine channels must create branch extensions');
assert(channelMean > 0.18 && channelMean < 0.42, `channel mean out of range: ${channelMean}`);
assert(shoulderMean > 0.20 && shoulderMean < 0.48, `shoulder mean out of range: ${shoulderMean}`);

// Production component accounting: rawResidual is exactly the sum of named components. This catches
// silent addition of an untracked geometry term.
for (const [nx, ny] of deterministicPoints.slice(0, 80)) {
	const signal = terrainMacroWeatheringSignals(nx, ny, context());
	const sum = Object.values(signal.componentsMeters).reduce((total, value) => total + value, 0);
	close(sum, signal.rawResidualMeters, 1e-10, `component accounting ${nx},${ny}`);
}

// Residual envelopes across representative regimes.
const lowland = summarizeTerrainMacroWeathering({
	width: 64,
	height: 48,
	contextAt: () => context({ heightAboveSeaMeters: 28, reliefInfluence: 0.08, rockWeight: 0.08 }),
});
const upland = summarizeTerrainMacroWeathering({
	width: 64,
	height: 48,
	contextAt: () => context({ heightAboveSeaMeters: 120, reliefInfluence: 0.35, rockWeight: 0.25 }),
});
const mountain = summarizeTerrainMacroWeathering({
	width: 64,
	height: 48,
	contextAt: () => context({
		heightAboveSeaMeters: 420,
		reliefInfluence: 0.85,
		rockWeight: 0.70,
		snowWeight: 0.20,
	}),
});

for (const [name, stats] of Object.entries({ lowland, upland, mountain })) {
	assert.equal(stats.policyId, P.id);
	assert.equal(stats.sampleCount, 64 * 48);
	finite(stats.min, `${name} min`);
	finite(stats.max, `${name} max`);
	finite(stats.mean, `${name} mean`);
	finite(stats.standardDeviation, `${name} sd`);
	assert(stats.min >= -P.maxNegativeResidualMeters - EPS, `${name} breached negative envelope`);
	assert(stats.max <= P.maxPositiveResidualMeters + EPS, `${name} breached positive envelope`);
	assert(stats.negativeFraction > 0.25 && stats.negativeFraction < 0.75, `${name} one-sided residual`);
	assert(stats.positiveFraction > 0.25 && stats.positiveFraction < 0.75, `${name} one-sided residual`);
	assert(stats.p10 < 0 && stats.p90 > 0, `${name} lacks both cuts and deposits`);
}
assert(upland.standardDeviation > lowland.standardDeviation, 'uplands must weather more strongly than lowlands');
assert(mountain.standardDeviation > upland.standardDeviation * 1.45, 'mountains must weather materially more strongly than uplands');
assert(mountain.meanAbsolute > upland.meanAbsolute * 1.65, 'mountain residual magnitude should dominate upland');
assert(upland.maxSlopeDegrees < 13, `upland weathering adds too much grade: ${upland.maxSlopeDegrees}`);
assert(mountain.maxSlopeDegrees < 22, `mountain weathering adds too much grade: ${mountain.maxSlopeDegrees}`);

// Mountain morphology should show active talus and benches, but neither mask may cover the world.
let talusActive = 0;
let benchActive = 0;
let aspectPositive = 0;
let aspectNegative = 0;
let morphologyCount = 0;
for (let y = 0; y < 72; y += 1) {
	for (let x = 0; x < 96; x += 1) {
		const signal = terrainMacroWeatheringSignals((x + 0.5) / 96, (y + 0.5) / 72, context({
			heightAboveSeaMeters: 420,
			reliefInfluence: 0.85,
			rockWeight: 0.70,
			snowWeight: 0.20,
		}));
		if (signal.talus.scarp > 0.10) talusActive += 1;
		if (signal.bench.lift > 0.10 || signal.bench.cut > 0.10) benchActive += 1;
		if (signal.aspect.signedExposure > 0.25) aspectPositive += 1;
		if (signal.aspect.signedExposure < -0.25) aspectNegative += 1;
		morphologyCount += 1;
	}
}
assert(talusActive > morphologyCount * 0.01, 'talus mask never activates');
assert(talusActive < morphologyCount * 0.45, 'talus mask is not sparse');
assert(benchActive > morphologyCount * 0.08, 'stratal benches never activate');
assert(benchActive < morphologyCount * 0.75, 'stratal benches cover too much terrain');
assert(aspectPositive > morphologyCount * 0.10, 'windward/aspect weathering lacks positive side');
assert(aspectNegative > morphologyCount * 0.10, 'windward/aspect weathering lacks negative side');

// Invalid numeric input must degrade safely rather than poisoning the canonical sampler with NaN.
for (const bad of [NaN, Infinity, -Infinity, undefined, null]) {
	const signal = terrainMacroWeatheringSignals(bad, bad, {
		heightAboveSeaMeters: bad,
		reliefInfluence: bad,
		rockWeight: bad,
		snowWeight: bad,
		waterWeight: bad,
	});
	finite(signal.residualMeters, `bad-input residual ${String(bad)}`);
	finite(signal.drainage.channel, `bad-input channel ${String(bad)}`);
}

// Slope helper itself is deterministic and returns coherent degree/rise representation.
for (const [nx, ny] of deterministicPoints.slice(0, 60)) {
	const a = terrainMacroWeatheringSlope(nx, ny, context(), 20);
	const b = terrainMacroWeatheringSlope(nx, ny, context(), 20);
	close(a.slope, Math.hypot(a.riseX, a.riseY), 1e-12, 'slope vector magnitude');
	close(a.degrees, Math.atan(a.slope) * 180 / Math.PI, 1e-12, 'slope degree conversion');
	close(a.degrees, b.degrees, EPS, 'slope determinism');
}

console.log(
	'[checkTerrainMacroWeathering] PASS:',
	`coast |mean|=${coastal.meanAbsolute.toFixed(3)}m,`,
	`upland sd=${upland.standardDeviation.toFixed(2)}m / maxAddedGrade=${upland.maxSlopeDegrees.toFixed(1)}deg,`,
	`mountain sd=${mountain.standardDeviation.toFixed(2)}m / maxAddedGrade=${mountain.maxSlopeDegrees.toFixed(1)}deg,`,
	`channelMean=${channelMean.toFixed(3)}.`,
);

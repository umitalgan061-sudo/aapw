#!/usr/bin/env node
/**
 * Statistical realism guard for terrain macro weathering.
 *
 * The contract check proves local invariants. This check looks at whole-map distributions so a future
 * refactor cannot technically keep every function while flattening the result back into homogeneous
 * noise. It compares elevation regimes, drainage-conditioned samples, mountain-vs-plain morphology,
 * directional balance and multi-scale spatial autocorrelation.
 */

import assert from 'node:assert/strict';
import {
	TERRAIN_MACRO_WEATHERING_POLICY,
	terrainMacroWeatheringSignals,
	terrainMacroWeatheringResidualMeters,
} from '../src/3d/world/terrainMacroWeathering.js';

const P = TERRAIN_MACRO_WEATHERING_POLICY;

const contexts = Object.freeze({
	coast: Object.freeze({
		heightAboveSeaMeters: 4,
		reliefInfluence: 0.04,
		rockWeight: 0.04,
		snowWeight: 0,
		waterWeight: 0,
	}),
	lowland: Object.freeze({
		heightAboveSeaMeters: 24,
		reliefInfluence: 0.08,
		rockWeight: 0.08,
		snowWeight: 0,
		waterWeight: 0,
	}),
	upland: Object.freeze({
		heightAboveSeaMeters: 125,
		reliefInfluence: 0.38,
		rockWeight: 0.28,
		snowWeight: 0,
		waterWeight: 0,
	}),
	mountain: Object.freeze({
		heightAboveSeaMeters: 440,
		reliefInfluence: 0.88,
		rockWeight: 0.74,
		snowWeight: 0.22,
		waterWeight: 0,
	}),
});

function quantile(sorted, q) {
	return sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)))];
}

function pearson(xs, ys) {
	assert.equal(xs.length, ys.length);
	const count = xs.length;
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < count; i += 1) {
		sx += xs[i];
		sy += ys[i];
	}
	const mx = sx / count;
	const my = sy / count;
	let covariance = 0;
	let vx = 0;
	let vy = 0;
	for (let i = 0; i < count; i += 1) {
		const dx = xs[i] - mx;
		const dy = ys[i] - my;
		covariance += dx * dy;
		vx += dx * dx;
		vy += dy * dy;
	}
	return vx > 0 && vy > 0 ? covariance / Math.sqrt(vx * vy) : 0;
}

function summarize(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const count = sorted.length;
	const mean = sorted.reduce((sum, value) => sum + value, 0) / count;
	const meanAbsolute = sorted.reduce((sum, value) => sum + Math.abs(value), 0) / count;
	const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
	return {
		count,
		min: sorted[0],
		max: sorted[count - 1],
		mean,
		meanAbsolute,
		sd: Math.sqrt(variance),
		p01: quantile(sorted, 0.01),
		p10: quantile(sorted, 0.10),
		p25: quantile(sorted, 0.25),
		p50: quantile(sorted, 0.50),
		p75: quantile(sorted, 0.75),
		p90: quantile(sorted, 0.90),
		p99: quantile(sorted, 0.99),
	};
}

function sampleRegime(context, width = 144, height = 108) {
	const rows = [];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const nx = (x + 0.371) / width;
			const ny = (y + 0.613) / height;
			const signal = terrainMacroWeatheringSignals(nx, ny, context);
			rows.push({
				nx,
				ny,
				residual: signal.residualMeters,
				channel: signal.drainage.channel,
				shoulder: signal.drainage.shoulder,
				bench: signal.componentsMeters.bench,
				aspect: signal.componentsMeters.aspect,
				talus: signal.componentsMeters.talus,
				massif: signal.componentsMeters.massif,
				scarp: signal.talus.scarp,
			});
		}
	}
	return rows;
}

const sampled = Object.fromEntries(Object.entries(contexts).map(([name, context]) => [name, sampleRegime(context)]));
const summary = Object.fromEntries(Object.entries(sampled).map(([name, rows]) => [
	name,
	summarize(rows.map((row) => row.residual)),
]));

// Amplitude should scale with geological opportunity, not be a single map-wide noise amplitude.
assert(summary.coast.meanAbsolute < 0.15);
assert(summary.lowland.meanAbsolute > summary.coast.meanAbsolute * 4);
assert(summary.upland.meanAbsolute > summary.lowland.meanAbsolute * 1.25);
assert(summary.mountain.meanAbsolute > summary.upland.meanAbsolute * 1.6);
assert(summary.mountain.sd > summary.upland.sd * 1.6);

// The envelope must have room: if p99/p01 constantly hit the hard caps, the output is clipping rather
// than expressing morphology. Rare exact clips are allowed, but central quantiles must remain inside.
assert(summary.mountain.p90 < P.maxPositiveResidualMeters * 0.75);
assert(summary.mountain.p10 > -P.maxNegativeResidualMeters * 0.75);
assert(summary.upland.p99 < P.maxPositiveResidualMeters * 0.75);
assert(summary.upland.p01 > -P.maxNegativeResidualMeters * 0.75);

// Drainage-conditioned values should be lower than non-channel values. This is the statistical proof
// that "drainage" actually carves geometry rather than only existing as a diagnostic mask.
for (const regime of ['lowland', 'upland', 'mountain']) {
	const rows = sampled[regime];
	const channels = rows.filter((row) => row.channel > 0.78).map((row) => row.residual);
	const interfluves = rows.filter((row) => row.channel < 0.18).map((row) => row.residual);
	assert(channels.length > 300, `${regime}: too few channel samples`);
	assert(interfluves.length > 300, `${regime}: too few interfluve samples`);
	const channelMean = summarize(channels).mean;
	const interfluveMean = summarize(interfluves).mean;
	assert(
		channelMean < interfluveMean - (regime === 'mountain' ? 2.0 : 0.8),
		`${regime}: channels do not cut enough (${channelMean} vs ${interfluveMean})`,
	);
}

// Shoulders should recover elevation around channels: strong shoulder samples must average above
// strong channel-core samples despite sharing the same basin network.
for (const regime of ['upland', 'mountain']) {
	const rows = sampled[regime];
	const shoulders = rows.filter((row) => row.shoulder > 0.72 && row.channel < 0.78).map((row) => row.residual);
	const cores = rows.filter((row) => row.channel > 0.86).map((row) => row.residual);
	assert(shoulders.length > 100);
	assert(cores.length > 100);
	assert(
		summarize(shoulders).mean > summarize(cores).mean + 0.8,
		`${regime}: valley shoulders are not legible`,
	);
}

// Aspect weathering must be balanced. A biased average would tilt the entire world up/down.
for (const regime of ['upland', 'mountain']) {
	const aspects = sampled[regime].map((row) => row.aspect);
	const s = summarize(aspects);
	assert(Math.abs(s.mean) < 0.20, `${regime}: aspect term has DC bias ${s.mean}`);
	assert(s.p10 < -0.25, `${regime}: no meaningful lee-side cut`);
	assert(s.p90 > 0.25, `${regime}: no meaningful windward lift`);
}

// Talus remains mountain-weighted.
const uplandTalus = sampled.upland.filter((row) => Math.abs(row.talus) > 0.15).length / sampled.upland.length;
const mountainTalus = sampled.mountain.filter((row) => Math.abs(row.talus) > 0.15).length / sampled.mountain.length;
assert(mountainTalus > uplandTalus * 1.45, `talus is not mountain weighted: ${mountainTalus} vs ${uplandTalus}`);
assert(mountainTalus < 0.35, `talus is too ubiquitous: ${mountainTalus}`);

// Bench contribution must be sparse enough to avoid contour-line terracing, yet present enough to
// break smooth slopes.
for (const regime of ['upland', 'mountain']) {
	const benches = sampled[regime].map((row) => row.bench);
	const active = benches.filter((value) => Math.abs(value) > 0.35).length / benches.length;
	assert(active > 0.04, `${regime}: benches absent`);
	assert(active < 0.50, `${regime}: benches too dense`);
}

// Spatial correlation at 25m should be stronger than at 250m, but 250m must retain some correlation.
// This guards against both white noise and one giant sinusoid.
function residualPairs(context, separationMeters, count = 2500) {
	const dx = separationMeters / P.ownerWorldWidthMeters;
	const dy = separationMeters / P.ownerWorldHeightMeters;
	const a = [];
	const b = [];
	for (let i = 0; i < count; i += 1) {
		const nx = ((i * 0.61803398875) + 0.137) % 0.92 + 0.04;
		const ny = ((i * 0.41421356237) + 0.271) % 0.92 + 0.04;
		const angle = ((i * 0.754877666) % 1) * Math.PI * 2;
		a.push(terrainMacroWeatheringResidualMeters(nx, ny, context));
		b.push(terrainMacroWeatheringResidualMeters(
			nx + Math.cos(angle) * dx,
			ny + Math.sin(angle) * dy,
			context,
		));
	}
	return [a, b];
}

for (const regime of ['upland', 'mountain']) {
	const [nearA, nearB] = residualPairs(contexts[regime], 25);
	const [midA, midB] = residualPairs(contexts[regime], 250);
	const [farA, farB] = residualPairs(contexts[regime], 900);
	const nearCorrelation = pearson(nearA, nearB);
	const midCorrelation = pearson(midA, midB);
	const farCorrelation = pearson(farA, farB);
	assert(nearCorrelation > 0.70, `${regime}: 25m continuity too weak ${nearCorrelation}`);
	assert(midCorrelation > -0.25 && midCorrelation < nearCorrelation - 0.08, `${regime}: 250m scale not distinct ${midCorrelation}`);
	assert(Math.abs(farCorrelation) < 0.45, `${regime}: 900m correlation too strong ${farCorrelation}`);
}

// No obvious X/Y axis preference in total residual energy. Drainage can be directional locally, but
// rotating a sample step by 90 degrees over the whole map should have similar mean delta.
function directionalDelta(context, stepMeters, count = 4096) {
	const dx = stepMeters / P.ownerWorldWidthMeters;
	const dy = stepMeters / P.ownerWorldHeightMeters;
	let eastWest = 0;
	let northSouth = 0;
	for (let i = 0; i < count; i += 1) {
		const nx = ((i * 0.38196601125) + 0.11) % 0.86 + 0.07;
		const ny = ((i * 0.73205080757) + 0.29) % 0.86 + 0.07;
		const center = terrainMacroWeatheringResidualMeters(nx, ny, context);
		eastWest += Math.abs(terrainMacroWeatheringResidualMeters(nx + dx, ny, context) - center);
		northSouth += Math.abs(terrainMacroWeatheringResidualMeters(nx, ny + dy, context) - center);
	}
	return { eastWest: eastWest / count, northSouth: northSouth / count };
}

for (const regime of ['upland', 'mountain']) {
	const delta = directionalDelta(contexts[regime], 80);
	const ratio = delta.eastWest / delta.northSouth;
	assert(ratio > 0.65 && ratio < 1.55, `${regime}: axis energy bias ${ratio}`);
}

// Water blending must monotonically attenuate the same point.
for (const [nx, ny] of [[0.17, 0.24], [0.43, 0.71], [0.81, 0.36]]) {
	const magnitudes = [];
	for (const waterWeight of [0, 0.25, 0.5, 0.75, 1]) {
		magnitudes.push(Math.abs(terrainMacroWeatheringResidualMeters(nx, ny, {
			...contexts.upland,
			waterWeight,
		})));
	}
	for (let i = 1; i < magnitudes.length; i += 1) {
		assert(
			magnitudes[i] <= magnitudes[i - 1] + 1e-10,
			`water attenuation is not monotonic at ${nx},${ny}: ${magnitudes}`,
		);
	}
	assert.equal(magnitudes.at(-1), 0);
}

const report = {
	policyId: P.id,
	regimes: summary,
	talusActiveFraction: { upland: uplandTalus, mountain: mountainTalus },
	directional80m: {
		upland: directionalDelta(contexts.upland, 80),
		mountain: directionalDelta(contexts.mountain, 80),
	},
};

console.log('[checkTerrainMacroWeatheringStatistics] PASS');
console.log(JSON.stringify(report, null, 2));

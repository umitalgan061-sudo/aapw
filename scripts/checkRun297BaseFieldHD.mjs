#!/usr/bin/env node
/**
 * Executable proof for the HD base-field sampling core (Run297).
 *
 * Unlike the per-pindex `checkRun2xx...` contract scripts, which assert that certain strings are
 * present in a source file, this one runs the code and checks numbers. Every claim the HD modules
 * make about correctness, canonical fidelity, coherence and determinism is asserted here.
 *
 * Pure math only — no Three.js, so it runs in bare Node with no import map.
 */

import {
	WORLD_REFERENCE_BASE_SURFACE_MASK as MASK,
	WORLD_REFERENCE_PINDEXES,
	classifyReferenceBaseSurface,
} from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
	BASE_FIELD_HD_POLICY,
	decodeBaseSurfaceMask,
	fractalValueNoise01,
	latticeHash01,
	sampleBaseSurfaceFast,
	sampleCoastBandFactor,
	sampleMicroDetailSigned,
	sampleSurfaceWeights,
	sampleWaterOccupancy,
	valueNoise2D,
	verifyFastSamplerMatchesCanonical,
} from '../src/3d/world/worldReferenceBaseFieldHD.js';

let failures = 0;
const results = [];
function check(label, condition, detail) {
	if (condition) {
		results.push(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
	} else {
		failures += 1;
		results.push(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
}

// ---------------------------------------------------------------- 1. canonical fidelity
const equivalence = verifyFastSamplerMatchesCanonical();
check(
	'fast sampler is bit-identical to the canonical BigInt classifier on every mask cell',
	equivalence.mismatches === 0 && equivalence.cellsCompared === MASK.width * MASK.height,
	`${equivalence.cellsCompared} cells, ${equivalence.mismatches} mismatches`,
);

// off-centre points too, including exact cell edges and the clamped extremes
let offCentreMismatches = 0;
let offCentreCompared = 0;
for (let i = 0; i < 20000; i += 1) {
	const nx = (i * 7919 % 100003) / 100003;
	const ny = (i * 104729 % 99991) / 99991;
	offCentreCompared += 1;
	if (sampleBaseSurfaceFast(nx, ny) !== classifyReferenceBaseSurface(nx, ny)) offCentreMismatches += 1;
}
for (const [nx, ny] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0.5], [1 / 96, 1 / 64], [0.1, 0.9]]) {
	offCentreCompared += 1;
	if (sampleBaseSurfaceFast(nx, ny) !== classifyReferenceBaseSurface(nx, ny)) offCentreMismatches += 1;
}
check(
	'fast sampler agrees off-centre, on cell edges and at clamped extremes',
	offCentreMismatches === 0,
	`${offCentreCompared} points, ${offCentreMismatches} mismatches`,
);

// declared metadata still matches the decoded mask
const BY_CODE = ['soil', 'rock', 'snow', 'sea', 'lake'];
const table = decodeBaseSurfaceMask();
const totals = { soil: 0, rock: 0, snow: 0, sea: 0, lake: 0 };
for (const code of table) totals[BY_CODE[code]] += 1;
const totalsMatch = Object.entries(MASK.cellCounts).every(([k, v]) => totals[k] === v);
check('decoded mask reproduces the declared cellCounts exactly', totalsMatch, JSON.stringify(totals));

const perPindex = Array.from({ length: 10 }, () => ({ soil: 0, rock: 0, snow: 0, sea: 0, lake: 0 }));
for (let y = 0; y < MASK.height; y += 1) {
	for (let x = 0; x < MASK.width; x += 1) {
		const p = Math.min(10, Math.floor(((x + 0.5) / MASK.width) * 10) + 1);
		perPindex[p - 1][BY_CODE[table[y * MASK.width + x]]] += 1;
	}
}
const pindexMetaOk = WORLD_REFERENCE_PINDEXES.every((meta) =>
	['sea', 'lake', 'soil', 'rock', 'snow'].every((k) => (meta.baseCellCounts[k] ?? 0) === perPindex[meta.index - 1][k]));
check('every declared per-pindex baseCellCounts matches the decoded mask', pindexMetaOk, '10/10 strips');

// ---------------------------------------------------------------- 2. water occupancy contract
let centreViolations = 0;
let intermediateCells = 0;
for (let y = 0; y < MASK.height; y += 1) {
	for (let x = 0; x < MASK.width; x += 1) {
		const nx = (x + 0.5) / MASK.width;
		const ny = (y + 0.5) / MASK.height;
		const occupancy = sampleWaterOccupancy(nx, ny);
		const code = table[y * MASK.width + x];
		const expected = code === 3 || code === 4 ? 1 : 0;
		if (occupancy !== expected) centreViolations += 1;
	}
}
check(
	'water occupancy is EXACTLY 0 or 1 at every cell centre (canonical classification preserved)',
	centreViolations === 0,
	`${MASK.width * MASK.height} centres, ${centreViolations} violations`,
);

let outOfRange = 0;
for (let i = 0; i < 40000; i += 1) {
	const nx = (i * 7919 % 100003) / 100003;
	const ny = (i * 104729 % 99991) / 99991;
	const occupancy = sampleWaterOccupancy(nx, ny);
	if (!(occupancy >= 0 && occupancy <= 1)) outOfRange += 1;
	if (occupancy > 0 && occupancy < 1) intermediateCells += 1;
}
check('water occupancy stays inside [0,1] everywhere', outOfRange === 0, `${outOfRange} out-of-range of 40000`);
check(
	'water occupancy produces real sub-cell gradient (this is the anti-staircase signal)',
	intermediateCells > 2000,
	`${intermediateCells} of 40000 samples are strictly between 0 and 1`,
);

// coast band factor: 0 on the interface, 1 deep in a medium
const bandDeep = sampleCoastBandFactor(0.02, 0.02);
check('coast band factor saturates to 1 deep inside a single medium', Math.abs(bandDeep - 1) < 1e-12, `got ${bandDeep}`);

// --------------------------------------------- 2b. per-class surface weights (all interfaces)
let weightSumViolations = 0;
let weightRangeViolations = 0;
let oneHotViolations = 0;
for (let y = 0; y < MASK.height; y += 1) {
	for (let x = 0; x < MASK.width; x += 1) {
		const weights = sampleSurfaceWeights((x + 0.5) / MASK.width, (y + 0.5) / MASK.height);
		const own = BY_CODE[table[y * MASK.width + x]];
		if (weights[own] !== 1) oneHotViolations += 1;
		for (const key of Object.keys(weights)) {
			if (key !== own && weights[key] !== 0) oneHotViolations += 1;
		}
	}
}
for (let i = 0; i < 40000; i += 1) {
	const weights = sampleSurfaceWeights((i * 7919 % 100003) / 100003, (i * 104729 % 99991) / 99991);
	const values = Object.values(weights);
	if (Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 1e-12) weightSumViolations += 1;
	if (values.some((value) => value < 0 || value > 1)) weightRangeViolations += 1;
}
check(
	'per-class surface weights are one-hot at every cell centre (canonical colour preserved exactly)',
	oneHotViolations === 0,
	`${MASK.width * MASK.height} centres, ${oneHotViolations} violations`,
);
check('per-class surface weights sum to exactly 1', weightSumViolations === 0, `${weightSumViolations} of 40000`);
check('per-class surface weights stay inside [0,1]', weightRangeViolations === 0, `${weightRangeViolations} of 40000`);

let mixedInterfaceSamples = 0;
for (let i = 0; i < 40000; i += 1) {
	const weights = sampleSurfaceWeights((i * 7919 % 100003) / 100003, (i * 104729 % 99991) / 99991);
	if (Object.values(weights).filter((value) => value > 0).length > 1) mixedInterfaceSamples += 1;
}
check(
	'weights blend across every interface type, not only land/water',
	mixedInterfaceSamples > 5000,
	`${mixedInterfaceSamples} of 40000 samples mix two or more surface classes`,
);

// ---------------------------------------------------------------- 3. noise coherence
function autocorrelationAtStep(step) {
	let sum = 0;
	let sumSq = 0;
	let cross = 0;
	let pairs = 0;
	let previous = null;
	let count = 0;
	for (let nx = 0.30; nx <= 0.95; nx += step) {
		const value = sampleMicroDetailSigned(nx, 0.5, BASE_FIELD_HD_POLICY.noiseOctaves * 1000 + 7);
		sum += value;
		sumSq += value * value;
		count += 1;
		if (previous !== null) {
			cross += value * previous;
			pairs += 1;
		}
		previous = value;
	}
	const mean = sum / count;
	const variance = sumSq / count - mean * mean;
	return (cross / pairs - mean * mean) / variance;
}
const coherenceAtMaskCell = autocorrelationAtStep(1 / MASK.width);
const coherenceAtEighthCell = autocorrelationAtStep(1 / (MASK.width * 8));

function legacyHash01(x, y) {
	const value = Math.sin(x * 5.347 + y * 91.223 + 33.667) * 43758.5453;
	return value - Math.floor(value);
}
function legacyAutocorrelation(step) {
	let sum = 0;
	let sumSq = 0;
	let cross = 0;
	let pairs = 0;
	let previous = null;
	let count = 0;
	for (let nx = 0.30; nx <= 0.95; nx += step) {
		const value = legacyHash01(nx * 1024, 0.5 * 1024);
		sum += value;
		sumSq += value * value;
		count += 1;
		if (previous !== null) {
			cross += value * previous;
			pairs += 1;
		}
		previous = value;
	}
	const mean = sum / count;
	const variance = sumSq / count - mean * mean;
	return (cross / pairs - mean * mean) / variance;
}
const legacyAtMaskCell = legacyAutocorrelation(1 / MASK.width);

check(
	'HD micro-detail is spatially coherent at one sample per mask cell',
	coherenceAtMaskCell > 0.5,
	`autocorrelation ${coherenceAtMaskCell.toFixed(4)} (legacy sin-hash: ${legacyAtMaskCell.toFixed(4)})`,
);
check(
	'HD micro-detail stays coherent at eight samples per mask cell',
	coherenceAtEighthCell > 0.9,
	`autocorrelation ${coherenceAtEighthCell.toFixed(4)}`,
);

// noise must still be full-range, not a flat field
let noiseMin = Infinity;
let noiseMax = -Infinity;
for (let i = 0; i < 20000; i += 1) {
	const value = sampleMicroDetailSigned((i % 977) / 977, (i % 613) / 613, BASE_FIELD_HD_POLICY.noiseOctaves);
	if (value < noiseMin) noiseMin = value;
	if (value > noiseMax) noiseMax = value;
}
check(
	'HD micro-detail keeps a usable signed range (coherent, not flattened)',
	noiseMin < -0.3 && noiseMax > 0.3 && noiseMin >= -1 && noiseMax <= 1,
	`range [${noiseMin.toFixed(4)}, ${noiseMax.toFixed(4)}]`,
);

// value noise must interpolate, not step: consecutive fine samples move smoothly
let maxFineJump = 0;
let previousFine = valueNoise2D(3, 5, 11);
for (let i = 1; i <= 4000; i += 1) {
	const value = valueNoise2D(3 + i / 4000, 5, 11);
	maxFineJump = Math.max(maxFineJump, Math.abs(value - previousFine));
	previousFine = value;
}
check(
	'single-octave value noise is continuous across a lattice cell (no creases)',
	maxFineJump < 0.01,
	`max step ${maxFineJump.toExponential(2)} over 4000 samples`,
);

// ---------------------------------------------------------------- 4. determinism
const determinismProbe = [];
for (let i = 0; i < 512; i += 1) {
	determinismProbe.push(sampleMicroDetailSigned(i / 512, ((i * 37) % 512) / 512, BASE_FIELD_HD_POLICY.noiseOctaves));
}
const determinismProbeAgain = [];
for (let i = 0; i < 512; i += 1) {
	determinismProbeAgain.push(sampleMicroDetailSigned(i / 512, ((i * 37) % 512) / 512, BASE_FIELD_HD_POLICY.noiseOctaves));
}
check(
	'micro-detail is reproducible sample-for-sample within a process',
	determinismProbe.every((value, index) => value === determinismProbeAgain[index]),
	'512/512 identical',
);

// integer-only hash: identical inputs across sign and magnitude stay in [0,1)
let hashOutOfRange = 0;
for (const [x, y, s] of [[0, 0, 0], [-1, -1, 1], [2147483647, -2147483648, 7], [12345, 67890, 0x5eed10]]) {
	const value = latticeHash01(x, y, s);
	if (!(value >= 0 && value < 1)) hashOutOfRange += 1;
}
check('lattice hash stays in [0,1) for extreme and negative integer inputs', hashOutOfRange === 0);

const noiseSourceText = await (await import('node:fs/promises')).readFile(
	new URL('../src/3d/world/worldReferenceBaseFieldHD.js', import.meta.url), 'utf8');
check('HD base field contains no Math.random', !noiseSourceText.includes('Math.random('));
check('HD base field contains no Date-based seeding', !/new Date\(|Date\.now\(/.test(noiseSourceText));

// stable checksum over the whole decoded mask + a fixed noise probe grid
let checksum = 0x811c9dc5;
for (const code of table) {
	checksum ^= code;
	checksum = Math.imul(checksum, 0x01000193) >>> 0;
}
for (let i = 0; i < 4096; i += 1) {
	const value = Math.round(sampleMicroDetailSigned((i % 64) / 64, Math.floor(i / 64) / 64, 0x5eed10) * 1e6);
	checksum ^= value >>> 0;
	checksum = Math.imul(checksum, 0x01000193) >>> 0;
}
/**
 * Pinned deterministic regression snapshot (GOVERNANCE.md — Deterministic Regression Snapshot).
 * Covers the full decoded 96x64 mask plus a fixed 64x64 micro-detail probe grid. Any unexplained
 * change here means the base map or the noise field moved; that is a regression unless an ADR
 * documents it, in which case re-pin this constant in the same commit as the ADR.
 */
const EXPECTED_CHECKSUM = 4016472793;
check(
	'deterministic regression checksum unchanged (mask + 4096-point noise probe)',
	checksum === EXPECTED_CHECKSUM,
	`got ${checksum}, expected ${EXPECTED_CHECKSUM}`,
);

// ---------------------------------------------------------------- 5. performance
const PERF_SAMPLES = 120000;
let sink = 0;
let start = process.hrtime.bigint();
for (let i = 0; i < PERF_SAMPLES; i += 1) {
	sink += classifyReferenceBaseSurface((i % 977) / 977, (i % 613) / 613).length;
}
const canonicalNs = Number(process.hrtime.bigint() - start) / PERF_SAMPLES;
start = process.hrtime.bigint();
for (let i = 0; i < PERF_SAMPLES; i += 1) {
	sink += sampleBaseSurfaceFast((i % 977) / 977, (i % 613) / 613).length;
}
const fastNs = Number(process.hrtime.bigint() - start) / PERF_SAMPLES;
const speedup = canonicalNs / fastNs;
check(
	'HD sampler is materially faster than the per-call BigInt classifier',
	speedup >= 5,
	`${canonicalNs.toFixed(0)} ns/call -> ${fastNs.toFixed(1)} ns/call (x${speedup.toFixed(1)}), sink=${sink}`,
);

// ---------------------------------------------------------------- report
console.log('[checkRun297BaseFieldHD]');
for (const line of results) console.log(line);
if (failures > 0) {
	console.error(`[checkRun297BaseFieldHD] FAIL: ${failures} check(s) failed`);
	process.exitCode = 1;
} else {
	console.log(`[checkRun297BaseFieldHD] PASS: all ${results.filter((r) => r.includes('PASS')).length} checks green`);
}

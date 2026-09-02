/**
 * Ridge-local secondary landform detail for canonical owner-map mountain chains.
 *
 * The reference map and worldReferenceMountainRelief remain the geographic authority. This module
 * never moves a chain, widens its support, changes water ownership, or creates a new river. It only
 * modulates height *inside* an already accepted mountain shoulder using the chain-local tangent /
 * normal frame. The resulting saddles, headwall recesses, branching gullies and interfluve ribs make
 * long ranges read as connected eroded massifs instead of smooth extruded walls.
 *
 * All hot-path helpers are deterministic and allocation-free when the caller supplies `out`.
 * Context channels are normalized [0,1] signals intended for downstream geology/material/vegetation
 * placement policy; they do not place assets and do not replace the shared world placement pipeline.
 *
 * @module world/worldReferenceMountainLandformDetail
 */

import { sampleMountainRidgeFrameInto } from './worldReferenceMountainRidgeFrame.js';

const TAU = Math.PI * 2;
const FRAME_SCRATCH = {
	distance: 0,
	signedDistance: 0,
	side: 0,
	segmentIndex: 0,
	segmentT: 0,
	progress: 0,
	nearestX: 0,
	nearestY: 0,
	tangentX: 1,
	tangentY: 0,
	normalX: 0,
	normalY: 1,
	totalLength: 0,
};

export const WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY = Object.freeze({
	id: 'owner-map-mountain-landform-2026-09-02-v1-ridge-drainage-breakup',
	scale: Object.freeze({ minimum: 0.80, maximum: 1.12 }),
	massifSegmentation: Object.freeze({
		broadCycles: 4.2,
		detailCycles: 10.6,
		strength: 0.075,
	}),
	saddles: Object.freeze({
		frequency: 12.5,
		threshold: 0.64,
		coreEnd: 0.50,
		strength: 0.13,
	}),
	headwallRecess: Object.freeze({
		frequency: 8.5,
		threshold: 0.59,
		start: 0.08,
		peak: 0.31,
		end: 0.58,
		strength: 0.11,
	}),
	branchingGullies: Object.freeze({
		primaryFrequency: 23,
		secondaryFrequency: 41,
		branchSkew: 7.5,
		start: 0.20,
		peak: 0.62,
		end: 0.93,
		strength: 0.16,
	}),
	interfluveRibs: Object.freeze({
		frequency: 17,
		start: 0.26,
		peak: 0.58,
		end: 0.90,
		strength: 0.075,
	}),
	convexConcaveSlope: Object.freeze({
		frequency: 6.3,
		start: 0.18,
		end: 0.90,
		strength: 0.055,
	}),
	outerNeutralization: Object.freeze({ start: 0.84, end: 0.975 }),
});

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
	return clamp(value, 0, 1);
}

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function triangularBand(value, start, peak, end) {
	if (value <= start || value >= end) return 0;
	if (value <= peak) return smoothstep(start, peak, value);
	return 1 - smoothstep(peak, end, value);
}

function hash1D(index, seed) {
	let value = Math.imul((index | 0) ^ (seed | 0), 0x45d9f3b);
	value ^= value >>> 16;
	value = Math.imul(value, 0x45d9f3b);
	value ^= value >>> 16;
	return (value >>> 0) / 0x100000000;
}

function hash2D(x, y, seed) {
	let value = Math.imul((x | 0) ^ (seed | 0), 0x27d4eb2d)
		^ Math.imul((y | 0) + (seed | 0), 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function valueNoise1D(x, seed) {
	const x0 = Math.floor(x);
	const t = smoothstep(0, 1, x - x0);
	const a = hash1D(x0, seed);
	const b = hash1D(x0 + 1, seed);
	return a + (b - a) * t;
}

function valueNoise2D(x, y, seed) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = smoothstep(0, 1, x - x0);
	const ty = smoothstep(0, 1, y - y0);
	const a = hash2D(x0, y0, seed);
	const b = hash2D(x0 + 1, y0, seed);
	const c = hash2D(x0, y0 + 1, seed);
	const d = hash2D(x0 + 1, y0 + 1, seed);
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;
	return top + (bottom - top) * ty;
}

function centered(value) {
	return (value - 0.5) * 2;
}

function stripeDistance(phase) {
	const wave = Math.sin(phase * TAU);
	return Math.abs(wave);
}

function sampleMassifSegmentation(progress, normalizedX, normalizedY, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.massifSegmentation;
	const broad = valueNoise1D(progress * policy.broadCycles + seed * 0.013, seed + 1301);
	const detail = valueNoise1D(progress * policy.detailCycles - seed * 0.009, seed + 1327);
	const mapBreak = valueNoise2D(
		normalizedX * 7.1 + progress * 1.6,
		normalizedY * 7.1 - progress * 1.2,
		seed + 1361,
	);
	return 1 + centered(broad * 0.55 + detail * 0.28 + mapBreak * 0.17) * policy.strength;
}

function sampleSaddleExposure(progress, normalizedDistance, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.saddles;
	if (normalizedDistance >= policy.coreEnd) return 0;
	const coreEnvelope = 1 - smoothstep(policy.coreEnd * 0.56, policy.coreEnd, normalizedDistance);
	const carrier = valueNoise1D(progress * policy.frequency + seed * 0.017, seed + 1409);
	return smoothstep(policy.threshold, 0.94, carrier) * coreEnvelope;
}

function sampleHeadwallExposure(progress, normalizedDistance, normalizedX, normalizedY, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.headwallRecess;
	const band = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (band <= 0) return 0;
	const longitudinal = valueNoise1D(progress * policy.frequency + seed * 0.021, seed + 1451);
	const lateral = valueNoise2D(
		normalizedX * 15.7 + progress * 2.1,
		normalizedY * 15.7 - progress * 1.7,
		seed + 1483,
	);
	return smoothstep(policy.threshold, 0.93, longitudinal * 0.72 + lateral * 0.28) * band;
}

function sampleBranchingGullyExposure(progress, normalizedDistance, side, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.branchingGullies;
	const band = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (band <= 0) return 0;
	const sidePhase = side < 0 ? -0.37 : side > 0 ? 0.41 : 0;
	const branch = normalizedDistance * policy.branchSkew;
	const primaryDistance = stripeDistance(
		progress * policy.primaryFrequency + branch + sidePhase + seed * 0.0029,
	);
	const secondaryDistance = stripeDistance(
		progress * policy.secondaryFrequency - branch * 0.63 - sidePhase * 0.7 + seed * 0.0047,
	);
	const primary = 1 - smoothstep(0.06, 0.34, primaryDistance);
	const secondary = 1 - smoothstep(0.05, 0.27, secondaryDistance);
	const branchMix = clamp01(primary * 0.72 + secondary * 0.42);
	const breakup = 0.72 + 0.28 * valueNoise1D(progress * 31 + normalizedDistance * 13, seed + 1511);
	return branchMix * band * breakup;
}

function sampleInterfluveRibExposure(progress, normalizedDistance, side, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.interfluveRibs;
	const band = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (band <= 0) return 0;
	const sidePhase = side < 0 ? 0.23 : 0.71;
	const carrier = stripeDistance(
		progress * policy.frequency - normalizedDistance * 5.1 + sidePhase + seed * 0.0037,
	);
	const rib = smoothstep(0.42, 0.94, carrier);
	const irregularity = 0.68 + 0.32 * valueNoise1D(progress * 14.3 + normalizedDistance * 9.7, seed + 1559);
	return rib * band * irregularity;
}

function sampleConvexConcaveSigned(progress, normalizedDistance, side, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.convexConcaveSlope;
	if (normalizedDistance <= policy.start || normalizedDistance >= policy.end || side === 0) return 0;
	const band = smoothstep(policy.start, policy.start + 0.18, normalizedDistance)
		* (1 - smoothstep(policy.end - 0.16, policy.end, normalizedDistance));
	const regional = centered(valueNoise1D(progress * policy.frequency + seed * 0.011, seed + 1601));
	const local = centered(valueNoise1D(progress * 15.1 - seed * 0.006, seed + 1619));
	return side * (regional * 0.72 + local * 0.28) * band;
}

function outerNeutralization(normalizedDistance) {
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.outerNeutralization;
	if (normalizedDistance <= policy.start) return 1;
	return 1 - smoothstep(policy.start, policy.end, normalizedDistance);
}

const DETAIL_SCRATCH = {
	heightScale: 1,
	progress: 0,
	side: 0,
	massifScale: 1,
	saddleExposure: 0,
	headwallExposure: 0,
	gullyExposure: 0,
	ribExposure: 0,
	concavity: 0.5,
	outerFade: 1,
	cliffPotential: 0,
	screePotential: 0,
	depositionPotential: 0,
	snowRetentionPotential: 0,
};

/** Allocation-free detailed sample. The caller owns `out`. */
export function sampleMountainLandformDetailInto(
	normalizedX,
	normalizedY,
	chainPoints,
	mapAspect,
	normalizedDistance,
	seed,
	intensity,
	out,
) {
	if (!Number.isFinite(normalizedDistance) || normalizedDistance < 0 || normalizedDistance > 1) {
		throw new RangeError('normalizedDistance must be finite in [0,1]');
	}
	if (!Number.isFinite(intensity) || intensity < 0.5 || intensity > 1.35) {
		throw new RangeError('mountain landform intensity must be finite in [0.5,1.35]');
	}
	if (!out || typeof out !== 'object') throw new TypeError('out scratch object is required');

	sampleMountainRidgeFrameInto(
		normalizedX,
		normalizedY,
		chainPoints,
		mapAspect,
		FRAME_SCRATCH,
		true,
	);
	const progress = FRAME_SCRATCH.progress;
	const side = FRAME_SCRATCH.side;
	const massifScale = sampleMassifSegmentation(progress, normalizedX, normalizedY, seed);
	const saddleExposure = sampleSaddleExposure(progress, normalizedDistance, seed);
	const headwallExposure = sampleHeadwallExposure(progress, normalizedDistance, normalizedX, normalizedY, seed);
	const gullyExposure = sampleBranchingGullyExposure(progress, normalizedDistance, side, seed);
	const ribExposure = sampleInterfluveRibExposure(progress, normalizedDistance, side, seed);
	const convexConcaveSigned = sampleConvexConcaveSigned(progress, normalizedDistance, side, seed);
	const concavity = clamp01(0.5 - convexConcaveSigned * 0.5);
	const edgeFade = outerNeutralization(normalizedDistance);

	const rawScale = massifScale
		* (1 - saddleExposure * WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.saddles.strength)
		* (1 - headwallExposure * WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.headwallRecess.strength)
		* (1 - gullyExposure * WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.branchingGullies.strength)
		* (1 + ribExposure * WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.interfluveRibs.strength)
		* (1 + convexConcaveSigned * WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.convexConcaveSlope.strength);
	const intensityScale = 1 + (rawScale - 1) * intensity;
	const edgeBlendedScale = 1 + (intensityScale - 1) * edgeFade;
	const policy = WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.scale;

	const upperSlope = triangularBand(normalizedDistance, 0.08, 0.34, 0.68);
	const midLowerSlope = triangularBand(normalizedDistance, 0.34, 0.66, 0.95);
	const cliffPotential = clamp01(
		headwallExposure * 0.58
		+ saddleExposure * 0.20
		+ gullyExposure * upperSlope * 0.34
		+ ribExposure * upperSlope * 0.22,
	);
	const screePotential = clamp01(
		cliffPotential * 0.54
		+ gullyExposure * midLowerSlope * 0.50
		+ ribExposure * midLowerSlope * 0.24,
	);
	const depositionPotential = clamp01(
		gullyExposure * triangularBand(normalizedDistance, 0.52, 0.78, 0.97) * 0.72
		+ concavity * midLowerSlope * 0.38,
	);
	const snowRetentionPotential = clamp01(
		concavity * upperSlope * 0.46
		+ headwallExposure * 0.34
		+ saddleExposure * 0.28
		- ribExposure * 0.18,
	);

	out.heightScale = clamp(edgeBlendedScale, policy.minimum, policy.maximum);
	out.progress = progress;
	out.side = side;
	out.massifScale = massifScale;
	out.saddleExposure = saddleExposure;
	out.headwallExposure = headwallExposure;
	out.gullyExposure = gullyExposure;
	out.ribExposure = ribExposure;
	out.concavity = concavity;
	out.outerFade = edgeFade;
	out.cliffPotential = cliffPotential;
	out.screePotential = screePotential;
	out.depositionPotential = depositionPotential;
	out.snowRetentionPotential = snowRetentionPotential;
	return out;
}

/** Hot-path scalar used by the mountain height sampler. */
export function sampleMountainLandformDetailScale(
	normalizedX,
	normalizedY,
	chainPoints,
	mapAspect,
	normalizedDistance,
	seed,
	intensity = 1,
) {
	return sampleMountainLandformDetailInto(
		normalizedX,
		normalizedY,
		chainPoints,
		mapAspect,
		normalizedDistance,
		seed,
		intensity,
		DETAIL_SCRATCH,
	).heightScale;
}

/** Diagnostic/placement context; allocation is intentional outside the terrain hot path. */
export function sampleMountainLandformDetailContext(
	normalizedX,
	normalizedY,
	chainPoints,
	mapAspect,
	normalizedDistance,
	seed,
	intensity = 1,
) {
	const out = {};
	sampleMountainLandformDetailInto(
		normalizedX,
		normalizedY,
		chainPoints,
		mapAspect,
		normalizedDistance,
		seed,
		intensity,
		out,
	);
	return Object.freeze({
		policyId: WORLD_REFERENCE_MOUNTAIN_LANDFORM_POLICY.id,
		heightScale: out.heightScale,
		progress: out.progress,
		side: out.side,
		massifScale: out.massifScale,
		saddleExposure: out.saddleExposure,
		headwallExposure: out.headwallExposure,
		gullyExposure: out.gullyExposure,
		ribExposure: out.ribExposure,
		concavity: out.concavity,
		outerEdgeFade: out.outerFade,
		cliffPotential: out.cliffPotential,
		screePotential: out.screePotential,
		depositionPotential: out.depositionPotential,
		snowRetentionPotential: out.snowRetentionPotential,
	});
}

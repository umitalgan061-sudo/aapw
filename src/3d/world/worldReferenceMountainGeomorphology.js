/**
 * Bounded geomorphology modulation for canonical owner-map mountain relief.
 *
 * This module changes no centerline, water ownership, coastline, biome zone, road, settlement, or
 * collider authority. It supplies deterministic morphology *inside* the existing mountain support:
 * longitudinal massing, side asymmetry, sparse crest notches, shoulder gullies, and secondary spur
 * energy. The caller still owns the canonical ridge envelope and multiplies these terms only after
 * proving that a sample lies inside it.
 *
 * The intent is to remove the smooth grey wall / extruded-tube read from long ranges while keeping
 * the same source-derived geography and the same height sampler for rendering and collision.
 *
 * @module world/worldReferenceMountainGeomorphology
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

export const WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY = Object.freeze({
	id: 'owner-map-mountain-geomorphology-2026-09-02-v1-eroded-ridge-frame',
	heightScale: Object.freeze({
		minimum: 0.76,
		maximum: 1.13,
	}),
	longitudinalMassing: Object.freeze({
		broadCycles: 3.4,
		detailCycles: 8.7,
		strength: 0.095,
	}),
	ridgeAsymmetry: Object.freeze({
		strength: 0.085,
		coreFadeStart: 0.08,
		coreFadeEnd: 0.62,
	}),
	crestNotches: Object.freeze({
		frequency: 19,
		threshold: 0.76,
		strength: 0.085,
		coreEnd: 0.34,
	}),
	shoulderIncision: Object.freeze({
		broadFrequency: 17,
		detailFrequency: 41,
		start: 0.24,
		peak: 0.62,
		end: 0.94,
		strength: 0.13,
	}),
	secondarySpurs: Object.freeze({
		frequency: 13,
		start: 0.30,
		peak: 0.58,
		end: 0.88,
		strength: 0.075,
	}),
	outerEdgeFadeStart: 0.86,
	outerEdgeFadeEnd: 0.985,
});

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
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

function triangularBand(value, start, peak, end) {
	if (value <= start || value >= end) return 0;
	if (value <= peak) return smoothstep(start, peak, value);
	return 1 - smoothstep(peak, end, value);
}

function centeredNoise(value) {
	return (value - 0.5) * 2;
}

function sampleLongitudinalMassing(progress, normalizedX, normalizedY, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY.longitudinalMassing;
	const broad = valueNoise1D(progress * policy.broadCycles + seed * 0.013, seed + 811);
	const detail = valueNoise1D(progress * policy.detailCycles - seed * 0.007, seed + 877);
	const mapBreakup = valueNoise2D(
		normalizedX * 5.3 + progress * 1.7,
		normalizedY * 5.3 - progress * 1.1,
		seed + 919,
	);
	const centered = centeredNoise(broad * 0.57 + detail * 0.25 + mapBreakup * 0.18);
	return 1 + centered * policy.strength;
}

function sampleRidgeAsymmetry(side, progress, normalizedDistance, seed) {
	if (side === 0) return 1;
	const policy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY.ridgeAsymmetry;
	const sideEnvelope = smoothstep(policy.coreFadeStart, policy.coreFadeEnd, normalizedDistance);
	if (sideEnvelope <= 0) return 1;
	const regional = centeredNoise(valueNoise1D(progress * 4.7 + seed * 0.021, seed + 997));
	const local = 0.55 + 0.45 * Math.sin(TAU * (progress * 5.9 + seed * 0.0031));
	const signed = side * regional * local;
	return 1 + signed * policy.strength * sideEnvelope;
}

function sampleCrestNotch(progress, normalizedDistance, normalizedX, normalizedY, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY.crestNotches;
	if (normalizedDistance >= policy.coreEnd) return 1;
	const coreEnvelope = 1 - smoothstep(policy.coreEnd * 0.45, policy.coreEnd, normalizedDistance);
	const carrier = valueNoise1D(progress * policy.frequency + seed * 0.009, seed + 1031);
	if (carrier <= policy.threshold) return 1;
	const notch = smoothstep(policy.threshold, 1, carrier);
	const wander = 0.72 + valueNoise2D(
		normalizedX * 23,
		normalizedY * 23,
		seed + 1069,
	) * 0.28;
	return 1 - notch * policy.strength * coreEnvelope * wander;
}

function sampleShoulderIncision(normalizedX, normalizedY, progress, normalizedDistance, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY.shoulderIncision;
	const envelope = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (envelope <= 0) return 1;
	const broad = valueNoise2D(
		normalizedX * policy.broadFrequency + progress * 3.1,
		normalizedY * policy.broadFrequency - progress * 2.3,
		seed + 1103,
	);
	const detail = valueNoise2D(
		normalizedX * policy.detailFrequency - progress * 7.7,
		normalizedY * policy.detailFrequency + progress * 5.3,
		seed + 1151,
	);
	// Bias toward erosion: only the upper half of the field cuts into the shoulder.
	const erosionSignal = smoothstep(0.48, 0.92, broad * 0.68 + detail * 0.32);
	return 1 - erosionSignal * policy.strength * envelope;
}

function sampleSecondarySpur(normalizedX, normalizedY, progress, normalizedDistance, side, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY.secondarySpurs;
	const envelope = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (envelope <= 0) return 1;
	const sidePhase = side < 0 ? 0.37 : 0.73;
	const carrier = valueNoise2D(
		normalizedX * policy.frequency + progress * 4.1 + sidePhase,
		normalizedY * policy.frequency - progress * 2.9 - sidePhase,
		seed + 1201,
	);
	const ridgelet = smoothstep(0.58, 0.92, carrier);
	return 1 + ridgelet * policy.strength * envelope;
}

function sampleOuterEdgeFade(normalizedDistance) {
	const policy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY;
	if (normalizedDistance <= policy.outerEdgeFadeStart) return 1;
	return 1 - smoothstep(policy.outerEdgeFadeStart, policy.outerEdgeFadeEnd, normalizedDistance);
}

const COMPONENT_SCRATCH = {
	heightScale: 1,
	progress: 0,
	side: 0,
	signedDistance: 0,
	longitudinal: 1,
	asymmetry: 1,
	crestNotch: 1,
	incision: 1,
	spur: 1,
	outerFade: 1,
};

function resolveComponentsInto(
	normalizedX,
	normalizedY,
	chainPoints,
	mapAspect,
	normalizedDistance,
	seed,
	out,
) {
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
	const longitudinal = sampleLongitudinalMassing(progress, normalizedX, normalizedY, seed);
	const asymmetry = sampleRidgeAsymmetry(side, progress, normalizedDistance, seed);
	const crestNotch = sampleCrestNotch(
		progress,
		normalizedDistance,
		normalizedX,
		normalizedY,
		seed,
	);
	const incision = sampleShoulderIncision(
		normalizedX,
		normalizedY,
		progress,
		normalizedDistance,
		seed,
	);
	const spur = sampleSecondarySpur(
		normalizedX,
		normalizedY,
		progress,
		normalizedDistance,
		side,
		seed,
	);
	const outerFade = sampleOuterEdgeFade(normalizedDistance);
	const rawScale = longitudinal * asymmetry * crestNotch * incision * spur;
	const edgeBlendedScale = 1 + (rawScale - 1) * outerFade;
	const scalePolicy = WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY.heightScale;
	out.heightScale = clamp(edgeBlendedScale, scalePolicy.minimum, scalePolicy.maximum);
	out.progress = progress;
	out.side = side;
	out.signedDistance = FRAME_SCRATCH.signedDistance;
	out.longitudinal = longitudinal;
	out.asymmetry = asymmetry;
	out.crestNotch = crestNotch;
	out.incision = incision;
	out.spur = spur;
	out.outerFade = outerFade;
	return out;
}

/**
 * Hot-path scalar used by the canonical mountain relief sampler.
 *
 * The function never widens support. It is called only after the owner-map ridge distance has already
 * passed the caller's `distance < outerWidth` gate.
 */
export function sampleMountainGeomorphologyScale(
	normalizedX,
	normalizedY,
	chainPoints,
	mapAspect,
	normalizedDistance,
	seed,
) {
	if (!Number.isFinite(normalizedDistance) || normalizedDistance < 0 || normalizedDistance > 1) {
		throw new RangeError('normalizedDistance must be finite in [0,1]');
	}
	return resolveComponentsInto(
		normalizedX,
		normalizedY,
		chainPoints,
		mapAspect,
		normalizedDistance,
		seed,
		COMPONENT_SCRATCH,
	).heightScale;
}

/**
 * Rich deterministic evidence for visual QA and downstream mountain-aware placement.
 *
 * `talusExposure` and `bedrockExposure` are context signals only; they do not place assets or replace
 * the shared MaterialAssignmentCore/WorldAssetPlacementPipeline contract.
 */
export function sampleMountainGeomorphologyContext(
	normalizedX,
	normalizedY,
	chainPoints,
	mapAspect,
	normalizedDistance,
	seed,
) {
	const components = resolveComponentsInto(
		normalizedX,
		normalizedY,
		chainPoints,
		mapAspect,
		normalizedDistance,
		seed,
		COMPONENT_SCRATCH,
	);
	const talusExposure = triangularBand(normalizedDistance, 0.42, 0.70, 0.96)
		* clamp((1 - components.incision) * 4.5 + (components.spur - 1) * 2.2, 0, 1);
	const bedrockExposure = clamp(
		(1 - normalizedDistance) * 0.58
		+ (1 - components.crestNotch) * 2.6
		+ Math.max(0, 1 - components.asymmetry) * 1.8,
		0,
		1,
	);
	return Object.freeze({
		policyId: WORLD_REFERENCE_MOUNTAIN_GEOMORPHOLOGY_POLICY.id,
		heightScale: components.heightScale,
		progress: components.progress,
		side: components.side,
		signedDistance: components.signedDistance,
		longitudinalMassing: components.longitudinal,
		ridgeAsymmetry: components.asymmetry,
		crestNotch: components.crestNotch,
		shoulderIncision: components.incision,
		secondarySpur: components.spur,
		outerEdgeFade: components.outerFade,
		talusExposure,
		bedrockExposure,
	});
}

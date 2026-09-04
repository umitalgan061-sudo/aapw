/**
 * Ridge-local erosion field used by the canonical mountain geomorphology owner.
 *
 * This helper owns no geography: it receives progress/side/distance already derived from a
 * source-owned mountain chain and returns bounded deterministic erosion multipliers plus surface
 * context. It cannot widen mountain support, move a ridge, classify water, place an asset, or attach
 * anything to the scene. `worldReferenceMountainGeomorphology.js` remains the only live morphology
 * owner and decides whether this field contributes to the shared terrain/collider height sampler.
 *
 * The field intentionally combines branching gullies with offset interfluve ribs and sparse
 * headwall recesses. Those structures break the long smooth wall/shelf read in oblique shipped
 * views without introducing world-axis stripes or independent drainage geography.
 *
 * @module world/worldReferenceMountainErosionField
 */

const TAU = Math.PI * 2;

export const WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY = Object.freeze({
	id: 'owner-map-mountain-erosion-2026-09-02-v3-ridge-local-drainage-basin-apron-safe',
	heightScale: Object.freeze({ minimum: 0.82, maximum: 1.10 }),
	headwall: Object.freeze({
		frequency: 8.4,
		threshold: 0.58,
		start: 0.08,
		peak: 0.30,
		end: 0.58,
		strength: 0.115,
	}),
	gullies: Object.freeze({
		primaryFrequency: 12,
		secondaryFrequency: 23,
		branchSkew: 7.1,
		start: 0.20,
		peak: 0.56,
		end: 0.82,
		strength: 0.125,
	}),
	interfluveRibs: Object.freeze({
		frequency: 10,
		branchSkew: 4.9,
		start: 0.26,
		peak: 0.54,
		end: 0.80,
		strength: 0.055,
	}),
	convexConcave: Object.freeze({
		frequency: 6.1,
		start: 0.18,
		end: 0.80,
		strength: 0.038,
	}),
	outerFadeStart: 0.72,
	outerFadeEnd: 0.90,
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

function valueNoise1D(x, seed) {
	const x0 = Math.floor(x);
	const t = smoothstep(0, 1, x - x0);
	const a = hash1D(x0, seed);
	const b = hash1D(x0 + 1, seed);
	return a + (b - a) * t;
}

function centered(value) {
	return (value - 0.5) * 2;
}

function stripeDistance(phase) {
	return Math.abs(Math.sin(phase * TAU));
}

function sampleHeadwall(progress, normalizedDistance, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY.headwall;
	const band = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (band <= 0) return 0;
	const carrier = valueNoise1D(progress * policy.frequency + seed * 0.017, seed + 1709);
	const irregularity = 0.72 + 0.28 * valueNoise1D(progress * 18.7 - seed * 0.009, seed + 1741);
	return smoothstep(policy.threshold, 0.94, carrier) * band * irregularity;
}

function sampleGully(progress, normalizedDistance, side, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY.gullies;
	const band = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (band <= 0) return 0;
	const sidePhase = side < 0 ? -0.31 : side > 0 ? 0.43 : 0;
	const branch = normalizedDistance * policy.branchSkew;
	const primaryDistance = stripeDistance(
		progress * policy.primaryFrequency + branch + sidePhase + seed * 0.0027,
	);
	const secondaryDistance = stripeDistance(
		progress * policy.secondaryFrequency - branch * 0.61 - sidePhase * 0.73 + seed * 0.0041,
	);
	const primary = 1 - smoothstep(0.055, 0.34, primaryDistance);
	const secondary = 1 - smoothstep(0.045, 0.27, secondaryDistance);
	const carrier = clamp01(primary * 0.72 + secondary * 0.43);
	const irregularity = 0.70 + 0.30 * valueNoise1D(
		progress * 29.7 + normalizedDistance * 12.1,
		seed + 1783,
	);
	return carrier * band * irregularity;
}

function sampleInterfluveRib(progress, normalizedDistance, side, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY.interfluveRibs;
	const band = triangularBand(normalizedDistance, policy.start, policy.peak, policy.end);
	if (band <= 0) return 0;
	const sidePhase = side < 0 ? 0.19 : 0.67;
	const distance = stripeDistance(
		progress * policy.frequency
			- normalizedDistance * policy.branchSkew
			+ sidePhase
			+ seed * 0.0033,
	);
	const rib = smoothstep(0.40, 0.94, distance);
	const irregularity = 0.68 + 0.32 * valueNoise1D(
		progress * 13.7 + normalizedDistance * 8.9,
		seed + 1811,
	);
	return rib * band * irregularity;
}

function sampleConvexConcave(progress, normalizedDistance, side, seed) {
	const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY.convexConcave;
	if (side === 0 || normalizedDistance <= policy.start || normalizedDistance >= policy.end) return 0;
	const envelope = smoothstep(policy.start, policy.start + 0.18, normalizedDistance)
		* (1 - smoothstep(policy.end - 0.16, policy.end, normalizedDistance));
	const broad = centered(valueNoise1D(progress * policy.frequency + seed * 0.012, seed + 1861));
	const detail = centered(valueNoise1D(progress * 14.9 - seed * 0.006, seed + 1889));
	return side * (broad * 0.72 + detail * 0.28) * envelope;
}

function sampleOuterFade(normalizedDistance) {
	const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY;
	if (normalizedDistance <= policy.outerFadeStart) return 1;
	return 1 - smoothstep(policy.outerFadeStart, policy.outerFadeEnd, normalizedDistance);
}

export function sampleMountainErosionFieldInto(
	progress,
	normalizedDistance,
	side,
	seed,
	intensity,
	out,
) {
	if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
		throw new RangeError('mountain erosion progress must be finite in [0,1]');
	}
	if (!Number.isFinite(normalizedDistance) || normalizedDistance < 0 || normalizedDistance > 1) {
		throw new RangeError('mountain erosion distance must be finite in [0,1]');
	}
	if (![-1, 0, 1].includes(side)) throw new RangeError('mountain erosion side must be -1, 0, or 1');
	if (!Number.isFinite(intensity) || intensity < 0.5 || intensity > 1.35) {
		throw new RangeError('mountain erosion intensity must be finite in [0.5,1.35]');
	}
	if (!out || typeof out !== 'object') throw new TypeError('erosion out scratch is required');

	const policy = WORLD_REFERENCE_MOUNTAIN_EROSION_POLICY;
	const headwallExposure = sampleHeadwall(progress, normalizedDistance, seed);
	const gullyExposure = sampleGully(progress, normalizedDistance, side, seed);
	const ribExposure = sampleInterfluveRib(progress, normalizedDistance, side, seed);
	const convexConcave = sampleConvexConcave(progress, normalizedDistance, side, seed);
	const outerFade = sampleOuterFade(normalizedDistance);

	const rawScale = (1 - headwallExposure * policy.headwall.strength)
		* (1 - gullyExposure * policy.gullies.strength)
		* (1 + ribExposure * policy.interfluveRibs.strength)
		* (1 + convexConcave * policy.convexConcave.strength);
	const intensityScale = 1 + (rawScale - 1) * intensity;
	const edgeScale = 1 + (intensityScale - 1) * outerFade;

	const upperSlope = triangularBand(normalizedDistance, 0.08, 0.34, 0.64);
	const midSlope = triangularBand(normalizedDistance, 0.28, 0.54, 0.80);
	const lowerSlope = triangularBand(normalizedDistance, 0.46, 0.66, 0.82);
	const concavity = clamp01(0.5 - convexConcave * 0.5);
	const cliffPotential = outerFade * clamp01(
		headwallExposure * 0.62
		+ gullyExposure * upperSlope * 0.32
		+ ribExposure * upperSlope * 0.24,
	);
	const screePotential = outerFade * clamp01(
		cliffPotential * 0.56
		+ gullyExposure * midSlope * 0.48
		+ ribExposure * midSlope * 0.26,
	);
	const depositionPotential = outerFade * clamp01(
		gullyExposure * lowerSlope * 0.72
		+ concavity * lowerSlope * 0.34,
	);
	const snowRetentionPotential = outerFade * clamp01(
		concavity * upperSlope * 0.45
		+ headwallExposure * 0.38
		- ribExposure * 0.16,
	);

	out.heightScale = clamp(edgeScale, policy.heightScale.minimum, policy.heightScale.maximum);
	out.headwallExposure = headwallExposure;
	out.gullyExposure = gullyExposure;
	out.ribExposure = ribExposure;
	out.convexConcave = convexConcave;
	out.concavity = concavity;
	out.outerFade = outerFade;
	out.cliffPotential = cliffPotential;
	out.screePotential = screePotential;
	out.depositionPotential = depositionPotential;
	out.snowRetentionPotential = snowRetentionPotential;
	return out;
}

const EROSION_SCRATCH = {
	heightScale: 1,
	headwallExposure: 0,
	gullyExposure: 0,
	ribExposure: 0,
	convexConcave: 0,
	concavity: 0.5,
	outerFade: 1,
	cliffPotential: 0,
	screePotential: 0,
	depositionPotential: 0,
	snowRetentionPotential: 0,
};

export function sampleMountainErosionScale(
	progress,
	normalizedDistance,
	side,
	seed,
	intensity = 1,
) {
	return sampleMountainErosionFieldInto(
		progress,
		normalizedDistance,
		side,
		seed,
		intensity,
		EROSION_SCRATCH,
	).heightScale;
}

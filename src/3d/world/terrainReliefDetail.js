/**
 * Coastline domain warp + deterministic multi-scale terrain relief.
 *
 * Canonical owner-map semantics remain upstream in terrain.js. This module only supplies bounded
 * residual shape. The original isotropic fBm/ridged stack is preserved, and v2 adds a directional
 * macro-weathering residual from terrainMacroWeathering.js: drainage corridors, shoulders, benches,
 * aspect asymmetry and talus. All terms are pure functions of normalized world position.
 *
 * Settlement/seat safety is still owned by terrain.js, which tapers the complete result around
 * protected seats before hydrology/foundation consumers see it.
 *
 * @module world/terrainReliefDetail
 */

import { terrainMacroWeatheringResidualMeters } from './terrainMacroWeathering.js';

const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

export const TERRAIN_RELIEF_DETAIL_POLICY = Object.freeze({
	id: 'terrain-coast-warp-and-relief-detail-2026-08-26-v2-directional-weathering',
	coastWarpU: 1.55 / 96,
	coastWarpV: 1.55 / 64,
	coastWarpOctaves: 3,

	// Broad lowland form.
	plainsAmplitudeMeters: 5.5,
	plainsFrequency: 46,
	swellAmplitudeMeters: 14,
	swellFrequency: 17,

	// Mountain-scale ridges.
	ridgeAmplitudeMeters: 42,
	ridgeFrequency: 11,
	ridgeOctaves: 4,

	// Everywhere-land erosion.
	erosionAmplitudeLowMeters: 3.6,
	erosionAmplitudeHighMeters: 11,
	erosionFullElevationMeters: 150,
	erosionFrequency: 34,
	erosionOctaves: 4,

	// Height-proportional relief so tall massifs do not become smooth domes.
	elevationErosionFraction: 0.055,
	elevationErosionCapMeters: 40,
	elevationRidgeFraction: 0.26,
	elevationRidgeCapMeters: 135,

	// Near-field crags.
	cragAmplitudeMeters: 4.5,
	cragFrequency: 88,
	cragOctaves: 3,

	// Fine gully/spur dissection and short-wavelength roughness.
	dissectionAmplitudeLowMeters: 6.5,
	dissectionAmplitudeHighMeters: 16,
	dissectionFrequency: 110,
	dissectionOctaves: 4,
	dissectionFullElevationMeters: 220,
	roughnessAmplitudeMeters: 2.0,
	roughnessFrequency: 295,
	roughnessOctaves: 3,

	// Low ground may be raised, but negative cuts are suppressed near the coast.
	negativeReliefFullElevationMeters: 28,

	// Mid-scale hill country visible from aerial cameras.
	hillAmplitudeMeters: 26,
	hillFrequency: 22,
	hillOctaves: 3,

	// Protect the true waterline; most lowland ground reaches full detail quickly.
	shoreFadeStartMeters: 0.3,
	shoreFadeFullMeters: 2.5,

	// Explicit marker used by diagnostics to prove the new directional layer is production-wired.
	directionalMacroWeathering: true,
});

/** Deterministic 2D integer hash -> [0,1). */
function hash2(ix, iy) {
	const value = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
	return value - Math.floor(value);
}

/** Smooth value noise in [0,1) with quintic interpolation. */
function valueNoise2(x, y) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
	const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	const n00 = hash2(x0, y0);
	const n10 = hash2(x0 + 1, y0);
	const n01 = hash2(x0, y0 + 1);
	const n11 = hash2(x0 + 1, y0 + 1);
	const nx0 = n00 + (n10 - n00) * ux;
	const nx1 = n01 + (n11 - n01) * ux;
	return nx0 + (nx1 - nx0) * uy;
}

/** Signed fBm in roughly [-1,1]. */
function fbm2(x, y, octaves) {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let normalisation = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		sum += (valueNoise2(x * frequency, y * frequency) * 2 - 1) * amplitude;
		normalisation += amplitude;
		amplitude *= 0.5;
		frequency *= 2.03;
	}
	return sum / normalisation;
}

/**
 * Shared deterministic noise basis used by terrainBiomeShading.js.
 */
export function signedFbmNoise(x, y, octaves) {
	return fbm2(x, y, octaves);
}

/** Ridged multifractal in [0,1]. */
function ridged2(x, y, octaves) {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let normalisation = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		const signed = valueNoise2(x * frequency, y * frequency) * 2 - 1;
		sum += (1 - Math.abs(signed)) * amplitude;
		normalisation += amplitude;
		amplitude *= 0.5;
		frequency *= 2.07;
	}
	return sum / normalisation;
}

/**
 * Organic domain warp for the low-resolution canonical surface mask.
 *
 * This moves the *sample coordinate*, not the source data, so large-scale geography remains owner-map
 * driven while 138-162m cell stair-steps stop printing directly into the coastline.
 */
export function coastWarpOffsets(normalizedX, normalizedY) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	const broadU = fbm2(normalizedX * 9.3 + 11.7, normalizedY * 9.3 + 3.1, P.coastWarpOctaves);
	const broadV = fbm2(normalizedX * 9.3 - 5.9, normalizedY * 9.3 + 27.4, P.coastWarpOctaves);
	const fineU = fbm2(normalizedX * 31.5 + 61.2, normalizedY * 31.5 - 17.8, 2);
	const fineV = fbm2(normalizedX * 31.5 - 43.6, normalizedY * 31.5 + 8.5, 2);
	return {
		du: (broadU * 0.72 + fineU * 0.28) * P.coastWarpU,
		dv: (broadV * 0.72 + fineV * 0.28) * P.coastWarpV,
	};
}

/**
 * Extra land relief in metres, added by terrain.js after map-derived base height.
 *
 * The residual is allowed to be positive or negative away from the protected coast. Open water is
 * always neutral. `terrainMacroWeatheringResidualMeters` is deliberately inserted before the legacy
 * low-elevation negative damping so the complete relief stack continues to honor the same coast
 * safety envelope.
 */
export function reliefDetailMeters(
	normalizedX,
	normalizedY,
	{
		heightAboveSeaMeters,
		reliefInfluence,
		rockWeight,
		snowWeight,
		waterWeight,
	},
) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	const dryness = 1 - clamp01(waterWeight);
	if (dryness <= 0) return 0;

	const shoreFade = clamp01(
		(heightAboveSeaMeters - P.shoreFadeStartMeters)
		/ (P.shoreFadeFullMeters - P.shoreFadeStartMeters),
	);
	if (shoreFade <= 0) return 0;
	const landGate = dryness * shoreFade;

	// Broad swells + plains.
	const swell = fbm2(
		normalizedX * P.swellFrequency + 3.7,
		normalizedY * P.swellFrequency - 9.1,
		3,
	);
	const plains = fbm2(
		normalizedX * P.plainsFrequency - 21.3,
		normalizedY * P.plainsFrequency + 14.6,
		3,
	);
	let metres = (
		swell * P.swellAmplitudeMeters
		+ plains * P.plainsAmplitudeMeters
	) * landGate;

	// Everywhere-land ridged erosion, elevation scaled.
	const erosionRamp = clamp01(heightAboveSeaMeters / P.erosionFullElevationMeters);
	const erosionAmplitude = Math.max(
		P.erosionAmplitudeLowMeters
			+ (P.erosionAmplitudeHighMeters - P.erosionAmplitudeLowMeters)
			* erosionRamp * erosionRamp,
		Math.min(P.elevationErosionCapMeters, heightAboveSeaMeters * P.elevationErosionFraction),
	);
	const erosion = ridged2(
		normalizedX * P.erosionFrequency - 8.4,
		normalizedY * P.erosionFrequency + 33.9,
		P.erosionOctaves,
	);
	metres += (erosion - 0.5) * 2 * erosionAmplitude * landGate;

	// Mid-scale hill country.
	const hills = ridged2(
		normalizedX * P.hillFrequency + 17.3,
		normalizedY * P.hillFrequency - 41.6,
		P.hillOctaves,
	);
	metres += (hills - 0.5) * 2 * P.hillAmplitudeMeters * landGate;

	// Fine dissection.
	const dissectionRamp = clamp01(heightAboveSeaMeters / P.dissectionFullElevationMeters);
	const dissectionAmplitude = P.dissectionAmplitudeLowMeters
		+ (P.dissectionAmplitudeHighMeters - P.dissectionAmplitudeLowMeters) * dissectionRamp;
	const dissection = ridged2(
		normalizedX * P.dissectionFrequency + 71.5,
		normalizedY * P.dissectionFrequency - 24.2,
		P.dissectionOctaves,
	);
	metres += (dissection - 0.5) * 2 * dissectionAmplitude * landGate;

	// Short-wavelength surface roughness.
	const roughness = fbm2(
		normalizedX * P.roughnessFrequency - 55.8,
		normalizedY * P.roughnessFrequency + 12.7,
		P.roughnessOctaves,
	);
	metres += roughness * P.roughnessAmplitudeMeters * landGate;

	// New v2 directional residual. It has its own strict water/shore envelope and hard +/- cap.
	// Do not multiply by landGate again: doing so would double-fade the lowlands that this pass is
	// specifically intended to make legible from the aerial camera.
	metres += terrainMacroWeatheringResidualMeters(normalizedX, normalizedY, {
		heightAboveSeaMeters,
		reliefInfluence,
		rockWeight,
		snowWeight,
		waterWeight,
	});

	// Preserve the established low-ground negative safety envelope across the *combined* residual.
	if (metres < 0) metres *= clamp01(heightAboveSeaMeters / P.negativeReliefFullElevationMeters);

	// Canonical mountain crags remain last, so weathering cuts/benches are carved into the foothill
	// form while the strongest mountain signal retains its existing amplitude authority.
	const mountainGate = clamp01(Math.max(
		reliefInfluence * reliefInfluence,
		clamp01(rockWeight) * 0.8,
		clamp01(snowWeight) * 0.7,
	));
	if (mountainGate > 0) {
		const ridgeAmplitude = Math.max(
			P.ridgeAmplitudeMeters,
			Math.min(P.elevationRidgeCapMeters, heightAboveSeaMeters * P.elevationRidgeFraction),
		);
		const ridge = ridged2(
			normalizedX * P.ridgeFrequency + 47.2,
			normalizedY * P.ridgeFrequency + 19.8,
			P.ridgeOctaves,
		);
		metres += (ridge - 0.5) * 2 * ridgeAmplitude * mountainGate * landGate;

		const crag = ridged2(
			normalizedX * P.cragFrequency + 5.1,
			normalizedY * P.cragFrequency - 61.3,
			P.cragOctaves,
		);
		metres += (
			(crag - 0.5)
			* 2
			* Math.max(P.cragAmplitudeMeters, ridgeAmplitude * 0.16)
			* mountainGate
			* landGate
		);
	}

	return metres;
}

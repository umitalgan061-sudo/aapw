/**
 * Coastline domain warp + deterministic multi-scale terrain relief.
 *
 * Canonical owner-map semantics remain upstream in terrain.js. This module only supplies bounded
 * residual shape. The original fBm/ridged stack is preserved, but hill country now carries a slowly
 * rotating anisotropic fabric so aerial landforms read as connected ridges and valleys rather than
 * isotropic blobs. Directional macro weathering remains responsible for drainage, benches, aspect
 * asymmetry, talus and alluvial hierarchy.
 *
 * Settlement/seat safety is still owned by terrain.js, which tapers the complete result around
 * protected seats before hydrology/foundation consumers see it.
 *
 * @module world/terrainReliefDetail
 */

import { terrainMacroWeatheringResidualMeters } from './terrainMacroWeathering.js';

const TAU = Math.PI * 2;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

export const TERRAIN_RELIEF_DETAIL_POLICY = Object.freeze({
	id: 'terrain-coast-warp-and-relief-detail-2026-08-26-v2-directional-weathering',
	revision: 3,
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

	// Mid-scale hill country visible from aerial cameras. The amplitude is unchanged; v3 changes only
	// morphology by blending isotropic hills with a regional anisotropic ridge fabric.
	hillAmplitudeMeters: 26,
	hillFrequency: 22,
	hillOctaves: 3,
	regionalAnisotropicHillFabric: true,
	hillFabricBlend: 0.62,
	hillFabricContrast: 1.34,
	hillFabricAlongScale: 0.62,
	hillFabricAcrossScale: 1.22,
	hillFabricWarpFrequency: 5.8,
	hillFabricWarpStrength: 0.035,
	hillFabricBaseAngleRadians: 0.35,
	hillFabricAngleSwingRadians: 0.65,
	hillFabricAngleDetailRadians: 0.27,

	// Protect the true waterline; most lowland ground reaches full detail quickly.
	shoreFadeStartMeters: 0.3,
	shoreFadeFullMeters: 2.5,

	directionalMacroWeathering: true,
});

function hash2(ix, iy) {
	const value = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
	return value - Math.floor(value);
}

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

export function signedFbmNoise(x, y, octaves) {
	return fbm2(x, y, octaves);
}

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
 * Mid-scale regional ridge fabric in [0,1].
 *
 * Real hill country tends to inherit a structural grain from bedding, faulting and drainage. Pure
 * isotropic ridged noise makes every hill equally likely in every direction, which reads as rounded
 * procedural lumps in an orthographic world view. Here the local frame rotates slowly across the
 * map, then compresses the across-ridge axis while stretching the along-ridge axis. A restrained
 * two-octave warp bends the ridges so they never become parallel stripes. The old isotropic field is
 * still mixed in, preserving local variety and the established 26m amplitude envelope.
 */
export function terrainHillFabricSignal(normalizedX, normalizedY) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	const nx = Number.isFinite(normalizedX) ? normalizedX : 0;
	const ny = Number.isFinite(normalizedY) ? normalizedY : 0;
	const regionalA = Math.sin(TAU * (nx * 0.83 + ny * 0.31) + 0.73);
	const regionalB = Math.sin(TAU * (nx * -0.27 + ny * 0.69) + 2.19);
	const angle = P.hillFabricBaseAngleRadians
		+ regionalA * P.hillFabricAngleSwingRadians
		+ regionalB * P.hillFabricAngleDetailRadians;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const centeredX = nx - 0.5;
	const centeredY = ny - 0.5;
	const along = centeredX * c + centeredY * s;
	const across = -centeredX * s + centeredY * c;
	const warp = fbm2(
		nx * P.hillFabricWarpFrequency + 4.7,
		ny * P.hillFabricWarpFrequency - 12.3,
		2,
	) * P.hillFabricWarpStrength;
	const elongated = ridged2(
		(along + warp) * P.hillFrequency * P.hillFabricAlongScale + 17.3,
		(across - warp * 0.62) * P.hillFrequency * P.hillFabricAcrossScale - 41.6,
		P.hillOctaves,
	);
	const elongatedContrasted = clamp01(0.625 + (elongated - 0.625) * P.hillFabricContrast);
	const isotropic = ridged2(
		nx * P.hillFrequency + 17.3,
		ny * P.hillFrequency - 41.6,
		P.hillOctaves,
	);
	return elongatedContrasted * P.hillFabricBlend + isotropic * (1 - P.hillFabricBlend);
}

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

	// Same amplitude as v2, but a regional structural grain replaces the isotropic-only morphology.
	const hills = terrainHillFabricSignal(normalizedX, normalizedY);
	metres += (hills - 0.5) * 2 * P.hillAmplitudeMeters * landGate;

	const dissectionRamp = clamp01(heightAboveSeaMeters / P.dissectionFullElevationMeters);
	const dissectionAmplitude = P.dissectionAmplitudeLowMeters
		+ (P.dissectionAmplitudeHighMeters - P.dissectionAmplitudeLowMeters) * dissectionRamp;
	const dissection = ridged2(
		normalizedX * P.dissectionFrequency + 71.5,
		normalizedY * P.dissectionFrequency - 24.2,
		P.dissectionOctaves,
	);
	metres += (dissection - 0.5) * 2 * dissectionAmplitude * landGate;

	const roughness = fbm2(
		normalizedX * P.roughnessFrequency - 55.8,
		normalizedY * P.roughnessFrequency + 12.7,
		P.roughnessOctaves,
	);
	metres += roughness * P.roughnessAmplitudeMeters * landGate;

	metres += terrainMacroWeatheringResidualMeters(normalizedX, normalizedY, {
		heightAboveSeaMeters,
		reliefInfluence,
		rockWeight,
		snowWeight,
		waterWeight,
	});

	if (metres < 0) metres *= clamp01(heightAboveSeaMeters / P.negativeReliefFullElevationMeters);

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

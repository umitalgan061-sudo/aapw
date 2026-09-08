/**
 * Coastline domain warp + deterministic multi-scale terrain relief.
 *
 * Canonical owner-map semantics remain upstream in terrain.js. This module only supplies bounded
 * residual shape. The original fBm/ridged stack is preserved, but hill country and mountain massifs
 * now carry slowly rotating anisotropic fabrics so aerial landforms read as connected ridges and
 * valleys rather than isotropic blobs. Directional macro weathering remains responsible for
 * drainage, benches, aspect asymmetry, talus and alluvial hierarchy.
 *
 * Settlement/seat safety is still owned by terrain.js, which tapers the complete result around
 * protected seats before hydrology/foundation consumers see it.
 *
 * @module world/terrainReliefDetail
 */

import { terrainMacroWeatheringResidualMeters } from './terrainMacroWeathering.js';
import {
	REFERENCE_COASTLINE_WARP_POLICY,
	referenceCoastlineNaturalizationOffsets,
} from './referenceCoastlineWarp.js';

const TAU = Math.PI * 2;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

export const TERRAIN_RELIEF_DETAIL_POLICY = Object.freeze({
	id: 'terrain-coast-warp-and-relief-detail-2026-08-31-v4-coastline-aware-anisotropic-fabric',
	supersedes: 'terrain-coast-warp-and-relief-detail-2026-08-26-v3-anisotropic-mountain-fabric',
	revision: 5,
	coastWarpU: 1.55 / 96,
	coastWarpV: 1.55 / 64,
	coastWarpOctaves: 3,
	coastlineWarpPolicyId: REFERENCE_COASTLINE_WARP_POLICY.id,
	coastlineSignedDistanceAware: true,
	coastLegacyRetainAtBoundary: 0.74,

	// Broad lowland form.
	plainsAmplitudeMeters: 5.5,
	plainsFrequency: 46,
	swellAmplitudeMeters: 14,
	swellFrequency: 17,

	// Mountain-scale ridges.
	ridgeAmplitudeMeters: 42,
	ridgeFrequency: 11,
	ridgeOctaves: 4,
	mountainAnisotropicFabric: true,
	mountainFabricBlend: 0.68,
	mountainFabricContrast: 1.42,
	mountainFabricAlongScale: 0.52,
	mountainFabricAcrossScale: 1.48,
	mountainFabricWarpFrequency: 4.2,
	mountainFabricWarpStrength: 0.047,
	mountainFabricBaseAngleRadians: -0.18,
	mountainFabricAngleSwingRadians: 0.82,
	mountainFabricAngleDetailRadians: 0.31,

	// Bounded exposed-rock breakup. This does not decide where mountains exist: the existing
	// relief/rock/snow mountain gate below remains authoritative. These residuals only stop large
	// canonical rock shoulders from reading as smooth, uniform domes at aerial and gameplay scale.
	cliffFractureWeathering: true,
	cliffFractureAmplitudeMeters: 7.4,
	cliffFractureFrequency: 168,
	cliffFractureOctaves: 3,
	cliffBenchAmplitudeMeters: 4.6,
	cliffBenchFrequency: 72,
	cliffBenchOctaves: 3,
	cliffFractureMinElevationMeters: 72,

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

	// Mid-scale hill country visible from aerial cameras. The amplitude is unchanged; morphology is
	// blended with a regional anisotropic ridge fabric.
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

/**
 * Mountain-scale structural fabric in [0,1].
 *
 * This never creates a mountain on its own: terrain.js's existing relief/rock/snow gate still owns
 * where mountain residuals may appear. The signal only changes shape inside that gate. Two slow
 * regional angle fields orient the strata-like grain, while a low-frequency warp bends long ridges
 * and prevents repeated parallel bands. The isotropic legacy signal remains mixed in for local
 * breakup, so the result stays deterministic without becoming a new geographic authority.
 */
export function terrainMountainFabricSignal(normalizedX, normalizedY) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	const nx = Number.isFinite(normalizedX) ? normalizedX : 0;
	const ny = Number.isFinite(normalizedY) ? normalizedY : 0;
	const regionalA = Math.sin(TAU * (nx * 0.57 + ny * 0.18) + 1.37);
	const regionalB = Math.sin(TAU * (nx * -0.21 + ny * 0.74) + 4.11);
	const angle = P.mountainFabricBaseAngleRadians
		+ regionalA * P.mountainFabricAngleSwingRadians
		+ regionalB * P.mountainFabricAngleDetailRadians;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const centeredX = nx - 0.5;
	const centeredY = ny - 0.5;
	const along = centeredX * c + centeredY * s;
	const across = -centeredX * s + centeredY * c;
	const warpA = fbm2(
		nx * P.mountainFabricWarpFrequency + 31.7,
		ny * P.mountainFabricWarpFrequency - 8.6,
		3,
	) * P.mountainFabricWarpStrength;
	const warpB = fbm2(
		nx * (P.mountainFabricWarpFrequency * 0.71) - 19.4,
		ny * (P.mountainFabricWarpFrequency * 0.71) + 24.8,
		2,
	) * P.mountainFabricWarpStrength * 0.58;
	const elongated = ridged2(
		(along + warpA) * P.ridgeFrequency * P.mountainFabricAlongScale + 47.2,
		(across - warpA * 0.74 + warpB) * P.ridgeFrequency * P.mountainFabricAcrossScale + 19.8,
		P.ridgeOctaves,
	);
	const contrasted = clamp01(0.61 + (elongated - 0.61) * P.mountainFabricContrast);
	const isotropic = ridged2(
		nx * P.ridgeFrequency + 47.2,
		ny * P.ridgeFrequency + 19.8,
		P.ridgeOctaves,
	);
	return contrasted * P.mountainFabricBlend + isotropic * (1 - P.mountainFabricBlend);
}

/**
 * Bounded exposed-rock fracture signal in roughly [-1,1].
 *
 * The coordinate frame rotates slowly across the owner map, then combines two incompatible scales:
 * a narrow joint/fracture family and a broader bedding/bench family. This avoids both round crag
 * blobs and obvious parallel procedural stripes. It is deliberately only a signal; callers still
 * gate it by canonical mountain/rock authority.
 */
export function terrainCliffFractureResidualSignal(normalizedX, normalizedY) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	const nx = Number.isFinite(normalizedX) ? normalizedX : 0;
	const ny = Number.isFinite(normalizedY) ? normalizedY : 0;
	const angle = -0.34
		+ Math.sin(TAU * (nx * 0.39 + ny * 0.61) + 2.7) * 0.71
		+ Math.sin(TAU * (nx * -0.73 + ny * 0.17) + 0.9) * 0.24;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const centeredX = nx - 0.5;
	const centeredY = ny - 0.5;
	const along = centeredX * c + centeredY * s;
	const across = -centeredX * s + centeredY * c;
	const warp = fbm2(nx * 8.6 + 13.4, ny * 8.6 - 7.2, 2) * 0.026;
	const fracture = ridged2(
		(along + warp) * P.cliffFractureFrequency * 0.42 + 9.3,
		(across - warp * 0.73) * P.cliffFractureFrequency * 1.37 - 27.8,
		P.cliffFractureOctaves,
	);
	const bench = fbm2(
		(along - warp * 0.44) * P.cliffBenchFrequency * 0.64 - 18.5,
		(across + warp) * P.cliffBenchFrequency * 1.08 + 42.1,
		P.cliffBenchOctaves,
	);
	const jointCut = clamp01((fracture - 0.48) * 2.35) * -1.0;
	return clamp01(fracture) * 0.38 + bench * 0.48 + jointCut * 0.44;
}

export function coastWarpOffsets(normalizedX, normalizedY) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	const broadU = fbm2(normalizedX * 9.3 + 11.7, normalizedY * 9.3 + 3.1, P.coastWarpOctaves);
	const broadV = fbm2(normalizedX * 9.3 - 5.9, normalizedY * 9.3 + 27.4, P.coastWarpOctaves);
	const fineU = fbm2(normalizedX * 31.5 + 61.2, normalizedY * 31.5 - 17.8, 2);
	const fineV = fbm2(normalizedX * 31.5 - 43.6, normalizedY * 31.5 + 8.5, 2);
	const legacyDu = (broadU * 0.72 + fineU * 0.28) * P.coastWarpU;
	const legacyDv = (broadV * 0.72 + fineV * 0.28) * P.coastWarpV;
	const naturalized = referenceCoastlineNaturalizationOffsets(normalizedX, normalizedY);
	// Keep the historical broad warp everywhere, but trade a small fraction of it for a signed-distance
	// normal/tangent meander only at real sea/dry boundaries. The total envelope therefore stays near the
	// established v3 budget while the visual shoreline stops inheriting long cardinal mask steps.
	const legacyRetain = 1 - naturalized.proximity * (1 - P.coastLegacyRetainAtBoundary);
	return {
		du: legacyDu * legacyRetain + naturalized.du,
		dv: legacyDv * legacyRetain + naturalized.dv,
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
		const ridge = terrainMountainFabricSignal(normalizedX, normalizedY);
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

		const exposedRockGate = mountainGate
			* clamp01((clamp01(rockWeight) - 0.16) / 0.54)
			* clamp01((heightAboveSeaMeters - P.cliffFractureMinElevationMeters) / 160);
		if (exposedRockGate > 0) {
			const fracture = terrainCliffFractureResidualSignal(normalizedX, normalizedY);
			const fractureAmplitude = P.cliffFractureAmplitudeMeters
				* (0.62 + clamp01(reliefInfluence) * 0.38);
			const bench = fbm2(
				normalizedX * P.cliffBenchFrequency + 81.7,
				normalizedY * P.cliffBenchFrequency - 33.4,
				P.cliffBenchOctaves,
			);
			metres += fracture * fractureAmplitude * exposedRockGate * landGate;
			metres += bench * P.cliffBenchAmplitudeMeters * exposedRockGate * landGate;
		}
	}

	return metres;
}

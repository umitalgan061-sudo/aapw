/**
 * Render-only prevailing-wind signal for geographic snow redistribution.
 *
 * This module deliberately consumes only the same four-neighbour terrain heights already sampled
 * around a terrain vertex. It never becomes a height/collider authority: it converts local aspect
 * into bounded windward scour and lee-side deposition weights that the biome shading layer can use.
 *
 * Westeros' northern mountain snow reads more naturally when exposed NW-facing slopes lose a small
 * amount of loose snow while sheltered SE-facing slopes retain it. The prevailing direction is kept
 * explicit and deterministic so chunk borders cannot acquire random aspect seams.
 * @module world/terrainWindSnowExposure
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

const PREVAILING_SOURCE_LENGTH = Math.hypot(0.8, 0.6);

export const TERRAIN_WIND_SNOW_POLICY = Object.freeze({
	id: 'terrain-wind-snow-exposure-2026-08-25-v4-ridge-breakup',
	renderOnly: true,
	heightAuthorityUnchanged: true,
	// Direction points toward the source of the prevailing wind. Wind therefore travels NW -> SE.
	prevailingSourceX: -0.8 / PREVAILING_SOURCE_LENGTH,
	prevailingSourceZ: -0.6 / PREVAILING_SOURCE_LENGTH,
	aspectSlopeStartDegrees: 4,
	aspectSlopeFullDegrees: 24,
	// Keep broad crosswind faces neutral and concentrate redistribution on terrain that actually
	// presents itself to the prevailing flow. This avoids painting soft half-mountain snow lobes while
	// preserving stronger, narrower scour/deposition around real ridges and sheltered folds.
	directionalAlignmentStart: 0.34,
	directionalAlignmentFull: 0.92,
	// Sheltered faces can hold loose snow on ordinary mountain slopes, but near-cliffs should shed it.
	leeRetentionFadeStartDegrees: 40,
	leeRetentionFadeFullDegrees: 58,
	northWindwardScourMax: 0.090,
	tundraWindwardScourMax: 0.052,
	northLeeDepositMax: 0.065,
	tundraLeeDepositMax: 0.038,
});

/**
 * Resolve deterministic slope-aspect exposure from a seam-safe four-neighbour height stencil.
 *
 * `windward` and `lee` are directional weights in [0, 1]. Flat terrain deliberately returns zero
 * for both because it has no meaningful facing direction. `slopeAspectStrength` fades the signal in
 * over shallow slopes so lowland snow does not develop artificial directional bands. A second
 * alignment gate keeps nearly crosswind faces neutral, preventing the old broad 180-degree
 * windward/lee split from painting large directional bands across mountains. Lee retention then
 * fades on near-cliffs: a sheltered face can collect snow, but loose deposition should not be
 * painted onto extremely steep rock where gravity would shed it. Windward exposure remains active
 * on those faces because scour can still strip snow from exposed cliffs and ridges.
 */
export function terrainWindExposureFromNeighbours(
	heightWest,
	heightEast,
	heightNorth,
	heightSouth,
	spacingMeters,
) {
	const spacing = Math.max(1e-6, Math.abs(spacingMeters));
	const gradientX = (heightEast - heightWest) / (2 * spacing);
	const gradientZ = (heightSouth - heightNorth) / (2 * spacing);
	const gradientMagnitude = Math.hypot(gradientX, gradientZ);
	const slopeDegrees = Math.atan(gradientMagnitude) * 180 / Math.PI;
	const slopeAspectStrength = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.aspectSlopeStartDegrees,
		TERRAIN_WIND_SNOW_POLICY.aspectSlopeFullDegrees,
		slopeDegrees,
	);
	const leeRetention = 1 - smoothstep(
		TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeStartDegrees,
		TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeFullDegrees,
		slopeDegrees,
	);

	if (gradientMagnitude <= 1e-9 || slopeAspectStrength <= 0) {
		return Object.freeze({
			gradientX,
			gradientZ,
			slopeDegrees,
			slopeAspectStrength,
			leeRetention,
			aspectDot: 0,
			windwardAlignment: 0,
			leeAlignment: 0,
			windward: 0,
			lee: 0,
		});
	}

	// Horizontal component of the upward terrain normal is -gradient. Its dot product with the
	// direction toward the wind source is positive on windward faces and negative on lee faces.
	const normalX = -gradientX / gradientMagnitude;
	const normalZ = -gradientZ / gradientMagnitude;
	const aspectDot = clamp01((
		normalX * TERRAIN_WIND_SNOW_POLICY.prevailingSourceX
		+ normalZ * TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ
		+ 1
	) * 0.5) * 2 - 1;
	const windwardAlignment = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.directionalAlignmentStart,
		TERRAIN_WIND_SNOW_POLICY.directionalAlignmentFull,
		Math.max(0, aspectDot),
	);
	const leeAlignment = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.directionalAlignmentStart,
		TERRAIN_WIND_SNOW_POLICY.directionalAlignmentFull,
		Math.max(0, -aspectDot),
	);

	return Object.freeze({
		gradientX,
		gradientZ,
		slopeDegrees,
		slopeAspectStrength,
		leeRetention,
		aspectDot,
		windwardAlignment,
		leeAlignment,
		windward: windwardAlignment * slopeAspectStrength,
		lee: leeAlignment * slopeAspectStrength * leeRetention,
	});
}

/**
 * Convert the geometric exposure signal into bounded climate-aware snow adjustments.
 * Permanent ice receives the stronger effect; tundra receives a restrained version. The caller
 * remains responsible for combining these values with canonical/altitude snow supply.
 */
export function resolveTerrainWindSnowAdjustment({
	windward = 0,
	lee = 0,
	permanentIce = 0,
	tundra = 0,
} = {}) {
	const P = TERRAIN_WIND_SNOW_POLICY;
	const ice = clamp01(permanentIce);
	const tundraBand = clamp01(tundra) * (1 - ice);
	const windwardWeight = clamp01(windward);
	const leeWeight = clamp01(lee);
	const scourMax = Math.max(
		ice * P.northWindwardScourMax,
		tundraBand * P.tundraWindwardScourMax,
	);
	const depositMax = Math.max(
		ice * P.northLeeDepositMax,
		tundraBand * P.tundraLeeDepositMax,
	);
	return Object.freeze({
		windwardScour: windwardWeight * scourMax,
		leeDeposit: leeWeight * depositMax,
		scourMax,
		depositMax,
	});
}
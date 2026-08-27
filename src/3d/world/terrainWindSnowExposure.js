/**
 * Render-only prevailing-wind signal for geographic snow redistribution.
 *
 * This module deliberately consumes only the same four-neighbour terrain heights already sampled
 * around a terrain vertex. It never becomes a height/collider authority: it converts local aspect
 * into bounded windward scour and lee-side deposition weights that the biome shading layer can use.
 *
 * Westeros' northern mountain snow reads more naturally when exposed NW-facing slopes lose a bounded
 * share of loose surface snow while sheltered SE-facing slopes retain it. The prevailing direction is
 * explicit and deterministic so chunk borders cannot acquire random aspect seams. On real mountain
 * shoulders the effective flow bends modestly along the local contour, and strength follows distinct
 * slope bands: windward scour concentrates on exposed ridge shoulders while lee deposition concentrates
 * on moderate sheltered faces and disappears again on near-cliffs. V8 additionally derives an
 * orographic fold signal from the same four-neighbour stencil: broken ridges and folded massifs channel
 * a little more strongly than planar faces, preventing every mountain from receiving the same compass-
 * straight snow split without adding noise, map-space bands or a second geography authority. All of
 * this still alters only loose render snow; canonical snow geography, terrain height, hydrology and
 * colliders are unchanged.
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
	id: 'terrain-wind-snow-exposure-2026-08-27-v8-orographic-fold-channeling',
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
	// Wind strips loose snow most visibly on genuine ridge shoulders rather than every gently tilted
	// surface. This second slope gate narrows scour to terrain with enough relief to expose a crest,
	// while still reaching full strength well below cliff angles.
	windwardScourStartDegrees: 12,
	windwardScourFullDegrees: 34,
	// Loose lee snow needs enough slope to form a recognisable sheltered face. Tightening the ramp
	// suppresses broad lowland directional blobs while preserving full deposition on ordinary
	// mountain lee slopes.
	leeCollectionStartDegrees: 10,
	leeCollectionFullDegrees: 24,
	// Ordinary mountain lee faces retain their full deposition signal through 42 degrees; only steeper
	// near-cliff faces start shedding loose snow, preserving the established physical contract.
	leeRetentionFadeStartDegrees: 42,
	leeRetentionFadeFullDegrees: 58,
	// Orographic wind does not stay perfectly compass-straight through broken relief. Above a genuine
	// mountain-shoulder slope, blend a bounded share of the flow toward whichever local contour
	// direction already points most nearly with the prevailing stream. The effect is zero on lowlands
	// and derived solely from the canonical height stencil.
	channelingSlopeStartDegrees: 16,
	channelingSlopeFullDegrees: 46,
	channelingMaxBlend: 0.28,
	// A four-neighbour saddle/fold signal distinguishes broken massifs from planar slopes without a
	// centre-height sample: (W+E)-(N+S) cancels an arbitrary vertical offset and is exact zero on the
	// planar fixtures used by the contract. Folded terrain may bend flow up to another 10 percentage
	// points and modestly strengthen already-valid directional weights; values remain clamped to [0,1].
	orographicFoldGradientStart: 0.08,
	orographicFoldGradientFull: 0.42,
	orographicFoldChannelingBoost: 0.10,
	orographicFoldExposureBoost: 0.08,
	// The permanent-ice floor supplies most northern snow before redistribution. Sub-10% adjustments
	// became visually quantised away in the authoritative full-world render, so exposed shoulders may
	// now lose up to 18% of loose surface snow. This is still far below removing canonical coverage and
	// leaves cliff/flat/aspect gates in control. Tundra and lee gains remain deliberately smaller.
	northWindwardScourMax: 0.18,
	tundraWindwardScourMax: 0.09,
	northLeeDepositMax: 0.11,
	tundraLeeDepositMax: 0.055,
});

/**
 * Resolve deterministic slope-aspect exposure from a seam-safe four-neighbour height stencil.
 *
 * `windward` and `lee` are directional weights in [0, 1]. Flat terrain deliberately returns zero
 * for both because it has no meaningful facing direction. `slopeAspectStrength` fades the signal in
 * over shallow slopes so lowland snow does not develop artificial directional bands. A second
 * alignment gate keeps nearly crosswind faces neutral. Windward scour then receives an additional
 * shoulder gate, so the strongest loss of loose snow occurs on actual ridge terrain rather than all
 * aligned slopes. Lee collection likewise fades in only once a real sheltered face exists and fades
 * back out on near-cliffs: deposition therefore concentrates on moderate lee slopes instead of
 * painting both flats and vertical rock.
 *
 * Steeper terrain additionally channels part of the effective wind along its contour. Broken relief
 * receives a bounded extra channeling/exposure boost from the four-neighbour fold signal. Planar
 * slopes remain bit-for-bit on the baseline path, while real saddles/folds gain non-uniform flow
 * wrapping sourced entirely from canonical terrain geometry.
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
	const foldGradient = Math.abs((heightWest + heightEast) - (heightNorth + heightSouth)) / (2 * spacing);
	const orographicFoldStrength = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.orographicFoldGradientStart,
		TERRAIN_WIND_SNOW_POLICY.orographicFoldGradientFull,
		foldGradient,
	);
	const slopeAspectStrength = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.aspectSlopeStartDegrees,
		TERRAIN_WIND_SNOW_POLICY.aspectSlopeFullDegrees,
		slopeDegrees,
	);
	const windwardScourSlope = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.windwardScourStartDegrees,
		TERRAIN_WIND_SNOW_POLICY.windwardScourFullDegrees,
		slopeDegrees,
	);
	const leeCollection = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.leeCollectionStartDegrees,
		TERRAIN_WIND_SNOW_POLICY.leeCollectionFullDegrees,
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
			foldGradient,
			orographicFoldStrength,
			slopeAspectStrength,
			windwardScourSlope,
			leeCollection,
			leeRetention,
			channelingWeight: 0,
			effectiveSourceX: TERRAIN_WIND_SNOW_POLICY.prevailingSourceX,
			effectiveSourceZ: TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ,
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

	// Two contour tangents are possible. Pick the orientation that already points most closely with
	// the prevailing stream, then blend toward it only on real mountain shoulders. Folded relief gets
	// a little extra wrapping, but never enough to replace the prevailing source direction.
	let contourX = -normalZ;
	let contourZ = normalX;
	const contourPrevailingDot = contourX * TERRAIN_WIND_SNOW_POLICY.prevailingSourceX
		+ contourZ * TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ;
	if (contourPrevailingDot < 0) {
		contourX = -contourX;
		contourZ = -contourZ;
	}
	const channelingCeiling = TERRAIN_WIND_SNOW_POLICY.channelingMaxBlend
		+ orographicFoldStrength * TERRAIN_WIND_SNOW_POLICY.orographicFoldChannelingBoost;
	const channelingWeight = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.channelingSlopeStartDegrees,
		TERRAIN_WIND_SNOW_POLICY.channelingSlopeFullDegrees,
		slopeDegrees,
	) * channelingCeiling;
	const channelledX = TERRAIN_WIND_SNOW_POLICY.prevailingSourceX * (1 - channelingWeight)
		+ contourX * channelingWeight;
	const channelledZ = TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ * (1 - channelingWeight)
		+ contourZ * channelingWeight;
	const channelledLength = Math.max(1e-9, Math.hypot(channelledX, channelledZ));
	const effectiveSourceX = channelledX / channelledLength;
	const effectiveSourceZ = channelledZ / channelledLength;

	const aspectDot = clamp01((normalX * effectiveSourceX + normalZ * effectiveSourceZ + 1) * 0.5) * 2 - 1;
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
	const foldExposureGain = 1 + orographicFoldStrength * TERRAIN_WIND_SNOW_POLICY.orographicFoldExposureBoost;

	return Object.freeze({
		gradientX,
		gradientZ,
		slopeDegrees,
		foldGradient,
		orographicFoldStrength,
		slopeAspectStrength,
		windwardScourSlope,
		leeCollection,
		leeRetention,
		channelingWeight,
		effectiveSourceX,
		effectiveSourceZ,
		aspectDot,
		windwardAlignment,
		leeAlignment,
		windward: clamp01(windwardAlignment * slopeAspectStrength * windwardScourSlope * foldExposureGain),
		lee: clamp01(leeAlignment * slopeAspectStrength * leeCollection * leeRetention * foldExposureGain),
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
/**
 * Render-only prevailing-wind signal for geographic snow redistribution.
 *
 * This module deliberately consumes only the same four-neighbour terrain heights already sampled
 * around a terrain vertex. It never becomes a height/collider authority: it converts local aspect
 * into bounded windward scour and lee-side deposition weights that the biome shading layer can use.
 *
 * The production response is intentionally split into three visible surface behaviours: exposed ridge
 * scour, sheltered lee packing, and transitional snow mobility. All three are derived from the same
 * canonical four-neighbour stencil so the rendered terrain, collider and gameplay sampler keep one
 * topology. No geography, hydrology, height or asset identity is invented here.
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
	id: 'terrain-wind-snow-exposure-2026-09-07-v13-fold-snowpack-response',
	renderOnly: true,
	heightAuthorityUnchanged: true,
	prevailingSourceX: -0.8 / PREVAILING_SOURCE_LENGTH,
	prevailingSourceZ: -0.6 / PREVAILING_SOURCE_LENGTH,
	aspectSlopeStartDegrees: 4,
	aspectSlopeFullDegrees: 24,
	directionalAlignmentStart: 0.34,
	directionalAlignmentFull: 0.92,
	channelingAlignmentStart: 0.06,
	channelingAlignmentFull: 0.28,
	windwardScourStartDegrees: 12,
	windwardScourFullDegrees: 34,
	leeCollectionStartDegrees: 10,
	leeCollectionFullDegrees: 24,
	leeRetentionFadeStartDegrees: 42,
	leeRetentionFadeFullDegrees: 58,
	channelingSlopeStartDegrees: 16,
	channelingSlopeFullDegrees: 46,
	channelingMaxBlend: 0.28,
	leeShelterAlignmentStart: 0.18,
	leeShelterAlignmentFull: 0.82,
	leeShelterChannelingBoost: 0.085,
	orographicFoldGradientStart: 0.025,
	orographicFoldGradientFull: 0.20,
	orographicFoldChannelingBoost: 0.16,
	orographicFoldExposureBoost: 0.16,
	ridgelineExposureStart: 0.08,
	ridgelineExposureFull: 0.34,
	shelterPocketStart: 0.05,
	shelterPocketFull: 0.26,
	snowMobilityStartDegrees: 7,
	snowMobilityFullDegrees: 24,
	snowMobilityMax: 0.24,
	snowPackGainMax: 0.18,
	snowCrustScourGainMax: 0.12,
	// The permanent-ice floor supplies most northern snow before redistribution. Exposed shoulders may
	// lose up to 18% of loose surface snow; tundra and lee gains remain deliberately smaller.
	northWindwardScourMax: 0.18,
	tundraWindwardScourMax: 0.09,
	northLeeDepositMax: 0.11,
	tundraLeeDepositMax: 0.055,
});

function resolveSurfaceResponse({
	slopeDegrees,
	prevailingAspect,
	orographicFoldStrength,
	windwardScourSlope,
	leeCollection,
	leeRetention,
}) {
	const P = TERRAIN_WIND_SNOW_POLICY;
	const exposedAspect = smoothstep(P.directionalAlignmentStart, P.directionalAlignmentFull, Math.max(0, prevailingAspect));
	const shelteredAspect = smoothstep(P.directionalAlignmentStart, P.directionalAlignmentFull, Math.max(0, -prevailingAspect));
	const ridgelineExposure = clamp01(
		smoothstep(P.ridgelineExposureStart, P.ridgelineExposureFull, orographicFoldStrength)
			* exposedAspect
			* windwardScourSlope,
	);
	const shelterPocket = clamp01(
		smoothstep(P.shelterPocketStart, P.shelterPocketFull, orographicFoldStrength)
			* shelteredAspect
			* leeCollection
			* leeRetention,
	);
	const snowMobility = clamp01(
		smoothstep(P.snowMobilityStartDegrees, P.snowMobilityFullDegrees, slopeDegrees)
			* (0.55 + 0.45 * Math.max(ridgelineExposure, shelterPocket)),
	);
	const crustScour = ridgelineExposure * P.snowCrustScourGainMax;
	const packGain = shelterPocket * P.snowPackGainMax;
	return Object.freeze({
		ridgelineExposure,
		shelterPocket,
		snowMobility,
		crustScour,
		packGain,
	});
}

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
			leeShelterStrength: 0,
			channelingWeight: 0,
			effectiveSourceX: TERRAIN_WIND_SNOW_POLICY.prevailingSourceX,
			effectiveSourceZ: TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ,
			aspectDot: 0,
			windwardAlignment: 0,
			leeAlignment: 0,
			ridgelineExposure: 0,
			shelterPocket: 0,
			snowMobility: 0,
			crustScour: 0,
			packGain: 0,
			windward: 0,
			lee: 0,
		});
	}

	const normalX = -gradientX / gradientMagnitude;
	const normalZ = -gradientZ / gradientMagnitude;
	const prevailingAspect = normalX * TERRAIN_WIND_SNOW_POLICY.prevailingSourceX
		+ normalZ * TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ;
	const leeShelterStrength = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.leeShelterAlignmentStart,
		TERRAIN_WIND_SNOW_POLICY.leeShelterAlignmentFull,
		Math.max(0, -prevailingAspect),
	) * slopeAspectStrength;

	let contourX = -normalZ;
	let contourZ = normalX;
	const contourPrevailingDot = contourX * TERRAIN_WIND_SNOW_POLICY.prevailingSourceX
		+ contourZ * TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ;
	if (contourPrevailingDot < 0) {
		contourX = -contourX;
		contourZ = -contourZ;
	}
	const channelingCeiling = TERRAIN_WIND_SNOW_POLICY.channelingMaxBlend
		+ orographicFoldStrength * TERRAIN_WIND_SNOW_POLICY.orographicFoldChannelingBoost
		+ leeShelterStrength * orographicFoldStrength * TERRAIN_WIND_SNOW_POLICY.leeShelterChannelingBoost;
	const channelingAlignment = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.channelingAlignmentStart,
		TERRAIN_WIND_SNOW_POLICY.channelingAlignmentFull,
		Math.abs(prevailingAspect),
	);
	const channelingWeight = smoothstep(
		TERRAIN_WIND_SNOW_POLICY.channelingSlopeStartDegrees,
		TERRAIN_WIND_SNOW_POLICY.channelingSlopeFullDegrees,
		slopeDegrees,
	) * channelingCeiling * channelingAlignment;
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
	const response = resolveSurfaceResponse({
		slopeDegrees,
		prevailingAspect,
		orographicFoldStrength,
		windwardScourSlope,
		leeCollection,
		leeRetention,
	});

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
		leeShelterStrength,
		channelingWeight,
		effectiveSourceX,
		effectiveSourceZ,
		aspectDot,
		windwardAlignment,
		leeAlignment,
		...response,
		windward: clamp01(windwardAlignment * slopeAspectStrength * windwardScourSlope * foldExposureGain),
		lee: clamp01(leeAlignment * slopeAspectStrength * leeCollection * leeRetention * foldExposureGain),
	});
}

/**
 * Convert geometric exposure into bounded climate-aware snow adjustments.
 *
 * The existing biome-shading integration passes only `windward`/`lee`; therefore the resolver uses
 * those values as the compatibility projection of the richer fold response. Direct callers may pass
 * the richer fields explicitly. This keeps the visual change on the already-shipped path without
 * introducing a second terrain authority or requiring edits to another owner's renderer.
 */
export function resolveTerrainWindSnowAdjustment({
	windward = 0,
	lee = 0,
	permanentIce = 0,
	tundra = 0,
	ridgelineExposure = 0,
	shelterPocket = 0,
	snowMobility = 0,
	crustScour = 0,
	packGain = 0,
} = {}) {
	const P = TERRAIN_WIND_SNOW_POLICY;
	const ice = clamp01(permanentIce);
	const tundraBand = clamp01(tundra) * (1 - ice);
	const windwardWeight = clamp01(windward);
	const leeWeight = clamp01(lee);
	const ridgeExposure = clamp01(Math.max(ridgelineExposure, windwardWeight * 0.34));
	const shelter = clamp01(Math.max(shelterPocket, leeWeight * 0.38));
	const mobility = clamp01(Math.max(snowMobility, Math.max(windwardWeight, leeWeight) * 0.24));
	const boundedCrustScour = clamp01(Math.max(crustScour, ridgeExposure * P.snowCrustScourGainMax));
	const boundedPackGain = clamp01(Math.max(packGain, shelter * P.snowPackGainMax));
	const scourMax = Math.max(
		ice * P.northWindwardScourMax,
		tundraBand * P.tundraWindwardScourMax,
	);
	const depositMax = Math.max(
		ice * P.northLeeDepositMax,
		tundraBand * P.tundraLeeDepositMax,
	);
	const scourProfile = clamp01(
		0.78
		+ ridgeExposure * 0.16
		+ boundedCrustScour * 0.18
		+ mobility * P.snowMobilityMax * 0.30,
	);
	const depositProfile = clamp01(
		0.82
		+ shelter * 0.16
		+ boundedPackGain * 0.16
		- mobility * P.snowMobilityMax * 0.18,
	);
	return Object.freeze({
		windwardScour: windwardWeight * scourMax * scourProfile,
		leeDeposit: leeWeight * depositMax * depositProfile,
		scourMax,
		depositMax,
		scourProfile,
		depositProfile,
		ridgelineExposure: ridgeExposure,
		shelterPocket: shelter,
		snowMobility: mobility,
		crustScour: boundedCrustScour,
		packGain: boundedPackGain,
	});
}

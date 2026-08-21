/**
 * Pure northern shoreline cryosphere policy.
 *
 * Terrain height and coastline shape remain canonical Pindex/map authority. This module only resolves
 * render weights for the first few metres above sea level so warm sand does not survive unchanged
 * inside permanent ice, while tundra and temperate coasts still retain believable exposed shore.
 *
 * The resolver deliberately accepts climate weights from terrainBiomeShading rather than deriving
 * latitude itself. That keeps one north-climate authority and avoids a second hard latitude band.
 * @module world/northCoastalCryosphere
 */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

export const NORTH_COASTAL_CRYOSPHERE_POLICY = Object.freeze({
	id: 'north-coastal-cryosphere-2026-08-21-v1',
	renderOnly: true,
	heightAuthorityUnchanged: true,
	climateAuthority: 'terrainBiomeShading.northClimateWeightsAtWorldZ',
	shoreInfluenceFullMeters: 0.15,
	shoreInfluenceFadeMeters: 4.8,
	flatSlopeFullDegrees: 5,
	flatSlopeFadeDegrees: 32,
	permanentIceSandRetention: 0.04,
	tundraSandRetention: 0.46,
	frozenShoreStrength: 0.72,
	tundraFrozenShoreStrength: 0.22,
	packIceStrength: 0.44,
	tundraPackIceStrength: 0.10,
	rockExposureStrength: 0.34,
	variationCellMeters: 96,
	variationAmplitude: 0.12,
});

function hash01(ix, iz) {
	const n = Math.sin(ix * 91.713 + iz * 157.327 + 19.19) * 43758.5453123;
	return n - Math.floor(n);
}

function smoothLattice01(worldX, worldZ) {
	const cell = NORTH_COASTAL_CRYOSPHERE_POLICY.variationCellMeters;
	const gx = worldX / cell;
	const gz = worldZ / cell;
	const x0 = Math.floor(gx);
	const z0 = Math.floor(gz);
	const tx = gx - x0;
	const tz = gz - z0;
	const sx = tx * tx * (3 - 2 * tx);
	const sz = tz * tz * (3 - 2 * tz);
	const a = lerp(hash01(x0, z0), hash01(x0 + 1, z0), sx);
	const b = lerp(hash01(x0, z0 + 1), hash01(x0 + 1, z0 + 1), sx);
	return lerp(a, b, sz);
}

/** Allocation-free runtime resolver. `out` is overwritten and returned. */
export function resolveNorthCoastalCryosphereInto(out, {
	heightAboveSeaMeters,
	slopeDegrees,
	permanentIce,
	tundra,
	worldX = 0,
	worldZ = 0,
}) {
	const P = NORTH_COASTAL_CRYOSPHERE_POLICY;
	const ice = clamp01(permanentIce);
	const tundraOnly = clamp01(tundra) * (1 - ice);
	const land = heightAboveSeaMeters > 0 ? 1 : 0;
	const shoreline = land * (1 - smoothstep(P.shoreInfluenceFullMeters, P.shoreInfluenceFadeMeters, heightAboveSeaMeters));
	const flatness = 1 - smoothstep(P.flatSlopeFullDegrees, P.flatSlopeFadeDegrees, slopeDegrees);
	const coastEligibility = shoreline * flatness;
	const climateFreeze = clamp01(ice + tundraOnly * 0.34);
	const targetSandRetention = lerp(1, P.tundraSandRetention, tundraOnly);
	const sandRetention = lerp(targetSandRetention, P.permanentIceSandRetention, ice);
	const variation01 = smoothLattice01(worldX, worldZ);
	const variation = 1 + (variation01 - 0.5) * 2 * P.variationAmplitude;
	const frozenShore = clamp01(coastEligibility * variation * (
		ice * P.frozenShoreStrength + tundraOnly * P.tundraFrozenShoreStrength
	));
	const packIce = clamp01(coastEligibility * variation * (
		ice * P.packIceStrength + tundraOnly * P.tundraPackIceStrength
	));
	const rockExposure = clamp01(
		coastEligibility * climateFreeze * (1 - sandRetention) * P.rockExposureStrength,
	);

	out.shoreline = shoreline;
	out.flatness = flatness;
	out.coastEligibility = coastEligibility;
	out.climateFreeze = climateFreeze;
	out.sandRetention = clamp01(sandRetention);
	out.frozenShore = frozenShore;
	out.packIce = packIce;
	out.rockExposure = rockExposure;
	out.variation01 = variation01;
	return out;
}

/** Pure diagnostic wrapper for tests/debugging. */
export function resolveNorthCoastalCryosphere(input) {
	return Object.freeze({ ...resolveNorthCoastalCryosphereInto({}, input) });
}

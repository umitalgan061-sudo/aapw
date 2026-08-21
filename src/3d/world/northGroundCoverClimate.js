/**
 * Shared latitude policy for low ground cover in Westeros' far north.
 *
 * Terrain shading and tree species already consume `northClimateWeightsAtWorldZ`; physical wind
 * grass must use the same field or green blades remain visible over permanent snow. This module is
 * intentionally renderer-agnostic: it returns deterministic density, scale and RGB targets so any
 * instanced ground-cover system can consume the exact same climate decision without importing
 * Three.js or inventing a second set of latitude thresholds.
 * @module world/northGroundCoverClimate
 */

import { northClimateWeightsAtWorldZ } from './terrainBiomeShading.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const NORTH_GROUND_COVER_POLICY = Object.freeze({
	id: 'north-ground-cover-climate-2026-08-21-v1',
	// Once the permanent-ice floor is this strong, ordinary grass is completely absent. Keeping the
	// cutoff below 0.5 ensures the visible snow field wins before a player reaches its fully frozen core.
	permanentIceGrassZeroThreshold: 0.35,
	// Tundra can still carry hardy, sparse blades. Density fades continuously rather than flipping at
	// one latitude, preventing a circular/striped vegetation edge while crossing the climate band.
	tundraDensitySuppression: 0.82,
	// Height shrinks independently from density so surviving tundra patches read as wind-scoured low
	// cover rather than temperate meadow grass with fewer copies.
	tundraHeightSuppression: 0.36,
	iceHeightSuppression: 0.55,
	// Existing Run-180 grass is 0x4f7f36. The frozen transition target is a desaturated lichen/tundra
	// tone, not white: snow itself belongs to terrain shading, while sparse surviving cover stays plant.
	temperateRgb: Object.freeze({ r: 0x4f / 255, g: 0x7f / 255, b: 0x36 / 255 }),
	tundraRgb: Object.freeze({ r: 0x76 / 255, g: 0x80 / 255, b: 0x69 / 255 }),
});

function blendRgb(a, b, amount) {
	return Object.freeze({
		r: lerp(a.r, b.r, amount),
		g: lerp(a.g, b.g, amount),
		b: lerp(a.b, b.b, amount),
	});
}

/**
 * Resolve deterministic low-cover behavior at a world-space Z coordinate.
 *
 * `grassDensity` is an acceptance probability in [0,1] for a seeded scatter attempt. A value of 0
 * means no ordinary grass may exist at that latitude. `heightScale` is multiplied into the existing
 * patch scale after an instance survives density thinning. `rgb` is the material/instance target.
 */
export function northGroundCoverProfileAtWorldZ(worldZ) {
	const climate = northClimateWeightsAtWorldZ(worldZ);
	const P = NORTH_GROUND_COVER_POLICY;

	const iceSurvival = 1 - clamp01(climate.permanentIce / P.permanentIceGrassZeroThreshold);
	const tundraSurvival = 1 - climate.tundra * P.tundraDensitySuppression;
	const grassDensity = clamp01(iceSurvival * tundraSurvival);

	const heightScale = clamp01(
		(1 - climate.tundra * P.tundraHeightSuppression)
		* (1 - climate.permanentIce * P.iceHeightSuppression),
	);
	const frostAmount = clamp01(Math.max(climate.tundra * 0.92, climate.permanentIce));
	const rgb = blendRgb(P.temperateRgb, P.tundraRgb, frostAmount);

	return Object.freeze({
		policyId: P.id,
		normalizedY: climate.normalizedY,
		permanentIce: climate.permanentIce,
		tundra: climate.tundra,
		grassDensity,
		heightScale,
		frostAmount,
		rgb,
	});
}

/**
 * Deterministic helper for seeded scatter systems. Keeping the roll outside the profile resolver is
 * important: callers own RNG stream ordering and can preserve bit-identical placement for the south.
 */
export function acceptsNorthGroundCover(worldZ, roll) {
	const numericRoll = Number(roll);
	if (!Number.isFinite(numericRoll)) return false;
	return numericRoll < northGroundCoverProfileAtWorldZ(worldZ).grassDensity;
}

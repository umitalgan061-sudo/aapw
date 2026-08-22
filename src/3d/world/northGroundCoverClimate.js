/**
 * Shared climate policy for low ground cover in Westeros' far north.
 *
 * New runtime consumers should use the X/Z-aware profile so vegetation follows the canonical
 * map.png north/always-winter zones instead of a latitude stripe spanning unrelated landmasses.
 * The legacy Z-only API remains available for existing callers until their hot paths migrate.
 * This module stays renderer-agnostic and never changes terrain/collider height authority.
 * @module world/northGroundCoverClimate
 */

import { northClimateWeightsAtWorldZ } from './terrainBiomeShading.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const NORTH_GROUND_COVER_POLICY = Object.freeze({
	id: 'north-ground-cover-climate-2026-08-22-v2-map-aligned',
	mapAlignedClimateAvailable: true,
	renderClimateOnly: true,
	heightAuthorityUnchanged: true,
	// Once the permanent-ice floor is this strong, ordinary grass is completely absent. Keeping the
	// cutoff below 0.5 ensures the visible snow field wins before a player reaches its fully frozen core.
	permanentIceGrassZeroThreshold: 0.35,
	// Tundra can still carry hardy, sparse blades. Density fades continuously rather than flipping at
	// one climate boundary, preventing a hard vegetation edge while crossing the canonical north zone.
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

function profileFromClimate(climate) {
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
		normalizedX: climate.normalizedX ?? null,
		normalizedY: climate.normalizedY,
		permanentIce: climate.permanentIce,
		tundra: climate.tundra,
		tundraBand: climate.tundraBand ?? climate.tundra * (1 - climate.permanentIce),
		grassDensity,
		heightScale,
		frostAmount,
		rgb,
	});
}

/**
 * Canonical map-aligned low-cover profile. This is the preferred API for runtime scatter systems.
 */
export function northGroundCoverProfileAtWorldXZ(worldX, worldZ) {
	return profileFromClimate(northReferenceCryosphereAtWorldXZ(worldX, worldZ));
}

/**
 * Legacy latitude-only profile retained for compatibility while callers are migrated to X/Z.
 */
export function northGroundCoverProfileAtWorldZ(worldZ) {
	return profileFromClimate(northClimateWeightsAtWorldZ(worldZ));
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

/** Canonical X/Z-aware acceptance helper for migrated runtime consumers. */
export function acceptsNorthGroundCoverAtWorldXZ(worldX, worldZ, roll) {
	const numericRoll = Number(roll);
	if (!Number.isFinite(numericRoll)) return false;
	return numericRoll < northGroundCoverProfileAtWorldXZ(worldX, worldZ).grassDensity;
}

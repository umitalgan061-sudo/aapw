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
	id: 'north-ground-cover-climate-2026-08-25-v3-ecological-mosaic',
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
	// Render-only, deterministic multi-scale patchiness. This does not move climate boundaries or
	// invent vegetation zones; it only breaks uniform tundra carpets inside already-authoritative
	// climate weights. Broad cells read as ecological mosaics while fine cells break repeated tufts.
	ecologicalMosaic: Object.freeze({
		broadScaleMeters: 210,
		fineScaleMeters: 58,
		densityStrength: 0.34,
		heightStrength: 0.18,
		colorStrength: 0.12,
	}),
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

function hashCell(ix, iz, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iz | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function smoothNoiseAt(worldX, worldZ, scaleMeters, seed) {
	const x = worldX / scaleMeters;
	const z = worldZ / scaleMeters;
	const x0 = Math.floor(x);
	const z0 = Math.floor(z);
	const tx0 = x - x0;
	const tz0 = z - z0;
	const tx = tx0 * tx0 * (3 - 2 * tx0);
	const tz = tz0 * tz0 * (3 - 2 * tz0);
	const a = hashCell(x0, z0, seed);
	const b = hashCell(x0 + 1, z0, seed);
	const c = hashCell(x0, z0 + 1, seed);
	const d = hashCell(x0 + 1, z0 + 1, seed);
	return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function ecologicalMosaicAt(worldX, worldZ) {
	const P = NORTH_GROUND_COVER_POLICY.ecologicalMosaic;
	const broad = smoothNoiseAt(worldX, worldZ, P.broadScaleMeters, 0x5a17);
	const fine = smoothNoiseAt(worldX + 31.7, worldZ - 19.3, P.fineScaleMeters, 0x91e3);
	return clamp01(broad * 0.72 + fine * 0.28);
}

function profileFromClimate(climate, worldX = null, worldZ = null) {
	const P = NORTH_GROUND_COVER_POLICY;
	const iceSurvival = 1 - clamp01(climate.permanentIce / P.permanentIceGrassZeroThreshold);
	const tundraSurvival = 1 - climate.tundra * P.tundraDensitySuppression;
	let grassDensity = clamp01(iceSurvival * tundraSurvival);
	let heightScale = clamp01(
		(1 - climate.tundra * P.tundraHeightSuppression)
		* (1 - climate.permanentIce * P.iceHeightSuppression),
	);
	const frostAmount = clamp01(Math.max(climate.tundra * 0.92, climate.permanentIce));
	let rgb = blendRgb(P.temperateRgb, P.tundraRgb, frostAmount);
	let ecologicalMosaic = null;

	if (Number.isFinite(worldX) && Number.isFinite(worldZ)) {
		ecologicalMosaic = ecologicalMosaicAt(worldX, worldZ);
		const tundraInfluence = clamp01(Math.max(climate.tundra, climate.permanentIce * 0.72));
		const centered = (ecologicalMosaic - 0.5) * 2;
		grassDensity = clamp01(grassDensity * (1 + centered * P.ecologicalMosaic.densityStrength * tundraInfluence));
		heightScale = clamp01(heightScale * (1 + centered * P.ecologicalMosaic.heightStrength * tundraInfluence));
		const colorShift = clamp01(0.5 + centered * P.ecologicalMosaic.colorStrength * tundraInfluence);
		const dryTundra = Object.freeze({ r: 0.42, g: 0.45, b: 0.37 });
		const dampLichen = Object.freeze({ r: 0.49, g: 0.53, b: 0.46 });
		const mosaicRgb = blendRgb(dryTundra, dampLichen, colorShift);
		rgb = blendRgb(rgb, mosaicRgb, tundraInfluence * 0.22);
	}

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
		ecologicalMosaic,
		rgb,
	});
}

/**
 * Canonical map-aligned low-cover profile. This is the preferred API for runtime scatter systems.
 */
export function northGroundCoverProfileAtWorldXZ(worldX, worldZ) {
	return profileFromClimate(northReferenceCryosphereAtWorldXZ(worldX, worldZ), worldX, worldZ);
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

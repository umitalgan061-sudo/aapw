/**
 * Shadow-only canonical hydrology terrain adapter.
 *
 * Run 186 is the first executable height-sampler layer that applies the owner-map coastline to the
 * planned full-reference world. It deliberately does NOT replace `world/terrain.js` or alter the
 * live scene: callers must opt in explicitly by wrapping an existing target-scale base sampler.
 * Raw Run179 coastline data and Run182 seat-protection data stay immutable; this module only
 * composes them into a deterministic terrain-height policy for migration qualification.
 * @module world/worldReferenceTerrainAdapter
 */

import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { sampleSeatSafeReferenceHydrology } from './worldReferenceHydrology.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';

export const CANONICAL_TERRAIN_SHADOW_POLICY = Object.freeze({
	id: 'canonical-hydrology-terrain-shadow-2026-08-08',
	/** Deep open-water floor below the shared water plane. */
	openWaterDepthMeters: 8,
	/** Even a coarse-mask coastal water cell must remain visibly below the water plane. */
	minimumWaterDepthMeters: 2.5,
	/** Inland raw-land cells are guaranteed this much clearance above the water plane. */
	inlandLandClearanceMeters: 1.25,
	/** Coast-adjacent raw-land cells retain a smaller but non-zero dry clearance. */
	minimumLandClearanceMeters: 0.35,
	/** Protected-land edges approach the water plane smoothly but may never fall below this. */
	minimumProtectedLandClearanceMeters: 0.08,
});

function assertFinite(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function assertSampler(fn, label) {
	if (typeof fn !== 'function') throw new TypeError(`${label} must be a function`);
}

function clamp01(value) {
	return Math.min(1, Math.max(0, value));
}

/**
 * Returns the canonical hydrology classification plus the target height this shadow policy would
 * use at a planned-world point. This metadata form is useful for dry-run diagnostics; runtime code
 * should normally consume `createCanonicalHydrologyTerrainSampler`'s numeric sampler instead.
 */
export function sampleCanonicalHydrologyTerrainTarget({
	worldX,
	worldZ,
	baseHeightSampler,
	seaLevelMeters,
	protectedSites,
	protectionRadii,
	policy = CANONICAL_TERRAIN_SHADOW_POLICY,
}) {
	assertFinite(worldX, 'worldX');
	assertFinite(worldZ, 'worldZ');
	assertFinite(seaLevelMeters, 'seaLevelMeters');
	assertSampler(baseHeightSampler, 'baseHeightSampler');

	const mapPoint = plannedWorldXZToMapCanvas(worldX, worldZ);
	const normalized = mapCanvasToNormalizedReference(mapPoint.x, mapPoint.y);
	const hydrology = sampleSeatSafeReferenceHydrology(
		normalized.x,
		normalized.y,
		protectedSites,
		protectionRadii,
	);
	const baseHeightMeters = baseHeightSampler(worldX, worldZ);
	assertFinite(baseHeightMeters, 'baseHeightSampler result');

	let targetHeightMeters;
	let rule;
	if (hydrology.protectedLand) {
		// Protection weight naturally tends toward zero at its outer ellipse; keep a tiny dry margin
		// at that boundary while giving canonical settlement centers the full inland clearance.
		const protectedClearance = policy.minimumProtectedLandClearanceMeters
			+ (policy.inlandLandClearanceMeters - policy.minimumProtectedLandClearanceMeters)
				* clamp01(hydrology.protectedLandWeight);
		targetHeightMeters = Math.max(baseHeightMeters, seaLevelMeters + protectedClearance);
		rule = 'protected-land';
	} else if (hydrology.water) {
		// `coastBlend` is larger in water-dense neighbourhoods. Coast cells stay shallow; open water
		// becomes deeper, avoiding a binary one-depth ocean while remaining fully deterministic.
		const depth = policy.minimumWaterDepthMeters
			+ (policy.openWaterDepthMeters - policy.minimumWaterDepthMeters) * clamp01(hydrology.coastBlend);
		targetHeightMeters = Math.min(baseHeightMeters, seaLevelMeters - depth);
		rule = 'canonical-water';
	} else {
		// Raw land is prevented from being accidentally flooded by the existing flat water plane.
		// Near a coast the dry clearance tapers, but never to zero; inland it reaches the full value.
		const inlandWeight = 1 - clamp01(hydrology.coastBlend);
		const clearance = policy.minimumLandClearanceMeters
			+ (policy.inlandLandClearanceMeters - policy.minimumLandClearanceMeters) * inlandWeight;
		targetHeightMeters = Math.max(baseHeightMeters, seaLevelMeters + clearance);
		rule = 'canonical-land';
	}

	return Object.freeze({
		worldX,
		worldZ,
		mapX: mapPoint.x,
		mapY: mapPoint.y,
		normalizedX: normalized.x,
		normalizedY: normalized.y,
		baseHeightMeters,
		targetHeightMeters,
		rule,
		hydrology,
	});
}

/**
 * Creates a pure numeric height sampler for the planned full-reference world. It is intentionally
 * opt-in and has no import from live scene/chunk code in Run186.
 */
export function createCanonicalHydrologyTerrainSampler({
	baseHeightSampler,
	seaLevelMeters,
	protectedSites,
	protectionRadii,
	policy = CANONICAL_TERRAIN_SHADOW_POLICY,
}) {
	assertSampler(baseHeightSampler, 'baseHeightSampler');
	assertFinite(seaLevelMeters, 'seaLevelMeters');
	if (!Array.isArray(protectedSites)) throw new TypeError('protectedSites must be an array');
	if (!protectionRadii || !Number.isFinite(protectionRadii.x) || !Number.isFinite(protectionRadii.y)) {
		throw new TypeError('protectionRadii must contain finite x/y');
	}

	return function sampleCanonicalHydrologyTerrain(worldX, worldZ) {
		return sampleCanonicalHydrologyTerrainTarget({
			worldX,
			worldZ,
			baseHeightSampler,
			seaLevelMeters,
			protectedSites,
			protectionRadii,
			policy,
		}).targetHeightMeters;
	};
}

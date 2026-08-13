/**
 * Canonical reference-world terrain adapter.
 *
 * Run 186 is the first executable height-sampler layer that applies the owner-map coastline to the
 * planned full-reference world. It deliberately does NOT replace `world/terrain.js` or alter the
 * live scene: callers must opt in explicitly by wrapping an existing target-scale base sampler.
 * Raw Run179 coastline data and Run182 seat-protection data stay immutable; this module only
 * composes them into a deterministic terrain-height policy for migration qualification.
 *
 * NW G11 Terrain3D parity additionally exposes a deterministic bilinear sampler for a validated
 * Terrain3D bake artifact. Keeping that sampler in this established, PWA-precached terrain adapter
 * avoids creating a second offline runtime island while leaving the hydrology shadow policy intact.
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

export const G11_TERRAIN3D_PARITY_SCHEMA = 'westeros-g11-terrain3d-bake-v1';

function assertG11Terrain3DBake(bake) {
	if (!bake || bake.schema !== G11_TERRAIN3D_PARITY_SCHEMA) {
		throw new TypeError('invalid G11 Terrain3D bake schema');
	}
	if (!Number.isInteger(bake.width) || !Number.isInteger(bake.height) || bake.width < 2 || bake.height < 2) {
		throw new RangeError('G11 bake dimensions must be >= 2');
	}
	if (!Array.isArray(bake.heights) || bake.heights.length !== bake.width * bake.height) {
		throw new RangeError('G11 bake height payload size mismatch');
	}
	for (let i = 0; i < bake.heights.length; i++) {
		assertFinite(Number(bake.heights[i]), `G11 bake height[${i}]`);
	}
}

/**
 * Creates the continuous Three.js-side sampler for a validated G11 Terrain3D bake. The 65x65
 * payload is an addressing/proof lattice only: runtime queries interpolate bilinearly in normalized
 * reference space and never expose nearest-neighbour GeoCell steps.
 */
export function createG11Terrain3DBakeSampler(bake) {
	assertG11Terrain3DBake(bake);
	const { minX, maxX, minY, maxY } = bake.normalizedBounds;
	assertFinite(minX, 'minX');
	assertFinite(maxX, 'maxX');
	assertFinite(minY, 'minY');
	assertFinite(maxY, 'maxY');
	if (!(maxX > minX) || !(maxY > minY)) throw new RangeError('G11 normalized bounds are invalid');

	const scaleX = (bake.width - 1) / (maxX - minX);
	const scaleY = (bake.height - 1) / (maxY - minY);
	return function sampleNormalized(nx, ny) {
		if (nx < minX || nx > maxX || ny < minY || ny > maxY) return null;
		const x = Math.min(bake.width - 1, Math.max(0, (nx - minX) * scaleX));
		const y = Math.min(bake.height - 1, Math.max(0, (ny - minY) * scaleY));
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const x1 = Math.min(bake.width - 1, x0 + 1);
		const y1 = Math.min(bake.height - 1, y0 + 1);
		const tx = x - x0;
		const ty = y - y0;
		const at = (ix, iy) => Number(bake.heights[iy * bake.width + ix]);
		const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
		const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
		return a * (1 - ty) + b * ty;
	};
}

/** Applies the validated G11 bake to matching Three.js position vertices without discrete cell steps. */
export function applyG11Terrain3DBakeToPositionAttribute(position, normalizedForVertex, bake) {
	const sample = createG11Terrain3DBakeSampler(bake);
	let touched = 0;
	for (let i = 0; i < position.count; i++) {
		const uv = normalizedForVertex(i);
		const height = sample(uv.x, uv.y);
		if (height === null) continue;
		position.setY(i, height);
		touched++;
	}
	position.needsUpdate = touched > 0;
	return touched;
}

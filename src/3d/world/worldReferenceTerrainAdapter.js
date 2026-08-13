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

import { sampleG07Terrain3dBakeNormalized } from './g07Terrain3dBake.js';
import { mapCanvasToNormalizedReference, worldXZToNormalizedReference } from './worldReferenceAlignment.js';
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
	const terrain3dBake = sampleG07Terrain3dBakeNormalized(normalized.x, normalized.y);

	let targetHeightMeters;
	let rule;
	if (terrain3dBake && hydrology.water && !hydrology.protectedLand) {
		// G07 carries real pinned Terrain3D height/control/color provenance into this canonical
		// migration adapter. It intentionally remains opt-in until adjacent cells can transition
		// without exposing an artificial GeoCell boundary in the live terrain mesh.
		targetHeightMeters = terrain3dBake.height;
		rule = 'terrain3d-bake-g07';
	} else if (hydrology.protectedLand) {
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
		terrain3dSurface: terrain3dBake,
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

/**
 * Kızıl Ufuk / G75 — qualified Terrain3D bake -> Three.js runtime parity adapter.
 *
 * This remains opt-in like the hydrology adapter above: it validates and samples a qualified G75
 * Terrain3D bake but does not replace the shared live terrain sampler. Keeping the parity sampler
 * in this already-cached adapter preserves PWA/offline import closure without introducing a second
 * global terrain policy or a cell-specific uncached runtime module.
 */
export const G75_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
	id: 'kizil-ufuk-g75-terrain3d-threejs-runtime-parity-2026-08-13-v1',
	geoCell: 'G75',
	layer: 'Terrain3D Bake/Runtime parity',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	terrain3dVersion: '1.0.2-stable',
	terrain3dLod: 0,
	sourceSize: 65,
	normalizedBounds: Object.freeze({ xMin: 7 / 8, xMax: 1, yMin: 5 / 8, yMax: 6 / 8 }),
});

const G75_TERRAIN3D_BAKE_CHANNELS = Object.freeze([
	'heights',
	'rockBlend',
	'tintR',
	'tintG',
	'tintB',
	'roughness',
]);

function assertG75BakePayload(bake) {
	if (!bake || typeof bake !== 'object') throw new TypeError('Terrain3D bake payload must be an object');
	if (bake.schema !== 'westeros-g75-terrain3d-bake-v1') {
		throw new Error(`unexpected G75 bake schema: ${bake.schema}`);
	}
	if (bake.sourceMapSha256 !== G75_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) {
		throw new Error('G75 bake map.png provenance mismatch');
	}
	if (
		bake.width !== G75_TERRAIN3D_RUNTIME_PARITY.sourceSize
		|| bake.height !== G75_TERRAIN3D_RUNTIME_PARITY.sourceSize
	) {
		throw new Error(
			`G75 bake must be ${G75_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G75_TERRAIN3D_RUNTIME_PARITY.sourceSize}`,
		);
	}
	const expected = bake.width * bake.height;
	for (const channel of G75_TERRAIN3D_BAKE_CHANNELS) {
		if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) {
			throw new Error(`invalid G75 bake channel ${channel}`);
		}
		for (let i = 0; i < bake[channel].length; i += 1) {
			assertFinite(bake[channel][i], `${channel}[${i}]`);
		}
	}
}

function bilinearG75BakeChannel(values, width, height, u, v) {
	const gx = clamp01(u) * (width - 1);
	const gy = clamp01(v) * (height - 1);
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const x1 = Math.min(x0 + 1, width - 1);
	const y1 = Math.min(y0 + 1, height - 1);
	const tx = gx - x0;
	const ty = gy - y0;
	const top = values[y0 * width + x0] + (values[y0 * width + x1] - values[y0 * width + x0]) * tx;
	const bottom = values[y1 * width + x0] + (values[y1 * width + x1] - values[y1 * width + x0]) * tx;
	return top + (bottom - top) * ty;
}

function g75LocalUv(normalizedX, normalizedY) {
	assertFinite(normalizedX, 'normalizedX');
	assertFinite(normalizedY, 'normalizedY');
	const bounds = G75_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
	const epsilon = 1e-9;
	if (
		normalizedX < bounds.xMin - epsilon
		|| normalizedX > bounds.xMax + epsilon
		|| normalizedY < bounds.yMin - epsilon
		|| normalizedY > bounds.yMax + epsilon
	) {
		throw new RangeError('G75 parity sampler may only be queried inside its qualified owner-map domain');
	}
	return Object.freeze({
		u: clamp01((normalizedX - bounds.xMin) / (bounds.xMax - bounds.xMin)),
		v: clamp01((normalizedY - bounds.yMin) / (bounds.yMax - bounds.yMin)),
	});
}

export function createG75Terrain3DBakeSampler(bake) {
	assertG75BakePayload(bake);
	const { width, height } = bake;
	return function sampleG75Terrain3DBake(normalizedX, normalizedY) {
		const { u, v } = g75LocalUv(normalizedX, normalizedY);
		return Object.freeze({
			heightMeters: bilinearG75BakeChannel(bake.heights, width, height, u, v),
			rockBlend: bilinearG75BakeChannel(bake.rockBlend, width, height, u, v),
			tintR: bilinearG75BakeChannel(bake.tintR, width, height, u, v),
			tintG: bilinearG75BakeChannel(bake.tintG, width, height, u, v),
			tintB: bilinearG75BakeChannel(bake.tintB, width, height, u, v),
			roughness: bilinearG75BakeChannel(bake.roughness, width, height, u, v),
		});
	};
}

/**
 * Browser-world wrapper around the owner-map bake sampler. Conversion uses the repository's
 * canonical 9000x7000 world/reference transform, so Three.js world positions and Terrain3D bake
 * coordinates share one auditable geographic contract.
 */
export function createG75Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
	const sampleNormalized = createG75Terrain3DBakeSampler(bake);
	if (
		!mapBounds
		|| !Number.isFinite(mapBounds.minX)
		|| !Number.isFinite(mapBounds.maxX)
		|| !Number.isFinite(mapBounds.minY)
		|| !Number.isFinite(mapBounds.maxY)
	) {
		throw new TypeError('mapBounds must contain finite min/max X/Y');
	}
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	return function sampleG75Terrain3DWorld(worldX, worldZ) {
		const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
		return sampleNormalized(normalized.x, normalized.y);
	};
}

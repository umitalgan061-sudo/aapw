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
		const protectedClearance = policy.minimumProtectedLandClearanceMeters
			+ (policy.inlandLandClearanceMeters - policy.minimumProtectedLandClearanceMeters)
				* clamp01(hydrology.protectedLandWeight);
		targetHeightMeters = Math.max(baseHeightMeters, seaLevelMeters + protectedClearance);
		rule = 'protected-land';
	} else if (hydrology.water) {
		const depth = policy.minimumWaterDepthMeters
			+ (policy.openWaterDepthMeters - policy.minimumWaterDepthMeters) * clamp01(hydrology.coastBlend);
		targetHeightMeters = Math.min(baseHeightMeters, seaLevelMeters - depth);
		rule = 'canonical-water';
	} else {
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

/** Kızıl Ufuk / G75 — qualified Terrain3D bake -> Three.js runtime parity adapter. */
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

const G75_TERRAIN3D_BAKE_CHANNELS = Object.freeze(['heights', 'rockBlend', 'tintR', 'tintG', 'tintB', 'roughness']);

function assertG75BakePayload(bake) {
	if (!bake || typeof bake !== 'object') throw new TypeError('Terrain3D bake payload must be an object');
	if (bake.schema !== 'westeros-g75-terrain3d-bake-v1') throw new Error(`unexpected G75 bake schema: ${bake.schema}`);
	if (bake.sourceMapSha256 !== G75_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G75 bake map.png provenance mismatch');
	if (bake.width !== G75_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G75_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
		throw new Error(`G75 bake must be ${G75_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G75_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
	}
	const expected = bake.width * bake.height;
	for (const channel of G75_TERRAIN3D_BAKE_CHANNELS) {
		if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G75 bake channel ${channel}`);
		for (let i = 0; i < bake[channel].length; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
	}
}

function bilinearBakeChannel(values, width, height, u, v) {
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

function localUv(normalizedX, normalizedY, bounds, label) {
	assertFinite(normalizedX, 'normalizedX');
	assertFinite(normalizedY, 'normalizedY');
	const epsilon = 1e-9;
	if (normalizedX < bounds.xMin - epsilon || normalizedX > bounds.xMax + epsilon || normalizedY < bounds.yMin - epsilon || normalizedY > bounds.yMax + epsilon) {
		throw new RangeError(`${label} parity sampler may only be queried inside its qualified owner-map domain`);
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
		const { u, v } = localUv(normalizedX, normalizedY, G75_TERRAIN3D_RUNTIME_PARITY.normalizedBounds, 'G75');
		return Object.freeze({
			heightMeters: bilinearBakeChannel(bake.heights, width, height, u, v),
			rockBlend: bilinearBakeChannel(bake.rockBlend, width, height, u, v),
			tintR: bilinearBakeChannel(bake.tintR, width, height, u, v),
			tintG: bilinearBakeChannel(bake.tintG, width, height, u, v),
			tintB: bilinearBakeChannel(bake.tintB, width, height, u, v),
			roughness: bilinearBakeChannel(bake.roughness, width, height, u, v),
		});
	};
}

export function createG75Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
	const sampleNormalized = createG75Terrain3DBakeSampler(bake);
	if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
		throw new TypeError('mapBounds must contain finite min/max X/Y');
	}
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	return function sampleG75Terrain3DWorld(worldX, worldZ) {
		const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
		return sampleNormalized(normalized.x, normalized.y);
	};
}

/** Şafak Kartalı / G52 — qualified mixed-coast Terrain3D bake -> Three.js parity adapter. */
export const G52_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
	id: 'safak-kartali-g52-terrain3d-threejs-runtime-parity-2026-08-13-v1',
	geoCell: 'G52',
	layer: 'Terrain3D Bake/Runtime parity',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	terrain3dVersion: '1.0.2-stable',
	terrain3dLod: 0,
	sourceSize: 65,
	normalizedBounds: Object.freeze({ xMin: 5 / 8, xMax: 6 / 8, yMin: 2 / 8, yMax: 3 / 8 }),
});

const G52_TERRAIN3D_BAKE_CHANNELS = Object.freeze(['heights', 'snowWeight', 'tintR', 'tintG', 'tintB', 'roughness']);

function assertG52BakePayload(bake) {
	if (!bake || typeof bake !== 'object') throw new TypeError('Terrain3D bake payload must be an object');
	if (bake.schema !== 'westeros-g52-terrain3d-bake-v1') throw new Error(`unexpected G52 bake schema: ${bake.schema}`);
	if (bake.sourceMapSha256 !== G52_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G52 bake map.png provenance mismatch');
	if (bake.width !== G52_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G52_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
		throw new Error(`G52 bake must be ${G52_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G52_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
	}
	const expected = bake.width * bake.height;
	for (const channel of G52_TERRAIN3D_BAKE_CHANNELS) {
		if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G52 bake channel ${channel}`);
		for (let i = 0; i < bake[channel].length; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
	}
}

export function createG52Terrain3DBakeSampler(bake) {
	assertG52BakePayload(bake);
	const { width, height } = bake;
	return function sampleG52Terrain3DBake(normalizedX, normalizedY) {
		const { u, v } = localUv(normalizedX, normalizedY, G52_TERRAIN3D_RUNTIME_PARITY.normalizedBounds, 'G52');
		return Object.freeze({
			heightMeters: bilinearBakeChannel(bake.heights, width, height, u, v),
			snowWeight: bilinearBakeChannel(bake.snowWeight, width, height, u, v),
			tintR: bilinearBakeChannel(bake.tintR, width, height, u, v),
			tintG: bilinearBakeChannel(bake.tintG, width, height, u, v),
			tintB: bilinearBakeChannel(bake.tintB, width, height, u, v),
			roughness: bilinearBakeChannel(bake.roughness, width, height, u, v),
		});
	};
}

export function createG52Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
	const sampleNormalized = createG52Terrain3DBakeSampler(bake);
	if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
		throw new TypeError('mapBounds must contain finite min/max X/Y');
	}
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	return function sampleG52Terrain3DWorld(worldX, worldZ) {
		const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
		return sampleNormalized(normalized.x, normalized.y);
	};
}

/** Buzul Muhafızı / G00 — qualified 257x257 Terrain3D bake -> Three.js parity adapter. */
export const G00_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
	id: 'buzul-muhafizi-g00-terrain3d-threejs-runtime-parity-2026-08-13-v1',
	geoCell: 'G00',
	layer: 'Terrain3D Bake/Runtime parity',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	terrain3dVersion: '1.0.2-stable',
	terrain3dLod: 0,
	sourceSize: 257,
	normalizedBounds: Object.freeze({ xMin: 0, xMax: 1 / 8, yMin: 0, yMax: 1 / 8 }),
});

const G00_TERRAIN3D_BAKE_CHANNELS = Object.freeze([
	'heights', 'roadCoverage', 'pathCoverage', 'snowSurface', 'tintR', 'tintG', 'tintB', 'roughness',
]);

function assertG00BakePayload(bake) {
	if (!bake || typeof bake !== 'object') throw new TypeError('Terrain3D bake payload must be an object');
	if (bake.schema !== 'westeros-g00-terrain3d-bake-v1') throw new Error(`unexpected G00 bake schema: ${bake.schema}`);
	if (bake.sourceMapSha256 !== G00_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G00 bake map.png provenance mismatch');
	if (bake.width !== G00_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G00_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
		throw new Error(`G00 bake must be ${G00_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G00_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
	}
	const expected = bake.width * bake.height;
	for (const channel of G00_TERRAIN3D_BAKE_CHANNELS) {
		if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G00 bake channel ${channel}`);
		for (let i = 0; i < bake[channel].length; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
	}
}

export function createG00Terrain3DBakeSampler(bake) {
	assertG00BakePayload(bake);
	const { width, height } = bake;
	return function sampleG00Terrain3DBake(normalizedX, normalizedY) {
		const { u, v } = localUv(normalizedX, normalizedY, G00_TERRAIN3D_RUNTIME_PARITY.normalizedBounds, 'G00');
		return Object.freeze({
			heightMeters: bilinearBakeChannel(bake.heights, width, height, u, v),
			roadCoverage: bilinearBakeChannel(bake.roadCoverage, width, height, u, v),
			pathCoverage: bilinearBakeChannel(bake.pathCoverage, width, height, u, v),
			snowSurface: bilinearBakeChannel(bake.snowSurface, width, height, u, v),
			tintR: bilinearBakeChannel(bake.tintR, width, height, u, v),
			tintG: bilinearBakeChannel(bake.tintG, width, height, u, v),
			tintB: bilinearBakeChannel(bake.tintB, width, height, u, v),
			roughness: bilinearBakeChannel(bake.roughness, width, height, u, v),
		});
	};
}

export function createG00Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
	const sampleNormalized = createG00Terrain3DBakeSampler(bake);
	if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
		throw new TypeError('mapBounds must contain finite min/max X/Y');
	}
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	return function sampleG00Terrain3DWorld(worldX, worldZ) {
		const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
		return sampleNormalized(normalized.x, normalized.y);
	};
}

/** Kızıl Ufuk / G65 — qualified 129x129 Terrain3D bake -> Three.js runtime parity adapter. */
export const G65_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
	id: 'kizil-ufuk-g65-terrain3d-threejs-runtime-parity-2026-08-13-v1',
	geoCell: 'G65',
	layer: 'Terrain3D Bake/Runtime parity',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	terrain3dVersion: '1.0.2-stable',
	terrain3dLod: 0,
	sourceSize: 129,
	terrain3dImportSize: 257,
	terrain3dRegionSize: 256,
	normalizedBounds: Object.freeze({ xMin: 6 / 8, xMax: 7 / 8, yMin: 5 / 8, yMax: 6 / 8 }),
});

const G65_TERRAIN3D_BAKE_CHANNELS = Object.freeze(['heights', 'rockBlend', 'tintR', 'tintG', 'tintB', 'roughness']);

function assertG65BakePayload(bake) {
	if (!bake || typeof bake !== 'object') throw new TypeError('G65 Terrain3D bake payload must be an object');
	if (bake.schema !== 'westeros-g65-terrain3d-bake-v1') throw new Error(`unexpected G65 bake schema: ${bake.schema}`);
	if (bake.policyId !== G65_TERRAIN3D_RUNTIME_PARITY.id) throw new Error(`unexpected G65 runtime parity policy: ${bake.policyId}`);
	if (bake.sourceMapSha256 !== G65_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G65 bake map.png provenance mismatch');
	if (bake.width !== G65_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G65_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
		throw new Error(`G65 bake must be ${G65_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G65_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
	}
	const expected = bake.width * bake.height;
	for (const channel of G65_TERRAIN3D_BAKE_CHANNELS) {
		if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G65 bake channel ${channel}`);
		for (let i = 0; i < bake[channel].length; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
	}
}

export function createG65Terrain3DBakeSampler(bake) {
	assertG65BakePayload(bake);
	const { width, height } = bake;
	return function sampleG65Terrain3DBake(normalizedX, normalizedY) {
		const { u, v } = localUv(normalizedX, normalizedY, G65_TERRAIN3D_RUNTIME_PARITY.normalizedBounds, 'G65');
		return Object.freeze({
			heightMeters: bilinearBakeChannel(bake.heights, width, height, u, v),
			rockBlend: bilinearBakeChannel(bake.rockBlend, width, height, u, v),
			tintR: bilinearBakeChannel(bake.tintR, width, height, u, v),
			tintG: bilinearBakeChannel(bake.tintG, width, height, u, v),
			tintB: bilinearBakeChannel(bake.tintB, width, height, u, v),
			roughness: bilinearBakeChannel(bake.roughness, width, height, u, v),
		});
	};
}

export function createG65Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
	const sampleNormalized = createG65Terrain3DBakeSampler(bake);
	if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
		throw new TypeError('mapBounds must contain finite min/max X/Y');
	}
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	return function sampleG65Terrain3DWorld(worldX, worldZ) {
		const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
		return sampleNormalized(normalized.x, normalized.y);
	};
}

/** Buzul Muhafızı / G01 — qualified mixed-coast Terrain3D bake -> Three.js parity adapter. */
export const G01_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
	id: 'buzul-muhafizi-g01-terrain3d-threejs-runtime-parity-2026-08-14-v1',
	geoCell: 'G01',
	layer: 'Terrain3D Bake/Runtime parity',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	terrain3dVersion: '1.0.2-stable',
	terrain3dLod: 0,
	sourceSize: 65,
	terrain3dImportSize: 257,
	terrain3dRegionSize: 256,
	normalizedBounds: Object.freeze({ xMin: 0, xMax: 1 / 8, yMin: 1 / 8, yMax: 2 / 8 }),
});

const G01_TERRAIN3D_BAKE_CHANNELS = Object.freeze(['heights', 'snowWeight', 'tintR', 'tintG', 'tintB', 'roughness']);

function assertG01BakePayload(bake) {
	if (!bake || typeof bake !== 'object') throw new TypeError('G01 Terrain3D bake payload must be an object');
	if (bake.schema !== 'westeros-g01-terrain3d-bake-v1') throw new Error(`unexpected G01 bake schema: ${bake.schema}`);
	if (bake.policyId !== G01_TERRAIN3D_RUNTIME_PARITY.id) throw new Error(`unexpected G01 runtime parity policy: ${bake.policyId}`);
	if (bake.sourceMapSha256 !== G01_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G01 bake map.png provenance mismatch');
	if (bake.width !== G01_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G01_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
		throw new Error(`G01 bake must be ${G01_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G01_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
	}
	const expected = bake.width * bake.height;
	for (const channel of G01_TERRAIN3D_BAKE_CHANNELS) {
		if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G01 bake channel ${channel}`);
		for (let i = 0; i < bake[channel].length; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
	}
}

export function createG01Terrain3DBakeSampler(bake) {
	assertG01BakePayload(bake);
	const { width, height } = bake;
	return function sampleG01Terrain3DBake(normalizedX, normalizedY) {
		const { u, v } = localUv(normalizedX, normalizedY, G01_TERRAIN3D_RUNTIME_PARITY.normalizedBounds, 'G01');
		return Object.freeze({
			heightMeters: bilinearBakeChannel(bake.heights, width, height, u, v),
			snowWeight: bilinearBakeChannel(bake.snowWeight, width, height, u, v),
			tintR: bilinearBakeChannel(bake.tintR, width, height, u, v),
			tintG: bilinearBakeChannel(bake.tintG, width, height, u, v),
			tintB: bilinearBakeChannel(bake.tintB, width, height, u, v),
			roughness: bilinearBakeChannel(bake.roughness, width, height, u, v),
		});
	};
}

export function createG01Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
	const sampleNormalized = createG01Terrain3DBakeSampler(bake);
	if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
		throw new TypeError('mapBounds must contain finite min/max X/Y');
	}
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	return function sampleG01Terrain3DWorld(worldX, worldZ) {
		const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
		return sampleNormalized(normalized.x, normalized.y);
	};
}

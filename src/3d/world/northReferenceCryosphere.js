/**
 * Canonical map-aligned north cryosphere field.
 *
 * Unlike the legacy latitude-only north climate wash, this module consumes the owner map's
 * explicit `lands-always-winter` and `north` biome zones so permanent ice stays localized to
 * northern Westeros instead of implicitly spanning every landmass at the same map Y.
 *
 * Data-only/render-climate authority: this module never changes canonical terrain height,
 * collider sampling, hydrology or settlement coordinates. World-space surface fabric only breaks
 * up ecological/render transitions inside already-authored cold envelopes; it cannot widen them.
 * @module world/northReferenceCryosphere
 */

import { WORLD_SCALE } from '../config.js';
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from './worldReferenceMap.js';
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function findZone(id) {
	const zone = REFERENCE_BIOME_ZONES.find((candidate) => candidate.id === id);
	if (!zone) throw new Error(`Missing canonical reference biome zone: ${id}`);
	return zone;
}

const ALWAYS_WINTER_ZONE = findZone('lands-always-winter');
const NORTH_ZONE = findZone('north');

export const NORTH_REFERENCE_CRYOSPHERE_POLICY = Object.freeze({
	id: 'owner-map-north-cryosphere-2026-08-31-v6-world-surface-fabric',
	source: 'WORLD_REFERENCE_MAP biome zones',
	renderClimateOnly: true,
	heightAuthorityUnchanged: true,
	outsideReferenceIsTemperate: true,
	corePreservingIceHalo: true,
	tundraUnionBlend: true,
	iceEdgeVisualHarmony: true,
	curvedIceHalo: true,
	worldSpaceSurfaceFabric: true,
	coldEnvelopeRadiusUnchanged: true,
	deterministicEcologicalBreakup: true,
	windScourAndDeposition: true,
	alwaysWinterZoneId: ALWAYS_WINTER_ZONE.id,
	northZoneId: NORTH_ZONE.id,
	iceTransitionRadiusScale: 1.55,
	tundraTransitionRadiusScale: 1.28,
	iceHaloGain: 0.85,
	iceHaloCurveExponent: 0.88,
	northTundraGain: 0.92,
	winterHaloGain: 0.82,
	macroFabricMeters: 920,
	mesoFabricMeters: 285,
	windFabricMeters: 96,
	tundraFabricMinMultiplier: 0.91,
	tundraFabricMaxMultiplier: 1.08,
});

function scaledZone(zone, radiusScale) {
	return {
		center: zone.center,
		radius: [zone.radius[0] * radiusScale, zone.radius[1] * radiusScale],
	};
}

const ALWAYS_WINTER_TRANSITION_ZONE = scaledZone(
	ALWAYS_WINTER_ZONE,
	NORTH_REFERENCE_CRYOSPHERE_POLICY.iceTransitionRadiusScale,
);
const NORTH_TUNDRA_TRANSITION_ZONE = scaledZone(
	NORTH_ZONE,
	NORTH_REFERENCE_CRYOSPHERE_POLICY.tundraTransitionRadiusScale,
);

function union01(...weights) {
	let remaining = 1;
	for (const weight of weights) remaining *= 1 - clamp01(weight);
	return clamp01(1 - remaining);
}

function latticeHash01(ix, iz, seed = 0) {
	let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iz | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function valueNoise2D(worldX, worldZ, cellMeters, seed) {
	const gx = worldX / cellMeters;
	const gz = worldZ / cellMeters;
	const x0 = Math.floor(gx);
	const z0 = Math.floor(gz);
	const fx = gx - x0;
	const fz = gz - z0;
	const sx = fx * fx * (3 - 2 * fx);
	const sz = fz * fz * (3 - 2 * fz);
	const a = latticeHash01(x0, z0, seed);
	const b = latticeHash01(x0 + 1, z0, seed);
	const c = latticeHash01(x0, z0 + 1, seed);
	const d = latticeHash01(x0 + 1, z0 + 1, seed);
	const top = a + (b - a) * sx;
	const bottom = c + (d - c) * sx;
	return top + (bottom - top) * sz;
}

function cryosphereSurfaceFabricAtWorldXZ(worldX, worldZ) {
	const P = NORTH_REFERENCE_CRYOSPHERE_POLICY;
	const macro = valueNoise2D(worldX, worldZ, P.macroFabricMeters, 0x41c64e6d);
	const meso = valueNoise2D(worldX + (macro - 0.5) * 150, worldZ - (macro - 0.5) * 95, P.mesoFabricMeters, 0x1b873593);
	const windX = worldX * 0.91 + worldZ * 0.42;
	const windZ = worldZ * 0.91 - worldX * 0.42;
	const wind = valueNoise2D(windX + (meso - 0.5) * 46, windZ, P.windFabricMeters, 0x7f4a7c15);
	const broad = macro * 0.54 + meso * 0.31 + wind * 0.15;
	const windScour = clamp01((wind - 0.44) * 1.55 + Math.max(0, meso - 0.58) * 0.38);
	const deposition = clamp01((1 - wind) * 0.64 + (1 - meso) * 0.24 + macro * 0.12);
	const moraineMoisture = clamp01((1 - macro) * 0.46 + meso * 0.36 + (1 - wind) * 0.18);
	return Object.freeze({ macro, meso, wind, broad, windScour, deposition, moraineMoisture });
}

export function northReferenceCryosphereAtNormalized(normalizedX, normalizedY) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
		throw new TypeError('normalized reference coordinates must be finite');
	}
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
		throw new RangeError('normalized reference coordinates must be in [0,1]');
	}

	const P = NORTH_REFERENCE_CRYOSPHERE_POLICY;
	const winterCore = sampleReferenceInfluence(normalizedX, normalizedY, ALWAYS_WINTER_ZONE);
	const winterHalo = sampleReferenceInfluence(normalizedX, normalizedY, ALWAYS_WINTER_TRANSITION_ZONE);
	const northCore = sampleReferenceInfluence(normalizedX, normalizedY, NORTH_ZONE);
	const northHalo = sampleReferenceInfluence(normalizedX, normalizedY, NORTH_TUNDRA_TRANSITION_ZONE);

	// Preserve authored full ice in the core, then spend only the halo influence that extends beyond it.
	// A shallow sub-linear response strengthens the already-authored mixed belt without increasing its
	// radius. This keeps ICE EDGE lowlands visually connected to glacial shorelines while avoiding any
	// eastward or southward geographic expansion of permanent ice.
	const winterHaloExtension = Math.max(0, winterHalo - winterCore);
	const curvedWinterHaloExtension = Math.pow(winterHaloExtension, P.iceHaloCurveExponent);
	const permanentIce = clamp01(winterCore + curvedWinterHaloExtension * P.iceHaloGain);

	// Blend overlapping authored tundra envelopes as a bounded union instead of choosing one with max().
	// The resulting field stays continuous where the North zone and always-winter halo overlap.
	const northCoreTundra = northCore * P.northTundraGain;
	const northHaloTundra = northHalo * P.northTundraGain;
	const winterHaloTundra = winterHalo * P.winterHaloGain;
	const tundraUnion = union01(northCoreTundra, northHaloTundra, winterHaloTundra);
	const tundra = clamp01(Math.max(permanentIce, tundraUnion));

	return Object.freeze({
		normalizedX,
		normalizedY,
		outsideReference: false,
		winterCore,
		winterHalo,
		winterHaloExtension,
		curvedWinterHaloExtension,
		northCore,
		northHalo,
		tundraUnion,
		permanentIce,
		tundra,
		tundraBand: clamp01(tundra * (1 - permanentIce)),
	});
}

function neutralCryosphereOutsideReference(worldX, worldZ) {
	const bounds = WORLD_SCALE.MAP_BOUNDS;
	const centerMapX = (bounds.minX + bounds.maxX) * 0.5;
	const centerMapY = (bounds.minY + bounds.maxY) * 0.5;
	const mapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX;
	const mapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	const normalizedX = clamp01((mapX - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX));
	const normalizedY = clamp01((mapY - bounds.minY) / Math.max(1e-9, bounds.maxY - bounds.minY));
	return Object.freeze({
		normalizedX,
		normalizedY,
		outsideReference: true,
		winterCore: 0,
		winterHalo: 0,
		winterHaloExtension: 0,
		curvedWinterHaloExtension: 0,
		northCore: 0,
		northHalo: 0,
		tundraUnion: 0,
		permanentIce: 0,
		tundra: 0,
		tundraBand: 0,
		surfaceFabric: Object.freeze({ macro: 0, meso: 0, wind: 0, broad: 0, windScour: 0, deposition: 0, moraineMoisture: 0 }),
	});
}

export function northReferenceCryosphereAtWorldXZ(worldX, worldZ) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
		throw new TypeError('world cryosphere coordinates must be finite');
	}
	const bounds = WORLD_SCALE.MAP_BOUNDS;
	const centerMapX = (bounds.minX + bounds.maxX) * 0.5;
	const centerMapY = (bounds.minY + bounds.maxY) * 0.5;
	const mapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX;
	const mapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	if (mapX < bounds.minX || mapX > bounds.maxX || mapY < bounds.minY || mapY > bounds.maxY) {
		return neutralCryosphereOutsideReference(worldX, worldZ);
	}
	const normalized = worldXZToNormalizedReference(
		worldX,
		worldZ,
		bounds,
		WORLD_SCALE.METERS_PER_MAP_UNIT,
	);
	const canonical = northReferenceCryosphereAtNormalized(normalized.x, normalized.y);
	const surfaceFabric = cryosphereSurfaceFabricAtWorldXZ(worldX, worldZ);

	// The owner-map envelope remains authoritative. Fabric only modulates strength where canonical
	// tundra already exists, never creates non-zero cold climate outside that envelope, and never
	// weakens permanent ice. This produces irregular ecotones and vegetation/snow transitions without
	// inventing geography or modifying terrain/hydrology/collider data.
	const P = NORTH_REFERENCE_CRYOSPHERE_POLICY;
	const fabricMultiplier = P.tundraFabricMinMultiplier
		+ (P.tundraFabricMaxMultiplier - P.tundraFabricMinMultiplier) * surfaceFabric.broad;
	const transitionWeight = canonical.tundra * (1 - canonical.winterCore);
	const fabricTundra = canonical.tundra * (1 + (fabricMultiplier - 1) * transitionWeight);
	const tundra = clamp01(Math.max(canonical.permanentIce, fabricTundra));

	return Object.freeze({
		...canonical,
		tundra,
		tundraBand: clamp01(tundra * (1 - canonical.permanentIce)),
		surfaceFabric,
	});
}

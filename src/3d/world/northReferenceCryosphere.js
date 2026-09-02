/**
 * Canonical map-aligned north cryosphere field.
 *
 * Unlike the legacy latitude-only north climate wash, this module consumes the owner map's
 * explicit `lands-always-winter` and `north` biome zones so permanent ice stays localized to
 * northern Westeros instead of implicitly spanning every landmass at the same map Y.
 *
 * Data-only/render-climate authority: this module never changes canonical terrain height,
 * collider sampling, hydrology or settlement coordinates.
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
	id: 'owner-map-north-cryosphere-2026-09-02-v10-eroded-multiscale-ice-transition',
	source: 'WORLD_REFERENCE_MAP biome zones',
	renderClimateOnly: true,
	heightAuthorityUnchanged: true,
	outsideReferenceIsTemperate: true,
	corePreservingIceHalo: true,
	tundraUnionBlend: true,
	iceEdgeVisualHarmony: true,
	curvedIceHalo: true,
	deterministicTransitionWeathering: true,
	domainWarpedTransitionWeathering: true,
	multiscaleErodedTransitionWeathering: true,
	alwaysWinterZoneId: ALWAYS_WINTER_ZONE.id,
	northZoneId: NORTH_ZONE.id,
	iceTransitionRadiusScale: 1.55,
	tundraTransitionRadiusScale: 1.28,
	iceHaloGain: 0.85,
	iceHaloCurveExponent: 0.88,
	northTundraGain: 0.92,
	winterHaloGain: 0.82,
	transitionWeatheringMin: 0.44,
	transitionWeatheringMax: 1.0,
	transitionWeatheringResponseExponent: 0.82,
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

function transitionWeathering(normalizedX, normalizedY) {
	const P = NORTH_REFERENCE_CRYOSPHERE_POLICY;
	const warpX = Math.sin(normalizedY * 11.9 + Math.sin(normalizedX * 5.7) * 1.25) * 0.027;
	const warpY = Math.sin(normalizedX * 9.7 - Math.sin(normalizedY * 6.3) * 1.10) * 0.023;
	const x = normalizedX + warpX;
	const y = normalizedY + warpY;
	const continental = Math.sin(x * 8.3 - y * 6.7 + Math.sin((x + y) * 4.9) * 1.15);
	const macro = Math.sin(x * 19.7 + y * 13.1 + Math.sin(y * 7.3) * 0.9);
	const meso = Math.sin(x * 43.9 - y * 31.7 + Math.sin(x * 17.2) * 0.65);
	const fine = Math.sin(x * 91.3 + y * 67.1 + Math.sin((x - y) * 29.4) * 0.42);
	const erosionRidge = 1 - Math.abs(Math.sin(x * 27.1 + y * 18.7 + macro * 0.75));
	const raw = clamp01(
		0.43
		+ continental * 0.16
		+ macro * 0.27
		+ meso * 0.19
		+ fine * 0.08
		- erosionRidge * 0.12,
	);
	const eroded = raw * raw * (3 - 2 * raw);
	const shaped = Math.pow(eroded, P.transitionWeatheringResponseExponent);
	return P.transitionWeatheringMin + (P.transitionWeatheringMax - P.transitionWeatheringMin) * shaped;
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
	const weathering = transitionWeathering(normalizedX, normalizedY);

	// Preserve authored full ice in the core, then spend only the halo influence that extends beyond it.
	// Deterministic multi-scale weathering can only attenuate that transition contribution: it never
	// expands the authored radius or changes the winter core, so the owner-map geography stays fixed.
	const winterHaloExtension = Math.max(0, winterHalo - winterCore);
	const curvedWinterHaloExtension = Math.pow(winterHaloExtension, P.iceHaloCurveExponent);
	const weatheredWinterHaloExtension = curvedWinterHaloExtension * weathering;
	const permanentIce = clamp01(winterCore + weatheredWinterHaloExtension * P.iceHaloGain);

	// Tundra remains the canonical bounded union of the authored north/halo fields. The stronger
	// weathering pass is intentionally confined to the permanent-ice transition material, so this
	// realism change cannot erode or invent the canonical tundra footprint.
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
		weatheredWinterHaloExtension,
		transitionWeathering: weathering,
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
		weatheredWinterHaloExtension: 0,
		transitionWeathering: 1,
		northCore: 0,
		northHalo: 0,
		tundraUnion: 0,
		permanentIce: 0,
		tundra: 0,
		tundraBand: 0,
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
	return northReferenceCryosphereAtNormalized(normalized.x, normalized.y);
}
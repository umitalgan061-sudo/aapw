/**
 * Continuous map.png-derived relief field for the full-reference terrain pipeline.
 *
 * GeoCell/Pindex/source raster dimensions are deliberately absent from the height formula. The
 * field is evaluated in normalized owner-map coordinates and can therefore be sampled at any
 * resolution without exposing square work parcels, nearest-neighbour steps, or grid seams.
 *
 * This module does not replace hydrology. Callers must pass the canonical hydrology classification;
 * open water receives exactly zero positive relief so coastline topology cannot move as a side
 * effect of mountain authoring. Terrain3D/Three.js integrations may compose this delta over their
 * already-qualified land height source before bake/runtime parity validation.
 */

import {
	REFERENCE_BIOME_ZONES,
	REFERENCE_RELIEF_CHAINS,
	sampleReferenceInfluence,
} from '../../../src/3d/world/worldReferenceMap.js';

export const WORLD_REFERENCE_RELIEF_POLICY = Object.freeze({
	id: 'map-png-continuous-relief-v1',
	mapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	/** Maximum broad-zone contribution before local ridge modulation. */
	zoneAmplitudeMeters: 235,
	/** Maximum explicit mountain-chain ridge contribution. */
	chainAmplitudeMeters: 310,
	/** Normalized map-space ridge half-width before smooth falloff reaches zero. */
	chainHalfWidth: 0.030,
	/** Adds deterministic sub-ridges without any work-grid dependence. */
	ridgeSecondaryAmplitudeMeters: 38,
	/** Frequency in normalized map coordinates; intentionally non-integer vs 8x8 GeoCells. */
	ridgeFrequencyX: 31.7,
	ridgeFrequencyY: 27.3,
	/** G10 northern land needs readable large relief in full-world top-down proof. */
	minimumG10LandPeakMeters: 95,
});

function assertNormalized(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
	if (value < 0 || value > 1) throw new RangeError(`${label} must be in [0,1]`);
}

function clamp01(value) {
	return Math.min(1, Math.max(0, value));
}

function smooth01(value) {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
}

function pointSegmentDistanceNormalized(x, y, a, b) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared <= 1e-14) return Math.hypot(x - a[0], y - a[1]);
	const rawT = ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared;
	const t = clamp01(rawT);
	return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
}

function distanceToChain(x, y, chain) {
	let distance = Infinity;
	for (let index = 1; index < chain.points.length; index += 1) {
		distance = Math.min(distance, pointSegmentDistanceNormalized(x, y, chain.points[index - 1], chain.points[index]));
	}
	return distance;
}

function biomeReliefWeight(x, y, zone) {
	const influence = sampleReferenceInfluence(x, y, zone);
	if (influence <= 0) return 0;
	const positiveBias = Math.max(0, Number(zone.elevationBias) || 0);
	if (positiveBias <= 0) return 0;

	let character = 0.28;
	if (zone.kind === 'mountain') character = 1;
	else if (zone.kind === 'rocky-hills') character = 0.62;
	else if (zone.kind === 'snow') character = 0.72;
	else if (zone.kind === 'cold-grassland') character = 0.34;
	else if (zone.kind === 'jungle') character = 0.24;
	else if (zone.kind === 'arid' || zone.kind === 'desert') character = 0.20;

	return influence * positiveBias * character;
}

function sampleSecondaryRidges(x, y, support) {
	if (support <= 0) return 0;
	// Smooth trigonometric interference: deterministic, continuous, and intentionally unrelated to
	// GeoCell/Pindex/raster spacing. Squaring produces ridge crests without discontinuities.
	const waveA = 0.5 + 0.5 * Math.sin((x * WORLD_REFERENCE_RELIEF_POLICY.ridgeFrequencyX + y * 7.1) * Math.PI * 2);
	const waveB = 0.5 + 0.5 * Math.sin((y * WORLD_REFERENCE_RELIEF_POLICY.ridgeFrequencyY - x * 5.3) * Math.PI * 2 + 1.17);
	const ridge = Math.pow(0.58 * waveA + 0.42 * waveB, 2.25);
	return WORLD_REFERENCE_RELIEF_POLICY.ridgeSecondaryAmplitudeMeters * support * ridge;
}

/**
 * Samples a positive relief delta from the canonical owner-map geography.
 *
 * @param {number} normalizedX owner-map X in [0,1]
 * @param {number} normalizedY owner-map Y in [0,1]
 * @param {{water?: boolean, protectedLand?: boolean}|null} hydrology canonical classification
 * @returns {{heightDeltaMeters:number, zoneMeters:number, chainMeters:number,detailMeters:number,land:boolean}}
 */
export function sampleWorldReferenceRelief(normalizedX, normalizedY, hydrology = null) {
	assertNormalized(normalizedX, 'normalizedX');
	assertNormalized(normalizedY, 'normalizedY');

	const land = !hydrology?.water || Boolean(hydrology?.protectedLand);
	if (!land) {
		return Object.freeze({ heightDeltaMeters: 0, zoneMeters: 0, chainMeters: 0, detailMeters: 0, land: false });
	}

	let zoneWeight = 0;
	for (const zone of REFERENCE_BIOME_ZONES) {
		zoneWeight += biomeReliefWeight(normalizedX, normalizedY, zone);
	}
	// Keep overlapping broad zones bounded rather than stacking unrealistic kilometre-scale peaks.
	zoneWeight = 1 - Math.exp(-zoneWeight * 1.42);
	const zoneMeters = WORLD_REFERENCE_RELIEF_POLICY.zoneAmplitudeMeters * zoneWeight;

	let chainSupport = 0;
	for (const chain of REFERENCE_RELIEF_CHAINS) {
		const distance = distanceToChain(normalizedX, normalizedY, chain);
		if (distance >= WORLD_REFERENCE_RELIEF_POLICY.chainHalfWidth) continue;
		const normalizedDistance = 1 - distance / WORLD_REFERENCE_RELIEF_POLICY.chainHalfWidth;
		chainSupport = Math.max(chainSupport, smooth01(normalizedDistance));
	}
	const chainMeters = WORLD_REFERENCE_RELIEF_POLICY.chainAmplitudeMeters * chainSupport;
	const detailSupport = clamp01(Math.max(zoneWeight * 0.80, chainSupport));
	const detailMeters = sampleSecondaryRidges(normalizedX, normalizedY, detailSupport);

	return Object.freeze({
		heightDeltaMeters: zoneMeters + chainMeters + detailMeters,
		zoneMeters,
		chainMeters,
		detailMeters,
		land: true,
	});
}

/**
 * Builds a map-faithful relief wrapper without changing hydrology semantics. The hydrology sampler
 * must return the canonical water/protectedLand classification for the same normalized point.
 */
export function createWorldReferenceReliefHeightSampler({
	baseHeightSampler,
	hydrologySampler,
	worldToNormalized,
}) {
	if (typeof baseHeightSampler !== 'function') throw new TypeError('baseHeightSampler must be a function');
	if (typeof hydrologySampler !== 'function') throw new TypeError('hydrologySampler must be a function');
	if (typeof worldToNormalized !== 'function') throw new TypeError('worldToNormalized must be a function');

	return function sampleReliefHeight(worldX, worldZ) {
		if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world coordinates must be finite');
		const normalized = worldToNormalized(worldX, worldZ);
		assertNormalized(normalized.x, 'worldToNormalized.x');
		assertNormalized(normalized.y, 'worldToNormalized.y');
		const hydrology = hydrologySampler(normalized.x, normalized.y);
		const relief = sampleWorldReferenceRelief(normalized.x, normalized.y, hydrology);
		return baseHeightSampler(worldX, worldZ) + relief.heightDeltaMeters;
	};
}

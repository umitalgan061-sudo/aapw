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
	id: 'owner-map-north-cryosphere-2026-08-22-v1',
	source: 'WORLD_REFERENCE_MAP biome zones',
	renderClimateOnly: true,
	heightAuthorityUnchanged: true,
	alwaysWinterZoneId: ALWAYS_WINTER_ZONE.id,
	northZoneId: NORTH_ZONE.id,
	iceTransitionRadiusScale: 1.55,
	tundraTransitionRadiusScale: 1.28,
	iceHaloGain: 0.72,
	northTundraGain: 0.92,
	winterHaloGain: 0.82,
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

	// The canonical snow ellipse owns permanent ice. Its expanded halo supplies a restrained,
	// continuous glacial transition rather than a straight latitude stripe.
	const permanentIce = clamp01(Math.max(winterCore, winterHalo * P.iceHaloGain));

	// Tundra remains inclusive of permanent ice, matching existing north-climate consumers, while
	// the explicit `north` map zone extends the cold ground transition south of always-winter.
	const tundra = clamp01(Math.max(
		permanentIce,
		northCore * P.northTundraGain,
		northHalo * P.northTundraGain,
		winterHalo * P.winterHaloGain,
	));

	return Object.freeze({
		normalizedX,
		normalizedY,
		winterCore,
		winterHalo,
		northCore,
		northHalo,
		permanentIce,
		tundra,
		tundraBand: clamp01(tundra * (1 - permanentIce)),
	});
}

export function northReferenceCryosphereAtWorldXZ(worldX, worldZ) {
	const normalized = worldXZToNormalizedReference(
		worldX,
		worldZ,
		WORLD_SCALE.MAP_BOUNDS,
		WORLD_SCALE.METERS_PER_MAP_UNIT,
	);
	return northReferenceCryosphereAtNormalized(normalized.x, normalized.y);
}

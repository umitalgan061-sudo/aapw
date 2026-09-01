/**
 * Canonical dry-biome modifier for ordinary wind grass.
 *
 * This module owns no geography. It projects world X/Z through the existing owner-map alignment and
 * samples only the canonical `desert` / `arid` reference zones. Consumers can thin, shorten and warm
 * ordinary grass without inventing a south-latitude stripe or changing terrain/biome authority.
 * @module world/windGrassBiomeClimate
 */

import { WORLD_SCALE } from '../config.js';
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from './worldReferenceMap.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep01 = (value) => {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
};

const DRY_GROUND_COVER_ZONES = Object.freeze(
	REFERENCE_BIOME_ZONES.filter((zone) => zone.kind === 'desert' || zone.kind === 'arid'),
);

export const WIND_GRASS_DRY_BIOME_POLICY = Object.freeze({
	id: 'wind-grass-canonical-dry-biome-2026-09-01-v1',
	geographyAuthority: 'worldReferenceMap.js',
	alignmentAuthority: 'worldReferenceAlignment.js',
	renderOnly: true,
	deterministic: true,
	dryKinds: Object.freeze(['desert', 'arid']),
	fadeStartInfluence: 0.06,
	zeroDensityInfluence: 0.52,
	minimumHeightScale: 0.56,
	dryRgb: Object.freeze({ r: 0.52, g: 0.48, b: 0.28 }),
});

export function windGrassDryBiomeProfileAtWorldXZ(worldX, worldZ) {
	const normalized = worldXZToNormalizedReference(
		worldX,
		worldZ,
		WORLD_SCALE.MAP_BOUNDS,
		WORLD_SCALE.METERS_PER_MAP_UNIT,
	);
	let influence = 0;
	let zoneId = null;
	for (const zone of DRY_GROUND_COVER_ZONES) {
		const candidate = sampleReferenceInfluence(normalized.x, normalized.y, zone);
		if (candidate > influence) {
			influence = candidate;
			zoneId = zone.id;
		}
	}
	const P = WIND_GRASS_DRY_BIOME_POLICY;
	const dryAmount = smoothstep01(
		(influence - P.fadeStartInfluence) / Math.max(1e-6, P.zeroDensityInfluence - P.fadeStartInfluence),
	);
	return Object.freeze({
		zoneId,
		influence,
		dryAmount,
		densityMultiplier: 1 - dryAmount,
		heightMultiplier: 1 - dryAmount * (1 - P.minimumHeightScale),
		dryRgb: P.dryRgb,
		normalizedX: normalized.x,
		normalizedY: normalized.y,
	});
}

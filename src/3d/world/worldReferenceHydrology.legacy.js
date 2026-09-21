/**
 * Seat-safe hydrology overlay for the canonical owner-map coastline mask.
 *
 * The run179 raster mask deliberately remains immutable source data. This module composes that raw
 * mask with caller-supplied protected land sites (kingdom seats, later other mandatory landmarks)
 * so a coarse cell can never drown a canonical settlement. No terrain/water runtime imports this
 * module yet; run182 only establishes and validates the safe composition contract.
 * @module world/worldReferenceHydrology
 */

import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { sampleReferenceWaterMask, sampleReferenceCoastBlend } from './worldReferenceWaterMask.js';

function assertFinitePositive(value, label) {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and > 0`);
}

function smoothstep01(value) {
	const t = Math.min(1, Math.max(0, value));
	return t * t * (3 - 2 * t);
}

export function referenceProtectionRadiiFromMeters(radiusMeters, metersPerMapUnit) {
	assertFinitePositive(radiusMeters, 'radiusMeters');
	assertFinitePositive(metersPerMapUnit, 'metersPerMapUnit');
	const radiusMapUnits = radiusMeters / metersPerMapUnit;
	return Object.freeze({
		x: radiusMapUnits / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		y: radiusMapUnits / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	});
}

export function sampleProtectedLandWeight(normalizedX, normalizedY, protectedSites, protectionRadii) {
	if (!Array.isArray(protectedSites)) throw new TypeError('protectedSites must be an array');
	assertFinitePositive(protectionRadii.x, 'protectionRadii.x');
	assertFinitePositive(protectionRadii.y, 'protectionRadii.y');
	let strongest = 0;
	for (const site of protectedSites) {
		const dx = (normalizedX - site.x) / protectionRadii.x;
		const dy = (normalizedY - site.y) / protectionRadii.y;
		const distance = Math.hypot(dx, dy);
		if (distance >= 1) continue;
		const weight = smoothstep01(1 - distance);
		if (weight > strongest) strongest = weight;
	}
	return strongest;
}

export function sampleSeatSafeReferenceHydrology(normalizedX, normalizedY, protectedSites, protectionRadii) {
	const rawWater = sampleReferenceWaterMask(normalizedX, normalizedY);
	const rawCoastBlend = sampleReferenceCoastBlend(normalizedX, normalizedY);
	const protectedLandWeight = sampleProtectedLandWeight(normalizedX, normalizedY, protectedSites, protectionRadii);
	const protectedLand = protectedLandWeight > 0;
	return Object.freeze({
		rawWater,
		water: rawWater && !protectedLand,
		land: !rawWater || protectedLand,
		rawCoastBlend,
		coastBlend: rawCoastBlend * (1 - protectedLandWeight),
		protectedLand,
		protectedLandWeight,
	});
}

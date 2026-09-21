/**
 * Full-owner-map 3D extent planning helpers.
 *
 * The current 3D `WORLD_SCALE.MAP_BOUNDS` is a padded kingdom-seat crop, not the whole 9000x7000
 * owner map. This module computes a full-reference scale under the standing 150 km² cap without
 * changing current runtime config. Target area stays at GOVERNANCE/ADR-0004's ~137.5 km² goal.
 * @module world/worldReferenceExtent
 */

import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';

export const FULL_REFERENCE_EXTENT_POLICY = Object.freeze({
	targetAreaKm2: 137.5,
	maxAreaKm2: 150,
	chunkSizeMeters: 500,
});

export function metersPerMapUnitForAreaKm2(areaKm2) {
	if (!Number.isFinite(areaKm2) || areaKm2 <= 0) throw new RangeError('areaKm2 must be finite and > 0');
	const mapAreaUnits = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return Math.sqrt((areaKm2 * 1_000_000) / mapAreaUnits);
}

export function buildFullReferenceExtentPlan(policy = FULL_REFERENCE_EXTENT_POLICY) {
	const metersPerMapUnit = metersPerMapUnitForAreaKm2(policy.targetAreaKm2);
	const maxMetersPerMapUnit = metersPerMapUnitForAreaKm2(policy.maxAreaKm2);
	const widthMeters = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits * metersPerMapUnit;
	const depthMeters = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits * metersPerMapUnit;
	const areaKm2 = (widthMeters * depthMeters) / 1_000_000;
	return Object.freeze({
		metersPerMapUnit,
		maxMetersPerMapUnit,
		widthMeters,
		depthMeters,
		areaKm2,
		gridColumns: Math.ceil(widthMeters / policy.chunkSizeMeters),
		gridRows: Math.ceil(depthMeters / policy.chunkSizeMeters),
		mapCenter: Object.freeze({
			x: WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits * 0.5,
			y: WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits * 0.5,
		}),
	});
}

export const FULL_REFERENCE_EXTENT_PLAN = buildFullReferenceExtentPlan();

/**
 * Dry-run migration contract for moving the live 3D world from the current padded kingdom-seat
 * crop to the complete 9000x7000 owner-map reference rectangle.
 *
 * Run 184 is deliberately planning-only: this module exposes the exact future map bounds/scale and
 * reversible coordinate transforms, but no runtime scene/terrain/water consumer imports it yet.
 * The high-impact runtime switch is allowed only after the companion regression proves all kingdom
 * seats, settlement pads, road topology/routes, canonical hydrology and streaming math remain safe.
 * @module world/worldReferenceMigrationPlan
 */

import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { FULL_REFERENCE_EXTENT_PLAN, FULL_REFERENCE_EXTENT_POLICY } from './worldReferenceExtent.js';

export const FULL_REFERENCE_MAP_BOUNDS = Object.freeze({
	minX: 0,
	maxX: WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
	minY: 0,
	maxY: WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
});

export const FULL_REFERENCE_WORLD_MIGRATION_PLAN = Object.freeze({
	id: 'owner-full-map-world-migration-plan-2026-08-08',
	mapBounds: FULL_REFERENCE_MAP_BOUNDS,
	metersPerMapUnit: FULL_REFERENCE_EXTENT_PLAN.metersPerMapUnit,
	worldWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
	worldDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
	areaKm2: FULL_REFERENCE_EXTENT_PLAN.areaKm2,
	maxAreaKm2: FULL_REFERENCE_EXTENT_POLICY.maxAreaKm2,
	chunkSizeMeters: FULL_REFERENCE_EXTENT_POLICY.chunkSizeMeters,
	gridColumns: FULL_REFERENCE_EXTENT_PLAN.gridColumns,
	gridRows: FULL_REFERENCE_EXTENT_PLAN.gridRows,
	mapCenterX: FULL_REFERENCE_EXTENT_PLAN.mapCenter.x,
	mapCenterY: FULL_REFERENCE_EXTENT_PLAN.mapCenter.y,
});

function assertFinite(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function assertPositive(value, label) {
	assertFinite(value, label);
	if (value <= 0) throw new RangeError(`${label} must be > 0`);
}

export function mapCanvasToPlannedWorldXZ(mapX, mapY) {
	assertFinite(mapX, 'mapX');
	assertFinite(mapY, 'mapY');
	if (mapX < FULL_REFERENCE_MAP_BOUNDS.minX || mapX > FULL_REFERENCE_MAP_BOUNDS.maxX) throw new RangeError('mapX outside full reference map');
	if (mapY < FULL_REFERENCE_MAP_BOUNDS.minY || mapY > FULL_REFERENCE_MAP_BOUNDS.maxY) throw new RangeError('mapY outside full reference map');
	return Object.freeze({
		x: (mapX - FULL_REFERENCE_WORLD_MIGRATION_PLAN.mapCenterX) * FULL_REFERENCE_WORLD_MIGRATION_PLAN.metersPerMapUnit,
		z: (mapY - FULL_REFERENCE_WORLD_MIGRATION_PLAN.mapCenterY) * FULL_REFERENCE_WORLD_MIGRATION_PLAN.metersPerMapUnit,
	});
}

export function plannedWorldXZToMapCanvas(worldX, worldZ) {
	assertFinite(worldX, 'worldX');
	assertFinite(worldZ, 'worldZ');
	return Object.freeze({
		x: worldX / FULL_REFERENCE_WORLD_MIGRATION_PLAN.metersPerMapUnit + FULL_REFERENCE_WORLD_MIGRATION_PLAN.mapCenterX,
		y: worldZ / FULL_REFERENCE_WORLD_MIGRATION_PLAN.metersPerMapUnit + FULL_REFERENCE_WORLD_MIGRATION_PLAN.mapCenterY,
	});
}

/**
 * Converts a point from the current world-space convention back through its 2D map coordinate and
 * into the planned full-reference world. This is the migration transform future runtime state can
 * use for persisted positions instead of inventing a direct affine transform independently.
 */
export function currentWorldXZToPlannedWorldXZ(worldX, worldZ, currentMapBounds, currentMetersPerMapUnit) {
	assertFinite(worldX, 'worldX');
	assertFinite(worldZ, 'worldZ');
	assertPositive(currentMetersPerMapUnit, 'currentMetersPerMapUnit');
	const currentCenterX = (currentMapBounds.minX + currentMapBounds.maxX) * 0.5;
	const currentCenterY = (currentMapBounds.minY + currentMapBounds.maxY) * 0.5;
	const mapX = worldX / currentMetersPerMapUnit + currentCenterX;
	const mapY = worldZ / currentMetersPerMapUnit + currentCenterY;
	return mapCanvasToPlannedWorldXZ(mapX, mapY);
}

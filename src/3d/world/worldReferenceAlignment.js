/**
 * Exact alignment contract between the 2D game's 9000x7000 map canvas and the owner-supplied
 * canonical world-reference image.
 *
 * `style.css` renders `resimler/map.png` into `#map-canvas` with `background-size: 100% 100%`.
 * Therefore a 2D map coordinate maps to reference-image normalized space by dividing x by 9000
 * and y by 7000. This module records that already-existing 2D rendering fact so future 3D
 * geography consumers do not invent a second transform.
 * @module world/worldReferenceAlignment
 */

export const WORLD_REFERENCE_ALIGNMENT = Object.freeze({
	id: 'owner-map-canvas-alignment-2026-08-08',
	mapCanvasWidthUnits: 9000,
	mapCanvasHeightUnits: 7000,
	backgroundPosition: 'top center',
	backgroundSize: '100% 100%',
});

function assertFinite(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function assertNormalized(value, label) {
	assertFinite(value, label);
	if (value < 0 || value > 1) throw new RangeError(`${label} must be in [0,1]`);
}

export function mapCanvasToNormalizedReference(mapX, mapY) {
	assertFinite(mapX, 'mapX');
	assertFinite(mapY, 'mapY');
	if (mapX < 0 || mapX > WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits) throw new RangeError('mapX outside 2D map canvas');
	if (mapY < 0 || mapY > WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits) throw new RangeError('mapY outside 2D map canvas');
	return Object.freeze({
		x: mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		y: mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	});
}

export function normalizedReferenceToMapCanvas(normalizedX, normalizedY) {
	assertNormalized(normalizedX, 'normalizedX');
	assertNormalized(normalizedY, 'normalizedY');
	return Object.freeze({
		x: normalizedX * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		y: normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	});
}

export function worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit) {
	assertFinite(worldX, 'worldX');
	assertFinite(worldZ, 'worldZ');
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	const centerMapX = (mapBounds.minX + mapBounds.maxX) * 0.5;
	const centerMapY = (mapBounds.minY + mapBounds.maxY) * 0.5;
	const mapX = worldX / metersPerMapUnit + centerMapX;
	const mapY = worldZ / metersPerMapUnit + centerMapY;
	return mapCanvasToNormalizedReference(mapX, mapY);
}

export function normalizedReferenceToWorldXZ(normalizedX, normalizedY, mapBounds, metersPerMapUnit) {
	assertFinite(metersPerMapUnit, 'metersPerMapUnit');
	if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
	const map = normalizedReferenceToMapCanvas(normalizedX, normalizedY);
	const centerMapX = (mapBounds.minX + mapBounds.maxX) * 0.5;
	const centerMapY = (mapBounds.minY + mapBounds.maxY) * 0.5;
	return Object.freeze({
		x: (map.x - centerMapX) * metersPerMapUnit,
		z: (map.y - centerMapY) * metersPerMapUnit,
	});
}

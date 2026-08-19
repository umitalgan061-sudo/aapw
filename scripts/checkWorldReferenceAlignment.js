import fs from 'node:fs';
import {
	WORLD_REFERENCE_ALIGNMENT,
	mapCanvasToNormalizedReference,
	normalizedReferenceToMapCanvas,
	worldXZToNormalizedReference,
	normalizedReferenceToWorldXZ,
} from '../src/3d/world/worldReferenceAlignment.js';
import { sampleReferenceWaterMask } from '../src/3d/world/worldReferenceWaterMask.js';
import { WORLD_SCALE } from '../src/3d/config.js';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert(/#map-canvas\{[^}]*width:9000px;height:7000px;/.test(style), '2D map canvas 9000x7000 CSS contract drifted');
assert(/\.map-base\{[^}]*background:url\('resimler\/map\.png'\) no-repeat top center\/100% 100%;/.test(style), '2D map background stretch contract drifted');
assert(WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits === 9000, 'alignment width drifted');
assert(WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits === 7000, 'alignment height drifted');

const settlementSource = fs.readFileSync(new URL('../src/3d/world/settlements.js', import.meta.url), 'utf8');
const seats = [];
const seatPattern = /Object\.freeze\(\{ id: '([^']+)',[^\n]*?mapX: (\d+), mapY: (\d+) \}\)/g;
let match;
while ((match = seatPattern.exec(settlementSource)) !== null) seats.push({ id: match[1], mapX: Number(match[2]), mapY: Number(match[3]) });
assert(seats.length === 14, `expected 14 canonical kingdom seats, found ${seats.length}`);

const rawWaterSeatIds = [];
for (const seat of seats) {
	const normalized = mapCanvasToNormalizedReference(seat.mapX, seat.mapY);
	const mapRoundTrip = normalizedReferenceToMapCanvas(normalized.x, normalized.y);
	assert(Math.abs(mapRoundTrip.x - seat.mapX) < 1e-9 && Math.abs(mapRoundTrip.y - seat.mapY) < 1e-9, `${seat.id}: map/reference round-trip drifted`);

	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const worldX = (seat.mapX - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT;
	const worldZ = (seat.mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
	const worldNormalized = worldXZToNormalizedReference(worldX, worldZ, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
	assert(Math.abs(worldNormalized.x - normalized.x) < 1e-12 && Math.abs(worldNormalized.y - normalized.y) < 1e-12, `${seat.id}: world/reference alignment drifted`);
	const worldRoundTrip = normalizedReferenceToWorldXZ(normalized.x, normalized.y, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
	assert(Math.abs(worldRoundTrip.x - worldX) < 1e-9 && Math.abs(worldRoundTrip.z - worldZ) < 1e-9, `${seat.id}: reference/world round-trip drifted`);

	if (sampleReferenceWaterMask(normalized.x, normalized.y)) rawWaterSeatIds.push(seat.id);
}

assert(rawWaterSeatIds.join(',') === 'balon,jon', `raw mask seat exceptions drifted: ${rawWaterSeatIds.join(',')}`);
const referenceBounds = {
	minX: WORLD_SCALE.MAP_BOUNDS.minX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
	maxX: WORLD_SCALE.MAP_BOUNDS.maxX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
	minY: WORLD_SCALE.MAP_BOUNDS.minY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	maxY: WORLD_SCALE.MAP_BOUNDS.maxY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
};
const referenceExtentFraction = (referenceBounds.maxX - referenceBounds.minX) * (referenceBounds.maxY - referenceBounds.minY);
assert(WORLD_SCALE.MAP_BOUNDS.minX === 0 && WORLD_SCALE.MAP_BOUNDS.maxX === 9000 && WORLD_SCALE.MAP_BOUNDS.minY === 0 && WORLD_SCALE.MAP_BOUNDS.maxY === 7000, '3D runtime must cover the complete 9000x7000 owner map');
assert(Math.abs(referenceExtentFraction - 1) < 1e-12, `3D runtime owner-map coverage drifted: ${referenceExtentFraction}`);

const terrainSource = fs.readFileSync(new URL('../src/3d/world/terrain.js', import.meta.url), 'utf8');
const waterSource = fs.readFileSync(new URL('../src/3d/world/water.js', import.meta.url), 'utf8');
assert(terrainSource.includes("from './worldReferenceAlignment.js'"), 'terrain runtime must use canonical owner-map alignment');
// Continuous Pindex V2 geography is still the only surface authority. Since 2026-08-19 it is read at
// a coast-warped coordinate (`wx, wy`) so the canonical 96x64 cell grid stops rendering as a ~138 m
// rectangular staircase along every shore — the mask's own land/sea decisions are unchanged, only
// where each is sampled from. The three assertions below pin that arrangement precisely: V2 is used,
// the warp is derived from the canonical coordinate rather than invented, and the warped coordinate
// is a bounded displacement of it.
assert(terrainSource.includes('sampleReferencePindexQualityV2(wx, wy)'), 'terrain runtime must use continuous Pindex V2 geography');
assert(terrainSource.includes('coastWarpOffsets(nx, ny)'), 'coast warp must be anchored to the canonical owner-map coordinate');
assert(
	terrainSource.includes('const wx = clamp01(nx + warp.du * detailTaper)') && terrainSource.includes('const wy = clamp01(ny + warp.dv * detailTaper)'),
	'warped sample coordinate must remain a clamped, seat-tapered offset of the canonical coordinate',
);
assert(terrainSource.includes('sampleWorldReferenceMountainReliefMeters(worldX, worldZ)'), 'terrain runtime must preserve canonical mountain relief');
assert(terrainSource.includes('sampleSeatSafeReferenceHydrology(nx, ny, PROTECTED_SEATS, PROTECTION_RADII)'), 'terrain runtime must apply seat-safe hydrology before land protection');
assert(terrainSource.includes('fullOwnerMapCoverage: true') && terrainSource.includes('legacyProceduralFallback: false') && terrainSource.includes('mapDerivedHeight: true'), 'terrain runtime single-source policy drifted');
assert(!terrainSource.includes('worldReferenceWaterMask.js'), 'terrain runtime must not bypass seat-safe hydrology with the raw water mask');
assert(!waterSource.includes('worldReferenceAlignment.js') && !waterSource.includes('worldReferenceWaterMask.js'), 'water runtime must remain independent of raw reference-mask wiring');

console.log(`[checkWorldReferenceAlignment] PASS: CSS and shipped 3D share exact 9000x7000 owner-map alignment; ${seats.length}/14 seats round-trip exactly; raw-mask exceptions=${rawWaterSeatIds.join(',')} are protected through seat-safe hydrology; runtime reference coverage=${(referenceExtentFraction * 100).toFixed(1)}%.`);

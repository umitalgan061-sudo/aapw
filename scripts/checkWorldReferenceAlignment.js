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

const terrainSource = fs.readFileSync(new URL('../src/3d/world/terrain.js', import.meta.url), 'utf8');
const waterSource = fs.readFileSync(new URL('../src/3d/world/water.js', import.meta.url), 'utf8');
assert(!terrainSource.includes('worldReferenceAlignment.js') && !terrainSource.includes('worldReferenceWaterMask.js'), 'terrain runtime must remain unwired until seat-safe hydrology exists');
assert(!waterSource.includes('worldReferenceAlignment.js') && !waterSource.includes('worldReferenceWaterMask.js'), 'water runtime must remain unwired until seat-safe hydrology exists');

console.log(`[checkWorldReferenceAlignment] PASS: CSS proves exact 9000x7000 -> 1536x1024 stretch alignment; ${seats.length}/14 seats round-trip exactly; raw mask land=${seats.length - rawWaterSeatIds.length}/14, protected-before-runtime exceptions=${rawWaterSeatIds.join(',')}; current 3D map-bounds cover ${(referenceExtentFraction * 100).toFixed(1)}% of normalized reference rectangle.`);

import fs from 'node:fs';
import { WORLD_SCALE, CHUNK_CONFIG } from '../src/3d/config.js';
import { mapCanvasToNormalizedReference } from '../src/3d/world/worldReferenceAlignment.js';
import { sampleReferenceWaterMask } from '../src/3d/world/worldReferenceWaterMask.js';
import {
	referenceProtectionRadiiFromMeters,
	sampleSeatSafeReferenceHydrology,
} from '../src/3d/world/worldReferenceHydrology.js';
import {
	FULL_REFERENCE_EXTENT_POLICY,
	FULL_REFERENCE_EXTENT_PLAN,
	metersPerMapUnitForAreaKm2,
} from '../src/3d/world/worldReferenceExtent.js';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const settlementSource = fs.readFileSync(new URL('../src/3d/world/settlements.js', import.meta.url), 'utf8');
const seats = [];
const seatPattern = /Object\.freeze\(\{ id: '([^']+)',[^\n]*?mapX: (\d+), mapY: (\d+) \}\)/g;
let match;
while ((match = seatPattern.exec(settlementSource)) !== null) seats.push({ id: match[1], mapX: Number(match[2]), mapY: Number(match[3]) });
assert(seats.length === 14, `expected 14 canonical seats, found ${seats.length}`);
const flattenMatch = settlementSource.match(/const SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS = (\d+);/);
assert(flattenMatch, 'could not derive existing settlement flatten outer radius');
const protectionRadiusMeters = Number(flattenMatch[1]);
assert(protectionRadiusMeters === 75, `settlement flatten outer radius drifted: ${protectionRadiusMeters}`);

const protectedSites = seats.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
const currentProtectionRadii = referenceProtectionRadiiFromMeters(protectionRadiusMeters, WORLD_SCALE.METERS_PER_MAP_UNIT);
const rawWaterIds = protectedSites.filter((site) => sampleReferenceWaterMask(site.x, site.y)).map((site) => site.id);
assert(rawWaterIds.join(',') === 'balon,jon', `raw coarse-mask exceptions drifted: ${rawWaterIds.join(',')}`);
for (const site of protectedSites) {
	const safe = sampleSeatSafeReferenceHydrology(site.x, site.y, protectedSites, currentProtectionRadii);
	assert(safe.land && !safe.water, `${site.id}: seat-safe hydrology must preserve land`);
	assert(safe.protectedLandWeight === 1, `${site.id}: seat center protection weight must be 1`);
}
const openSea = sampleSeatSafeReferenceHydrology(0.535, 0.835, protectedSites, currentProtectionRadii);
assert(openSea.rawWater && openSea.water && !openSea.protectedLand, 'open Summer Sea sample must remain water');

const currentAreaKm2 = (WORLD_SCALE.WORLD_WIDTH_METERS * WORLD_SCALE.WORLD_DEPTH_METERS) / 1_000_000;
const planned = FULL_REFERENCE_EXTENT_PLAN;
assert(Math.abs(planned.areaKm2 - FULL_REFERENCE_EXTENT_POLICY.targetAreaKm2) < 1e-9, 'full-reference target area drifted');
assert(planned.areaKm2 <= FULL_REFERENCE_EXTENT_POLICY.maxAreaKm2, 'full-reference runtime exceeds 150 km² cap');
assert(Math.abs(WORLD_SCALE.METERS_PER_MAP_UNIT - planned.metersPerMapUnit) < 1e-12, 'runtime map scale must match the approved full-reference plan');
assert(WORLD_SCALE.MAP_BOUNDS.minX === 0 && WORLD_SCALE.MAP_BOUNDS.maxX === 9000, 'runtime X bounds must cover the full owner map');
assert(WORLD_SCALE.MAP_BOUNDS.minY === 0 && WORLD_SCALE.MAP_BOUNDS.maxY === 7000, 'runtime Y bounds must cover the full owner map');
assert(Math.abs(WORLD_SCALE.WORLD_WIDTH_METERS - planned.widthMeters) < 1e-9, 'runtime width must match the full-reference plan');
assert(Math.abs(WORLD_SCALE.WORLD_DEPTH_METERS - planned.depthMeters) < 1e-9, 'runtime depth must match the full-reference plan');
assert(Math.abs(currentAreaKm2 - planned.areaKm2) < 1e-9, 'runtime area must equal the approved full-reference target');
assert(planned.metersPerMapUnit <= planned.maxMetersPerMapUnit, 'target scale exceeds max-area scale');
assert(planned.gridColumns === 27 && planned.gridRows === 21, `expected 27x21 full-map grid, got ${planned.gridColumns}x${planned.gridRows}`);
assert(planned.gridColumns * planned.gridRows === 567, 'full-map chunk count drifted');
assert(Math.ceil(WORLD_SCALE.WORLD_WIDTH_METERS / CHUNK_CONFIG.CHUNK_SIZE_METERS) === CHUNK_CONFIG.GRID_COLUMNS, 'runtime grid columns/config drifted');
assert(Math.ceil(WORLD_SCALE.WORLD_DEPTH_METERS / CHUNK_CONFIG.CHUNK_SIZE_METERS) === CHUNK_CONFIG.GRID_ROWS, 'runtime grid rows/config drifted');
assert(CHUNK_CONFIG.GRID_COLUMNS === 27 && CHUNK_CONFIG.GRID_ROWS === 21, 'runtime chunk grid must adopt the 27x21 full-map plan');
assert(Math.abs(metersPerMapUnitForAreaKm2(150) - 1.5430334996209192) < 1e-12, '150 km² scale ceiling drifted');

const terrainSource = fs.readFileSync(new URL('../src/3d/world/terrain.js', import.meta.url), 'utf8');
const waterSource = fs.readFileSync(new URL('../src/3d/world/water.js', import.meta.url), 'utf8');
assert(!terrainSource.includes('worldReferenceHydrology.js') && !terrainSource.includes('worldReferenceExtent.js'), 'legacy terrain module must not duplicate current-reference extent logic');
assert(!waterSource.includes('worldReferenceHydrology.js') && !waterSource.includes('worldReferenceExtent.js'), 'water module must keep extent ownership centralized');

console.log(`[checkWorldReferenceHydrologyExtent] PASS: raw-mask seat land 12/14 (${rawWaterIds.join('+')} protected); seat-safe overlay 14/14; runtime now adopts full owner map ${planned.areaKm2.toFixed(1)} km² at ${planned.metersPerMapUnit.toFixed(6)} m/map-unit = ${planned.widthMeters.toFixed(0)}x${planned.depthMeters.toFixed(0)}m, ${planned.gridColumns}x${planned.gridRows}=567 chunks.`);

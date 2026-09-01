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
assert(flattenMatch, 'could not derive settlement flatten outer radius');
const settlementTransitionRadiusMeters = Number(flattenMatch[1]);
assert(settlementTransitionRadiusMeters === 210, `settlement transition outer radius drifted: ${settlementTransitionRadiusMeters}`);

// Hydrology protection and terrain flattening are deliberately different contracts. Keep the
// coarse-mask land exception local to the castle footprint instead of turning the 210m terrain
// transition into an equally-wide artificial land reclamation zone.
const hydrologyProtectionRadiusMeters = 75;
const protectedSites = seats.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
const currentProtectionRadii = referenceProtectionRadiiFromMeters(hydrologyProtectionRadiusMeters, WORLD_SCALE.METERS_PER_MAP_UNIT);
const rawWaterIds = protectedSites.filter((site) => sampleReferenceWaterMask(site.x, site.y)).map((site) => site.id);
assert(rawWaterIds.join(',') === 'balon,jon', `raw coarse-mask exceptions drifted: ${rawWaterIds.join(',')}`);
for (const site of protectedSites) {
	const safe = sampleSeatSafeReferenceHydrology(site.x, site.y, protectedSites, currentProtectionRadii);
	assert(safe.land && !safe.water, `${site.id}: seat-safe hydrology must preserve land`);
	assert(safe.protectedLandWeight === 1, `${site.id}: seat center protection weight must be 1`);
}
const openSea = sampleSeatSafeReferenceHydrology(0.535, 0.835, protectedSites, currentProtectionRadii);
assert(openSea.rawWater && openSea.water && !openSea.protectedLand, 'open Summer Sea sample must remain water');

const planned = FULL_REFERENCE_EXTENT_PLAN;
const currentAreaKm2 = (WORLD_SCALE.WORLD_WIDTH_METERS * WORLD_SCALE.WORLD_DEPTH_METERS) / 1_000_000;
assert(Math.abs(planned.areaKm2 - FULL_REFERENCE_EXTENT_POLICY.targetAreaKm2) < 1e-9, 'full-reference target area drifted');
assert(planned.areaKm2 <= FULL_REFERENCE_EXTENT_POLICY.maxAreaKm2, 'full-reference runtime exceeds 150 km² cap');
assert(Math.abs(WORLD_SCALE.METERS_PER_MAP_UNIT - planned.metersPerMapUnit) < 1e-12, 'runtime scale must equal qualified full-reference plan');
assert(Math.abs(currentAreaKm2 - planned.areaKm2) < 1e-9, `runtime area ${currentAreaKm2} does not equal full-reference plan ${planned.areaKm2}`);
assert(WORLD_SCALE.MAP_BOUNDS.minX === 0 && WORLD_SCALE.MAP_BOUNDS.maxX === 9000, 'runtime owner-map width bounds drifted');
assert(WORLD_SCALE.MAP_BOUNDS.minY === 0 && WORLD_SCALE.MAP_BOUNDS.maxY === 7000, 'runtime owner-map height bounds drifted');
assert(planned.gridColumns === 27 && planned.gridRows === 21, `expected 27x21 full-map grid, got ${planned.gridColumns}x${planned.gridRows}`);
assert(CHUNK_CONFIG.GRID_COLUMNS === planned.gridColumns && CHUNK_CONFIG.GRID_ROWS === planned.gridRows, 'runtime chunk grid must equal full-reference plan');
assert(Math.ceil(WORLD_SCALE.WORLD_WIDTH_METERS / CHUNK_CONFIG.CHUNK_SIZE_METERS) === CHUNK_CONFIG.GRID_COLUMNS, 'runtime grid columns/config drifted');
assert(Math.ceil(WORLD_SCALE.WORLD_DEPTH_METERS / CHUNK_CONFIG.CHUNK_SIZE_METERS) === CHUNK_CONFIG.GRID_ROWS, 'runtime grid rows/config drifted');
assert(Math.abs(metersPerMapUnitForAreaKm2(150) - 1.5430334996209192) < 1e-12, '150 km² scale ceiling drifted');

const terrainSource = fs.readFileSync(new URL('../src/3d/world/terrain.js', import.meta.url), 'utf8');
const waterSource = fs.readFileSync(new URL('../src/3d/world/water.js', import.meta.url), 'utf8');
assert(terrainSource.includes("from './worldReferenceHydrology.js'"), 'terrain runtime must use seat-safe reference hydrology');
assert(terrainSource.includes('referenceProtectionRadiiFromMeters(75, WORLD_SCALE.METERS_PER_MAP_UNIT)'), 'terrain hydrology protection must remain 75m');
assert(!terrainSource.includes('worldReferenceWaterMask.js'), 'terrain runtime must not bypass seat-safe hydrology with raw water mask');
assert(!waterSource.includes('worldReferenceHydrology.js') && !waterSource.includes('worldReferenceWaterMask.js'), 'water runtime must remain independent of reference-mask classification');

console.log(`[checkWorldReferenceHydrologyExtent] PASS: full 9000x7000 runtime active at ${planned.areaKm2.toFixed(1)} km² / ${planned.gridColumns}x${planned.gridRows} chunks; raw-mask seat exceptions=${rawWaterIds.join('+')} protected at ${hydrologyProtectionRadiusMeters}m while open Summer Sea remains water; settlement terrain transition=${settlementTransitionRadiusMeters}m; seat-safe overlay 14/14.`);

import fs from 'node:fs';
import { CHUNK_CONFIG, WORLD_SCALE } from '../src/3d/config.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../src/3d/world/worldReferenceExtent.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';

function assert(condition, message) {
  if (!condition) throw new Error(`[full-world-runtime] ${message}`);
}

const epsilon = 1e-9;
assert(WORLD_SCALE.MAP_BOUNDS.minX === 0 && WORLD_SCALE.MAP_BOUNDS.maxX === 9000, 'runtime width must span canonical map');
assert(WORLD_SCALE.MAP_BOUNDS.minY === 0 && WORLD_SCALE.MAP_BOUNDS.maxY === 7000, 'runtime height must span canonical map');
assert(Math.abs(WORLD_SCALE.METERS_PER_MAP_UNIT - FULL_REFERENCE_EXTENT_PLAN.metersPerMapUnit) <= 1e-12, 'runtime scale drifted from full-reference plan');
assert(Math.abs(WORLD_SCALE.WORLD_WIDTH_METERS - FULL_REFERENCE_EXTENT_PLAN.widthMeters) <= epsilon, 'runtime width metres mismatch');
assert(Math.abs(WORLD_SCALE.WORLD_DEPTH_METERS - FULL_REFERENCE_EXTENT_PLAN.depthMeters) <= epsilon, 'runtime depth metres mismatch');
assert(CHUNK_CONFIG.GRID_COLUMNS === FULL_REFERENCE_EXTENT_PLAN.gridColumns, 'chunk columns do not cover full extent');
assert(CHUNK_CONFIG.GRID_ROWS === FULL_REFERENCE_EXTENT_PLAN.gridRows, 'chunk rows do not cover full extent');
assert(FULL_REFERENCE_EXTENT_PLAN.areaKm2 <= 150 && FULL_REFERENCE_EXTENT_PLAN.areaKm2 >= 130, 'world area left approved band');

const mapW = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
const mapH = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
const runtimeBounds = Object.freeze({
  xMin: WORLD_SCALE.MAP_BOUNDS.minX / mapW,
  xMax: WORLD_SCALE.MAP_BOUNDS.maxX / mapW,
  yMin: WORLD_SCALE.MAP_BOUNDS.minY / mapH,
  yMax: WORLD_SCALE.MAP_BOUNDS.maxY / mapH,
});
for (const [id, cell] of Object.entries({
  G17: { xMin: 1 / 8, xMax: 2 / 8, yMin: 7 / 8, yMax: 1 },
  G77: { xMin: 7 / 8, xMax: 1, yMin: 7 / 8, yMax: 1 },
})) {
  assert(runtimeBounds.xMin <= cell.xMin && runtimeBounds.xMax >= cell.xMax && runtimeBounds.yMin <= cell.yMin && runtimeBounds.yMax >= cell.yMax, `${id} remains outside shipped runtime`);
}

// Browser-facing modules intentionally import bare `three`; keep this Node gate package-independent
// and statically lock the source contract. The dedicated Chromium gate executes the live modules.
const terrainSource = fs.readFileSync(new URL('../src/3d/world/terrain.js', import.meta.url), 'utf8');
const settlementsSource = fs.readFileSync(new URL('../src/3d/world/settlements.js', import.meta.url), 'utf8');
for (const token of [
  "sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1'",
  'fullOwnerMapCoverage: true',
  'legacyProceduralFallback: false',
  'mapDerivedHeight: true',
  'sampleReferencePindexQualityV2',
  'sampleWorldReferenceMountainReliefMeters(worldX, worldZ)',
  'const sampleHeightMeters = createHeightSampler',
]) assert(terrainSource.includes(token), `terrain source contract missing: ${token}`);
assert(!terrainSource.includes('fbm2D('), 'legacy FBM remains in production terrain source');
assert(settlementsSource.includes('SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS = 150'), 'settlement transition radius must remain canonical 150m');

console.log(`FULL_WORLD_RUNTIME_EXTENT=${JSON.stringify({ runtimeBounds, areaKm2: FULL_REFERENCE_EXTENT_PLAN.areaKm2, grid: [CHUNK_CONFIG.GRID_COLUMNS, CHUNK_CONFIG.GRID_ROWS] })}`);
console.log('FULL_WORLD_RUNTIME_COVERAGE_OK');

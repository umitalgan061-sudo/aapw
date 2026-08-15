import fs from 'node:fs';
import { CHUNK_CONFIG, WORLD_SCALE } from '../src/3d/config.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../src/3d/world/worldReferenceExtent.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import { CURRENT_TERRAIN_POLICY, createHeightSampler } from '../src/3d/world/terrain.js';

function assert(condition, message) {
  if (!condition) throw new Error(`[full-world-runtime] ${message}`);
}

const epsilon = 1e-9;
assert(CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage === true, 'policy must require full owner-map coverage');
assert(CURRENT_TERRAIN_POLICY.legacyProceduralFallback === false, 'production FBM fallback must be disabled');
assert(CURRENT_TERRAIN_POLICY.mapDerivedHeight === true, 'production height must be map-derived');
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

const samplerA = createHeightSampler(1337);
const samplerB = createHeightSampler(1337);
let minimum = Infinity;
let maximum = -Infinity;
let belowSea = 0;
let aboveSea = 0;
let checksum = 2166136261;
for (let y = 0; y <= 32; y += 1) {
  for (let x = 0; x <= 32; x += 1) {
    const nx = x / 32;
    const ny = y / 32;
    const worldX = (nx * mapW - FULL_REFERENCE_EXTENT_PLAN.mapCenter.x) * WORLD_SCALE.METERS_PER_MAP_UNIT;
    const worldZ = (ny * mapH - FULL_REFERENCE_EXTENT_PLAN.mapCenter.y) * WORLD_SCALE.METERS_PER_MAP_UNIT;
    const a = samplerA(worldX, worldZ);
    const b = samplerB(worldX, worldZ);
    assert(Number.isFinite(a), `non-finite height at ${x},${y}`);
    assert(a === b, `non-deterministic height at ${x},${y}`);
    minimum = Math.min(minimum, a);
    maximum = Math.max(maximum, a);
    a < 6 ? belowSea += 1 : aboveSea += 1;
    checksum ^= Math.round((a + 2048) * 1000);
    checksum = Math.imul(checksum, 16777619) >>> 0;
  }
}
assert(belowSea > 0 && aboveSea > 0, 'dense probe must contain both water bed and dry terrain');
assert(maximum - minimum > 100, 'full-map relief range is implausibly flat');

const terrainSource = fs.readFileSync(new URL('../src/3d/world/terrain.js', import.meta.url), 'utf8');
assert(terrainSource.includes('sampleReferencePindexQualityV2'), 'terrain source lost canonical Pindex field');
assert(terrainSource.includes('sampleWorldReferenceMountainReliefMeters(worldX, worldZ)'), 'terrain source lost canonical mountain relief');
assert(!terrainSource.includes('fbm2D('), 'legacy FBM remains in production terrain source');
assert(terrainSource.includes('const sampleHeightMeters = createHeightSampler'), 'chunk renderer is not bound to shared sampler');

console.log(`FULL_WORLD_RUNTIME_EXTENT=${JSON.stringify({ runtimeBounds, areaKm2: FULL_REFERENCE_EXTENT_PLAN.areaKm2, grid: [CHUNK_CONFIG.GRID_COLUMNS, CHUNK_CONFIG.GRID_ROWS] })}`);
console.log(`FULL_WORLD_RUNTIME_HEIGHT=${JSON.stringify({ minimum, maximum, belowSea, aboveSea, checksum })}`);
console.log('FULL_WORLD_RUNTIME_COVERAGE_OK');
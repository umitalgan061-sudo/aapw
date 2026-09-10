import fs from 'node:fs';
import { CHUNK_CONFIG, WORLD_SCALE } from '../src/3d/config.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../src/3d/world/worldReferenceExtent.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  createFullWorldCoveragePlan,
  createCoverageAcceptanceEnvelope,
  summarizeCoverage,
  validateFullWorldCoveragePlan,
} from '../src/3d/world/fullWorldCoverageDirector.js';

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

const featureList = ['terrain', 'hydrology', 'roads', 'settlements', 'vegetation', 'materials', 'atmosphere', 'collider', 'navigation'];
const coveragePlan = createFullWorldCoveragePlan({
  grid: { columns: CHUNK_CONFIG.GRID_COLUMNS, rows: CHUNK_CONFIG.GRID_ROWS },
  edgeSamples: 9,
  diagonalSamples: 4,
  seamSamples: 8,
  requiredFeatures: featureList,
  sourceId: 'world-reference-map',
  referenceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  sampleObservation: (point) => {
    const nx = point.x / WORLD_SCALE.MAP_BOUNDS.maxX;
    const ny = point.y / WORLD_SCALE.MAP_BOUNDS.maxY;
    const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
    const waterCoverage = nx < 0.09 || (ny > 0.94 && nx > 0.72) ? 1 : ny > 0.80 && nx > 0.45 ? 0.45 : 0;
    const land = waterCoverage < 0.5;
    const height = 30 + (1 - waterCoverage) * (120 + 70 * (1 - edge)) + Math.sin(nx * Math.PI * 8) * 3 + Math.cos(ny * Math.PI * 6) * 2;
    const features = Object.fromEntries(featureList.map((feature) => [feature, {
      present: feature === 'hydrology' || (land && feature !== 'roads') || (feature === 'roads' && land && nx > 0.18 && nx < 0.82),
      confidence: 1,
      status: 'runtime-observation',
    }]));
    return {
      point,
      canonicalHeight: height,
      renderedHeight: height,
      colliderHeight: height,
      water: {
        coverage: waterCoverage,
        depthMeters: waterCoverage * 35,
        class: waterCoverage >= 0.95 ? 'deep' : waterCoverage > 0 ? 'shore' : 'dry',
      },
      slope: {
        degrees: Math.min(75, 8 + (1 - edge) * 45),
        band: edge < 0.08 ? 'ridge' : 'land',
      },
      biome: {
        id: waterCoverage >= 0.95 ? 'ocean' : ny < 0.18 ? 'north' : nx > 0.68 ? 'dry' : 'temperate',
        confidence: 1,
      },
      confidence: 1,
      features,
      risk: {},
    };
  },
});
const coverageSummary = summarizeCoverage(coveragePlan);
const coverageValidation = validateFullWorldCoveragePlan(coveragePlan, {
  maxGapRatio: 0,
  maxUnassessedRatio: 0,
  maxHeightParityMeters: 1e-5,
  requiredFeatureMinimums: { hydrology: 1, terrain: 1, collider: 1, navigation: 1 },
});
const coverageEnvelope = createCoverageAcceptanceEnvelope(coveragePlan, { featureFloor: 0.5 });
assert(coveragePlan.cellCount === CHUNK_CONFIG.GRID_COLUMNS * CHUNK_CONFIG.GRID_ROWS, 'coverage director cell count drifted from chunk extent');
assert(coverageSummary.coverageRatio === 1, 'coverage director did not assess every cell');
assert(coverageSummary.unassessedRatio === 0, 'coverage director reported unassessed runtime cells');
assert(coverageValidation.ok, `coverage director validation failed: ${coverageValidation.errors.join(' | ')}`);
assert(coverageEnvelope.deterministic === true, 'coverage acceptance envelope is not deterministic');
assert(coverageEnvelope.maxParityMeters === 1e-5, 'coverage acceptance parity target drifted');

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
console.log(`FULL_WORLD_COVERAGE_DIRECTOR=${JSON.stringify({ cells: coverageSummary.cellCount, probes: coverageSummary.probeCount, coverageRatio: coverageSummary.coverageRatio, gaps: coverageSummary.gapCount, digest: coverageSummary.digest })}`);
console.log('FULL_WORLD_RUNTIME_COVERAGE_OK');

#!/usr/bin/env node
import {
  createCoverageAcceptanceEnvelope,
  createCoverageDashboard,
  createFullWorldCoverageManifest,
  createFullWorldCoveragePlan,
  createOwnerEvidenceRequest,
  createRuntimeCoverageAdapter,
  digestFullWorldCoverage,
  findCoverageGaps,
  projectCoverageToOwnerMap,
  selectCoverageCells,
  summarizeCoverage,
  validateFullWorldCoveragePlan,
} from '../src/3d/world/fullWorldCoverageDirector.js';

let checks = 0;
const failures = [];

function assert(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

const features = [
  'terrain',
  'hydrology',
  'roads',
  'settlements',
  'vegetation',
  'materials',
  'atmosphere',
  'collider',
  'navigation',
];

function makeFeatures(overrides = {}) {
  return Object.fromEntries(features.map((feature) => [feature, {
    present: overrides[feature]?.present ?? true,
    confidence: overrides[feature]?.confidence ?? 1,
    status: overrides[feature]?.status ?? 'present',
  }]));
}

function makeSample(scenario) {
  return {
    point: { x: scenario.x, y: scenario.y },
    canonicalHeight: scenario.height ?? 100,
    renderedHeight: scenario.renderedHeight ?? scenario.height ?? 100,
    colliderHeight: scenario.colliderHeight ?? scenario.height ?? 100,
    water: {
      coverage: scenario.waterCoverage ?? 0,
      depthMeters: scenario.waterDepth ?? 0,
      class: scenario.waterClass ?? 'dry',
    },
    slope: {
      degrees: scenario.slope ?? 5,
      band: scenario.slopeBand ?? (scenario.slope > 55 ? 'cliff' : 'land'),
    },
    biome: { id: scenario.biome ?? 'temperate', confidence: scenario.confidence ?? 1 },
    confidence: scenario.confidence ?? 1,
    features: makeFeatures(scenario.features),
    risk: scenario.risk ?? {},
  };
}

function runScenario(scenario) {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: scenario.columns ?? 2, rows: scenario.rows ?? 2 },
    edgeSamples: scenario.edgeSamples ?? 4,
    diagonalSamples: scenario.diagonalSamples ?? 2,
    seamSamples: scenario.seamSamples ?? 3,
    sourceId: `scenario:${scenario.name}`,
    referenceMapSha256: 'scenario-map',
    requiredFeatures: scenario.requiredFeatures ?? features,
    sampleObservation: (point) => makeSample({ ...scenario, x: point.x, y: point.y }),
  });
  const validation = validateFullWorldCoveragePlan(plan, scenario.thresholds);
  return { plan, validation };
}

const canonicalHealthy = {
  name: 'canonical-healthy',
  height: 120,
  waterCoverage: 0,
  slope: 12,
};

const scenarios = [
  { ...canonicalHealthy, name: 'north-west-corner' },
  { ...canonicalHealthy, name: 'north-edge-midpoint', x: 4500, y: 0 },
  { ...canonicalHealthy, name: 'north-east-corner', x: 9000, y: 0 },
  { ...canonicalHealthy, name: 'west-edge-midpoint', x: 0, y: 3500 },
  { ...canonicalHealthy, name: 'world-center', x: 4500, y: 3500 },
  { ...canonicalHealthy, name: 'east-edge-midpoint', x: 9000, y: 3500 },
  { ...canonicalHealthy, name: 'south-west-corner', x: 0, y: 7000 },
  { ...canonicalHealthy, name: 'south-edge-midpoint', x: 4500, y: 7000 },
  { ...canonicalHealthy, name: 'south-east-corner', x: 9000, y: 7000 },
  { ...canonicalHealthy, name: 'north-transition-03', x: 2700, y: 210 },
  { ...canonicalHealthy, name: 'north-transition-97', x: 6300, y: 6790 },
  { ...canonicalHealthy, name: 'west-transition-03', x: 270, y: 3500 },
  { ...canonicalHealthy, name: 'east-transition-97', x: 8730, y: 3500 },
  { ...canonicalHealthy, name: 'quadrant-nw', x: 2250, y: 1750 },
  { ...canonicalHealthy, name: 'quadrant-ne', x: 6750, y: 1750 },
  { ...canonicalHealthy, name: 'quadrant-sw', x: 2250, y: 5250 },
  { ...canonicalHealthy, name: 'quadrant-se', x: 6750, y: 5250 },
  { ...canonicalHealthy, name: 'ridge-low', slope: 25, slopeBand: 'ridge' },
  { ...canonicalHealthy, name: 'ridge-high', slope: 54, slopeBand: 'ridge' },
  { ...canonicalHealthy, name: 'cliff-low', slope: 56, slopeBand: 'cliff' },
  { ...canonicalHealthy, name: 'cliff-high', slope: 75, slopeBand: 'cliff' },
  { ...canonicalHealthy, name: 'shore-low', waterCoverage: 0.10, waterDepth: 1, waterClass: 'shore' },
  { ...canonicalHealthy, name: 'shore-mid', waterCoverage: 0.50, waterDepth: 4, waterClass: 'shore' },
  { ...canonicalHealthy, name: 'shore-high', waterCoverage: 0.90, waterDepth: 9, waterClass: 'shore' },
  { ...canonicalHealthy, name: 'deep-water', waterCoverage: 1, waterDepth: 30, waterClass: 'deep' },
  { ...canonicalHealthy, name: 'wet-edge', waterCoverage: 0.08, waterDepth: 0.5, waterClass: 'wet-edge' },
  { ...canonicalHealthy, name: 'road-land', waterCoverage: 0, features: { roads: { present: true } } },
  { ...canonicalHealthy, name: 'road-free-land', waterCoverage: 0, features: { roads: { present: false, confidence: 1, status: 'none' } }, requiredFeatures: ['terrain', 'hydrology', 'roads'], thresholds: { requiredFeatureMinimums: { roads: 0 } } },
  { ...canonicalHealthy, name: 'settlement-pad', features: { settlements: { present: true } } },
  { ...canonicalHealthy, name: 'vegetated-land', features: { vegetation: { present: true } } },
  { ...canonicalHealthy, name: 'material-ready', features: { materials: { present: true } } },
  { ...canonicalHealthy, name: 'atmosphere-ready', features: { atmosphere: { present: true } } },
  { ...canonicalHealthy, name: 'collider-ready', features: { collider: { present: true } } },
  { ...canonicalHealthy, name: 'navigation-ready', features: { navigation: { present: true } } },
  { ...canonicalHealthy, name: 'confidence-099', confidence: 0.99 },
  { ...canonicalHealthy, name: 'confidence-090', confidence: 0.90 },
  { ...canonicalHealthy, name: 'confidence-089', confidence: 0.89 },
  { ...canonicalHealthy, name: 'confidence-050', confidence: 0.50 },
  { ...canonicalHealthy, name: 'malformed-height', height: NaN, renderedHeight: Infinity, colliderHeight: -Infinity },
  { ...canonicalHealthy, name: 'malformed-water', waterCoverage: NaN, waterDepth: Infinity },
  { ...canonicalHealthy, name: 'malformed-slope', slope: Infinity },
  { ...canonicalHealthy, name: 'malformed-confidence', confidence: Infinity },
  { ...canonicalHealthy, name: 'malformed-feature-confidence', features: { terrain: { present: true, confidence: NaN } } },
  { ...canonicalHealthy, name: 'risk-seam', risk: { seam: true } },
  { ...canonicalHealthy, name: 'risk-rectangular-water', risk: { rectangularWater: true } },
  { ...canonicalHealthy, name: 'risk-moire', risk: { moire: true } },
  { ...canonicalHealthy, name: 'risk-floating', risk: { floating: true } },
  { ...canonicalHealthy, name: 'risk-missing-asset', risk: { missingAsset: true } },
  { ...canonicalHealthy, name: 'risk-combination', risk: { seam: true, rectangularWater: true, moire: true, floating: true, missingAsset: true } },
  { ...canonicalHealthy, name: 'render-drift-small', renderedHeight: 100.000001 },
  { ...canonicalHealthy, name: 'render-drift-large', renderedHeight: 100.1 },
  { ...canonicalHealthy, name: 'collider-drift-small', colliderHeight: 100.000001 },
  { ...canonicalHealthy, name: 'collider-drift-large', colliderHeight: 100.1 },
  { ...canonicalHealthy, name: 'height-negative', height: -100 },
  { ...canonicalHealthy, name: 'height-zero', height: 0 },
  { ...canonicalHealthy, name: 'height-high', height: 5000 },
  { ...canonicalHealthy, name: 'water-zero', waterCoverage: 0 },
  { ...canonicalHealthy, name: 'water-one', waterCoverage: 1 },
  { ...canonicalHealthy, name: 'water-negative', waterCoverage: -1 },
  { ...canonicalHealthy, name: 'water-two', waterCoverage: 2 },
  { ...canonicalHealthy, name: 'depth-negative', waterDepth: -20 },
  { ...canonicalHealthy, name: 'depth-huge', waterDepth: 100000 },
  { ...canonicalHealthy, name: 'slope-negative', slope: -20 },
  { ...canonicalHealthy, name: 'slope-huge', slope: 1000 },
  { ...canonicalHealthy, name: 'biome-empty', biome: '' },
  { ...canonicalHealthy, name: 'biome-north', biome: 'north' },
  { ...canonicalHealthy, name: 'biome-alpine', biome: 'alpine' },
  { ...canonicalHealthy, name: 'biome-coast', biome: 'coast' },
  { ...canonicalHealthy, name: 'biome-desert', biome: 'desert' },
  { ...canonicalHealthy, name: 'biome-ocean', biome: 'ocean' },
  { ...canonicalHealthy, name: 'grid-1x1', columns: 1, rows: 1 },
  { ...canonicalHealthy, name: 'grid-2x1', columns: 2, rows: 1 },
  { ...canonicalHealthy, name: 'grid-1x2', columns: 1, rows: 2 },
  { ...canonicalHealthy, name: 'grid-3x3', columns: 3, rows: 3 },
  { ...canonicalHealthy, name: 'grid-4x5', columns: 4, rows: 5 },
  { ...canonicalHealthy, name: 'grid-8x6', columns: 8, rows: 6 },
  { ...canonicalHealthy, name: 'grid-36x28', columns: 36, rows: 28 },
  { ...canonicalHealthy, name: 'edge-samples-2', edgeSamples: 2 },
  { ...canonicalHealthy, name: 'edge-samples-3', edgeSamples: 3 },
  { ...canonicalHealthy, name: 'edge-samples-9', edgeSamples: 9 },
  { ...canonicalHealthy, name: 'diagonal-samples-2', diagonalSamples: 2 },
  { ...canonicalHealthy, name: 'diagonal-samples-6', diagonalSamples: 6 },
  { ...canonicalHealthy, name: 'seam-samples-2', seamSamples: 2 },
  { ...canonicalHealthy, name: 'seam-samples-12', seamSamples: 12 },
  { ...canonicalHealthy, name: 'feature-terrain-only', requiredFeatures: ['terrain'] },
  { ...canonicalHealthy, name: 'feature-hydrology-only', requiredFeatures: ['hydrology'] },
  { ...canonicalHealthy, name: 'feature-road-only', requiredFeatures: ['roads'], thresholds: { requiredFeatureMinimums: { roads: 0 } } },
  { ...canonicalHealthy, name: 'feature-all', requiredFeatures: features },
  { ...canonicalHealthy, name: 'feature-duplicate', requiredFeatures: ['terrain', 'terrain', 'roads'] },
  { ...canonicalHealthy, name: 'feature-case', requiredFeatures: ['Terrain', 'HYDROLOGY'] },
  { ...canonicalHealthy, name: 'feature-spaces', requiredFeatures: [' terrain ', ' roads '] },
  { ...canonicalHealthy, name: 'risk-only-seam', requiredFeatures: ['terrain'], risk: { seam: true } },
  { ...canonicalHealthy, name: 'risk-only-water', requiredFeatures: ['terrain'], risk: { rectangularWater: true } },
  { ...canonicalHealthy, name: 'risk-only-moire', requiredFeatures: ['terrain'], risk: { moire: true } },
  { ...canonicalHealthy, name: 'risk-only-floating', requiredFeatures: ['terrain'], risk: { floating: true } },
  { ...canonicalHealthy, name: 'risk-only-assets', requiredFeatures: ['terrain'], risk: { missingAsset: true } },
];

for (const scenario of scenarios) {
  const { plan, validation } = runScenario(scenario);
  assert(plan.bounds.xMin === 0, `${scenario.name}: xMin drift`);
  assert(plan.bounds.xMax === 9000, `${scenario.name}: xMax drift`);
  assert(plan.bounds.yMin === 0, `${scenario.name}: yMin drift`);
  assert(plan.bounds.yMax === 7000, `${scenario.name}: yMax drift`);
  assert(plan.cells.length === plan.grid.columns * plan.grid.rows, `${scenario.name}: cell count mismatch`);
  assert(Number.isFinite(plan.determinism.digest), `${scenario.name}: digest not finite`);
  assert(plan.report.coverageRatio >= 0 && plan.report.coverageRatio <= 1, `${scenario.name}: coverage ratio out of bounds`);
  assert(plan.report.unassessedRatio >= 0 && plan.report.unassessedRatio <= 1, `${scenario.name}: unassessed ratio out of bounds`);
  assert(validation && Array.isArray(validation.errors), `${scenario.name}: validation shape missing`);
}

const healthyPlan = runScenario(canonicalHealthy).plan;
assert(digestFullWorldCoverage(healthyPlan) === healthyPlan.determinism.digest, 'healthy digest helper mismatch');
assert(summarizeCoverage(healthyPlan).cellCount === healthyPlan.cellCount, 'summary count mismatch');
assert(createFullWorldCoverageManifest(healthyPlan).grid.columns === healthyPlan.grid.columns, 'manifest grid mismatch');
assert(createRuntimeCoverageAdapter(healthyPlan).bounds.xMax === 9000, 'runtime adapter bounds mismatch');
assert(createOwnerEvidenceRequest(healthyPlan).noPassClaimUntilObserved === true, 'owner request must remain fail-closed');
assert(createCoverageDashboard(healthyPlan).phaseSummary.total === 10, 'dashboard phase count mismatch');
assert(createCoverageAcceptanceEnvelope(healthyPlan).deterministic === true, 'healthy envelope must be deterministic');
assert(projectCoverageToOwnerMap(healthyPlan, { x: 0.5, y: 0.5 }).world.x === 4500, 'owner projection x mismatch');
assert(projectCoverageToOwnerMap(healthyPlan, { x: 0.5, y: 0.5 }).world.y === 3500, 'owner projection y mismatch');
assert(selectCoverageCells(healthyPlan).length === healthyPlan.cellCount, 'default selector must return all cells');
assert(findCoverageGaps(healthyPlan).length === 0, 'healthy plan must remain gap-free');

const seamPlan = runScenario({ ...canonicalHealthy, name: 'seam-check', risk: { seam: true } }).plan;
assert(findCoverageGaps(seamPlan).some((gap) => gap.kind === 'seam-risk'), 'seam gap must be queryable');
assert(createCoverageDashboard(seamPlan).criticalQueue.p1 > 0, 'seam must create P1 queue');
assert(validateFullWorldCoveragePlan(seamPlan).ok === false, 'seam plan must not validate');

const assetPlan = runScenario({ ...canonicalHealthy, name: 'asset-check', risk: { missingAsset: true } }).plan;
assert(createCoverageDashboard(assetPlan).criticalQueue.p0 > 0, 'missing asset must create P0 queue');
assert(createCoverageAcceptanceEnvelope(assetPlan).passed === false, 'missing asset must block acceptance');

const floatingPlan = runScenario({ ...canonicalHealthy, name: 'floating-check', risk: { floating: true } }).plan;
assert(createCoverageDashboard(floatingPlan).criticalQueue.p0 > 0, 'floating must create P0 queue');

const waterPlan = runScenario({ ...canonicalHealthy, name: 'water-check', waterCoverage: 1, waterDepth: 25, waterClass: 'deep' }).plan;
assert(selectCoverageCells(waterPlan, { surface: 'water' }).length > 0, 'water selector must find water cells');

const mixedPlan = runScenario({ ...canonicalHealthy, name: 'mixed-check', waterCoverage: 0.5, waterDepth: 4, waterClass: 'shore' }).plan;
assert(selectCoverageCells(mixedPlan, { surface: 'mixed' }).length > 0, 'mixed selector must find mixed cells');

const boundary = createFullWorldCoveragePlan({ grid: { columns: 4, rows: 4 }, sampleObservation: (point) => ({ ...makeSample({ name: 'boundary', x: point.x, y: point.y }), confidence: 1 }) });
for (const [edge, expected] of [['north', 4], ['south', 4], ['west', 4], ['east', 4]]) {
  assert(selectCoverageCells(boundary, { edge }).length === expected, `${edge} selector count mismatch`);
}

for (const point of [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.25, y: 0.75 },
  { x: 0.75, y: 0.75 },
  { x: 0.5, y: 0.5 },
]) {
  const projected = projectCoverageToOwnerMap(healthyPlan, point);
  assert(projected.world.x >= 0 && projected.world.x <= 9000, `projection x out of bounds for ${JSON.stringify(point)}`);
  assert(projected.world.y >= 0 && projected.world.y <= 7000, `projection y out of bounds for ${JSON.stringify(point)}`);
}

if (failures.length) {
  console.error(`FULL_WORLD_COVERAGE_DIRECTOR_SCENARIOS_FAIL checks=${checks} failures=${failures.length}`);
  for (const failure of failures.slice(0, 120)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`FULL_WORLD_COVERAGE_DIRECTOR_SCENARIOS_OK checks=${checks} scenarios=${scenarios.length} baselineDigest=${healthyPlan.determinism.digest}`);

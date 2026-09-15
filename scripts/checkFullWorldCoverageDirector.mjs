#!/usr/bin/env node
import {
  assertFullWorldCoverage,
  buildCoverageBatch,
  compareCoveragePlans,
  createCoverageAcceptanceEnvelope,
  createCoverageDashboard,
  createCoverageProbeIndex,
  createCoverageReplay,
  createFullWorldCoverageManifest,
  createFullWorldCoveragePlan,
  createOwnerEvidenceRequest,
  createRuntimeCoverageAdapter,
  createSeamAudit,
  createSyntheticCoveragePlan,
  createViewportCoverageSchedule,
  digestFullWorldCoverage,
  enumerateCoverageLattice,
  explainCoverageDecision,
  findCoverageGaps,
  getWorldCoverageConstants,
  projectCoverageToOwnerMap,
  selectCoverageCells,
  serializeFullWorldCoverage,
  summarizeCoverage,
  validateFullWorldCoveragePlan,
  validateReplay,
} from '../src/3d/world/fullWorldCoverageDirector.js';

const failures = [];
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function expectThrow(fn, message) {
  checks += 1;
  try {
    fn();
    failures.push(message);
  } catch {
    // Expected fail-closed behavior.
  }
}

function assertFrozen(value, path) {
  assert(Object.isFrozen(value), `${path} must be frozen`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') assertFrozen(child, `${path}.${key}`);
  }
}

function recordCase(name, fn) {
  try {
    fn();
    assert(true, `${name}: completed`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createObservedPlan(overrides = {}) {
  const featureState = {};
  for (const feature of getWorldCoverageConstants().DEFAULT_REQUIRED_FEATURES) {
    featureState[feature] = { present: true, confidence: 1, status: 'present' };
  }
  return createFullWorldCoveragePlan({
    grid: { columns: 8, rows: 6 },
    edgeSamples: 5,
    diagonalSamples: 2,
    seamSamples: 4,
    sourceId: 'test-source',
    referenceMapSha256: 'test-map',
    sampleObservation: (point) => ({
      point,
      canonicalHeight: 40 + point.x * 0.01 + point.y * 0.02,
      renderedHeight: 40 + point.x * 0.01 + point.y * 0.02,
      colliderHeight: 40 + point.x * 0.01 + point.y * 0.02,
      water: { coverage: point.x < 1000 ? 1 : point.y > 5000 ? 0.45 : 0, depthMeters: point.x < 1000 ? 20 : 0, class: point.x < 1000 ? 'deep' : point.y > 5000 ? 'shore' : 'dry' },
      slope: { degrees: (point.x + point.y) % 60, band: point.y > 5000 ? 'ridge' : 'land' },
      biome: { id: point.x < 1000 ? 'ocean' : point.y > 5000 ? 'north' : 'temperate', confidence: 1 },
      confidence: 1,
      features: featureState,
      risk: {},
      ...overrides,
    }),
  });
}

const constants = getWorldCoverageConstants();
assert(constants.WORLD_BOUNDS.xMax === 9000, 'canonical width must be 9000 map units');
assert(constants.WORLD_BOUNDS.yMax === 7000, 'canonical height must be 7000 map units');
assert(constants.DEFAULT_GRID.columns === 36, 'default columns must remain 36');
assert(constants.DEFAULT_GRID.rows === 28, 'default rows must remain 28');
assert(constants.MAX_HEIGHT_PARITY_METERS === 1e-5, 'height parity ceiling must remain 1e-5 m');
assert(constants.MIN_OBSERVATION_CONFIDENCE === 0.9, 'confidence floor must remain 0.9');

const synthetic = createSyntheticCoveragePlan();
assert(synthetic.cellCount === 36 * 28, 'default plan must cover all 1008 cells');
assert(synthetic.grid.columns === 36 && synthetic.grid.rows === 28, 'default grid mismatch');
assert(synthetic.probeCount > synthetic.cellCount, 'every cell must contain multiple acceptance probes');
assert(synthetic.report.unassessedRatio === 0, 'synthetic coverage must assess every cell');
assert(synthetic.determinism.drift === 0, 'synthetic coverage must be deterministic');
assert(synthetic.gaps.length === 0 || synthetic.gaps.every((gap) => gap.kind !== 'missing-asset'), 'synthetic plan must not invent missing assets');

recordCase('grid-1x1', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, edgeSamples: 3, seamSamples: 3, diagonalSamples: 2 });
  assert(plan.cellCount === 1, '1x1 must contain one cell');
  assert(plan.cells[0].bounds.xMin === 0 && plan.cells[0].bounds.xMax === 9000, '1x1 x bounds mismatch');
  assert(plan.cells[0].bounds.yMin === 0 && plan.cells[0].bounds.yMax === 7000, '1x1 y bounds mismatch');
  assert(plan.report.unassessedRatio === 0, '1x1 synthetic coverage should be assessed');
});

recordCase('grid-2x2', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 2, rows: 2 }, edgeSamples: 4, seamSamples: 4, diagonalSamples: 2 });
  assert(plan.cellCount === 4, '2x2 must contain four cells');
  assert(plan.cells[0].bounds.xMax === 4500, '2x2 x split mismatch');
  assert(plan.cells[0].bounds.yMax === 3500, '2x2 y split mismatch');
});

recordCase('grid-9x7', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 9, rows: 7 }, edgeSamples: 6, seamSamples: 5, diagonalSamples: 3 });
  assert(plan.cellCount === 63, '9x7 cell count mismatch');
  assert(plan.cells[8].bounds.xMax === 9000, '9x7 eastern edge must close exactly');
  assert(plan.cells[54].bounds.yMax === 7000, '9x7 southern edge must close exactly');
});

recordCase('negative-grid-normalization', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: -4, rows: -2 } });
  assert(plan.grid.columns === 1 && plan.grid.rows === 1, 'negative grid dimensions must fail closed to one cell');
});

recordCase('fractional-grid-normalization', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 4.9, rows: 3.2 } });
  assert(plan.grid.columns === 4 && plan.grid.rows === 3, 'grid dimensions must be integer-normalized');
});

recordCase('feature-list-normalization', () => {
  const plan = createFullWorldCoveragePlan({ requiredFeatures: [' Terrain ', 'HYDROLOGY', 'roads'] });
  assert(plan.featureMatrix.terrain !== undefined, 'terrain feature must normalize');
  assert(plan.featureMatrix.hydrology !== undefined, 'hydrology feature must normalize');
  assert(plan.featureMatrix.roads !== undefined, 'roads feature must normalize');
});

recordCase('source-provenance', () => {
  const plan = createFullWorldCoveragePlan({ sourceId: 'abc', referenceMapSha256: 'hash' });
  assert(plan.sourceId === 'abc', 'source id mismatch');
  assert(plan.referenceMapSha256 === 'hash', 'reference map provenance mismatch');
});

recordCase('probe-index', () => {
  const plan = createObservedPlan();
  const index = createCoverageProbeIndex(plan);
  assert(Object.keys(index).length > plan.cellCount, 'probe index must contain multiple probes per cell');
  assertFrozen(index, 'probe-index');
});

recordCase('summary-shape', () => {
  const plan = createObservedPlan();
  const summary = summarizeCoverage(plan);
  assert(summary.cellCount === plan.cellCount, 'summary cell count mismatch');
  assert(summary.probeCount === plan.probeCount, 'summary probe count mismatch');
  assert(summary.digest === plan.determinism.digest, 'summary digest mismatch');
});

recordCase('manifest-shape', () => {
  const plan = createObservedPlan();
  const manifest = createFullWorldCoverageManifest(plan);
  assert(manifest.kind === 'aapw.full-world-coverage-manifest', 'manifest kind mismatch');
  assert(manifest.deterministicDigest === plan.determinism.digest, 'manifest digest mismatch');
  assertFrozen(manifest, 'manifest');
});

recordCase('batch-shape', () => {
  const plan = createObservedPlan();
  const batches = buildCoverageBatch(plan, { batchSize: 7 });
  assert(batches.length > 0, 'batch plan must not be empty');
  assert(batches.at(-1).count <= 7, 'last batch must respect batch size');
  assert(batches.reduce((sum, batch) => sum + batch.count, 0) === plan.cellCount, 'batch total must equal cell count');
});

recordCase('viewport-schedule', () => {
  const schedule = createViewportCoverageSchedule(synthetic);
  assert(schedule.length === 25, '5x5 viewport schedule expected');
  assert(schedule[0].normalized.x === 0 && schedule[0].normalized.y === 0, 'viewport schedule must begin at origin');
  assert(schedule.at(-1).normalized.x === 1 && schedule.at(-1).normalized.y === 1, 'viewport schedule must end at far edge');
});

recordCase('owner-map-projection', () => {
  const projected = projectCoverageToOwnerMap(synthetic, { x: 0.5, y: 0.5 });
  assert(projected.cellId === 'C14-18', `center should project to C14-18, got ${projected.cellId}`);
  assert(projected.world.x === 4500 && projected.world.y === 3500, 'center projection must land at world center');
});

recordCase('owner-map-clamp', () => {
  const projected = projectCoverageToOwnerMap(synthetic, { x: -2, y: 5 });
  assert(projected.normalized.x === 0, 'owner-map x must clamp low');
  assert(projected.normalized.y === 1, 'owner-map y must clamp high');
});

recordCase('lattice-completeness', () => {
  const lattice = enumerateCoverageLattice(synthetic);
  assert(lattice.length === synthetic.cellCount, 'coverage lattice must visit each cell once');
  assert(new Set(lattice.map((entry) => entry.cellId)).size === synthetic.cellCount, 'coverage lattice must not duplicate cells');
});

recordCase('replay-determinism', () => {
  const plan = createObservedPlan();
  const replay = createCoverageReplay(plan);
  const validation = validateReplay(plan, replay);
  assert(validation.equal === true, 'coverage replay must equal source plan');
  assert(validation.expectedDigest === validation.actualDigest, 'coverage replay digest must be stable');
});

recordCase('plan-comparison', () => {
  const plan = createObservedPlan();
  const clone = JSON.parse(JSON.stringify(plan));
  const result = compareCoveragePlans(plan, clone);
  assert(result.equal === true, 'equivalent coverage plans must compare equal');
});

recordCase('serialization-determinism', () => {
  const plan = createObservedPlan();
  const first = serializeFullWorldCoverage(plan);
  const second = serializeFullWorldCoverage(JSON.parse(JSON.stringify(plan)));
  assert(first === second, 'stable serialization must ignore object insertion order');
  assert(digestFullWorldCoverage(plan) === digestFullWorldCoverage(JSON.parse(JSON.stringify(plan))), 'digest must survive serialization roundtrip');
});

recordCase('seam-audit', () => {
  const plan = createObservedPlan();
  const audit = createSeamAudit(plan);
  assert(audit.pairCount > 0, 'seam audit must evaluate neighboring cells');
  assert(audit.unresolvedCount === 0, 'generated grid must have closed seams');
});

recordCase('dashboard-shape', () => {
  const plan = createObservedPlan();
  const dashboard = createCoverageDashboard(plan);
  assert(dashboard.coverage.cells === plan.cellCount, 'dashboard cell count mismatch');
  assert(dashboard.phaseSummary.total === 10, 'dashboard phase count mismatch');
});

recordCase('decision-explanation', () => {
  const plan = createObservedPlan();
  const explanation = explainCoverageDecision(plan);
  assert(Array.isArray(explanation.reasons), 'decision explanation must provide reasons');
});

recordCase('runtime-adapter', () => {
  const plan = createObservedPlan();
  const adapter = createRuntimeCoverageAdapter(plan, { batchSize: 32 });
  assert(adapter.policyId === 'full-world-runtime-coverage-v1', 'runtime adapter id mismatch');
  assert(adapter.createsGeometry === false, 'runtime adapter must never create geometry');
  assert(adapter.mutatesCanonicalGeography === false, 'runtime adapter must remain read-only');
  assert(adapter.batchSize === 32, 'runtime adapter batch size mismatch');
});

recordCase('owner-evidence-request', () => {
  const plan = createObservedPlan();
  const request = createOwnerEvidenceRequest(plan, { owner: 'test-owner', artifactSize: '1536x1024' });
  assert(request.owner === 'test-owner', 'owner evidence owner mismatch');
  assert(request.noPassClaimUntilObserved === true, 'evidence contract must be fail-closed');
  assert(request.requiredChecks.includes('asset-hydration'), 'asset hydration must be required');
  assert(request.requiredChecks.includes('material-placement-contract'), 'material placement contract must be required');
});

recordCase('selection-by-surface', () => {
  const plan = createObservedPlan();
  const water = selectCoverageCells(plan, { surface: 'water' });
  assert(water.every((cell) => cell.surface === 'water'), 'surface selection must be exact');
});

recordCase('selection-by-edge', () => {
  const plan = createObservedPlan();
  const north = selectCoverageCells(plan, { edge: 'north' });
  assert(north.every((cell) => cell.indexY === 0), 'north selection must use indexY=0');
});

recordCase('selection-by-feature', () => {
  const plan = createObservedPlan();
  const terrain = selectCoverageCells(plan, { feature: 'terrain' });
  assert(terrain.length === plan.cellCount, 'terrain should cover every observed cell in the baseline');
});

recordCase('selection-by-risk', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: point.x === 4500 } }),
  });
  const risky = selectCoverageCells(plan, { risk: 'seam' });
  assert(risky.length >= 1, 'risk selection must find seam-flagged cell');
});

recordCase('gap-finder-empty', () => {
  const plan = createObservedPlan();
  assert(findCoverageGaps(plan).length === 0, 'healthy baseline should have no coverage gaps');
});

function createDefaultLike(point) {
  return {
    point,
    canonicalHeight: 100,
    renderedHeight: 100,
    colliderHeight: 100,
    water: { coverage: 0, depthMeters: 0, class: 'dry' },
    slope: { degrees: 5, band: 'land' },
    biome: { id: 'test', confidence: 1 },
    confidence: 1,
    features: Object.fromEntries(constants.DEFAULT_REQUIRED_FEATURES.map((feature) => [feature, { present: true, confidence: 1, status: 'present' }])),
    risk: {},
  };
}

recordCase('gap-finder-unassessed', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: () => ({ ...createDefaultLike({ x: 0, y: 0 }), confidence: 0.1 }),
  });
  const gaps = findCoverageGaps(plan);
  assert(gaps.some((gap) => gap.kind === 'unassessed-cell'), 'low confidence must produce an unassessed gap');
});

recordCase('risk-gap-seam', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }),
  });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === false, 'seam risk must fail validation');
  assert(validation.errors.some((error) => error.includes('seam')), 'seam failure must be visible');
});

recordCase('risk-gap-rectangular-water', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { rectangularWater: true } }),
  });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === false, 'rectangular-water risk must fail validation');
});

recordCase('risk-gap-floating', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { floating: true } }),
  });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === false, 'floating risk must fail validation');
});

recordCase('risk-gap-missing-asset', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { missingAsset: true } }),
  });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === false, 'missing asset risk must fail validation');
});

recordCase('rendered-parity', () => {
  const plan = createObservedPlan();
  assert(plan.cells.every((cell) => cell.maxRenderedParityMeters <= 1e-5), 'baseline rendered parity must pass');
});

recordCase('collider-parity', () => {
  const plan = createObservedPlan();
  assert(plan.cells.every((cell) => cell.maxColliderParityMeters <= 1e-5), 'baseline collider parity must pass');
});

recordCase('rendered-parity-failure', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 1, rows: 1 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), renderedHeight: 100.1 }),
  });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === false, 'rendered parity breach must fail validation');
});

recordCase('collider-parity-failure', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 1, rows: 1 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), colliderHeight: 100.1 }),
  });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === false, 'collider parity breach must fail validation');
});

recordCase('feature-gap', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), features: { ...createDefaultLike(point).features, vegetation: { present: false, confidence: 1, status: 'absent' } } }),
  });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === false, 'feature absence must be surfaced for non-road features');
});

recordCase('roads-gap-allowed-baseline', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    requiredFeatures: ['roads'],
    sampleObservation: (point) => ({ ...createDefaultLike(point), features: { roads: { present: false, confidence: 1, status: 'none' } } }),
  });
  const validation = validateFullWorldCoveragePlan(plan, { requiredFeatureMinimums: { roads: 0 } });
  assert(validation.ok === true, 'road-free cells must remain valid when policy allows zero road coverage');
});

recordCase('custom-feature-floor', () => {
  const plan = createObservedPlan();
  const envelope = createCoverageAcceptanceEnvelope(plan, { featureFloor: 0.99 });
  assert(envelope.featureFloor === 0.99, 'custom feature floor must be preserved');
});

recordCase('coverage-envelope-green', () => {
  const plan = createObservedPlan();
  const envelope = createCoverageAcceptanceEnvelope(plan);
  assert(envelope.deterministic === true, 'coverage envelope must report deterministic state');
  assert(envelope.boundaries.north.confidence === 1, 'north boundary confidence should be complete');
});

recordCase('frozen-plan', () => {
  assertFrozen(synthetic, 'synthetic-plan');
});

recordCase('frozen-summary', () => {
  const summary = summarizeCoverage(synthetic);
  assert(Object.isFrozen(summary), 'summary must be frozen');
  assert(Object.isFrozen(summary.featureMatrix), 'summary.featureMatrix must be frozen');
});

recordCase('frozen-batches', () => {
  const batches = buildCoverageBatch(synthetic, { batchSize: 64 });
  assert(Object.isFrozen(batches), 'batches must be frozen');
  assert(batches.every((batch) => Object.isFrozen(batch)), 'each batch must be frozen');
});

recordCase('frozen-viewport', () => {
  const schedule = createViewportCoverageSchedule(synthetic);
  assert(Object.isFrozen(schedule), 'viewport schedule must be frozen');
  assert(schedule.every((entry) => Object.isFrozen(entry)), 'viewport entries must be frozen');
});

recordCase('feature-matrix-all-covered', () => {
  const summary = summarizeCoverage(synthetic);
  for (const feature of constants.DEFAULT_REQUIRED_FEATURES) {
    assert(summary.featureMatrix[feature].coveredCells === synthetic.cellCount, `${feature} should cover all synthetic cells`);
  }
});

recordCase('boundary-counts', () => {
  assert(synthetic.boundaries.north.length === constants.DEFAULT_GRID.columns, 'north boundary count mismatch');
  assert(synthetic.boundaries.south.length === constants.DEFAULT_GRID.columns, 'south boundary count mismatch');
  assert(synthetic.boundaries.west.length === constants.DEFAULT_GRID.rows, 'west boundary count mismatch');
  assert(synthetic.boundaries.east.length === constants.DEFAULT_GRID.rows, 'east boundary count mismatch');
});

recordCase('critical-review-queue', () => {
  const dashboard = createCoverageDashboard(synthetic);
  assert(dashboard.criticalQueue.count >= 0, 'critical queue count must be finite');
  assert(dashboard.criticalQueue.p0 >= 0, 'critical queue P0 count must be finite');
  assert(dashboard.criticalQueue.p1 >= 0, 'critical queue P1 count must be finite');
  assert(dashboard.criticalQueue.p2 >= 0, 'critical queue P2 count must be finite');
});

recordCase('critical-owner-request', () => {
  const request = createOwnerEvidenceRequest(synthetic);
  assert(request.requiredChecks.length >= 10, 'owner request must remain comprehensive');
});

recordCase('exact-canonical-bounds', () => {
  const summary = summarizeCoverage(synthetic);
  assert(summary.bounds.xMin === 0 && summary.bounds.xMax === 9000, 'summary x bounds must be canonical');
  assert(summary.bounds.yMin === 0 && summary.bounds.yMax === 7000, 'summary y bounds must be canonical');
});

recordCase('default-reference-provenance', () => {
  const plan = createFullWorldCoveragePlan();
  assert(plan.referenceMapSha256 === '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1', 'default map provenance mismatch');
});

recordCase('no-editor-import-contract', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.importsEditorUi === false, 'runtime adapter must forbid editor UI imports');
  assert(adapter.materialAuthority.includes('MaterialAssignmentCore'), 'material authority must point to shared core');
});

recordCase('no-geometry-contract', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.createsGeometry === false, 'coverage director must remain read-only');
});

recordCase('no-canonical-mutation-contract', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.mutatesCanonicalGeography === false, 'coverage director must never mutate canonical geography');
});

recordCase('full-reference-phase-list', () => {
  assert(constants.REQUIRED_PHASES.length === 10, 'coverage phase count must remain 10');
  assert(constants.REQUIRED_PHASES.includes('map-origin'), 'map-origin phase missing');
  assert(constants.REQUIRED_PHASES.includes('cross-seam'), 'cross-seam phase missing');
  assert(constants.REQUIRED_PHASES.includes('feature-obligations'), 'feature obligations phase missing');
});

recordCase('constant-risk-ceiling', () => {
  assert(constants.MAX_COVERAGE_GAP_RATIO === 0.02, 'gap ratio ceiling drifted');
  assert(constants.MAX_UNASSESSED_RATIO === 0, 'unassessed ratio ceiling drifted');
});

recordCase('cell-id-ordering', () => {
  const cellIds = synthetic.cells.map((cell) => cell.cellId);
  assert(cellIds[0] === 'C00-00', 'first cell id mismatch');
  assert(cellIds.at(-1) === 'C27-35', 'last cell id mismatch');
  assert(new Set(cellIds).size === cellIds.length, 'cell ids must be unique');
});

recordCase('probe-id-uniqueness', () => {
  const ids = [];
  for (const cell of synthetic.cells) for (const probe of createCoverageProbeIndex(synthetic) ? cell.probes : []) ids.push(probe.id);
  assert(new Set(ids).size === ids.length, 'probe ids must be unique');
});

recordCase('batch-partition', () => {
  for (const size of [1, 2, 3, 8, 16, 64, 128, 1000]) {
    const batches = buildCoverageBatch(synthetic, { batchSize: size });
    assert(batches.flatMap((batch) => batch.cellIds).length === synthetic.cellCount, `batch partition mismatch for ${size}`);
  }
});

recordCase('viewport-margin-normalization', () => {
  const schedule = createViewportCoverageSchedule(synthetic, { marginX: -5, marginY: 3 });
  assert(schedule[0].normalized.x === 0, 'negative viewport margin must clamp');
  assert(schedule[1].normalized.x >= 0, 'viewport x must remain non-negative');
});

recordCase('custom-batch-adapter', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic, { batchSize: 17 });
  assert(adapter.batchSize === 17, 'custom runtime batch size mismatch');
});

recordCase('gap-filter-feature', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), features: { ...createDefaultLike(point).features, vegetation: { present: false, confidence: 1, status: 'absent' } } }),
  });
  const gaps = findCoverageGaps(plan, { feature: 'vegetation' });
  assert(gaps.every((gap) => gap.feature === 'vegetation'), 'feature gap filter must be exact');
});

recordCase('gap-filter-max-cell-samples', () => {
  const plan = createFullWorldCoveragePlan({
    grid: { columns: 2, rows: 2 },
    sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }),
  });
  const gaps = findCoverageGaps(plan, { maxPerCellGap: 1 });
  assert(gaps.length > 0, 'seam gaps should survive max-per-cell filter');
});

recordCase('surface-classification-water', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), water: { coverage: 1, depthMeters: 30, class: 'deep' } }) });
  assert(plan.cells[0].surface === 'water', 'water surface must classify as water');
});

recordCase('surface-classification-land', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), water: { coverage: 0, depthMeters: 0, class: 'dry' } }) });
  assert(plan.cells[0].surface === 'land', 'dry surface must classify as land');
});

recordCase('surface-classification-mixed', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), water: { coverage: 0.5, depthMeters: 2, class: 'shore' } }) });
  assert(plan.cells[0].surface === 'mixed', 'mixed surface must classify as mixed');
});

recordCase('malformed-height-fallback', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: () => ({ canonicalHeight: NaN, renderedHeight: Infinity, colliderHeight: -Infinity }) });
  assert(plan.cells[0].maxRenderedParityMeters === 0, 'malformed height fallback should remain finite and aligned');
});

recordCase('malformed-water-fallback', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: () => ({ ...createDefaultLike({ x: 0, y: 0 }), water: { coverage: NaN, depthMeters: Infinity, class: null } }) });
  assert(Number.isFinite(plan.cells[0].waterCoverage), 'malformed water must normalize to finite values');
});

recordCase('malformed-confidence-fallback', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: () => ({ ...createDefaultLike({ x: 0, y: 0 }), confidence: Infinity }) });
  assert(plan.cells[0].confidence <= 1, 'confidence must be bounded to one');
});

recordCase('missing-point-fallback', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: () => ({ ...createDefaultLike({ x: 0, y: 0 }), point: undefined }) });
  assert(plan.cells[0].bounds.xMin === 0, 'missing point must not corrupt cell bounds');
});

recordCase('custom-feature-zero', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, requiredFeatures: ['custom'], sampleObservation: (point) => ({ ...createDefaultLike(point), features: { custom: { present: true, confidence: 1, status: 'present' } } }) });
  assert(plan.featureMatrix.custom.coveredCells === 1, 'custom feature must be supported');
});

recordCase('feature-key-stability', () => {
  const planA = createFullWorldCoveragePlan({ requiredFeatures: ['A', 'b'], grid: { columns: 1, rows: 1 } });
  const planB = createFullWorldCoveragePlan({ requiredFeatures: ['b', 'A'], grid: { columns: 1, rows: 1 } });
  assert(compareCoveragePlans(planA, planB).equal === true, 'feature order must not change plan digest');
});

recordCase('source-id-changes-digest', () => {
  const planA = createObservedPlan();
  const planB = createObservedPlan();
  Object.defineProperty(planB, 'sourceId', { value: 'other', enumerable: true });
  assert(compareCoveragePlans(planA, planB).equal === false, 'source provenance change must change digest');
});

recordCase('manifest-validation', () => {
  const manifest = createFullWorldCoverageManifest(createObservedPlan());
  assert(manifest.validation.ok === true, 'healthy observed manifest should validate');
});

recordCase('assert-green', () => {
  const plan = createObservedPlan();
  assertFullWorldCoverage(plan);
  assert(true, 'assert green must return true');
});

recordCase('assert-red', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }) });
  expectThrow(() => assertFullWorldCoverage(plan), 'assertFullWorldCoverage must throw for seam risk');
});

recordCase('select-all', () => {
  assert(selectCoverageCells(synthetic).length === synthetic.cellCount, 'empty selector must select all cells');
});

recordCase('select-surface-feature', () => {
  const cells = selectCoverageCells(synthetic, { surface: 'land', feature: 'terrain' });
  assert(cells.every((cell) => cell.surface === 'land' && cell.featureCoverage.terrain.coverage > 0), 'combined selector must apply both predicates');
});

recordCase('select-unknown-risk', () => {
  const cells = selectCoverageCells(synthetic, { risk: 'unknown-risk' });
  assert(cells.length === 0, 'unknown risk should select no cells');
});

recordCase('full-batch-stability', () => {
  const a = buildCoverageBatch(synthetic, { batchSize: 64 });
  const b = buildCoverageBatch(synthetic, { batchSize: 64 });
  assert(JSON.stringify(a) === JSON.stringify(b), 'batching must be deterministic');
});

recordCase('full-viewport-stability', () => {
  const a = createViewportCoverageSchedule(synthetic);
  const b = createViewportCoverageSchedule(synthetic);
  assert(JSON.stringify(a) === JSON.stringify(b), 'viewport schedule must be deterministic');
});

recordCase('full-lattice-stability', () => {
  const a = enumerateCoverageLattice(synthetic);
  const b = enumerateCoverageLattice(synthetic);
  assert(JSON.stringify(a) === JSON.stringify(b), 'coverage lattice must be deterministic');
});

recordCase('full-summary-stability', () => {
  const a = summarizeCoverage(synthetic);
  const b = summarizeCoverage(synthetic);
  assert(JSON.stringify(a) === JSON.stringify(b), 'coverage summary must be deterministic');
});

recordCase('full-manifest-stability', () => {
  const a = createFullWorldCoverageManifest(synthetic);
  const b = createFullWorldCoverageManifest(synthetic);
  assert(JSON.stringify(a) === JSON.stringify(b), 'coverage manifest must be deterministic');
});

recordCase('full-dashboard-stability', () => {
  const a = createCoverageDashboard(synthetic);
  const b = createCoverageDashboard(synthetic);
  assert(JSON.stringify(a) === JSON.stringify(b), 'dashboard must be deterministic');
});

recordCase('full-owner-request-stability', () => {
  const a = createOwnerEvidenceRequest(synthetic);
  const b = createOwnerEvidenceRequest(synthetic);
  assert(JSON.stringify(a) === JSON.stringify(b), 'owner evidence request must be deterministic');
});

recordCase('phase-evidence-completeness', () => {
  assert(summarizeCoverage(synthetic).phases.length === constants.REQUIRED_PHASES.length, 'phase evidence must cover every phase');
});

recordCase('risk-summary-zero-baseline', () => {
  assert(Object.values(synthetic.risks).every((count) => count === 0), 'synthetic baseline must begin with zero explicit risks');
});

recordCase('feature-matrix-minimums', () => {
  for (const entry of Object.values(synthetic.featureMatrix)) assert(entry.minimumRequiredCoverage >= 0 && entry.minimumRequiredCoverage <= 1, 'feature minimums must be bounded');
});

recordCase('coverage-ratio-bounded', () => {
  assert(synthetic.report.coverageRatio >= 0 && synthetic.report.coverageRatio <= 1, 'coverage ratio must be bounded');
});

recordCase('unassessed-ratio-bounded', () => {
  assert(synthetic.report.unassessedRatio >= 0 && synthetic.report.unassessedRatio <= 1, 'unassessed ratio must be bounded');
});

recordCase('determinism-drift-bounded', () => {
  assert(synthetic.determinism.drift === 0, 'determinism drift must be zero');
});

recordCase('gap-count-consistency', () => {
  assert(synthetic.report.gapCount === synthetic.gaps.length, 'gap count must match gap list');
});

recordCase('phase-count-consistency', () => {
  assert(synthetic.report.totalPhaseCount === constants.REQUIRED_PHASES.length, 'phase total must match required phase list');
});

recordCase('dashboard-headline', () => {
  assert(['READY_FOR_RUNTIME_PROOF', 'COVERAGE_GAPS_REMAIN'].includes(createCoverageDashboard(synthetic).headline), 'dashboard headline must be recognized');
});

recordCase('explanation-status', () => {
  assert(typeof explainCoverageDecision(synthetic).ok === 'boolean', 'explanation status must be boolean');
});

recordCase('runtime-adapter-bounds', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.bounds.xMax === 9000 && adapter.bounds.yMax === 7000, 'runtime adapter bounds must be canonical');
});

recordCase('manifest-bounds', () => {
  const manifest = createFullWorldCoverageManifest(synthetic);
  assert(manifest.bounds.xMax === 9000 && manifest.bounds.yMax === 7000, 'manifest bounds must be canonical');
});

recordCase('owner-request-bounds', () => {
  const request = createOwnerEvidenceRequest(synthetic);
  assert(request.worldBounds.xMax === 9000 && request.worldBounds.yMax === 7000, 'owner evidence bounds must be canonical');
});

recordCase('probe-index-read-only-shape', () => {
  const index = createCoverageProbeIndex(synthetic);
  const first = Object.values(index)[0];
  assert(first && first.cellId && first.point && first.kind, 'probe index entry shape incomplete');
});

recordCase('replay-source-identity', () => {
  const replay = createCoverageReplay(synthetic);
  assert(replay.sourceId === synthetic.sourceId, 'replay must preserve source identity');
  assert(replay.digest === synthetic.determinism.digest, 'replay digest must equal plan digest');
});

recordCase('project-corner-origin', () => {
  const projected = projectCoverageToOwnerMap(synthetic, { x: 0, y: 0 });
  assert(projected.cellId === 'C00-00', 'origin must map to first cell');
});

recordCase('project-corner-far', () => {
  const projected = projectCoverageToOwnerMap(synthetic, { x: 1, y: 1 });
  assert(projected.cellId === 'C27-35', 'far edge must map to last cell');
});

recordCase('project-quarter', () => {
  const projected = projectCoverageToOwnerMap(synthetic, { x: 0.25, y: 0.25 });
  assert(projected.world.x === 2250 && projected.world.y === 1750, 'quarter projection mismatch');
});

recordCase('projection-cell-containment', () => {
  for (const entry of enumerateCoverageLattice(synthetic)) {
    const projected = projectCoverageToOwnerMap(synthetic, { x: entry.world.x / 9000, y: entry.world.y / 7000 });
    assert(projected.cellId === entry.cellId, `lattice projection escaped ${entry.cellId}`);
  }
});

recordCase('edge-sampling-count', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, edgeSamples: 5, diagonalSamples: 2, seamSamples: 4 });
  assert(plan.cells[0].sampleCount >= 5 * 4, 'single cell must carry all four boundary edge families');
});

recordCase('seam-sample-count', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 2, rows: 1 }, edgeSamples: 3, diagonalSamples: 1, seamSamples: 4 });
  assert(plan.cells[0].sampleCount >= 4, 'horizontal seam must have seam probes');
});

recordCase('no-seam-on-east-edge', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, seamSamples: 8 });
  assert(plan.cells[0].sampleCount < 100, 'single cell must not fabricate self-seams');
});

recordCase('small-grid-seam-pairs', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 3, rows: 2 } });
  const audit = createSeamAudit(plan);
  assert(audit.pairCount === 7, '3x2 grid should have 7 neighbor seam pairs');
});

recordCase('large-grid-seam-pairs', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 36, rows: 28 } });
  const audit = createSeamAudit(plan);
  assert(audit.pairCount === (35 * 28) + (36 * 27), 'default seam pair count mismatch');
});

recordCase('manifest-validation-errors-array', () => {
  const manifest = createFullWorldCoverageManifest(synthetic);
  assert(Array.isArray(manifest.validation.errors), 'validation errors must be an array');
});

recordCase('manifest-validation-warnings-array', () => {
  const manifest = createFullWorldCoverageManifest(synthetic);
  assert(Array.isArray(manifest.validation.warnings), 'validation warnings must be an array');
});

recordCase('plan-json-roundtrip', () => {
  const plan = createObservedPlan();
  const copy = JSON.parse(JSON.stringify(plan));
  assert(compareCoveragePlans(plan, copy).equal, 'plan must survive JSON roundtrip deterministically');
});

recordCase('manifest-json-roundtrip', () => {
  const manifest = createFullWorldCoverageManifest(synthetic);
  const copy = JSON.parse(JSON.stringify(manifest));
  assert(JSON.stringify(manifest) === JSON.stringify(copy), 'manifest must survive JSON roundtrip');
});

recordCase('runtime-json-roundtrip', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  const copy = JSON.parse(JSON.stringify(adapter));
  assert(copy.policyId === adapter.policyId, 'runtime adapter must survive JSON roundtrip');
});

recordCase('owner-request-json-roundtrip', () => {
  const request = createOwnerEvidenceRequest(synthetic);
  const copy = JSON.parse(JSON.stringify(request));
  assert(copy.requiredChecks.length === request.requiredChecks.length, 'owner evidence request must survive JSON roundtrip');
});

recordCase('empty-feature-list-default', () => {
  const plan = createFullWorldCoveragePlan({ requiredFeatures: [] });
  assert(Object.keys(plan.featureMatrix).length === constants.DEFAULT_REQUIRED_FEATURES.length, 'empty feature list must use defaults');
});

recordCase('duplicate-feature-list', () => {
  const plan = createFullWorldCoveragePlan({ requiredFeatures: ['terrain', 'terrain', 'roads'] });
  assert(Object.keys(plan.featureMatrix).length === 2, 'feature list should collapse duplicate keys in matrix');
});

recordCase('malformed-feature-state', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: () => ({ ...createDefaultLike({ x: 0, y: 0 }), features: { terrain: null } }) });
  assert(plan.featureMatrix.terrain.coverage === 0, 'malformed feature state must fail closed');
});

recordCase('risk-count-aggregation', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true, moire: true } }) });
  assert(plan.risks.seam > 0, 'seam risk count must aggregate');
  assert(plan.risks.moire > 0, 'moire risk count must aggregate');
});

recordCase('warning-moire', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { moire: true } }) });
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.warnings.some((warning) => warning.includes('moire')), 'moire should be a visible warning');
});

recordCase('strict-parity-threshold', () => {
  const plan = createObservedPlan();
  const validation = validateFullWorldCoveragePlan(plan, { maxHeightParityMeters: 0 });
  assert(validation.ok === true, 'zero parity baseline should remain green');
});

recordCase('strict-gap-threshold', () => {
  const plan = createObservedPlan();
  const validation = validateFullWorldCoveragePlan(plan, { maxGapRatio: 0 });
  assert(validation.ok === true, 'zero gap ratio baseline should remain green');
});

recordCase('custom-feature-minimum-rejection', () => {
  const plan = createObservedPlan();
  const validation = validateFullWorldCoveragePlan(plan, { requiredFeatureMinimums: { vegetation: 1.01 } });
  assert(validation.ok === false, 'impossible feature minimum must fail closed');
});

recordCase('custom-feature-minimum-acceptance', () => {
  const plan = createObservedPlan();
  const validation = validateFullWorldCoveragePlan(plan, { requiredFeatureMinimums: { vegetation: 1 } });
  assert(validation.ok === true, 'full baseline feature coverage must meet one');
});

recordCase('custom-unassessed-rejection', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: () => ({ ...createDefaultLike({ x: 0, y: 0 }), confidence: 0.1 }) });
  const validation = validateFullWorldCoveragePlan(plan, { maxUnassessedRatio: 0 });
  assert(validation.ok === false, 'strict unassessed ceiling must fail low-confidence cells');
});

recordCase('report-readiness', () => {
  const healthy = createObservedPlan();
  const broken = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }) });
  assert(healthy.report.readyForRuntimeProof === true, 'healthy report must authorize runtime proof');
  assert(broken.report.readyForRuntimeProof === false, 'broken report must block runtime proof');
});

recordCase('phase-cross-seam', () => {
  const broken = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }) });
  const phase = broken.evidence.find((entry) => entry.phase === 'cross-seam');
  assert(phase?.passed === false, 'cross-seam phase must fail with seam risk');
});

recordCase('phase-determinism', () => {
  const phase = synthetic.evidence.find((entry) => entry.phase === 'determinism');
  assert(phase?.passed === true, 'determinism phase must pass baseline');
});

recordCase('phase-parity', () => {
  const phase = synthetic.evidence.find((entry) => entry.phase === 'parity');
  assert(phase?.passed === true, 'parity phase must pass baseline');
});

recordCase('phase-boundary', () => {
  for (const phaseName of ['north-boundary', 'south-boundary', 'west-boundary', 'east-boundary']) {
    assert(synthetic.evidence.find((entry) => entry.phase === phaseName)?.passed === true, `${phaseName} must pass baseline`);
  }
});

recordCase('phase-feature-obligations', () => {
  assert(synthetic.evidence.find((entry) => entry.phase === 'feature-obligations')?.passed === true, 'feature obligations must pass baseline');
});

recordCase('selection-boundary-south', () => {
  const cells = selectCoverageCells(synthetic, { edge: 'south' });
  assert(cells.every((cell) => cell.indexY === synthetic.grid.rows - 1), 'south selector mismatch');
});

recordCase('selection-boundary-west', () => {
  const cells = selectCoverageCells(synthetic, { edge: 'west' });
  assert(cells.every((cell) => cell.indexX === 0), 'west selector mismatch');
});

recordCase('selection-boundary-east', () => {
  const cells = selectCoverageCells(synthetic, { edge: 'east' });
  assert(cells.every((cell) => cell.indexX === synthetic.grid.columns - 1), 'east selector mismatch');
});

recordCase('surface-selection-mixed', () => {
  const mixed = selectCoverageCells(createObservedPlan(), { surface: 'mixed' });
  assert(mixed.every((cell) => cell.surface === 'mixed'), 'mixed selector mismatch');
});

recordCase('digest-numeric', () => {
  assert(Number.isInteger(synthetic.determinism.digest), 'digest must be numeric');
  assert(synthetic.determinism.digest >= 0, 'digest must be unsigned');
});

recordCase('serialized-output-nonempty', () => {
  assert(serializeFullWorldCoverage(synthetic).length > 1000, 'serialized coverage output must contain substantive evidence');
});

recordCase('viewport-world-bounds', () => {
  for (const entry of createViewportCoverageSchedule(synthetic)) {
    assert(entry.world.x >= 0 && entry.world.x <= 9000, 'viewport world x out of bounds');
    assert(entry.world.y >= 0 && entry.world.y <= 7000, 'viewport world y out of bounds');
  }
});

recordCase('lattice-world-bounds', () => {
  for (const entry of enumerateCoverageLattice(synthetic)) {
    assert(entry.world.x > 0 && entry.world.x < 9000, 'lattice x must stay inside world interior');
    assert(entry.world.y > 0 && entry.world.y < 7000, 'lattice y must stay inside world interior');
  }
});

recordCase('cell-bounds-area', () => {
  const expectedArea = (9000 / 36) * (7000 / 28);
  for (const cell of synthetic.cells) assert(Math.abs((cell.bounds.xMax - cell.bounds.xMin) * (cell.bounds.yMax - cell.bounds.yMin) - expectedArea) < 1e-6, 'cell area must stay uniform');
});

recordCase('world-area-sum', () => {
  const area = synthetic.cells.reduce((sum, cell) => sum + (cell.bounds.xMax - cell.bounds.xMin) * (cell.bounds.yMax - cell.bounds.yMin), 0);
  assert(Math.abs(area - 9000 * 7000) < 1e-6, 'cell areas must cover the canonical world exactly once');
});

recordCase('no-overlap-x', () => {
  const byRow = synthetic.cells.filter((cell) => cell.indexY === 0).sort((a, b) => a.indexX - b.indexX);
  for (let i = 1; i < byRow.length; i += 1) assert(byRow[i - 1].bounds.xMax === byRow[i].bounds.xMin, 'horizontal cells must share exact x seam');
});

recordCase('no-overlap-y', () => {
  const byCol = synthetic.cells.filter((cell) => cell.indexX === 0).sort((a, b) => a.indexY - b.indexY);
  for (let i = 1; i < byCol.length; i += 1) assert(byCol[i - 1].bounds.yMax === byCol[i].bounds.yMin, 'vertical cells must share exact y seam');
});

recordCase('risk-priority-p0', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { missingAsset: true } }) });
  const dashboard = createCoverageDashboard(plan);
  assert(dashboard.criticalQueue.p0 >= 1, 'missing assets must enter P0 critical queue');
});

recordCase('risk-priority-p1', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }) });
  const dashboard = createCoverageDashboard(plan);
  assert(dashboard.criticalQueue.p1 >= 1, 'seam risks must enter P1 critical queue');
});

recordCase('risk-priority-p2', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), water: { coverage: 0.5, depthMeters: 2, class: 'shore' } }) });
  const dashboard = createCoverageDashboard(plan);
  assert(dashboard.criticalQueue.p2 >= 1, 'mixed surface cells must enter P2 critical queue');
});

recordCase('deterministic-cell-order', () => {
  const idsA = createObservedPlan().cells.map((cell) => cell.cellId);
  const idsB = createObservedPlan().cells.map((cell) => cell.cellId);
  assert(JSON.stringify(idsA) === JSON.stringify(idsB), 'cell order must be deterministic');
});

recordCase('deterministic-probe-order', () => {
  const a = createObservedPlan().cells[0].sampleCount;
  const b = createObservedPlan().cells[0].sampleCount;
  assert(a === b, 'probe ordering must be deterministic');
});

recordCase('source-function-repeat', () => {
  const plan = createObservedPlan();
  assert(plan.determinism.digest === createObservedPlan().determinism.digest, 'source function repeat must remain deterministic');
});

recordCase('browser-proof-request', () => {
  const request = createOwnerEvidenceRequest(synthetic);
  assert(request.artifactKind === 'full-world-coverage-proof', 'artifact kind mismatch');
  assert(request.requiredArtifactSize === '1536x1024', 'artifact size contract mismatch');
});

recordCase('material-authority-name', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.materialAuthority === 'caller-owned MaterialAssignmentCore + WorldAssetPlacementPipeline', 'shared material authority changed');
});

recordCase('runtime-read-only-contract', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.readOnly === true, 'runtime adapter must be read-only');
});

recordCase('synthetic-no-assets', () => {
  assert(synthetic.risks.missingAsset === 0, 'synthetic fixture must not report missing asset risk');
});

recordCase('synthetic-no-geometry', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.createsGeometry === false, 'coverage adapter must not own geometry');
});

recordCase('source-map-nonempty', () => {
  assert(synthetic.referenceMapSha256.length > 0, 'reference map SHA must be nonempty');
});

recordCase('coverage-probe-index-stability', () => {
  const a = createCoverageProbeIndex(synthetic);
  const b = createCoverageProbeIndex(synthetic);
  assert(JSON.stringify(a) === JSON.stringify(b), 'probe index must be deterministic');
});

recordCase('feature-filter-case-normalization', () => {
  const cells = selectCoverageCells(synthetic, { feature: ' TERRAIN ' });
  assert(cells.length === synthetic.cellCount, 'feature selector must normalize case and whitespace');
});

recordCase('risk-filter-case-normalization', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }) });
  assert(selectCoverageCells(plan, { risk: ' SEAM ' }).length === 1, 'risk selector must normalize case and whitespace');
});

recordCase('surface-filter-case-normalization', () => {
  const waterCells = selectCoverageCells(createObservedPlan(), { surface: ' WATER ' });
  assert(waterCells.every((cell) => cell.surface === 'water'), 'surface selector must normalize case and whitespace');
});

recordCase('dashboard-risk-metrics', () => {
  const plan = createObservedPlan();
  const dashboard = createCoverageDashboard(plan);
  assert(typeof dashboard.risks.seam === 'number', 'dashboard seam risk must be numeric');
  assert(typeof dashboard.risks.rectangularWater === 'number', 'dashboard water risk must be numeric');
});

recordCase('dashboard-critical-order', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { seam: true } }) });
  const dashboard = createCoverageDashboard(plan);
  assert(dashboard.criticalQueue.count >= dashboard.criticalQueue.p1, 'critical queue counts must be internally consistent');
});

recordCase('explanation-for-risk', () => {
  const plan = createFullWorldCoveragePlan({ grid: { columns: 1, rows: 1 }, sampleObservation: (point) => ({ ...createDefaultLike(point), risk: { floating: true } }) });
  const explanation = explainCoverageDecision(plan);
  assert(explanation.reasons.some((reason) => reason.includes('floating')), 'explanation must mention floating risk');
});

recordCase('summary-feature-key-order', () => {
  const summary = summarizeCoverage(createObservedPlan());
  const keys = Object.keys(summary.featureMatrix);
  assert(keys.length === constants.DEFAULT_REQUIRED_FEATURES.length, 'feature matrix key count mismatch');
});

recordCase('manifest-required-phases', () => {
  const manifest = createFullWorldCoverageManifest(synthetic);
  assert(manifest.evidence.length === constants.REQUIRED_PHASES.length, 'manifest evidence phase count mismatch');
});

recordCase('runtime-adapter-acceptance', () => {
  const adapter = createRuntimeCoverageAdapter(synthetic);
  assert(adapter.acceptance.passed === true, 'healthy runtime adapter acceptance must pass');
});

recordCase('viewport-purpose', () => {
  const schedule = createViewportCoverageSchedule(synthetic);
  assert(schedule.filter((entry) => entry.purpose === 'corner').length === 4, 'four corner viewport proofs required');
});

recordCase('viewport-center', () => {
  const schedule = createViewportCoverageSchedule(synthetic);
  const center = schedule.find((entry) => entry.normalized.x === 0.5 && entry.normalized.y === 0.5);
  assert(center?.purpose === 'center', 'center viewport proof missing');
});

recordCase('coverage-manifest-batches', () => {
  const contract = createFullWorldCoverageManifest(synthetic);
  assert(contract.grid.columns === 36 && contract.grid.rows === 28, 'manifest grid mismatch');
});

recordCase('source-id-required-for-owner-request', () => {
  const request = createOwnerEvidenceRequest(synthetic);
  assert(request.sourceId === synthetic.sourceId, 'owner request source id mismatch');
});

recordCase('reference-sha-required-for-owner-request', () => {
  const request = createOwnerEvidenceRequest(synthetic);
  assert(request.referenceMapSha256 === synthetic.referenceMapSha256, 'owner request map sha mismatch');
});

recordCase('frozen-runtime-adapter', () => {
  assertFrozen(createRuntimeCoverageAdapter(synthetic), 'runtime-adapter');
});

recordCase('frozen-owner-request', () => {
  assertFrozen(createOwnerEvidenceRequest(synthetic), 'owner-request');
});

recordCase('frozen-dashboard', () => {
  assertFrozen(createCoverageDashboard(synthetic), 'dashboard');
});

recordCase('frozen-envelope', () => {
  assertFrozen(createCoverageAcceptanceEnvelope(synthetic), 'acceptance-envelope');
});

recordCase('frozen-replay', () => {
  assertFrozen(createCoverageReplay(synthetic), 'coverage-replay');
});

recordCase('frozen-probe-index', () => {
  assertFrozen(createCoverageProbeIndex(synthetic), 'coverage-probe-index');
});

recordCase('custom-bounds-impossible', () => {
  const plan = createObservedPlan();
  expectThrow(() => validateFullWorldCoveragePlan(null), 'validation must reject null plan');
  assert(plan.bounds.xMax === 9000, 'baseline must remain canonical after invalid call');
});

recordCase('empty-plan-selection', () => {
  const cells = selectCoverageCells(createObservedPlan(), { surface: 'not-a-surface' });
  assert(cells.length === 0, 'unknown surface must produce empty selection');
});

recordCase('report-vs-validation', () => {
  const plan = createObservedPlan();
  const validation = validateFullWorldCoveragePlan(plan);
  assert(validation.ok === plan.report.readyForRuntimeProof, 'report readiness and validation must agree');
});

recordCase('manifest-vs-summary', () => {
  const plan = createObservedPlan();
  const manifest = createFullWorldCoverageManifest(plan);
  const summary = summarizeCoverage(plan);
  assert(manifest.cellCount === summary.cellCount, 'manifest and summary cell counts must agree');
  assert(manifest.probeCount === summary.probeCount, 'manifest and summary probe counts must agree');
});

recordCase('dashboard-vs-report', () => {
  const plan = createObservedPlan();
  const dashboard = createCoverageDashboard(plan);
  assert(dashboard.coverage.coverageRatio === plan.report.coverageRatio, 'dashboard coverage ratio mismatch');
});

recordCase('replay-vs-digest', () => {
  const plan = createObservedPlan();
  const replay = createCoverageReplay(plan);
  assert(replay.digest === plan.determinism.digest, 'replay digest must equal source digest');
});

recordCase('owner-request-required-check-list', () => {
  const request = createOwnerEvidenceRequest(synthetic);
  for (const required of ['exact-main-freshness', 'full-world-runtime-coverage', 'world-event-determinism', 'terrain-seat-safety', 'road-network-safety', 'pwa-installability', 'service-worker-cache', 'mobile-performance', 'browser-console-zero', 'asset-hydration', 'material-placement-contract']) {
    assert(request.requiredChecks.includes(required), `missing required owner check ${required}`);
  }
});

recordCase('phase-order', () => {
  const phases = summarizeCoverage(synthetic).phases.map((entry) => entry.phase);
  assert(JSON.stringify(phases) === JSON.stringify(constants.REQUIRED_PHASES), 'phase evidence order must be canonical');
});

recordCase('cell-bounds-monotonic', () => {
  for (const row of [0, 1, 27]) {
    const cells = synthetic.cells.filter((cell) => cell.indexY === row).sort((a, b) => a.indexX - b.indexX);
    for (let i = 1; i < cells.length; i += 1) assert(cells[i].bounds.xMin >= cells[i - 1].bounds.xMax, 'x bounds must be monotonic');
  }
});

recordCase('cell-bounds-monotonic-y', () => {
  for (const column of [0, 1, 35]) {
    const cells = synthetic.cells.filter((cell) => cell.indexX === column).sort((a, b) => a.indexY - b.indexY);
    for (let i = 1; i < cells.length; i += 1) assert(cells[i].bounds.yMin >= cells[i - 1].bounds.yMax, 'y bounds must be monotonic');
  }
});

recordCase('risk-free-digest', () => {
  assert(digestFullWorldCoverage(synthetic) === synthetic.determinism.digest, 'plan digest helper must match stored digest for healthy plan');
});

recordCase('serializable-finite', () => {
  const serialized = serializeFullWorldCoverage(synthetic);
  assert(!serialized.includes('NaN'), 'serialized output must not contain NaN');
  assert(!serialized.includes('Infinity'), 'serialized output must not contain Infinity');
});

// Explicit representative owner-map probe matrix: every world corner, edge midpoint,
// quadrant center and primary transition band is exercised as a named deterministic case.
const representativePoints = [
  ['NW', 0, 0],
  ['N', 0.5, 0],
  ['NE', 1, 0],
  ['W', 0, 0.5],
  ['C', 0.5, 0.5],
  ['E', 1, 0.5],
  ['SW', 0, 1],
  ['S', 0.5, 1],
  ['SE', 1, 1],
  ['Q1', 0.25, 0.25],
  ['Q2', 0.75, 0.25],
  ['Q3', 0.25, 0.75],
  ['Q4', 0.75, 0.75],
  ['T-N', 0.5, 0.03],
  ['T-S', 0.5, 0.97],
  ['T-W', 0.03, 0.5],
  ['T-E', 0.97, 0.5],
  ['N30', 0.30, 0],
  ['N70', 0.70, 0],
  ['S30', 0.30, 1],
  ['S70', 0.70, 1],
  ['W30', 0, 0.30],
  ['W70', 0, 0.70],
  ['E30', 1, 0.30],
  ['E70', 1, 0.70],
];
for (const [name, x, y] of representativePoints) {
  recordCase(`representative-${name}`, () => {
    const projected = projectCoverageToOwnerMap(synthetic, { x, y });
    assert(projected.world.x >= 0 && projected.world.x <= 9000, `${name} world x out of bounds`);
    assert(projected.world.y >= 0 && projected.world.y <= 7000, `${name} world y out of bounds`);
    assert(projected.cellId.startsWith('C'), `${name} cell id must be canonical`);
  });
}

if (failures.length > 0) {
  console.error(`FULL_WORLD_COVERAGE_DIRECTOR_FAIL checks=${checks} failures=${failures.length}`);
  for (const failure of failures.slice(0, 80)) console.error(`- ${failure}`);
  process.exit(1);
}

const healthy = summarizeCoverage(synthetic);
const dashboard = createCoverageDashboard(synthetic);
console.log(`FULL_WORLD_COVERAGE_DIRECTOR_OK checks=${checks} cells=${healthy.cellCount} probes=${healthy.probeCount} digest=${healthy.digest} critical=${dashboard.criticalQueue.count}`);

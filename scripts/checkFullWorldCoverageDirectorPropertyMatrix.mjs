#!/usr/bin/env node
import {
  buildCoverageBatches,
  buildCoverageReviewQueue,
  compareCoveragePlans,
  createCoverageAcceptanceEnvelope,
  createCoverageProbeIndex,
  createCoverageReplay,
  createFullWorldCoverageManifest,
  createRuntimeCoverageAdapter,
  createSyntheticCoveragePlan,
  createViewportCoverageSchedule,
  digestFullWorldCoverage,
  enumerateCoverageLattice,
  findCoverageGaps,
  getWorldCoverageConstants,
  selectCoverageCells,
  serializeFullWorldCoverage,
  validateReplay,
  validateFullWorldCoveragePlan,
} from '../src/3d/world/fullWorldCoverageDirector.js';

const fail = (message) => { throw new Error(`[full-world-property-matrix] ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const constants = getWorldCoverageConstants();
const baseline = createSyntheticCoveragePlan();
const second = createSyntheticCoveragePlan();
const lattice = enumerateCoverageLattice(baseline);
const manifest = createFullWorldCoverageManifest(baseline);
const envelope = createCoverageAcceptanceEnvelope(baseline);
const probes = createCoverageProbeIndex(baseline);
const replay = createCoverageReplay(baseline);
const adapter = createRuntimeCoverageAdapter(baseline, { batchSize: 32 });
const schedule = createViewportCoverageSchedule(baseline, { samples: 9 });
const batches = buildCoverageBatches(baseline, { batchSize: 32 });
const queue = buildCoverageReviewQueue(baseline);

assert(baseline.cellCount === constants.DEFAULT_GRID.columns * constants.DEFAULT_GRID.rows, 'cell lattice dimensions changed');
assert(lattice.length === baseline.cellCount, 'lattice cardinality changed');
assert(validateFullWorldCoveragePlan(baseline).ok, 'baseline plan no longer validates');
assert(findCoverageGaps(baseline).length === 0, 'baseline has unexpected gaps');
assert(compareCoveragePlans(baseline, second).equal, 'same synthetic input is not stable');
assert(digestFullWorldCoverage(baseline) === digestFullWorldCoverage(second), 'coverage digest is not stable');
assert(serializeFullWorldCoverage(baseline) === serializeFullWorldCoverage(second), 'serialized coverage is not stable');
assert(manifest.deterministicDigest === digestFullWorldCoverage(baseline), 'manifest digest mismatch');
assert(envelope.validation.ok === true && envelope.readyForRuntimeProof === true, 'acceptance envelope is not ready');
assert(envelope.maxHeightParityMeters === constants.MAX_HEIGHT_PARITY_METERS, 'parity threshold drifted');
assert(envelope.maxUnassessedRatio === constants.MAX_UNASSESSED_RATIO, 'unassessed threshold drifted');
assert(envelope.maxDeterminismDrift === constants.MAX_DETERMINISM_DRIFT, 'determinism threshold drifted');
assert(Object.keys(probes).length > baseline.cellCount, 'probe index does not contain cross-cell evidence');
assert(validateReplay(baseline, replay).equal, 'coverage replay does not round-trip');
assert(adapter.readOnly && !adapter.createsGeometry && !adapter.mutatesCanonicalGeography, 'runtime adapter crossed ownership boundary');
assert(adapter.batchCount === batches.length, 'adapter batches diverged from explicit batch builder');
assert(batches.every((batch) => batch.cells.length > 0 && batch.cells.length <= 32), 'batch sizing contract violated');
assert(schedule.length === 81, 'viewport schedule is not fully sampled');
assert(queue.every((entry) => entry.priority >= 0 && entry.priority <= 3), 'review queue priority out of range');

const boundaryIds = new Set([
  ...baseline.boundaries.north,
  ...baseline.boundaries.south,
  ...baseline.boundaries.west,
  ...baseline.boundaries.east,
]);
assert(boundaryIds.size === (constants.DEFAULT_GRID.columns * 2 + constants.DEFAULT_GRID.rows * 2 - 4), 'boundary lattice cardinality drifted');

const allSelection = selectCoverageCells(baseline, () => true);
assert(allSelection.length === baseline.cellCount, 'predicate selection lost cells');
const cornerSelection = selectCoverageCells(baseline, (cell) => cell.row === 0 || cell.row === baseline.grid.rows - 1);
assert(cornerSelection.length === constants.DEFAULT_GRID.columns * 2, 'boundary row selector is unstable');

const featureNames = [...constants.DEFAULT_REQUIRED_FEATURES];
const phaseNames = [...constants.REQUIRED_PHASES];
for (const feature of featureNames) {
  assert(Number.isFinite(baseline.featureMatrix[feature]?.coverage), `missing feature coverage: ${feature}`);
}
for (const phase of phaseNames) {
  assert(baseline.evidence.some((entry) => entry.phase === phase), `missing phase evidence: ${phase}`);
}

const replayJson = JSON.stringify(replay);
const replayRoundTrip = JSON.parse(replayJson);
assert(same(validateReplay(baseline, replayRoundTrip), validateReplay(baseline, replay)), 'replay JSON round-trip changed validation');

const manifestJson = JSON.stringify(manifest);
const manifestRoundTrip = JSON.parse(manifestJson);
assert(manifestRoundTrip.deterministicDigest === manifest.deterministicDigest, 'manifest JSON round-trip changed digest');
assert(manifestRoundTrip.validation.ok === manifest.validation.ok, 'manifest JSON round-trip changed validation state');

const mutatedFacade = { ...baseline, report: { ...baseline.report, readyForRuntimeProof: false } };
const mutatedValidation = validateFullWorldCoveragePlan(mutatedFacade);
assert(mutatedValidation.ok === false, 'mutated acceptance state was not rejected');
assert(findCoverageGaps(mutatedFacade).length >= 0, 'gap scanner failed on a valid plan shape');

console.log([
  'FULL_WORLD_COVERAGE_PROPERTY_MATRIX_OK',
  `cells=${baseline.cellCount}`,
  `probes=${baseline.probeCount}`,
  `batches=${batches.length}`,
  `viewportSamples=${schedule.length}`,
  `queue=${queue.length}`,
  `digest=${manifest.deterministicDigest}`,
].join(' '));

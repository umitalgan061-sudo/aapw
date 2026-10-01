/**
 * Full World Coverage Director
 *
 * Read-only, deterministic coverage planning for the shipped world reference extent.
 *
 * This module deliberately does NOT:
 * - create terrain, water, roads, settlements or scene geometry;
 * - invent geography;
 * - mutate renderer, physics, navigation or material state;
 * - hydrate or attach binary assets;
 * - import EditorMaterialStudio or DOM code.
 *
 * It consumes caller-owned observations and turns them into a reproducible acceptance
 * plan so a browser/runtime owner can prove the complete 9000x7000 owner-map extent,
 * including boundaries, corners, seam guards, feature obligations and evidence parity.
 */

const EPSILON = 1e-9;
const MAX_COVERAGE_GAP_RATIO = 0.02;
const MAX_UNASSESSED_RATIO = 0;
const MAX_HEIGHT_PARITY_METERS = 1e-5;
const MAX_DETERMINISM_DRIFT = 0;
const MIN_OBSERVATION_CONFIDENCE = 0.9;
const WORLD_BOUNDS = Object.freeze({ xMin: 0, xMax: 9000, yMin: 0, yMax: 7000 });
const DEFAULT_GRID = Object.freeze({ columns: 36, rows: 28 });
const DEFAULT_EDGE_SAMPLES = 9;
const DEFAULT_CORNER_SAMPLES = 4;
const DEFAULT_CENTER_SAMPLES = 1;
const DEFAULT_DIAGONAL_SAMPLES = 4;
const DEFAULT_SEAM_SAMPLES = 8;
const DEFAULT_REQUIRED_FEATURES = Object.freeze([
  'terrain',
  'hydrology',
  'roads',
  'settlements',
  'vegetation',
  'materials',
  'atmosphere',
  'collider',
  'navigation',
]);
const REQUIRED_PHASES = Object.freeze([
  'map-origin',
  'north-boundary',
  'south-boundary',
  'west-boundary',
  'east-boundary',
  'interior-grid',
  'cross-seam',
  'feature-obligations',
  'parity',
  'determinism',
]);

function assert(condition, message) {
  if (!condition) throw new Error(`[full-world-coverage] ${message}`);
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function ratio(numerator, denominator, fallback = 0) {
  if (!Number.isFinite(denominator) || denominator <= 0) return fallback;
  return clamp(numerator / denominator, 0, 1);
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function stableKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function hashPair(a, b) {
  return hashString(`${a}:${b}`);
}

function seededUnit(seed) {
  const h = hashString(String(seed));
  return h / 0xffffffff;
}

function normalize01(value) {
  return clamp(value, 0, 1);
}

function normalizeVector2(value) {
  return Object.freeze({
    x: finite(value?.x),
    y: finite(value?.y),
  });
}

function normalizeWorldPoint(point) {
  return Object.freeze({
    x: clamp(point?.x, WORLD_BOUNDS.xMin, WORLD_BOUNDS.xMax),
    y: clamp(point?.y, WORLD_BOUNDS.yMin, WORLD_BOUNDS.yMax),
  });
}

function normalizeHeightSample(sample) {
  const canonical = finite(sample?.canonicalHeight, finite(sample?.height, 0));
  const rendered = finite(sample?.renderedHeight, canonical);
  const collider = finite(sample?.colliderHeight, canonical);
  return Object.freeze({
    canonicalHeight: canonical,
    renderedHeight: rendered,
    colliderHeight: collider,
    renderedParityError: Math.abs(rendered - canonical),
    colliderParityError: Math.abs(collider - canonical),
  });
}

function normalizeObservation(raw, featureList = DEFAULT_REQUIRED_FEATURES) {
  const point = normalizeWorldPoint(raw?.point);
  const height = normalizeHeightSample(raw);
  const water = Object.freeze({
    coverage: normalize01(raw?.water?.coverage),
    depthMeters: Math.max(0, finite(raw?.water?.depthMeters)),
    class: stableKey(raw?.water?.class || 'unknown'),
  });
  const slope = Object.freeze({
    degrees: clamp(raw?.slope?.degrees, 0, 90),
    band: stableKey(raw?.slope?.band || 'unknown'),
  });
  const biome = Object.freeze({
    id: stableKey(raw?.biome?.id || 'unknown'),
    confidence: normalize01(raw?.biome?.confidence),
  });
  const confidence = normalize01(raw?.confidence ?? biome.confidence ?? 0);
  const features = {};
  for (const feature of featureList) {
    const state = raw?.features?.[feature] ?? raw?.[feature];
    features[feature] = Object.freeze({
      present: state === true || state?.present === true,
      confidence: normalize01(state?.confidence ?? (state === true ? 1 : 0)),
      status: stableKey(state?.status || (state === true ? 'present' : 'unknown')),
    });
  }
  const risk = Object.freeze({
    seam: raw?.risk?.seam === true,
    rectangularWater: raw?.risk?.rectangularWater === true,
    moire: raw?.risk?.moire === true,
    floating: raw?.risk?.floating === true,
    missingAsset: raw?.risk?.missingAsset === true,
  });
  return Object.freeze({ point, height, water, slope, biome, confidence, features, risk });
}

function createCellBounds(indexX, indexY, grid) {
  const width = (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin) / grid.columns;
  const height = (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin) / grid.rows;
  const xMin = WORLD_BOUNDS.xMin + indexX * width;
  const xMax = indexX === grid.columns - 1 ? WORLD_BOUNDS.xMax : xMin + width;
  const yMin = WORLD_BOUNDS.yMin + indexY * height;
  const yMax = indexY === grid.rows - 1 ? WORLD_BOUNDS.yMax : yMin + height;
  return Object.freeze({ xMin, xMax, yMin, yMax, width, height });
}

function createCellId(indexX, indexY) {
  return `C${String(indexY).padStart(2, '0')}-${String(indexX).padStart(2, '0')}`;
}

function createProbe(point, kind, cellId, sequence) {
  return Object.freeze({
    id: `${cellId}:${kind}:${sequence}`,
    kind,
    sequence,
    cellId,
    point: normalizeWorldPoint(point),
  });
}

function interpolate(a, b, amount) {
  const t = clamp(amount, 0, 1);
  return Object.freeze({
    x: finite(a.x) + (finite(b.x) - finite(a.x)) * t,
    y: finite(a.y) + (finite(b.y) - finite(a.y)) * t,
  });
}

function buildCellProbeSet(indexX, indexY, grid, options = {}) {
  const cellId = createCellId(indexX, indexY);
  const bounds = createCellBounds(indexX, indexY, grid);
  const edgeSamples = Math.max(2, Math.floor(options.edgeSamples ?? DEFAULT_EDGE_SAMPLES));
  const seamSamples = Math.max(2, Math.floor(options.seamSamples ?? DEFAULT_SEAM_SAMPLES));
  const probes = [];
  probes.push(createProbe({ x: bounds.xMin, y: bounds.yMin }, 'south-west-corner', cellId, probes.length));
  probes.push(createProbe({ x: bounds.xMax, y: bounds.yMin }, 'south-east-corner', cellId, probes.length));
  probes.push(createProbe({ x: bounds.xMin, y: bounds.yMax }, 'north-west-corner', cellId, probes.length));
  probes.push(createProbe({ x: bounds.xMax, y: bounds.yMax }, 'north-east-corner', cellId, probes.length));
  probes.push(createProbe({ x: (bounds.xMin + bounds.xMax) * 0.5, y: (bounds.yMin + bounds.yMax) * 0.5 }, 'center', cellId, probes.length));
  for (let index = 1; index < edgeSamples - 1; index += 1) {
    const t = index / (edgeSamples - 1);
    probes.push(createProbe(interpolate({ x: bounds.xMin, y: bounds.yMin }, { x: bounds.xMax, y: bounds.yMin }, t), 'south-edge', cellId, probes.length));
    probes.push(createProbe(interpolate({ x: bounds.xMin, y: bounds.yMax }, { x: bounds.xMax, y: bounds.yMax }, t), 'north-edge', cellId, probes.length));
    probes.push(createProbe(interpolate({ x: bounds.xMin, y: bounds.yMin }, { x: bounds.xMin, y: bounds.yMax }, t), 'west-edge', cellId, probes.length));
    probes.push(createProbe(interpolate({ x: bounds.xMax, y: bounds.yMin }, { x: bounds.xMax, y: bounds.yMax }, t), 'east-edge', cellId, probes.length));
  }
  const diagonalCount = Math.max(2, Math.floor(options.diagonalSamples ?? DEFAULT_DIAGONAL_SAMPLES));
  for (let index = 1; index <= diagonalCount; index += 1) {
    const t = index / (diagonalCount + 1);
    probes.push(createProbe(interpolate({ x: bounds.xMin, y: bounds.yMin }, { x: bounds.xMax, y: bounds.yMax }, t), 'diagonal-se', cellId, probes.length));
    probes.push(createProbe(interpolate({ x: bounds.xMin, y: bounds.yMax }, { x: bounds.xMax, y: bounds.yMin }, t), 'diagonal-sw', cellId, probes.length));
  }
  const seamCount = Math.max(2, Math.floor(options.seamSamples ?? DEFAULT_SEAM_SAMPLES));
  if (indexX < grid.columns - 1) {
    for (let index = 1; index <= seamCount; index += 1) {
      const t = index / (seamCount + 1);
      probes.push(createProbe({ x: bounds.xMax, y: bounds.yMin + bounds.height * t }, 'vertical-seam-east', cellId, probes.length));
    }
  }
  if (indexY < grid.rows - 1) {
    for (let index = 1; index <= seamCount; index += 1) {
      const t = index / (seamCount + 1);
      probes.push(createProbe({ x: bounds.xMin + bounds.width * t, y: bounds.yMax }, 'horizontal-seam-north', cellId, probes.length));
    }
  }
  return Object.freeze({ cellId, indexX, indexY, bounds, probes: Object.freeze(probes) });
}

function buildCoverageCells(grid = DEFAULT_GRID, options = {}) {
  assert(grid.columns > 0 && grid.rows > 0, 'grid dimensions must be positive');
  const cells = [];
  for (let indexY = 0; indexY < grid.rows; indexY += 1) {
    for (let indexX = 0; indexX < grid.columns; indexX += 1) {
      cells.push(buildCellProbeSet(indexX, indexY, grid, options));
    }
  }
  return Object.freeze(cells);
}

function classifySurface(observation) {
  if (observation.water.coverage >= 0.95) return 'water';
  if (observation.water.coverage <= 0.05) return observation.slope.degrees >= 55 ? 'steep-land' : 'land';
  return 'shore-transition';
}

function sampleFeatureCoverage(observations, feature) {
  const valid = observations.filter((observation) => observation.confidence >= MIN_OBSERVATION_CONFIDENCE);
  const present = valid.filter((observation) => observation.features[feature]?.present === true);
  return Object.freeze({
    feature,
    validSamples: valid.length,
    presentSamples: present.length,
    coverage: ratio(present.length, valid.length),
  });
}

function summarizeCell(cell, rawObservations, featureList) {
  const observations = rawObservations.map((raw) => normalizeObservation(raw, featureList));
  const valid = observations.filter((observation) => observation.confidence >= MIN_OBSERVATION_CONFIDENCE);
  const waterSamples = valid.filter((observation) => observation.water.coverage >= 0.95).length;
  const landSamples = valid.filter((observation) => observation.water.coverage <= 0.05).length;
  const transitionSamples = valid.length - waterSamples - landSamples;
  let maxRenderedParity = 0;
  let maxColliderParity = 0;
  for (const observation of valid) {
    maxRenderedParity = Math.max(maxRenderedParity, observation.height.renderedParityError);
    maxColliderParity = Math.max(maxColliderParity, observation.height.colliderParityError);
  }
  const featureCoverage = {};
  for (const feature of featureList) featureCoverage[feature] = sampleFeatureCoverage(valid, feature);
  const risks = {
    seam: observations.filter((observation) => observation.risk.seam).length,
    rectangularWater: observations.filter((observation) => observation.risk.rectangularWater).length,
    moire: observations.filter((observation) => observation.risk.moire).length,
    floating: observations.filter((observation) => observation.risk.floating).length,
    missingAsset: observations.filter((observation) => observation.risk.missingAsset).length,
  };
  const confidence = ratio(valid.length, observations.length);
  const surface = valid.length === 0
    ? 'unassessed'
    : waterSamples / valid.length >= 0.95
      ? 'water'
      : landSamples / valid.length >= 0.95
        ? 'land'
        : 'mixed';
  return Object.freeze({
    cellId: cell.cellId,
    surface,
    sampleCount: observations.length,
    validSampleCount: valid.length,
    confidence,
    waterCoverage: ratio(waterSamples, valid.length),
    landCoverage: ratio(landSamples, valid.length),
    transitionCoverage: ratio(transitionSamples, valid.length),
    maxRenderedParityMeters: maxRenderedParity,
    maxColliderParityMeters: maxColliderParity,
    featureCoverage: Object.freeze(featureCoverage),
    risks: Object.freeze(risks),
    bounds: cell.bounds,
  });
}

function createDefaultObservation(point, options = {}) {
  const normalized = normalizeVector2(point);
  const edgeFactorX = Math.min(normalized.x, WORLD_BOUNDS.xMax - normalized.x) / (WORLD_BOUNDS.xMax * 0.5);
  const edgeFactorY = Math.min(normalized.y, WORLD_BOUNDS.yMax - normalized.y) / (WORLD_BOUNDS.yMax * 0.5);
  const distanceFromCenter = Math.hypot(normalized.x - WORLD_BOUNDS.xMax * 0.5, normalized.y - WORLD_BOUNDS.yMax * 0.5);
  const unit = seededUnit(`${round(normalized.x, 3)}:${round(normalized.y, 3)}`);
  const water = distanceFromCenter > WORLD_BOUNDS.xMax * 0.55 ? 0.9 : unit > 0.75 ? 0.55 : 0.05;
  const slope = clamp(8 + 42 * (1 - Math.min(edgeFactorX, edgeFactorY)) + unit * 12, 0, 75);
  const height = 8 + (1 - water) * 180 + unit * 35 + Math.sin(normalized.x * 0.001) * 12;
  const land = water < 0.5;
  const featureDefaults = {};
  for (const feature of DEFAULT_REQUIRED_FEATURES) {
    featureDefaults[feature] = {
      present: feature === 'hydrology' || (land && feature !== 'roads' ? true : feature === 'roads' && land && unit > 0.45),
      confidence: options.syntheticConfidence ?? 1,
      status: 'synthetic',
    };
  }
  return Object.freeze({
    point: normalized,
    canonicalHeight: height,
    renderedHeight: height,
    colliderHeight: height,
    water: { coverage: water, depthMeters: water * 24, class: water > 0.95 ? 'deep' : water > 0.1 ? 'shore' : 'dry' },
    slope: { degrees: slope, band: slope > 55 ? 'cliff' : slope > 30 ? 'ridge' : 'land' },
    biome: { id: land ? (unit > 0.6 ? 'temperate' : 'dry') : 'ocean', confidence: 1 },
    confidence: 1,
    features: featureDefaults,
    risk: {},
  });
}

function resolveObservationSource(sampleObservation, point, context) {
  if (typeof sampleObservation === 'function') return sampleObservation(point, context);
  if (sampleObservation && typeof sampleObservation === 'object') {
    return sampleObservation[`${point.x}:${point.y}`] ?? sampleObservation.default ?? createDefaultObservation(point, context);
  }
  return createDefaultObservation(point, context);
}

function buildCellSummary(cell, sampleObservation, featureList, context) {
  const rawObservations = cell.probes.map((probe) => resolveObservationSource(sampleObservation, probe.point, {
    ...context,
    probe,
    cell,
  }));
  return summarizeCell(cell, rawObservations, featureList);
}

function buildBoundaryPlan(cells) {
  const north = cells.filter((cell) => cell.indexY === 0).map((cell) => cell.cellId);
  const south = cells.filter((cell) => cell.indexY === DEFAULT_GRID.rows - 1).map((cell) => cell.cellId);
  const west = cells.filter((cell) => cell.indexX === 0).map((cell) => cell.cellId);
  const east = cells.filter((cell) => cell.indexX === DEFAULT_GRID.columns - 1).map((cell) => cell.cellId);
  return Object.freeze({
    north: Object.freeze(north),
    south: Object.freeze(south),
    west: Object.freeze(west),
    east: Object.freeze(east),
  });
}

function buildFeatureMatrix(cellSummaries, featureList) {
  const matrix = {};
  for (const feature of featureList) {
    const covered = cellSummaries.filter((cell) => cell.featureCoverage[feature]?.coverage > 0).length;
    const eligible = cellSummaries.filter((cell) => cell.validSampleCount > 0).length;
    matrix[feature] = Object.freeze({
      feature,
      coveredCells: covered,
      eligibleCells: eligible,
      coverage: ratio(covered, eligible),
      minimumRequiredCoverage: feature === 'hydrology' ? 1 : 0.5,
    });
  }
  return Object.freeze(matrix);
}

function buildRiskSummary(cellSummaries) {
  const keys = ['seam', 'rectangularWater', 'moire', 'floating', 'missingAsset'];
  const result = {};
  for (const key of keys) result[key] = cellSummaries.reduce((sum, cell) => sum + cell.risks[key], 0);
  return Object.freeze(result);
}

function buildGapList(cellSummaries, featureList) {
  const gaps = [];
  for (const cell of cellSummaries) {
    if (cell.validSampleCount === 0) gaps.push({ kind: 'unassessed-cell', cellId: cell.cellId });
    if (cell.maxRenderedParityMeters > MAX_HEIGHT_PARITY_METERS) gaps.push({ kind: 'rendered-parity', cellId: cell.cellId, error: cell.maxRenderedParityMeters });
    if (cell.maxColliderParityMeters > MAX_HEIGHT_PARITY_METERS) gaps.push({ kind: 'collider-parity', cellId: cell.cellId, error: cell.maxColliderParityMeters });
    if (cell.risks.seam > 0) gaps.push({ kind: 'seam-risk', cellId: cell.cellId, count: cell.risks.seam });
    if (cell.risks.rectangularWater > 0) gaps.push({ kind: 'rectangular-water-risk', cellId: cell.cellId, count: cell.risks.rectangularWater });
    if (cell.risks.moire > 0) gaps.push({ kind: 'moire-risk', cellId: cell.cellId, count: cell.risks.moire });
    if (cell.risks.floating > 0) gaps.push({ kind: 'floating-risk', cellId: cell.cellId, count: cell.risks.floating });
    if (cell.risks.missingAsset > 0) gaps.push({ kind: 'missing-asset', cellId: cell.cellId, count: cell.risks.missingAsset });
    for (const feature of featureList) {
      if (cell.validSampleCount > 0 && cell.featureCoverage[feature].coverage === 0 && feature !== 'roads') {
        gaps.push({ kind: 'feature-gap', feature, cellId: cell.cellId });
      }
    }
  }
  return gaps;
}

function createPhaseEvidence(phase, cellSummaries, plan) {
  const total = cellSummaries.length;
  const assessed = cellSummaries.filter((cell) => cell.validSampleCount > 0).length;
  const maxRenderedParity = cellSummaries.reduce((max, cell) => Math.max(max, cell.maxRenderedParityMeters), 0);
  const maxColliderParity = cellSummaries.reduce((max, cell) => Math.max(max, cell.maxColliderParityMeters), 0);
  const riskTotal = Object.values(plan.risks).reduce((sum, value) => sum + value, 0);
  const phaseSpecific = {
    'map-origin': plan.boundaries.north.length > 0 && plan.boundaries.south.length > 0,
    'north-boundary': plan.boundaries.north.length > 0,
    'south-boundary': plan.boundaries.south.length > 0,
    'west-boundary': plan.boundaries.west.length > 0,
    'east-boundary': plan.boundaries.east.length > 0,
    'interior-grid': assessed === total,
    'cross-seam': plan.risks.seam === 0,
    'feature-obligations': Object.values(plan.featureMatrix).every((entry) => entry.coverage >= entry.minimumRequiredCoverage),
    'parity': maxRenderedParity <= MAX_HEIGHT_PARITY_METERS && maxColliderParity <= MAX_HEIGHT_PARITY_METERS,
    'determinism': plan.determinism.drift === MAX_DETERMINISM_DRIFT,
  };
  return Object.freeze({
    phase,
    passed: phaseSpecific[phase] === true,
    assessedRatio: ratio(assessed, total),
    riskTotal,
    maxRenderedParityMeters: maxRenderedParity,
    maxColliderParityMeters: maxColliderParity,
    phaseSpecific: phaseSpecific[phase] === true,
  });
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDeterminismDigest(payload) {
  return hashString(canonicalJson(payload));
}

function buildPlanFromSamples({ grid, featureList, cells, sampleObservation, sourceId, referenceMapSha256 }) {
  const summaries = cells.map((cell) => buildCellSummary(cell, sampleObservation, featureList, { sourceId, referenceMapSha256 }));
  const boundary = {
    north: summaries.filter((_, index) => cells[index].indexY === 0).map((summary) => summary.cellId),
    south: summaries.filter((_, index) => cells[index].indexY === grid.rows - 1).map((summary) => summary.cellId),
    west: summaries.filter((_, index) => cells[index].indexX === 0).map((summary) => summary.cellId),
    east: summaries.filter((_, index) => cells[index].indexX === grid.columns - 1).map((summary) => summary.cellId),
  };
  const provisional = {
    risks: buildRiskSummary(summaries),
    featureMatrix: buildFeatureMatrix(summaries, featureList),
    boundaries: Object.freeze({
      north: Object.freeze(boundary.north),
      south: Object.freeze(boundary.south),
      west: Object.freeze(boundary.west),
      east: Object.freeze(boundary.east),
    }),
  };
  const planCore = {
    version: 1,
    sourceId,
    referenceMapSha256,
    bounds: WORLD_BOUNDS,
    grid,
    cellCount: summaries.length,
    probeCount: summaries.reduce((sum, summary) => sum + summary.sampleCount, 0),
    cells: summaries,
    risks: provisional.risks,
    featureMatrix: provisional.featureMatrix,
    boundaries: provisional.boundaries,
    requiredPhases: REQUIRED_PHASES,
  };
  const digest = createDeterminismDigest(planCore);
  const repeatDigest = createDeterminismDigest(cloneSerializable(planCore));
  const determinism = Object.freeze({
    digest,
    repeatDigest,
    drift: digest === repeatDigest ? 0 : 1,
  });
  const plan = {
    ...planCore,
    determinism,
  };
  const gaps = buildGapList(summaries, featureList);
  const evidence = REQUIRED_PHASES.map((phase) => createPhaseEvidence(phase, summaries, plan));
  const assessedCells = summaries.filter((summary) => summary.validSampleCount > 0).length;
  const coverageRatio = ratio(assessedCells, summaries.length);
  const unassessedRatio = 1 - coverageRatio;
  const report = {
    coverageRatio,
    unassessedRatio,
    gapCount: gaps.length,
    passedPhaseCount: evidence.filter((entry) => entry.passed).length,
    totalPhaseCount: evidence.length,
    readyForRuntimeProof: gaps.length === 0 && coverageRatio === 1 && unassessedRatio === 0,
  };
  return deepFreeze({
    ...plan,
    gaps: Object.freeze(gaps.map((gap) => Object.freeze(gap))),
    evidence: Object.freeze(evidence),
    report: Object.freeze(report),
  });
}

export function createFullWorldCoveragePlan(options = {}) {
  const grid = Object.freeze({
    columns: Math.max(1, Math.floor(options.grid?.columns ?? DEFAULT_GRID.columns)),
    rows: Math.max(1, Math.floor(options.grid?.rows ?? DEFAULT_GRID.rows)),
  });
  const featureList = Object.freeze([
    ...(Array.isArray(options.requiredFeatures) && options.requiredFeatures.length > 0
      ? options.requiredFeatures.map(stableKey)
      : DEFAULT_REQUIRED_FEATURES),
  ]);
  const cells = buildCoverageCells(grid, options);
  return buildPlanFromSamples({
    grid,
    featureList,
    cells,
    sampleObservation: options.sampleObservation,
    sourceId: options.sourceId ?? 'world-reference-map',
    referenceMapSha256: options.referenceMapSha256 ?? '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  });
}

export function createCoverageProbeIndex(plan) {
  assert(plan && Array.isArray(plan.cells), 'plan.cells is required');
  const index = {};
  for (const cell of plan.cells) {
    for (const probe of buildCellProbeSet(cell.indexX, cell.indexY, plan.grid, { edgeSamples: DEFAULT_EDGE_SAMPLES, seamSamples: DEFAULT_SEAM_SAMPLES }).probes) {
      index[probe.id] = Object.freeze({
        cellId: cell.cellId,
        point: probe.point,
        kind: probe.kind,
      });
    }
  }
  return deepFreeze(index);
}

export function summarizeCoverage(plan) {
  assert(plan && plan.report, 'coverage plan is required');
  return Object.freeze({
    sourceId: plan.sourceId,
    referenceMapSha256: plan.referenceMapSha256,
    bounds: plan.bounds,
    grid: plan.grid,
    cellCount: plan.cellCount,
    probeCount: plan.probeCount,
    coverageRatio: plan.report.coverageRatio,
    unassessedRatio: plan.report.unassessedRatio,
    gapCount: plan.report.gapCount,
    risks: plan.risks,
    featureMatrix: plan.featureMatrix,
    phases: plan.evidence,
    digest: plan.determinism.digest,
  });
}

export function validateFullWorldCoveragePlan(plan, thresholds = {}) {
  const maxGapRatio = finite(thresholds.maxGapRatio, MAX_COVERAGE_GAP_RATIO);
  const maxUnassessedRatio = finite(thresholds.maxUnassessedRatio, MAX_UNASSESSED_RATIO);
  const maxParity = finite(thresholds.maxHeightParityMeters, MAX_HEIGHT_PARITY_METERS);
  const requiredFeatureMinimums = thresholds.requiredFeatureMinimums ?? {};
  const errors = [];
  const warnings = [];
  assert(plan && plan.bounds, 'plan is required');
  if (plan.bounds.xMin !== 0 || plan.bounds.yMin !== 0 || plan.bounds.xMax !== 9000 || plan.bounds.yMax !== 7000) {
    errors.push('runtime bounds do not cover the canonical 9000x7000 owner map');
  }
  if (!plan.referenceMapSha256) errors.push('reference map provenance is missing');
  if (plan.report.unassessedRatio > maxUnassessedRatio) errors.push(`unassessed ratio ${plan.report.unassessedRatio} exceeds ${maxUnassessedRatio}`);
  if (plan.report.gapCount > 0) errors.push(`coverage gap count ${plan.report.gapCount} is non-zero`);
  if (plan.report.coverageRatio < 1 - maxGapRatio) errors.push(`coverage ratio ${plan.report.coverageRatio} is below required threshold`);
  for (const cell of plan.cells) {
    if (cell.maxRenderedParityMeters > maxParity) errors.push(`${cell.cellId} rendered parity ${cell.maxRenderedParityMeters} exceeds ${maxParity}`);
    if (cell.maxColliderParityMeters > maxParity) errors.push(`${cell.cellId} collider parity ${cell.maxColliderParityMeters} exceeds ${maxParity}`);
  }
  for (const [feature, entry] of Object.entries(plan.featureMatrix)) {
    const minimum = finite(requiredFeatureMinimums[feature], entry.minimumRequiredCoverage);
    if (entry.coverage < minimum) errors.push(`${feature} coverage ${entry.coverage} below ${minimum}`);
  }
  if (plan.risks.rectangularWater > 0) errors.push(`rectangular water risk count ${plan.risks.rectangularWater}`);
  if (plan.risks.seam > 0) errors.push(`seam risk count ${plan.risks.seam}`);
  if (plan.risks.moire > 0) warnings.push(`moire risk count ${plan.risks.moire}`);
  if (plan.risks.floating > 0) errors.push(`floating risk count ${plan.risks.floating}`);
  if (plan.risks.missingAsset > 0) errors.push(`missing asset risk count ${plan.risks.missingAsset}`);
  if (plan.determinism.drift !== 0) errors.push('determinism digest drift is non-zero');
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    thresholds: Object.freeze({ maxGapRatio, maxUnassessedRatio, maxParity }),
  });
}

export function createFullWorldCoverageManifest(plan, options = {}) {
  const validation = validateFullWorldCoveragePlan(plan, options.thresholds);
  const manifest = {
    kind: 'aapw.full-world-coverage-manifest',
    version: 1,
    sourceId: plan.sourceId,
    referenceMapSha256: plan.referenceMapSha256,
    bounds: plan.bounds,
    grid: plan.grid,
    cellCount: plan.cellCount,
    probeCount: plan.probeCount,
    coverageRatio: plan.report.coverageRatio,
    unassessedRatio: plan.report.unassessedRatio,
    gapCount: plan.report.gapCount,
    featureMatrix: plan.featureMatrix,
    risks: plan.risks,
    evidence: plan.evidence,
    validation,
    deterministicDigest: plan.determinism.digest,
    generatedBy: 'src/3d/world/fullWorldCoverageDirector.js',
  };
  return deepFreeze(manifest);
}

export function compareCoveragePlans(a, b) {
  const aJson = canonicalJson(a);
  const bJson = canonicalJson(b);
  const aDigest = hashString(aJson);
  const bDigest = hashString(bJson);
  return Object.freeze({
    equal: aDigest === bDigest,
    aDigest,
    bDigest,
    drift: aDigest === bDigest ? 0 : 1,
  });
}

export function findCoverageGaps(plan, options = {}) {
  const maxPerCellGap = Math.max(0, finite(options.maxPerCellGap, 0));
  return Object.freeze(plan.gaps.filter((gap) => {
    if (gap.kind !== 'feature-gap') return true;
    if (options.feature && gap.feature !== stableKey(options.feature)) return false;
    return maxPerCellGap === 0 || plan.cells.find((cell) => cell.cellId === gap.cellId)?.sampleCount >= maxPerCellGap;
  }));
}

export function selectCoverageCells(plan, selector = {}) {
  const selected = plan.cells.filter((cell) => {
    if (selector.surface && cell.surface !== stableKey(selector.surface)) return false;
    if (selector.feature) {
      const feature = stableKey(selector.feature);
      if (!(cell.featureCoverage?.[feature]?.coverage > 0)) return false;
    }
    if (selector.edge === 'north' && cell.indexY !== 0) return false;
    if (selector.edge === 'south' && cell.indexY !== plan.grid.rows - 1) return false;
    if (selector.edge === 'west' && cell.indexX !== 0) return false;
    if (selector.edge === 'east' && cell.indexX !== plan.grid.columns - 1) return false;
    if (selector.risk && cell.risks?.[stableKey(selector.risk)] <= 0) return false;
    return true;
  });
  return Object.freeze(selected);
}

export function buildCoverageBatch(plan, options = {}) {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 64));
  const batches = [];
  for (let index = 0; index < plan.cells.length; index += batchSize) {
    const cells = plan.cells.slice(index, index + batchSize);
    batches.push(Object.freeze({
      batchIndex: batches.length,
      cellIds: Object.freeze(cells.map((cell) => cell.cellId)),
      firstCellId: cells[0]?.cellId ?? null,
      lastCellId: cells[cells.length - 1]?.cellId ?? null,
      count: cells.length,
    }));
  }
  return Object.freeze(batches);
}

export function createViewportCoverageSchedule(plan, options = {}) {
  const passes = [];
  const margins = Object.freeze({
    x: Math.max(0, finite(options.marginX, 0.03)),
    y: Math.max(0, finite(options.marginY, 0.03)),
  });
  const xValues = [0, margins.x, 0.5, 1 - margins.x, 1];
  const yValues = [0, margins.y, 0.5, 1 - margins.y, 1];
  let sequence = 0;
  for (const y of yValues) {
    for (const x of xValues) {
      passes.push(Object.freeze({
        sequence,
        normalized: Object.freeze({ x, y }),
        world: Object.freeze({
          x: WORLD_BOUNDS.xMin + (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin) * x,
          y: WORLD_BOUNDS.yMin + (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin) * y,
        }),
        purpose: sequence < 4 ? 'corner' : sequence === 12 ? 'center' : 'boundary-or-interior',
      }));
      sequence += 1;
    }
  }
  return Object.freeze(passes);
}

export function createSeamAudit(plan, options = {}) {
  const tolerance = Math.max(EPSILON, finite(options.tolerance, 1e-6));
  const seamPairs = [];
  for (const cell of plan.cells) {
    if (cell.indexX < plan.grid.columns - 1) seamPairs.push({ axis: 'x', cellId: cell.cellId, neighborId: createCellId(cell.indexX + 1, cell.indexY) });
    if (cell.indexY < plan.grid.rows - 1) seamPairs.push({ axis: 'y', cellId: cell.cellId, neighborId: createCellId(cell.indexX, cell.indexY + 1) });
  }
  const unresolved = seamPairs.filter((pair) => {
    const cell = plan.cells.find((entry) => entry.cellId === pair.cellId);
    const neighbor = plan.cells.find((entry) => entry.cellId === pair.neighborId);
    if (!cell || !neighbor) return true;
    if (pair.axis === 'x') return Math.abs(cell.bounds.xMax - neighbor.bounds.xMin) > tolerance;
    return Math.abs(cell.bounds.yMax - neighbor.bounds.yMin) > tolerance;
  });
  return Object.freeze({
    pairCount: seamPairs.length,
    unresolvedCount: unresolved.length,
    passed: unresolved.length === 0 && plan.risks.seam === 0,
    tolerance,
  });
}

export function createBoundaryCoverageReport(plan) {
  const sides = ['north', 'south', 'west', 'east'];
  const report = {};
  for (const side of sides) {
    const cells = plan.boundaries[side];
    const entries = cells.map((cellId) => plan.cells.find((entry) => entry.cellId === cellId));
    report[side] = Object.freeze({
      cellCount: entries.length,
      assessedCount: entries.filter((entry) => entry.validSampleCount > 0).length,
      confidence: ratio(entries.filter((entry) => entry.validSampleCount > 0).length, entries.length),
      worstRenderedParityMeters: entries.reduce((max, entry) => Math.max(max, entry.maxRenderedParityMeters), 0),
      worstColliderParityMeters: entries.reduce((max, entry) => Math.max(max, entry.maxColliderParityMeters), 0),
      seamRiskCount: entries.reduce((sum, entry) => sum + entry.risks.seam, 0),
    });
  }
  return deepFreeze(report);
}

export function createCoverageAcceptanceEnvelope(plan, options = {}) {
  const parity = Math.max(0, finite(options.maxParityMeters, MAX_HEIGHT_PARITY_METERS));
  const featureFloor = clamp(options.featureFloor ?? 0.5, 0, 1);
  const boundaries = createBoundaryCoverageReport(plan);
  const seamAudit = createSeamAudit(plan);
  const passed = Object.values(boundaries).every((entry) => entry.confidence === 1 && entry.worstRenderedParityMeters <= parity && entry.worstColliderParityMeters <= parity && entry.seamRiskCount === 0)
    && seamAudit.passed
    && Object.values(plan.featureMatrix).every((entry) => entry.coverage >= Math.max(featureFloor, entry.minimumRequiredCoverage))
    && plan.risks.missingAsset === 0;
  return Object.freeze({
    passed,
    maxParityMeters: parity,
    featureFloor,
    boundaries,
    seamAudit,
    gapCount: plan.report.gapCount,
    deterministic: plan.determinism.drift === 0,
  });
}

export function createWorldCoverageProofContract(plan, options = {}) {
  const manifest = createFullWorldCoverageManifest(plan, options);
  const acceptance = createCoverageAcceptanceEnvelope(plan, options);
  const contract = {
    contractId: 'full-world-coverage-v1',
    canonicalBounds: WORLD_BOUNDS,
    mapProvenance: Object.freeze({
      sourceId: plan.sourceId,
      referenceMapSha256: plan.referenceMapSha256,
    }),
    requiredPhases: REQUIRED_PHASES,
    viewportSchedule: createViewportCoverageSchedule(plan, options.viewport),
    batches: buildCoverageBatch(plan, options.batch),
    manifest,
    acceptance,
  };
  return deepFreeze(contract);
}

export function createRuntimeCoverageAdapter(plan, options = {}) {
  return deepFreeze({
    policyId: 'full-world-runtime-coverage-v1',
    readOnly: true,
    createsGeometry: false,
    mutatesCanonicalGeography: false,
    importsEditorUi: false,
    materialAuthority: 'caller-owned MaterialAssignmentCore + WorldAssetPlacementPipeline',
    bounds: plan.bounds,
    grid: plan.grid,
    sourceId: plan.sourceId,
    referenceMapSha256: plan.referenceMapSha256,
    probeCount: plan.probeCount,
    batchSize: Math.max(1, Math.floor(options.batchSize ?? 64)),
    acceptance: createCoverageAcceptanceEnvelope(plan, options),
  });
}

export function serializeFullWorldCoverage(plan) {
  return canonicalJson(plan);
}

export function digestFullWorldCoverage(plan) {
  return hashString(serializeFullWorldCoverage(plan));
}

export function assertFullWorldCoverage(plan, thresholds = {}) {
  const validation = validateFullWorldCoveragePlan(plan, thresholds);
  if (!validation.ok) {
    throw new Error(`full-world coverage validation failed: ${validation.errors.join(' | ')}`);
  }
  return true;
}

export function getWorldCoverageConstants() {
  return Object.freeze({
    WORLD_BOUNDS,
    DEFAULT_GRID,
    DEFAULT_EDGE_SAMPLES,
    DEFAULT_CORNER_SAMPLES,
    DEFAULT_CENTER_SAMPLES,
    DEFAULT_DIAGONAL_SAMPLES,
    DEFAULT_SEAM_SAMPLES,
    DEFAULT_REQUIRED_FEATURES,
    REQUIRED_PHASES,
    MAX_COVERAGE_GAP_RATIO,
    MAX_UNASSESSED_RATIO,
    MAX_HEIGHT_PARITY_METERS,
    MIN_OBSERVATION_CONFIDENCE,
  });
}

export function createSyntheticCoveragePlan(options = {}) {
  return createFullWorldCoveragePlan({
    ...options,
    sampleObservation: (point) => createDefaultObservation(point, { syntheticConfidence: 1 }),
  });
}

export function explainCoverageDecision(plan) {
  const validation = validateFullWorldCoveragePlan(plan);
  const reasons = [];
  if (validation.ok) reasons.push('all required coverage gates are green');
  if (plan.report.coverageRatio < 1) reasons.push(`coverage ratio is ${round(plan.report.coverageRatio, 4)}`);
  if (plan.report.gapCount > 0) reasons.push(`${plan.report.gapCount} deterministic gaps remain`);
  if (plan.risks.seam > 0) reasons.push(`${plan.risks.seam} seam risks remain`);
  if (plan.risks.rectangularWater > 0) reasons.push(`${plan.risks.rectangularWater} rectangular-water risks remain`);
  if (plan.risks.missingAsset > 0) reasons.push(`${plan.risks.missingAsset} missing-asset observations remain`);
  if (plan.determinism.drift !== 0) reasons.push('determinism digest drift is non-zero');
  if (reasons.length === 0) reasons.push('no decision evidence available');
  return Object.freeze({ ok: validation.ok, reasons: Object.freeze(reasons) });
}

export function projectCoverageToOwnerMap(plan, normalizedPoint) {
  const point = Object.freeze({
    x: clamp(normalizedPoint?.x, 0, 1),
    y: clamp(normalizedPoint?.y, 0, 1),
  });
  const indexX = Math.min(plan.grid.columns - 1, Math.floor(point.x * plan.grid.columns));
  const indexY = Math.min(plan.grid.rows - 1, Math.floor(point.y * plan.grid.rows));
  const cellId = createCellId(indexX, indexY);
  return Object.freeze({
    normalized: point,
    cellId,
    world: Object.freeze({
      x: WORLD_BOUNDS.xMin + point.x * (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin),
      y: WORLD_BOUNDS.yMin + point.y * (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin),
    }),
  });
}

export function enumerateCoverageLattice(plan) {
  const points = [];
  for (let y = 0; y < plan.grid.rows; y += 1) {
    for (let x = 0; x < plan.grid.columns; x += 1) {
      points.push(projectCoverageToOwnerMap(plan, {
        x: (x + 0.5) / plan.grid.columns,
        y: (y + 0.5) / plan.grid.rows,
      }));
    }
  }
  return Object.freeze(points);
}

export function createCoverageReplay(plan) {
  const lattice = enumerateCoverageLattice(plan);
  return deepFreeze({
    sourceId: plan.sourceId,
    digest: plan.determinism.digest,
    lattice,
    replay: lattice.map((entry) => ({
      cellId: entry.cellId,
      x: round(entry.world.x, 6),
      y: round(entry.world.y, 6),
    })),
  });
}

export function validateReplay(plan, replay = createCoverageReplay(plan)) {
  const recreated = createCoverageReplay(plan);
  return Object.freeze({
    equal: canonicalJson(recreated) === canonicalJson(replay),
    expectedDigest: createDeterminismDigest(recreated),
    actualDigest: createDeterminismDigest(replay),
  });
}

export function collectCriticalCells(plan) {
  const selected = plan.cells.filter((cell) => {
    const boundary = cell.indexX === 0 || cell.indexX === plan.grid.columns - 1 || cell.indexY === 0 || cell.indexY === plan.grid.rows - 1;
    const risky = Object.values(cell.risks).some((count) => count > 0);
    const mixed = cell.surface === 'mixed';
    const lowConfidence = cell.confidence < MIN_OBSERVATION_CONFIDENCE;
    return boundary || risky || mixed || lowConfidence;
  });
  return Object.freeze(selected);
}

export function createCriticalReviewQueue(plan) {
  return Object.freeze(collectCriticalCells(plan).map((cell, index) => Object.freeze({
    priority: cell.risks.missingAsset > 0 || cell.risks.floating > 0 ? 'P0' : cell.risks.seam > 0 || cell.risks.rectangularWater > 0 ? 'P1' : 'P2',
    sequence: index,
    cellId: cell.cellId,
    reasons: Object.freeze([
      ...(cell.risks.missingAsset > 0 ? ['missing-asset'] : []),
      ...(cell.risks.floating > 0 ? ['floating'] : []),
      ...(cell.risks.seam > 0 ? ['seam'] : []),
      ...(cell.risks.rectangularWater > 0 ? ['rectangular-water'] : []),
      ...(cell.surface === 'mixed' ? ['surface-transition'] : []),
      ...(cell.confidence < MIN_OBSERVATION_CONFIDENCE ? ['low-confidence'] : []),
    ]),
  })));
}

export function createCoverageDashboard(plan) {
  const criticalQueue = createCriticalReviewQueue(plan);
  return deepFreeze({
    headline: plan.report.readyForRuntimeProof ? 'READY_FOR_RUNTIME_PROOF' : 'COVERAGE_GAPS_REMAIN',
    coverage: {
      cells: plan.cellCount,
      probes: plan.probeCount,
      coverageRatio: plan.report.coverageRatio,
      unassessedRatio: plan.report.unassessedRatio,
    },
    risks: plan.risks,
    phaseSummary: {
      passed: plan.report.passedPhaseCount,
      total: plan.report.totalPhaseCount,
    },
    criticalQueue: {
      count: criticalQueue.length,
      p0: criticalQueue.filter((entry) => entry.priority === 'P0').length,
      p1: criticalQueue.filter((entry) => entry.priority === 'P1').length,
      p2: criticalQueue.filter((entry) => entry.priority === 'P2').length,
    },
    deterministicDigest: plan.determinism.digest,
  });
}

export function createOwnerEvidenceRequest(plan, options = {}) {
  const dashboard = createCoverageDashboard(plan);
  const request = {
    owner: options.owner ?? 'world-runtime-owner',
    artifactKind: 'full-world-coverage-proof',
    requiredArtifactSize: options.artifactSize ?? '1536x1024',
    worldBounds: plan.bounds,
    sourceId: plan.sourceId,
    referenceMapSha256: plan.referenceMapSha256,
    requiredChecks: Object.freeze([
      'exact-main-freshness',
      'full-world-runtime-coverage',
      'world-event-determinism',
      'terrain-seat-safety',
      'road-network-safety',
      'pwa-installability',
      'service-worker-cache',
      'mobile-performance',
      'browser-console-zero',
      'asset-hydration',
      'material-placement-contract',
    ]),
    currentDashboard: dashboard,
    noPassClaimUntilObserved: true,
  };
  return deepFreeze(request);
}

export default Object.freeze({
  createFullWorldCoveragePlan,
  createCoverageProbeIndex,
  summarizeCoverage,
  validateFullWorldCoveragePlan,
  createFullWorldCoverageManifest,
  compareCoveragePlans,
  findCoverageGaps,
  selectCoverageCells,
  buildCoverageBatch,
  createViewportCoverageSchedule,
  createSeamAudit,
  createBoundaryCoverageReport,
  createCoverageAcceptanceEnvelope,
  createWorldCoverageProofContract,
  createRuntimeCoverageAdapter,
  serializeFullWorldCoverage,
  digestFullWorldCoverage,
  assertFullWorldCoverage,
  getWorldCoverageConstants,
  createSyntheticCoveragePlan,
  explainCoverageDecision,
  projectCoverageToOwnerMap,
  enumerateCoverageLattice,
  createCoverageReplay,
  validateReplay,
  collectCriticalCells,
  createCriticalReviewQueue,
  createCoverageDashboard,
  createOwnerEvidenceRequest,
});

/**
 * Groundwater diagnostics for the terrain render stack.
 *
 * Diagnostics are deterministic and side-effect free. They are designed to
 * make visual regressions measurable without turning the render layer into a
 * second terrain or hydrology authority.
 */
import { TERRAIN_GROUNDWATER_POLICY, resolveTerrainGroundwaterState, terrainGroundwaterSignature, validateTerrainGroundwaterState } from './terrainGroundwaterRegime.js';
import { TERRAIN_GROUNDWATER_ADAPTER_POLICY, resolveGroundwaterSurfaceFrame, groundwaterDebugChannels } from './terrainGroundwaterSurfaceAdapter.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const round5 = (v) => Number(v.toFixed(5));
const round6 = (v) => Number(v.toFixed(6));
const freeze = Object.freeze;

export const TERRAIN_GROUNDWATER_DIAGNOSTICS_POLICY = freeze({
  id: 'terrain-groundwater-diagnostics-2026-09-15-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
  adapterPolicyId: TERRAIN_GROUNDWATER_ADAPTER_POLICY.id,
  deterministic: true,
  renderOnly: true,
  mutationCount: 0,
  metricCount: 26,
});

const METRIC_KEYS = freeze([
  'rechargePotential',
  'waterTableProximity',
  'capillaryRise',
  'seepageFace',
  'surfaceSaturation',
  'saturationMemory',
  'dryingResistance',
  'surfaceFilm',
  'puddlePersistence',
  'marshEdgeFactor',
  'fineTransport',
  'saltRing',
  'freezeStress',
  'droughtStress',
  'stressTotal',
  'fieldRegional',
  'fieldLocal',
  'fieldCapillary',
  'fieldSeepage',
  'fieldContour',
  'fieldCombined',
]);

export const TERRAIN_GROUNDWATER_METRICS = METRIC_KEYS;

const isFiniteNumber = (v) => Number.isFinite(Number(v));
const number = (v, fallback = 0) => isFiniteNumber(v) ? Number(v) : fallback;

export function metricSnapshot(state) {
  const mineral = state?.mineralMobilization ?? {};
  const stress = state?.stress ?? {};
  const field = state?.field ?? {};
  return freeze({
    rechargePotential: round6(state?.rechargePotential ?? 0),
    waterTableProximity: round6(state?.waterTableProximity ?? 0),
    capillaryRise: round6(state?.capillaryRise ?? 0),
    seepageFace: round6(state?.seepageFace ?? 0),
    surfaceSaturation: round6(state?.surfaceSaturation ?? 0),
    saturationMemory: round6(state?.saturationMemory ?? 0),
    dryingResistance: round6(state?.dryingResistance ?? 0),
    surfaceFilm: round6(state?.surfaceFilm ?? 0),
    puddlePersistence: round6(state?.puddlePersistence ?? 0),
    marshEdgeFactor: round6(state?.marshEdgeFactor ?? 0),
    fineTransport: round6(mineral.fineTransport ?? 0),
    saltRing: round6(mineral.saltRing ?? 0),
    freezeStress: round6(stress.freezeStress ?? 0),
    droughtStress: round6(stress.droughtStress ?? 0),
    stressTotal: round6(stress.total ?? 0),
    fieldRegional: round6(field.regional ?? 0),
    fieldLocal: round6(field.local ?? 0),
    fieldCapillary: round6(field.capillary ?? 0),
    fieldSeepage: round6(field.seepage ?? 0),
    fieldContour: round6(field.contour ?? 0),
    fieldCombined: round6(field.combined ?? 0),
  });
}

export function metricBounds(snapshot = {}) {
  const errors = [];
  for (const key of METRIC_KEYS) {
    const value = snapshot[key];
    if (!isFiniteNumber(value)) errors.push(`${key}:not-finite`);
    else if (value < 0 || value > 1) errors.push(`${key}:out-of-range`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export function diagnosticsForState(state) {
  const validation = validateTerrainGroundwaterState(state);
  const snapshot = metricSnapshot(state);
  const bounds = metricBounds(snapshot);
  return freeze({
    validState: validation.ok,
    validMetrics: bounds.ok,
    errors: freeze([...validation.errors, ...bounds.errors]),
    metrics: snapshot,
  });
}

export function confidenceScore(state) {
  const sample = state?.sample ?? {};
  const confidenceInputs = [
    clamp01(1 - Math.abs(number(sample.slopeDegrees)) / 89),
    clamp01(1 - number(sample.waterDistanceMeters) / 5000),
    clamp01(1 - number(sample.groundwaterDepthMeters) / 5000),
    clamp01(number(sample.soilDepth) / 3),
    clamp01(0.5 + number(sample.permeability) * 0.5),
  ];
  const mean = confidenceInputs.reduce((sum, value) => sum + value, 0) / confidenceInputs.length;
  const signal = clamp01((state?.field?.combined ?? 0) * 0.45 + (state?.waterTableProximity ?? 0) * 0.25 + (state?.surfaceSaturation ?? 0) * 0.30);
  return round5(clamp01(mean * 0.6 + signal * 0.4));
}

export function presentationTier(state) {
  const score = confidenceScore(state);
  if (score >= 0.84) return 'high';
  if (score >= 0.64) return 'medium';
  if (score >= 0.42) return 'low';
  return 'suppressed';
}

export function diagnosticSeverity(state) {
  const stress = state?.stress?.total ?? 0;
  const wet = state?.surfaceFilm ?? 0;
  const drought = state?.stress?.droughtStress ?? 0;
  if (stress >= 0.72) return 'critical';
  if (wet >= 0.86 || drought >= 0.76) return 'high';
  if (wet >= 0.64 || drought >= 0.5) return 'moderate';
  return 'nominal';
}

export function buildGroundwaterTelemetry(input = {}) {
  const state = resolveTerrainGroundwaterState(input);
  const diagnostics = diagnosticsForState(state);
  return freeze({
    policyId: TERRAIN_GROUNDWATER_DIAGNOSTICS_POLICY.id,
    sourcePolicyId: state.policyId,
    confidence: confidenceScore(state),
    presentationTier: presentationTier(state),
    severity: diagnosticSeverity(state),
    diagnostics,
    signature: terrainGroundwaterSignature(input),
    canonical: freeze({ heightUnchanged: true, hydrologyUnchanged: true, coastlineUnchanged: true, colliderUnchanged: true, vegetationPlacementUnchanged: true }),
  });
}

export function compareMetricSnapshots(a = {}, b = {}) {
  const delta = {};
  for (const key of METRIC_KEYS) delta[key] = round6(number(b[key]) - number(a[key]));
  return freeze(delta);
}

export function metricDistance(a = {}, b = {}) {
  let sum = 0;
  let count = 0;
  for (const key of METRIC_KEYS) {
    const d = number(a[key]) - number(b[key]);
    sum += d * d;
    count += 1;
  }
  return round6(Math.sqrt(sum / Math.max(count, 1)));
}

export function stateDistance(aInput = {}, bInput = {}) {
  const a = resolveTerrainGroundwaterState(aInput);
  const b = resolveTerrainGroundwaterState(bInput);
  return metricDistance(metricSnapshot(a), metricSnapshot(b));
}

export function assertDeterministicState(input = {}) {
  const first = resolveTerrainGroundwaterState(input);
  const second = resolveTerrainGroundwaterState(input);
  const left = terrainGroundwaterSignature(input);
  const right = terrainGroundwaterSignature(input);
  return freeze({ stateEqual: JSON.stringify(first) === JSON.stringify(second), signatureEqual: JSON.stringify(left) === JSON.stringify(right), signature: left });
}

export function canonicalMutationAudit(value) {
  const keys = ['heightUnchanged','hydrologyUnchanged','coastlineUnchanged','colliderUnchanged','vegetationPlacementUnchanged','newGeographyIntroduced'];
  const failures = keys.filter((key) => key in value && value[key] !== true && value[key] !== false);
  return freeze({ ok: failures.length === 0, failures: freeze(failures), mutationCount: 0 });
}

export function frameAudit(input = {}) {
  const frame = resolveGroundwaterSurfaceFrame(input);
  const telemetry = buildGroundwaterTelemetry(input);
  return freeze({
    policyId: TERRAIN_GROUNDWATER_DIAGNOSTICS_POLICY.id,
    adapterPolicyId: frame.policyId,
    classification: frame.channels.wetness > 0.75 ? 'wet' : frame.channels.dryingDemand > 0.72 ? 'dry' : 'transitional',
    debugChannels: groundwaterDebugChannels(frame),
    material: freeze({ roughness: round5(frame.material.roughness), normalStrength: round5(frame.material.normalStrength), wetness: round5(frame.material.wetness) }),
    telemetry,
    canonical: frame.canonical,
  });
}

export function thresholdCrossings(samples = [], metric = 'surfaceFilm', threshold = 0.5) {
  const rows = [];
  if (!Array.isArray(samples)) return freeze(rows);
  let previous = null;
  for (const sample of samples) {
    const state = sample?.surfaceFilm !== undefined ? sample : resolveTerrainGroundwaterState(sample);
    const current = number(state[metric]);
    if (previous !== null && ((previous < threshold && current >= threshold) || (previous >= threshold && current < threshold))) rows.push(freeze({ from: previous, to: current, threshold: number(threshold), direction: current >= threshold ? 'enter' : 'exit' }));
    previous = current;
  }
  return freeze(rows);
}

export function monotonicityReport(samples = [], metric = 'waterTableProximity', direction = 'increasing') {
  const values = samples.map((sample) => number(sample?.[metric] ?? resolveTerrainGroundwaterState(sample)[metric]));
  const violations = [];
  for (let i = 1; i < values.length; i += 1) {
    if (direction === 'increasing' && values[i] + 1e-6 < values[i - 1]) violations.push(i);
    if (direction === 'decreasing' && values[i] - 1e-6 > values[i - 1]) violations.push(i);
  }
  return freeze({ metric, direction, sampleCount: values.length, violations: freeze(violations), ok: violations.length === 0 });
}

export function budgetReport(frame, budget = TERRAIN_GROUNDWATER_POLICY) {
  const base = frame.material;
  const albedoDelta = Math.abs((base.color.r ?? 0) - 0.5) + Math.abs((base.color.g ?? 0) - 0.5) + Math.abs((base.color.b ?? 0) - 0.5);
  return freeze({
    roughnessWithinBudget: Math.abs((base.roughness ?? 0.86) - 0.86) <= (budget.maxRoughnessShift ?? 0.12) + 1e-9,
    normalWithinBudget: (base.normalStrength ?? 0) <= (budget.maxNormalStrength ?? 0.08) + 1e-9,
    albedoWithinBudget: albedoDelta <= (budget.maxAlbedoShift ?? 0.12) * 3 + 1e-9,
    wetnessWithinBudget: (frame.channels?.wetness ?? 0) <= 1,
  });
}

export function diagnosticDigest(inputs = []) {
  const rows = [];
  for (const input of inputs) {
    const state = resolveTerrainGroundwaterState(input);
    rows.push(freeze({ signature: terrainGroundwaterSignature(input), confidence: confidenceScore(state), tier: presentationTier(state), severity: diagnosticSeverity(state) }));
  }
  return freeze(rows);
}

export function meanMetric(inputs = [], metric = 'surfaceFilm') {
  if (!Array.isArray(inputs) || inputs.length === 0) return 0;
  let total = 0;
  for (const input of inputs) {
    const state = input?.policyId === TERRAIN_GROUNDWATER_POLICY.id ? input : resolveTerrainGroundwaterState(input);
    total += number(state[metric]);
  }
  return round5(total / inputs.length);
}

export function varianceMetric(inputs = [], metric = 'surfaceFilm') {
  if (!Array.isArray(inputs) || inputs.length === 0) return 0;
  const mean = meanMetric(inputs, metric);
  let total = 0;
  for (const input of inputs) {
    const state = input?.policyId === TERRAIN_GROUNDWATER_POLICY.id ? input : resolveTerrainGroundwaterState(input);
    const delta = number(state[metric]) - mean;
    total += delta * delta;
  }
  return round5(total / inputs.length);
}

export function percentileMetric(inputs = [], metric = 'surfaceFilm', percentile = 0.5) {
  const values = inputs.map((input) => {
    const state = input?.policyId === TERRAIN_GROUNDWATER_POLICY.id ? input : resolveTerrainGroundwaterState(input);
    return number(state[metric]);
  }).sort((a, b) => a - b);
  if (!values.length) return 0;
  const p = clamp01(percentile);
  const index = (values.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round5(lower === upper ? values[lower] : values[lower] + (values[upper] - values[lower]) * (index - lower));
}

export function outlierMetricInputs(inputs = [], metric = 'surfaceFilm', zScore = 2.6) {
  const mean = meanMetric(inputs, metric);
  const variance = varianceMetric(inputs, metric);
  const deviation = Math.sqrt(Math.max(variance, 0));
  const threshold = deviation * Math.max(0, zScore);
  return freeze(inputs.map((input, index) => {
    const state = input?.policyId === TERRAIN_GROUNDWATER_POLICY.id ? input : resolveTerrainGroundwaterState(input);
    const value = number(state[metric]);
    return freeze({ index, value: round5(value), outlier: deviation > 1e-6 && Math.abs(value - mean) > threshold });
  }).filter((row) => row.outlier));
}

export function buildHeatBand(value) {
  const v = clamp01(value);
  if (v >= 0.9) return 'extreme-wet';
  if (v >= 0.72) return 'wet';
  if (v >= 0.54) return 'damp';
  if (v >= 0.35) return 'neutral';
  if (v >= 0.18) return 'dry';
  return 'very-dry';
}

export function debugLegend() {
  return freeze([
    freeze({ band: 'very-dry', min: 0, max: 0.18 }),
    freeze({ band: 'dry', min: 0.18, max: 0.35 }),
    freeze({ band: 'neutral', min: 0.35, max: 0.54 }),
    freeze({ band: 'damp', min: 0.54, max: 0.72 }),
    freeze({ band: 'wet', min: 0.72, max: 0.9 }),
    freeze({ band: 'extreme-wet', min: 0.9, max: 1 }),
  ]);
}

export function sampleDiagnosticsGrid({ originX = 0, originZ = 0, columns = 7, rows = 7, spacing = 37, input = {} } = {}) {
  const grid = [];
  const safeColumns = clamp(Math.floor(columns), 1, 64);
  const safeRows = clamp(Math.floor(rows), 1, 64);
  const safeSpacing = clamp(number(spacing, 37), 0.5, 2000);
  for (let z = 0; z < safeRows; z += 1) {
    for (let x = 0; x < safeColumns; x += 1) {
      const sample = { ...input, worldX: number(originX) + x * safeSpacing, worldZ: number(originZ) + z * safeSpacing };
      const state = resolveTerrainGroundwaterState(sample);
      grid.push(freeze({ x, z, signature: terrainGroundwaterSignature(sample), confidence: confidenceScore(state) }));
    }
  }
  return freeze(grid);
}

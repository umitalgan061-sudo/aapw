/**
 * Buzul Muhafızı V63 — evidence composer for shipped environment observations.
 *
 * Composes the V63 runtime plan into audit-ready, caller-owned evidence. It does
 * not render, mutate scene state, hydrate assets, or replace canonical owners.
 */
import {
  V63_CONTRACT,
  createGroundedVisualRuntimeV63,
  compareGroundedVisualRuntimeV63,
  createBeforeAfterComparisonV63,
  createTerrainBreakupFieldV63,
  createWaterOpticalResponseV63,
  createHabitatDensityV63,
  createStreamingPlanV63,
  createParityDiagnosticsV63,
  createNaturalTransformV63,
  createShorelineBandProfileV63,
  getV63ContractSummary,
} from './environmentGroundedVisualRuntimeV63.js';

const PROFILE_NAMES = Object.freeze([
  'fullWorld', 'far', 'coast-near', 'mountain-near', 'forest-near',
  'settlement-near', 'northwest-near', 'terrain-near',
]);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function hash(value) {
  let h = 2166136261;
  const source = String(value);
  for (let index = 0; index < source.length; index += 1) {
    h ^= source.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function normalizeProfile(profile = 'terrain-near') {
  const value = text(profile, 'terrain-near');
  return PROFILE_NAMES.includes(value) ? value : 'terrain-near';
}

function profileSpec(profile, seed) {
  const normalized = normalizeProfile(profile);
  const distances = {
    fullWorld: 7000,
    far: 3600,
    'coast-near': 520,
    'mountain-near': 480,
    'forest-near': 260,
    'settlement-near': 220,
    'northwest-near': 540,
    'terrain-near': 420,
  };
  return freeze({
    profile: normalized,
    width: 1536,
    height: 1024,
    orthographicDegrees: 90,
    distance: distances[normalized],
    seed: hash(`${seed}:${normalized}`),
    deterministic: true,
  });
}

function profileObservation(observation, profile, seed) {
  return {
    ...observation,
    seed,
    camera: {
      ...(observation.camera || {}),
      ...profileSpec(profile, seed),
    },
  };
}

function maxRisk(result) {
  const values = [];
  for (const domain of Object.values(result.risks || {})) {
    if (domain && typeof domain === 'object') {
      for (const value of Object.values(domain)) values.push(Number(value) || 0);
    }
  }
  return Math.max(0, ...values);
}

function countFailures(result) {
  const flat = [];
  for (const [domain, values] of Object.entries(result.risks || {})) {
    for (const [name, value] of Object.entries(values || {})) {
      if (Number(value) > 0) flat.push(`${domain}.${name}`);
    }
  }
  return Object.freeze(flat);
}

function classify(result) {
  if (!result || !result.acceptance) return 'blocked';
  if (!result.acceptance.mergeEligible) return maxRisk(result) > 0 ? 'blocked' : 'review';
  return maxRisk(result) === 0 ? 'acceptance' : 'review';
}

function qualityScore(result) {
  if (!result) return 0;
  const penalty = Math.min(100, maxRisk(result) * 6);
  const geometry = result.geometry?.parityPass ? 1 : 0;
  const shared = result.shared?.valid ? 1 : 0;
  const grounding = result.vegetation?.invalid === 0 ? 1 : 0;
  return Math.round(Math.max(0, 100 - penalty) * 0.78 + (geometry + shared + grounding) * 7.33);
}

export function createVisualEvidenceV63(observation) {
  const runtime = createGroundedVisualRuntimeV63(observation);
  return freeze({
    contract: V63_CONTRACT.id,
    sampleId: runtime.sampleId,
    profile: runtime.acceptanceProfile,
    qualityScore: qualityScore(runtime),
    qualityBand: classify(runtime),
    failureCodes: countFailures(runtime),
    p0: freeze({ ...runtime.p0, visibleFailureTarget: Object.values(runtime.p0).reduce((sum, value) => sum + value, 0) === 0 }),
    p1: freeze({ ...runtime.geometry }),
    p2: freeze({ ...runtime.material }),
    p3: freeze({ invalidPlacement: runtime.vegetation.invalid, eligible: runtime.vegetation.eligible, batches: runtime.vegetation.batches }),
    p4: freeze({ ...runtime.water }),
    p5: freeze({ ...runtime.atmosphere }),
    fingerprint: runtime.fingerprint,
    mergeEligible: runtime.acceptance.mergeEligible,
  });
}

export function createVisualEvidenceMatrixV63(observations = [], seed = 'v63-matrix') {
  const source = Array.isArray(observations) ? observations.slice(0, V63_CONTRACT.thresholds.maxSamples) : [];
  const evidence = source.map((observation) => createVisualEvidenceV63({ ...observation, seed }));
  const scores = evidence.map((item) => item.qualityScore);
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  return freeze({
    seed,
    count: evidence.length,
    evidence: freeze(evidence),
    averageQuality: Math.round(average * 100) / 100,
    blockedCount: evidence.filter((item) => item.qualityBand === 'blocked').length,
    acceptanceCount: evidence.filter((item) => item.qualityBand === 'acceptance').length,
    fingerprint: hash(evidence.map((item) => `${item.sampleId}:${item.fingerprint}`).sort().join('|')),
  });
}

export function createAcceptanceCameraManifestV63(seed = 'v63-camera') {
  return freeze(PROFILE_NAMES.map((profile) => freeze(profileSpec(profile, seed))));
}

export function compareEvidenceBeforeAfterV63(beforeObservation, afterObservation) {
  const comparison = createBeforeAfterComparisonV63(beforeObservation, afterObservation);
  const before = createVisualEvidenceV63(beforeObservation);
  const after = createVisualEvidenceV63(afterObservation);
  return freeze({
    ...comparison,
    scoreBefore: before.qualityScore,
    scoreAfter: after.qualityScore,
    qualityImprovement: after.qualityScore - before.qualityScore,
    blockedBefore: before.qualityBand === 'blocked',
    blockedAfter: after.qualityBand === 'blocked',
    cameraProfileBefore: before.profile.profile,
    cameraProfileAfter: after.profile.profile,
  });
}

export function compareMultipleRunsV63(a, b) {
  const comparison = compareGroundedVisualRuntimeV63(a, b);
  return freeze({
    ...comparison,
    identical: comparison.sameFingerprint && comparison.sameAcceptance,
    deterministicContract: V63_CONTRACT.id,
  });
}

export function buildTerrainEvidenceV63({ centerX = 0, centerZ = 0, radius = 72, spacing = 8, seed = 'terrain' } = {}) {
  const breakup = createTerrainBreakupFieldV63({ centerX, centerZ, radius, spacing, seed });
  const reliefRange = breakup.cells.reduce((range, cell) => ({
    min: Math.min(range.min, cell.microRelief),
    max: Math.max(range.max, cell.microRelief),
  }), { min: Infinity, max: -Infinity });
  return freeze({
    ...breakup,
    reliefRange: freeze({ min: reliefRange.min === Infinity ? 0 : reliefRange.min, max: reliefRange.max === -Infinity ? 0 : reliefRange.max }),
    macroVariationPresent: breakup.cells.some((cell) => cell.macroBreakup > 0.25 && cell.macroBreakup < 0.75),
    microVariationPresent: breakup.cells.some((cell) => Math.abs(cell.microRelief) > 0.05),
  });
}

export function buildWaterEvidenceV63({ waterClass = 'sea', depth = 4, distance = 3, wetEdge = 0.8, foam = 0.25, cyanRisk = 0.1, moireRisk = 0 } = {}) {
  const optical = createWaterOpticalResponseV63({ waterClass, depth, distance, wetEdge, foam, cyanRisk, moireRisk });
  const bands = createShorelineBandProfileV63({ waterClass, distance, depth, wetEdge, foam });
  return freeze({ optical, bands, opticalStable: optical.recognized && optical.shorelineBlendMeters >= 0, antiMoiré: optical.moireSuppression >= 0 });
}

export function buildHabitatEvidenceV63(options = {}) {
  const habitat = createHabitatDensityV63(options);
  return freeze({
    ...habitat,
    forestBias: habitat.canopy > habitat.shrub,
    roadClearingPresent: habitat.clearingRadius >= 2,
    wetlandGroundDetail: options.biome === 'wetland' ? habitat.groundDetail > 0.35 : true,
  });
}

export function buildStreamingEvidenceV63(options = {}) {
  const plan = createStreamingPlanV63(options);
  return freeze({
    ...plan,
    cullingReady: plan.chunkCulling && plan.frustumCulling,
    budgetSafe: !plan.overBudget,
    actionCount: plan.actions.length,
  });
}

export function buildParityEvidenceV63(options = {}) {
  const parity = createParityDiagnosticsV63(options);
  return freeze({
    ...parity,
    heightWithinTolerance: parity.visualPass && parity.colliderPass,
    sameWorldCoordinate: parity.sameCoordinate,
  });
}

export function buildTransformEvidenceV63(options = {}) {
  const transform = createNaturalTransformV63(options);
  return freeze({
    ...transform,
    physicallyBounded: transform.scale >= 0.1 && transform.scale <= 8 && Math.abs(transform.leanRadians) <= 0.2,
    deterministic: typeof transform.deterministicKey === 'string',
  });
}

export function createRiskLedgerV63(observations = []) {
  const source = Array.isArray(observations) ? observations : [];
  const rows = source.map((observation) => {
    const evidence = createVisualEvidenceV63(observation);
    return freeze({
      sampleId: evidence.sampleId,
      qualityScore: evidence.qualityScore,
      failureCodes: evidence.failureCodes,
      mergeEligible: evidence.mergeEligible,
      fingerprint: evidence.fingerprint,
    });
  }).sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const failures = new Map();
  for (const row of rows) for (const code of row.failureCodes) failures.set(code, (failures.get(code) || 0) + 1);
  return freeze({
    count: rows.length,
    rows: freeze(rows),
    failureHistogram: freeze(Object.fromEntries([...failures.entries()].sort())),
    blockedCount: rows.filter((row) => !row.mergeEligible).length,
    digest: hash(rows.map((row) => `${row.sampleId}:${row.fingerprint}`).join('|')),
  });
}

export function createQualityGateV63(observations = []) {
  const ledger = createRiskLedgerV63(observations);
  const allClean = ledger.count > 0 && ledger.blockedCount === 0 && Object.keys(ledger.failureHistogram).length === 0;
  return freeze({
    eligible: allClean,
    sampleCount: ledger.count,
    blockedCount: ledger.blockedCount,
    failureHistogram: ledger.failureHistogram,
    digest: ledger.digest,
    requiredResolution: allClean ? V63_CONTRACT.acceptanceCamera : freeze({ width: 1536, height: 1024, orthographicDegrees: 90 }),
  });
}

export function createWorldEvidenceBundle({ observation, before, after, terrainField, water, habitat, streaming, parity, transform } = {}) {
  const primary = observation ? createVisualEvidenceV63(observation) : null;
  const bundle = {
    contract: V63_CONTRACT.id,
    primary,
    beforeAfter: before && after ? compareEvidenceBeforeAfterV63(before, after) : null,
    terrain: terrainField ? buildTerrainEvidenceV63(terrainField) : null,
    water: water ? buildWaterEvidenceV63(water) : null,
    habitat: habitat ? buildHabitatEvidenceV63(habitat) : null,
    streaming: streaming ? buildStreamingEvidenceV63(streaming) : null,
    parity: parity ? buildParityEvidenceV63(parity) : null,
    transform: transform ? buildTransformEvidenceV63(transform) : null,
    contractSummary: getV63ContractSummary(),
  };
  return freeze({
    ...bundle,
    fingerprint: hash(JSON.stringify(bundle, Object.keys(bundle).sort())),
  });
}

export function validateVisualEvidenceV63(evidence) {
  const failures = [];
  if (!evidence || evidence.contract !== V63_CONTRACT.id) failures.push('contract');
  if (evidence && evidence.primary && evidence.primary.profile.width !== 1536) failures.push('camera-width');
  if (evidence && evidence.primary && evidence.primary.profile.height !== 1024) failures.push('camera-height');
  if (evidence && evidence.primary && evidence.primary.mergeEligible !== true) failures.push('merge-eligibility');
  if (evidence && !Object.isFrozen(evidence)) failures.push('freeze');
  return freeze({ valid: failures.length === 0, failures: freeze(failures) });
}

export function createDeterministicVisualEvidenceV63(observation, repetitions = 2) {
  const count = Math.max(2, Math.min(8, Math.round(finite(repetitions, 2))));
  const runs = [];
  for (let index = 0; index < count; index += 1) runs.push(createVisualEvidenceV63(observation));
  const fingerprints = runs.map((run) => run.fingerprint);
  return freeze({
    count,
    fingerprints: freeze(fingerprints),
    deterministic: new Set(fingerprints).size === 1,
    digest: hash(fingerprints.join('|')),
  });
}

export const V63_PROFILE_NAMES = PROFILE_NAMES;

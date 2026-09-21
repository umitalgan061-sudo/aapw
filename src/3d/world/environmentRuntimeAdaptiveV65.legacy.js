import { planRuntime, runtimePlanDigest } from './geographicAssetRuntimeOrchestrator.ts';

export const V65_ADAPTIVE_POLICY = Object.freeze({
  id: 'environment-runtime-adaptive-v65-2026-09-14',
  version: 65,
  deterministic: true,
  canonicalExtent: Object.freeze({ width: 9000, depth: 7000 }),
  sampleGridMeters: 128,
  minEcologyConfidence: 0.55,
  maxSlopeDegrees: 48,
  targetHabitatEntropy: 0.72,
  targetFamilyCount: 12,
  adaptivePasses: 3,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const round = (value, places = 4) => Number(finite(value).toFixed(places));

export const hashSeed = (...parts) => {
  let hash = 2166136261;
  for (const part of parts.join('|')) {
    hash ^= part.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const seededNoise = (seed, salt = 0) => {
  const x = Math.sin((seed + salt) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export const normalizeObservation = (sample = {}) => ({
  x: finite(sample.x),
  z: finite(sample.z),
  elevation: finite(sample.elevation),
  slope: clamp(finite(sample.slope), 0, 90),
  moisture: clamp(finite(sample.moisture), 0, 1),
  temperature: clamp(finite(sample.temperature, 0.5), -1, 1),
  wind: clamp(finite(sample.wind, 0.3), 0, 1),
  snow: clamp(finite(sample.snow), 0, 1),
  waterDistance: Math.max(0, finite(sample.waterDistance, 9999)),
  roadDistance: Math.max(0, finite(sample.roadDistance, 9999)),
  settlementDistance: Math.max(0, finite(sample.settlementDistance, 9999)),
  confidence: clamp(finite(sample.confidence, 1), 0, 1),
  biome: sample.biome || 'grassland',
});

export const habitatSignal = (sample) => {
  const s = normalizeObservation(sample);
  const wet = s.moisture * 0.36 + clamp(1 - s.waterDistance / 900, 0, 1) * 0.24;
  const cold = clamp((-s.temperature + 1) / 2, 0, 1) * 0.25 + s.snow * 0.15;
  const wooded = clamp(s.moisture * 0.45 + (1 - s.slope / 55) * 0.28 + (1 - s.temperature) * 0.12, 0, 1);
  const open = clamp(1 - wooded * 0.48 + s.wind * 0.2, 0, 1);
  return {
    wet: round(wet),
    cold: round(cold),
    wooded: round(wooded),
    open: round(open),
  };
};

export const biomeWeights = (sample) => {
  const s = normalizeObservation(sample);
  const signal = habitatSignal(s);
  const weights = {
    forest: signal.wooded * (1 - signal.cold * 0.28),
    shrub: signal.open * 0.38 + signal.cold * 0.14,
    grassland: signal.open * 0.46,
    wetland: signal.wet * 0.64,
    riverine: clamp(1 - s.waterDistance / 260, 0, 1) * 0.92,
    coastal: clamp(1 - s.waterDistance / 180, 0, 1) * (s.elevation < 60 ? 0.9 : 0.2),
    alpine: clamp((s.elevation - 900) / 1400, 0, 1) * (1 - signal.wet * 0.45),
    tundra: signal.cold * 0.55 + s.snow * 0.4,
    taiga: signal.cold * 0.48 + signal.wooded * 0.35,
    desert: (1 - s.moisture) * clamp((s.temperature + 0.2) / 1.2, 0, 1) * 0.72,
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(value / total)]));
};

export const familyAffinity = (sample, family) => {
  const s = normalizeObservation(sample);
  const weights = biomeWeights(s);
  const affinity = {
    conifer: weights.taiga * 0.9 + weights.forest * 0.7,
    broadleaf: weights.forest * 0.95 + weights.wetland * 0.2,
    shrub: weights.shrub * 0.95 + weights.tundra * 0.22,
    grass: weights.grassland * 0.96 + weights.steppe * 0.1,
    reed: weights.wetland * 0.92 + weights.riverine * 0.36,
    saltmarsh: weights.coastal * 0.72 + weights.wetland * 0.42,
    riparianTree: weights.riverine * 0.8 + weights.forest * 0.3,
    alpineRock: weights.alpine * 0.92 + weights.tundra * 0.3,
    scree: weights.alpine * 0.56 + weights.tundra * 0.2,
    duneGrass: weights.coastal * 0.25 + weights.desert * 0.58,
    deadwood: weights.forest * 0.28 + weights.taiga * 0.35,
    moss: weights.wetland * 0.31 + weights.forest * 0.2 + weights.taiga * 0.25,
  };
  return round(affinity[family] ?? 0);
};

export const candidateFamilies = (sample, limit = V65_ADAPTIVE_POLICY.targetFamilyCount) => {
  const families = [
    'conifer', 'broadleaf', 'shrub', 'grass', 'reed', 'saltmarsh',
    'riparianTree', 'alpineRock', 'scree', 'duneGrass', 'deadwood', 'moss',
  ];
  return families
    .map((family) => ({ family, score: familyAffinity(sample, family) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, families.length)));
};

export const densityProfile = (sample) => {
  const s = normalizeObservation(sample);
  const slopePenalty = clamp(1 - Math.max(0, s.slope - 8) / 42, 0.05, 1);
  const accessPenalty = Math.min(1, s.roadDistance / 80) * 0.2 + Math.min(1, s.settlementDistance / 160) * 0.16;
  const moistureBoost = 1 + s.moisture * 0.34;
  const snowPenalty = 1 - s.snow * 0.62;
  return {
    base: round(clamp(slopePenalty * moistureBoost * snowPenalty, 0.05, 1.35)),
    canopy: round(clamp(slopePenalty * (1 - s.wind * 0.28) * (1 - accessPenalty), 0.05, 1)),
    understory: round(clamp(slopePenalty * (0.55 + s.moisture * 0.62), 0.05, 1.2)),
    groundcover: round(clamp(0.44 + s.moisture * 0.48 + (1 - s.snow) * 0.22, 0.05, 1.3)),
  };
};

export const surfaceTreatment = (sample) => {
  const s = normalizeObservation(sample);
  const wet = clamp(s.moisture + (180 - s.waterDistance) / 360, 0, 1);
  const freeze = clamp((-s.temperature + 0.2) / 1.2, 0, 1) * s.snow;
  const exposedRock = clamp((s.slope - 16) / 50, 0, 1) * (1 - s.moisture);
  return {
    grass: round((1 - exposedRock) * (1 - freeze) * (0.52 + s.moisture * 0.22)),
    soil: round(0.28 * (1 - wet) * (1 - freeze)),
    mud: round(0.36 * wet * (1 - freeze)),
    rock: round(0.22 * exposedRock + 0.08 * freeze),
    snow: round(0.72 * freeze),
    wetEdge: round(clamp((1 - s.waterDistance / 110) * 0.68 + wet * 0.18, 0, 1)),
  };
};

export const placementMask = (sample, family) => {
  const s = normalizeObservation(sample);
  const affinity = familyAffinity(s, family);
  const familySlopeCaps = {
    grass: 55,
    shrub: 42,
    conifer: 34,
    broadleaf: 30,
    reed: 16,
    saltmarsh: 10,
    riparianTree: 24,
    alpineRock: 78,
    scree: 66,
    duneGrass: 28,
    deadwood: 35,
    moss: 48,
  };
  const slopeCap = familySlopeCaps[family] ?? V65_ADAPTIVE_POLICY.maxSlopeDegrees;
  const hard = s.confidence >= V65_ADAPTIVE_POLICY.minEcologyConfidence && s.slope <= slopeCap;
  const hydrology = family === 'reed' || family === 'saltmarsh' ? s.waterDistance < 140 : true;
  const roadSafe = family !== 'grass' || s.roadDistance > 7;
  const settlementSafe = family === 'grass' || s.settlementDistance > 12;
  const snowSafe = !(family === 'broadleaf' && s.snow > 0.88);
  return { eligible: Boolean(hard && hydrology && roadSafe && settlementSafe && snowSafe && affinity > 0.08), affinity: round(affinity) };
};

export const scoreCandidate = (sample, family, index = 0) => {
  const signal = habitatSignal(sample);
  const mask = placementMask(sample, family);
  const jitter = seededNoise(hashSeed(sample.x, sample.z, family), index);
  const density = densityProfile(sample);
  return round(mask.eligible ? mask.affinity * density.base * (0.88 + jitter * 0.24) * (0.75 + signal.wooded * 0.35) : 0);
};

export const buildAdaptiveDecision = (sample, seed = 0) => {
  const normalized = normalizeObservation(sample);
  const families = candidateFamilies(normalized).map(({ family, score }, index) => ({
    family,
    habitatScore: score,
    runtimeScore: scoreCandidate(normalized, family, seed + index),
    mask: placementMask(normalized, family),
  }));
  const eligible = families.filter((item) => item.mask.eligible).sort((a, b) => b.runtimeScore - a.runtimeScore);
  return {
    position: { x: normalized.x, z: normalized.z },
    biome: normalized.biome,
    density: densityProfile(normalized),
    surface: surfaceTreatment(normalized),
    families: eligible.slice(0, 6),
    primaryFamily: eligible[0]?.family ?? null,
    fallbackFamily: eligible[1]?.family ?? null,
    confidence: round(normalized.confidence),
  };
};

export const adaptRegionSamples = (samples = [], seed = 0) => samples.map((sample, index) => buildAdaptiveDecision(sample, seed + index));

export const summarizeAdaptiveField = (decisions = []) => {
  const familyCounts = {};
  const biomeCounts = {};
  let accepted = 0;
  let totalConfidence = 0;
  let totalDensity = 0;
  for (const decision of decisions) {
    if (decision.primaryFamily) {
      accepted += 1;
      familyCounts[decision.primaryFamily] = (familyCounts[decision.primaryFamily] || 0) + 1;
    }
    biomeCounts[decision.biome] = (biomeCounts[decision.biome] || 0) + 1;
    totalConfidence += decision.confidence;
    totalDensity += decision.density.base;
  }
  const count = decisions.length || 1;
  return {
    sampleCount: decisions.length,
    accepted,
    acceptanceRate: round(accepted / count),
    meanConfidence: round(totalConfidence / count),
    meanDensity: round(totalDensity / count),
    familyCounts,
    biomeCounts,
  };
};

export const buildAdaptiveRuntimePlan = ({ samples = [], runtimeInput = {}, seed = 0 } = {}) => {
  const decisions = adaptRegionSamples(samples, seed);
  const orchestration = planRuntime(runtimeInput);
  return {
    contract: V65_ADAPTIVE_POLICY.id,
    seed,
    decisions,
    summary: summarizeAdaptiveField(decisions),
    runtimePlan: orchestration,
    digest: runtimePlanDigest(orchestration),
  };
};

export const rebalanceFamilyQuotas = (summary, target = V65_ADAPTIVE_POLICY.targetFamilyCount) => {
  const entries = Object.entries(summary?.familyCounts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return [];
  const cap = Math.max(1, Math.ceil(summary.sampleCount / Math.max(target, 1) * 2.8));
  return entries.map(([family, count]) => ({
    family,
    observed: count,
    quota: Math.min(count, cap),
    retainedRatio: round(Math.min(count, cap) / count),
  }));
};

export const continuityBias = (sample, neighborSummary = {}) => {
  const s = normalizeObservation(sample);
  const neighborDensity = clamp(finite(neighborSummary.meanDensity, 0.5), 0.05, 1.3);
  const neighborConfidence = clamp(finite(neighborSummary.meanConfidence, 0.7), 0, 1);
  const edgePenalty = s.roadDistance < 12 || s.settlementDistance < 20 ? 0.18 : 0;
  return round(clamp(0.55 + neighborDensity * 0.22 + neighborConfidence * 0.18 - edgePenalty, 0.05, 1.2));
};

export const validateAdaptiveDecision = (decision) => {
  const errors = [];
  if (!decision || !decision.position) errors.push('missing-decision');
  if (!decision?.primaryFamily && decision?.confidence > 0.6) errors.push('unexpected-empty-family');
  if (decision?.density?.base < 0 || decision?.density?.base > 1.35) errors.push('density-range');
  if (decision?.confidence < 0 || decision?.confidence > 1) errors.push('confidence-range');
  return { ok: errors.length === 0, errors };
};

export const validateAdaptiveRuntimePlan = (plan) => {
  const errors = [];
  if (plan?.contract !== V65_ADAPTIVE_POLICY.id) errors.push('contract');
  if (!Array.isArray(plan?.decisions)) errors.push('decisions');
  for (const decision of plan?.decisions || []) {
    const result = validateAdaptiveDecision(decision);
    if (!result.ok) errors.push(...result.errors);
  }
  return { ok: errors.length === 0, errors };
};

export const adaptiveTelemetry = (plan) => ({
  contract: V65_ADAPTIVE_POLICY.id,
  summary: plan?.summary || summarizeAdaptiveField(plan?.decisions || []),
  quotas: rebalanceFamilyQuotas(plan?.summary || {}, V65_ADAPTIVE_POLICY.targetFamilyCount),
  digest: plan?.digest || null,
});

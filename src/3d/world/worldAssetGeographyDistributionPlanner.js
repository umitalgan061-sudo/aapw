/**
 * Deterministic geography-aware asset distribution planner.
 *
 * This module sits above the existing placement authority. It does not create terrain, water, roads or
 * settlements and it never moves a canonical coordinate. It only ranks already-valid candidate points,
 * enforces family/domain compatibility, preserves spatial diversity and adds bounded regional character.
 *
 * The planner exists because a locally plausible asset can still produce an implausible world when many
 * individually plausible assets are selected with no relationship to their neighbours. Forest clearings
 * need cohorts, river margins need corridors, exposed ridges need lower vegetation density, and settlements
 * need a softer transition into agricultural/meadow props. All of those are distribution concerns rather
 * than geometry concerns.
 *
 * @module world/worldAssetGeographyDistributionPlanner
 */

import {
  WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY,
  assetGeographyPlacementDecision,
  deterministicAssetCohortOffset,
  deterministicAssetScale,
  deterministicAssetYaw,
  sampleWorldAssetGeographyProfile,
  validateAssetGeographyProfile,
} from './worldAssetGeographyProfile.js';
import {
  WORLD_ASSET_REGIONAL_ANCHOR_POLICY,
  WORLD_ASSET_REGIONAL_ANCHORS,
  regionalAnchorInfluences,
} from './worldAssetRegionalAnchors.js';

export const WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY = Object.freeze({
  id: 'world-asset-geography-distribution-planner-2026-09-07-v1',
  renderOnly: true,
  placementRankingOnly: true,
  deterministic: true,
  worldSpace: true,
  noTerrainWrites: true,
  noHydrologyWrites: true,
  noRoadWrites: true,
  noSettlementWrites: true,
  canonicalPlacementAuthorityPreserved: true,
  regionalInfluenceMax: WORLD_ASSET_REGIONAL_ANCHOR_POLICY.regionalInfluenceMax,
  neighbourSuppressionMeters: 14,
  strongNeighbourSuppressionMeters: 7,
  clusterCohesionMeters: 34,
  corridorCohesionMeters: 58,
  coastTransitionMeters: 180,
  riverTransitionMeters: 90,
  roadBufferMeters: 11,
  settlementBufferMeters: 28,
  candidateCellMeters: 12,
  diversityWindow: 9,
  maximumFamilyDominance: 0.72,
});

const FAMILY_ALIASES = Object.freeze({
  tree: 'tree',
  trees: 'tree',
  vegetation: 'vegetation',
  grass: 'vegetation',
  foliage: 'vegetation',
  shrub: 'shrub',
  bush: 'shrub',
  rock: 'rock',
  geology: 'rock',
  talus: 'rock',
  stone: 'rock',
  snow: 'snow',
  ice: 'snow',
  cryosphere: 'snow',
  building: 'building',
  architecture: 'building',
  structure: 'building',
  settlement: 'settlement',
  waterside: 'waterside',
  riverbank: 'waterside',
  coastal: 'waterside',
});

const DOMAIN_FAMILY_BIASES = Object.freeze({
  woodland: Object.freeze({ tree: 0.34, vegetation: 0.22, shrub: 0.12, rock: -0.06, snow: -0.10, waterside: 0.04 }),
  meadow: Object.freeze({ tree: 0.12, vegetation: 0.34, shrub: 0.16, rock: -0.08, snow: -0.10, waterside: 0.06 }),
  heath: Object.freeze({ tree: -0.18, vegetation: 0.04, shrub: 0.34, rock: 0.12, snow: -0.06, waterside: 0.00 }),
  wetland: Object.freeze({ tree: -0.08, vegetation: 0.20, shrub: 0.10, rock: -0.16, snow: -0.04, waterside: 0.38 }),
  riparian: Object.freeze({ tree: 0.22, vegetation: 0.28, shrub: 0.16, rock: -0.04, snow: -0.08, waterside: 0.46 }),
  coast: Object.freeze({ tree: -0.12, vegetation: 0.08, shrub: 0.22, rock: 0.30, snow: -0.08, waterside: 0.42 }),
  alpine: Object.freeze({ tree: -0.18, vegetation: -0.06, shrub: 0.02, rock: 0.34, snow: 0.22, waterside: -0.08 }),
  scree: Object.freeze({ tree: -0.22, vegetation: -0.10, shrub: -0.02, rock: 0.46, snow: 0.18, waterside: -0.04 }),
  snowfield: Object.freeze({ tree: -0.34, vegetation: -0.30, shrub: -0.18, rock: 0.10, snow: 0.62, waterside: 0.02 }),
  volcanic: Object.freeze({ tree: -0.12, vegetation: -0.14, shrub: -0.10, rock: 0.44, snow: 0.08, waterside: 0.00 }),
});

const DEFAULT_DOMAIN_KEYS = Object.freeze(Object.keys(DOMAIN_FAMILY_BIASES));

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));
const clampSigned = (value) => Math.max(-1, Math.min(1, finite(value, 0)));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const saturateSigned = (value) => {
  const t = clampSigned(value);
  return t * (1.5 - 0.5 * Math.abs(t));
};

function hash32(value) {
  let x = Number(value) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hashUnit(...values) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const string = String(value);
    for (let i = 0; i < string.length; i++) {
      hash ^= string.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash32(hash) / 0xffffffff;
}

function canonicalFamily(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return FAMILY_ALIASES[id] ?? id ?? 'vegetation';
}

function normalizedMetadata(candidate = {}) {
  const metadata = candidate.metadata ?? candidate;
  return {
    ...metadata,
    id: metadata.id ?? candidate.id ?? `candidate-${Math.round(finite(candidate.x))}-${Math.round(finite(candidate.z))}`,
    family: canonicalFamily(metadata.family ?? metadata.assetFamily ?? metadata.category ?? candidate.family),
    category: metadata.category ?? metadata.family ?? candidate.family,
  };
}

function normalizeSurface(candidate = {}) {
  const source = candidate.surface ?? candidate;
  return {
    ...source,
    x: finite(source.x ?? candidate.x),
    z: finite(source.z ?? candidate.z),
    height: finite(source.height ?? source.elevation ?? source.heightMeters ?? candidate.height),
    slopeDegrees: Math.max(0, finite(source.slopeDegrees ?? candidate.slopeDegrees)),
    aspectRadians: finite(source.aspectRadians ?? candidate.aspectRadians),
    moisture: clamp01(source.moisture ?? candidate.moisture ?? 0.5),
    biome: source.biome ?? candidate.biome ?? '',
    waterDepth: Math.max(0, finite(source.waterDepth ?? candidate.waterDepth)),
    riverDistance: finite(source.riverDistance ?? candidate.riverDistance, Infinity),
    lakeDistance: finite(source.lakeDistance ?? candidate.lakeDistance, Infinity),
    coastDistance: finite(source.coastDistance ?? candidate.coastDistance, Infinity),
    roadDistance: finite(source.roadDistance ?? candidate.roadDistance, Infinity),
    settlementDistance: finite(source.settlementDistance ?? candidate.settlementDistance, Infinity),
    snow: clamp01(source.snow ?? candidate.snow),
    concavity: clamp01(source.concavity ?? candidate.concavity ?? 0.5),
    shelter: clamp01(source.shelter ?? candidate.shelter ?? 0.5),
    erosion: clamp01(source.erosion ?? candidate.erosion ?? 0.5),
    deposition: clamp01(source.deposition ?? candidate.deposition ?? 0.5),
    lithic: clamp01(source.lithic ?? candidate.lithic ?? 0.5),
    normalizedX: source.normalizedX ?? candidate.normalizedX,
    normalizedY: source.normalizedY ?? source.normalizedZ ?? candidate.normalizedY ?? candidate.normalizedZ,
  };
}

function safeDistance(value) {
  return Number.isFinite(value) && value >= 0 ? value : Infinity;
}

function proximity(distance, range) {
  const d = safeDistance(distance);
  if (!Number.isFinite(d)) return 0;
  return 1 - smooth(d / Math.max(0.001, range));
}

function distanceToBoundary(distance, range) {
  const d = safeDistance(distance);
  if (!Number.isFinite(d)) return 0;
  return smooth(1 - Math.abs(d - range) / Math.max(1, range));
}

function domainVector(profile = {}) {
  const domains = profile.domains ?? {};
  return Object.fromEntries(DEFAULT_DOMAIN_KEYS.map((key) => [key, clamp01(domains[key] ?? 0)]));
}

function familyDomainBias(family, domains) {
  const key = canonicalFamily(family);
  let score = 0;
  for (const [domain, weight] of Object.entries(domains)) {
    score += weight * finite(DOMAIN_FAMILY_BIASES[domain]?.[key], 0);
  }
  return score;
}

function domainIdentity(profile = {}) {
  const vector = domainVector(profile);
  return Object.entries(vector)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, weight]) => ({ id, weight }));
}

function candidateCell(x, z, cellMeters = WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.candidateCellMeters) {
  const cell = Math.max(0.1, finite(cellMeters, 12));
  return `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;
}

function regionResponse(candidate, family) {
  const surface = normalizeSurface(candidate);
  if (!Number.isFinite(Number(surface.normalizedX)) || !Number.isFinite(Number(surface.normalizedY))) {
    return { enabled: false, factor: 1, familyResponse: 0.5, dominantAnchor: null, anchors: [] };
  }
  const x = clamp01(surface.normalizedX);
  const y = clamp01(surface.normalizedY);
  const influences = regionalAnchorInfluences(x, y);
  let totalWeight = 0;
  let familyTotal = 0;
  for (const [id, influence] of Object.entries(influences)) {
    const response = WORLD_ASSET_REGIONAL_ANCHORS[id]?.assets?.[family];
    if (!(influence > 0) || !Number.isFinite(Number(response))) continue;
    totalWeight += influence;
    familyTotal += Number(response) * influence;
  }
  const familyResponse = totalWeight > 0 ? clamp01(familyTotal / totalWeight) : 0.5;
  const centred = (familyResponse - 0.5) * 2;
  const factor = clamp01(0.5 + 0.5 * (1 + centred * finite(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.regionalInfluenceMax, 0.34) * 0.74));
  const anchors = Object.entries(influences)
    .filter(([, weight]) => weight > 0.02)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, weight]) => ({ id, weight }));
  return {
    enabled: true,
    factor,
    familyResponse,
    dominantAnchor: anchors[0]?.id ?? null,
    anchors,
  };
}

function sourceScore(candidate, family, options = {}) {
  const surface = normalizeSurface(candidate);
  const profile = candidate.profile ?? sampleWorldAssetGeographyProfile(surface, normalizedMetadata(candidate));
  const validity = candidate.profileValidation ?? validateAssetGeographyProfile(profile);
  const baseDecision = validity.ok
    ? assetGeographyPlacementDecision(profile, {
      minimumScore: finite(options.minimumScore, WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor),
      rejectPoor: false,
    })
    : { score: 0, accept: false, reasons: validity.errors };

  const domains = domainVector(profile);
  const coast = proximity(surface.coastDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.coastTransitionMeters);
  const river = proximity(surface.riverDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.riverTransitionMeters);
  const road = proximity(surface.roadDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.roadBufferMeters);
  const settlement = proximity(surface.settlementDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.settlementBufferMeters);
  const slopePenalty = smooth(Math.max(0, surface.slopeDegrees - 24) / 32);
  const waterPenalty = family === 'rock' || family === 'snow' ? 0 : clamp01(surface.waterDepth / 1.25) * 0.22;
  const domainBias = familyDomainBias(family, domains);
  const familyProfile = profile.family === family ? 0.08 : -0.06;
  const regional = regionResponse(candidate, family);
  const roadWearPenalty = family === 'vegetation' || family === 'tree' || family === 'shrub' ? road * 0.12 : road * 0.03;
  const settlementPenalty = family === 'tree' ? settlement * 0.08 : family === 'rock' ? settlement * 0.04 : settlement * 0.01;
  const corridorBonus = family === 'waterside' ? river * 0.22 + coast * 0.18 : 0;
  const exposurePenalty = family === 'tree' ? clamp01(surface.slopeDegrees / 55) * (1 - surface.shelter) * 0.10 : 0;

  let score = finite(baseDecision.score, 0);
  score += domainBias * 0.34;
  score += familyProfile;
  score += corridorBonus;
  score -= roadWearPenalty;
  score -= settlementPenalty;
  score -= exposurePenalty;
  score -= waterPenalty;
  score -= slopePenalty * (family === 'building' || family === 'settlement' ? 0.13 : family === 'tree' ? 0.05 : 0.02);
  score = clamp01(score * (0.66 + regional.factor * 0.34));

  return {
    score,
    baseScore: finite(baseDecision.score, 0),
    profile,
    validity,
    regional,
    context: Object.freeze({
      domains: domainIdentity(profile),
      coast,
      river,
      road,
      settlement,
      slopePenalty,
      waterPenalty,
      domainBias,
      familyProfile,
      corridorBonus,
      exposurePenalty,
    }),
  };
}

function normalizedCandidate(candidate, index, options = {}) {
  const metadata = normalizedMetadata(candidate);
  const family = canonicalFamily(metadata.family);
  const surface = normalizeSurface(candidate);
  const evaluated = sourceScore(candidate, family, options);
  const id = String(metadata.id ?? `candidate-${index}`);
  const stableSeed = hash32(`${options.seed ?? 0}|${id}|${Math.round(surface.x)}|${Math.round(surface.z)}`);
  return Object.freeze({
    index,
    id,
    family,
    metadata,
    surface,
    profile: evaluated.profile,
    score: evaluated.score,
    baseScore: evaluated.baseScore,
    validity: evaluated.validity,
    regional: evaluated.regional,
    context: evaluated.context,
    stableSeed,
    cell: candidateCell(surface.x, surface.z),
  });
}

function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.stableSeed !== b.stableSeed) return a.stableSeed - b.stableSeed;
  return a.id.localeCompare(b.id);
}

function distanceSquared(a, b) {
  const dx = a.surface.x - b.surface.x;
  const dz = a.surface.z - b.surface.z;
  return dx * dx + dz * dz;
}

function neighbourSuppression(candidate, selected, options = {}) {
  let suppression = 0;
  const normalRadius = finite(options.neighbourSuppressionMeters, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.neighbourSuppressionMeters);
  const strongRadius = finite(options.strongNeighbourSuppressionMeters, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.strongNeighbourSuppressionMeters);
  const family = candidate.family;
  for (const previous of selected) {
    const distance = Math.sqrt(distanceSquared(candidate, previous));
    if (distance >= normalRadius) continue;
    const strength = family === previous.family ? 1.10 : 0.46;
    if (distance < strongRadius) suppression = Math.max(suppression, strength * (1 - smooth(distance / strongRadius)));
    else suppression = Math.max(suppression, strength * 0.55 * (1 - smooth((distance - strongRadius) / Math.max(1, normalRadius - strongRadius))));
  }
  return clamp01(suppression);
}

function cohortAffinity(candidate, selected, options = {}) {
  let best = 0;
  const radius = finite(options.clusterCohesionMeters, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.clusterCohesionMeters);
  for (const previous of selected) {
    if (candidate.family !== previous.family) continue;
    const distance = Math.sqrt(distanceSquared(candidate, previous));
    if (distance > radius) continue;
    const sameCohort = deterministicAssetCohortOffset(candidate.profile, candidate.surface.x, candidate.surface.z)
      === deterministicAssetCohortOffset(previous.profile, previous.surface.x, previous.surface.z);
    const affinity = (1 - smooth(distance / Math.max(1, radius))) * (sameCohort ? 1 : 0.46);
    best = Math.max(best, affinity);
  }
  return best;
}

function localDiversityPenalty(candidate, selected, options = {}) {
  const window = Math.max(1, Math.round(finite(options.diversityWindow, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.diversityWindow)));
  const recent = selected.slice(-window);
  if (!recent.length) return 0;
  const sameFamily = recent.filter((entry) => entry.family === candidate.family).length / recent.length;
  return sameFamily > finite(options.maximumFamilyDominance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.maximumFamilyDominance)
    ? (sameFamily - finite(options.maximumFamilyDominance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.maximumFamilyDominance)) * 0.48
    : 0;
}

function quotaPressure(candidate, selected, quotas = {}) {
  const quota = quotas[candidate.family];
  if (!quota) return 0;
  const count = selected.filter((entry) => entry.family === candidate.family).length;
  const minimum = Math.max(0, finite(quota.minimum, 0));
  const target = Math.max(minimum, finite(quota.target, minimum));
  if (count >= target) return -Math.min(0.20, (count - target + 1) * 0.03);
  if (count < minimum) return Math.min(0.24, (minimum - count) * 0.07);
  return Math.max(0, (target - count) * 0.02);
}

function candidateUtility(candidate, selected, options = {}) {
  const suppression = neighbourSuppression(candidate, selected, options);
  const cohesion = cohortAffinity(candidate, selected, options);
  const diversity = localDiversityPenalty(candidate, selected, options);
  const quota = quotaPressure(candidate, selected, options.quotas ?? {});
  const randomTie = hashUnit(options.seed ?? 0, candidate.stableSeed, selected.length);
  return candidate.score
    - suppression * 0.52
    + cohesion * 0.18
    - diversity
    + quota
    + randomTie * 0.004;
}

function selectByGreedyUtility(candidates, limit, options = {}) {
  const selected = [];
  const remaining = [...candidates];
  const maximum = Math.max(0, Math.min(limit, remaining.length));
  while (selected.length < maximum && remaining.length) {
    let bestIndex = 0;
    let bestUtility = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const utility = candidateUtility(remaining[i], selected, options);
      if (utility > bestUtility) {
        bestUtility = utility;
        bestIndex = i;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push(Object.freeze({
      ...chosen,
      utility: bestUtility,
      placementScale: deterministicAssetScale(chosen.profile, chosen.surface.x, chosen.surface.z),
      placementYaw: deterministicAssetYaw(chosen.profile, chosen.surface.x, chosen.surface.z),
    }));
  }
  return selected;
}

function satisfyMinimumQuotas(selected, candidates, options = {}) {
  const quotas = options.quotas ?? {};
  const output = [...selected];
  for (const [family, quota] of Object.entries(quotas)) {
    const minimum = Math.max(0, Math.floor(finite(quota?.minimum, 0)));
    if (!minimum) continue;
    let count = output.filter((entry) => entry.family === family).length;
    if (count >= minimum) continue;
    const alternatives = candidates
      .filter((entry) => entry.family === family && !output.some((selectedEntry) => selectedEntry.id === entry.id))
      .sort((a, b) => b.score - a.score);
    for (const candidate of alternatives) {
      if (count >= minimum || output.length >= options.limit) break;
      const utility = candidateUtility(candidate, output, options);
      if (!(utility > finite(options.minimumAcceptableUtility, 0.20))) continue;
      output.push(Object.freeze({
        ...candidate,
        utility,
        quotaInjected: true,
        placementScale: deterministicAssetScale(candidate.profile, candidate.surface.x, candidate.surface.z),
        placementYaw: deterministicAssetYaw(candidate.profile, candidate.surface.x, candidate.surface.z),
      }));
      count++;
    }
  }
  return output;
}

function corridorFactor(candidate) {
  const river = proximity(candidate.surface.riverDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.riverTransitionMeters);
  const coast = proximity(candidate.surface.coastDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.coastTransitionMeters);
  const lake = proximity(candidate.surface.lakeDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.riverTransitionMeters * 1.2);
  return clamp01(Math.max(river, coast, lake));
}

function environmentTransitionFactor(candidate) {
  const surface = candidate.surface;
  const coast = distanceToBoundary(surface.coastDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.coastTransitionMeters);
  const river = distanceToBoundary(surface.riverDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.riverTransitionMeters);
  const settlement = distanceToBoundary(surface.settlementDistance, WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.settlementBufferMeters * 2);
  return clamp01(Math.max(coast, river, settlement));
}

function scoreContinuity(candidate, localCandidates) {
  if (!localCandidates.length) return 0.5;
  let weighted = 0;
  let weight = 0;
  for (const neighbour of localCandidates) {
    const distance = Math.sqrt(distanceSquared(candidate, neighbour));
    if (distance > 70) continue;
    const proximityWeight = 1 - smooth(distance / 70);
    weighted += Math.abs(candidate.score - neighbour.score) * proximityWeight;
    weight += proximityWeight;
  }
  if (!weight) return 0.5;
  return clamp01(1 - weighted / weight * 1.8);
}

export function evaluateWorldAssetDistributionCandidate(candidate, options = {}) {
  const normalized = normalizedCandidate(candidate, 0, options);
  const decision = assetGeographyPlacementDecision(normalized.profile, {
    minimumScore: finite(options.minimumScore, WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor),
    rejectPoor: Boolean(options.rejectPoor),
  });
  const transition = environmentTransitionFactor(normalized);
  const corridor = corridorFactor(normalized);
  const returnValue = {
    id: normalized.id,
    family: normalized.family,
    x: normalized.surface.x,
    z: normalized.surface.z,
    score: normalized.score,
    baseScore: normalized.baseScore,
    decision,
    regional: normalized.regional,
    continuityHint: 0.5,
    transitionFactor: transition,
    corridorFactor: corridor,
    profile: normalized.profile,
    validity: normalized.validity,
    context: normalized.context,
  };
  return Object.freeze(returnValue);
}

export function rankWorldAssetDistributionCandidates(candidates = [], options = {}) {
  const normalized = candidates
    .map((candidate, index) => normalizedCandidate(candidate, index, options))
    .filter((candidate) => candidate.validity.ok && candidate.score > 0);
  const byCell = new Map();
  for (const candidate of normalized) {
    const list = byCell.get(candidate.cell) ?? [];
    list.push(candidate);
    byCell.set(candidate.cell, list);
  }
  for (const list of byCell.values()) list.sort(compareCandidates);
  return normalized
    .map((candidate) => {
      const local = [];
      for (const neighbour of normalized) {
        if (neighbour.id === candidate.id) continue;
        const distance = Math.sqrt(distanceSquared(candidate, neighbour));
        if (distance <= 70) local.push(neighbour);
      }
      return {
        ...candidate,
        continuityHint: scoreContinuity(candidate, local),
        cellOccupancy: byCell.get(candidate.cell)?.length ?? 0,
      };
    })
    .sort((a, b) => {
      const scoreA = a.score * (0.72 + a.continuityHint * 0.28);
      const scoreB = b.score * (0.72 + b.continuityHint * 0.28);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return compareCandidates(a, b);
    })
    .map((candidate) => Object.freeze(candidate));
}

export function distributeWorldAssetCandidates(candidates = [], options = {}) {
  const limit = Math.max(0, Math.floor(finite(options.limit, candidates.length)));
  const ranked = rankWorldAssetDistributionCandidates(candidates, options);
  const eligible = ranked.filter((candidate) => {
    const minimumScore = finite(options.minimumScore, WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor);
    if (!(candidate.score >= minimumScore)) return false;
    if (options.rejectPoor && !candidate.validity.ok) return false;
    return candidate.decision?.accept !== false || !options.rejectPoor;
  });
  const selected = selectByGreedyUtility(eligible, limit, {
    ...options,
    limit,
  });
  const completed = satisfyMinimumQuotas(selected, eligible, {
    ...options,
    limit,
  });
  const selectedIds = new Set(completed.map((candidate) => candidate.id));
  const diagnostics = summarizeWorldAssetDistribution(ranked, completed, options);
  return Object.freeze({
    policyId: WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.id,
    candidates: ranked,
    eligible,
    selected: completed,
    selectedIds,
    diagnostics,
  });
}

export function summarizeWorldAssetDistribution(ranked = [], selected = [], options = {}) {
  const familyCounts = {};
  const selectedFamilyCounts = {};
  for (const candidate of ranked) familyCounts[candidate.family] = (familyCounts[candidate.family] ?? 0) + 1;
  for (const candidate of selected) selectedFamilyCounts[candidate.family] = (selectedFamilyCounts[candidate.family] ?? 0) + 1;
  const scoreValues = ranked.map((candidate) => candidate.score).filter(Number.isFinite);
  const selectedScores = selected.map((candidate) => candidate.score).filter(Number.isFinite);
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const min = (values) => values.length ? Math.min(...values) : 0;
  const max = (values) => values.length ? Math.max(...values) : 0;
  const corridorCount = selected.filter((candidate) => candidate.corridorFactor > 0.45).length;
  const transitionCount = selected.filter((candidate) => candidate.transitionFactor > 0.45).length;
  const regionalCount = selected.filter((candidate) => candidate.regional?.enabled).length;
  return Object.freeze({
    policyId: WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.id,
    candidateCount: ranked.length,
    selectedCount: selected.length,
    requestedLimit: finite(options.limit, selected.length),
    familyCounts: Object.freeze({ ...familyCounts }),
    selectedFamilyCounts: Object.freeze({ ...selectedFamilyCounts }),
    meanScore: mean(scoreValues),
    minScore: min(scoreValues),
    maxScore: max(scoreValues),
    selectedMeanScore: mean(selectedScores),
    selectedMinScore: min(selectedScores),
    selectedMaxScore: max(selectedScores),
    corridorSelectedCount: corridorCount,
    transitionSelectedCount: transitionCount,
    regionalEnabledCount: regionalCount,
    deterministic: true,
  });
}

export function distributionPlannerPolicyId() {
  return WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.id;
}

export function distributionPlannerPolicies() {
  return Object.freeze({
    planner: WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY,
    profile: WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY,
    regional: WORLD_ASSET_REGIONAL_ANCHOR_POLICY,
  });
}

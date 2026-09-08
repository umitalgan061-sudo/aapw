/**
 * Deterministic ecological ranking for procedural vegetation and natural loose assets.
 *
 * This module replaces obvious sin/cos patch repetition with world-space domain-warped ranking.
 * It consumes canonical surface/environment facts and never changes terrain, water, roads,
 * coastlines, colliders or landmark coordinates.
 */

import {
  sampleWorldEcologySurfaceField,
  ecologyCohortTransform,
} from './worldEcologySurfaceField.js';

export const VEGETATION_ECOLOGY_DISTRIBUTION_REVISION = 'v1-domain-warped-cohort-ranking';

export const VEGETATION_ECOLOGY_DISTRIBUTION_POLICY = Object.freeze({
  id: 'vegetation-ecology-distribution-2026-09-03-v1',
  deterministic: true,
  renderOnly: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalRoadsReadOnly: true,
  canonicalSettlementsReadOnly: true,
  canonicalLandmarkCoordinatesUnchanged: true,
  newGeographyIntroduced: false,
  periodicTrigPatchFieldsRemoved: true,
  cohortStructure: true,
  edgeStructure: true,
  understoryStructure: true,
  deadwoodStructure: true,
  lithicStructure: true,
  minimumNormalizedSpacing: 0.32,
  maximumNormalizedSpacing: 1.85,
});

const TAU = Math.PI * 2;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (value) => value - Math.floor(value);
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function hashUint(value) {
  let x = (value | 0) ^ 0x85ebca6b;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function hash2(ix, iz, seed = 0) {
  return hashUint((ix | 0) + Math.imul((iz | 0), 0x27d4eb2d) + (seed | 0)) / 4294967295;
}

function hash3(ix, iy, iz, seed = 0) {
  return hashUint(
    (ix | 0)
      + Math.imul((iy | 0), 0x165667b1)
      + Math.imul((iz | 0), 0x1b873593)
      + (seed | 0),
  ) / 4294967295;
}

function normalizeFamily(value) {
  const id = String(value || '').trim().toLowerCase();
  if (/conifer|pine|spruce|fir|evergreen/.test(id)) return 'conifer';
  if (/deciduous|oak|broadleaf|birch|willow/.test(id)) return 'deciduous';
  if (/shrub|bush|scrub|heath/.test(id)) return 'shrub';
  if (/grass|reed|sedge|herb|groundcover/.test(id)) return 'groundcover';
  if (/deadwood|log|stump|fallen/.test(id)) return 'deadwood';
  if (/rock|boulder|scree|talus|stone/.test(id)) return 'rock';
  return 'mixed';
}

const FAMILY_PREFERENCES = Object.freeze({
  conifer: Object.freeze({
    woodland: 0.36, wetMeadow: 0.04, dryHeath: 0.11, scrub: 0.09,
    riparian: 0.06, alpine: 0.16, bareRockPenalty: 0.18, frostTolerance: 0.74,
    moistureCenter: 0.56, moistureWidth: 0.47, exposureTolerance: 0.54,
    slopeTolerance: 0.72, cohortBias: 0.11, edgeAffinity: 0.09,
  }),
  deciduous: Object.freeze({
    woodland: 0.40, wetMeadow: 0.09, dryHeath: 0.03, scrub: 0.08,
    riparian: 0.15, alpine: 0.02, bareRockPenalty: 0.23, frostTolerance: 0.38,
    moistureCenter: 0.63, moistureWidth: 0.38, exposureTolerance: 0.39,
    slopeTolerance: 0.60, cohortBias: 0.08, edgeAffinity: 0.12,
  }),
  shrub: Object.freeze({
    woodland: 0.11, wetMeadow: 0.08, dryHeath: 0.24, scrub: 0.34,
    riparian: 0.06, alpine: 0.08, bareRockPenalty: 0.10, frostTolerance: 0.55,
    moistureCenter: 0.46, moistureWidth: 0.56, exposureTolerance: 0.68,
    slopeTolerance: 0.78, cohortBias: 0.16, edgeAffinity: 0.17,
  }),
  groundcover: Object.freeze({
    woodland: 0.08, wetMeadow: 0.27, dryHeath: 0.17, scrub: 0.10,
    riparian: 0.16, alpine: 0.07, bareRockPenalty: 0.11, frostTolerance: 0.53,
    moistureCenter: 0.58, moistureWidth: 0.63, exposureTolerance: 0.74,
    slopeTolerance: 0.83, cohortBias: 0.08, edgeAffinity: 0.10,
  }),
  deadwood: Object.freeze({
    woodland: 0.38, wetMeadow: 0.04, dryHeath: 0.04, scrub: 0.08,
    riparian: 0.07, alpine: 0.03, bareRockPenalty: 0.14, frostTolerance: 0.58,
    moistureCenter: 0.58, moistureWidth: 0.44, exposureTolerance: 0.48,
    slopeTolerance: 0.64, cohortBias: 0.22, edgeAffinity: 0.08,
  }),
  rock: Object.freeze({
    woodland: 0.01, wetMeadow: 0.00, dryHeath: 0.06, scrub: 0.03,
    riparian: 0.04, alpine: 0.16, bareRockPenalty: -0.45, frostTolerance: 1.00,
    moistureCenter: 0.40, moistureWidth: 0.95, exposureTolerance: 1.00,
    slopeTolerance: 1.00, cohortBias: 0.03, edgeAffinity: 0.22,
  }),
  mixed: Object.freeze({
    woodland: 0.23, wetMeadow: 0.10, dryHeath: 0.10, scrub: 0.12,
    riparian: 0.08, alpine: 0.07, bareRockPenalty: 0.16, frostTolerance: 0.58,
    moistureCenter: 0.54, moistureWidth: 0.56, exposureTolerance: 0.61,
    slopeTolerance: 0.72, cohortBias: 0.10, edgeAffinity: 0.11,
  }),
});

function moisturePreference(value, center, width) {
  const distance = Math.abs(clamp01(value) - center) / Math.max(0.01, width);
  return 1 - smooth01(distance);
}

function exposureFitness(exposure, tolerance) {
  const value = clamp01(exposure);
  if (value <= tolerance) return 1;
  return 1 - smooth01((value - tolerance) / Math.max(0.01, 1 - tolerance));
}

function slopeFitness(slope, tolerance) {
  const value = clamp01(slope);
  if (value <= tolerance) return 1;
  return 1 - smooth01((value - tolerance) / Math.max(0.01, 1 - tolerance));
}

function frostFitness(frost, tolerance) {
  const value = clamp01(frost);
  if (value <= tolerance) return 1;
  return 1 - smooth01((value - tolerance) / Math.max(0.01, 1 - tolerance));
}

function environmentalCapacity(field, family) {
  const pref = FAMILY_PREFERENCES[family] ?? FAMILY_PREFERENCES.mixed;
  const d = field.domains;
  const r = field.response;
  const p = field.physical;
  const spatial = field.spatial;
  const moistureFit = moisturePreference(r.moisture, pref.moistureCenter, pref.moistureWidth);
  const exposedFit = exposureFitness(r.exposure, pref.exposureTolerance);
  const steepFit = slopeFitness(p.slope, pref.slopeTolerance);
  const coldFit = frostFitness(r.frost, pref.frostTolerance);
  const domain =
    d.woodland * pref.woodland
    + d.wetMeadow * pref.wetMeadow
    + d.dryHeath * pref.dryHeath
    + d.scrub * pref.scrub
    + d.riparian * pref.riparian
    + d.alpine * pref.alpine
    - d.bareRock * pref.bareRockPenalty;
  const ecological =
    moistureFit * 0.22
    + exposedFit * 0.14
    + steepFit * 0.12
    + coldFit * 0.10
    + r.soilDepth * (family === 'rock' ? -0.06 : 0.13)
    + r.shelter * (family === 'rock' ? -0.02 : 0.08)
    + domain
    + spatial.cells.edge * pref.edgeAffinity
    + field.placement.cohort * pref.cohortBias;
  const humanSuppression = family === 'rock'
    ? p.road * 0.08 + p.settlement * 0.04
    : p.road * 0.31 + p.settlement * 0.17;
  const waterSuppression = p.waterDepth > 0 ? 0.95 : 0;
  return clamp01(ecological - humanSuppression - waterSuppression);
}

function cohortClass(field, family, seed) {
  const cohort = field.placement.cohort;
  const age = field.placement.canopyAge;
  const edge = field.spatial.cells.edge;
  const random = hash3(
    Math.floor(field.x / 6),
    Math.floor((field.physical.elevation + 1024) / 4),
    Math.floor(field.z / 6),
    seed + 7001,
  );
  if (family === 'rock') {
    if (field.domains.talus > 0.58) return random < 0.62 ? 'talus-clast' : 'boulder';
    if (field.domains.bareRock > 0.62) return random < 0.68 ? 'outcrop-fragment' : 'boulder';
    return random < 0.55 ? 'fieldstone' : 'boulder';
  }
  if (family === 'groundcover') {
    if (field.domains.riparian > 0.54) return 'riparian-groundcover';
    if (field.domains.wetMeadow > 0.55) return 'meadow-groundcover';
    if (field.domains.dryHeath > 0.52) return 'heath-groundcover';
    return 'mixed-groundcover';
  }
  if (family === 'deadwood') {
    if (field.response.moisture > 0.62) return random < 0.64 ? 'mossed-log' : 'decayed-stump';
    return random < 0.61 ? 'dry-log' : 'weathered-stump';
  }
  if (edge > 0.62 && random < 0.48) return 'edge';
  if (age > 0.68 && cohort > 0.52) return 'mature';
  if (age < 0.36 || random < 0.20) return 'juvenile';
  if (field.response.exposure > 0.68) return 'wind-pruned';
  return 'mixed-age';
}

function spacingMultiplier(capacity, cohort, edge, family) {
  const dense = clamp01(capacity * 0.64 + cohort * 0.24 + (1 - edge) * 0.12);
  const familyBase = family === 'groundcover' ? 0.62
    : family === 'shrub' ? 0.78
      : family === 'rock' ? 0.92
        : family === 'deadwood' ? 1.28
          : 1.0;
  return Math.max(
    VEGETATION_ECOLOGY_DISTRIBUTION_POLICY.minimumNormalizedSpacing,
    Math.min(
      VEGETATION_ECOLOGY_DISTRIBUTION_POLICY.maximumNormalizedSpacing,
      familyBase * lerp(1.42, 0.72, dense),
    ),
  );
}

function orientation(field, family, seed) {
  const transform = ecologyCohortTransform(field, { minScale: 0.78, maxScale: 1.23 });
  const randomYaw = hash2(Math.floor(field.x * 0.37), Math.floor(field.z * 0.37), seed + 919) * TAU;
  const sedimentYaw = field.material.sedimentAngle;
  const yaw = family === 'deadwood'
    ? sedimentYaw + (hash2(Math.floor(field.x / 9), Math.floor(field.z / 9), seed + 1297) - 0.5) * 0.62
    : family === 'rock'
      ? lerp(randomYaw, sedimentYaw, field.domains.talus * 0.48)
      : randomYaw;
  return Object.freeze({
    yaw,
    scale: transform.scale,
    trunkLean: family === 'conifer' || family === 'deciduous' ? transform.trunkLean : 0,
    crownCompression: transform.crownCompression,
    understory: transform.understory,
  });
}

function scaleForFamily(field, family, cohortClassId, orientationData, seed) {
  const localRandom = hash2(
    Math.floor(field.x * 0.83),
    Math.floor(field.z * 0.83),
    seed + 2309,
  );
  let base = orientationData.scale;
  if (family === 'groundcover') base = lerp(0.72, 1.16, localRandom);
  if (family === 'shrub') base = lerp(0.76, 1.24, localRandom);
  if (family === 'deadwood') base = lerp(0.72, 1.28, localRandom);
  if (family === 'rock') base = lerp(0.62, 1.38, localRandom);
  if (cohortClassId === 'juvenile') base *= 0.72;
  if (cohortClassId === 'mature') base *= 1.10;
  if (cohortClassId === 'wind-pruned') base *= 0.91;
  if (cohortClassId === 'edge') base *= 0.96;
  if (cohortClassId === 'boulder') base *= 1.18;
  if (cohortClassId === 'fieldstone') base *= 0.72;
  return Math.max(0.42, Math.min(1.48, base));
}

function acceptanceRank(field, family, seed) {
  const cellX = Math.floor(field.x / 3.7);
  const cellZ = Math.floor(field.z / 3.7);
  const familySalt = {
    conifer: 101,
    deciduous: 211,
    shrub: 307,
    groundcover: 401,
    deadwood: 503,
    rock: 601,
    mixed: 701,
  }[family] ?? 809;
  const local = hash2(cellX, cellZ, seed + familySalt);
  const cross = hash2(Math.floor(field.x / 17.3), Math.floor(field.z / 11.9), seed + familySalt * 3);
  const cellular = field.spatial.cells.value;
  return clamp01(local * 0.56 + cross * 0.18 + cellular * 0.26);
}

export function evaluateVegetationEcologyCandidate(input = {}, options = {}) {
  const family = normalizeFamily(options.family ?? input.family ?? input.assetClass);
  const seed = hashUint(finite(options.seed ?? input.seed, 0));
  const field = input.ecologyField ?? sampleWorldEcologySurfaceField({
    ...input,
    seed,
  });
  const capacity = environmentalCapacity(field, family);
  const rank = acceptanceRank(field, family, seed);
  const threshold = clamp01(finite(options.threshold, 0.52));
  const acceptanceCeiling = clamp01(capacity * lerp(1.10, 0.72, threshold));
  const accepted = capacity > 0.015 && rank <= acceptanceCeiling;
  const classId = cohortClass(field, family, seed);
  const orientationData = orientation(field, family, seed);
  const scale = scaleForFamily(field, family, classId, orientationData, seed);
  const spacing = spacingMultiplier(capacity, field.placement.cohort, field.spatial.cells.edge, family);
  return Object.freeze({
    revision: VEGETATION_ECOLOGY_DISTRIBUTION_REVISION,
    policyId: VEGETATION_ECOLOGY_DISTRIBUTION_POLICY.id,
    family,
    accepted,
    capacity,
    rank,
    acceptanceCeiling,
    threshold,
    cohortClass: classId,
    spacingMultiplier: spacing,
    scale,
    yaw: orientationData.yaw,
    trunkLean: orientationData.trunkLean,
    crownCompression: orientationData.crownCompression,
    understory: orientationData.understory,
    ecologyField: field,
  });
}

export function rankVegetationEcologyCandidates(candidates = [], options = {}) {
  const evaluated = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] ?? {};
    const result = evaluateVegetationEcologyCandidate(candidate, {
      ...options,
      seed: hashUint(finite(options.seed, 0) + index * 1013),
    });
    evaluated.push(Object.freeze({
      candidate,
      result,
    }));
  }
  evaluated.sort((a, b) => {
    const scoreA = a.result.capacity - a.result.rank * 0.58;
    const scoreB = b.result.capacity - b.result.rank * 0.58;
    if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
    if (a.candidate.x !== b.candidate.x) return finite(a.candidate.x) - finite(b.candidate.x);
    return finite(a.candidate.z) - finite(b.candidate.z);
  });
  return Object.freeze(evaluated);
}

export function ecologicalInstanceVariation(input = {}, options = {}) {
  const evaluation = evaluateVegetationEcologyCandidate(input, options);
  const field = evaluation.ecologyField;
  const seed = hashUint(finite(options.seed ?? input.seed, 0));
  const hueJitter = (hash2(Math.floor(field.x / 5.1), Math.floor(field.z / 5.1), seed + 3301) - 0.5) * 2;
  const valueJitter = (hash2(Math.floor(field.x / 3.3), Math.floor(field.z / 3.3), seed + 3907) - 0.5) * 2;
  const saturationJitter = (hash2(Math.floor(field.x / 7.7), Math.floor(field.z / 7.7), seed + 4513) - 0.5) * 2;
  return Object.freeze({
    revision: VEGETATION_ECOLOGY_DISTRIBUTION_REVISION,
    family: evaluation.family,
    cohortClass: evaluation.cohortClass,
    scale: evaluation.scale,
    yaw: evaluation.yaw,
    lean: evaluation.trunkLean,
    crownCompression: evaluation.crownCompression,
    understory: evaluation.understory,
    hueShift: hueJitter * 0.018,
    valueScale: 1 + valueJitter * 0.065,
    saturationScale: 1 + saturationJitter * 0.085,
    moistureDarken: field.response.moisture * 0.075,
    frostDesaturate: field.response.frost * 0.11,
    exposureBleach: field.response.exposure * 0.045,
    mossAffinity: field.material.moss,
    lichenAffinity: field.material.lichen,
  });
}

export function ecologicalDeadwoodProbability(field) {
  if (!field?.domains || !field?.response) return 0;
  return clamp01(
    field.domains.woodland * 0.32
      + field.response.moisture * 0.13
      + field.response.shelter * 0.12
      + field.placement.canopyAge * 0.19
      + field.placement.windPruning * 0.12
      + field.material.weathering * 0.12,
  );
}

export function ecologicalRockAccentProbability(field) {
  if (!field?.domains || !field?.response) return 0;
  return clamp01(
    field.domains.bareRock * 0.39
      + field.domains.talus * 0.31
      + field.response.erosion * 0.13
      + field.spatial.cells.edge * 0.10
      + field.material.sedimentFabric * 0.07
      - field.domains.wetMeadow * 0.16,
  );
}

export function summarizeVegetationEcologyDistribution(results = []) {
  const list = Array.isArray(results) ? results : [];
  const accepted = list.filter((item) => item?.accepted ?? item?.result?.accepted);
  const capacity = list.map((item) => finite(item?.capacity ?? item?.result?.capacity, 0));
  const averageCapacity = capacity.length
    ? capacity.reduce((sum, value) => sum + value, 0) / capacity.length
    : 0;
  const families = {};
  for (const item of list) {
    const family = item?.family ?? item?.result?.family ?? 'mixed';
    families[family] = (families[family] ?? 0) + 1;
  }
  return Object.freeze({
    policyId: VEGETATION_ECOLOGY_DISTRIBUTION_POLICY.id,
    revision: VEGETATION_ECOLOGY_DISTRIBUTION_REVISION,
    candidateCount: list.length,
    acceptedCount: accepted.length,
    acceptanceRatio: list.length ? accepted.length / list.length : 0,
    averageCapacity,
    families: Object.freeze({ ...families }),
  });
}

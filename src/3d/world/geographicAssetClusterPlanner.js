/*
 * Deterministic geographic asset cluster planner.
 *
 * The planner sits between canonical world-surface evidence and an asset producer. It deliberately
 * does not know how to load a GLB, create a mesh, modify terrain, edit the road graph, move a village
 * seat or alter collision. Its sole job is to turn one canonical anchor plus a bounded set of surface
 * samples into candidate world positions with explainable acceptance/rejection reasons.
 *
 * A producer can therefore consume the result, route every accepted object through the existing shared
 * material/placement gate, and still retain one deterministic answer for a given world X/Z and seed.
 * Candidates are distributed with a jittered dart-throwing pass rather than a regular grid. A stable
 * cell hash provides the first candidate set, while pairwise spacing rejection prevents obvious clumps.
 */

import {
  GEOGRAPHIC_ASSET_CONTEXT_POLICY,
  GEOGRAPHIC_ASSET_FAMILY_PROFILES,
  scoreGeographicAssetFamily,
  deriveGeographicAssetPlacement,
  geographicAssetContextAtWorldXZ,
} from './geographicAssetContext.ts';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const TAU = Math.PI * 2;

export const GEOGRAPHIC_ASSET_CLUSTER_POLICY = Object.freeze({
  id: 'geographic-asset-cluster-planner-2026-09-14-v1',
  deterministic: true,
  regularGridDistribution: false,
  canonicalSurfaceSampling: true,
  maxCandidatesDesktop: 72,
  maxCandidatesMobile: 28,
  maxAcceptedDesktop: 28,
  maxAcceptedMobile: 12,
  defaultRadiusMeters: 180,
  minimumRadiusMeters: 12,
  maximumRadiusMeters: 520,
  edgePaddingMeters: 8,
  surfaceSampleBudget: 96,
  separationMultiplier: 0.72,
  rejectedCandidateAccounting: true,
  reasonsStable: true,
  seeds: Object.freeze({
    candidate: 0x4b1d9f31,
    angle: 0x2e78d1a7,
    radius: 0x91ac37e5,
    order: 0xe33d5b29,
  }),
});

export const GEOGRAPHIC_ASSET_CLUSTER_MODES = Object.freeze({
  ambient: Object.freeze({
    radiusMeters: 220,
    minimumSpacingMeters: 18,
    targetCount: 18,
    mobileTargetCount: 8,
    ringBias: 0.18,
    clusterTightness: 0.74,
  }),
  roadside: Object.freeze({
    radiusMeters: 140,
    minimumSpacingMeters: 26,
    targetCount: 9,
    mobileTargetCount: 4,
    ringBias: 0.44,
    clusterTightness: 0.52,
  }),
  settlementEdge: Object.freeze({
    radiusMeters: 170,
    minimumSpacingMeters: 14,
    targetCount: 16,
    mobileTargetCount: 7,
    ringBias: 0.68,
    clusterTightness: 0.80,
  }),
  geology: Object.freeze({
    radiusMeters: 260,
    minimumSpacingMeters: 28,
    targetCount: 13,
    mobileTargetCount: 6,
    ringBias: 0.31,
    clusterTightness: 0.66,
  }),
  shoreline: Object.freeze({
    radiusMeters: 200,
    minimumSpacingMeters: 22,
    targetCount: 11,
    mobileTargetCount: 5,
    ringBias: 0.76,
    clusterTightness: 0.58,
  }),
});

const FAMILY_FALLBACK_ORDER = Object.freeze([
  'broadleaf', 'birch', 'pine', 'snowpine', 'marshreed', 'shrub', 'desertgrass',
  'junglevine', 'meadowgrass', 'fern', 'granite', 'basalt', 'limestone', 'sandstone',
  'wetboulder', 'weatheredstone', 'ruinwall', 'waystone', 'timberfence', 'marketstall',
  'watermill', 'dock', 'cairn', 'ashrock', 'driftwood', 'froststone',
]);

function hash32(value) {
  let x = Number(value) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hashString(value) {
  let h = 2166136261 >>> 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return hash32(h);
}

function hashWorld(worldX, worldZ, seed) {
  const x = Math.floor(Number(worldX) * 0.1) | 0;
  const z = Math.floor(Number(worldZ) * 0.1) | 0;
  return hash32(Math.imul(x ^ seed, 0x27d4eb2d) ^ Math.imul(z + seed, 0x165667b1));
}

function unit(hash) {
  return (hash >>> 0) / 4294967296;
}

function distanceSquared(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  return dx * dx + dz * dz;
}

function finiteDistance(value, fallback = Infinity) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;
}

function modeFor(mode) {
  if (typeof mode === 'object' && mode) return mode;
  return GEOGRAPHIC_ASSET_CLUSTER_MODES[mode] || GEOGRAPHIC_ASSET_CLUSTER_MODES.ambient;
}

function familyProfile(familyId) {
  return GEOGRAPHIC_ASSET_FAMILY_PROFILES[familyId] || null;
}

function candidateSeed(anchor, familyId, seed, index) {
  return hash32(
    hashWorld(anchor.x, anchor.z, GEOGRAPHIC_ASSET_CLUSTER_POLICY.seeds.candidate ^ hashString(seed)) ^
    hashString(`${familyId}|${index}`),
  );
}

function candidateAngle(anchor, familyId, seed, index) {
  const hash = hashWorld(anchor.x + index * 13.17, anchor.z - index * 7.31, GEOGRAPHIC_ASSET_CLUSTER_POLICY.seeds.angle ^ hashString(`${seed}|${familyId}`));
  return unit(hash) * TAU;
}

function candidateRadius(anchor, familyId, seed, index, mode) {
  const hash = hashWorld(anchor.x - index * 5.23, anchor.z + index * 19.41, GEOGRAPHIC_ASSET_CLUSTER_POLICY.seeds.radius ^ hashString(`${seed}|${familyId}`));
  const radial = Math.sqrt(unit(hash));
  const ringBias = clamp01(mode.ringBias ?? 0.3);
  const blended = radial * (1 - ringBias) + Math.abs(radial - 0.78) * ringBias;
  return clamp(
    blended * mode.radiusMeters,
    GEOGRAPHIC_ASSET_CLUSTER_POLICY.minimumRadiusMeters,
    Math.min(GEOGRAPHIC_ASSET_CLUSTER_POLICY.maximumRadiusMeters, mode.radiusMeters),
  );
}

function jitterAxis(hash, amplitude) {
  return (unit(hash) - 0.5) * 2 * amplitude;
}

function projectCandidate(anchor, familyId, seed, index, mode) {
  const angle = candidateAngle(anchor, familyId, seed, index);
  const radius = candidateRadius(anchor, familyId, seed, index, mode);
  const hash = candidateSeed(anchor, familyId, seed, index);
  const jitter = Math.min(0.22, clamp01(mode.clusterTightness ?? 0.7) * 0.18);
  const radialJitter = radius * jitter;
  const dx = Math.cos(angle) * (radius + jitterAxis(hash32(hash ^ 0x19d5), radialJitter));
  const dz = Math.sin(angle) * (radius + jitterAxis(hash32(hash ^ 0x72ac), radialJitter));
  return Object.freeze({
    x: anchor.x + dx,
    z: anchor.z + dz,
    angle,
    radius,
    seed: hash,
    index,
  });
}

function normalizeCandidateCount(value, mobile, mode) {
  const requested = Number(value);
  const defaultCount = mobile ? mode.mobileTargetCount : mode.targetCount;
  const count = Number.isFinite(requested) ? requested : defaultCount;
  const cap = mobile ? GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxCandidatesMobile : GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxCandidatesDesktop;
  return Math.max(1, Math.min(cap, Math.floor(count)));
}

function normalizeAcceptedCount(value, mobile) {
  const requested = Number(value);
  const fallback = mobile ? GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxAcceptedMobile : GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxAcceptedDesktop;
  const cap = mobile ? GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxAcceptedMobile : GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxAcceptedDesktop;
  return Math.max(1, Math.min(cap, Math.floor(Number.isFinite(requested) ? requested : fallback)));
}

function isBlockedByContext(context) {
  if (!context || typeof context !== 'object') return false;
  if (context.isWater) return true;
  if (finiteDistance(context.waterDepth, 0) > 0.05) return true;
  if (Number(context.slopeDegrees ?? context.slope) > 55) return true;
  return false;
}

function safetyDistance(context, type) {
  const road = finiteDistance(context.roadDistanceMeters ?? context.roadDistance);
  const settlement = finiteDistance(context.settlementDistanceMeters ?? context.settlementDistance);
  const shore = finiteDistance(context.shorelineDistanceMeters ?? context.shorelineDistance);
  if (type === 'roadside') return Math.min(road, settlement * 0.42, shore * 0.55);
  if (type === 'shoreline') return Math.min(shore, road * 0.66, settlement * 0.58);
  return Math.min(road * 0.78, settlement * 0.74, shore * 0.92);
}

function rejectReason(profile, score, context, mode, existing, point, spacing, index) {
  if (!score.ok) return { code: 'invalid-score', detail: score.error };
  if (score.hardReject) return { code: 'hard-policy', detail: 'canonical surface violates family policy' };
  if (isBlockedByContext(context)) return { code: 'unsafe-surface', detail: 'water-depth-or-slope-outside-distribution-envelope' };
  if (Number(score.score) < Number(context.minimumFamilyScore ?? 0.34)) return { code: 'low-suitability', detail: `score=${score.score.toFixed(4)}` };
  const localSafety = safetyDistance(context, mode.id || 'ambient');
  if (Number.isFinite(localSafety) && localSafety < GEOGRAPHIC_ASSET_CLUSTER_POLICY.edgePaddingMeters) {
    return { code: 'context-buffer', detail: `safety-distance=${localSafety.toFixed(2)}` };
  }
  const minSpacing = Math.max(spacing, profile.kind === 'geology' ? spacing * 1.28 : spacing);
  const separation = GEOGRAPHIC_ASSET_CLUSTER_POLICY.separationMultiplier * minSpacing;
  const tooClose = existing.findIndex((item) => distanceSquared(item, point) < separation * separation);
  if (tooClose >= 0) return { code: 'minimum-spacing', detail: `conflict-index=${tooClose}` };
  if (profile.kind === 'roadside' && mode.id !== 'roadside') return { code: 'mode-family-mismatch', detail: 'roadside family requires roadside mode' };
  if (profile.kind === 'utility' && context.utilityAllowed === false) return { code: 'utility-disabled', detail: 'caller disabled utility assets' };
  if (index < 0) return { code: 'invalid-index', detail: 'candidate index must be non-negative' };
  return null;
}

export function normalizeClusterAnchor(anchor = {}) {
  const x = Number(anchor.x ?? anchor.worldX);
  const z = Number(anchor.z ?? anchor.worldZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Object.freeze({ ok: false, error: 'invalid-anchor' });
  return Object.freeze({ ok: true, x, z, id: String(anchor.id || anchor.assetAnchorId || 'anchor') });
}

export function normalizeClusterContext(context = {}) {
  const safe = { ...context };
  safe.biome = String(context.biome || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  safe.moisture = clamp01(context.moisture ?? context.moisture01);
  safe.slopeDegrees = Math.max(0, Number(context.slopeDegrees ?? context.slope) || 0);
  safe.elevationMeters = Number.isFinite(Number(context.elevationMeters ?? context.elevation)) ? Number(context.elevationMeters ?? context.elevation) : 0;
  safe.waterDepth = Math.max(0, Number(context.waterDepth) || 0);
  safe.roadDistanceMeters = Number.isFinite(Number(context.roadDistanceMeters ?? context.roadDistance)) ? Math.max(0, Number(context.roadDistanceMeters ?? context.roadDistance)) : null;
  safe.settlementDistanceMeters = Number.isFinite(Number(context.settlementDistanceMeters ?? context.settlementDistance)) ? Math.max(0, Number(context.settlementDistanceMeters ?? context.settlementDistance)) : null;
  safe.shorelineDistanceMeters = Number.isFinite(Number(context.shorelineDistanceMeters ?? context.shorelineDistance)) ? Math.max(0, Number(context.shorelineDistanceMeters ?? context.shorelineDistance)) : null;
  safe.localRelief = clamp01(context.localRelief ?? context.relief01 ?? 0.5);
  safe.isWater = Boolean(context.isWater || context.waterBody);
  return Object.freeze(safe);
}

export function buildClusterFamilyMatrix({ familyIds = FAMILY_FALLBACK_ORDER, context = {} } = {}) {
  const safeContext = normalizeClusterContext(context);
  return Object.freeze(
    familyIds
      .filter((id) => Boolean(familyProfile(id)))
      .map((familyId) => {
        const profile = familyProfile(familyId);
        const score = scoreGeographicAssetFamily(familyId, safeContext);
        return Object.freeze({ familyId, kind: profile.kind, score: score.score || 0, accepted: Boolean(score.accepted && !score.hardReject), profile });
      })
      .sort((a, b) => b.score - a.score || a.familyId.localeCompare(b.familyId)),
  );
}

export function chooseClusterFamilies({ familyIds = FAMILY_FALLBACK_ORDER, context = {}, seed = 0, diversity = 0.28, maxFamilies = 4 } = {}) {
  const matrix = buildClusterFamilyMatrix({ familyIds, context });
  const eligible = matrix.filter((entry) => entry.accepted);
  if (!eligible.length) return Object.freeze([]);
  const limit = Math.max(1, Math.min(8, Number(maxFamilies) || 4));
  const top = eligible.slice(0, limit);
  const familyKinds = new Set();
  const selected = [];
  for (const entry of top) {
    const redundancy = familyKinds.has(entry.kind) ? diversity : 0;
    const threshold = Math.max(0.30, entry.score - redundancy * 0.1);
    if (entry.score >= threshold) {
      selected.push(entry);
      familyKinds.add(entry.kind);
    }
  }
  if (selected.length < Math.min(limit, eligible.length)) {
    const hash = hashString(seed);
    for (const entry of eligible.slice(selected.length, limit)) {
      if ((hash ^ hashString(entry.familyId)) % 3 !== 1) selected.push(entry);
    }
  }
  return Object.freeze(selected.slice(0, limit));
}

export function sampleClusterCandidates({
  anchor,
  familyId,
  seed = 0,
  mode = 'ambient',
  candidateCount = null,
  mobile = false,
} = {}) {
  const normalizedAnchor = normalizeClusterAnchor(anchor);
  if (!normalizedAnchor.ok) return Object.freeze({ ok: false, error: normalizedAnchor.error, candidates: [] });
  if (!familyProfile(familyId)) return Object.freeze({ ok: false, error: 'unknown-family', candidates: [] });
  const profile = familyProfile(familyId);
  const resolvedMode = Object.freeze({ id: typeof mode === 'string' ? mode : 'custom', ...modeFor(mode) });
  const count = normalizeCandidateCount(candidateCount, mobile, resolvedMode);
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const point = projectCandidate(normalizedAnchor, familyId, seed, index, resolvedMode);
    candidates.push(Object.freeze({
      ...point,
      familyId,
      kind: profile.kind,
      mode: resolvedMode.id,
    }));
  }
  return Object.freeze({ ok: true, anchor: normalizedAnchor, familyId, mode: resolvedMode, candidates: Object.freeze(candidates) });
}

export function planGeographicAssetCluster({
  anchor,
  context,
  familyIds = FAMILY_FALLBACK_ORDER,
  seed = 0,
  mode = 'ambient',
  candidateCount = null,
  acceptedCount = null,
  mobile = false,
  surfaceQuery = null,
  contextualize = null,
} = {}) {
  const normalizedAnchor = normalizeClusterAnchor(anchor);
  if (!normalizedAnchor.ok) return Object.freeze({ ok: false, error: normalizedAnchor.error, accepted: [], rejected: [] });
  const baseContext = normalizeClusterContext(context);
  const families = chooseClusterFamilies({ familyIds, context: baseContext, seed, maxFamilies: mobile ? 3 : 5 });
  if (!families.length) {
    return Object.freeze({ ok: false, error: 'no-eligible-families', accepted: [], rejected: [], familyMatrix: buildClusterFamilyMatrix({ familyIds, context: baseContext }) });
  }
  const resolvedMode = Object.freeze({ id: typeof mode === 'string' ? mode : 'custom', ...modeFor(mode) });
  const target = normalizeAcceptedCount(acceptedCount, mobile);
  const candidateBudget = normalizeCandidateCount(candidateCount, mobile, resolvedMode);
  const orderedFamilies = families.map((item) => item.familyId);
  const accepted = [];
  const rejected = [];
  const spacing = Math.max(GEOGRAPHIC_ASSET_CLUSTER_POLICY.minimumRadiusMeters, Number(resolvedMode.minimumSpacingMeters) || 18);
  let cursor = 0;

  while (cursor < candidateBudget && accepted.length < target) {
    const familyIndex = cursor % orderedFamilies.length;
    const familyId = orderedFamilies[familyIndex];
    const source = sampleClusterCandidates({ anchor: normalizedAnchor, familyId, seed: `${seed}|${familyId}`, mode: resolvedMode, candidateCount: 1, mobile });
    const point = source.candidates[0];
    if (!point) break;
    const surface = typeof surfaceQuery === 'function'
      ? surfaceQuery(point.x, point.z, { familyId, index: cursor, anchor: normalizedAnchor })
      : typeof contextualize === 'function'
        ? contextualize(point.x, point.z, { familyId, index: cursor, anchor: normalizedAnchor })
        : baseContext;
    const pointContext = normalizeClusterContext(surface || baseContext);
    const score = scoreGeographicAssetFamily(familyId, pointContext);
    const profile = familyProfile(familyId);
    const reason = rejectReason(profile, score, pointContext, resolvedMode, accepted, point, spacing, cursor);
    if (reason) {
      rejected.push(Object.freeze({
        ...point,
        familyId,
        score: score.score || 0,
        reason: reason.code,
        detail: reason.detail,
      }));
    } else {
      const placement = deriveGeographicAssetPlacement({ familyId, context: pointContext, worldX: point.x, worldZ: point.z, seed });
      accepted.push(Object.freeze({
        ...point,
        familyId,
        score: score.score,
        suitability: placement.suitability,
        density: placement.density,
        cluster: placement.cluster,
        scale: placement.scale,
        rotationBiasRadians: placement.rotationBiasRadians,
        surface: pointContext,
        placement,
        decision: 'accepted',
      }));
    }
    cursor += 1;
  }

  const digest = hash32(
    hashString(`${normalizedAnchor.id}|${seed}|${resolvedMode.id}`) ^
    accepted.reduce((sum, item) => sum ^ Number(item.placement?.digest || 0), 0),
  );
  return Object.freeze({
    ok: accepted.length > 0,
    anchor: normalizedAnchor,
    mode: resolvedMode,
    familyMatrix: buildClusterFamilyMatrix({ familyIds, context: baseContext }),
    selectedFamilies: Object.freeze(orderedFamilies),
    candidateBudget,
    acceptedTarget: target,
    spacingMeters: spacing,
    accepted: Object.freeze(accepted),
    rejected: Object.freeze(rejected),
    attempted: cursor,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    digest,
    noGridDistribution: true,
  });
}

export function planWorldAssetClusterAtWorldXZ(worldX, worldZ, options = {}) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('cluster world coordinates must be finite');
  const context = options.context
    || (typeof options.resolveContext === 'function' ? options.resolveContext(worldX, worldZ) : null)
    || { biome: 'temperate', moisture: 0.5, slopeDegrees: 8, elevationMeters: 0 };
  return planGeographicAssetCluster({ ...options, anchor: { x: worldX, z: worldZ, id: options.anchorId }, context });
}

export function explainClusterDecision(result) {
  if (!result?.ok) return Object.freeze({ ok: false, reason: result?.error || 'empty-plan' });
  const reasons = new Map();
  for (const item of result.rejected || []) {
    reasons.set(item.reason, (reasons.get(item.reason) || 0) + 1);
  }
  return Object.freeze({
    ok: true,
    accepted: result.acceptedCount,
    rejected: result.rejectedCount,
    attempted: result.attempted,
    rejectionCounts: Object.freeze(Object.fromEntries(reasons)),
    selectedFamilies: result.selectedFamilies,
    digest: result.digest,
  });
}

export function clusterDigest(result) {
  if (!result || typeof result !== 'object') return 0;
  const anchor = result.anchor || {};
  let digest = hashString(`${anchor.id || ''}|${anchor.x || 0}|${anchor.z || 0}|${result.mode?.id || ''}`);
  for (const item of result.accepted || []) {
    digest = hash32(digest ^ hashString(`${item.familyId}|${item.x.toFixed(3)}|${item.z.toFixed(3)}|${item.scale.toFixed(4)}`));
  }
  for (const item of result.rejected || []) digest = hash32(digest ^ hashString(`${item.familyId}|${item.reason}|${item.index}`));
  return digest;
}

export function replayCluster({ first, second } = {}) {
  const firstDigest = clusterDigest(first);
  const secondDigest = clusterDigest(second);
  return Object.freeze({ ok: firstDigest === secondDigest, firstDigest, secondDigest, deterministic: firstDigest === secondDigest });
}

export function checkClusterGeographySafety(result) {
  if (!result?.ok) return Object.freeze({ ok: false, errors: [result?.error || 'invalid-plan'] });
  const errors = [];
  for (const item of result.accepted || []) {
    if (!Number.isFinite(item.x) || !Number.isFinite(item.z)) errors.push(`non-finite:${item.index}`);
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1) errors.push(`score:${item.index}`);
    if (!Number.isFinite(item.scale) || item.scale < GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMin || item.scale > GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMax) errors.push(`scale:${item.index}`);
    if (!item.surface || item.surface.isWater) errors.push(`water:${item.index}`);
    if (Number(item.surface?.waterDepth || 0) > 0.05) errors.push(`depth:${item.index}`);
    if (Number(item.surface?.slopeDegrees || 0) > 55) errors.push(`slope:${item.index}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors, accepted: result.acceptedCount, rejected: result.rejectedCount });
}

export function planMultiAnchorGeographicAssets({ anchors = [], contextResolver, ...options } = {}) {
  if (!Array.isArray(anchors)) throw new TypeError('anchors must be an array');
  const plans = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const context = typeof contextResolver === 'function'
      ? contextResolver(anchor.x ?? anchor.worldX, anchor.z ?? anchor.worldZ, anchor)
      : anchor.context || options.context;
    plans.push(planGeographicAssetCluster({
      ...options,
      anchor,
      context,
      seed: `${options.seed || 'world'}|${anchor.id || i}`,
    }));
  }
  return Object.freeze(plans);
}

export function mergeClusterPlans(plans = [], { maximumDistanceMeters = 0, maximumAccepted = Infinity } = {}) {
  if (!Array.isArray(plans)) throw new TypeError('plans must be an array');
  const merged = [];
  const distance = Math.max(0, Number(maximumDistanceMeters) || 0);
  const limit = Math.max(0, Number(maximumAccepted) || Infinity);
  for (const plan of plans) {
    for (const item of plan?.accepted || []) {
      if (merged.length >= limit) break;
      if (distance > 0 && merged.some((other) => distanceSquared(other, item) < distance * distance)) continue;
      merged.push(item);
    }
    if (merged.length >= limit) break;
  }
  return Object.freeze(merged);
}

export function planFromCanonicalContext({ worldX, worldZ, context, familyId, seed = 0, mode = 'ambient' } = {}) {
  const ctx = context || geographicAssetContextAtWorldXZ(worldX, worldZ, { seed });
  const normalized = ctx?.surface || ctx;
  return planGeographicAssetCluster({
    anchor: { x: worldX, z: worldZ, id: `${familyId || 'mixed'}-anchor` },
    context: normalized,
    familyIds: familyId ? [familyId] : FAMILY_FALLBACK_ORDER,
    seed,
    mode,
  });
}

export const GEOGRAPHIC_ASSET_CLUSTER_PROFILE_IDS = Object.freeze(Object.keys(GEOGRAPHIC_ASSET_CLUSTER_MODES));

export const __TEST__ = Object.freeze({
  clamp01,
  clamp,
  hash32,
  hashString,
  hashWorld,
  unit,
  distanceSquared,
  modeFor,
  familyProfile,
  candidateSeed,
  candidateAngle,
  candidateRadius,
  normalizeCandidateCount,
  normalizeAcceptedCount,
  isBlockedByContext,
  safetyDistance,
  rejectReason,
  projectCandidate,
});

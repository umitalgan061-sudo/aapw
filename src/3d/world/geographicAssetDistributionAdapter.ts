/** Production TypeScript owner for src/3d/world/geographicAssetDistributionAdapter.js. Legacy .js remains compatibility-only. */
// @ts-nocheck
/*
 * Runtime-neutral adapter for geographic asset distribution decisions.
 *
 * Producers pass their already-resolved canonical surface sample here. The adapter never queries or
 * mutates terrain itself. It simply normalizes the producer's evidence, builds the geographic context,
 * and returns the selected family plus a bounded cluster plan. This keeps distribution logic reusable by
 * vegetation, geology, roadside props and settlement-edge systems without making any of them dependent
 * on each other's private implementations.
 */

import {
  GEOGRAPHIC_ASSET_CONTEXT_POLICY,
  GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS,
  buildGeographicAssetContext,
  validateGeographicAssetContextInput,
  geographicAssetContextDigest,
} from './geographicAssetContext.ts';
import {
  GEOGRAPHIC_ASSET_CLUSTER_POLICY,
  GEOGRAPHIC_ASSET_CLUSTER_MODES,
  planGeographicAssetCluster,
  checkClusterGeographySafety,
  clusterDigest,
} from './geographicAssetClusterPlanner.ts';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const GEOGRAPHIC_ASSET_DISTRIBUTION_ADAPTER_POLICY = Object.freeze({
  id: 'geographic-asset-distribution-adapter-2026-09-14-v1',
  contextPolicyId: GEOGRAPHIC_ASSET_CONTEXT_POLICY.id,
  clusterPolicyId: GEOGRAPHIC_ASSET_CLUSTER_POLICY.id,
  canonicalSurfaceOnly: true,
  rendererAgnostic: true,
  deterministic: true,
  noTerrainMutation: true,
  noHydrologyMutation: true,
  noRoadMutation: true,
  noSettlementMutation: true,
  noColliderMutation: true,
  sharedPlacementExpected: true,
  sharedMaterialExpected: true,
});

function normalizeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeDistance(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function normalizeSurfaceEvidence(sample = {}) {
  const context = sample.context || sample;
  return Object.freeze({
    biome: String(context.biome || context.biomeId || '').trim().toLowerCase().replace(/[_\s]+/g, '-'),
    moisture: clamp01(context.moisture ?? context.moisture01),
    slopeDegrees: Math.max(0, normalizeNumber(context.slopeDegrees ?? context.slope, 0)),
    elevationMeters: normalizeNumber(context.elevationMeters ?? context.elevation, 0),
    waterDepth: Math.max(0, normalizeNumber(context.waterDepth, 0)),
    shorelineDistanceMeters: normalizeDistance(context.shorelineDistanceMeters ?? context.shorelineDistance),
    roadDistanceMeters: normalizeDistance(context.roadDistanceMeters ?? context.roadDistance),
    settlementDistanceMeters: normalizeDistance(context.settlementDistanceMeters ?? context.settlementDistance),
    localRelief: clamp01(context.localRelief ?? context.relief01 ?? 0.5),
    isWater: Boolean(context.isWater || context.waterBody),
    waterBody: context.waterBody || null,
    cryosphere: Object.freeze({
      permanentIce: clamp01(context.cryosphere?.permanentIce),
      tundra: clamp01(context.cryosphere?.tundra),
      snowPersistence: clamp01(context.cryosphere?.snowPersistence ?? context.cryosphere?.persistence),
      vegetationSuppression: clamp01(context.cryosphere?.vegetationSuppression),
    }),
    season: Object.freeze({
      spring: clamp01(context.season?.spring),
      summer: clamp01(context.season?.summer),
      autumn: clamp01(context.season?.autumn),
      winter: clamp01(context.season?.winter),
    }),
    roadContext: context.roadContext || Object.freeze({}),
    settlementContext: context.settlementContext || Object.freeze({}),
    utilityAllowed: context.utilityAllowed !== false,
    minimumFamilyScore: Number.isFinite(Number(context.minimumFamilyScore)) ? Number(context.minimumFamilyScore) : 0.34,
  });
}

function familySet(value) {
  if (!Array.isArray(value) || !value.length) return GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS;
  return value.filter(Boolean).map(String);
}

function contextWorldPoint({ worldX = 0, worldZ = 0, anchor = null } = {}) {
  return {
    x: Number(anchor?.x ?? anchor?.worldX ?? worldX) || 0,
    z: Number(anchor?.z ?? anchor?.worldZ ?? worldZ) || 0,
  };
}

export function buildDistributionDecision({
  worldX = 0,
  worldZ = 0,
  anchor = null,
  surfaceSample = null,
  seed = 0,
  familyIds = GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS,
  mode = 'ambient',
  candidateCount = null,
  acceptedCount = null,
  mobile = false,
  surfaceQuery = null,
} = {}) {
  const point = contextWorldPoint({ worldX, worldZ, anchor });
  const surface = normalizeSurfaceEvidence(surfaceSample || {});
  const validation = validateGeographicAssetContextInput(surface);
  if (!validation.ok) return Object.freeze({ ok: false, phase: 'surface-validation', errors: validation.errors, point, surface });

  const context = buildGeographicAssetContext({
    familyIds: familySet(familyIds),
    worldX: point.x,
    worldZ: point.z,
    seed,
    context: surface,
  });
  if (!context.ok) return Object.freeze({ ok: false, phase: 'context', errors: context.errors, point, surface, context });

  const planner = planGeographicAssetCluster({
    anchor: { x: point.x, z: point.z, id: anchor?.id || `${surface.biome || 'surface'}-${point.x}-${point.z}` },
    context: surface,
    familyIds: familySet(familyIds),
    seed,
    mode,
    candidateCount,
    acceptedCount,
    mobile,
    surfaceQuery,
  });
  if (!planner.ok) return Object.freeze({ ok: false, phase: 'cluster', errors: [planner.error || 'cluster-failed'], point, surface, context, planner });

  const safety = checkClusterGeographySafety(planner);
  if (!safety.ok) return Object.freeze({ ok: false, phase: 'cluster-safety', errors: safety.errors, point, surface, context, planner, safety });

  return Object.freeze({
    ok: true,
    policy: GEOGRAPHIC_ASSET_DISTRIBUTION_ADAPTER_POLICY,
    point: Object.freeze(point),
    surface,
    context,
    planner,
    safety,
    digest: geographicAssetContextDigest(context) ^ clusterDigest(planner),
  });
}

export function selectAssetFamilyForSurface(options = {}) {
  const decision = buildDistributionDecision(options);
  if (!decision.ok) return Object.freeze({ ok: false, familyId: null, reason: decision.phase, decision });
  return Object.freeze({
    ok: true,
    familyId: decision.context.selectedFamily,
    variant: decision.context.selectedVariant,
    score: decision.context.selectedScore,
    digest: decision.digest,
    decision,
  });
}

export function buildAssetBatchForSurface(options = {}) {
  const decision = buildDistributionDecision(options);
  if (!decision.ok) return decision;
  return Object.freeze({
    ...decision,
    acceptedAssets: Object.freeze(decision.planner.accepted.map((item, index) => Object.freeze({
      index,
      familyId: item.familyId,
      kind: item.kind,
      x: item.x,
      z: item.z,
      score: item.score,
      density: item.density,
      cluster: item.cluster,
      scale: item.scale,
      rotationBiasRadians: item.rotationBiasRadians,
      surface: item.surface,
      sourceDecisionDigest: decision.digest,
    }))),
  });
}

export function summarizeDistributionDecision(decision) {
  if (!decision?.ok) {
    return Object.freeze({ ok: false, phase: decision?.phase || 'unknown', errors: decision?.errors || [] });
  }
  return Object.freeze({
    ok: true,
    biome: decision.surface.biome,
    selectedFamily: decision.context.selectedFamily,
    selectedVariant: decision.context.selectedVariant,
    selectedScore: decision.context.selectedScore,
    acceptedCount: decision.planner.acceptedCount,
    rejectedCount: decision.planner.rejectedCount,
    attempted: decision.planner.attempted,
    plannerDigest: clusterDigest(decision.planner),
    contextDigest: geographicAssetContextDigest(decision.context),
    decisionDigest: decision.digest,
    mobile: decision.planner.mode?.mobile === true,
  });
}

export function validateDistributionManifest(manifest = {}) {
  const errors = [];
  if (manifest.policy?.id !== GEOGRAPHIC_ASSET_DISTRIBUTION_ADAPTER_POLICY.id) errors.push('policy-id-mismatch');
  if (!Number.isFinite(manifest.digest)) errors.push('missing-digest');
  if (!Array.isArray(manifest.acceptedAssets)) errors.push('missing-accepted-assets');
  for (const [index, item] of (manifest.acceptedAssets || []).entries()) {
    if (!item?.familyId) errors.push(`asset-${index}-missing-family`);
    if (!Number.isFinite(item?.x) || !Number.isFinite(item?.z)) errors.push(`asset-${index}-invalid-position`);
    if (!Number.isFinite(item?.scale)) errors.push(`asset-${index}-invalid-scale`);
    if (item?.surface?.isWater) errors.push(`asset-${index}-water-placement`);
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function replayDistributionDecision(options = {}) {
  const first = buildDistributionDecision(options);
  const second = buildDistributionDecision(options);
  const firstDigest = first.ok ? first.digest : String(first.errors || first.phase);
  const secondDigest = second.ok ? second.digest : String(second.errors || second.phase);
  return Object.freeze({
    ok: firstDigest === secondDigest,
    firstDigest,
    secondDigest,
    first,
    second,
  });
}

export function validateDistributionDeterminism(samples = []) {
  const list = Array.isArray(samples) ? samples : [];
  const results = list.map((sample) => replayDistributionDecision(sample));
  return Object.freeze({
    ok: results.every((result) => result.ok),
    sampleCount: results.length,
    failures: results.map((result, index) => result.ok ? null : index).filter((index) => index !== null),
    results,
  });
}

export function distributionModes() {
  return Object.freeze(Object.entries(GEOGRAPHIC_ASSET_CLUSTER_MODES).map(([id, value]) => Object.freeze({ id, ...value })));
}

export function distributionPolicyDigest() {
  return [
    GEOGRAPHIC_ASSET_DISTRIBUTION_ADAPTER_POLICY.id,
    GEOGRAPHIC_ASSET_CONTEXT_POLICY.id,
    GEOGRAPHIC_ASSET_CLUSTER_POLICY.id,
    Object.keys(GEOGRAPHIC_ASSET_CLUSTER_MODES).join(','),
  ].join('|');
}

export function canonicalContextContractSummary() {
  return Object.freeze({
    adapter: GEOGRAPHIC_ASSET_DISTRIBUTION_ADAPTER_POLICY.id,
    context: GEOGRAPHIC_ASSET_CONTEXT_POLICY.id,
    cluster: GEOGRAPHIC_ASSET_CLUSTER_POLICY.id,
    familyCount: GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS.length,
    modeCount: Object.keys(GEOGRAPHIC_ASSET_CLUSTER_MODES).length,
    deterministic: true,
    canonicalInputsOnly: true,
    placementExpected: true,
    materialExpected: true,
  });
}

export const __TEST__ = Object.freeze({
  clamp01,
  normalizeNumber,
  normalizeDistance,
  normalizeSurfaceEvidence,
  familySet,
  contextWorldPoint,
});

import {
  planGeographicAssetCluster,
} from './geographicAssetClusterPlanner.js';
import {
  V64_CONTRACT,
} from './environmentDressingRuntimeV64.js';

const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const round = (value) => Math.round((Number.isFinite(value) ? value : 0) * 1e6) / 1e6;

function hashString(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function normalizeContext(context = {}) {
  return Object.freeze({
    biome: text(context.biome, 'unknown').toLowerCase(),
    moisture: clamp01(context.moisture),
    slopeDegrees: clamp(context.slopeDegrees ?? context.slope, 0, 89.9),
    elevationMeters: clamp(context.elevationMeters, -200, 10000),
    waterDepth: clamp(context.waterDepth, 0, 2000),
    shorelineDistanceMeters: clamp(context.shorelineDistanceMeters, 0, 50000),
    roadDistanceMeters: clamp(context.roadDistanceMeters, 0, 50000),
    settlementDistanceMeters: clamp(context.settlementDistanceMeters, 0, 50000),
    localRelief: clamp01(context.localRelief),
    isWater: context.isWater === true,
  });
}

function familiesForContext(context) {
  if (context.isWater || context.waterDepth > 0.05) return [];
  const families = [];
  const wet = context.moisture > 0.62 || context.shorelineDistanceMeters < 60;
  const cold = context.elevationMeters > 1600 || ['alpine', 'tundra', 'taiga'].includes(context.biome);
  const hotDry = ['desert', 'steppe'].includes(context.biome);
  if (cold) families.push('pine', 'snowpine', 'granite', 'froststone', 'scree');
  else if (hotDry) families.push('desertgrass', 'sandstone', 'ashrock');
  else families.push('broadleaf', 'birch', 'meadowgrass', 'fern');
  if (wet) families.push('marshreed', 'wetboulder', 'driftwood');
  if (context.slopeDegrees > 38) families.push('granite', 'basalt', 'cairn');
  return [...new Set(families)].slice(0, 10);
}

function modeForContext(context) {
  if (context.shorelineDistanceMeters < 48) return 'shoreline';
  if (context.slopeDegrees > 34 || context.localRelief > 0.68) return 'geology';
  if (context.roadDistanceMeters < 35) return 'roadside';
  if (context.settlementDistanceMeters < 140) return 'settlementEdge';
  return 'ambient';
}

function placementReason(candidate) {
  if (candidate?.accepted === false) return text(candidate.reason, 'rejected');
  if (candidate?.surface?.valid === false) return 'surface-rejected';
  if (candidate?.water?.blocked) return 'water-buffer';
  return 'accepted';
}

export function createEnvironmentDressingAssetHandoffV64({
  anchor,
  context,
  seed = 'v64-dressing',
  mobile = false,
  maxAccepted,
} = {}) {
  const normalized = normalizeContext(context);
  const safeAnchor = {
    x: Number.isFinite(anchor?.x) ? anchor.x : 0,
    z: Number.isFinite(anchor?.z) ? anchor.z : 0,
    id: text(anchor?.id, 'v64-anchor'),
  };
  const familyIds = familiesForContext(normalized);
  if (familyIds.length === 0) {
    return Object.freeze({
      contract: V64_CONTRACT.id,
      accepted: Object.freeze([]),
      rejected: Object.freeze([]),
      plannerInvoked: false,
      reason: normalized.isWater ? 'water-anchor' : 'unsafe-surface',
      mode: 'none',
      fingerprint: hashString(JSON.stringify({ safeAnchor, normalized, familyIds })),
    });
  }

  const mode = modeForContext(normalized);
  const result = planGeographicAssetCluster({
    anchor: safeAnchor,
    context: normalized,
    familyIds,
    seed,
    mode,
    mobile,
    acceptedCount: Number.isFinite(maxAccepted) ? maxAccepted : undefined,
  });
  const accepted = (Array.isArray(result.accepted) ? result.accepted : []).map((candidate, index) => Object.freeze({
    ...candidate,
    dressingIndex: index,
    surface: Object.freeze({
      biome: normalized.biome,
      moisture: normalized.moisture,
      slopeDegrees: normalized.slopeDegrees,
      elevationMeters: normalized.elevationMeters,
      localRelief: normalized.localRelief,
    }),
    materialPlacementSequence: Object.freeze([
      'asset-hydrate-load',
      'surface-analysis',
      'multi-material-recipe',
      'validateMaterialAssignment',
      'ground-transform',
      'placement-manifest',
      'scene-attach',
    ]),
    materialCore: V64_CONTRACT.sharedPlacement.materialCore,
    placementPipeline: V64_CONTRACT.sharedPlacement.placementPipeline,
    editorRuntimeImported: false,
    geometryCreated: false,
  }));
  const rejected = (Array.isArray(result.rejected) ? result.rejected : []).map((candidate, index) => Object.freeze({
    index,
    x: round(candidate?.x),
    z: round(candidate?.z),
    familyId: text(candidate?.familyId, 'unknown'),
    reason: placementReason(candidate),
  }));

  return Object.freeze({
    contract: V64_CONTRACT.id,
    planner: 'geographicAssetClusterPlanner',
    plannerInvoked: true,
    mode,
    mobile,
    anchor: Object.freeze(safeAnchor),
    context: normalized,
    familyIds: Object.freeze(familyIds),
    accepted: Object.freeze(accepted),
    rejected: Object.freeze(rejected),
    counts: Object.freeze({ accepted: accepted.length, rejected: rejected.length }),
    policy: Object.freeze({
      regularGridDistribution: false,
      canonicalSurfaceSampling: true,
      deterministic: true,
      assetFirst: true,
      maxAccepted: mobile ? 12 : 28,
    }),
    fingerprint: hashString(JSON.stringify({ safeAnchor, normalized, familyIds, mode, accepted, rejected })),
  });
}

export function validateEnvironmentDressingAssetHandoffV64(handoff) {
  const errors = [];
  if (!handoff || typeof handoff !== 'object') errors.push('handoff-not-object');
  if (handoff?.contract !== V64_CONTRACT.id) errors.push('contract-mismatch');
  if (handoff?.planner !== 'geographicAssetClusterPlanner') errors.push('wrong-planner');
  if (handoff?.policy?.regularGridDistribution !== false) errors.push('regular-grid-forbidden');
  if (handoff?.policy?.assetFirst !== true) errors.push('asset-first-required');
  for (const item of handoff?.accepted ?? []) {
    if (item.editorRuntimeImported) errors.push(`editor-runtime:${item.assetId}`);
    if (item.geometryCreated) errors.push(`geometry:${item.assetId}`);
    if (item.materialCore !== V64_CONTRACT.sharedPlacement.materialCore) errors.push(`material-core:${item.assetId}`);
    if (item.placementPipeline !== V64_CONTRACT.sharedPlacement.placementPipeline) errors.push(`placement-pipeline:${item.assetId}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createV64DressingPlacementReplay(options) {
  const first = createEnvironmentDressingAssetHandoffV64(options);
  const second = createEnvironmentDressingAssetHandoffV64(options);
  return Object.freeze({
    equal: first.fingerprint === second.fingerprint,
    firstFingerprint: first.fingerprint,
    secondFingerprint: second.fingerprint,
    acceptedCount: first.accepted.length,
    rejectedCount: first.rejected.length,
  });
}

export function createV64DressingCoveragePlan(samples = []) {
  const input = Array.isArray(samples) ? samples.slice(0, 128) : [];
  const rows = input.map((sample, index) => createEnvironmentDressingAssetHandoffV64({
    anchor: sample.anchor,
    context: sample.context,
    seed: `${sample.seed ?? 'coverage'}-${index}`,
    mobile: sample.mobile === true,
  }));
  const accepted = rows.reduce((sum, row) => sum + row.accepted.length, 0);
  const rejected = rows.reduce((sum, row) => sum + row.rejected.length, 0);
  return Object.freeze({
    sampleCount: rows.length,
    accepted,
    rejected,
    rows: Object.freeze(rows),
    fingerprint: hashString(JSON.stringify(rows.map((row) => row.fingerprint))),
  });
}

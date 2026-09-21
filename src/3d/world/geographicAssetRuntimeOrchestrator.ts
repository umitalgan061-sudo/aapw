/** Production TypeScript owner for src/3d/world/geographicAssetRuntimeOrchestrator.js. Legacy .js remains compatibility-only. */
// @ts-nocheck
import {
  GEOGRAPHIC_REGION_PROFILE_POLICY,
  getGeographicRegionProfile,
  mergeRegionProfile,
  scoreRegionProfile,
} from './geographicAssetRegionProfiles.ts';
import {
  buildDistributionDecision,
  buildAssetBatchForSurface,
  validateDistributionManifest,
  replayDistributionDecision,
} from './geographicAssetDistributionAdapter.js';

export const GEOGRAPHIC_ASSET_RUNTIME_POLICY = Object.freeze({
  id: 'geographic-asset-runtime-orchestrator-2026-09-14-v1',
  regionPolicyId: GEOGRAPHIC_REGION_PROFILE_POLICY.id,
  deterministic: true,
  canonicalSurfaceRequired: true,
  chunkContinuity: true,
  boundaryOwnership: 'lower-chunk-key-wins',
  noGridSampling: true,
  noTerrainMutation: true,
  noHydrologyMutation: true,
  noRoadMutation: true,
  noSettlementMutation: true,
  mobileBudgetScale: .62,
});

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const hash32 = (seed) => {
  let h = (Number(seed) >>> 0) ^ 0x9e3779b9;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};
const hashUnit = (seed) => hash32(seed) / 0xffffffff;
const stableNumber = (value, precision = 1000) => Math.round(finite(value) * precision) / precision;
const normalizeId = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

export const DEFAULT_CHUNK_POLICY = Object.freeze({
  chunkSizeMeters: 128,
  boundaryBandMeters: 8,
  continuityRadiusMeters: 24,
  ownerQuantizationMeters: 0.25,
  maxCarryAcrossBoundary: 16,
  maxAnchorsPerChunk: 24,
  desktopAssetsPerChunk: 72,
  mobileAssetsPerChunk: 42,
});

export const DEFAULT_RUNTIME_BUDGETS = Object.freeze({
  ambient: Object.freeze({ desktop: 36, mobile: 21 }),
  roadside: Object.freeze({ desktop: 20, mobile: 11 }),
  settlementEdge: Object.freeze({ desktop: 28, mobile: 16 }),
  geology: Object.freeze({ desktop: 24, mobile: 14 }),
  shoreline: Object.freeze({ desktop: 24, mobile: 14 }),
});

export const SURFACE_LAYERS = Object.freeze([
  'ocean', 'lake', 'river', 'marsh', 'shore', 'lowland', 'meadow', 'forest', 'woodland',
  'hill', 'mountain', 'alpine', 'snow', 'tundra', 'desert', 'rock', 'ruin', 'settlement',
]);

function normalizeSurface(surface = {}) {
  const biome = normalizeId(surface.biome || surface.biomeId || '');
  const layer = normalizeId(surface.layer || surface.surfaceLayer || biome);
  return Object.freeze({
    biome,
    layer,
    moisture: clamp01(surface.moisture ?? surface.moisture01, .5),
    slopeDegrees: positive(surface.slopeDegrees ?? surface.slope),
    elevationMeters: finite(surface.elevationMeters ?? surface.elevation),
    waterDepth: positive(surface.waterDepth),
    shorelineDistanceMeters: surface.shorelineDistanceMeters == null ? null : positive(surface.shorelineDistanceMeters),
    roadDistanceMeters: surface.roadDistanceMeters == null ? null : positive(surface.roadDistanceMeters),
    settlementDistanceMeters: surface.settlementDistanceMeters == null ? null : positive(surface.settlementDistanceMeters),
    localRelief: clamp01(surface.localRelief ?? surface.relief01, .5),
    isWater: Boolean(surface.isWater || surface.waterBody),
    waterBody: surface.waterBody || null,
    cryosphere: Object.freeze({
      permanentIce: clamp01(surface.cryosphere?.permanentIce),
      tundra: clamp01(surface.cryosphere?.tundra),
      snowPersistence: clamp01(surface.cryosphere?.snowPersistence ?? surface.cryosphere?.persistence),
      vegetationSuppression: clamp01(surface.cryosphere?.vegetationSuppression),
    }),
    season: Object.freeze({
      spring: clamp01(surface.season?.spring),
      summer: clamp01(surface.season?.summer),
      autumn: clamp01(surface.season?.autumn),
      winter: clamp01(surface.season?.winter),
    }),
  });
}

export function resolveRegionProfile(regionId, overlay = null) {
  const base = getGeographicRegionProfile(regionId);
  if (!base && !overlay) return null;
  return mergeRegionProfile(base, overlay);
}

export function scoreRuntimeRegion({ regionId = null, surface = {}, overlay = null, mode = 'ambient' } = {}) {
  const normalized = normalizeSurface(surface);
  const resolved = resolveRegionProfile(regionId, overlay);
  if (!resolved) return Object.freeze({ ok: false, score: 0, reasons: ['missing-region-profile'], regionId });
  const result = scoreRegionProfile(resolved, normalized, mode);
  const waterPenalty = normalized.isWater && mode !== 'shoreline' ? .28 : 0;
  const cryoPenalty = normalized.cryosphere.vegetationSuppression * (mode === 'ambient' ? .26 : .08);
  return Object.freeze({
    ok: true,
    regionId: resolved.id,
    parent: resolved.parent,
    score: Math.max(0, Math.min(1, result.score - waterPenalty - cryoPenalty)),
    reasons: Object.freeze([...result.reasons, waterPenalty ? 'water-penalty' : null, cryoPenalty > 0 ? 'cryo-penalty' : null].filter(Boolean)),
  });
}

export function chunkKeyFor(worldX, worldZ, policy = DEFAULT_CHUNK_POLICY) {
  const size = Math.max(.001, finite(policy.chunkSizeMeters, 128));
  return `${Math.floor(finite(worldX) / size)}:${Math.floor(finite(worldZ) / size)}`;
}

export function parseChunkKey(key) {
  const [x, z] = String(key || '').split(':').map(Number);
  return Number.isInteger(x) && Number.isInteger(z) ? { x, z } : null;
}

export function chunkBoundsFor(key, policy = DEFAULT_CHUNK_POLICY) {
  const parsed = parseChunkKey(key);
  const size = Math.max(.001, finite(policy.chunkSizeMeters, 128));
  if (!parsed) return null;
  return Object.freeze({ minX: parsed.x * size, maxX: (parsed.x + 1) * size, minZ: parsed.z * size, maxZ: (parsed.z + 1) * size });
}

export function distanceToChunkBoundary(worldX, worldZ, policy = DEFAULT_CHUNK_POLICY) {
  const bounds = chunkBoundsFor(chunkKeyFor(worldX, worldZ, policy), policy);
  if (!bounds) return Infinity;
  return Math.min(Math.abs(finite(worldX) - bounds.minX), Math.abs(bounds.maxX - finite(worldX)), Math.abs(finite(worldZ) - bounds.minZ), Math.abs(bounds.maxZ - finite(worldZ)));
}

export function boundaryBandFor(worldX, worldZ, policy = DEFAULT_CHUNK_POLICY) {
  return distanceToChunkBoundary(worldX, worldZ, policy) <= Math.max(0, finite(policy.boundaryBandMeters, 8));
}

export function boundaryOwnerFor(worldX, worldZ, policy = DEFAULT_CHUNK_POLICY) {
  const size = Math.max(.001, finite(policy.chunkSizeMeters, 128));
  const band = Math.max(0, finite(policy.boundaryBandMeters, 8));
  const x = finite(worldX); const z = finite(worldZ);
  const baseX = Math.floor(x / size); const baseZ = Math.floor(z / size);
  const left = Math.abs(x - baseX * size) <= band;
  const down = Math.abs(z - baseZ * size) <= band;
  const candidates = [`${baseX}:${baseZ}`];
  if (left) candidates.push(`${baseX - 1}:${baseZ}`);
  if (down) candidates.push(`${baseX}:${baseZ - 1}`);
  if (left && down) candidates.push(`${baseX - 1}:${baseZ - 1}`);
  return candidates.sort()[0];
}

export function continuitySeedFor({ worldX = 0, worldZ = 0, seed = 0, familyId = '' } = {}) {
  const qx = Math.round(finite(worldX) * 4);
  const qz = Math.round(finite(worldZ) * 4);
  let h = hash32(seed);
  h = hash32(h ^ hash32(qx));
  h = hash32(h ^ hash32(qz));
  h = hash32(h ^ hash32(normalizeId(familyId).length));
  return h >>> 0;
}

export function deterministicJitter(seed, ordinal = 0) {
  return Object.freeze({
    x: hashUnit(hash32(seed ^ (ordinal * 0x45d9f3b))) * 2 - 1,
    z: hashUnit(hash32(seed ^ (ordinal * 0x119de1f3))) * 2 - 1,
    yaw: hashUnit(hash32(seed ^ (ordinal * 0x27d4eb2d))) * Math.PI * 2,
    scale: .82 + hashUnit(hash32(seed ^ (ordinal * 0x165667b1))) * .36,
  });
}

function normalizeBudget(budget, mode, mobile) {
  const fallback = DEFAULT_RUNTIME_BUDGETS[mode] || DEFAULT_RUNTIME_BUDGETS.ambient;
  const value = budget?.[mode] || fallback;
  const raw = mobile ? value.mobile : value.desktop;
  return Math.max(1, Math.floor(finite(raw, mobile ? 12 : 24)));
}

function candidateKey(item) {
  return `${normalizeId(item.familyId)}:${stableNumber(item.x, 100)}:${stableNumber(item.z, 100)}`;
}

function compareCandidate(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (a.familyId !== b.familyId) return a.familyId.localeCompare(b.familyId);
  if (a.x !== b.x) return a.x - b.x;
  return a.z - b.z;
}

function candidateDistance(a, b) {
  return Math.hypot(finite(a.x) - finite(b.x), finite(a.z) - finite(b.z));
}

function sampleAcceptedDistance(candidate, accepted) {
  let min = Infinity;
  for (const item of accepted) min = Math.min(min, candidateDistance(candidate, item));
  return min;
}

function scoreFamilyBias(profileValue, familyId) {
  const bias = finite(profileValue?.familyBias?.[familyId], 1);
  if (Array.isArray(profileValue?.avoidFamilies) && profileValue.avoidFamilies.includes(familyId)) return 0;
  return Math.max(0, bias);
}

export function buildAnchorRuntimeContext({
  anchor = {},
  surface = {},
  regionId = null,
  regionOverlay = null,
  mode = 'ambient',
  seed = 0,
  mobile = false,
} = {}) {
  const point = { x: finite(anchor.x ?? anchor.worldX), z: finite(anchor.z ?? anchor.worldZ) };
  const normalized = normalizeSurface(surface);
  const region = resolveRegionProfile(regionId, regionOverlay);
  const regionScore = scoreRuntimeRegion({ regionId, surface: normalized, overlay: regionOverlay, mode });
  const owner = boundaryOwnerFor(point.x, point.z);
  return Object.freeze({
    point: Object.freeze(point),
    surface: normalized,
    region,
    regionScore,
    ownerChunkKey: owner,
    boundaryBand: boundaryBandFor(point.x, point.z),
    continuitySeed: continuitySeedFor({ worldX: point.x, worldZ: point.z, seed, familyId: region?.id || regionId || mode }),
    mode,
    mobile: Boolean(mobile),
  });
}

function createCandidate({ anchor, context, familyId, ordinal, regionProfile, mode, seed }) {
  const jitter = deterministicJitter(hash32(context.continuitySeed ^ seed), ordinal);
  const radius = Math.max(2, finite(regionProfile?.continuityRadius, 24));
  const angular = jitter.yaw + ordinal * .61803398875;
  const radial = radius * (.18 + Math.sqrt(hashUnit(hash32(context.continuitySeed ^ ordinal))) * .82);
  const x = anchor.x + Math.cos(angular) * radial + jitter.x * .5;
  const z = anchor.z + Math.sin(angular) * radial + jitter.z * .5;
  const edgePenalty = context.boundaryBand && mode !== 'shoreline' ? .08 : 0;
  const bias = scoreFamilyBias(regionProfile, familyId);
  const seasonBias = finite(regionProfile?.seasonality?.[dominantSeason(context.surface.season)], 1);
  const waterPenalty = context.surface.isWater && mode !== 'shoreline' ? .5 : 0;
  const priority = Math.max(0, context.regionScore.score * .5 + bias * .25 + seasonBias * .12 - edgePenalty - waterPenalty + hashUnit(hash32(seed ^ ordinal)) * .13);
  return Object.freeze({
    familyId,
    kind: familyId,
    ordinal,
    x: stableNumber(x, 1000),
    z: stableNumber(z, 1000),
    priority: stableNumber(priority, 100000),
    scale: stableNumber(jitter.scale, 1000),
    yaw: stableNumber(jitter.yaw, 10000),
    ownerChunkKey: boundaryOwnerFor(x, z),
  });
}

function dominantSeason(season = {}) {
  const entries = Object.entries(season).filter(([, value]) => Number.isFinite(value));
  if (!entries.length) return 'summer';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function familyList(familyIds, regionProfile) {
  const input = Array.isArray(familyIds) && familyIds.length ? familyIds : Object.keys(regionProfile?.familyBias || {});
  return [...new Set(input.map(normalizeId).filter(Boolean))];
}

export function planRuntimeAnchor(options = {}) {
  const {
    anchor = {},
    surface = {},
    regionId = null,
    regionOverlay = null,
    familyIds = [],
    mode = 'ambient',
    seed = 0,
    mobile = false,
    budget = DEFAULT_RUNTIME_BUDGETS,
    candidateMultiplier = 2.5,
    minimumSpacing = 3.2,
  } = options;
  const context = buildAnchorRuntimeContext({ anchor, surface, regionId, regionOverlay, mode, seed, mobile });
  if (context.surface.isWater && mode !== 'shoreline') {
    return Object.freeze({ ok: true, skipped: true, reason: 'non-shoreline-water', context, accepted: [], rejected: [], attempted: 0 });
  }
  if (!context.regionScore.ok && regionId) return Object.freeze({ ok: false, error: 'missing-region-profile', context, accepted: [], rejected: [] });
  const regionProfile = context.region || Object.freeze({ familyBias: {} });
  const families = familyList(familyIds, regionProfile);
  if (!families.length) return Object.freeze({ ok: true, skipped: true, reason: 'no-families', context, accepted: [], rejected: [], attempted: 0 });
  const budgetLimit = normalizeBudget(budget, mode, mobile);
  const candidateCount = Math.max(budgetLimit, Math.ceil(budgetLimit * Math.max(1, finite(candidateMultiplier, 2.5))));
  const raw = [];
  for (let ordinal = 0; ordinal < candidateCount; ordinal += 1) {
    const familyId = families[hash32(context.continuitySeed ^ ordinal) % families.length];
    raw.push(createCandidate({ anchor: context.point, context, familyId, ordinal, regionProfile, mode, seed }));
  }
  raw.sort(compareCandidate);
  const accepted = [];
  const rejected = [];
  for (const candidate of raw) {
    if (accepted.length >= budgetLimit) {
      rejected.push(Object.freeze({ ...candidate, reason: 'budget-cap' }));
      continue;
    }
    const spacing = sampleAcceptedDistance(candidate, accepted);
    const spacingFloor = Math.max(.5, finite(minimumSpacing, 3.2)) * (mobile ? 1.08 : 1);
    if (spacing < spacingFloor) {
      rejected.push(Object.freeze({ ...candidate, reason: 'minimum-spacing', distance: stableNumber(spacing, 1000) }));
      continue;
    }
    if (candidate.ownerChunkKey !== context.ownerChunkKey && distanceToChunkBoundary(candidate.x, candidate.z) > DEFAULT_CHUNK_POLICY.boundaryBandMeters) {
      rejected.push(Object.freeze({ ...candidate, reason: 'foreign-chunk' }));
      continue;
    }
    accepted.push(candidate);
  }
  return Object.freeze({
    ok: true,
    skipped: false,
    context,
    attempted: raw.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted: Object.freeze(accepted),
    rejected: Object.freeze(rejected),
  });
}

export function enforceChunkBudget(results = [], { mobile = false, maxAssets = null } = {}) {
  const list = Array.isArray(results) ? results.flatMap((item) => item?.accepted || []) : [];
  const cap = maxAssets == null ? (mobile ? DEFAULT_CHUNK_POLICY.mobileAssetsPerChunk : DEFAULT_CHUNK_POLICY.desktopAssetsPerChunk) : Math.max(0, Math.floor(maxAssets));
  const sorted = [...list].sort((a, b) => compareCandidate(a, b));
  const accepted = sorted.slice(0, cap);
  const rejected = sorted.slice(cap).map((item) => Object.freeze({ ...item, reason: 'chunk-cap' }));
  return Object.freeze({ accepted: Object.freeze(accepted), rejected: Object.freeze(rejected), cap });
}

export function mergeAnchorPlans(results = [], options = {}) {
  const candidates = [];
  for (const result of Array.isArray(results) ? results : []) {
    candidates.push(...(result?.accepted || []));
  }
  const dedupe = new Map();
  for (const item of candidates) dedupe.set(candidateKey(item), item);
  const unique = [...dedupe.values()].sort(compareCandidate);
  const cap = options.maxAssets == null ? (options.mobile ? DEFAULT_CHUNK_POLICY.mobileAssetsPerChunk : DEFAULT_CHUNK_POLICY.desktopAssetsPerChunk) : Math.max(0, Math.floor(options.maxAssets));
  const accepted = unique.slice(0, cap);
  const rejected = unique.slice(cap).map((item) => Object.freeze({ ...item, reason: 'merged-cap' }));
  return Object.freeze({ ok: true, attempted: candidates.length, uniqueCount: unique.length, acceptedCount: accepted.length, rejectedCount: rejected.length, accepted: Object.freeze(accepted), rejected: Object.freeze(rejected) });
}

export function buildChunkRuntimePlan({
  chunkKey,
  anchors = [],
  regionId = null,
  regionOverlay = null,
  familyIds = [],
  mode = 'ambient',
  seed = 0,
  mobile = false,
  budget = DEFAULT_RUNTIME_BUDGETS,
} = {}) {
  const parsed = parseChunkKey(chunkKey);
  if (!parsed) return Object.freeze({ ok: false, error: 'invalid-chunk-key', chunkKey });
  const anchored = [];
  const maxAnchors = Math.max(1, Math.floor(DEFAULT_CHUNK_POLICY.maxAnchorsPerChunk));
  for (const anchor of (Array.isArray(anchors) ? anchors : []).slice(0, maxAnchors)) {
    if (boundaryOwnerFor(anchor.x, anchor.z) !== chunkKey && !boundaryBandFor(anchor.x, anchor.z)) continue;
    anchored.push(planRuntimeAnchor({ anchor, surface: anchor.surface || {}, regionId: anchor.regionId || regionId, regionOverlay, familyIds, mode: anchor.mode || mode, seed: seed ^ hash32(anchor.id || `${anchor.x}:${anchor.z}`), mobile, budget }));
  }
  const merged = mergeAnchorPlans(anchored, { mobile, maxAssets: mobile ? DEFAULT_CHUNK_POLICY.mobileAssetsPerChunk : DEFAULT_CHUNK_POLICY.desktopAssetsPerChunk });
  return Object.freeze({
    ok: true,
    chunkKey,
    anchorsPlanned: anchored.length,
    mode,
    mobile,
    anchorResults: Object.freeze(anchored),
    accepted: merged.accepted,
    rejected: merged.rejected,
    acceptedCount: merged.acceptedCount,
    rejectedCount: merged.rejectedCount,
    budget: merged.cap,
  });
}

export function serializeRuntimePlan(plan) {
  const compact = {
    chunkKey: plan?.chunkKey || null,
    accepted: (plan?.accepted || []).map((item) => ({ familyId: item.familyId, x: item.x, z: item.z, scale: item.scale, yaw: item.yaw })),
    rejectedCount: plan?.rejectedCount || 0,
    budget: plan?.budget || 0,
  };
  return JSON.stringify(compact);
}

export function runtimePlanDigest(plan) {
  const text = serializeRuntimePlan(plan);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function verifyRuntimePlanDeterminism(options = {}) {
  const a = buildChunkRuntimePlan(options);
  const b = buildChunkRuntimePlan(options);
  const digestA = a.ok ? runtimePlanDigest(a) : `error:${a.error}`;
  const digestB = b.ok ? runtimePlanDigest(b) : `error:${b.error}`;
  return Object.freeze({ ok: digestA === digestB, digestA, digestB, first: a, second: b });
}

export function classifyRuntimeDensity(plan) {
  const accepted = plan?.accepted?.length || 0;
  const budget = Math.max(1, finite(plan?.budget, 1));
  const ratio = accepted / budget;
  return ratio < .2 ? 'sparse' : ratio < .5 ? 'light' : ratio < .82 ? 'balanced' : 'dense';
}

export function summarizeRuntimePlan(plan) {
  const families = {};
  for (const item of plan?.accepted || []) families[item.familyId] = (families[item.familyId] || 0) + 1;
  return Object.freeze({
    ok: Boolean(plan?.ok),
    chunkKey: plan?.chunkKey || null,
    density: classifyRuntimeDensity(plan),
    acceptedCount: plan?.acceptedCount || 0,
    rejectedCount: plan?.rejectedCount || 0,
    budget: plan?.budget || 0,
    familyCounts: Object.freeze(families),
    digest: plan?.ok ? runtimePlanDigest(plan) : null,
  });
}

export function buildSurfaceDistributionManifest(options = {}) {
  const batch = buildAssetBatchForSurface(options);
  if (!batch.ok) return batch;
  const plan = buildChunkRuntimePlan({
    chunkKey: chunkKeyFor(options.worldX, options.worldZ),
    anchors: [{ x: options.worldX, z: options.worldZ, id: options.anchor?.id || 'surface-anchor', surface: options.surfaceSample || {} }],
    regionId: options.regionId || null,
    familyIds: options.familyIds || [],
    mode: options.mode || 'ambient',
    seed: options.seed || 0,
    mobile: Boolean(options.mobile),
  });
  return Object.freeze({
    ok: plan.ok,
    adapterBatch: batch,
    runtimePlan: plan,
    manifest: {
      policy: GEOGRAPHIC_ASSET_RUNTIME_POLICY,
      digest: plan.ok ? runtimePlanDigest(plan) : null,
      acceptedAssets: plan.accepted || [],
      adapterDigest: batch.digest,
    },
  });
}

export function validateRuntimeManifest(manifest = {}) {
  const errors = [];
  if (manifest.policy?.id !== GEOGRAPHIC_ASSET_RUNTIME_POLICY.id) errors.push('policy-id-mismatch');
  if (!Number.isFinite(manifest.digest)) errors.push('missing-runtime-digest');
  const adapter = manifest.adapterBatch;
  if (adapter && adapter.ok) {
    const adapterCheck = validateDistributionManifest({
      policy: adapter.policy,
      digest: adapter.digest,
      acceptedAssets: adapter.acceptedAssets,
    });
    errors.push(...adapterCheck.errors.map((item) => `adapter:${item}`));
  }
  for (const [index, item] of (manifest.acceptedAssets || []).entries()) {
    if (!item?.familyId) errors.push(`asset-${index}-missing-family`);
    if (!Number.isFinite(item?.x) || !Number.isFinite(item?.z)) errors.push(`asset-${index}-invalid-position`);
    if (item?.surface?.isWater && item.familyId !== 'dock' && item.familyId !== 'driftwood') errors.push(`asset-${index}-water-family-mismatch`);
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function compareChunkPlans(a, b) {
  return Object.freeze({
    equal: runtimePlanDigest(a) === runtimePlanDigest(b),
    aDigest: runtimePlanDigest(a),
    bDigest: runtimePlanDigest(b),
    aCount: a?.acceptedCount || 0,
    bCount: b?.acceptedCount || 0,
  });
}

export function continuityWindowForChunk(chunkKey, policy = DEFAULT_CHUNK_POLICY) {
  const bounds = chunkBoundsFor(chunkKey, policy);
  if (!bounds) return null;
  const radius = Math.max(0, finite(policy.continuityRadiusMeters, 24));
  return Object.freeze({ minX: bounds.minX - radius, maxX: bounds.maxX + radius, minZ: bounds.minZ - radius, maxZ: bounds.maxZ + radius, radius });
}

export function pointInWindow(point, window) {
  return Boolean(window) && finite(point?.x) >= window.minX && finite(point?.x) <= window.maxX && finite(point?.z) >= window.minZ && finite(point?.z) <= window.maxZ;
}

export function filterContinuityCarry(items = [], chunkKey, policy = DEFAULT_CHUNK_POLICY) {
  const window = continuityWindowForChunk(chunkKey, policy);
  const capacity = Math.max(0, Math.floor(finite(policy.maxCarryAcrossBoundary, 16)));
  const filtered = (Array.isArray(items) ? items : []).filter((item) => pointInWindow(item, window)).sort(compareCandidate);
  return Object.freeze(filtered.slice(0, capacity));
}

export function prepareBoundaryCarry(plan, chunkKey, policy = DEFAULT_CHUNK_POLICY) {
  const owner = chunkKey;
  const carry = (plan?.accepted || []).filter((item) => item.ownerChunkKey !== owner || boundaryBandFor(item.x, item.z, policy));
  return filterContinuityCarry(carry, chunkKey, policy);
}

export function mergeWithBoundaryCarry(plan, carry = [], options = {}) {
  const local = plan?.accepted || [];
  const combined = [...local, ...carry];
  const dedupe = new Map();
  combined.forEach((item) => dedupe.set(candidateKey(item), item));
  const maxAssets = options.maxAssets == null ? plan?.budget || DEFAULT_CHUNK_POLICY.desktopAssetsPerChunk : options.maxAssets;
  const accepted = [...dedupe.values()].sort(compareCandidate).slice(0, maxAssets);
  return Object.freeze({
    ok: true,
    accepted: Object.freeze(accepted),
    acceptedCount: accepted.length,
    carriedCount: Math.max(0, accepted.length - local.length),
    digest: runtimePlanDigest({ ...plan, accepted }),
  });
}

export function auditRuntimePlanGeography(plan, surfaceResolver = null) {
  const errors = [];
  const warnings = [];
  for (const [index, item] of (plan?.accepted || []).entries()) {
    if (!Number.isFinite(item.x) || !Number.isFinite(item.z)) errors.push(`asset-${index}-non-finite-position`);
    if (item.surface?.isWater && !['dock', 'driftwood'].includes(item.familyId)) errors.push(`asset-${index}-water-placement`);
    if (typeof surfaceResolver === 'function') {
      const sample = surfaceResolver(item.x, item.z, item);
      if (sample?.isWater && !['dock', 'driftwood'].includes(item.familyId)) errors.push(`asset-${index}-resolved-water-placement`);
      if (Number.isFinite(sample?.slopeDegrees) && sample.slopeDegrees > 72) warnings.push(`asset-${index}-extreme-slope`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors, warnings });
}

export function buildRuntimeReplayPacket(options = {}) {
  const plan = buildChunkRuntimePlan(options);
  const verification = verifyRuntimePlanDeterminism(options);
  return Object.freeze({
    policyId: GEOGRAPHIC_ASSET_RUNTIME_POLICY.id,
    planDigest: plan.ok ? runtimePlanDigest(plan) : null,
    deterministic: verification.ok,
    firstDigest: verification.digestA,
    secondDigest: verification.digestB,
    summary: summarizeRuntimePlan(plan),
  });
}

export function applyRuntimePolicy(options = {}) {
  const mobile = Boolean(options.mobile);
  const mode = options.mode || 'ambient';
  const budget = normalizeBudget(options.budget || DEFAULT_RUNTIME_BUDGETS, mode, mobile);
  const profile = resolveRegionProfile(options.regionId, options.regionOverlay);
  const densityMultiplier = clamp01(options.densityMultiplier, 1);
  return Object.freeze({
    ...options,
    mobile,
    mode,
    budget,
    candidateMultiplier: Math.max(1.5, finite(options.candidateMultiplier, 2.5)),
    minimumSpacing: Math.max(.8, finite(options.minimumSpacing, 3.2)),
    densityMultiplier,
    regionDensity: positive(profile?.density, 1),
  });
}

export function planRuntime(options = {}) {
  const normalized = applyRuntimePolicy(options);
  const mode = normalized.mode;
  const budget = { [mode]: { desktop: Math.round(normalized.budget / normalized.densityMultiplier), mobile: Math.round(normalized.budget / Math.max(.2, normalized.densityMultiplier)) } };
  return planRuntimeAnchor({ ...normalized, budget });
}

export function buildRuntimeScenarioSuite(scenarios = []) {
  return Object.freeze((Array.isArray(scenarios) ? scenarios : []).map((scenario) => {
    const replay = replayDistributionDecision(scenario.adapterOptions || scenario);
    const runtime = planRuntime(scenario.runtimeOptions || scenario);
    return Object.freeze({ id: scenario.id || 'scenario', adapterReplay: replay, runtime, runtimeDigest: runtime.ok ? runtimePlanDigest(runtime) : null });
  }));
}

export function summarizeScenarioSuite(results = []) {
  const list = Array.isArray(results) ? results : [];
  return Object.freeze({
    count: list.length,
    deterministicFailures: list.filter((item) => !item.adapterReplay?.ok).length,
    runtimeFailures: list.filter((item) => !item.runtime?.ok).length,
    totalAccepted: list.reduce((sum, item) => sum + (item.runtime?.acceptedCount || 0), 0),
    densityHistogram: Object.freeze(list.reduce((hist, item) => {
      const key = classifyRuntimeDensity(item.runtime);
      hist[key] = (hist[key] || 0) + 1;
      return hist;
    }, {})),
  });
}

export const RUNTIME_RULES = Object.freeze([
  { id: 'north-pine-cold', parent: 'north', mode: 'ambient', familyId: 'pine', moisture: .58, elevation: [300, 1400], score: 1.16 },
  { id: 'north-birch-cold', parent: 'north', mode: 'ambient', familyId: 'birch', moisture: .62, elevation: [100, 900], score: 1.12 },
  { id: 'north-frost-rock', parent: 'north', mode: 'geology', familyId: 'froststone', moisture: .38, elevation: [800, 2400], score: 1.34 },
  { id: 'north-wet-reed', parent: 'north', mode: 'shoreline', familyId: 'marshreed', moisture: .84, elevation: [0, 400], score: 1.32 },
  { id: 'north-river-boulder', parent: 'north', mode: 'shoreline', familyId: 'wetboulder', moisture: .8, elevation: [0, 600], score: 1.28 },
  { id: 'riverlands-grass', parent: 'riverlands', mode: 'ambient', familyId: 'meadowgrass', moisture: .64, elevation: [0, 500], score: 1.36 },
  { id: 'riverlands-reed', parent: 'riverlands', mode: 'shoreline', familyId: 'marshreed', moisture: .9, elevation: [0, 240], score: 1.44 },
  { id: 'riverlands-watermill', parent: 'riverlands', mode: 'shoreline', familyId: 'watermill', moisture: .86, elevation: [0, 260], score: 1.22 },
  { id: 'riverlands-waystone', parent: 'riverlands', mode: 'roadside', familyId: 'waystone', moisture: .52, elevation: [0, 700], score: 1.2 },
  { id: 'vale-granite', parent: 'vale', mode: 'geology', familyId: 'granite', moisture: .4, elevation: [500, 2500], score: 1.48 },
  { id: 'vale-pine', parent: 'vale', mode: 'ambient', familyId: 'pine', moisture: .48, elevation: [400, 1800], score: 1.2 },
  { id: 'vale-cairn', parent: 'vale', mode: 'geology', familyId: 'cairn', moisture: .34, elevation: [700, 2400], score: 1.2 },
  { id: 'westerlands-limestone', parent: 'westerlands', mode: 'geology', familyId: 'limestone', moisture: .34, elevation: [100, 900], score: 1.42 },
  { id: 'westerlands-broadleaf', parent: 'westerlands', mode: 'ambient', familyId: 'broadleaf', moisture: .54, elevation: [0, 800], score: 1.24 },
  { id: 'westerlands-waystone', parent: 'westerlands', mode: 'roadside', familyId: 'waystone', moisture: .38, elevation: [0, 500], score: 1.28 },
  { id: 'reach-grass', parent: 'reach', mode: 'ambient', familyId: 'meadowgrass', moisture: .62, elevation: [0, 350], score: 1.48 },
  { id: 'reach-fence', parent: 'reach', mode: 'settlementEdge', familyId: 'timberfence', moisture: .58, elevation: [0, 420], score: 1.3 },
  { id: 'reach-reed', parent: 'reach', mode: 'shoreline', familyId: 'marshreed', moisture: .88, elevation: [0, 220], score: 1.4 },
  { id: 'crownlands-market', parent: 'crownlands', mode: 'settlementEdge', familyId: 'marketstall', moisture: .46, elevation: [0, 350], score: 1.36 },
  { id: 'crownlands-road', parent: 'crownlands', mode: 'roadside', familyId: 'waystone', moisture: .42, elevation: [0, 450], score: 1.4 },
  { id: 'crownlands-marsh', parent: 'crownlands', mode: 'shoreline', familyId: 'marshreed', moisture: .84, elevation: [0, 200], score: 1.36 },
  { id: 'stormlands-fern', parent: 'stormlands', mode: 'ambient', familyId: 'fern', moisture: .82, elevation: [0, 800], score: 1.32 },
  { id: 'stormlands-boulder', parent: 'stormlands', mode: 'geology', familyId: 'wetboulder', moisture: .84, elevation: [50, 900], score: 1.46 },
  { id: 'stormlands-basalt', parent: 'stormlands', mode: 'geology', familyId: 'basalt', moisture: .66, elevation: [50, 1200], score: 1.24 },
  { id: 'dorne-desertgrass', parent: 'dorne', mode: 'ambient', familyId: 'desertgrass', moisture: .14, elevation: [0, 700], score: 1.64 },
  { id: 'dorne-sandstone', parent: 'dorne', mode: 'geology', familyId: 'sandstone', moisture: .18, elevation: [0, 1000], score: 1.58 },
  { id: 'dorne-waystone', parent: 'dorne', mode: 'roadside', familyId: 'waystone', moisture: .16, elevation: [0, 500], score: 1.34 },
  { id: 'iron-islands-basalt', parent: 'iron-islands', mode: 'geology', familyId: 'basalt', moisture: .74, elevation: [0, 900], score: 1.58 },
  { id: 'iron-islands-driftwood', parent: 'iron-islands', mode: 'shoreline', familyId: 'driftwood', moisture: .86, elevation: [0, 300], score: 1.48 },
  { id: 'iron-islands-dock', parent: 'iron-islands', mode: 'shoreline', familyId: 'dock', moisture: .94, elevation: [0, 120], score: 1.46 },
  { id: 'mountain-granite', parent: 'mountain', mode: 'geology', familyId: 'granite', moisture: .34, elevation: [700, 3000], score: 1.62 },
  { id: 'mountain-frost', parent: 'mountain', mode: 'geology', familyId: 'froststone', moisture: .34, elevation: [1200, 3200], score: 1.56 },
  { id: 'mountain-snowpine', parent: 'mountain', mode: 'ambient', familyId: 'snowpine', moisture: .44, elevation: [1000, 2600], score: 1.42 },
  { id: 'volcanic-basalt', parent: 'volcanic', mode: 'geology', familyId: 'basalt', moisture: .3, elevation: [0, 1800], score: 1.7 },
  { id: 'volcanic-ash', parent: 'volcanic', mode: 'geology', familyId: 'ashrock', moisture: .18, elevation: [0, 2300], score: 1.64 },
  { id: 'ruin-wall', parent: 'ruin', mode: 'settlementEdge', familyId: 'ruinwall', moisture: .54, elevation: [0, 1200], score: 1.64 },
  { id: 'ruin-stone', parent: 'ruin', mode: 'geology', familyId: 'weatheredstone', moisture: .5, elevation: [0, 1600], score: 1.42 },
  { id: 'settlement-fence', parent: 'settlement', mode: 'settlementEdge', familyId: 'timberfence', moisture: .52, elevation: [0, 500], score: 1.46 },
  { id: 'settlement-market', parent: 'settlement', mode: 'settlementEdge', familyId: 'marketstall', moisture: .42, elevation: [0, 450], score: 1.56 },
  { id: 'settlement-harbor', parent: 'settlement', mode: 'settlementEdge', familyId: 'dock', moisture: .86, elevation: [0, 130], score: 1.6 },
]);

export function selectRuntimeFamilyByRule({ regionId, mode = 'ambient', surface = {}, familyIds = [], seed = 0 } = {}) {
  const normalized = normalizeSurface(surface);
  const candidates = RUNTIME_RULES.filter((rule) => rule.parent === regionId && rule.mode === mode && (!familyIds.length || familyIds.includes(rule.familyId)));
  const scored = candidates.map((rule, index) => {
    const moistureDelta = Math.abs(normalized.moisture - rule.moisture);
    const elevationCenter = (rule.elevation[0] + rule.elevation[1]) / 2;
    const elevationSpan = Math.max(1, rule.elevation[1] - rule.elevation[0]);
    const elevationFit = Math.max(0, 1 - Math.abs(normalized.elevationMeters - elevationCenter) / elevationSpan);
    return { rule, score: rule.score - moistureDelta * .6 + elevationFit * .18 + hashUnit(hash32(seed ^ index)) * .05 };
  }).sort((a, b) => b.score - a.score);
  const winner = scored[0] || null;
  return Object.freeze({ ok: Boolean(winner), familyId: winner?.rule?.familyId || null, score: winner ? stableNumber(winner.score, 10000) : 0, alternatives: Object.freeze(scored.slice(1, 5).map((item) => Object.freeze({ familyId: item.rule.familyId, score: stableNumber(item.score, 10000) }))) });
}

export function buildRegionRuntimeManifest({ regionId, mode = 'ambient', surface = {}, seed = 0, familyIds = [] } = {}) {
  const profileResult = scoreRuntimeRegion({ regionId, surface, mode });
  const selection = selectRuntimeFamilyByRule({ regionId, mode, surface, familyIds, seed });
  return Object.freeze({ policyId: GEOGRAPHIC_ASSET_RUNTIME_POLICY.id, profileResult, selection, digest: hash32(seed ^ hash32(regionId || '') ^ hash32(mode)) });
}

export const __TEST__ = Object.freeze({
  normalizeSurface,
  hash32,
  hashUnit,
  normalizeBudget,
  compareCandidate,
  candidateDistance,
  scoreFamilyBias,
});


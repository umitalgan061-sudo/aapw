import {
  GEOGRAPHIC_ASSET_RUNTIME_POLICY,
  DEFAULT_CHUNK_POLICY,
  buildChunkRuntimePlan,
  runtimePlanDigest,
  classifyRuntimeDensity,
  boundaryBandFor,
  boundaryOwnerFor,
  continuityWindowForChunk,
  pointInWindow,
} from './geographicAssetRuntimeOrchestrator.ts';

export const GEOGRAPHIC_ASSET_RUNTIME_EXECUTION_POLICY = Object.freeze({
  id: 'geographic-asset-runtime-execution-adapter-2026-09-14-v1',
  runtimePolicyId: GEOGRAPHIC_ASSET_RUNTIME_POLICY.id,
  rendererNeutral: true,
  instanceCreationDeferred: true,
  materialAssignmentDeferred: true,
  frustumCullingDeferred: false,
  supportsMobileBudget: true,
  supportsChunkContinuity: true,
  noTerrainMutation: true,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const distance2 = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
const stable = (value) => Math.round(finite(value) * 1000) / 1000;

export const DEFAULT_EXECUTION_POLICY = Object.freeze({
  lodDistances: Object.freeze({ high: 80, medium: 180, low: 360, hidden: 520 }),
  maxVisibleDesktop: 220,
  maxVisibleMobile: 128,
  maxNewPerFrameDesktop: 18,
  maxNewPerFrameMobile: 8,
  fadeBandMeters: 28,
  farAssetScale: .72,
  mediumAssetScale: .88,
  lowAssetScale: .62,
});

function normalizeCamera(camera = {}) {
  return Object.freeze({ x: finite(camera.x), z: finite(camera.z), far: finite(camera.far, DEFAULT_EXECUTION_POLICY.lodDistances.hidden), mobile: Boolean(camera.mobile) });
}

export function classifyAssetLod(asset, camera, policy = DEFAULT_EXECUTION_POLICY) {
  const distance = distance2(asset, camera);
  if (distance <= policy.lodDistances.high) return Object.freeze({ level: 'high', distance });
  if (distance <= policy.lodDistances.medium) return Object.freeze({ level: 'medium', distance });
  if (distance <= policy.lodDistances.low) return Object.freeze({ level: 'low', distance });
  if (distance <= Math.min(camera.far, policy.lodDistances.hidden)) return Object.freeze({ level: 'billboard', distance });
  return Object.freeze({ level: 'hidden', distance });
}

function scaleForLod(level, policy = DEFAULT_EXECUTION_POLICY) {
  if (level === 'medium') return policy.mediumAssetScale;
  if (level === 'low') return policy.lowAssetScale;
  if (level === 'billboard') return policy.farAssetScale;
  return 1;
}

function priorityForAsset(asset, lod, boundary = false) {
  const base = finite(asset?.priority, .5);
  const levelWeight = lod.level === 'high' ? 1 : lod.level === 'medium' ? .84 : lod.level === 'low' ? .62 : lod.level === 'billboard' ? .34 : 0;
  return stable(Math.max(0, base * levelWeight + (boundary ? .06 : 0)));
}

export function buildVisibilityRecords(plan, cameraInput = {}, policy = DEFAULT_EXECUTION_POLICY) {
  const camera = normalizeCamera(cameraInput);
  const records = [];
  for (const asset of plan?.accepted || []) {
    const lod = classifyAssetLod(asset, camera, policy);
    if (lod.level === 'hidden') continue;
    const boundary = boundaryBandFor(asset.x, asset.z);
    records.push(Object.freeze({
      ...asset,
      lod: lod.level,
      distance: stable(lod.distance),
      effectiveScale: stable(finite(asset.scale, 1) * scaleForLod(lod.level, policy)),
      priority: priorityForAsset(asset, lod, boundary),
      boundary,
      ownerChunkKey: boundaryOwnerFor(asset.x, asset.z),
    }));
  }
  records.sort((a, b) => b.priority - a.priority || a.distance - b.distance);
  return Object.freeze(records);
}

export function capVisibleRecords(records, cameraInput = {}, policy = DEFAULT_EXECUTION_POLICY) {
  const camera = normalizeCamera(cameraInput);
  const cap = camera.mobile ? policy.maxVisibleMobile : policy.maxVisibleDesktop;
  const selected = (Array.isArray(records) ? records : []).slice(0, Math.max(0, Math.floor(cap)));
  const culled = (Array.isArray(records) ? records : []).slice(selected.length).map((item) => Object.freeze({ ...item, cullReason: 'visibility-cap' }));
  return Object.freeze({ selected: Object.freeze(selected), culled: Object.freeze(culled), cap });
}

export function throttleNewRecords(records, cameraInput = {}, policy = DEFAULT_EXECUTION_POLICY) {
  const camera = normalizeCamera(cameraInput);
  const cap = camera.mobile ? policy.maxNewPerFrameMobile : policy.maxNewPerFrameDesktop;
  return Object.freeze({
    ready: Object.freeze((records || []).slice(0, Math.max(0, Math.floor(cap)))),
    deferred: Object.freeze((records || []).slice(Math.max(0, Math.floor(cap))).map((item) => Object.freeze({ ...item, deferred: true }))),
    cap,
  });
}

export function buildExecutionFrame(plan, cameraInput = {}, policy = DEFAULT_EXECUTION_POLICY) {
  const visibility = buildVisibilityRecords(plan, cameraInput, policy);
  const capped = capVisibleRecords(visibility, cameraInput, policy);
  const throttled = throttleNewRecords(capped.selected, cameraInput, policy);
  return Object.freeze({
    ok: true,
    policyId: GEOGRAPHIC_ASSET_RUNTIME_EXECUTION_POLICY.id,
    sourcePlanDigest: runtimePlanDigest(plan),
    density: classifyRuntimeDensity(plan),
    visibleCount: capped.selected.length,
    deferredCount: throttled.deferred.length + capped.culled.length,
    ready: throttled.ready,
    deferred: Object.freeze([...throttled.deferred, ...capped.culled]),
    culled: capped.culled,
  });
}

export function buildChunkExecution({
  chunkKey,
  anchors = [],
  regionId = null,
  regionOverlay = null,
  familyIds = [],
  mode = 'ambient',
  seed = 0,
  mobile = false,
  camera = {},
  planBudget = undefined,
  policy = DEFAULT_EXECUTION_POLICY,
} = {}) {
  const plan = buildChunkRuntimePlan({ chunkKey, anchors, regionId, regionOverlay, familyIds, mode, seed, mobile });
  if (!plan.ok) return Object.freeze({ ok: false, phase: 'planning', error: plan.error, plan });
  const execution = buildExecutionFrame(plan, { ...camera, mobile }, policy);
  return Object.freeze({ ok: true, plan, execution, digest: runtimePlanDigest(plan) });
}

export function assetLodContract(asset, camera, policy = DEFAULT_EXECUTION_POLICY) {
  const lod = classifyAssetLod(asset, normalizeCamera(camera), policy);
  return Object.freeze({
    id: `${normalize(asset.familyId)}:${stable(asset.x)}:${stable(asset.z)}`,
    familyId: normalize(asset.familyId),
    level: lod.level,
    distance: stable(lod.distance),
    scale: stable(finite(asset.scale, 1) * scaleForLod(lod.level, policy)),
  });
}

export function buildLodHistogram(records = []) {
  return Object.freeze((records || []).reduce((histogram, record) => {
    const level = record.lod || 'unknown';
    histogram[level] = (histogram[level] || 0) + 1;
    return histogram;
  }, {}));
}

export function summarizeExecutionFrame(frame) {
  return Object.freeze({
    ok: Boolean(frame?.ok),
    policyId: frame?.policyId || null,
    sourcePlanDigest: frame?.sourcePlanDigest ?? null,
    visibleCount: frame?.visibleCount || 0,
    deferredCount: frame?.deferredCount || 0,
    lodHistogram: buildLodHistogram(frame?.ready || []),
  });
}

export function continuityProbe(chunkKey, records = [], policy = DEFAULT_CHUNK_POLICY) {
  const window = continuityWindowForChunk(chunkKey, policy);
  const inside = (records || []).filter((record) => pointInWindow(record, window));
  const boundary = inside.filter((record) => boundaryBandFor(record.x, record.z, policy));
  return Object.freeze({ chunkKey, window, insideCount: inside.length, boundaryCount: boundary.length, records: Object.freeze(boundary) });
}

export function chooseCrossChunkOwner(record, policy = DEFAULT_CHUNK_POLICY) {
  return Object.freeze({ x: record.x, z: record.z, ownerChunkKey: boundaryOwnerFor(record.x, record.z, policy), localChunkKey: normalize(record.chunkKey || '') });
}

export function reconcileCrossChunkRecords(leftFrame, rightFrame, policy = DEFAULT_CHUNK_POLICY) {
  const left = leftFrame?.ready || [];
  const right = rightFrame?.ready || [];
  const leftMap = new Map(left.map((item) => [`${item.familyId}:${stable(item.x)}:${stable(item.z)}`, item]));
  const duplicates = [];
  for (const item of right) {
    const key = `${item.familyId}:${stable(item.x)}:${stable(item.z)}`;
    if (leftMap.has(key)) duplicates.push(Object.freeze({ left: leftMap.get(key), right: item, owner: chooseCrossChunkOwner(item, policy) }));
  }
  return Object.freeze({ ok: true, duplicateCount: duplicates.length, duplicates: Object.freeze(duplicates) });
}

export function buildFrameDigest(frame) {
  const text = JSON.stringify({ ready: (frame?.ready || []).map((item) => [item.familyId, stable(item.x), stable(item.z), item.lod]), deferred: frame?.deferred?.length || 0 });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function verifyExecutionDeterminism(options = {}) {
  const first = buildChunkExecution(options);
  const second = buildChunkExecution(options);
  const a = first.ok ? buildFrameDigest(first.execution) : `error:${first.error}`;
  const b = second.ok ? buildFrameDigest(second.execution) : `error:${second.error}`;
  return Object.freeze({ ok: a === b, firstDigest: a, secondDigest: b });
}

export function validateExecutionFrame(frame) {
  const errors = [];
  if (frame?.policyId !== GEOGRAPHIC_ASSET_RUNTIME_EXECUTION_POLICY.id) errors.push('policy-id-mismatch');
  for (const [index, item] of (frame?.ready || []).entries()) {
    if (!item.familyId) errors.push(`ready-${index}-missing-family`);
    if (!Number.isFinite(item.x) || !Number.isFinite(item.z)) errors.push(`ready-${index}-bad-position`);
    if (!['high', 'medium', 'low', 'billboard'].includes(item.lod)) errors.push(`ready-${index}-bad-lod`);
  }
  for (const [index, item] of (frame?.deferred || []).entries()) {
    if (!item.familyId) errors.push(`deferred-${index}-missing-family`);
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function performanceBudgetFor(mode = 'ambient', mobile = false) {
  const table = {
    ambient: { desktop: 18, mobile: 8 },
    roadside: { desktop: 12, mobile: 6 },
    settlementEdge: { desktop: 16, mobile: 7 },
    geology: { desktop: 14, mobile: 6 },
    shoreline: { desktop: 14, mobile: 6 },
  };
  const value = table[mode] || table.ambient;
  return mobile ? value.mobile : value.desktop;
}

export function combineExecutionFrames(frames = [], camera = {}, policy = DEFAULT_EXECUTION_POLICY) {
  const records = [];
  for (const frame of Array.isArray(frames) ? frames : []) records.push(...(frame?.plan?.accepted || []));
  const synthetic = { ok: true, accepted: records };
  return buildExecutionFrame(synthetic, camera, policy);
}

export function buildExecutionReport(execution) {
  const validation = validateExecutionFrame(execution);
  return Object.freeze({
    ok: validation.ok,
    validation,
    summary: summarizeExecutionFrame(execution),
    frameDigest: execution?.ok ? buildFrameDigest(execution) : null,
    sourcePlanDigest: execution?.sourcePlanDigest ?? null,
  });
}

export const __TEST__ = Object.freeze({
  distance2,
  normalize,
  scaleForLod,
  priorityForAsset,
});

import { buildChunkRuntimePlan, prepareBoundaryCarry, mergeWithBoundaryCarry, runtimePlanDigest, chunkBoundsFor } from './geographicAssetRuntimeOrchestrator.js';
import { buildExecutionFrame, DEFAULT_EXECUTION_POLICY } from './geographicAssetRuntimeExecutionAdapter.js';
import { auditPlan } from './geographicAssetRuntimeAudit.js';

export const GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY = Object.freeze({
  id: 'geographic-asset-runtime-chunk-coordinator-2026-09-14-v1',
  maxResidentChunksDesktop: 9,
  maxResidentChunksMobile: 6,
  prefetchRingDesktop: 1,
  prefetchRingMobile: 0,
  unloadGraceFrames: 3,
  carryTransferEnabled: true,
  deterministic: true,
});

function numeric(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function chunkDistance(a, b) { const ax = Number(a?.x) || 0; const az = Number(a?.z) || 0; const bx = Number(b?.x) || 0; const bz = Number(b?.z) || 0; return Math.hypot(ax - bx, az - bz); }
function frameDistance(chunkKey, cameraChunkKey) { const a = String(chunkKey).split(':').map(Number); const b = String(cameraChunkKey).split(':').map(Number); if (a.length !== 2 || b.length !== 2 || a.some(Number.isNaN) || b.some(Number.isNaN)) return Infinity; return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }

export function desiredChunkRing(cameraChunkKey, mobile = false) {
  const [cx, cz] = String(cameraChunkKey || '0:0').split(':').map(Number);
  const radius = mobile ? GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.prefetchRingMobile : GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.prefetchRingDesktop;
  const result = [];
  for (let x = cx - radius; x <= cx + radius; x += 1) for (let z = cz - radius; z <= cz + radius; z += 1) result.push(`${x}:${z}`);
  return Object.freeze(result.sort());
}

export function createChunkRecord(chunkKey, plan, execution, camera = {}) {
  return Object.freeze({
    chunkKey,
    loaded: true,
    lastTouchedFrame: numeric(camera.frame),
    acceptedCount: plan?.acceptedCount || 0,
    visibleCount: execution?.visibleCount || 0,
    planDigest: plan?.ok ? runtimePlanDigest(plan) : null,
    executionDigest: execution?.ok ? execution.ready?.length || 0 : null,
    bounds: chunkBoundsFor(chunkKey),
    carry: prepareBoundaryCarry(plan, chunkKey),
  });
}

export function planChunkRecord(options = {}) {
  const plan = buildChunkRuntimePlan(options);
  if (!plan.ok) return Object.freeze({ ok: false, phase: 'plan', error: plan.error, plan });
  const execution = buildExecutionFrame(plan, options.camera || {}, options.executionPolicy || DEFAULT_EXECUTION_POLICY);
  return Object.freeze({ ok: true, plan, execution, record: createChunkRecord(options.chunkKey, plan, execution, options.camera || {}) });
}

export function touchChunk(record, frame = 0) {
  return Object.freeze({ ...record, loaded: true, lastTouchedFrame: numeric(frame, record?.lastTouchedFrame || 0) });
}

export function shouldUnload(record, currentFrame, cameraChunkKey, mobile = false) {
  if (!record?.loaded) return false;
  if (record.chunkKey === cameraChunkKey) return false;
  const max = mobile ? GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.maxResidentChunksMobile : GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.maxResidentChunksDesktop;
  const far = frameDistance(record.chunkKey, cameraChunkKey) > (mobile ? 1 : 2);
  const stale = numeric(currentFrame) - numeric(record.lastTouchedFrame) >= GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.unloadGraceFrames;
  return far && stale && max > 0;
}

export function unloadChunk(record, frame = 0) {
  return Object.freeze({ ...record, loaded: false, unloadedAtFrame: numeric(frame) });
}

export function reconcileNeighborContinuity(leftRecord, rightPlan, rightChunkKey) {
  const carry = leftRecord?.carry || [];
  const merged = mergeWithBoundaryCarry(rightPlan, carry);
  return Object.freeze({
    ok: merged.ok,
    rightChunkKey,
    carriedCount: merged.carriedCount,
    planDigest: merged.digest,
    accepted: merged.accepted,
  });
}

export function updateResidentSet(records = [], cameraChunkKey, currentFrame = 0, mobile = false) {
  const list = Array.isArray(records) ? records.map((record) => touchChunk(record, currentFrame)) : [];
  const desired = new Set(desiredChunkRing(cameraChunkKey, mobile));
  const loaded = list.filter((record) => record.loaded);
  const target = [];
  const overflow = [];
  for (const record of loaded) {
    if (desired.has(record.chunkKey)) target.push(record);
    else if (shouldUnload(record, currentFrame, cameraChunkKey, mobile)) overflow.push(unloadChunk(record, currentFrame));
    else target.push(record);
  }
  const cap = mobile ? GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.maxResidentChunksMobile : GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.maxResidentChunksDesktop;
  const sorted = target.sort((a, b) => frameDistance(a.chunkKey, cameraChunkKey) - frameDistance(b.chunkKey, cameraChunkKey));
  const kept = sorted.slice(0, cap);
  const evicted = [...overflow, ...sorted.slice(cap).map((record) => unloadChunk(record, currentFrame))];
  return Object.freeze({ loaded: Object.freeze(kept), evicted: Object.freeze(evicted), cap, desired: Object.freeze([...desired]) });
}

export function coordinatorDigest(state) {
  const ordered = [...(state?.loaded || [])].sort((a, b) => String(a.chunkKey).localeCompare(String(b.chunkKey)));
  const text = ordered.map((item) => `${item.chunkKey}:${item.planDigest || 0}`).join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function buildCoordinatorState(records = [], cameraChunkKey = '0:0', frame = 0, mobile = false) {
  const updated = updateResidentSet(records, cameraChunkKey, frame, mobile);
  return Object.freeze({
    policyId: GEOGRAPHIC_ASSET_CHUNK_COORDINATOR_POLICY.id,
    cameraChunkKey,
    frame,
    mobile,
    loaded: updated.loaded,
    evicted: updated.evicted,
    desired: updated.desired,
    digest: coordinatorDigest(updated),
  });
}

export function validateCoordinatorState(state) {
  const errors = [];
  const seen = new Set();
  for (const record of state?.loaded || []) {
    if (!record.chunkKey) errors.push('missing-chunk-key');
    if (seen.has(record.chunkKey)) errors.push(`duplicate:${record.chunkKey}`);
    seen.add(record.chunkKey);
    if (record.loaded !== true) errors.push(`unloaded-in-loaded:${record.chunkKey}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function auditResidentChunks(state) {
  const audits = (state?.loaded || []).map((record) => auditPlan({ accepted: [] }, record.chunkKey));
  return Object.freeze({ ok: audits.every((item) => item.ok), count: audits.length, audits });
}

export function planAndCoordinate({ cameraChunkKey = '0:0', frame = 0, mobile = false, chunks = [] } = {}) {
  const planned = [];
  for (const options of Array.isArray(chunks) ? chunks : []) {
    const result = planChunkRecord({ ...options, camera: { ...(options.camera || {}), frame, mobile } });
    if (result.ok) planned.push(result.record);
  }
  return buildCoordinatorState(planned, cameraChunkKey, frame, mobile);
}

export const __TEST__ = Object.freeze({ frameDistance, numeric });

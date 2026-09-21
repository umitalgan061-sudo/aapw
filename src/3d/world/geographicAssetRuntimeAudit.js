import { runtimePlanDigest, boundaryOwnerFor, boundaryBandFor } from './geographicAssetRuntimeOrchestrator.ts';
import { GEOGRAPHIC_ASSET_RUNTIME_EXECUTION_POLICY, buildLodHistogram } from './geographicAssetRuntimeExecutionAdapter.js';

export const GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY = Object.freeze({
  id: 'geographic-asset-runtime-audit-2026-09-14-v1',
  executionPolicyId: GEOGRAPHIC_ASSET_RUNTIME_EXECUTION_POLICY.id,
  deterministic: true,
  minimumSampleCount: 6,
  maxFamilyShare: .72,
  minFamilyEntropy: .36,
  maxBoundaryLeakRate: .08,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const stable = (value) => Math.round(finite(value) * 10000) / 10000;
const key = (item) => `${item.familyId}:${stable(item.x)}:${stable(item.z)}`;

function counts(items = []) {
  return (items || []).reduce((result, item) => {
    const id = String(item.familyId || 'unknown');
    result[id] = (result[id] || 0) + 1;
    return result;
  }, {});
}

export function familyEntropy(items = []) {
  const histogram = counts(items);
  const total = Math.max(1, Object.values(histogram).reduce((sum, value) => sum + value, 0));
  let entropy = 0;
  for (const value of Object.values(histogram)) {
    const p = value / total;
    entropy -= p * Math.log2(p);
  }
  const familyCount = Math.max(1, Object.keys(histogram).length);
  return stable(entropy / Math.log2(familyCount));
}

export function nearestNeighborStats(items = []) {
  const list = Array.isArray(items) ? items.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.z)) : [];
  if (list.length < 2) return Object.freeze({ sampleCount: list.length, min: null, median: null, max: null, mean: null });
  const nearest = [];
  for (let i = 0; i < list.length; i += 1) {
    let best = Infinity;
    for (let j = 0; j < list.length; j += 1) {
      if (i === j) continue;
      best = Math.min(best, Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z));
    }
    if (Number.isFinite(best)) nearest.push(best);
  }
  nearest.sort((a, b) => a - b);
  const middle = Math.floor(nearest.length / 2);
  const median = nearest.length % 2 ? nearest[middle] : (nearest[middle - 1] + nearest[middle]) / 2;
  return Object.freeze({ sampleCount: list.length, min: stable(nearest[0]), median: stable(median), max: stable(nearest.at(-1)), mean: stable(nearest.reduce((a, b) => a + b, 0) / nearest.length) });
}

export function boundaryOwnershipStats(items = [], chunkKey = null, policy = undefined) {
  const list = Array.isArray(items) ? items : [];
  let boundaryCount = 0;
  let ownerMismatch = 0;
  for (const item of list) {
    const boundary = boundaryBandFor(item.x, item.z, policy);
    if (!boundary) continue;
    boundaryCount += 1;
    if (chunkKey && boundaryOwnerFor(item.x, item.z, policy) !== chunkKey) ownerMismatch += 1;
  }
  return Object.freeze({ sampleCount: list.length, boundaryCount, ownerMismatch, boundaryRate: stable(boundaryCount / Math.max(1, list.length)), leakRate: stable(ownerMismatch / Math.max(1, boundaryCount)) });
}

export function duplicateStats(items = []) {
  const map = new Map();
  const duplicates = [];
  for (const item of items || []) {
    const id = key(item);
    if (map.has(id)) duplicates.push(Object.freeze({ id, first: map.get(id), duplicate: item }));
    else map.set(id, item);
  }
  return Object.freeze({ sampleCount: (items || []).length, uniqueCount: map.size, duplicateCount: duplicates.length, duplicates: Object.freeze(duplicates) });
}

export function familyShareStats(items = []) {
  const histogram = counts(items);
  const total = Math.max(1, items?.length || 0);
  const shares = Object.fromEntries(Object.entries(histogram).map(([id, count]) => [id, stable(count / total)]));
  const maxShare = Math.max(0, ...Object.values(shares));
  return Object.freeze({ histogram: Object.freeze(histogram), shares: Object.freeze(shares), maxShare: stable(maxShare) });
}

export function spatialBounds(items = []) {
  const list = (items || []).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.z));
  if (!list.length) return null;
  return Object.freeze({ minX: Math.min(...list.map((item) => item.x)), maxX: Math.max(...list.map((item) => item.x)), minZ: Math.min(...list.map((item) => item.z)), maxZ: Math.max(...list.map((item) => item.z)) });
}

export function directionalBias(items = []) {
  const list = (items || []).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.z));
  if (list.length < 3) return Object.freeze({ sampleCount: list.length, bias: 0, axis: 'insufficient' });
  const bounds = spatialBounds(list);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  const ratio = width / depth;
  const bias = Math.abs(Math.log2(ratio));
  return Object.freeze({ sampleCount: list.length, width: stable(width), depth: stable(depth), ratio: stable(ratio), bias: stable(bias), axis: ratio > 1.45 ? 'x' : ratio < .69 ? 'z' : 'balanced' });
}

export function organicDistributionScore(items = []) {
  const count = items?.length || 0;
  const spacing = nearestNeighborStats(items);
  const entropy = familyEntropy(items);
  const share = familyShareStats(items);
  const bias = directionalBias(items);
  const samplePenalty = count < GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.minimumSampleCount ? .2 : 0;
  const spacingScore = spacing.median == null ? .3 : Math.max(0, Math.min(1, spacing.median / 8));
  const entropyScore = entropy;
  const familyScore = Math.max(0, 1 - Math.max(0, share.maxShare - .5) * 2);
  const shapeScore = Math.max(0, 1 - Math.min(1, bias.bias / 3));
  return stable(Math.max(0, spacingScore * .32 + entropyScore * .32 + familyScore * .2 + shapeScore * .16 - samplePenalty));
}

export function qualifyOrganicDistribution(items = []) {
  const sampleCount = items?.length || 0;
  if (sampleCount < GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.minimumSampleCount) {
    return Object.freeze({ ok: true, qualified: false, reason: 'low-sample', sampleCount, score: organicDistributionScore(items) });
  }
  const share = familyShareStats(items);
  const entropy = familyEntropy(items);
  const score = organicDistributionScore(items);
  const ok = share.maxShare <= GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.maxFamilyShare && entropy >= GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.minFamilyEntropy && score >= .46;
  return Object.freeze({ ok, qualified: true, sampleCount, score, maxFamilyShare: share.maxShare, familyEntropy: entropy });
}

export function auditFrame(frame, chunkKey = null, policy = undefined) {
  const ready = frame?.ready || [];
  const deferred = frame?.deferred || [];
  const duplicates = duplicateStats(ready);
  const family = familyShareStats(ready);
  const spacing = nearestNeighborStats(ready);
  const ownership = boundaryOwnershipStats(ready, chunkKey, policy);
  const organic = qualifyOrganicDistribution(ready);
  const errors = [];
  const warnings = [];
  if (duplicates.duplicateCount) errors.push('duplicate-assets');
  if (ownership.leakRate > GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.maxBoundaryLeakRate) errors.push('boundary-owner-leak');
  if (family.maxShare > GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.maxFamilyShare && ready.length >= GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.minimumSampleCount) warnings.push('family-dominance');
  if (spacing.min != null && spacing.min < 1) warnings.push('tight-neighbors');
  return Object.freeze({
    ok: errors.length === 0,
    errors,
    warnings,
    sampleCount: ready.length,
    deferredCount: deferred.length,
    digest: frame?.sourcePlanDigest ?? null,
    family,
    spacing,
    ownership,
    organic,
    lod: buildLodHistogram(ready),
  });
}

export function auditPlan(plan, chunkKey = null, policy = undefined) {
  const synthetic = { ready: plan?.accepted || [], deferred: plan?.rejected || [], sourcePlanDigest: runtimePlanDigest(plan) };
  return auditFrame(synthetic, chunkKey, policy);
}

export function compareAuditScores(left, right) {
  return Object.freeze({
    leftScore: left?.organic?.score ?? 0,
    rightScore: right?.organic?.score ?? 0,
    delta: stable((right?.organic?.score ?? 0) - (left?.organic?.score ?? 0)),
    improved: (right?.organic?.score ?? 0) >= (left?.organic?.score ?? 0),
  });
}

export function auditChunkSet(frames = []) {
  const list = Array.isArray(frames) ? frames : [];
  const audits = list.map((frame) => auditFrame(frame, frame?.plan?.chunkKey || frame?.chunkKey || null));
  const errors = audits.flatMap((audit) => audit.errors);
  return Object.freeze({ ok: errors.length === 0, chunkCount: list.length, errors: Object.freeze(errors), audits: Object.freeze(audits), averageScore: stable(audits.reduce((sum, audit) => sum + audit.organic.score, 0) / Math.max(1, audits.length)) });
}

export function auditPolicyContract() {
  const errors = [];
  if (!GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.id) errors.push('missing-audit-id');
  if (GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.maxFamilyShare <= .5) errors.push('family-share-threshold-too-tight');
  if (GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY.maxBoundaryLeakRate >= .2) errors.push('boundary-threshold-too-loose');
  return Object.freeze({ ok: errors.length === 0, errors, policy: GEOGRAPHIC_ASSET_RUNTIME_AUDIT_POLICY });
}

export function buildAuditDigest(audit) {
  const text = JSON.stringify({ sampleCount: audit?.sampleCount || 0, family: audit?.family?.histogram || {}, score: audit?.organic?.score || 0, ownership: audit?.ownership?.leakRate || 0, lod: audit?.lod || {} });
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function summarizeAudit(audit) {
  return Object.freeze({ ok: Boolean(audit?.ok), sampleCount: audit?.sampleCount || 0, score: audit?.organic?.score || 0, qualified: Boolean(audit?.organic?.qualified), maxFamilyShare: audit?.family?.maxShare || 0, leakRate: audit?.ownership?.leakRate || 0, digest: buildAuditDigest(audit) });
}

export const __TEST__ = Object.freeze({ finite, stable, counts, key });

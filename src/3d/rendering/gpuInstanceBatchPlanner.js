/**
 * Deterministic GPU instance/batch planner.
 *
 * Produces grouped instance batches for repeated scene content without constructing InstancedMesh
 * objects. It can be fed foliage, rocks, props, debris, crowd agents and other renderable records.
 *
 * @module gpuInstanceBatchPlanner
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const INSTANCE_BATCH_TIERS = freeze(['minimal', 'balanced', 'high', 'ultra']);
export const GPU_INSTANCE_BATCH_POLICY = freeze({
  id: 'gpu-instance-batch-planner-2026-09-v1',
  maxInput: 8192,
  maxBatches: 1024,
  maxInstancesPerBatch: 2048,
  maxDistance: 5000,
  minImportance: 0.05,
});

const tierRank = freeze({ minimal: 0, balanced: 1, high: 2, ultra: 3 });
const tierCaps = freeze({ minimal: 256, balanced: 768, high: 1536, ultra: 2048 });

function safeTier(value) { return INSTANCE_BATCH_TIERS.includes(value) ? value : 'balanced'; }
function keyOf(item, lod) { return `${String(item.geometryKey || 'default')}|${String(item.materialKey || 'default')}|${lod}`; }
function importanceOf(item) { return clamp(item.importance, GPU_INSTANCE_BATCH_POLICY.minImportance, 1.5); }

export function createGpuInstanceBatchPlanner(options = {}) {
  const policy = freeze({ ...GPU_INSTANCE_BATCH_POLICY, ...(options.policy || {}) });
  let revision = 0;

  function plan(items = [], context = {}) {
    const tier = safeTier(context.tier);
    const cap = Math.min(policy.maxInstancesPerBatch, tierCaps[tier]);
    const candidates = (Array.isArray(items) ? items : []).slice(0, policy.maxInput).map((item, index) => {
      const id = String(item?.id || `instance-${index}`).slice(0, 96);
      const distance = Math.max(0, finite(item?.distance, policy.maxDistance));
      const visible = item?.visible !== false && item?.frustumVisible !== false && distance <= policy.maxDistance;
      const importance = importanceOf(item);
      const coverage = clamp(item?.screenCoverage);
      const pressure = clamp(context.thermalPressure);
      const score = visible ? clamp((importance * 0.5 + coverage * 0.35 + (1 - distance / policy.maxDistance) * 0.15) * (pressure > 0.8 ? 0.85 : 1)) : 0;
      return freeze({ id, geometryKey: String(item?.geometryKey || 'default').slice(0, 64), materialKey: String(item?.materialKey || 'default').slice(0, 64), lod: String(item?.lod || (score > 0.65 ? 'near' : score > 0.25 ? 'mid' : 'far')).slice(0, 24), distance, importance, score, visible });
    });
    const visible = candidates.filter((item) => item.visible).sort((a, b) => (b.score - a.score) || a.geometryKey.localeCompare(b.geometryKey) || a.materialKey.localeCompare(b.materialKey) || a.id.localeCompare(b.id));
    const grouped = new Map();
    const deferred = [];
    for (const candidate of visible) {
      const key = keyOf(candidate, candidate.lod);
      const group = grouped.get(key) || { key, geometryKey: candidate.geometryKey, materialKey: candidate.materialKey, lod: candidate.lod, instances: [] };
      if (grouped.size >= policy.maxBatches && !grouped.has(key)) { deferred.push(candidate); continue; }
      if (group.instances.length >= cap) { deferred.push(candidate); continue; }
      group.instances.push(candidate);
      grouped.set(key, group);
    }
    const batches = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key)).map((group, batchIndex) => freeze({ batchIndex, key: group.key, geometryKey: group.geometryKey, materialKey: group.materialKey, lod: group.lod, instanceCount: group.instances.length, ids: freeze(group.instances.map((item) => item.id).sort()), averageImportance: Number((group.instances.reduce((sum, item) => sum + item.importance, 0) / Math.max(1, group.instances.length)).toFixed(4)) }));
    revision += 1;
    return freeze({ revision, tier, instanceCap: cap, batches: freeze(batches), deferred: freeze(deferred.slice(0, policy.maxInput)), inputCount: candidates.length, visibleCount: visible.length, deferredCount: deferred.length });
  }

  function compareOrder(first, second, context = {}) {
    const a = plan(first, context);
    const b = plan(second, context);
    const digest = (result) => result.batches.map((batch) => `${batch.key}:${batch.instanceCount}:${batch.ids.join(',')}`).join('|');
    return freeze({ equal: digest(a) === digest(b), first: digest(a), second: digest(b) });
  }

  return freeze({ plan, compareOrder, get revision() { return revision; }, get tierCaps() { return tierCaps; }, get tierRank() { return tierRank; } });
}

export function estimateInstanceUploadBytes(result, bytesPerInstance = 64) {
  const total = (result?.batches || []).reduce((sum, batch) => sum + batch.instanceCount, 0);
  const bytes = total * Math.max(16, finite(bytesPerInstance, 64));
  return Object.freeze({ instances: total, bytes, mb: Number((bytes / (1024 * 1024)).toFixed(3)) });
}

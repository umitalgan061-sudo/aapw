// @ts-nocheck
/**
 * Texture residency/mip planning for memory-bounded rendering.
 *
 * Estimates residency needs from screen coverage, distance, importance, compression and quality tier.
 * It does not allocate or destroy GPU textures. The asset subsystem owns the physical texture cache.
 *
 * @module textureResidencyPlanner
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const TEXTURE_RESIDENCY_TIERS = freeze(['minimal', 'balanced', 'high', 'ultra']);
export const TEXTURE_RESIDENCY_POLICY = freeze({
  id: 'texture-residency-planner-2026-09-v1',
  maxTextures: 4096,
  defaultBudgetMb: 768,
  minResidentMip: 0,
  maxResidentMip: 12,
  maxDeferred: 1024,
});

function tierBias(tier) {
  return tier === 'ultra' ? 0.9 : tier === 'high' ? 0.72 : tier === 'balanced' ? 0.55 : 0.32;
}

function estimateBytes(texture, mip) {
  const width = Math.max(1, Math.floor(finite(texture?.width, 1024)));
  const height = Math.max(1, Math.floor(finite(texture?.height, 1024)));
  const channels = /rg/i.test(String(texture?.format || 'rgba8')) ? 4 : 4;
  const bytesPerChannel = /16f|rgba16/i.test(String(texture?.format || '')) ? 2 : 1;
  const base = width * height * channels * bytesPerChannel;
  const divisor = 4 ** Math.max(0, Math.floor(finite(mip, 0)));
  const compression = texture?.compressed ? 0.5 : 1;
  return Math.max(1024, Math.floor(base / divisor * compression));
}

function mipFor(texture, context) {
  const tier = TEXTURE_RESIDENCY_TIERS.includes(context.tier) ? context.tier : 'balanced';
  const coverage = clamp(texture?.screenCoverage);
  const distance = Math.max(0, finite(texture?.distance, 100));
  const importance = clamp(texture?.importance, 0.05, 1.5);
  const bias = tierBias(tier);
  const visibilityScore = clamp(coverage * 0.65 + (1 - Math.min(1, distance / 300)) * 0.25 + importance * 0.1);
  const requested = Math.round((1 - visibilityScore * bias) * 6);
  return Math.max(0, Math.min(12, requested));
}

export function createTextureResidencyPlanner(options = {}) {
  const policy = freeze({ ...TEXTURE_RESIDENCY_POLICY, ...(options.policy || {}) });
  let revision = 0;

  function plan(textures = [], context = {}) {
    const budgetBytes = Math.max(16 * 1024 * 1024, finite(context.budgetMb, policy.defaultBudgetMb) * 1024 * 1024);
    const candidates = (Array.isArray(textures) ? textures : []).slice(0, policy.maxTextures).map((texture, index) => {
      const id = String(texture?.id || `texture-${index}`).slice(0, 96);
      const mip = Math.max(policy.minResidentMip, Math.min(policy.maxResidentMip, mipFor(texture, context)));
      const bytes = estimateBytes(texture, mip);
      const importance = clamp(texture?.importance, 0.05, 1.5);
      const coverage = clamp(texture?.screenCoverage);
      const distance = Math.max(0, finite(texture?.distance, 100));
      const score = coverage * 0.5 + importance * 0.3 + (1 - Math.min(1, distance / 300)) * 0.2;
      return freeze({ id, mip, bytes, score, importance, coverage, distance, compressed: Boolean(texture?.compressed), persistent: Boolean(texture?.persistent) });
    });
    const ordered = [...candidates].sort((a, b) => (b.score - a.score) || Number(b.persistent) - Number(a.persistent) || a.id.localeCompare(b.id));
    const resident = [];
    const deferred = [];
    let spent = 0;
    for (const candidate of ordered) {
      if (candidate.persistent || spent + candidate.bytes <= budgetBytes) {
        resident.push(candidate);
        spent += candidate.bytes;
      } else {
        deferred.push(candidate);
      }
    }
    revision += 1;
    return freeze({ revision, budgetBytes, budgetMb: Number((budgetBytes / (1024 * 1024)).toFixed(2)), resident: freeze(resident), deferred: freeze(deferred.slice(0, policy.maxDeferred)), spentBytes: spent, spentMb: Number((spent / (1024 * 1024)).toFixed(2)), utilization: Number((spent / budgetBytes).toFixed(4)) });
  }

  return freeze({ plan, get revision() { return revision; } });
}

export function textureResidencyDigest(result) {
  return (result?.resident || []).map((texture) => `${texture.id}:${texture.mip}`).sort().join('|');
}

export function estimateTexturePressure(result) {
  return freeze({ utilization: clamp(result?.utilization), deferredCount: Math.max(0, finite(result?.deferred?.length)), state: result?.utilization > 1 ? 'critical' : result?.utilization >= 0.9 ? 'high' : result?.utilization >= 0.75 ? 'medium' : 'low' });
}

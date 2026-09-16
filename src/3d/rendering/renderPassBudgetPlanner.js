/**
 * GPU/render-pass budget allocator.
 *
 * Converts pass cost descriptors into a deterministic acceptance plan. It is intentionally separate
 * from RenderPipeline itself so quality pressure can be applied before expensive post-processing is
 * materialized.
 *
 * @module renderPassBudgetPlanner
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

export const RENDER_PASS_BUDGET_POLICY = freeze({
  id: 'render-pass-budget-2026-09-v1',
  maxPasses: 32,
  defaultBudgetMs: 8,
  emergencyBudgetMs: 4,
  qualityReserveMs: 0.75,
});

export function createRenderPassBudgetPlanner(options = {}) {
  const policy = freeze({ ...RENDER_PASS_BUDGET_POLICY, ...(options.policy || {}) });
  let revision = 0;

  function plan(passDescriptors = [], context = {}) {
    const budget = Math.max(1, finite(context.budgetMs, policy.defaultBudgetMs));
    const emergency = context.emergency === true ? Math.min(budget, policy.emergencyBudgetMs) : budget;
    const candidates = (Array.isArray(passDescriptors) ? passDescriptors : []).slice(0, policy.maxPasses).map((pass, index) => freeze({
      id: String(pass?.id || `pass-${index}`).slice(0, 96),
      costMs: Math.max(0, finite(pass?.costMs, 0)),
      priority: clamp(pass?.priority, 0, 1),
      optional: pass?.optional !== false,
      backend: pass?.backend === 'webgpu' ? 'webgpu' : 'webgl2',
      qualityFloor: clamp(pass?.qualityFloor, 0, 1),
    }));
    candidates.sort((a, b) => (Number(a.optional) - Number(b.optional)) || (b.priority - a.priority) || (a.costMs - b.costMs) || a.id.localeCompare(b.id));
    const accepted = [];
    const rejected = [];
    let spent = 0;
    for (const pass of candidates) {
      const next = spent + pass.costMs;
      const reserved = accepted.length === 0 ? 0 : policy.qualityReserveMs;
      if (!pass.optional || next + reserved <= emergency) {
        accepted.push(pass);
        spent = next;
      } else {
        rejected.push(pass);
      }
    }
    revision += 1;
    return freeze({ revision, budgetMs: emergency, spentMs: Number(spent.toFixed(3)), utilization: Number((spent / emergency).toFixed(4)), accepted: freeze(accepted), rejected: freeze(rejected) });
  }

  return freeze({ plan, get revision() { return revision; } });
}

export function passBudgetDigest(result) {
  return [
    ...(result?.accepted || []).map((pass) => `A:${pass.id}`),
    ...(result?.rejected || []).map((pass) => `R:${pass.id}`),
  ].sort().join('|');
}

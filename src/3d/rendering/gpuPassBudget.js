/**
 * Explicit GPU pass budget and dynamic-resolution planner.
 *
 * A render frame is a finite resource. This module allocates an estimated GPU budget between base
 * rendering, shadows, water, foliage, post-processing and diagnostics. Consumers receive a declarative
 * plan and can drop or lower optional passes under pressure without touching gameplay state.
 * @module gpuPassBudget
 */

export const GPU_PASS_ORDER = Object.freeze(['base', 'shadow', 'water', 'foliage', 'effects', 'post', 'debug']);
export const GPU_PASS_DEFAULT_WEIGHTS = Object.freeze({ base: 1, shadow: 0.8, water: 0.5, foliage: 0.7, effects: 0.5, post: 0.7, debug: 0.1 });

function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, n(value, low))); }

export function allocateGpuPassBudget(totalMs, weights = GPU_PASS_DEFAULT_WEIGHTS) {
  const total = Math.max(0, n(totalMs));
  const entries = GPU_PASS_ORDER.map((name) => [name, Math.max(0, n(weights[name], 0))]).filter(([, weight]) => weight > 0);
  const denominator = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return Object.freeze(Object.fromEntries(entries.map(([name, weight]) => [name, Number((total * weight / denominator).toFixed(4))])));
}

export function recommendDynamicResolution({ currentScale = 1, measuredGpuMs = 0, targetGpuMs = 11.5, minScale = 0.55, maxScale = 1, maxStep = 0.06 } = {}) {
  const scale = clamp(currentScale, minScale, maxScale);
  const measured = Math.max(0.1, n(measuredGpuMs, targetGpuMs));
  const target = Math.max(0.1, n(targetGpuMs, 11.5));
  const ratio = clamp(target / measured, 0.65, 1.25);
  const ideal = clamp(scale * Math.sqrt(ratio), minScale, maxScale);
  const step = clamp(ideal - scale, -Math.abs(maxStep), Math.abs(maxStep));
  return Object.freeze({ currentScale: Number(scale.toFixed(4)), recommendedScale: Number(clamp(scale + step, minScale, maxScale).toFixed(4)), measuredGpuMs: Number(measured.toFixed(3)), targetGpuMs: Number(target.toFixed(3)), direction: step > 0.001 ? 'up' : step < -0.001 ? 'down' : 'hold' });
}

export function buildGpuPassBudgetPlan({ targetFrameMs = 16.67, estimatedGpuMs = 9, qualityScale = 1, activePasses = GPU_PASS_ORDER, pressure = 0, weights = GPU_PASS_DEFAULT_WEIGHTS } = {}) {
  const pressureFactor = 1 - clamp(pressure, 0, 1) * 0.55;
  const gpuBudget = Math.max(1, n(targetFrameMs, 16.67) * 0.72 * clamp(qualityScale, 0.5, 1.1) * pressureFactor);
  const allocations = allocateGpuPassBudget(gpuBudget, weights);
  const passSet = new Set(activePasses.map(String));
  const enabled = GPU_PASS_ORDER.filter((name) => passSet.has(name) && allocations[name] > 0);
  const overBudget = n(estimatedGpuMs) > gpuBudget;
  const shed = overBudget ? ['debug', 'effects', 'water', 'post'].filter((name) => enabled.includes(name)).reverse() : [];
  let estimatedAfter = n(estimatedGpuMs);
  const reductions = { debug: 0.2, effects: 0.12, water: 0.16, post: 0.2 };
  for (const name of shed) estimatedAfter *= 1 - reductions[name];
  return Object.freeze({ gpuBudgetMs: Number(gpuBudget.toFixed(3)), estimatedGpuMs: Number(n(estimatedGpuMs).toFixed(3)), estimatedAfterSheddingMs: Number(estimatedAfter.toFixed(3)), overBudget, allocations, enabled: Object.freeze(enabled), shed: Object.freeze(shed) });
}

export function createGpuPassBudgetController(options = {}) {
  let frame = 0;
  let disposed = false;
  let last = null;
  const history = [];
  return {
    plan(input = {}) {
      if (disposed) throw new Error('GPU_PASS_BUDGET_CONTROLLER_DISPOSED');
      frame += 1;
      last = Object.freeze({ ...buildGpuPassBudgetPlan({ ...options, ...input }), frame });
      history.push(last);
      while (history.length > 16) history.shift();
      return last;
    },
    snapshot() { return Object.freeze({ frame, last, history: Object.freeze(history.slice(-6)) }); },
    reset() { frame = 0; last = null; history.length = 0; },
    dispose() { disposed = true; last = null; history.length = 0; },
  };
}

export function validateGpuPassBudgetPlan(plan) {
  if (!plan || plan.gpuBudgetMs < 0 || plan.estimatedGpuMs < 0) return false;
  return GPU_PASS_ORDER.includes('base') && Array.isArray(plan.enabled) && new Set(plan.enabled).size === plan.enabled.length;
}

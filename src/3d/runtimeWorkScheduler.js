/**
 * Cooperative scheduler for non-critical runtime work.
 *
 * Work items are pure descriptors with a deterministic priority. Consumers own the actual side
 * effects. A scheduler tick selects a bounded prefix under both an item and millisecond budget.
 * This is designed for terrain decoration, asset hydration, fauna cognition, diagnostics and other
 * tasks that should yield when the render loop is under pressure.
 * @module runtimeWorkScheduler
 */

export const RUNTIME_WORK_PRIORITIES = Object.freeze({
  emergency: 100,
  player: 90,
  streaming: 80,
  gameplay: 70,
  visuals: 55,
  audio: 45,
  background: 30,
  diagnostics: 10,
});

export const RUNTIME_SCHEDULER_DEFAULTS = Object.freeze({
  maxItems: 24,
  maxEstimatedMs: 3,
  agingPerFrame: 0.015,
  starvationFrames: 90,
  historySize: 64,
  minBudgetMs: 0.25,
});

function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, n(value, lo))); }
function key(item) { return String(item?.id ?? `${item?.kind ?? 'work'}:${item?.owner ?? 'unknown'}`); }

function normalizeItem(item, frame, agingPerFrame) {
  const createdFrame = Math.max(0, Math.trunc(n(item.createdFrame, frame)));
  const age = Math.max(0, frame - createdFrame);
  const base = clamp(item.priority ?? RUNTIME_WORK_PRIORITIES.background, 0, 100);
  const ageBonus = Math.min(20, age * agingPerFrame);
  const urgent = item.urgent ? 25 : 0;
  const costPenalty = Math.min(12, Math.max(0, n(item.estimatedMs, 1)) * 0.75);
  return Object.freeze({
    ...item,
    id: key(item),
    createdFrame,
    estimatedMs: Math.max(0.05, n(item.estimatedMs, 1)),
    priorityScore: Number((base + ageBonus + urgent - costPenalty).toFixed(5)),
  });
}

function compare(a, b) {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  if (a.estimatedMs !== b.estimatedMs) return a.estimatedMs - b.estimatedMs;
  return a.id.localeCompare(b.id);
}

export function rankRuntimeWork(items, { frame = 0, agingPerFrame = RUNTIME_SCHEDULER_DEFAULTS.agingPerFrame } = {}) {
  return [...(Array.isArray(items) ? items : [])].map((item) => normalizeItem(item, frame, agingPerFrame)).sort(compare);
}

export function buildRuntimeWorkPlan({ items = [], frame = 0, budgetMs = 3, maxItems = 24, config = RUNTIME_SCHEDULER_DEFAULTS } = {}) {
  const ranked = rankRuntimeWork(items, { frame, agingPerFrame: config.agingPerFrame });
  const selected = [];
  const deferred = [];
  let usedMs = 0;
  for (const item of ranked) {
    const cost = item.estimatedMs;
    const itemLimit = Math.max(1, Math.trunc(maxItems));
    if (selected.length >= itemLimit) { deferred.push(item); continue; }
    if (usedMs + cost > Math.max(config.minBudgetMs, budgetMs)) { deferred.push(item); continue; }
    selected.push(item);
    usedMs += cost;
  }
  return Object.freeze({
    selected: selected.map((item) => Object.freeze({ ...item })),
    deferred: deferred.map((item) => Object.freeze({ ...item })),
    usedMs: Number(usedMs.toFixed(3)),
    budgetMs: Number(Math.max(config.minBudgetMs, budgetMs).toFixed(3)),
    rankedCount: ranked.length,
  });
}

export function createRuntimeWorkScheduler(options = {}) {
  const config = { ...RUNTIME_SCHEDULER_DEFAULTS, ...options };
  const items = new Map();
  const history = [];
  let frame = 0;
  let disposed = false;
  let executed = 0;
  let rejected = 0;

  function enqueue(item) {
    if (disposed) return { accepted: false, reason: 'disposed' };
    const normalized = normalizeItem(item, frame, config.agingPerFrame);
    if (items.size >= config.maxItems * 8 && !items.has(normalized.id)) {
      rejected += 1;
      return { accepted: false, reason: 'queue-cap' };
    }
    items.set(normalized.id, { ...normalized, createdFrame: normalized.createdFrame || frame });
    return { accepted: true, id: normalized.id, queueSize: items.size };
  }

  function cancel(id) {
    return items.delete(String(id));
  }

  function plan(budgetMs = config.maxEstimatedMs) {
    if (disposed) throw new Error('RUNTIME_WORK_SCHEDULER_DISPOSED');
    frame += 1;
    const planResult = buildRuntimeWorkPlan({
      items: [...items.values()],
      frame,
      budgetMs: Math.min(config.maxEstimatedMs, Math.max(config.minBudgetMs, budgetMs)),
      maxItems: config.maxItems,
      config,
    });
    for (const item of planResult.selected) items.delete(item.id);
    if (planResult.selected.length) executed += planResult.selected.length;
    const record = Object.freeze({ ...planResult, frame });
    history.push(record);
    while (history.length > config.historySize) history.shift();
    return record;
  }

  async function run(budgetMs = config.maxEstimatedMs, executor = async () => undefined) {
    const result = plan(budgetMs);
    const completed = [];
    const failed = [];
    for (const item of result.selected) {
      try {
        await executor(item);
        completed.push(item.id);
      } catch (error) {
        failed.push({ id: item.id, message: error?.message ?? String(error) });
      }
    }
    return Object.freeze({ ...result, completed, failed });
  }

  function snapshot() {
    const pending = [...items.values()];
    return Object.freeze({
      frame,
      queueSize: pending.length,
      pendingIds: Object.freeze(pending.sort((a, b) => key(a).localeCompare(key(b))).map((item) => item.id)),
      executed,
      rejected,
      history: Object.freeze(history.slice(-12)),
      config: Object.freeze({ ...config }),
    });
  }

  return {
    enqueue,
    cancel,
    plan,
    run,
    snapshot,
    reset() { items.clear(); history.length = 0; frame = 0; executed = 0; rejected = 0; },
    dispose() { disposed = true; items.clear(); history.length = 0; },
  };
}

export function createWorkItem({ id, kind, owner = 'runtime', priority = RUNTIME_WORK_PRIORITIES.background, estimatedMs = 1, urgent = false, payload = null } = {}) {
  if (!id) throw new TypeError('work item id is required');
  return Object.freeze({
    id: String(id),
    kind: String(kind ?? 'background'),
    owner: String(owner),
    priority: n(priority, RUNTIME_WORK_PRIORITIES.background),
    estimatedMs: Math.max(0.05, n(estimatedMs, 1)),
    urgent: Boolean(urgent),
    payload,
  });
}

export function measureWorkEstimate({ startMs, endMs }) {
  const start = n(startMs, 0);
  const end = n(endMs, start);
  return Number(Math.max(0.01, end - start).toFixed(3));
}

export function createWorkBudgetPartition(totalMs, weights = {}) {
  const safeTotal = Math.max(0, n(totalMs));
  const entries = Object.entries(weights);
  const denominator = entries.reduce((sum, [, weight]) => sum + Math.max(0, n(weight)), 0) || 1;
  return Object.freeze(Object.fromEntries(entries.map(([keyName, weight]) => [keyName, Number((safeTotal * Math.max(0, n(weight)) / denominator).toFixed(3))])));
}

export function validateWorkPlan(plan) {
  if (!plan || !Array.isArray(plan.selected) || !Array.isArray(plan.deferred)) return false;
  const ids = plan.selected.map((item) => item.id);
  return new Set(ids).size === ids.length && plan.usedMs <= plan.budgetMs + 1e-6;
}

export { key as runtimeWorkId };

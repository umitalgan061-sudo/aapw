// @ts-nocheck
/**
 * Deterministic GPU instancing planner.
 *
 * Produces instance batches from lightweight descriptors. It does not construct InstancedMesh objects;
 * the scene/asset owner performs the actual GPU allocation. The planner groups by geometry/material key,
 * culls by visibility and distance, and enforces per-tier instance budgets so vegetation, rocks and other
 * repeated props cannot explode draw or buffer counts after a large camera jump.
 * @module instanceBudgetPlanner
 */

export const INSTANCE_BUDGET_DEFAULTS = Object.freeze({
  maxInstances: 12000,
  maxBatches: 256,
  maxDistanceMeters: 1100,
  cellSizeMeters: 32,
  historySize: 24,
});

export const INSTANCE_TIER_LIMITS = Object.freeze({
  minimal: Object.freeze({ maxInstances: 1400, maxBatches: 64, maxDistanceMeters: 420 }),
  balanced: Object.freeze({ maxInstances: 4200, maxBatches: 110, maxDistanceMeters: 700 }),
  high: Object.freeze({ maxInstances: 8000, maxBatches: 180, maxDistanceMeters: 980 }),
  ultra: Object.freeze({ maxInstances: 14000, maxBatches: 300, maxDistanceMeters: 1400 }),
});

function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, n(value, low))); }
function idOf(item, index) { return String(item?.id ?? `instance-${index}`); }
function batchKey(item) { return String(item?.geometryKey ?? 'default') + '|' + String(item?.materialKey ?? 'default') + '|' + String(item?.lod ?? 0); }
function distanceSq(item, origin) { const dx = n(item.x) - n(origin.x); const dz = n(item.z) - n(origin.z); return dx * dx + dz * dz; }

function normalize(item, index) {
  return {
    ...item,
    id: idOf(item, index),
    x: n(item?.x),
    y: n(item?.y),
    z: n(item?.z),
    radius: Math.max(0, n(item?.radius, 1)),
    importance: clamp(item?.importance, 0, 100),
    visible: item?.visible !== false,
    castShadow: item?.castShadow !== false,
    geometryKey: String(item?.geometryKey ?? 'default'),
    materialKey: String(item?.materialKey ?? 'default'),
    lod: Math.max(0, Math.trunc(n(item?.lod, 0))),
    batchKey: batchKey(item),
  };
}

export function rankInstances(items, origin = { x: 0, z: 0 }) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalize(item, index))
    .filter((item) => item.visible)
    .map((item) => ({ ...item, distanceSq: distanceSq(item, origin) }))
    .sort((a, b) => {
      const importance = b.importance - a.importance;
      if (importance) return importance;
      if (a.distanceSq !== b.distanceSq) return a.distanceSq - b.distanceSq;
      return a.id.localeCompare(b.id);
    });
}

export function planInstanceBatches({
  items = [],
  origin = { x: 0, z: 0 },
  tier = 'balanced',
  maxInstances = null,
  maxBatches = null,
  maxDistanceMeters = null,
} = {}) {
  const limits = INSTANCE_TIER_LIMITS[tier] ?? INSTANCE_TIER_LIMITS.balanced;
  const instanceLimit = Math.max(1, Math.min(INSTANCE_BUDGET_DEFAULTS.maxInstances, Math.trunc(maxInstances ?? limits.maxInstances)));
  const batchLimit = Math.max(1, Math.min(INSTANCE_BUDGET_DEFAULTS.maxBatches, Math.trunc(maxBatches ?? limits.maxBatches)));
  const distanceLimit = Math.max(1, n(maxDistanceMeters ?? limits.maxDistanceMeters));
  const ranked = rankInstances(items, origin);
  const accepted = [];
  const rejected = [];
  const groups = new Map();
  const maxSq = distanceLimit * distanceLimit;
  for (const instance of ranked) {
    if (accepted.length >= instanceLimit || instance.distanceSq > maxSq) { rejected.push(instance); continue; }
    if (!groups.has(instance.batchKey) && groups.size >= batchLimit) { rejected.push(instance); continue; }
    groups.set(instance.batchKey, (groups.get(instance.batchKey) ?? 0) + 1);
    accepted.push(instance);
  }
  const batches = [...groups.entries()].map(([key, count]) => Object.freeze({ key, count }));
  return Object.freeze({
    tier,
    accepted: Object.freeze(accepted.map((item) => Object.freeze({ ...item }))),
    rejected: Object.freeze(rejected.map((item) => Object.freeze({ ...item }))),
    batches: Object.freeze(batches),
    instanceCount: accepted.length,
    batchCount: batches.length,
    rejectedCount: rejected.length,
    coverage: ranked.length ? Number((accepted.length / ranked.length).toFixed(4)) : 1,
  });
}

export function createInstanceBudgetPlanner(options = {}) {
  const config = { ...INSTANCE_BUDGET_DEFAULTS, ...options };
  let frame = 0;
  let disposed = false;
  let lastPlan = null;
  const history = [];
  function plan(input = {}) {
    if (disposed) throw new Error('INSTANCE_BUDGET_PLANNER_DISPOSED');
    frame += 1;
    const next = planInstanceBatches({ ...input, maxInstances: input.maxInstances ?? config.maxInstances, maxBatches: input.maxBatches ?? config.maxBatches, maxDistanceMeters: input.maxDistanceMeters ?? config.maxDistanceMeters });
    lastPlan = Object.freeze({ ...next, frame });
    history.push(lastPlan);
    while (history.length > config.historySize) history.shift();
    return lastPlan;
  }
  return {
    plan,
    snapshot() { return Object.freeze({ frame, lastPlan, history: Object.freeze(history.slice(-8)) }); },
    reset() { frame = 0; lastPlan = null; history.length = 0; },
    dispose() { disposed = true; lastPlan = null; history.length = 0; },
  };
}

export function buildInstanceBufferLayout({ attributes = ['position', 'rotation', 'scale'], maxInstances = 1024 } = {}) {
  const normalized = attributes.map(String).filter(Boolean);
  const strideBytes = normalized.reduce((sum, attribute) => {
    if (attribute === 'position' || attribute === 'scale') return sum + 12;
    if (attribute === 'rotation') return sum + 16;
    if (attribute === 'color' || attribute === 'uvOffset') return sum + 16;
    return sum + 4;
  }, 0);
  return Object.freeze({ attributes: Object.freeze(normalized), strideBytes, maxInstances: Math.max(1, Math.trunc(n(maxInstances, 1024))), estimatedBytes: strideBytes * Math.max(1, Math.trunc(n(maxInstances, 1024))) });
}

export function validateInstancePlan(plan) {
  return Boolean(plan && plan.instanceCount >= 0 && plan.batchCount >= 0 && plan.batchCount <= INSTANCE_BUDGET_DEFAULTS.maxBatches && new Set(plan.accepted.map((item) => item.id)).size === plan.accepted.length);
}

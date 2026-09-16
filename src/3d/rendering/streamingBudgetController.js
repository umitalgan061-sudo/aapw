/**
 * Predictive streaming budget controller for terrain, vegetation, props and living-world assets.
 *
 * The controller produces deterministic admission decisions from camera velocity, distance,
 * importance and current memory/network pressure. It is a policy layer: concrete loaders remain
 * responsible for fetching, decoding, GPU upload and disposal.
 */

const DEFAULTS = Object.freeze({
  frameBudgetMs: 2.5,
  maxConcurrent: 4,
  maxBytesInFlight: 48 * 1024 * 1024,
  memorySoftLimit: 384 * 1024 * 1024,
  memoryHardLimit: 512 * 1024 * 1024,
  lookAheadSeconds: 2.25,
  unloadGraceSeconds: 8,
});
const CATEGORIES = Object.freeze(['terrain', 'vegetation', 'prop', 'character', 'fauna', 'effect']);
const PRIORITY = Object.freeze({ terrain: 90, character: 85, prop: 65, vegetation: 55, fauna: 50, effect: 45 });

function n(value, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, n(value, low))); }
function int(value, fallback = 0) { return Math.round(n(value, fallback)); }
function category(value) { return CATEGORIES.includes(value) ? value : 'prop'; }
function nowMs(clock) { return typeof clock === 'function' ? n(clock()) : Date.now(); }

function normalizeConfig(input = {}) {
  return Object.freeze({
    ...DEFAULTS,
    ...input,
    frameBudgetMs: clamp(input.frameBudgetMs ?? DEFAULTS.frameBudgetMs, 0.5, 10),
    maxConcurrent: clamp(int(input.maxConcurrent, DEFAULTS.maxConcurrent), 1, 32),
    maxBytesInFlight: Math.max(1024 * 1024, n(input.maxBytesInFlight, DEFAULTS.maxBytesInFlight)),
    memorySoftLimit: Math.max(16 * 1024 * 1024, n(input.memorySoftLimit, DEFAULTS.memorySoftLimit)),
    memoryHardLimit: Math.max(DEFAULTS.memorySoftLimit, n(input.memoryHardLimit, DEFAULTS.memoryHardLimit)),
    lookAheadSeconds: clamp(input.lookAheadSeconds ?? DEFAULTS.lookAheadSeconds, 0.25, 8),
    unloadGraceSeconds: clamp(input.unloadGraceSeconds ?? DEFAULTS.unloadGraceSeconds, 1, 60),
  });
}

export function estimateStreamingPriority(item = {}, context = {}) {
  const type = category(item.category);
  const distance = Math.max(0, n(item.distanceMeters, 99999));
  const velocity = Math.max(0, n(context.cameraVelocityMetersPerSecond));
  const importance = clamp(item.importance, 0, 1);
  const visible = item.visible === true ? 1 : 0;
  const predictedDistance = Math.max(0, distance - velocity * Math.max(0.1, n(context.lookAheadSeconds, DEFAULTS.lookAheadSeconds)));
  const distanceScore = 1 / (1 + predictedDistance / 180);
  const categoryScore = (PRIORITY[type] ?? 50) / 100;
  const memoryPenalty = clamp(context.memoryPressure, 0, 1) * 0.5;
  return Number(clamp(categoryScore * 0.32 + distanceScore * 0.34 + importance * 0.24 + visible * 0.1 - memoryPenalty, 0, 1).toFixed(6));
}

export function buildStreamingRequest(item = {}, context = {}) {
  const type = category(item.category);
  const bytes = Math.max(0, n(item.estimatedBytes));
  const priority = estimateStreamingPriority(item, context);
  return Object.freeze({
    id: String(item.id ?? `${type}:${item.assetUrl ?? 'unknown'}`),
    category: type,
    assetUrl: item.assetUrl ?? null,
    estimatedBytes: Math.round(bytes),
    priority,
    distanceMeters: Math.round(Math.max(0, n(item.distanceMeters, 99999)) * 10) / 10,
    importance: Number(clamp(item.importance, 0, 1).toFixed(3)),
    visible: item.visible === true,
    predictedDistanceMeters: Number(Math.max(0, n(item.distanceMeters, 99999) - n(context.cameraVelocityMetersPerSecond) * n(context.lookAheadSeconds, DEFAULTS.lookAheadSeconds)).toFixed(1)),
  });
}

function compareRequests(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (a.estimatedBytes !== b.estimatedBytes) return a.estimatedBytes - b.estimatedBytes;
  return a.id.localeCompare(b.id);
}

export function planStreamingAdmissions(items = [], context = {}, limits = {}) {
  const config = normalizeConfig({ ...context, ...limits });
  const memory = Math.max(0, n(context.residentBytes));
  const pressure = clamp(context.memoryPressure, 0, 1);
  const requests = (Array.isArray(items) ? items : []).map((item) => buildStreamingRequest(item, { ...context, lookAheadSeconds: config.lookAheadSeconds }));
  requests.sort(compareRequests);
  const capacity = Math.max(0, config.memoryHardLimit - memory);
  const concurrency = pressure >= 0.8 ? Math.max(1, Math.floor(config.maxConcurrent / 2)) : config.maxConcurrent;
  let bytes = 0;
  const admitted = [];
  const deferred = [];
  for (const request of requests) {
    const fitsBytes = bytes + request.estimatedBytes <= Math.min(config.maxBytesInFlight, capacity || Number.MAX_SAFE_INTEGER);
    const protectedType = request.category === 'terrain' || request.category === 'character';
    const allowedUnderPressure = pressure < 0.85 || protectedType;
    if (admitted.length < concurrency && fitsBytes && allowedUnderPressure) { admitted.push(request); bytes += request.estimatedBytes; }
    else deferred.push(request);
  }
  return Object.freeze({ requests: Object.freeze(requests), admitted: Object.freeze(admitted), deferred: Object.freeze(deferred), admittedBytes: bytes, concurrency, pressure, residentBytes: memory, capacityBytes: capacity });
}

export function buildUnloadCandidates(residents = [], context = {}, limits = {}) {
  const config = normalizeConfig(limits);
  const currentTime = nowMs(context.now);
  const cameraVelocity = Math.max(0, n(context.cameraVelocityMetersPerSecond));
  const memoryPressure = clamp(context.memoryPressure, 0, 1);
  const rows = (Array.isArray(residents) ? residents : []).map((item) => {
    const distance = Math.max(0, n(item.distanceMeters, 0));
    const lastUsed = n(item.lastUsedMs, currentTime);
    const ageSeconds = Math.max(0, currentTime - lastUsed) / 1000;
    const priority = estimateStreamingPriority({ ...item, distanceMeters: distance }, { ...context, lookAheadSeconds: config.lookAheadSeconds });
    const stale = ageSeconds >= config.unloadGraceSeconds;
    const far = distance > 500 + cameraVelocity * 2;
    const score = clamp((stale ? 0.5 : 0) + (far ? 0.35 : 0) + memoryPressure * 0.35 - priority * 0.5, -1, 1);
    return { id: String(item.id), category: category(item.category), distanceMeters: distance, ageSeconds: Number(ageSeconds.toFixed(2)), score: Number(score.toFixed(6)), estimatedBytes: Math.max(0, n(item.estimatedBytes)), protected: item.protected === true };
  }).filter((row) => !row.protected);
  rows.sort((a, b) => b.score - a.score || b.estimatedBytes - a.estimatedBytes || a.id.localeCompare(b.id));
  return Object.freeze(rows);
}

export function createStreamingBudgetController(options = {}) {
  const config = normalizeConfig(options);
  let disposed = false;
  let sequence = 0;
  let residentBytes = 0;
  const inflight = new Map();
  const listeners = new Set();
  const history = [];

  function emit(event) { for (const listener of listeners) { try { listener(event); } catch {} } }
  function snapshot() { return Object.freeze({ sequence, residentBytes, inflight: inflight.size, inflightIds: Object.freeze([...inflight.keys()]), history: Object.freeze(history.slice(-8)) }); }
  function begin(request) {
    if (disposed) return false;
    const row = buildStreamingRequest(request, options);
    if (inflight.size >= config.maxConcurrent) return false;
    const inflightBytes = [...inflight.values()].reduce((sum, value) => sum + value.estimatedBytes, 0);
    if (inflightBytes + row.estimatedBytes > config.maxBytesInFlight) return false;
    inflight.set(row.id, row); sequence += 1; emit({ type: 'begin', request: row, snapshot: snapshot() }); return true;
  }
  function complete(id, actualBytes = null) {
    const row = inflight.get(String(id));
    if (!row) return false;
    inflight.delete(String(id)); residentBytes += Math.max(0, n(actualBytes, row.estimatedBytes)); sequence += 1;
    history.push({ sequence, type: 'complete', id: row.id, bytes: Math.round(n(actualBytes, row.estimatedBytes)) });
    while (history.length > 32) history.shift(); emit({ type: 'complete', request: row, snapshot: snapshot() }); return true;
  }
  function releaseBytes(bytes) { residentBytes = Math.max(0, residentBytes - Math.max(0, n(bytes))); sequence += 1; return residentBytes; }
  function plan(items, context = {}) { return planStreamingAdmissions(items, { ...options, ...context, residentBytes }); }
  function on(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); }
  function dispose() { disposed = true; inflight.clear(); listeners.clear(); history.length = 0; }
  return Object.freeze({ begin, complete, releaseBytes, plan, on, snapshot, dispose });
}

export function validateStreamingPlan(plan = {}) {
  if (!plan || !Array.isArray(plan.admitted) || !Array.isArray(plan.deferred)) return false;
  const ids = new Set(plan.admitted.map((row) => row.id));
  return ids.size === plan.admitted.length && plan.admittedBytes >= 0 && plan.concurrency >= 1;
}

export const STREAMING_DEFAULTS = DEFAULTS;
export const STREAMING_CATEGORIES = CATEGORIES;

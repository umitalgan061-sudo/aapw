/**
 * Priority scheduler for streamed world work.
 *
 * Separates "what should be streamed" from ChunkManager's existing ownership of terrain creation and
 * disposal. Candidates are scored from distance, visibility, player focus, age, urgency and estimated
 * cost. Ranking is stable and independent of input order. A bounded execution plan prevents a large
 * camera jump from monopolizing a frame.
 * @module worldStreamingGovernor
 */

export const STREAMING_GOVERNOR_DEFAULTS = Object.freeze({
  maxStartsPerFrame: 2,
  maxStopsPerFrame: 2,
  maxEstimatedMsPerFrame: 3.5,
  maxResidentChunks: 196,
  promotionDistanceMeters: 640,
  criticalDistanceMeters: 240,
  staleFrames: 120,
});

const WORK_KINDS = Object.freeze({ START: 'start', STOP: 'stop', REFRESH: 'refresh' });

function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, n(v, lo))); }
function stableText(value) { return String(value ?? '').trim(); }
function keyFor(candidate) { return stableText(candidate.id || `${candidate.x}:${candidate.z}:${candidate.kind}`); }

function scoreCandidate(candidate, config) {
  const distance = Math.max(0, n(candidate.distanceMeters, Infinity));
  const normalizedDistance = clamp(1 - distance / Math.max(1, config.promotionDistanceMeters), 0, 1);
  const critical = distance <= config.criticalDistanceMeters ? 0.35 : 0;
  const visibility = clamp(candidate.visible ? 1 : 0, 0, 1);
  const focus = clamp(candidate.playerFocused ? 1 : 0, 0, 1);
  const age = clamp(n(candidate.ageFrames, 0) / Math.max(1, config.staleFrames), 0, 1);
  const urgency = clamp(candidate.urgent ? 1 : 0, 0, 1);
  const staticPenalty = clamp(n(candidate.alreadyResident ? 1 : 0, 0), 0, 1);
  const workCost = Math.max(0.05, n(candidate.estimatedMs, 1));
  return Number((
    normalizedDistance * 0.34 +
    critical +
    visibility * 0.18 +
    focus * 0.2 +
    age * 0.08 +
    urgency * 0.26 -
    staticPenalty * 0.75 -
    clamp(workCost / 10, 0, 1) * 0.1
  ).toFixed(6));
}

function compare(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.estimatedMs !== b.estimatedMs) return a.estimatedMs - b.estimatedMs;
  return keyFor(a).localeCompare(keyFor(b));
}

export function rankStreamingCandidates(candidates, config = STREAMING_GOVERNOR_DEFAULTS) {
  return [...(Array.isArray(candidates) ? candidates : [])]
    .map((candidate) => ({ ...candidate, id: keyFor(candidate), score: scoreCandidate(candidate, config) }))
    .sort(compare);
}

export function buildStreamingPlan({
  candidates = [],
  residentCount = 0,
  frameBudgetMs = STREAMING_GOVERNOR_DEFAULTS.maxEstimatedMsPerFrame,
  config = STREAMING_GOVERNOR_DEFAULTS,
} = {}) {
  const ranked = rankStreamingCandidates(candidates, config);
  const start = [];
  const stop = [];
  let estimatedMs = 0;
  for (const candidate of ranked) {
    const kind = candidate.kind || WORK_KINDS.START;
    if (kind === WORK_KINDS.STOP) {
      if (stop.length < config.maxStopsPerFrame) stop.push(candidate);
      continue;
    }
    if (kind !== WORK_KINDS.START && kind !== WORK_KINDS.REFRESH) continue;
    if (candidate.alreadyResident && kind === WORK_KINDS.START) continue;
    const maxStarts = residentCount + start.length >= config.maxResidentChunks ? 0 : config.maxStartsPerFrame;
    if (start.length >= maxStarts) continue;
    const cost = Math.max(0.05, candidate.estimatedMs);
    if (estimatedMs + cost > Math.max(0.1, frameBudgetMs)) continue;
    start.push(candidate);
    estimatedMs += cost;
  }
  return Object.freeze({
    start: start.map((item) => Object.freeze({ ...item })),
    stop: stop.map((item) => Object.freeze({ ...item })),
    estimatedMs: Number(estimatedMs.toFixed(3)),
    rankedCount: ranked.length,
    residentCount,
    budgetMs: Number(Math.max(0.1, frameBudgetMs).toFixed(3)),
  });
}

export function createStreamingGovernor(options = {}) {
  const config = { ...STREAMING_GOVERNOR_DEFAULTS, ...options };
  let disposed = false;
  let frame = 0;
  let lastPlan = buildStreamingPlan({ config });
  const history = [];

  function plan(input = {}) {
    if (disposed) throw new Error('STREAMING_GOVERNOR_DISPOSED');
    frame += 1;
    const next = buildStreamingPlan({
      ...input,
      frameBudgetMs: Math.min(config.maxEstimatedMsPerFrame, n(input.frameBudgetMs, config.maxEstimatedMsPerFrame)),
      config,
    });
    lastPlan = Object.freeze({ ...next, frame });
    history.push(lastPlan);
    while (history.length > 32) history.shift();
    return lastPlan;
  }

  return {
    plan,
    snapshot() {
      return Object.freeze({
        frame,
        historyLength: history.length,
        lastPlan,
        config: Object.freeze({ ...config }),
      });
    },
    reset() {
      frame = 0;
      history.length = 0;
      lastPlan = buildStreamingPlan({ config });
    },
    dispose() {
      disposed = true;
      history.length = 0;
    },
  };
}

export { WORK_KINDS };

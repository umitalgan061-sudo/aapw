/**
 * Şafak Kartalı — lightweight runtime performance evidence helpers.
 * Rendering and scheduling remain owned by the engine/runtime; this module only measures evidence.
 */
const freeze = Object.freeze;
const numberValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const PERFORMANCE_EVIDENCE_POLICY = freeze({
  id: 'safak-kartali-performance-evidence-2026-09-14-v2',
  deterministic: true,
  maxSamples: 120,
  maxBudgetMs: 8,
  maxActors: 128,
});

export function percentile(values, percentileValue = 50) {
  const sorted = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const normalized = Math.max(0, Math.min(100, numberValue(percentileValue, 50)));
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(normalized / 100 * sorted.length) - 1));
  return sorted[index];
}

export function summarizeFrameTimes(frameTimes = []) {
  const samples = (Array.isArray(frameTimes) ? frameTimes : []).slice(-PERFORMANCE_EVIDENCE_POLICY.maxSamples);
  return freeze({
    samples: samples.length,
    p50: percentile(samples, 50),
    p90: percentile(samples, 90),
    p95: percentile(samples, 95),
    max: Math.max(0, ...samples.map(Number).filter(Number.isFinite)),
    budgetMs: PERFORMANCE_EVIDENCE_POLICY.maxBudgetMs,
    withinBudget: percentile(samples, 95) <= PERFORMANCE_EVIDENCE_POLICY.maxBudgetMs,
  });
}

export function tickWorkEstimate({ near = 0, distant = 0, far = 0, sensing = 0, spawn = 0, ambient = 0 } = {}) {
  return numberValue(near) * 1
    + numberValue(distant) * .45
    + numberValue(far) * .2
    + numberValue(sensing) * .35
    + numberValue(spawn) * .6
    + numberValue(ambient) * .15;
}

export function budgetVerdict(estimate, budgetMs = PERFORMANCE_EVIDENCE_POLICY.maxBudgetMs) {
  const work = Math.max(0, numberValue(estimate));
  const budget = Math.max(.1, numberValue(budgetMs, PERFORMANCE_EVIDENCE_POLICY.maxBudgetMs));
  return freeze({ estimate: work, budgetMs: budget, ratio: work / budget, ok: work <= budget });
}

export function buildRuntimeEvidence(snapshot = {}, frameTimes = []) {
  const frame = summarizeFrameTimes(frameTimes);
  const population = snapshot?.population ?? {};
  const summary = population?.summary?.counts ?? {};
  const work = tickWorkEstimate({
    near: summary.near,
    distant: summary.distant,
    far: summary.far,
    sensing: Array.isArray(snapshot?.memory) ? snapshot.memory.length : 0,
    spawn: Array.isArray(population.spawn) ? population.spawn.length : 0,
    ambient: Array.isArray(population.ambient) ? population.ambient.length : 0,
  });
  return freeze({
    frame,
    work: budgetVerdict(work),
    actorCount: numberValue(population.actorCount),
    tick: numberValue(snapshot?.tick),
    lod: summary,
    deterministic: Boolean(snapshot?.fingerprints),
    pwaSafe: work <= 12,
  });
}

export function auditRuntimeEvidence(evidence = {}) {
  const errors = [];
  if (evidence?.frame?.withinBudget === false) errors.push('frame-budget');
  if (evidence?.work?.ok === false) errors.push('tick-work-budget');
  if (numberValue(evidence?.actorCount) > PERFORMANCE_EVIDENCE_POLICY.maxActors) errors.push('actor-overflow');
  if (evidence?.deterministic !== true) errors.push('determinism-evidence');
  return freeze({ ok: !errors.length, errors: freeze(errors) });
}

export function buildFrameBudgetEnvelope(snapshot, device = {}) {
  const mobile = Boolean(device.mobile || device.pwa);
  const factor = mobile ? .68 : 1;
  const budget = snapshot?.population?.budget ?? {};
  return freeze({
    nearTicks: Math.max(1, Math.floor(numberValue(budget.nearTicks, 12) * factor)),
    distantTicks: Math.max(1, Math.floor(numberValue(budget.distantTicks, 8) * factor)),
    farTicks: Math.max(1, Math.floor(numberValue(budget.farTicks, 4) * factor)),
    spawn: Math.max(0, Math.floor(numberValue(budget.spawn, 2) * factor)),
    ambient: Math.max(0, Math.floor(numberValue(budget.ambient, 3) * factor)),
    deviceClass: mobile ? 'constrained' : 'desktop',
  });
}

export function deterministicPerformanceFingerprint(value, seed = 0) {
  let hash = 2166136261;
  for (const character of `${seed}|${JSON.stringify(value ?? null)}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function capFrameSamples(samples = []) {
  return freeze((Array.isArray(samples) ? samples : []).slice(-PERFORMANCE_EVIDENCE_POLICY.maxSamples));
}

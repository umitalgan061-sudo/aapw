// @ts-nocheck
/**
 * Şafak Kartalı R2 — bounded deterministic fauna activity scheduling.
 * This layer chooses which existing fauna work may be evaluated this tick.
 * It does not own actors, navigation, physics, persistence, assets, or event dispatch.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const int = (value, fallback = 0) => Math.max(0, Math.floor(finite(value, fallback)));
const text = (value, fallback = '') => String(value ?? fallback).trim() || fallback;

export const FAUNA_ACTIVITY_BUDGET_POLICY = freeze({
  id: 'safak-kartali-fauna-activity-budget-r2-2026-09-16',
  deterministic: true,
  minBudget: 4,
  baseBudget: 24,
  maxBudget: 96,
  maxCandidates: 256,
  maxSelected: 96,
  fairnessWindowTicks: 6,
  staleAfterTicks: 18,
  nearLodBoost: 0.28,
  threatBoost: 0.34,
  resourceBoost: 0.26,
  reproductionBoost: 0.12,
  starvationBoost: 0.18,
  jitterScale: 0.017,
});

export const FAUNA_ACTIVITY_LODS = freeze(['near', 'distant', 'far', 'culled']);
export const FAUNA_ACTIVITY_KINDS = freeze([
  'threat',
  'movement',
  'resource',
  'social',
  'reproduction',
  'migration',
  'rest',
  'ambient',
]);

const lodRank = freeze({ near: 0, distant: 1, far: 2, culled: 3 });
const kindRank = freeze(Object.fromEntries(FAUNA_ACTIVITY_KINDS.map((kind, index) => [kind, index])));
const lodWeight = freeze({ near: 1, distant: 0.72, far: 0.36, culled: 0.05 });
const kindWeight = freeze({ threat: 1, movement: 0.84, resource: 0.78, social: 0.63, reproduction: 0.56, migration: 0.52, rest: 0.4, ambient: 0.22 });

export function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function unit(value) {
  return stableHash(value) / 0x100000000;
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(finite(value) * scale) / scale;
}

function normalizeLod(value) {
  const lod = text(value, 'distant').toLowerCase();
  return lodRank[lod] == null ? 'distant' : lod;
}

function normalizeKind(value) {
  const kind = text(value, 'ambient').toLowerCase();
  return kindRank[kind] == null ? 'ambient' : kind;
}

export function normalizeFaunaActivityCandidate(raw = {}, index = 0) {
  const tick = int(raw.currentTick ?? raw.tick, 0);
  const lastSelectedTick = int(raw.lastSelectedTick, 0);
  const recentWorkTicks = int(raw.recentWorkTicks, 999);
  const starvationTicks = Math.max(0, tick - lastSelectedTick);
  const threat = clamp(raw.threat);
  const resourceNeed = clamp(raw.resourceNeed ?? raw.hunger);
  const reproductionPressure = clamp(raw.reproductionPressure);
  const socialPressure = clamp(raw.socialPressure);
  const movementPressure = clamp(raw.movementPressure);
  const migrationPressure = clamp(raw.migrationPressure);
  const deficit = Math.max(resourceNeed, reproductionPressure, socialPressure, movementPressure, migrationPressure);
  const freshness = recentWorkTicks >= FAUNA_ACTIVITY_BUDGET_POLICY.staleAfterTicks ? 1 : clamp(recentWorkTicks / FAUNA_ACTIVITY_BUDGET_POLICY.staleAfterTicks);
  return freeze({
    id: text(raw.id, `fauna-${index}`),
    species: text(raw.species, 'unknown').toLowerCase(),
    kind: normalizeKind(raw.kind),
    lod: normalizeLod(raw.lod),
    tick,
    lastSelectedTick,
    starvationTicks,
    recentWorkTicks,
    threat,
    resourceNeed,
    reproductionPressure,
    socialPressure,
    movementPressure,
    migrationPressure,
    deficit,
    health: clamp(raw.health, 0, 1),
    energy: clamp(raw.energy, 0, 1),
    distanceMeters: Math.max(0, finite(raw.distanceMeters, 9999)),
    occluded: Boolean(raw.occluded),
    active: raw.active !== false,
    eligible: raw.eligible !== false,
    priority: clamp(raw.priority),
    fairnessEpoch: int(raw.fairnessEpoch, 0),
  });
}

export function normalizeFaunaActivityContext(raw = {}) {
  const requestedBudget = int(raw.budget, FAUNA_ACTIVITY_BUDGET_POLICY.baseBudget);
  return freeze({
    tick: int(raw.tick, 0),
    seed: text(raw.seed, 'fauna-activity'),
    budget: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxBudget, Math.max(FAUNA_ACTIVITY_BUDGET_POLICY.minBudget, requestedBudget)),
    maxSelected: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxSelected, Math.max(1, int(raw.maxSelected, FAUNA_ACTIVITY_BUDGET_POLICY.maxSelected))),
    candidateCap: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxCandidates, Math.max(1, int(raw.candidateCap, FAUNA_ACTIVITY_BUDGET_POLICY.maxCandidates))),
    globalThreat: clamp(raw.globalThreat),
    weatherStress: clamp(raw.weatherStress),
    settlementPressure: clamp(raw.settlementPressure),
    daylight: clamp(raw.daylight ?? 0.65),
  });
}

export function scoreFaunaActivityCandidate(candidate, context) {
  const threatSignal = Math.max(candidate.threat, context.globalThreat);
  const starvation = clamp(candidate.starvationTicks / FAUNA_ACTIVITY_BUDGET_POLICY.fairnessWindowTicks);
  const activity = Math.max(candidate.deficit, candidate.movementPressure, candidate.socialPressure, candidate.migrationPressure);
  const base = kindWeight[candidate.kind] * lodWeight[candidate.lod] * (0.05 + activity * 0.52 + candidate.priority * 0.24);
  const threatBoost = threatSignal * FAUNA_ACTIVITY_BUDGET_POLICY.threatBoost * (candidate.kind === 'threat' ? 1 : 0.34);
  const resourceBoost = candidate.resourceNeed * FAUNA_ACTIVITY_BUDGET_POLICY.resourceBoost * (candidate.kind === 'resource' ? 1 : 0.28);
  const reproductionBoost = candidate.reproductionPressure * FAUNA_ACTIVITY_BUDGET_POLICY.reproductionBoost * (candidate.kind === 'reproduction' ? 1 : 0.35);
  const nearBoost = candidate.lod === 'near' ? FAUNA_ACTIVITY_BUDGET_POLICY.nearLodBoost : 0;
  const starvationBoost = starvation * FAUNA_ACTIVITY_BUDGET_POLICY.starvationBoost;
  const staleBoost = candidate.recentWorkTicks >= FAUNA_ACTIVITY_BUDGET_POLICY.staleAfterTicks ? 0.18 : candidate.recentWorkTicks / FAUNA_ACTIVITY_BUDGET_POLICY.staleAfterTicks * 0.18;
  const weatherBoost = context.weatherStress * (candidate.kind === 'resource' || candidate.kind === 'rest' ? 0.12 : 0.04);
  const healthPenalty = candidate.health < 0.18 ? 0.1 : 0;
  const energyPenalty = candidate.energy < 0.08 && candidate.kind !== 'threat' ? 0.15 : 0;
  const occlusionPenalty = candidate.occluded && candidate.lod !== 'near' ? 0.045 : 0;
  const settlementPenalty = context.settlementPressure * (candidate.kind === 'ambient' ? 0.08 : 0);
  const jitter = (unit(`${context.seed}|${context.tick}|${candidate.id}|${candidate.kind}`) - 0.5) * FAUNA_ACTIVITY_BUDGET_POLICY.jitterScale;
  return round(Math.max(0, base + threatBoost + resourceBoost + reproductionBoost + nearBoost + starvationBoost + staleBoost + weatherBoost - healthPenalty - energyPenalty - occlusionPenalty - settlementPenalty + jitter));
}

export function compareFaunaActivityCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.starvationTicks !== a.starvationTicks) return b.starvationTicks - a.starvationTicks;
  if (lodRank[a.lod] !== lodRank[b.lod]) return lodRank[a.lod] - lodRank[b.lod];
  if (kindRank[a.kind] !== kindRank[b.kind]) return kindRank[a.kind] - kindRank[b.kind];
  if (a.species !== b.species) return a.species.localeCompare(b.species);
  return a.id.localeCompare(b.id);
}

export function deriveFaunaActivityBudget(ranked, context) {
  if (!ranked.length) return FAUNA_ACTIVITY_BUDGET_POLICY.minBudget;
  const threat = ranked.reduce((sum, item) => sum + Math.max(item.threat, context.globalThreat), 0) / ranked.length;
  const deficit = ranked.reduce((sum, item) => sum + item.deficit, 0) / ranked.length;
  const nearRatio = ranked.filter((item) => item.lod === 'near').length / ranked.length;
  const pressure = clamp(threat * 0.45 + deficit * 0.36 + nearRatio * 0.19);
  const proposed = Math.round(context.budget * (0.72 + pressure * 0.42));
  return Math.min(context.maxSelected, Math.max(FAUNA_ACTIVITY_BUDGET_POLICY.minBudget, Math.min(context.budget, proposed)));
}

function reasonFor(candidate) {
  if (candidate.threat >= 0.7) return 'threat';
  if (candidate.resourceNeed >= 0.7) return 'resource-deficit';
  if (candidate.reproductionPressure >= 0.7) return 'reproduction';
  if (candidate.starvationTicks >= FAUNA_ACTIVITY_BUDGET_POLICY.fairnessWindowTicks) return 'fairness';
  if (candidate.lod === 'near') return 'near-lod';
  return 'baseline';
}

export function evaluateFaunaActivityBudget(rawCandidates = [], rawContext = {}) {
  const context = normalizeFaunaActivityContext(rawContext);
  const source = Array.isArray(rawCandidates) ? rawCandidates : [];
  const candidates = source.slice(0, context.candidateCap)
    .map(normalizeFaunaActivityCandidate)
    .filter((candidate) => candidate.active && candidate.eligible)
    .map((candidate) => ({ ...candidate, score: scoreFaunaActivityCandidate(candidate, context) }))
    .sort(compareFaunaActivityCandidates);
  const seenCandidateIds = new Set();
  const uniqueCandidates = candidates.filter((candidate) => {
    if (seenCandidateIds.has(candidate.id)) return false;
    seenCandidateIds.add(candidate.id);
    return true;
  });
  candidates.length = 0;
  candidates.push(...uniqueCandidates);
  const budget = deriveFaunaActivityBudget(candidates, context);
  const selected = candidates.slice(0, budget).map((candidate, index) => freeze({
    id: candidate.id,
    species: candidate.species,
    kind: candidate.kind,
    lod: candidate.lod,
    rank: index,
    score: candidate.score,
    reason: reasonFor(candidate),
    urgency: round(clamp(candidate.score)),
    starvationTicks: candidate.starvationTicks,
    estimatedCost: candidate.lod === 'near' ? 1 : candidate.lod === 'distant' ? 2 : candidate.lod === 'far' ? 3 : 4,
    seedKey: `${context.seed}|${context.tick}|${candidate.id}`,
  }));
  const selectedIds = new Set(selected.map((item) => item.id));
  const deferred = candidates.filter((candidate) => !selectedIds.has(candidate.id)).map((candidate, index) => freeze({
    id: candidate.id,
    species: candidate.species,
    kind: candidate.kind,
    lod: candidate.lod,
    rank: budget + index,
    score: candidate.score,
    reason: reasonFor(candidate),
    urgency: round(clamp(candidate.score)),
    starvationTicks: candidate.starvationTicks,
    estimatedCost: candidate.lod === 'near' ? 1 : candidate.lod === 'distant' ? 2 : candidate.lod === 'far' ? 3 : 4,
    seedKey: `${context.seed}|${context.tick}|${candidate.id}`,
  }));
  const byKind = Object.fromEntries(FAUNA_ACTIVITY_KINDS.map((kind) => [kind, 0]));
  const byLod = Object.fromEntries(FAUNA_ACTIVITY_LODS.map((lod) => [lod, 0]));
  for (const candidate of candidates) {
    byKind[candidate.kind] += 1;
    byLod[candidate.lod] += 1;
  }
  return freeze({
    policyId: FAUNA_ACTIVITY_BUDGET_POLICY.id,
    deterministic: true,
    tick: context.tick,
    seed: context.seed,
    budget,
    selected: freeze(selected),
    deferred: freeze(deferred),
    summary: freeze({
      inputCount: source.length,
      eligibleCount: candidates.length,
      selectedCount: selected.length,
      deferredCount: deferred.length,
      averageThreat: round(candidates.length ? candidates.reduce((sum, item) => sum + item.threat, 0) / candidates.length : 0),
      averageDeficit: round(candidates.length ? candidates.reduce((sum, item) => sum + item.deficit, 0) / candidates.length : 0),
      byKind: freeze(byKind),
      byLod: freeze(byLod),
    }),
  });
}

export function faunaActivityBudgetDigest(result) {
  const selected = Array.isArray(result?.selected) ? result.selected : [];
  const deferred = Array.isArray(result?.deferred) ? result.deferred : [];
  const payload = [result?.policyId ?? '', result?.tick ?? 0, result?.seed ?? '', result?.budget ?? 0,
    ...selected.map((item) => `${item.id}:${item.kind}:${item.lod}:${item.rank}:${item.score}`),
    ...deferred.slice(0, 32).map((item) => `${item.id}:${item.score}`)].join('|');
  return stableHash(payload).toString(16).padStart(8, '0');
}

export function validateFaunaActivityBudget(result) {
  const errors = [];
  if (result?.policyId !== FAUNA_ACTIVITY_BUDGET_POLICY.id) errors.push('policyId');
  if (!Number.isInteger(result?.tick) || result.tick < 0) errors.push('tick');
  if (!Number.isInteger(result?.budget) || result.budget < FAUNA_ACTIVITY_BUDGET_POLICY.minBudget || result.budget > FAUNA_ACTIVITY_BUDGET_POLICY.maxBudget) errors.push('budget');
  if (!Array.isArray(result?.selected) || result.selected.length > result.budget) errors.push('selected');
  if (!Array.isArray(result?.deferred)) errors.push('deferred');
  const ids = new Set();
  for (const item of result?.selected ?? []) {
    if (ids.has(item.id)) errors.push(`duplicate:${item.id}`);
    ids.add(item.id);
    if (!FAUNA_ACTIVITY_KINDS.includes(item.kind)) errors.push(`kind:${item.id}`);
    if (!FAUNA_ACTIVITY_LODS.includes(item.lod)) errors.push(`lod:${item.id}`);
    if (!Number.isInteger(item.rank) || item.rank < 0) errors.push(`rank:${item.id}`);
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors.slice(0, 32)) });
}

export function createFaunaActivityBudgetLedger({ maxHistory = 12 } = {}) {
  const state = { disposed: false, tick: 0, history: [] };
  const limit = Math.min(64, Math.max(1, int(maxHistory, 12)));
  const evaluate = (candidates, context = {}) => {
    if (state.disposed) return freeze({ disposed: true, tick: state.tick, selected: freeze([]), deferred: freeze([]) });
    const next = { ...context, tick: int(context.tick, state.tick) };
    state.tick = next.tick;
    const result = evaluateFaunaActivityBudget(candidates, next);
    state.history.push(result);
    if (state.history.length > limit) state.history.splice(0, state.history.length - limit);
    return result;
  };
  const snapshot = () => freeze({ disposed: state.disposed, tick: state.tick, history: freeze(state.history.slice()) });
  const reset = () => { state.tick = 0; state.history.length = 0; };
  const dispose = () => { state.disposed = true; reset(); };
  return freeze({ evaluate, snapshot, reset, dispose });
}

export function replayFaunaActivityBudget(candidates, contexts = []) {
  return freeze((Array.isArray(contexts) ? contexts : []).map((context) => evaluateFaunaActivityBudget(candidates, context)));
}

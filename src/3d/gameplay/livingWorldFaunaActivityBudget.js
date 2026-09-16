/**
 * Şafak Kartalı — deterministic fauna activity budget policy.
 *
 * Allocates a bounded per-tick work budget across already-normalized fauna observations.
 * The policy is pure, renderer-agnostic, and deterministic. It does not create actors,
 * own navigation/physics, mutate ecology state, load assets, or dispatch events.
 * Existing fauna ecology/encounter directors remain authoritative for intent semantics;
 * this module only decides which eligible work may be evaluated this tick.
 * @module gameplay/livingWorldFaunaActivityBudget
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const positiveInt = (value, fallback = 0) => Math.max(0, Math.floor(finite(value, fallback)));
const idOf = (value, fallback = '') => String(value ?? fallback).trim() || fallback;

export const FAUNA_ACTIVITY_BUDGET_POLICY = freeze({
  id: 'safak-kartali-fauna-activity-budget-r1-2026-09-16',
  deterministic: true,
  baseBudget: 24,
  maxBudget: 96,
  minBudget: 4,
  maxCandidates: 256,
  maxSelected: 96,
  fairnessWindowTicks: 6,
  urgencyFloor: 0.05,
  staleAfterTicks: 18,
  starvationBoost: 0.18,
  threatBoost: 0.34,
  resourceBoost: 0.26,
  breedingBoost: 0.12,
  nearLodBoost: 0.28,
  hiddenLodPenalty: 0.45,
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

const LOD_WEIGHT = freeze({ near: 1, distant: 0.72, far: 0.36, culled: 0.05 });
const KIND_WEIGHT = freeze({ threat: 1, movement: 0.84, resource: 0.78, social: 0.63, reproduction: 0.56, migration: 0.52, rest: 0.4, ambient: 0.22 });
const KIND_INDEX = freeze(Object.fromEntries(FAUNA_ACTIVITY_KINDS.map((kind, index) => [kind, index])));
const LOD_INDEX = freeze(Object.fromEntries(FAUNA_ACTIVITY_LODS.map((lod, index) => [lod, index])));

function stableHash(value) {
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

function unit(seed) { return stableHash(seed) / 0x100000000; }
function round(value, places = 6) { const scale = 10 ** places; return Math.round(finite(value) * scale) / scale; }

function normalizeLod(value) { const lod = String(value ?? 'distant').trim().toLowerCase(); return LOD_INDEX[lod] == null ? 'distant' : lod; }
function normalizeKind(value) { const kind = String(value ?? 'ambient').trim().toLowerCase(); return KIND_INDEX[kind] == null ? 'ambient' : kind; }

function normalizeCandidate(raw, index) {
  const lod = normalizeLod(raw?.lod), kind = normalizeKind(raw?.kind);
  const recentWorkTicks = positiveInt(raw?.recentWorkTicks, 999);
  const lastSelectedTick = positiveInt(raw?.lastSelectedTick, 0);
  const currentTick = positiveInt(raw?.currentTick, 0);
  const starvationTicks = Math.max(0, currentTick - lastSelectedTick);
  const normalizedTick = Math.max(currentTick, positiveInt(raw?.tick, currentTick));
  const threat = clamp(raw?.threat, 0, 1);
  const resourceNeed = clamp(raw?.resourceNeed ?? raw?.hunger, 0, 1);
  const reproduction = clamp(raw?.reproductionPressure, 0, 1);
  const social = clamp(raw?.socialPressure, 0, 1);
  const movement = clamp(raw?.movementPressure, 0, 1);
  const migration = clamp(raw?.migrationPressure, 0, 1);
  const freshness = recentWorkTicks >= FAUNA_ACTIVITY_BUDGET_POLICY.staleAfterTicks ? 1 : clamp(recentWorkTicks / FAUNA_ACTIVITY_BUDGET_POLICY.staleAfterTicks, 0, 1);
  const deficit = Math.max(resourceNeed, reproduction, social, movement, migration);
  return freeze({
    id: idOf(raw?.id, `fauna-${index}`), species: idOf(raw?.species, 'unknown').toLowerCase(), kind, lod, tick: normalizedTick,
    lastSelectedTick, starvationTicks, recentWorkTicks, threat, resourceNeed, reproduction, social, movement, migration,
    health: clamp(raw?.health, 0, 1), energy: clamp(raw?.energy, 0, 1), active: raw?.active !== false, eligible: raw?.eligible !== false,
    occluded: Boolean(raw?.occluded), distanceMeters: Math.max(0, finite(raw?.distanceMeters, 9999)), fairnessEpoch: positiveInt(raw?.fairnessEpoch, 0),
    explicitPriority: clamp(raw?.priority, 0, 1), freshness, deficit,
  });
}

function normalizeBudgetContext(context = {}) {
  const lodCap = positiveInt(context.maxSelected, FAUNA_ACTIVITY_BUDGET_POLICY.maxSelected);
  const budget = positiveInt(context.budget, FAUNA_ACTIVITY_BUDGET_POLICY.baseBudget);
  return freeze({
    tick: positiveInt(context.tick, 0), seed: idOf(context.seed, 'fauna-budget'),
    budget: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxBudget, Math.max(FAUNA_ACTIVITY_BUDGET_POLICY.minBudget, budget)),
    maxSelected: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxSelected, Math.max(1, lodCap)),
    candidateCap: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxCandidates, Math.max(1, positiveInt(context.candidateCap, FAUNA_ACTIVITY_BUDGET_POLICY.maxCandidates))),
    weatherStress: clamp(context.weatherStress, 0, 1), daylight: clamp(context.daylight ?? 0.65, 0, 1),
    settlementPressure: clamp(context.settlementPressure, 0, 1), globalThreat: clamp(context.globalThreat, 0, 1),
  });
}

function scoreCandidate(candidate, context) {
  const lodWeight = LOD_WEIGHT[candidate.lod], kindWeight = KIND_WEIGHT[candidate.kind];
  const starvation = clamp(candidate.starvationTicks / FAUNA_ACTIVITY_BUDGET_POLICY.fairnessWindowTicks, 0, 1);
  const threatSignal = Math.max(candidate.threat, context.globalThreat), priority = candidate.explicitPriority;
  const activity = Math.max(candidate.deficit, candidate.movement, candidate.social);
  const healthPenalty = candidate.health < 0.18 ? 0.1 : 0;
  const energyGate = candidate.energy < 0.08 && candidate.kind !== 'threat' ? 0.15 : 0;
  const weatherBoost = context.weatherStress * (candidate.kind === 'resource' || candidate.kind === 'rest' ? 0.12 : 0.04);
  const staleBoost = candidate.freshness * 0.18;
  const nearBoost = candidate.lod === 'near' ? FAUNA_ACTIVITY_BUDGET_POLICY.nearLodBoost : 0;
  const occlusionPenalty = candidate.occluded && candidate.lod !== 'near' ? FAUNA_ACTIVITY_BUDGET_POLICY.hiddenLodPenalty * 0.1 : 0;
  const starvationBoost = starvation * FAUNA_ACTIVITY_BUDGET_POLICY.starvationBoost;
  const threatBoost = threatSignal * FAUNA_ACTIVITY_BUDGET_POLICY.threatBoost * (candidate.kind === 'threat' ? 1 : 0.34);
  const resourceBoost = candidate.resourceNeed * FAUNA_ACTIVITY_BUDGET_POLICY.resourceBoost * (candidate.kind === 'resource' ? 1 : 0.28);
  const breedingBoost = candidate.reproduction * FAUNA_ACTIVITY_BUDGET_POLICY.breedingBoost * (candidate.kind === 'reproduction' ? 1 : 0.35);
  const jitter = (unit(`${context.seed}|${context.tick}|${candidate.id}|${candidate.kind}`) - 0.5) * FAUNA_ACTIVITY_BUDGET_POLICY.jitterScale;
  const score = kindWeight * lodWeight * (FAUNA_ACTIVITY_BUDGET_POLICY.urgencyFloor + activity * 0.52 + priority * 0.24)
    + starvationBoost + threatBoost + resourceBoost + breedingBoost + staleBoost + nearBoost + weatherBoost
    + threatSignal * context.globalThreat * 0.1 - healthPenalty - energyGate - occlusionPenalty
    - context.settlementPressure * (candidate.kind === 'ambient' ? 0.08 : 0) + jitter;
  return round(Math.max(0, score));
}

function compareRank(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.starvationTicks !== a.starvationTicks) return b.starvationTicks - a.starvationTicks;
  if (LOD_INDEX[a.lod] !== LOD_INDEX[b.lod]) return LOD_INDEX[a.lod] - LOD_INDEX[b.lod];
  if (KIND_INDEX[a.kind] !== KIND_INDEX[b.kind]) return KIND_INDEX[a.kind] - KIND_INDEX[b.kind];
  if (a.species !== b.species) return a.species.localeCompare(b.species);
  return a.id.localeCompare(b.id);
}

function dynamicBudget(candidates, context) {
  const averageThreat = candidates.length ? candidates.reduce((sum, candidate) => sum + Math.max(candidate.threat, context.globalThreat), 0) / candidates.length : 0;
  const averageDeficit = candidates.length ? candidates.reduce((sum, candidate) => sum + candidate.deficit, 0) / candidates.length : 0;
  const nearCount = candidates.reduce((sum, candidate) => sum + (candidate.lod === 'near' ? 1 : 0), 0);
  const pressure = clamp(averageThreat * 0.45 + averageDeficit * 0.36 + nearCount / Math.max(1, candidates.length) * 0.19, 0, 1);
  return Math.min(context.budget, Math.max(FAUNA_ACTIVITY_BUDGET_POLICY.minBudget, Math.round(context.budget * (0.72 + pressure * 0.42))));
}

function allocateSlices(ranked, budget) {
  if (!ranked.length || budget <= 0) return [];
  const selected = [], usedKinds = new Set(), usedSpecies = new Set();
  for (const entry of ranked) {
    if (selected.length >= budget) break;
    const diversifyPenalty = usedSpecies.has(entry.species) ? 0.035 : 0;
    const kindPenalty = usedKinds.has(entry.kind) ? 0.02 : 0;
    entry.adjustedScore = round(Math.max(0, entry.score - diversifyPenalty - kindPenalty));
    if (entry.adjustedScore > 0 || selected.length < Math.min(4, budget)) { selected.push(entry); usedKinds.add(entry.kind); usedSpecies.add(entry.species); }
  }
  return selected;
}

function makeSelection(raw, rank, selected, context) {
  const reason = raw.threat >= 0.7 ? 'threat' : raw.resourceNeed >= 0.7 ? 'resource-deficit' : raw.reproduction >= 0.7 ? 'reproduction' : raw.starvationTicks >= FAUNA_ACTIVITY_BUDGET_POLICY.fairnessWindowTicks ? 'fairness' : raw.lod === 'near' ? 'near-lod' : 'baseline';
  return freeze({
    id: raw.id, species: raw.species, kind: raw.kind, lod: raw.lod, rank, score: raw.score, adjustedScore: raw.adjustedScore, reason,
    reserved: rank < selected, starvationTicks: raw.starvationTicks, recentWorkTicks: raw.recentWorkTicks,
    urgency: round(Math.max(FAUNA_ACTIVITY_BUDGET_POLICY.urgencyFloor, Math.min(1, raw.score))),
    estimatedCost: raw.lod === 'near' ? 1 : raw.lod === 'distant' ? 2 : raw.lod === 'far' ? 3 : 4,
    seedKey: `${context.seed}|${context.tick}|${raw.id}`,
  });
}

function summarize(entries, selected, context, budget) {
  const byKind = Object.fromEntries(FAUNA_ACTIVITY_KINDS.map((kind) => [kind, 0]));
  const byLod = Object.fromEntries(FAUNA_ACTIVITY_LODS.map((lod) => [lod, 0]));
  let threat = 0, deficit = 0, starvation = 0;
  for (const entry of entries) { if (entry.kind in byKind) byKind[entry.kind] += 1; if (entry.lod in byLod) byLod[entry.lod] += 1; threat += entry.threat; deficit += entry.deficit; starvation += entry.starvationTicks; }
  return freeze({ tick: context.tick, inputCount: entries.length, eligibleCount: selected.length, selectedCount: selected.filter((entry) => entry.reserved).length, budget, averageThreat: round(entries.length ? threat / entries.length : 0), averageDeficit: round(entries.length ? deficit / entries.length : 0), averageStarvationTicks: round(entries.length ? starvation / entries.length : 0), byKind: freeze(byKind), byLod: freeze(byLod) });
}

export function evaluateFaunaActivityBudget(rawCandidates = [], context = {}) {
  const normalizedContext = normalizeBudgetContext(context);
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  const capped = candidates.slice(0, normalizedContext.candidateCap).map((candidate, index) => normalizeCandidate(candidate, index)).filter((candidate) => candidate.active && candidate.eligible);
  const scored = capped.map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, normalizedContext) }));
  const ranked = scored.sort(compareRank).map((entry) => ({ ...entry }));
  const budget = dynamicBudget(ranked, normalizedContext);
  const slice = allocateSlices(ranked, Math.min(budget, normalizedContext.maxSelected));
  const selectedIds = new Set(slice.map((entry) => entry.id));
  const selections = ranked.map((entry, index) => makeSelection(entry, index, selectedIds.has(entry.id) ? budget : -1, normalizedContext));
  const committed = selections.filter((entry) => entry.reserved).slice(0, normalizedContext.maxSelected);
  const deferred = selections.filter((entry) => !entry.reserved);
  return freeze({ policyId: FAUNA_ACTIVITY_BUDGET_POLICY.id, deterministic: true, tick: normalizedContext.tick, seed: normalizedContext.seed, budget, selected: freeze(committed), deferred: freeze(deferred), summary: summarize(scored, selections, normalizedContext, budget) });
}

export function createFaunaActivityBudgetLedger({ maxHistory = 12 } = {}) {
  const state = { tick: 0, history: [], disposed: false };
  const limit = Math.min(64, Math.max(1, positiveInt(maxHistory, 12)));
  const evaluate = (candidates, context = {}) => { if (state.disposed) return freeze({ disposed: true, tick: state.tick, selected: freeze([]), deferred: freeze([]) }); const nextContext = { ...context, tick: positiveInt(context.tick, state.tick) }; state.tick = nextContext.tick; const result = evaluateFaunaActivityBudget(candidates, nextContext); state.history.push(result); if (state.history.length > limit) state.history.splice(0, state.history.length - limit); return result; };
  const snapshot = () => freeze({ disposed: state.disposed, tick: state.tick, history: freeze(state.history.map((entry) => freeze({ ...entry }))) });
  const reset = () => { state.tick = 0; state.history.length = 0; };
  const dispose = () => { state.disposed = true; reset(); };
  return freeze({ evaluate, snapshot, reset, dispose });
}

export function replayFaunaActivityBudget(candidates, contexts = []) { const inputs = Array.isArray(contexts) ? contexts : []; return freeze(inputs.map((context) => evaluateFaunaActivityBudget(candidates, context))); }

export function faunaActivityBudgetDigest(result) {
  const selected = Array.isArray(result?.selected) ? result.selected : [], deferred = Array.isArray(result?.deferred) ? result.deferred : [];
  const payload = [result?.policyId ?? '', result?.tick ?? 0, result?.seed ?? '', result?.budget ?? 0, ...selected.map((entry) => `${entry.id}:${entry.kind}:${entry.lod}:${entry.rank}:${entry.score}`), ...deferred.slice(0, 32).map((entry) => `d:${entry.id}:${entry.score}`)].join('|');
  return stableHash(payload).toString(16).padStart(8, '0');
}

export function validateFaunaActivityBudgetResult(result) {
  const errors = [];
  if (result?.policyId !== FAUNA_ACTIVITY_BUDGET_POLICY.id) errors.push('policyId');
  if (!Number.isInteger(result?.tick) || result.tick < 0) errors.push('tick');
  if (!Number.isInteger(result?.budget) || result.budget < FAUNA_ACTIVITY_BUDGET_POLICY.minBudget || result.budget > FAUNA_ACTIVITY_BUDGET_POLICY.maxBudget) errors.push('budget');
  if (!Array.isArray(result?.selected)) errors.push('selected-array');
  if (!Array.isArray(result?.deferred)) errors.push('deferred-array');
  const selected = Array.isArray(result?.selected) ? result.selected : [], ids = new Set();
  for (const entry of selected) { if (ids.has(entry.id)) errors.push(`duplicate:${entry.id}`); ids.add(entry.id); if (!FAUNA_ACTIVITY_KINDS.includes(entry.kind)) errors.push(`kind:${entry.id}`); if (!FAUNA_ACTIVITY_LODS.includes(entry.lod)) errors.push(`lod:${entry.id}`); if (!Number.isFinite(entry.score) || entry.score < 0) errors.push(`score:${entry.id}`); if (!Number.isInteger(entry.rank) || entry.rank < 0) errors.push(`rank:${entry.id}`); }
  return freeze({ valid: errors.length === 0, errors: freeze(errors.slice(0, 32)) });
}

export { stableHash, normalizeCandidate, scoreCandidate, compareRank };

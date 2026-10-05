/**
 * Strict deterministic fauna activity budget.
 * This is the production TypeScript owner; the legacy .js file remains rollback-only.
 */

export const FAUNA_ACTIVITY_BUDGET_POLICY = Object.freeze({
  id: 'safak-kartali-fauna-activity-budget-r3-2026-10-05',
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
} as const);

export const FAUNA_ACTIVITY_LODS = ['near','distant','far','culled'] as const;
export const FAUNA_ACTIVITY_KINDS = ['threat','movement','resource','social','reproduction','migration','rest','ambient'] as const;

export type FaunaActivityLod = typeof FAUNA_ACTIVITY_LODS[number];
export type FaunaActivityKind = typeof FAUNA_ACTIVITY_KINDS[number];

export interface FaunaActivityCandidateInput {
  readonly id?: unknown;
  readonly species?: unknown;
  readonly kind?: unknown;
  readonly lod?: unknown;
  readonly currentTick?: unknown;
  readonly tick?: unknown;
  readonly lastSelectedTick?: unknown;
  readonly recentWorkTicks?: unknown;
  readonly threat?: unknown;
  readonly resourceNeed?: unknown;
  readonly hunger?: unknown;
  readonly reproductionPressure?: unknown;
  readonly socialPressure?: unknown;
  readonly movementPressure?: unknown;
  readonly migrationPressure?: unknown;
  readonly health?: unknown;
  readonly energy?: unknown;
  readonly distanceMeters?: unknown;
  readonly occluded?: unknown;
  readonly active?: unknown;
  readonly eligible?: unknown;
  readonly priority?: unknown;
  readonly fairnessEpoch?: unknown;
}

export interface FaunaActivityCandidate {
  readonly id: string;
  readonly species: string;
  readonly kind: FaunaActivityKind;
  readonly lod: FaunaActivityLod;
  readonly tick: number;
  readonly lastSelectedTick: number;
  readonly starvationTicks: number;
  readonly recentWorkTicks: number;
  readonly threat: number;
  readonly resourceNeed: number;
  readonly reproductionPressure: number;
  readonly socialPressure: number;
  readonly movementPressure: number;
  readonly migrationPressure: number;
  readonly deficit: number;
  readonly health: number;
  readonly energy: number;
  readonly distanceMeters: number;
  readonly occluded: boolean;
  readonly active: boolean;
  readonly eligible: boolean;
  readonly priority: number;
  readonly fairnessEpoch: number;
}

export interface FaunaActivityContext {
  readonly tick: number;
  readonly seed: string;
  readonly budget: number;
  readonly maxSelected: number;
  readonly candidateCap: number;
  readonly globalThreat: number;
  readonly weatherStress: number;
  readonly settlementPressure: number;
  readonly daylight: number;
}

export interface FaunaActivitySelection {
  readonly id: string;
  readonly species: string;
  readonly kind: FaunaActivityKind;
  readonly lod: FaunaActivityLod;
  readonly rank: number;
  readonly score: number;
  readonly reason: string;
  readonly urgency: number;
  readonly starvationTicks: number;
  readonly estimatedCost: number;
  readonly seedKey: string;
}

export interface FaunaActivityBudgetResult {
  readonly policyId: string;
  readonly deterministic: true;
  readonly tick: number;
  readonly seed: string;
  readonly budget: number;
  readonly selected: readonly FaunaActivitySelection[];
  readonly deferred: readonly FaunaActivitySelection[];
  readonly summary: Readonly<Record<string, unknown>>;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const integer = (value: unknown, fallback = 0): number => Math.max(0, Math.floor(finite(value, fallback)));
const clamp = (value: unknown, min = 0, max = 1): number => Math.max(min, Math.min(max, finite(value, min)));
const text = (value: unknown, fallback = ''): string => String(value ?? fallback).trim() || fallback;

export function stableHash(value: unknown): number {
  let hash = 2166136261;
  for (const character of String(value ?? '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function unit(value: unknown): number { return stableHash(value) / 0x100000000; }

function normalizeLod(value: unknown): FaunaActivityLod {
  const lod = text(value, 'distant').toLowerCase() as FaunaActivityLod;
  return (FAUNA_ACTIVITY_LODS as readonly string[]).includes(lod) ? lod : 'distant';
}

function normalizeKind(value: unknown): FaunaActivityKind {
  const kind = text(value, 'ambient').toLowerCase() as FaunaActivityKind;
  return (FAUNA_ACTIVITY_KINDS as readonly string[]).includes(kind) ? kind : 'ambient';
}

export function normalizeFaunaActivityCandidate(raw: FaunaActivityCandidateInput = {}, index = 0): FaunaActivityCandidate {
  const tick = integer(raw.currentTick ?? raw.tick);
  const lastSelectedTick = integer(raw.lastSelectedTick);
  const recentWorkTicks = integer(raw.recentWorkTicks, 999);
  const starvationTicks = Math.max(0, tick - lastSelectedTick);
  const threat = clamp(raw.threat);
  const resourceNeed = clamp(raw.resourceNeed ?? raw.hunger);
  const reproductionPressure = clamp(raw.reproductionPressure);
  const socialPressure = clamp(raw.socialPressure);
  const movementPressure = clamp(raw.movementPressure);
  const migrationPressure = clamp(raw.migrationPressure);
  const deficit = Math.max(resourceNeed, reproductionPressure, socialPressure, movementPressure, migrationPressure);
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
    occluded: raw.occluded === true,
    active: raw.active !== false,
    eligible: raw.eligible !== false,
    priority: clamp(raw.priority),
    fairnessEpoch: integer(raw.fairnessEpoch),
  });
}

export function normalizeFaunaActivityContext(raw: Readonly<Record<string, unknown>> = {}): FaunaActivityContext {
  const requestedBudget = integer(raw.budget, FAUNA_ACTIVITY_BUDGET_POLICY.baseBudget);
  return freeze({
    tick: integer(raw.tick),
    seed: text(raw.seed, 'fauna-activity'),
    budget: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxBudget, Math.max(FAUNA_ACTIVITY_BUDGET_POLICY.minBudget, requestedBudget)),
    maxSelected: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxSelected, Math.max(1, integer(raw.maxSelected, FAUNA_ACTIVITY_BUDGET_POLICY.maxSelected))),
    candidateCap: Math.min(FAUNA_ACTIVITY_BUDGET_POLICY.maxCandidates, Math.max(1, integer(raw.candidateCap, FAUNA_ACTIVITY_BUDGET_POLICY.maxCandidates))),
    globalThreat: clamp(raw.globalThreat),
    weatherStress: clamp(raw.weatherStress),
    settlementPressure: clamp(raw.settlementPressure),
    daylight: clamp(raw.daylight ?? 0.65),
  });
}

export function scoreFaunaActivityCandidate(candidate: FaunaActivityCandidate, context: FaunaActivityContext): number {
  const kindWeight: Record<FaunaActivityKind, number> = { threat:1, movement:0.84, resource:0.78, social:0.63, reproduction:0.56, migration:0.52, rest:0.4, ambient:0.22 };
  const lodWeight: Record<FaunaActivityLod, number> = { near:1, distant:0.72, far:0.36, culled:0.05 };
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
  return Math.max(0, Number((base + threatBoost + resourceBoost + reproductionBoost + nearBoost + starvationBoost + staleBoost + weatherBoost - healthPenalty - energyPenalty - occlusionPenalty - settlementPenalty + jitter).toFixed(6)));
}

export function compareFaunaActivityCandidates(a: FaunaActivityCandidate & { readonly score?: number }, b: FaunaActivityCandidate & { readonly score?: number }): number {
  const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  if (b.starvationTicks !== a.starvationTicks) return b.starvationTicks - a.starvationTicks;
  if (a.lod !== b.lod) return String(a.lod).localeCompare(String(b.lod));
  if (a.kind !== b.kind) return String(a.kind).localeCompare(String(b.kind));
  return a.id.localeCompare(b.id);
}

export function evaluateFaunaActivityBudget(
  rawCandidates: readonly FaunaActivityCandidateInput[] = [],
  rawContext: Readonly<Record<string, unknown>> = {},
): FaunaActivityBudgetResult {
  const context = normalizeFaunaActivityContext(rawContext);
  const source = rawCandidates.slice(0, context.candidateCap);
  const candidates = source
    .map(normalizeFaunaActivityCandidate)
    .filter((candidate) => candidate.active && candidate.eligible)
    .map((candidate) => ({ ...candidate, score: scoreFaunaActivityCandidate(candidate, context) }))
    .sort(compareFaunaActivityCandidates);
  const budget = Math.min(context.budget, Math.max(FAUNA_ACTIVITY_BUDGET_POLICY.minBudget, context.maxSelected));
  const selected = candidates.slice(0, budget).map((candidate, index) => freeze({
    id: candidate.id,
    species: candidate.species,
    kind: candidate.kind,
    lod: candidate.lod,
    rank: index,
    score: candidate.score,
    reason: candidate.threat >= 0.7 ? 'threat' : candidate.resourceNeed >= 0.7 ? 'resource-deficit' : candidate.starvationTicks >= FAUNA_ACTIVITY_BUDGET_POLICY.fairnessWindowTicks ? 'fairness' : candidate.lod === 'near' ? 'near-lod' : 'baseline',
    urgency: Math.min(1, candidate.score),
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
    rank: selected.length + index,
    score: candidate.score,
    reason: candidate.threat >= 0.7 ? 'threat' : candidate.resourceNeed >= 0.7 ? 'resource-deficit' : 'deferred-budget',
    urgency: Math.min(1, candidate.score),
    starvationTicks: candidate.starvationTicks,
    estimatedCost: candidate.lod === 'near' ? 1 : candidate.lod === 'distant' ? 2 : candidate.lod === 'far' ? 3 : 4,
    seedKey: `${context.seed}|${context.tick}|${candidate.id}`,
  }));
  return freeze({
    policyId: FAUNA_ACTIVITY_BUDGET_POLICY.id,
    deterministic: true,
    tick: context.tick,
    seed: context.seed,
    budget,
    selected: freeze(selected),
    deferred: freeze(deferred),
    summary: freeze({
      inputCount: rawCandidates.length,
      eligibleCount: candidates.length,
      selectedCount: selected.length,
      deferredCount: deferred.length,
      averageThreat: candidates.length ? Number((candidates.reduce((sum, item) => sum + item.threat, 0) / candidates.length).toFixed(6)) : 0,
    }),
  });
}

export function validateFaunaActivityBudget(result: FaunaActivityBudgetResult): Readonly<{ valid: boolean; errors: readonly string[] }> {
  const errors: string[] = [];
  if (result.policyId !== FAUNA_ACTIVITY_BUDGET_POLICY.id) errors.push('policyId');
  if (result.deterministic !== true) errors.push('determinism');
  if (!Number.isInteger(result.tick) || result.tick < 0) errors.push('tick');
  if (!Array.isArray(result.selected) || result.selected.length > result.budget) errors.push('selected');
  const ids = new Set<string>();
  for (const item of result.selected) {
    if (ids.has(item.id)) errors.push(`duplicate:${item.id}`);
    ids.add(item.id);
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors.slice(0, 32)) });
}

export function faunaActivityBudgetDigest(result: FaunaActivityBudgetResult): string {
  return stableHash(JSON.stringify({
    policyId: result.policyId,
    tick: result.tick,
    seed: result.seed,
    budget: result.budget,
    selected: result.selected,
    deferred: result.deferred.slice(0, 32),
  })).toString(16).padStart(8, '0');
}

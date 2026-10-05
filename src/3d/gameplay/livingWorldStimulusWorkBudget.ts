/**
 * Strict deterministic scheduler for living-world stimulus work.
 * No renderer, clock, random source, DOM or global mutable state is consulted.
 */

export const LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY = Object.freeze({
  id: 'living-world-stimulus-work-budget-2026-10-r11',
  maxActorsPerTick: 128,
  defaultBucketCount: 8,
  maxBucketCount: 32,
  maxUrgentActors: 16,
  starvationTicks: 24,
  maxIdLength: 96,
} as const);

export interface StimulusActorInput {
  readonly id?: unknown;
  readonly urgency?: unknown;
  readonly ageTicks?: unknown;
  readonly active?: unknown;
}

export interface StimulusActor {
  readonly id: string;
  readonly bucket: number;
  readonly urgency: number;
  readonly ageTicks: number;
  readonly priority: number;
}

export interface StimulusBucket {
  readonly bucket: number;
  readonly actors: readonly StimulusActor[];
  readonly count: number;
}

export interface StimulusSelection {
  readonly tick: number;
  readonly budget: number;
  readonly selected: readonly StimulusActor[];
  readonly buckets: readonly StimulusBucket[];
}

export interface StimulusStarvationSnapshot {
  readonly tick: number;
  readonly starving: readonly Readonly<{ id: string; ticks: number }>[];
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const integer = (value: unknown, fallback = 0): number => Math.max(0, Math.floor(finite(value, fallback)));
const clamp01 = (value: unknown): number => Math.max(0, Math.min(1, finite(value)));

export function stableHash(value: unknown): number {
  let hash = 2166136261;
  const source = String(value ?? '');
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function assignStimulusWorkBucket(
  actorId: string,
  bucketCount = LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.defaultBucketCount,
): number {
  const count = Math.min(
    LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxBucketCount,
    Math.max(1, integer(bucketCount, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.defaultBucketCount)),
  );
  return stableHash(actorId) % count;
}

export function normalizeStimulusActor(raw: StimulusActorInput, index = 0): StimulusActor {
  const id = String(raw.id ?? `actor-${index}`).trim().slice(0, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxIdLength) || `actor-${index}`;
  const urgency = clamp01(raw.urgency);
  const ageTicks = integer(raw.ageTicks);
  const ageBoost = Math.min(1, ageTicks / LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.starvationTicks);
  return freeze({
    id,
    bucket: assignStimulusWorkBucket(id),
    urgency,
    ageTicks,
    priority: urgency * 0.72 + ageBoost * 0.28,
  });
}

export function planStimulusWork(
  actors: readonly StimulusActorInput[] = [],
  bucketCount = LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.defaultBucketCount,
): readonly StimulusBucket[] {
  const count = Math.min(
    LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxBucketCount,
    Math.max(1, integer(bucketCount, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.defaultBucketCount)),
  );
  const groups: StimulusActor[][] = Array.from({ length: count }, () => []);
  for (const [index, raw] of actors.slice(0, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxActorsPerTick).entries()) {
    const actor = normalizeStimulusActor(raw, index);
    if (raw.active === false) continue;
    groups[actor.bucket].push(actor);
  }
  for (const group of groups) {
    group.sort((a, b) => b.priority - a.priority || b.ageTicks - a.ageTicks || a.id.localeCompare(b.id));
  }
  return freeze(groups.map((group, bucket) => freeze({ bucket, actors: freeze(group), count: group.length })));
}

export function selectStimulusWork(
  actors: readonly StimulusActorInput[] = [],
  budget = LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxActorsPerTick,
  tick = 0,
  bucketCount = LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.defaultBucketCount,
): StimulusSelection {
  const buckets = planStimulusWork(actors, bucketCount);
  const max = Math.max(0, Math.min(
    LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxActorsPerTick,
    integer(budget, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxActorsPerTick),
  ));
  const selected: StimulusActor[] = [];
  const seen = new Set<string>();
  const rounds = Math.max(1, buckets.length);

  for (let round = 0; selected.length < max && round < rounds + LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.starvationTicks; round += 1) {
    for (const bucket of buckets) {
      if (selected.length >= max) break;
      if (bucket.count === 0) continue;
      const index = round % bucket.count;
      const actor = bucket.actors[index];
      if (!actor || seen.has(actor.id)) continue;
      seen.add(actor.id);
      selected.push(actor);
    }
  }

  const urgent = selected.filter((actor) => actor.urgency >= 0.8).slice(0, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxUrgentActors);
  const ordered = [...urgent, ...selected.filter((actor) => actor.urgency < 0.8 && !urgent.some((item) => item.id === actor.id))];

  return freeze({
    tick: integer(tick),
    budget: max,
    selected: freeze(ordered.slice(0, max)),
    buckets,
  });
}

export function createLivingWorldStimulusWorkBudget(options: {
  readonly bucketCount?: number;
  readonly budget?: number;
  readonly starvationTicks?: number;
} = {}) {
  let tick = 0;
  let disposed = false;
  const debt = new Map<string, number>();
  const bucketCount = Math.min(
    LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxBucketCount,
    Math.max(1, integer(options.bucketCount, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.defaultBucketCount)),
  );
  const budget = Math.min(
    LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxActorsPerTick,
    Math.max(1, integer(options.budget, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxActorsPerTick)),
  );
  const starvationTicks = Math.max(
    1,
    integer(options.starvationTicks, LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.starvationTicks),
  );

  const select = (actors: readonly StimulusActorInput[] = [], requestedBudget = budget): StimulusSelection => {
    if (disposed) return freeze({ tick, budget: 0, selected: freeze([]), buckets: freeze([]) });
    tick += 1;
    const selection = selectStimulusWork(actors, Math.min(requestedBudget, budget), tick, bucketCount);
    const selectedIds = new Set(selection.selected.map((actor) => actor.id));
    for (const raw of actors) {
      const id = String(raw.id ?? '').trim();
      if (!id) continue;
      debt.set(id, (debt.get(id) ?? 0) + (selectedIds.has(id) ? -Math.min(1, debt.get(id) ?? 0) : 1));
    }
    return selection;
  };

  const starvationSnapshot = (): StimulusStarvationSnapshot => {
    const starving = [...debt.entries()]
      .filter(([, value]) => value >= starvationTicks)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, ticks]) => freeze({ id, ticks }));
    return freeze({ tick, starving: freeze(starving) });
  };

  const reset = (): void => { tick = 0; debt.clear(); };
  const dispose = (): void => { disposed = true; reset(); };

  return freeze({
    select,
    starvationSnapshot,
    reset,
    dispose,
    get tick(): number { return tick; },
    get bucketCount(): number { return bucketCount; },
    get budget(): number { return budget; },
  });
}

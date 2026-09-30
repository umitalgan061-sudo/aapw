/**
 * Deterministic work budget for living-world stimulus processing.
 *
 * Keeps large worlds responsive by distributing actor evaluation across stable buckets. The caller
 * supplies actor ids and the tick; no wall clock, random source or renderer state is consulted.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, fallback = 0) => Math.max(0, Math.floor(finite(value, fallback)));

export const LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY = freeze({
  id: 'living-world-stimulus-work-budget-2026-09-v1',
  maxActorsPerTick: 64,
  defaultBucketCount: 4,
  maxBucketCount: 16,
  maxUrgentActors: 8,
  starvationTicks: 30,
});

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function assignStimulusWorkBucket(actorId, bucketCount = LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.defaultBucketCount) {
  const count = Math.min(LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY.maxBucketCount, Math.max(1, integer(bucketCount, 4)));
  return stableHash(actorId) % count;
}

export function createLivingWorldStimulusWorkBudget(options = {}) {
  const policy = freeze({ ...LIVING_WORLD_STIMULUS_WORK_BUDGET_POLICY, ...(options.policy || {}) });
  const bucketCount = Math.min(policy.maxBucketCount, Math.max(1, integer(options.bucketCount, policy.defaultBucketCount)));
  const debt = new Map();
  let tick = 0;

  function plan(actors = [], context = {}) {
    const safe = (Array.isArray(actors) ? actors : []).slice(0, policy.maxActorsPerTick).map((actor, index) => {
      const id = String(actor?.id || `actor-${index}`).slice(0, 96);
      const urgency = Math.max(0, Math.min(1, finite(actor?.urgency ?? context.urgency, 0)));
      const age = integer(actor?.ageTicks, 0);
      const bucket = assignStimulusWorkBucket(id, bucketCount);
      const ageBoost = Math.min(1, age / Math.max(1, policy.starvationTicks));
      const priority = urgency * 0.7 + ageBoost * 0.3;
      return freeze({ id, bucket, urgency, ageTicks: age, priority });
    });
    const groups = Array.from({ length: bucketCount }, () => []);
    for (const actor of safe) groups[actor.bucket].push(actor);
    for (const group of groups) group.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
    return freeze(groups.map((group, bucket) => freeze({ bucket, actors: freeze(group), count: group.length })));
  }

  function select(actors = [], budget = policy.maxActorsPerTick, context = {}) {
    const groups = plan(actors, context);
    const selected = [];
    const max = Math.max(0, integer(budget, policy.maxActorsPerTick));
    for (let round = 0; selected.length < max && round < groups.length + policy.starvationTicks; round += 1) {
      for (const group of groups) {
        if (selected.length >= max) break;
        const index = (round % Math.max(1, group.actors.length));
        const actor = group.actors[index];
        if (!actor) continue;
        if (selected.some((value) => value.id === actor.id)) continue;
        selected.push(actor);
      }
    }
    const urgent = selected.filter((actor) => actor.urgency >= 0.8).slice(0, policy.maxUrgentActors);
    const ordered = [...urgent, ...selected.filter((actor) => actor.urgency < 0.8 && !urgent.some((value) => value.id === actor.id))];
    for (const actor of actors) debt.set(actor.id, (debt.get(actor.id) || 0) + (ordered.some((value) => value.id === actor.id) ? 0 : 1));
    tick += 1;
    return freeze({ tick, budget: max, selected: freeze(ordered.slice(0, max)), buckets: groups });
  }

  function starvationSnapshot() {
    const starving = [...debt.entries()].filter(([, value]) => value >= policy.starvationTicks).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    return freeze({ tick, starving: freeze(starving.map(([id, ticks]) => freeze({ id, ticks }))) });
  }

  function reset() { debt.clear(); tick = 0; }

  return freeze({ plan, select, starvationSnapshot, reset, get tick() { return tick; }, get bucketCount() { return bucketCount; } });
}

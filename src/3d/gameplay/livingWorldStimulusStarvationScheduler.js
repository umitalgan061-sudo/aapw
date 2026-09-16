/**
 * Starvation-aware scheduling policy for repeated living-world decisions.
 *
 * It keeps semantic work distribution fair across actor groups while promoting urgent and long-stale
 * actors. Scheduling remains deterministic and does not execute any domain action.
 */

import { assignStimulusWorkBucket } from './livingWorldStimulusWorkBudget.js';

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const LIVING_WORLD_STIMULUS_STARVATION_POLICY = freeze({
  id: 'living-world-stimulus-starvation-2026-09-v1',
  maxActors: 256,
  maxPerTick: 32,
  maxStarvationTicks: 60,
  urgencyWeight: 0.55,
  starvationWeight: 0.3,
  freshnessWeight: 0.15,
});

export function createLivingWorldStimulusStarvationScheduler(options = {}) {
  const policy = freeze({ ...LIVING_WORLD_STIMULUS_STARVATION_POLICY, ...(options.policy || {}) });
  const age = new Map();
  let tick = 0;

  function score(actor) {
    const id = String(actor?.id || 'unknown');
    const urgency = clamp(actor?.urgency);
    const staleTicks = Math.min(policy.maxStarvationTicks, Math.max(0, finite(age.get(id), actor?.ageTicks || 0)));
    const starvation = staleTicks / Math.max(1, policy.maxStarvationTicks);
    const freshness = clamp(1 - finite(actor?.cooldownRatio, 0));
    return urgency * policy.urgencyWeight + starvation * policy.starvationWeight + freshness * policy.freshnessWeight;
  }

  function select(actors = [], count = policy.maxPerTick, bucketCount = 8) {
    const safe = (Array.isArray(actors) ? actors : []).slice(0, policy.maxActors).map((actor, index) => {
      const id = String(actor?.id || `actor-${index}`);
      return freeze({ actor, id, bucket: assignStimulusWorkBucket(id, bucketCount), score: score(actor) });
    });
    safe.sort((a, b) => (b.score - a.score) || (a.bucket - b.bucket) || a.id.localeCompare(b.id));
    const limit = Math.max(0, Math.min(policy.maxPerTick, Math.floor(finite(count, policy.maxPerTick))));
    const selected = safe.slice(0, limit);
    const selectedIds = new Set(selected.map((value) => value.id));
    for (const entry of safe) age.set(entry.id, selectedIds.has(entry.id) ? 0 : Math.min(policy.maxStarvationTicks, finite(age.get(entry.id), 0) + 1));
    tick += 1;
    return freeze({ tick, selected: freeze(selected), starvation: freeze([...age.entries()].map(([id, ticks]) => freeze({ id, ticks })).sort((a, b) => (b.ticks - a.ticks) || a.id.localeCompare(b.id))) });
  }

  function reset() { age.clear(); tick = 0; }
  return freeze({ select, reset, get tick() { return tick; }, get size() { return age.size; } });
}

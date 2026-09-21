// @ts-nocheck
/**
 * Temporal stimulus memory for living-world agents.
 *
 * Memory is bounded, deterministic and read-only to the world. The caller owns actor state and may
 * project the returned memory into its existing AI/reaction runtime. Expiration is evaluated from a
 * caller-owned clock so replay can use the exact same timeline without wall-clock dependencies.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

export const LIVING_WORLD_STIMULUS_MEMORY_POLICY = freeze({
  id: 'living-world-stimulus-memory-2026-09-v1',
  maxRecords: 192,
  maxPerKind: 24,
  maxPerActor: 48,
  defaultTtlSeconds: 12,
  combatTtlSeconds: 18,
  alarmTtlSeconds: 30,
  weatherTtlSeconds: 120,
  minConfidenceToRemember: 0.1,
});

function keyFor(stimulus) {
  return `${stimulus.actorId || '_'}:${stimulus.id}`;
}

function ttlFor(stimulus, policy) {
  if (stimulus.metadata?.persistent) return policy.defaultTtlSeconds * 8;
  if (stimulus.kind === 'combat' || stimulus.kind === 'damage' || stimulus.kind === 'death') return policy.combatTtlSeconds;
  if (stimulus.kind === 'alarm' || stimulus.kind === 'threat') return policy.alarmTtlSeconds;
  if (stimulus.kind === 'weather' || stimulus.kind === 'environment') return policy.weatherTtlSeconds;
  return policy.defaultTtlSeconds;
}

export function createLivingWorldStimulusMemory(options = {}) {
  const policy = freeze({ ...LIVING_WORLD_STIMULUS_MEMORY_POLICY, ...(options.policy || {}) });
  const records = new Map();
  let revision = 0;
  let disposed = false;

  function accept(stimulus, nowSeconds = 0) {
    if (disposed || !stimulus?.id || stimulus.confidence < policy.minConfidenceToRemember) return false;
    const now = Math.max(0, finite(nowSeconds, 0));
    const key = keyFor(stimulus);
    const existing = records.get(key);
    const receivedAt = Math.max(0, finite(stimulus.timestampMs, 0)) / 1000;
    const age = Math.max(0, finite(stimulus.ageSeconds, 0));
    const canonical = freeze({
      ...stimulus,
      firstSeenSeconds: existing?.firstSeenSeconds ?? Math.max(0, receivedAt - age),
      lastSeenSeconds: now,
      ttlSeconds: clamp(ttlFor(stimulus, policy), 0.1, policy.weatherTtlSeconds * 16),
      memoryRevision: revision + 1,
    });
    records.set(key, canonical);
    revision += 1;
    prune(now);
    return true;
  }

  function prune(nowSeconds = 0) {
    if (disposed) return;
    const now = Math.max(0, finite(nowSeconds, 0));
    for (const [key, record] of records) {
      if (now - record.lastSeenSeconds > record.ttlSeconds) records.delete(key);
    }
    const sorted = [...records.entries()].sort(([, a], [, b]) => {
      return (b.lastSeenSeconds - a.lastSeenSeconds) || (b.confidence - a.confidence) || a.id.localeCompare(b.id);
    });
    const keep = sorted.slice(0, policy.maxRecords);
    records.clear();
    for (const [key, record] of keep) records.set(key, record);
    enforceGroupCap('kind', policy.maxPerKind);
    enforceGroupCap('actorId', policy.maxPerActor);
  }

  function enforceGroupCap(field, limit) {
    if (limit <= 0) return;
    const groups = new Map();
    for (const [key, record] of records) {
      const value = record[field] || '_';
      const list = groups.get(value) || [];
      list.push([key, record]);
      groups.set(value, list);
    }
    for (const list of groups.values()) {
      if (list.length <= limit) continue;
      list.sort(([, a], [, b]) => (b.confidence - a.confidence) || (b.lastSeenSeconds - a.lastSeenSeconds) || a.id.localeCompare(b.id));
      for (const [key] of list.slice(limit)) records.delete(key);
    }
  }

  function query(filter = {}, nowSeconds = 0) {
    if (disposed) return freeze([]);
    prune(nowSeconds);
    const result = [...records.values()].filter((record) => {
      if (filter.kind && record.kind !== filter.kind) return false;
      if (filter.actorId && record.actorId !== filter.actorId) return false;
      if (filter.targetId && record.targetId !== filter.targetId) return false;
      if (filter.channel && record.channel !== filter.channel) return false;
      if (filter.minConfidence != null && record.confidence < filter.minConfidence) return false;
      if (filter.maxAgeSeconds != null && (Math.max(0, finite(nowSeconds) - record.lastSeenSeconds) > filter.maxAgeSeconds)) return false;
      return true;
    });
    result.sort((a, b) => (b.lastSeenSeconds - a.lastSeenSeconds) || (b.confidence - a.confidence) || a.id.localeCompare(b.id));
    return freeze(result.slice(0, policy.maxRecords));
  }

  function latestForActor(actorId, nowSeconds = 0) {
    return query({ actorId }, nowSeconds)[0] || null;
  }

  function strongest(filter = {}, nowSeconds = 0) {
    const values = query(filter, nowSeconds);
    return values.reduce((best, value) => {
      if (!best) return value;
      const score = value.confidence * value.intensity;
      const bestScore = best.confidence * best.intensity;
      return score > bestScore ? value : best;
    }, null);
  }

  function summarize(nowSeconds = 0) {
    prune(nowSeconds);
    const byKind = {};
    const byChannel = {};
    for (const record of records.values()) {
      byKind[record.kind] = (byKind[record.kind] || 0) + 1;
      byChannel[record.channel] = (byChannel[record.channel] || 0) + 1;
    }
    return freeze({ revision, size: records.size, maxRecords: policy.maxRecords, byKind: freeze(byKind), byChannel: freeze(byChannel) });
  }

  function snapshot(nowSeconds = 0) {
    return freeze({ policy, revision, disposed, records: query({}, nowSeconds), summary: summarize(nowSeconds) });
  }

  function clear() {
    if (disposed) return;
    records.clear();
    revision += 1;
  }

  function dispose() {
    disposed = true;
    records.clear();
    revision += 1;
  }

  return freeze({ accept, prune, query, latestForActor, strongest, summarize, snapshot, clear, dispose, get revision() { return revision; }, get disposed() { return disposed; } });
}

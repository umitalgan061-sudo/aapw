const DEFAULTS = Object.freeze({
  maxMemories: 64,
  retentionSeconds: 8,
  decayPerSecond: 0.12,
  investigateThreshold: 0.35,
  engageThreshold: 0.7,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableKey(actorId, stimulusId) {
  return `${String(actorId)}::${String(stimulusId)}`;
}

function normalizeObservation(actorId, observation, nowSeconds) {
  return {
    key: stableKey(actorId, observation?.id),
    actorId: String(actorId),
    stimulusId: String(observation?.id ?? 'unknown'),
    sourceId: observation?.sourceId == null ? null : String(observation.sourceId),
    type: String(observation?.type ?? 'unknown'),
    channel: observation?.channel === 'hearing' ? 'hearing' : 'vision',
    distance: Math.max(0, finite(observation?.distance)),
    score: clamp(finite(observation?.score), 0, 1),
    seenAtSeconds: Math.max(0, finite(nowSeconds)),
  };
}

function decayScore(score, elapsedSeconds, options) {
  return clamp(score - Math.max(0, elapsedSeconds) * options.decayPerSecond, 0, 1);
}

function responseFor(score, options) {
  if (score >= options.engageThreshold) return 'engage';
  if (score >= options.investigateThreshold) return 'investigate';
  return 'ignore';
}

function compareActive(a, b) {
  return b.score - a.score || b.seenAtSeconds - a.seenAtSeconds || a.actorId.localeCompare(b.actorId) || a.stimulusId.localeCompare(b.stimulusId);
}

export function createLivingWorldFaunaPerceptionMemoryPolicy(config = {}) {
  const options = Object.freeze({ ...DEFAULTS, ...config });
  if (options.maxMemories <= 0 || options.retentionSeconds <= 0 || options.decayPerSecond < 0) {
    throw new RangeError('valid perception memory bounds required');
  }
  let disposed = false;
  const memories = new Map();

  return Object.freeze({
    project({ perception, nowSeconds = 0 } = {}) {
      if (disposed) throw new Error('fauna perception memory policy disposed');
      const now = Math.max(0, finite(nowSeconds));
      const observations = Array.isArray(perception?.observations) ? perception.observations : [];

      for (const actorObservation of observations) {
        const actorId = String(actorObservation?.actorId ?? 'unknown');
        for (const observation of actorObservation?.observations ?? []) {
          const normalized = normalizeObservation(actorId, observation, now);
          memories.set(normalized.key, normalized);
        }
      }

      const activeEntries = [];
      for (const [key, memory] of memories) {
        const age = Math.max(0, now - memory.seenAtSeconds);
        if (age > options.retentionSeconds) {
          memories.delete(key);
          continue;
        }
        activeEntries.push({ memory, age, score: decayScore(memory.score, age, options) });
      }

      activeEntries.sort((a, b) => compareActive(
        { ...a.memory, score: a.score, seenAtSeconds: a.memory.seenAtSeconds },
        { ...b.memory, score: b.score, seenAtSeconds: b.memory.seenAtSeconds },
      ));

      const retained = activeEntries.slice(0, options.maxMemories);
      const retainedKeys = new Set(retained.map(({ memory }) => memory.key));
      for (const key of memories.keys()) {
        if (!retainedKeys.has(key)) memories.delete(key);
      }

      const active = retained.map(({ memory, age, score }) => ({
        actorId: memory.actorId,
        stimulusId: memory.stimulusId,
        sourceId: memory.sourceId,
        type: memory.type,
        channel: memory.channel,
        distance: Number(memory.distance.toFixed(4)),
        ageSeconds: Number(age.toFixed(4)),
        score: Number(score.toFixed(6)),
        response: responseFor(score, options),
      }));

      return Object.freeze({
        budget: Object.freeze({ maxMemories: options.maxMemories, retentionSeconds: options.retentionSeconds }),
        memories: Object.freeze(active.map((entry) => Object.freeze(entry))),
      });
    },
    reset() {
      if (disposed) throw new Error('fauna perception memory policy disposed');
      memories.clear();
    },
    dispose() {
      disposed = true;
      memories.clear();
    },
  });
}

export { DEFAULTS as LIVING_WORLD_FAUNA_PERCEPTION_MEMORY_DEFAULTS };

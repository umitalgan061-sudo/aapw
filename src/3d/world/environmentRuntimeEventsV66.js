const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const hash = (seed, text) => { let h = (2166136261 ^ seed) >>> 0; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

export const V66_EVENT_POLICY = Object.freeze({
  id: 'environment-runtime-events-v66-2026-09-15',
  version: 66,
  deterministic: true,
  mutation: false,
  maxQueue: 48,
  horizonSeconds: 900,
});

const EVENT_TYPES = Object.freeze(['rainfront', 'fogbank', 'snowpulse', 'heatwave', 'rivercrest', 'wildlife-movement', 'surface-drydown']);

export const normalizeEventContextV66 = (context = {}) => ({
  seed: Number(context.seed) || 66,
  x: Number(context.x) || 0,
  z: Number(context.z) || 0,
  elevation: Number(context.elevation) || 0,
  moisture: clamp(context.moisture),
  temperature: clamp(context.temperature ?? 0.5),
  humidity: clamp(context.humidity),
  wind: clamp(context.wind),
  precipitation: clamp(context.precipitation),
  snow: clamp(context.snow),
  flow: Math.max(0, Number(context.flow) || 0),
  visibility: clamp(context.visibility ?? 1),
  time: Number(context.time) || 12,
  biome: context.biome || 'grassland',
});

export const scoreEnvironmentalEventV66 = (type, context = {}) => {
  const c = normalizeEventContextV66(context);
  const scores = {
    rainfront: c.precipitation * 0.56 + c.humidity * 0.26 + c.wind * 0.18,
    fogbank: c.humidity * 0.52 + c.precipitation * 0.22 + (1 - c.visibility) * 0.26,
    snowpulse: c.snow * 0.48 + (1 - c.temperature) * 0.34 + c.precipitation * 0.18,
    heatwave: c.temperature * 0.62 + (1 - c.humidity) * 0.22 + (1 - c.snow) * 0.16,
    rivercrest: clamp(c.flow / 12) * 0.56 + c.precipitation * 0.28 + c.humidity * 0.16,
    'wildlife-movement': (1 - c.wind) * 0.22 + c.moisture * 0.24 + c.visibility * 0.2 + (c.biome === 'forest' || c.biome === 'taiga' ? 0.22 : 0.12),
    'surface-drydown': (1 - c.moisture) * 0.44 + c.temperature * 0.34 + (1 - c.humidity) * 0.22,
  };
  return clamp(scores[type] ?? 0);
};

export const createEnvironmentalEventV66 = (type, context = {}, offsetSeconds = 0) => {
  const c = normalizeEventContextV66(context);
  const score = scoreEnvironmentalEventV66(type, c);
  const jitter = (hash(c.seed, `${type}:${c.x}:${c.z}:${Math.round(offsetSeconds)}`) % 1000) / 1000;
  const duration = Math.round(35 + score * 420 + jitter * 60);
  return {
    id: `v66:${type}:${Math.round(c.x)}:${Math.round(c.z)}:${Math.round(offsetSeconds)}`,
    type,
    score: Number(score.toFixed(4)),
    startSeconds: Math.max(0, offsetSeconds),
    durationSeconds: duration,
    intensity: Number(clamp(score * 0.74 + jitter * 0.26).toFixed(4)),
    deterministicKey: `${c.seed}:${type}:${c.x}:${c.z}:${offsetSeconds}`,
  };
};

export const synthesizeEnvironmentEventsV66 = ({ contexts = [], seed = 66, horizonSeconds = V66_EVENT_POLICY.horizonSeconds } = {}) => {
  const events = [];
  for (let index = 0; index < contexts.length; index += 1) {
    const context = normalizeEventContextV66({ ...contexts[index], seed });
    for (const type of EVENT_TYPES) {
      const score = scoreEnvironmentalEventV66(type, context);
      if (score < 0.34) continue;
      const slot = (hash(seed, `${type}:${index}`) % Math.max(1, horizonSeconds));
      events.push(createEnvironmentalEventV66(type, context, slot));
    }
  }
  events.sort((a, b) => a.startSeconds - b.startSeconds || b.score - a.score || a.id.localeCompare(b.id));
  return {
    policy: V66_EVENT_POLICY.id,
    deterministic: true,
    horizonSeconds,
    events: events.slice(0, V66_EVENT_POLICY.maxQueue),
  };
};

export const collapseOverlappingEventsV66 = (events = []) => {
  const sorted = [...events].sort((a, b) => a.startSeconds - b.startSeconds);
  const collapsed = [];
  for (const event of sorted) {
    const previous = collapsed[collapsed.length - 1];
    if (!previous || previous.type !== event.type || event.startSeconds > previous.startSeconds + previous.durationSeconds) {
      collapsed.push({ ...event });
      continue;
    }
    const previousEnd = previous.startSeconds + previous.durationSeconds;
    const eventEnd = event.startSeconds + event.durationSeconds;
    previous.durationSeconds = Math.max(previousEnd, eventEnd) - previous.startSeconds;
    previous.intensity = Math.max(previous.intensity, event.intensity);
    previous.score = Math.max(previous.score, event.score);
  }
  return collapsed;
};

export const resolveEventVisualIntentV66 = (event) => {
  const intensity = clamp(event?.intensity);
  switch (event?.type) {
    case 'rainfront': return { fog: intensity * 0.34, wetness: intensity * 0.86, skyDarken: intensity * 0.24, wind: intensity * 0.42 };
    case 'fogbank': return { fog: intensity * 0.92, wetness: intensity * 0.36, skyDarken: intensity * 0.12, wind: intensity * 0.08 };
    case 'snowpulse': return { fog: intensity * 0.38, snow: intensity * 0.9, skyDarken: intensity * 0.3, wind: intensity * 0.34 };
    case 'heatwave': return { fog: intensity * 0.12, heatHaze: intensity * 0.84, skyDarken: -intensity * 0.08, wind: intensity * 0.18 };
    case 'rivercrest': return { fog: intensity * 0.1, wetness: intensity * 0.74, shorelineFoam: intensity * 0.8, wind: intensity * 0.14 };
    case 'wildlife-movement': return { vegetationMotion: intensity * 0.26, ambientAudio: intensity * 0.6, dust: intensity * 0.04, wind: intensity * 0.1 };
    default: return { drydown: intensity * 0.86, fog: 0, skyDarken: -intensity * 0.05, wind: intensity * 0.12 };
  }
};

export const validateEnvironmentEventsV66 = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_EVENT_POLICY.id) errors.push('policy');
  if (runtime?.deterministic !== true) errors.push('determinism');
  if ((runtime?.events?.length || 0) > V66_EVENT_POLICY.maxQueue) errors.push('queue');
  for (const event of runtime?.events || []) {
    if (!EVENT_TYPES.includes(event.type)) errors.push('type');
    if (event.score < 0 || event.score > 1 || event.intensity < 0 || event.intensity > 1) errors.push('range');
    if (event.durationSeconds <= 0) errors.push('duration');
  }
  return { ok: errors.length === 0, errors };
};

export const environmentEventsTelemetryV66 = (runtime) => {
  const events = runtime?.events || [];
  return {
    count: events.length,
    types: [...new Set(events.map((event) => event.type))],
    meanIntensity: events.length ? Number((events.reduce((sum, event) => sum + event.intensity, 0) / events.length).toFixed(4)) : 0,
    peak: events.length ? Math.max(...events.map((event) => event.intensity)) : 0,
    deterministic: runtime?.deterministic === true,
  };
};

export const getV66EventSummary = () => Object.freeze({ contract: V66_EVENT_POLICY, eventTypes: EVENT_TYPES, authority: 'read-only-environment-events' });

// @ts-nocheck
/**
 * Salience scoring for living-world observations.
 *
 * Scores are deterministic and bounded. This layer converts normalized facts into comparable
 * urgency signals but never chooses a faction, actor action or navigation path by itself.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value, min)));

export const LIVING_WORLD_STIMULUS_SALIENCE_POLICY = freeze({
  id: 'living-world-stimulus-salience-2026-09-v1',
  defaultKindWeights: freeze({
    combat: 1,
    damage: 1,
    death: 1.1,
    alarm: 1,
    noise: 0.55,
    fire: 0.9,
    weather: 0.35,
    resource: 0.45,
    threat: 0.95,
    sighting: 0.65,
    territory: 0.7,
    social: 0.4,
    quest: 0.6,
    environment: 0.5,
    unknown: 0.3,
  }),
  channelWeights: freeze({ visual: 1, auditory: 0.85, tactical: 1.1, social: 0.55, environmental: 0.6, system: 0.4 }),
  distanceFalloffStart: 6,
  distanceFalloffEnd: 80,
  ageHalfLifeSeconds: 7,
  persistenceBoost: 0.12,
  urgentBoost: 0.22,
});

function expDecay(age, halfLife) {
  if (halfLife <= 0) return 0;
  return Math.pow(0.5, Math.max(0, finite(age)) / halfLife);
}

function distanceFactor(distance, policy) {
  const d = Math.max(0, finite(distance, Infinity));
  if (!Number.isFinite(d)) return 0;
  if (d <= policy.distanceFalloffStart) return 1;
  if (d >= policy.distanceFalloffEnd) return 0;
  return 1 - ((d - policy.distanceFalloffStart) / (policy.distanceFalloffEnd - policy.distanceFalloffStart));
}

export function scoreLivingWorldStimulus(stimulus, context = {}, options = {}) {
  const policy = { ...LIVING_WORLD_STIMULUS_SALIENCE_POLICY, ...(options.policy || {}) };
  const position = stimulus?.position;
  const observer = context?.observerPosition;
  const distance = position && observer
    ? Math.hypot(finite(position.x) - finite(observer.x), finite(position.y) - finite(observer.y), finite(position.z) - finite(observer.z))
    : Infinity;
  const kindWeight = finite(options.kindWeights?.[stimulus?.kind], policy.defaultKindWeights[stimulus?.kind] || 0.3);
  const channelWeight = finite(options.channelWeights?.[stimulus?.channel], policy.channelWeights[stimulus?.channel] || 0.4);
  const confidence = clamp(stimulus?.confidence);
  const intensity = clamp(stimulus?.intensity);
  const distanceMultiplier = distanceFactor(distance, policy);
  const age = Math.max(0, finite(stimulus?.ageSeconds, 0));
  const ageMultiplier = expDecay(age, policy.ageHalfLifeSeconds);
  const radius = Math.max(0, finite(stimulus?.radius, 0));
  const radiusMultiplier = radius <= 0 || !Number.isFinite(distance) ? 1 : clamp(1 - Math.max(0, distance - radius) / Math.max(radius, 1));
  let score = kindWeight * channelWeight * confidence * (0.35 + intensity * 0.65) * distanceMultiplier * ageMultiplier * Math.max(0.5, radiusMultiplier);
  if (stimulus?.metadata?.persistent) score += policy.persistenceBoost;
  if (stimulus?.metadata?.urgent) score += policy.urgentBoost;
  return clamp(score);
}

export function rankLivingWorldStimuli(stimuli = [], context = {}, options = {}) {
  if (!Array.isArray(stimuli)) return freeze([]);
  const ranked = stimuli.map((stimulus, index) => freeze({
    stimulus,
    index,
    score: scoreLivingWorldStimulus(stimulus, context, options),
  }));
  ranked.sort((a, b) => (b.score - a.score) || (finite(b.stimulus?.confidence) - finite(a.stimulus?.confidence)) || String(a.stimulus?.id || '').localeCompare(String(b.stimulus?.id || '')) || (a.index - b.index));
  return freeze(ranked);
}

export function summarizeSalience(ranked = []) {
  const safe = Array.isArray(ranked) ? ranked : [];
  const scores = safe.map((entry) => clamp(entry.score)).sort((a, b) => a - b);
  if (!scores.length) return freeze({ count: 0, max: 0, mean: 0, p50: 0, p90: 0 });
  const at = (fraction) => scores[Math.min(scores.length - 1, Math.floor((scores.length - 1) * fraction))];
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return freeze({ count: scores.length, max: scores[scores.length - 1], mean, p50: at(0.5), p90: at(0.9) });
}

export function salienceDigest(ranked = []) {
  return (Array.isArray(ranked) ? ranked : []).map((entry) => `${entry.stimulus?.id || ''}:${Number(entry.score).toFixed(6)}`).join('|');
}

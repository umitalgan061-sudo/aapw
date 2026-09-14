/**
 * Şafak Kartalı — deterministic threat-memory policy.
 *
 * This module is deliberately pure and owner-agnostic. It does not replace the existing
 * perception service, ActorRegistry, faction system or controller state. The runtime receives
 * already-sensed observations, stores bounded confidence memory, and returns immutable decisions.
 *
 * The policy is designed to make stealth, hearing, LOS loss, witness confidence and investigation
 * persistence explicit without introducing another AI state machine. The existing reaction runtime
 * remains the authority for phase selection and owner-service calls.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const stringId = (value, fallback = '') => value == null || value === '' ? fallback : String(value);

export const THREAT_MEMORY_POLICY = freeze({
  id: 'safak-kartali-threat-memory-2026-09-14-v1',
  deterministic: true,
  maxMemoriesPerActor: 12,
  maxHistoryPerTarget: 8,
  maxAgeSeconds: 24,
  staleConfidence: 0.16,
  forgetConfidence: 0.04,
  decayPerSecond: 0.035,
  suspicionPerSecond: 0.018,
  hearingRangeMultiplier: 1.0,
  visionRangeMultiplier: 1.0,
  stealthMinimumVisibility: 0.18,
  stealthNoiseLeak: 0.22,
  occlusionPenalty: 0.45,
  witnessBoost: 0.08,
  hostileBoost: 0.16,
  crimeBoost: 0.22,
  maximumConfidence: 1,
});

export const THREAT_MODALITIES = freeze(['vision', 'hearing', 'witness', 'crime', 'last-known']);
export const SUSPICION_BANDS = freeze([
  freeze({ id: 'calm', min: 0, max: 0.24 }),
  freeze({ id: 'alert', min: 0.24, max: 0.5 }),
  freeze({ id: 'suspicious', min: 0.5, max: 0.75 }),
  freeze({ id: 'certain', min: 0.75, max: 1.01 }),
]);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function round(value, digits = 6) {
  const power = 10 ** digits;
  return Math.round(finite(value) * power) / power;
}

function readPosition(position) {
  if (!position) return null;
  const x = finite(position.x, NaN);
  const z = finite(position.z, NaN);
  return Number.isFinite(x) && Number.isFinite(z) ? { x: round(x, 3), z: round(z, 3) } : null;
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function normalizeModality(value) {
  const modality = stringId(value, 'last-known').toLowerCase();
  return THREAT_MODALITIES.includes(modality) ? modality : 'last-known';
}

function normalizeBand(confidence) {
  const score = clamp(confidence);
  return SUSPICION_BANDS.find((band) => score >= band.min && score < band.max)?.id ?? 'certain';
}

export function normalizeThreatObservation(input = {}) {
  const confidence = clamp(input.confidence, 0, 1);
  const modality = normalizeModality(input.modality ?? (input.visible ? 'vision' : input.audible ? 'hearing' : 'last-known'));
  const stealth = clamp(input.stealth, 0, 1);
  const noise = clamp(input.noise, 0, 1);
  const occluded = Boolean(input.occluded);
  const hostile = Boolean(input.hostile);
  const crimeSeverity = clamp(input.crimeSeverity, 0, 1);
  const witnessCount = Math.max(0, Math.floor(finite(input.witnessCount, 0)));
  return freeze({
    targetId: stringId(input.targetId),
    modality,
    confidence: round(confidence),
    stealth: round(stealth),
    noise: round(noise),
    occluded,
    hostile,
    crimeSeverity: round(crimeSeverity),
    witnessCount,
    position: readPosition(input.position),
    factionId: stringId(input.factionId),
    nowSeconds: Math.max(0, finite(input.nowSeconds)),
    band: normalizeBand(confidence),
  });
}

export function computePerceptionConfidence(input = {}) {
  const observation = normalizeThreatObservation(input);
  let score = observation.confidence;
  if (observation.modality === 'vision') score += 0.18 * (1 - observation.stealth);
  if (observation.modality === 'hearing') score += 0.12 * observation.noise;
  if (observation.modality === 'witness') score += Math.min(0.24, observation.witnessCount * THREAT_MEMORY_POLICY.witnessBoost);
  if (observation.modality === 'crime') score += observation.crimeSeverity * THREAT_MEMORY_POLICY.crimeBoost;
  if (observation.hostile) score += THREAT_MEMORY_POLICY.hostileBoost;
  if (observation.occluded) score *= 1 - THREAT_MEMORY_POLICY.occlusionPenalty;
  if (observation.stealth > THREAT_MEMORY_POLICY.stealthMinimumVisibility) {
    score *= 1 - observation.stealth * (1 - THREAT_MEMORY_POLICY.stealthNoiseLeak);
    score += observation.noise * THREAT_MEMORY_POLICY.stealthNoiseLeak * 0.35;
  }
  return round(clamp(score));
}

export function mergeThreatEvidence(previous, observation, nowSeconds) {
  const prior = previous ? normalizeMemory(previous) : createThreatMemory(observation);
  const sensed = normalizeThreatObservation({ ...observation, nowSeconds });
  const measured = computePerceptionConfidence(sensed);
  const age = Math.max(0, nowSeconds - prior.lastSeenSeconds);
  const decayed = decayConfidence(prior.confidence, age);
  const weighted = clamp(Math.max(decayed * 0.35, measured) + measured * 0.25);
  const next = {
    ...prior,
    confidence: round(weighted),
    suspicion: round(Math.max(prior.suspicion, weighted)),
    lastSeenSeconds: nowSeconds,
    lastModality: sensed.modality,
    lastPosition: sensed.position ?? prior.lastPosition,
    factionId: sensed.factionId || prior.factionId,
    hostile: prior.hostile || sensed.hostile,
    crimeSeverity: round(Math.max(prior.crimeSeverity, sensed.crimeSeverity)),
    witnessCount: Math.max(prior.witnessCount, sensed.witnessCount),
    ageSeconds: 0,
    band: normalizeBand(weighted),
  };
  next.history = trimHistory([...prior.history, freeze({
    nowSeconds,
    confidence: next.confidence,
    modality: sensed.modality,
    position: sensed.position,
    band: next.band,
  })]);
  return freeze(next);
}

export function createThreatMemory(observation = {}, nowSeconds = observation.nowSeconds) {
  const normalized = normalizeThreatObservation({ ...observation, nowSeconds });
  const confidence = computePerceptionConfidence(normalized);
  return freeze({
    targetId: normalized.targetId,
    confidence: round(confidence),
    suspicion: round(confidence),
    lastSeenSeconds: Math.max(0, finite(nowSeconds)),
    lastModality: normalized.modality,
    lastPosition: normalized.position,
    factionId: normalized.factionId,
    hostile: normalized.hostile,
    crimeSeverity: normalized.crimeSeverity,
    witnessCount: normalized.witnessCount,
    ageSeconds: 0,
    band: normalizeBand(confidence),
    history: freeze([freeze({
      nowSeconds: Math.max(0, finite(nowSeconds)),
      confidence: round(confidence),
      modality: normalized.modality,
      position: normalized.position,
      band: normalizeBand(confidence),
    })]),
  });
}

export function normalizeMemory(memory = {}) {
  const history = Array.isArray(memory.history)
    ? memory.history.slice(-THREAT_MEMORY_POLICY.maxHistoryPerTarget).map((entry) => freeze({
      nowSeconds: Math.max(0, finite(entry?.nowSeconds)),
      confidence: round(clamp(entry?.confidence)),
      modality: normalizeModality(entry?.modality),
      position: readPosition(entry?.position),
      band: normalizeBand(entry?.confidence),
    }))
    : [];
  return {
    targetId: stringId(memory.targetId),
    confidence: clamp(memory.confidence),
    suspicion: clamp(memory.suspicion),
    lastSeenSeconds: Math.max(0, finite(memory.lastSeenSeconds)),
    lastModality: normalizeModality(memory.lastModality),
    lastPosition: readPosition(memory.lastPosition),
    factionId: stringId(memory.factionId),
    hostile: Boolean(memory.hostile),
    crimeSeverity: clamp(memory.crimeSeverity),
    witnessCount: Math.max(0, Math.floor(finite(memory.witnessCount))),
    ageSeconds: Math.max(0, finite(memory.ageSeconds)),
    band: normalizeBand(memory.confidence),
    history,
  };
}

export function decayConfidence(confidence, ageSeconds) {
  const age = Math.max(0, finite(ageSeconds));
  if (age >= THREAT_MEMORY_POLICY.maxAgeSeconds) return 0;
  const confidenceScore = clamp(confidence);
  const linear = confidenceScore - age * THREAT_MEMORY_POLICY.decayPerSecond;
  return round(clamp(linear));
}

export function ageThreatMemory(memory, deltaSeconds) {
  const current = normalizeMemory(memory);
  const delta = Math.max(0, finite(deltaSeconds));
  const nextConfidence = decayConfidence(current.confidence, delta);
  const nextSuspicion = clamp(current.suspicion - delta * THREAT_MEMORY_POLICY.suspicionPerSecond);
  const next = {
    ...current,
    confidence: nextConfidence,
    suspicion: round(nextSuspicion),
    ageSeconds: current.ageSeconds + delta,
    band: normalizeBand(Math.max(nextConfidence, nextSuspicion)),
  };
  return freeze(next);
}

export function isStaleThreat(memory) {
  const current = normalizeMemory(memory);
  return current.ageSeconds > THREAT_MEMORY_POLICY.maxAgeSeconds || current.confidence < THREAT_MEMORY_POLICY.staleConfidence;
}

export function shouldForgetThreat(memory) {
  const current = normalizeMemory(memory);
  return current.ageSeconds > THREAT_MEMORY_POLICY.maxAgeSeconds || current.confidence < THREAT_MEMORY_POLICY.forgetConfidence;
}

export function selectThreatTarget(memories, options = {}) {
  const targetFaction = stringId(options.factionId);
  const candidates = (Array.isArray(memories) ? memories : [])
    .map(normalizeMemory)
    .filter((memory) => memory.targetId && !shouldForgetThreat(memory))
    .map((memory) => {
      const factionBoost = targetFaction && memory.factionId === targetFaction ? 0.08 : 0;
      const hostileBoost = memory.hostile ? 0.18 : 0;
      const crimeBoost = memory.crimeSeverity * 0.2;
      const distancePenalty = Number.isFinite(options.maxDistanceMeters) && memory.lastPosition && options.position
        ? Math.min(0.2, distance(memory.lastPosition, options.position) / Math.max(1, options.maxDistanceMeters) * 0.2)
        : 0;
      const score = clamp(memory.confidence * 0.56 + memory.suspicion * 0.24 + factionBoost + hostileBoost + crimeBoost - distancePenalty);
      return { memory, score: round(score) };
    })
    .sort((a, b) => b.score - a.score || a.memory.targetId.localeCompare(b.memory.targetId));
  return candidates[0] ? freeze(candidates[0]) : null;
}

export function rankThreats(memories, options = {}) {
  const list = [];
  const input = Array.isArray(memories) ? memories : [];
  for (const memory of input) {
    const target = selectThreatTarget([memory], options);
    if (target) list.push(target);
  }
  return freeze(list.sort((a, b) => b.score - a.score || a.memory.targetId.localeCompare(b.memory.targetId)).slice(0, THREAT_MEMORY_POLICY.maxMemoriesPerActor));
}

export function computeStealthOutcome({ stealth = 0, noise = 0, light = 1, distanceMeters = 0, occluded = false } = {}) {
  const stealthScore = clamp(stealth);
  const noiseScore = clamp(noise);
  const lightScore = clamp(light);
  const distanceScore = clamp(1 - Math.max(0, finite(distanceMeters)) / 100);
  const occlusionScore = occluded ? 0.35 : 1;
  const detectionChance = clamp((1 - stealthScore) * 0.48 + noiseScore * 0.32 + lightScore * 0.1 + distanceScore * 0.1);
  const effective = round(detectionChance * occlusionScore);
  return freeze({
    detected: effective >= 0.5,
    confidence: effective,
    band: normalizeBand(effective),
    modifiers: freeze({ stealth: round(stealthScore), noise: round(noiseScore), light: round(lightScore), distance: round(distanceScore), occlusion: occlusionScore }),
  });
}

export function computeHearingFalloff({ noise = 0, distanceMeters = 0, hearingRange = 20, obstruction = 0 } = {}) {
  const noiseScore = clamp(noise);
  const range = Math.max(1, finite(hearingRange, 20));
  const distanceScore = clamp(1 - Math.max(0, finite(distanceMeters)) / range);
  const obstructionScore = 1 - clamp(obstruction) * 0.55;
  return round(clamp(noiseScore * distanceScore * obstructionScore));
}

export function computeVisionFalloff({ confidence = 1, distanceMeters = 0, visionRange = 40, fieldOfView = 1, light = 1, stealth = 0 } = {}) {
  const range = Math.max(1, finite(visionRange, 40));
  const distanceScore = clamp(1 - Math.max(0, finite(distanceMeters)) / range);
  const fovScore = clamp(fieldOfView);
  const lightScore = clamp(light);
  const stealthScore = 1 - clamp(stealth);
  return round(clamp(confidence) * distanceScore * (0.5 + fovScore * 0.5) * (0.4 + lightScore * 0.6) * stealthScore);
}

export function buildLastKnownPosition(memory, fallback = null) {
  const normalized = normalizeMemory(memory);
  return normalized.lastPosition ?? readPosition(fallback);
}

export function summarizeThreatMemory(memories) {
  const list = rankThreats(memories);
  const counts = new Map(SUSPICION_BANDS.map((band) => [band.id, 0]));
  let hostile = 0;
  let wanted = 0;
  for (const entry of list) {
    counts.set(entry.memory.band, (counts.get(entry.memory.band) ?? 0) + 1);
    hostile += Number(entry.memory.hostile);
    wanted += Number(entry.memory.crimeSeverity > 0);
  }
  return freeze({
    count: list.length,
    hostile,
    wanted,
    bandCounts: freeze(Object.fromEntries(counts)),
    topTargetId: list[0]?.memory?.targetId ?? '',
    topScore: list[0]?.score ?? 0,
  });
}

export function deterministicMemoryFingerprint(memoryOrList, seed = 0) {
  const normalized = Array.isArray(memoryOrList)
    ? memoryOrList.map(normalizeMemory).sort((a, b) => a.targetId.localeCompare(b.targetId))
    : normalizeMemory(memoryOrList);
  return stableHash(JSON.stringify({ seed, normalized })).toString(16).padStart(8, '0');
}

export function auditThreatMemory(memory) {
  const errors = [];
  const normalized = normalizeMemory(memory);
  if (!normalized.targetId) errors.push('missing-target-id');
  if (!Number.isFinite(normalized.confidence) || normalized.confidence < 0 || normalized.confidence > 1) errors.push('confidence-range');
  if (!Number.isFinite(normalized.suspicion) || normalized.suspicion < 0 || normalized.suspicion > 1) errors.push('suspicion-range');
  if (!THREAT_MODALITIES.includes(normalized.lastModality)) errors.push('modality');
  if (normalized.history.length > THREAT_MEMORY_POLICY.maxHistoryPerTarget) errors.push('history-overflow');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), fingerprint: deterministicMemoryFingerprint(normalized) });
}

export function capThreatMemories(memories, limit = THREAT_MEMORY_POLICY.maxMemoriesPerActor) {
  const cap = Math.max(1, Math.min(THREAT_MEMORY_POLICY.maxMemoriesPerActor, Math.floor(finite(limit, THREAT_MEMORY_POLICY.maxMemoriesPerActor))));
  return freeze(rankThreats(memories).slice(0, cap).map((entry) => freeze(entry.memory)));
}

export function projectThreatForReaction(memory, context = {}) {
  const normalized = normalizeMemory(memory);
  const position = buildLastKnownPosition(normalized, context.fallbackPosition);
  return freeze({
    targetId: normalized.targetId,
    confidence: round(normalized.confidence),
    suspicion: round(normalized.suspicion),
    hostile: normalized.hostile,
    wanted: normalized.crimeSeverity > 0,
    crimeSeverity: round(normalized.crimeSeverity),
    modality: normalized.lastModality,
    position,
    stale: isStaleThreat(normalized),
    band: normalized.band,
  });
}

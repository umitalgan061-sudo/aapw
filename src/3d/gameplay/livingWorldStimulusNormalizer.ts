// @ts-nocheck
/**
 * Deterministic normalization boundary for living-world stimuli.
 *
 * This module consumes untrusted observations and produces a bounded immutable signal suitable for
 * world-reaction, faction and fauna consumers. It never mutates actors, navigation, combat or world
 * state. Unknown stimulus kinds are retained as `unknown` instead of throwing, while malformed
 * numeric data fails closed to safe defaults.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 96) : fallback;

export const LIVING_WORLD_STIMULUS_KINDS = freeze([
  'combat', 'damage', 'death', 'alarm', 'noise', 'fire', 'weather', 'resource', 'threat',
  'sighting', 'territory', 'social', 'quest', 'environment', 'unknown',
]);

export const LIVING_WORLD_STIMULUS_CHANNELS = freeze([
  'visual', 'auditory', 'tactical', 'social', 'environmental', 'system',
]);

export const LIVING_WORLD_STIMULUS_NORMALIZER_POLICY = freeze({
  id: 'living-world-stimulus-normalizer-2026-09-v1',
  maxSignalsPerBatch: 256,
  maxIdLength: 96,
  maxActorIdLength: 96,
  maxTagCount: 12,
  maxTagLength: 32,
  minConfidence: 0,
  maxConfidence: 1,
  maxIntensity: 1,
  maxRadius: 5000,
  maxAgeSeconds: 3600,
});

function normalizeKind(value) {
  const candidate = text(value, 'unknown').toLowerCase().replace(/[^a-z-]/g, '-');
  return LIVING_WORLD_STIMULUS_KINDS.includes(candidate) ? candidate : 'unknown';
}

function normalizeChannel(value) {
  const candidate = text(value, 'system').toLowerCase();
  return LIVING_WORLD_STIMULUS_CHANNELS.includes(candidate) ? candidate : 'system';
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') return null;
  const x = finite(position.x, NaN);
  const y = finite(position.y, NaN);
  const z = finite(position.z, NaN);
  if (![x, y, z].every(Number.isFinite)) return null;
  return freeze({ x: clamp(x, -100000, 100000), y: clamp(y, -100000, 100000), z: clamp(z, -100000, 100000) });
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const result = [];
  const seen = new Set();
  for (const tag of tags.slice(0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxTagCount)) {
    const normalized = text(tag).trim().toLowerCase().slice(0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxTagLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizeLivingWorldStimulus(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const id = text(source.id, `stimulus-${Math.max(0, index)}`).slice(0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxIdLength);
  const actorId = text(source.actorId || source.sourceActorId).slice(0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxActorIdLength) || null;
  const targetId = text(source.targetId).slice(0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxActorIdLength) || null;
  const position = normalizePosition(source.position);
  const confidence = clamp(source.confidence, 0, 1);
  const intensity = clamp(source.intensity, 0, 1);
  const radius = clamp(source.radius, 0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxRadius);
  const ageSeconds = clamp(source.ageSeconds, 0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxAgeSeconds);
  const timestampMs = Math.max(0, finite(source.timestampMs, 0));
  const sequence = Math.max(0, Math.floor(finite(source.sequence, index)));
  const normalized = {
    id,
    sequence,
    kind: normalizeKind(source.kind),
    channel: normalizeChannel(source.channel),
    actorId,
    targetId,
    source: text(source.source, 'unknown'),
    factionId: text(source.factionId).trim() || null,
    position,
    confidence,
    intensity,
    radius,
    ageSeconds,
    timestampMs,
    tags: normalizeTags(source.tags),
    metadata: freeze({
      urgent: Boolean(source.metadata?.urgent),
      persistent: Boolean(source.metadata?.persistent),
      synthetic: Boolean(source.metadata?.synthetic),
    }),
  };
  return freeze(normalized);
}

export function normalizeLivingWorldStimulusBatch(inputs = []) {
  if (!Array.isArray(inputs)) return [];
  const bounded = inputs.slice(0, LIVING_WORLD_STIMULUS_NORMALIZER_POLICY.maxSignalsPerBatch);
  const normalized = bounded.map((value, index) => normalizeLivingWorldStimulus(value, index));
  normalized.sort((a, b) => (a.timestampMs - b.timestampMs) || (a.sequence - b.sequence) || a.id.localeCompare(b.id));
  return freeze(normalized);
}

export function stimulusPositionDistance(a, b) {
  if (!a || !b) return Infinity;
  const dx = finite(a.x) - finite(b.x);
  const dy = finite(a.y) - finite(b.y);
  const dz = finite(a.z) - finite(b.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function validateNormalizedStimulus(stimulus) {
  if (!stimulus || typeof stimulus !== 'object') return false;
  if (!stimulus.id || !LIVING_WORLD_STIMULUS_KINDS.includes(stimulus.kind)) return false;
  if (!LIVING_WORLD_STIMULUS_CHANNELS.includes(stimulus.channel)) return false;
  if (!Number.isFinite(stimulus.confidence) || stimulus.confidence < 0 || stimulus.confidence > 1) return false;
  if (!Number.isFinite(stimulus.intensity) || stimulus.intensity < 0 || stimulus.intensity > 1) return false;
  return true;
}

export function compareStimulusStableOrder(a, b) {
  return (finite(a?.timestampMs) - finite(b?.timestampMs))
    || (Math.max(0, Math.floor(finite(a?.sequence))) - Math.max(0, Math.floor(finite(b?.sequence))))
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}

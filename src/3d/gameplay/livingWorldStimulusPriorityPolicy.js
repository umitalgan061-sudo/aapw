/**
 * Source-priority and conflict-resolution policy for living-world stimuli.
 *
 * Different producers can report the same situation. This policy prefers authoritative tactical
 * sources when confidence is comparable, while retaining independent environmental context.
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const LIVING_WORLD_STIMULUS_SOURCE_PRIORITY = freeze({
  combat: 1,
  player: 0.95,
  faction: 0.9,
  perception: 0.8,
  fauna: 0.76,
  weather: 0.65,
  quest: 0.6,
  scripted: 0.55,
  unknown: 0.35,
});

export const LIVING_WORLD_STIMULUS_PRIORITY_POLICY = freeze({
  id: 'living-world-stimulus-priority-2026-09-v1',
  maxCandidates: 24,
  duplicateDistanceMeters: 1.5,
  duplicateWindowSeconds: 0.5,
});

function sourcePriority(source) {
  const key = String(source || 'unknown').toLowerCase();
  return finite(LIVING_WORLD_STIMULUS_SOURCE_PRIORITY[key], LIVING_WORLD_STIMULUS_SOURCE_PRIORITY.unknown);
}

function distance(a, b) {
  if (!a?.position || !b?.position) return Infinity;
  return Math.hypot(finite(a.position.x) - finite(b.position.x), finite(a.position.y) - finite(b.position.y), finite(a.position.z) - finite(b.position.z));
}

function sameSemanticEvent(a, b, policy) {
  if (!a || !b || a.kind !== b.kind || a.targetId !== b.targetId) return false;
  if (Math.abs(finite(a.timestampMs) - finite(b.timestampMs)) > policy.duplicateWindowSeconds * 1000) return false;
  return distance(a, b) <= policy.duplicateDistanceMeters;
}

export function resolveLivingWorldStimulusConflicts(stimuli = [], options = {}) {
  const policy = { ...LIVING_WORLD_STIMULUS_PRIORITY_POLICY, ...(options.policy || {}) };
  const input = Array.isArray(stimuli) ? stimuli.slice(0, policy.maxCandidates * 4) : [];
  const candidates = input.map((stimulus, index) => ({
    stimulus,
    index,
    sourcePriority: sourcePriority(stimulus?.source),
    confidence: clamp(stimulus?.confidence),
    intensity: clamp(stimulus?.intensity),
  }));
  candidates.sort((a, b) => (b.sourcePriority - a.sourcePriority) || (b.confidence - a.confidence) || (b.intensity - a.intensity) || String(a.stimulus?.id || '').localeCompare(String(b.stimulus?.id || '')) || (a.index - b.index));
  const selected = [];
  const suppressed = [];
  for (const candidate of candidates) {
    const duplicate = selected.find((existing) => sameSemanticEvent(existing.stimulus, candidate.stimulus, policy));
    if (duplicate) suppressed.push(candidate);
    else selected.push(candidate);
    if (selected.length >= policy.maxCandidates) break;
  }
  return freeze({
    selected: freeze(selected.map((value) => freeze({ ...value }))),
    suppressed: freeze(suppressed.map((value) => freeze({ ...value }))),
    inputCount: input.length,
  });
}

export function priorityScore(stimulus) {
  return clamp(sourcePriority(stimulus?.source) * 0.45 + clamp(stimulus?.confidence) * 0.35 + clamp(stimulus?.intensity) * 0.2);
}

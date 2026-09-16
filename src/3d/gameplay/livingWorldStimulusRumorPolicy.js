/**
 * Bounded social-information propagation policy for living-world stimuli.
 *
 * This module does not implement dialogue, faction reputation or social simulation. It only derives
 * a compact rumor candidate packet from trusted stimulus observations so an existing social owner can
 * decide whether to propagate, reject or transform it.
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const LIVING_WORLD_STIMULUS_RUMOR_POLICY = freeze({
  id: 'living-world-stimulus-rumor-2026-09-v1',
  maxRumors: 32,
  maxAudience: 12,
  defaultDecaySeconds: 30,
  minConfidence: 0.25,
});

export function deriveLivingWorldRumorCandidate(stimulus, options = {}) {
  if (!stimulus || finite(stimulus.confidence) < (options.minConfidence ?? LIVING_WORLD_STIMULUS_RUMOR_POLICY.minConfidence)) return null;
  const source = String(stimulus.source || 'unknown').slice(0, 64);
  const kind = String(stimulus.kind || 'unknown').slice(0, 32);
  const targetId = stimulus.targetId ? String(stimulus.targetId).slice(0, 96) : null;
  return freeze({
    rumorId: `rumor:${stimulus.id}`,
    kind,
    source,
    targetId,
    confidence: clamp(stimulus.confidence),
    urgency: clamp(stimulus.intensity),
    decaySeconds: Math.max(1, finite(options.decaySeconds, LIVING_WORLD_STIMULUS_RUMOR_POLICY.defaultDecaySeconds)),
    tags: freeze(Array.isArray(stimulus.tags) ? stimulus.tags.slice(0, 8).map((tag) => String(tag).slice(0, 32)) : []),
  });
}

export function rankRumorCandidates(candidates = []) {
  const ranked = (Array.isArray(candidates) ? candidates : []).filter(Boolean).slice(0, LIVING_WORLD_STIMULUS_RUMOR_POLICY.maxRumors);
  ranked.sort((a, b) => ((b.confidence * 0.6 + b.urgency * 0.4) - (a.confidence * 0.6 + a.urgency * 0.4)) || a.rumorId.localeCompare(b.rumorId));
  return freeze(ranked);
}

export function selectRumorAudience(actorIds = [], options = {}) {
  const max = Math.min(LIVING_WORLD_STIMULUS_RUMOR_POLICY.maxAudience, Math.max(0, Math.floor(finite(options.maxAudience, 12))));
  return freeze([...new Set((Array.isArray(actorIds) ? actorIds : []).map((id) => String(id).slice(0, 96)).filter(Boolean))].sort().slice(0, max));
}

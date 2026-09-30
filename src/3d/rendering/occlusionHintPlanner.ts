// @ts-nocheck
/**
 * Temporal occlusion hint planner for render candidate prioritization.
 *
 * This module does not run GPU occlusion queries. It tracks caller-provided visibility hints and
 * turns them into stable confidence/importance values. A later renderer pass may use the hints to
 * skip low-value work while keeping authoritative visibility in the rendering engine.
 *
 * @module occlusionHintPlanner
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const OCCLUSION_HINT_POLICY = freeze({
  id: 'occlusion-hint-planner-2026-09-v1',
  maxEntries: 4096,
  confidenceGain: 0.22,
  confidenceLoss: 0.38,
  staleFrames: 45,
  hardHideConfidence: 0.12,
});

export function createOcclusionHintPlanner(options = {}) {
  const policy = freeze({ ...OCCLUSION_HINT_POLICY, ...(options.policy || {}) });
  const entries = new Map();
  let revision = 0;

  function observe(id, visible, frame, quality = 1) {
    const key = String(id || 'unknown').slice(0, 96);
    if (!entries.has(key) && entries.size >= policy.maxEntries) return false;
    const previous = entries.get(key) || { confidence: 0.5, visible: true, lastFrame: frame };
    const step = visible ? policy.confidenceGain : -policy.confidenceLoss;
    const confidence = clamp(previous.confidence + step * clamp(quality));
    entries.set(key, freeze({ id: key, visible: Boolean(visible), confidence: Number(confidence.toFixed(4)), lastFrame: Math.max(0, Math.floor(finite(frame, previous.lastFrame))) }));
    revision += 1;
    return true;
  }

  function classify(item, frame) {
    const id = String(item?.id || '').slice(0, 96);
    const cached = entries.get(id);
    const stale = cached ? Math.max(0, Math.floor(finite(frame)) - cached.lastFrame) > policy.staleFrames : true;
    const externalVisible = item?.visible !== false && item?.frustumVisible !== false;
    const confidence = cached ? cached.confidence : 0.5;
    const visible = externalVisible && (stale || confidence > policy.hardHideConfidence);
    const penalty = stale ? 0 : (1 - confidence) * 0.4;
    return freeze({ id, visible, confidence, stale, priorityMultiplier: Number((1 - penalty).toFixed(4)) });
  }

  function snapshot(frame = 0) {
    return freeze({ policy, revision, entries: freeze([...entries.values()].sort((a, b) => a.id.localeCompare(b.id))), classified: freeze([...entries.values()].map((entry) => classify(entry, frame)).sort((a, b) => a.id.localeCompare(b.id))) });
  }

  function reset() { entries.clear(); revision += 1; }
  return freeze({ observe, classify, snapshot, reset, get revision() { return revision; }, get size() { return entries.size; } });
}

export function occlusionPriorityMultiplier(hint) {
  return clamp(hint?.priorityMultiplier, 0, 1);
}

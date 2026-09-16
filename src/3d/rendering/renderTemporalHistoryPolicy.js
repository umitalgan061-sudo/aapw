/**
 * Temporal history validity and reset policy for modern post-processing.
 *
 * Temporal effects such as TAA/temporal reprojection need explicit history invalidation after resize,
 * camera cuts, backend recovery, large render-scale changes, scene teleports or long visibility gaps.
 * This module produces a small state packet; it does not own history textures.
 *
 * @module renderTemporalHistoryPolicy
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

export const TEMPORAL_HISTORY_RESET_REASONS = freeze([
  'bootstrap', 'resize', 'camera-cut', 'backend-recovery', 'render-scale-jump', 'visibility-gap',
  'scene-reset', 'manual', 'quality-change', 'unknown',
]);

export const TEMPORAL_HISTORY_POLICY = freeze({
  id: 'render-temporal-history-2026-09-v1',
  scaleResetThreshold: 0.08,
  visibilityGapMs: 750,
  minConfidence: 0.15,
  warmupFrames: 6,
  maxAgeFrames: 180,
});

function normalizeReason(reason) {
  const value = String(reason || 'unknown');
  return TEMPORAL_HISTORY_RESET_REASONS.includes(value) ? value : 'unknown';
}

export function createTemporalHistoryController(options = {}) {
  const policy = freeze({ ...TEMPORAL_HISTORY_POLICY, ...(options.policy || {}) });
  let valid = false;
  let confidence = 0;
  let ageFrames = 0;
  let warmup = 0;
  let frame = 0;
  let renderScale = finite(options.initialScale, 0.85);
  let lastTimestampMs = null;
  let lastReason = 'bootstrap';

  function reset(reason = 'manual') {
    valid = false;
    confidence = 0;
    ageFrames = 0;
    warmup = policy.warmupFrames;
    lastReason = normalizeReason(reason);
    return snapshot();
  }

  function update(input = {}) {
    frame += 1;
    const timestampMs = Math.max(0, finite(input.timestampMs, frame * 16.67));
    const nextScale = clamp(input.renderScale, 0.5, 1);
    const scaleDelta = Math.abs(nextScale - renderScale);
    if (input.cameraCut) reset('camera-cut');
    else if (input.backendRecovered) reset('backend-recovery');
    else if (input.sceneReset) reset('scene-reset');
    else if (scaleDelta >= policy.scaleResetThreshold) reset('render-scale-jump');
    else if (input.resized) reset('resize');
    else if (lastTimestampMs != null && timestampMs - lastTimestampMs > policy.visibilityGapMs) reset('visibility-gap');
    renderScale = nextScale;
    lastTimestampMs = timestampMs;
    if (warmup > 0) warmup -= 1;
    ageFrames += 1;
    if (ageFrames > policy.maxAgeFrames) reset('unknown');
    if (input.motionConfidence != null) confidence = clamp(input.motionConfidence);
    else confidence = valid ? Math.min(1, confidence + 0.08) : Math.min(0.5, confidence + 0.08);
    valid = warmup === 0 && confidence >= policy.minConfidence && input.historyAvailable !== false;
    return snapshot();
  }

  function snapshot() {
    return freeze({ frame, valid, confidence: Number(confidence.toFixed(4)), ageFrames, warmupFramesRemaining: warmup, renderScale: Number(renderScale.toFixed(4)), lastReason });
  }

  function forceValid(value = true) {
    valid = Boolean(value);
    confidence = valid ? Math.max(policy.minConfidence, confidence) : 0;
    return snapshot();
  }

  return freeze({ update, reset, snapshot, forceValid, get valid() { return valid; }, get frame() { return frame; } });
}

export function shouldInvalidateTemporalHistory(previous = {}, next = {}) {
  if (next.cameraCut || next.backendRecovered || next.sceneReset || next.resized) return true;
  if (Math.abs(finite(next.renderScale, 0.85) - finite(previous.renderScale, 0.85)) >= TEMPORAL_HISTORY_POLICY.scaleResetThreshold) return true;
  if (finite(next.timestampMs) - finite(previous.timestampMs) > TEMPORAL_HISTORY_POLICY.visibilityGapMs) return true;
  return false;
}

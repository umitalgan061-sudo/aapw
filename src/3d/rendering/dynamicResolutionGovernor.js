/**
 * Closed-loop render-scale governor for GPU/CPU pressure.
 *
 * Uses only caller-provided frame timings and quality constraints. Hysteresis, smoothing and dwell
 * prevent resolution oscillation. The governor emits a target scale; renderer configuration remains
 * owned by the composition root.
 *
 * @module dynamicResolutionGovernor
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

export const DYNAMIC_RESOLUTION_TIERS = freeze(['quality', 'balanced', 'performance', 'survival']);

export const DYNAMIC_RESOLUTION_POLICY = freeze({
  id: 'dynamic-resolution-governor-2026-09-v1',
  minScale: 0.55,
  maxScale: 1,
  defaultScale: 0.85,
  targetFrameMs: 16.67,
  criticalFrameMs: 33.33,
  hysteresisMs: 1.25,
  smoothingAlpha: 0.12,
  upscaleStep: 0.03,
  downscaleStep: 0.05,
  minDwellFrames: 15,
  maxDwellFrames: 90,
  thermalPenaltyScale: 0.9,
  dataSaverScale: 0.92,
});

function tierFor(scale, policy) {
  if (scale <= policy.minScale + 0.04) return 'survival';
  if (scale <= 0.72) return 'performance';
  if (scale <= 0.9) return 'balanced';
  return 'quality';
}

export function createDynamicResolutionGovernor(options = {}) {
  const policy = freeze({ ...DYNAMIC_RESOLUTION_POLICY, ...(options.policy || {}) });
  let scale = clamp(options.initialScale ?? policy.defaultScale, policy.minScale, policy.maxScale);
  let smoothedFrameMs = finite(options.initialFrameMs, policy.targetFrameMs);
  let lastDirection = 'hold';
  let dwellFrames = 0;
  let frame = 0;
  let forcedScale = null;

  function setForcedScale(value = null) {
    forcedScale = value == null ? null : clamp(value, policy.minScale, policy.maxScale);
    if (forcedScale != null) scale = forcedScale;
    return snapshot();
  }

  function update(input = {}) {
    frame += 1;
    dwellFrames += 1;
    const frameMs = Math.max(0, finite(input.frameMs, policy.targetFrameMs));
    smoothedFrameMs += (frameMs - smoothedFrameMs) * clamp(policy.smoothingAlpha, 0.01, 1);
    if (forcedScale != null) return snapshot();

    const thermal = clamp(input.thermalPressure);
    const visibility = input.visibility === 'hidden' ? 0.75 : 1;
    const dataSaver = input.saveData ? policy.dataSaverScale : 1;
    const motionScale = input.reducedMotion ? 1 : 1;
    const pressureBudget = policy.targetFrameMs * visibility * dataSaver * motionScale;
    const highPressure = smoothedFrameMs > pressureBudget + policy.hysteresisMs || thermal >= 0.75;
    const lowPressure = smoothedFrameMs < policy.targetFrameMs - policy.hysteresisMs && thermal < 0.5;
    if (highPressure && dwellFrames >= policy.minDwellFrames) {
      const thermalScale = thermal >= 0.9 ? policy.thermalPenaltyScale : 1;
      scale = clamp(scale - policy.downscaleStep * thermalScale, policy.minScale, policy.maxScale);
      lastDirection = 'down';
      dwellFrames = 0;
    } else if (lowPressure && dwellFrames >= Math.max(policy.minDwellFrames, Math.floor(policy.maxDwellFrames / 2))) {
      scale = clamp(scale + policy.upscaleStep, policy.minScale, policy.maxScale);
      lastDirection = 'up';
      dwellFrames = 0;
    } else {
      lastDirection = 'hold';
    }
    return snapshot();
  }

  function snapshot() {
    return freeze({
      scale: Number(scale.toFixed(4)),
      tier: tierFor(scale, policy),
      smoothedFrameMs: Number(smoothedFrameMs.toFixed(3)),
      targetFrameMs: policy.targetFrameMs,
      direction: lastDirection,
      dwellFrames,
      frame,
      forced: forcedScale != null,
    });
  }

  function reset() {
    scale = clamp(options.initialScale ?? policy.defaultScale, policy.minScale, policy.maxScale);
    smoothedFrameMs = finite(options.initialFrameMs, policy.targetFrameMs);
    lastDirection = 'hold';
    dwellFrames = 0;
    frame = 0;
    forcedScale = null;
  }

  return freeze({ update, snapshot, setForcedScale, reset, get scale() { return scale; }, get tier() { return tierFor(scale, policy); } });
}

export function recommendDynamicResolution({ gpuMs = 0, cpuMs = 0, targetFrameMs = 16.67, currentScale = 0.85, thermalPressure = 0 } = {}) {
  const total = Math.max(gpuMs, cpuMs, 0);
  const pressure = total / Math.max(1, finite(targetFrameMs, 16.67));
  const thermal = clamp(thermalPressure);
  let scaleDelta = 0;
  if (pressure > 1.15 || thermal > 0.8) scaleDelta = -0.05;
  else if (pressure > 1.02) scaleDelta = -0.025;
  else if (pressure < 0.8 && thermal < 0.4) scaleDelta = 0.02;
  return freeze({ pressure: Number(pressure.toFixed(3)), recommendedScale: Number(clamp(currentScale + scaleDelta, 0.55, 1).toFixed(3)), scaleDelta });
}

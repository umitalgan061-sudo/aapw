/**
 * Frame pacing helpers for requestAnimationFrame-driven worlds.
 *
 * Keeps simulation deltas bounded, tracks dropped/long frames and computes a render cadence hint.
 * This is independent of the simulation clock: callers still decide when to apply the returned delta.
 * @module framePacing
 */

export const FRAME_PACING_DEFAULTS = Object.freeze({ maxDeltaSeconds: 0.05, minDeltaSeconds: 0, targetFps: 60, jitterWindow: 32, catchUpFrames: 2 });
function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, n(value, lo))); }

export function clampSimulationDelta(deltaSeconds, options = FRAME_PACING_DEFAULTS) {
  const max = Math.max(0.001, n(options.maxDeltaSeconds, 0.05));
  return clamp(deltaSeconds, Math.max(0, n(options.minDeltaSeconds, 0)), max);
}

export function createFramePacer(options = {}) {
  const config = { ...FRAME_PACING_DEFAULTS, ...options };
  const samples = [];
  let frame = 0;
  let elapsed = 0;
  let longFrames = 0;
  let droppedFrames = 0;
  let disposed = false;

  function push(value) {
    samples.push(value);
    while (samples.length > Math.max(4, Math.trunc(config.jitterWindow))) samples.shift();
  }

  return {
    tick(rawDeltaSeconds) {
      if (disposed) throw new Error('FRAME_PACER_DISPOSED');
      const raw = Math.max(0, n(rawDeltaSeconds));
      const target = 1 / Math.max(1, n(config.targetFps, 60));
      const delta = clampSimulationDelta(raw, config);
      frame += 1;
      elapsed += delta;
      push(raw);
      if (raw > target * 1.75) longFrames += 1;
      if (raw > config.maxDeltaSeconds) droppedFrames += 1;
      const average = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : target;
      const jitter = samples.length ? Math.sqrt(samples.reduce((sum, value) => sum + ((value - average) ** 2), 0) / samples.length) : 0;
      return Object.freeze({
        frame,
        rawDeltaSeconds: Number(raw.toFixed(5)),
        deltaSeconds: Number(delta.toFixed(5)),
        averageFrameMs: Number((average * 1000).toFixed(3)),
        jitterMs: Number((jitter * 1000).toFixed(3)),
        longFrames,
        droppedFrames,
        elapsedSeconds: Number(elapsed.toFixed(5)),
        catchUpBudget: Math.max(1, Math.trunc(config.catchUpFrames)),
      });
    },
    snapshot() {
      const average = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
      return Object.freeze({ frame, elapsedSeconds: elapsed, sampleCount: samples.length, averageFrameMs: average * 1000, longFrames, droppedFrames });
    },
    reset() { samples.length = 0; frame = 0; elapsed = 0; longFrames = 0; droppedFrames = 0; },
    dispose() { disposed = true; samples.length = 0; },
  };
}

export function chooseRenderEveryNFrames({ targetFps = 60, displayFps = 60, workloadFps = targetFps } = {}) {
  const target = Math.max(1, n(targetFps, 60));
  const display = Math.max(1, n(displayFps, target));
  const workload = Math.max(1, n(workloadFps, target));
  return Math.max(1, Math.round(display / Math.min(display, workload || target)));
}

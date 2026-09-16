/**
 * Adaptive frame-time governor.
 *
 * Converts observed frame durations into deterministic quality pressure signals. The governor does
 * not mutate Three.js objects and therefore can be tested without a browser renderer. It exposes
 * hysteresis, cooldowns, emergency recovery, rolling samples and an explicit frame budget ledger so
 * systems can make bounded work decisions instead of each subsystem inventing its own thresholds.
 * @module runtimeFrameGovernor
 */

export const FRAME_GOVERNOR_DEFAULTS = Object.freeze({
  targetFps: 60,
  floorFps: 30,
  sampleWindow: 45,
  warmupFrames: 20,
  downgradeAfter: 4,
  upgradeAfter: 28,
  cooldownFrames: 18,
  recoveryFrames: 10,
  emergencyFrameMs: 80,
  minLevel: 0,
  maxLevel: 5,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function integer(value, fallback = 0) {
  return Math.trunc(finite(value, fallback));
}
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, finite(value, low)));
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(ratio, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function createFrameBudgetLedger({ budgetMs = 16.67, safetyMs = 2, carryMs = 8 } = {}) {
  let remaining = Math.max(0, finite(budgetMs) - finite(safetyMs));
  let carry = clamp(carryMs, 0, 100);
  const spent = [];
  let closed = false;
  return {
    reserve(label, requestedMs, priority = 0) {
      if (closed) return { accepted: false, reason: 'closed', grantedMs: 0, label };
      const requested = Math.max(0, finite(requestedMs));
      const extra = Math.min(carry, Math.max(0, remaining * 0.25));
      const available = remaining + extra;
      const ratio = clamp((integer(priority, 0) + 2) / 4, 0, 1);
      const granted = Math.min(requested, Math.max(0, available * ratio));
      if (granted <= 0) return { accepted: false, reason: 'budget-exhausted', grantedMs: 0, label };
      remaining = Math.max(0, remaining - granted);
      carry = Math.max(0, carry - Math.max(0, granted - Math.max(0, requested * 0.6)));
      spent.push({ label, grantedMs: Number(granted.toFixed(3)), priority: integer(priority, 0) });
      return { accepted: true, reason: 'granted', grantedMs: Number(granted.toFixed(3)), label };
    },
    close() { closed = true; },
    snapshot() {
      return Object.freeze({
        budgetMs: Number(finite(budgetMs).toFixed(3)),
        remainingMs: Number(remaining.toFixed(3)),
        carryMs: Number(carry.toFixed(3)),
        spent: spent.map((entry) => Object.freeze({ ...entry })),
        closed,
      });
    },
  };
}

export function createFrameGovernor(options = {}) {
  const config = { ...FRAME_GOVERNOR_DEFAULTS, ...options };
  const frames = [];
  let frameCount = 0;
  let level = integer(config.minLevel, 0);
  let badStreak = 0;
  let goodStreak = 0;
  let cooldown = 0;
  let disposed = false;
  let lastAction = 'warmup';

  function pushSample(frameMs) {
    frames.push(Math.max(0, finite(frameMs)));
    while (frames.length > Math.max(1, integer(config.sampleWindow, 45))) frames.shift();
  }

  function evaluate(frameMs, metadata = {}) {
    if (disposed) throw new Error('FRAME_GOVERNOR_DISPOSED');
    const normalizedMs = Math.max(0.1, finite(frameMs, 16.67));
    pushSample(normalizedMs);
    frameCount += 1;
    const fps = 1000 / normalizedMs;
    const medianMs = median(frames);
    const p95Ms = percentile(frames, 0.95);
    const targetMs = 1000 / Math.max(1, finite(config.targetFps, 60));
    const floorMs = 1000 / Math.max(1, finite(config.floorFps, 30));
    const emergency = normalizedMs >= finite(config.emergencyFrameMs, 80) || p95Ms >= finite(config.emergencyFrameMs, 80);
    if (cooldown > 0) cooldown -= 1;
    if (frameCount <= integer(config.warmupFrames, 20)) {
      lastAction = 'warmup';
    } else if (emergency) {
      badStreak += 1;
      goodStreak = 0;
      if (cooldown <= 0 && level < integer(config.maxLevel, 5)) {
        level += 1;
        cooldown = integer(config.cooldownFrames, 18);
        lastAction = 'emergency-downgrade';
      } else lastAction = 'emergency-hold';
    } else if (medianMs > floorMs || normalizedMs > targetMs * 1.16) {
      badStreak += 1;
      goodStreak = 0;
      if (badStreak >= integer(config.downgradeAfter, 4) && cooldown <= 0 && level < integer(config.maxLevel, 5)) {
        level += 1;
        badStreak = 0;
        cooldown = integer(config.cooldownFrames, 18);
        lastAction = 'downgrade';
      } else lastAction = 'pressure';
    } else if (medianMs < targetMs * 0.86 && p95Ms < targetMs * 1.04) {
      goodStreak += 1;
      badStreak = 0;
      if (goodStreak >= integer(config.upgradeAfter, 28) && cooldown <= 0 && level > integer(config.minLevel, 0)) {
        level -= 1;
        goodStreak = 0;
        cooldown = integer(config.recoveryFrames, 10);
        lastAction = 'upgrade';
      } else lastAction = 'recovery';
    } else {
      badStreak = Math.max(0, badStreak - 1);
      goodStreak = Math.max(0, goodStreak - 1);
      lastAction = 'stable';
    }
    return Object.freeze({
      frame: frameCount,
      level,
      fps: Number(fps.toFixed(3)),
      medianMs: Number(medianMs.toFixed(3)),
      p95Ms: Number(p95Ms.toFixed(3)),
      badStreak,
      goodStreak,
      cooldown,
      action: lastAction,
      emergency,
      reason: metadata.reason ?? null,
    });
  }

  return {
    evaluate,
    createBudgetLedger(estimatedRendererMs = 0) {
      const targetMs = 1000 / Math.max(1, finite(config.targetFps, 60));
      const budget = Math.max(1, targetMs - Math.max(0, finite(estimatedRendererMs)));
      return createFrameBudgetLedger({ budgetMs: budget, safetyMs: Math.min(3, budget * 0.2) });
    },
    snapshot() {
      return Object.freeze({
        frameCount,
        level,
        badStreak,
        goodStreak,
        cooldown,
        lastAction,
        medianMs: Number(median(frames).toFixed(3)),
        p95Ms: Number(percentile(frames, 0.95).toFixed(3)),
        sampleCount: frames.length,
      });
    },
    reset() {
      frames.length = 0;
      frameCount = 0;
      level = integer(config.minLevel, 0);
      badStreak = 0;
      goodStreak = 0;
      cooldown = 0;
      lastAction = 'warmup';
    },
    dispose() { disposed = true; frames.length = 0; },
  };
}

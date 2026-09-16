/**
 * WebGPU/WebGL renderer recovery coordinator.
 *
 * WebGPU device loss can happen after initialization and GPU resources must be recreated. This
 * coordinator keeps recovery state deterministic and transport-neutral. It never owns scenes or
 * resource construction; the application supplies rebuild callbacks and decides when to switch
 * quality/backend.
 *
 * @module renderDeviceRecovery
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

export const RENDER_RECOVERY_STATES = freeze([
  'healthy', 'suspected-loss', 'rebuilding', 'degraded', 'fallback', 'exhausted',
]);

export const RENDER_DEVICE_RECOVERY_POLICY = freeze({
  id: 'render-device-recovery-2026-09-v1',
  maxAttempts: 4,
  baseBackoffMs: 250,
  maxBackoffMs: 4000,
  stableWindowMs: 5000,
  failureWindowMs: 30000,
  downgradeAfterAttempts: 2,
});

function normalizeReason(reason) {
  return String(reason || 'unknown').slice(0, 96);
}

function backoffFor(attempt, policy) {
  const exponent = Math.max(0, Math.min(5, Math.floor(attempt)));
  return clamp(policy.baseBackoffMs * (2 ** exponent), policy.baseBackoffMs, policy.maxBackoffMs);
}

export function createRenderDeviceRecovery(options = {}) {
  const policy = freeze({ ...RENDER_DEVICE_RECOVERY_POLICY, ...(options.policy || {}) });
  let state = 'healthy';
  let attempts = 0;
  let recoveryRevision = 0;
  let lastFailureAtMs = null;
  let stableSinceMs = null;
  let lastReason = null;
  let disposed = false;

  function snapshot() {
    return freeze({ state, attempts, recoveryRevision, lastFailureAtMs, stableSinceMs, lastReason, disposed, policy });
  }

  function signalLoss(reason = 'unknown', timestampMs = 0) {
    if (disposed) return snapshot();
    state = 'suspected-loss';
    lastFailureAtMs = Math.max(0, finite(timestampMs));
    lastReason = normalizeReason(reason);
    stableSinceMs = null;
    recoveryRevision += 1;
    return snapshot();
  }

  function beginRebuild(timestampMs = 0) {
    if (disposed) return snapshot();
    attempts += 1;
    state = attempts > policy.maxAttempts ? 'exhausted' : 'rebuilding';
    lastFailureAtMs = lastFailureAtMs ?? Math.max(0, finite(timestampMs));
    stableSinceMs = null;
    recoveryRevision += 1;
    return freeze({ ...snapshot(), backoffMs: backoffFor(attempts - 1, policy), shouldFallback: attempts > policy.downgradeAfterAttempts });
  }

  function rebuildSucceeded(timestampMs = 0) {
    if (disposed) return snapshot();
    stableSinceMs = Math.max(0, finite(timestampMs));
    state = attempts > 0 ? 'degraded' : 'healthy';
    recoveryRevision += 1;
    return snapshot();
  }

  function tick(timestampMs = 0) {
    if (disposed) return snapshot();
    const now = Math.max(0, finite(timestampMs));
    if (state === 'degraded' && stableSinceMs != null && now - stableSinceMs >= policy.stableWindowMs) {
      state = 'healthy';
      attempts = 0;
      lastFailureAtMs = null;
      lastReason = null;
      stableSinceMs = now;
      recoveryRevision += 1;
    }
    if (state === 'suspected-loss' && lastFailureAtMs != null && now - lastFailureAtMs > policy.failureWindowMs) {
      state = 'fallback';
      recoveryRevision += 1;
    }
    return snapshot();
  }

  function exhausted() {
    return state === 'exhausted';
  }

  function recommendedBackend(currentBackend = 'webgpu') {
    if (state === 'fallback' || state === 'exhausted') return 'webgl2';
    if (attempts > policy.downgradeAfterAttempts && currentBackend === 'webgpu') return 'webgl2';
    return currentBackend === 'webgl2' ? 'webgl2' : 'webgpu';
  }

  function dispose() {
    disposed = true;
    state = 'exhausted';
    recoveryRevision += 1;
  }

  return freeze({ signalLoss, beginRebuild, rebuildSucceeded, tick, exhausted, recommendedBackend, snapshot, dispose, get state() { return state; }, get attempts() { return attempts; } });
}

export async function recoverRendererDevice({ recovery, currentBackend = 'webgpu', rebuild, fallback, timestampMs = 0 } = {}) {
  if (!recovery || typeof rebuild !== 'function') return freeze({ recovered: false, backend: currentBackend, reason: 'missing-recovery-or-rebuild' });
  const attempt = recovery.beginRebuild(timestampMs);
  if (attempt.state === 'exhausted') return freeze({ recovered: false, backend: recovery.recommendedBackend(currentBackend), reason: 'attempt-budget-exhausted', attempt });
  try {
    const rebuilt = await rebuild({ attempt, backend: currentBackend });
    recovery.rebuildSucceeded(timestampMs);
    return freeze({ recovered: true, backend: currentBackend, rebuilt, attempt });
  } catch (error) {
    recovery.signalLoss(error?.message || 'renderer-rebuild-failed', timestampMs);
    const backend = recovery.recommendedBackend(currentBackend);
    if (backend !== currentBackend && typeof fallback === 'function') {
      try {
        const fallbackResult = await fallback({ backend, error, attempt });
        recovery.rebuildSucceeded(timestampMs);
        return freeze({ recovered: true, backend, fallback: true, rebuilt: fallbackResult, attempt });
      } catch (fallbackError) {
        recovery.signalLoss(fallbackError?.message || 'fallback-rebuild-failed', timestampMs);
      }
    }
    return freeze({ recovered: false, backend, error: normalizeReason(error?.message || 'rebuild-failed'), attempt, state: recovery.state });
  }
}

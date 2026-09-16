/**
 * Fault containment membrane for optional runtime accelerators.
 *
 * Optional GPU, streaming and telemetry features can fail independently. This module turns a thrown
 * error into a bounded health record and a stable fallback state. It is intentionally side-effect free
 * except for the caller supplied recovery callback.
 * @module runtimeFaultContainment
 */

export const RUNTIME_HEALTH_STATES = Object.freeze({ HEALTHY: 'healthy', DEGRADED: 'degraded', RECOVERING: 'recovering', FAILED: 'failed' });
function key(name) { return String(name ?? 'runtime'); }
function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }

export function normalizeRuntimeError(error) {
  if (!error) return Object.freeze({ name: 'UnknownError', message: 'unknown runtime error', stack: null });
  return Object.freeze({ name: String(error.name ?? 'Error'), message: String(error.message ?? error), stack: typeof error.stack === 'string' ? error.stack.slice(0, 1000) : null });
}

export function createRuntimeFaultController({ historySize = 48, maxFailures = 3, recoveryFrames = 30 } = {}) {
  const records = new Map();
  let frame = 0;
  let disposed = false;

  function stateFor(name) {
    const id = key(name);
    if (!records.has(id)) records.set(id, { id, state: RUNTIME_HEALTH_STATES.HEALTHY, failures: 0, successes: 0, lastFrame: -1, nextRecoveryFrame: -1, errors: [] });
    return records.get(id);
  }

  function capture(name, error, metadata = {}) {
    if (disposed) throw new Error('RUNTIME_FAULT_CONTROLLER_DISPOSED');
    const record = stateFor(name);
    record.failures += 1;
    record.lastFrame = frame;
    record.state = record.failures >= maxFailures ? RUNTIME_HEALTH_STATES.FAILED : RUNTIME_HEALTH_STATES.DEGRADED;
    record.nextRecoveryFrame = frame + Math.max(1, Math.trunc(recoveryFrames));
    record.errors.push(Object.freeze({ frame, error: normalizeRuntimeError(error), metadata: { ...metadata } }));
    while (record.errors.length > historySize) record.errors.shift();
    return Object.freeze({ ...record, errors: record.errors.slice(-4) });
  }

  function success(name, metadata = {}) {
    if (disposed) throw new Error('RUNTIME_FAULT_CONTROLLER_DISPOSED');
    const record = stateFor(name);
    record.successes += 1;
    record.lastFrame = frame;
    if (record.state !== RUNTIME_HEALTH_STATES.FAILED && record.failures === 0) record.state = RUNTIME_HEALTH_STATES.HEALTHY;
    else if (frame >= record.nextRecoveryFrame && record.successes >= record.failures) record.state = RUNTIME_HEALTH_STATES.RECOVERING;
    return Object.freeze({ ...record, metadata: { ...metadata } });
  }

  return {
    nextFrame() { frame += 1; return frame; },
    capture,
    success,
    canRun(name) {
      const record = stateFor(name);
      return record.state !== RUNTIME_HEALTH_STATES.FAILED || frame >= record.nextRecoveryFrame;
    },
    status(name) { const record = stateFor(name); return Object.freeze({ ...record, errors: record.errors.slice(-4) }); },
    allStatuses() { return Object.freeze([...records.values()].map((record) => Object.freeze({ ...record, errors: record.errors.slice(-4) }))); },
    reset(name = null) {
      if (name == null) records.clear();
      else records.delete(key(name));
      frame = 0;
    },
    dispose() { disposed = true; records.clear(); },
  };
}

export async function runContained(name, operation, controller, recovery = null, metadata = {}) {
  if (!controller.canRun(name)) return Object.freeze({ ok: false, skipped: true, reason: 'failed-open-circuit', value: null });
  try {
    const value = await operation();
    controller.success(name, metadata);
    return Object.freeze({ ok: true, skipped: false, value });
  } catch (error) {
    controller.capture(name, error, metadata);
    let recovered = false;
    if (typeof recovery === 'function') {
      try { await recovery(error); recovered = true; } catch (recoveryError) { controller.capture(`${name}:recovery`, recoveryError, metadata); }
    }
    return Object.freeze({ ok: false, skipped: false, recovered, error: normalizeRuntimeError(error), value: null });
  }
}

export function createFallbackLatch({ initial = true } = {}) {
  let enabled = Boolean(initial);
  return { isEnabled() { return enabled; }, disable() { enabled = false; }, enable() { enabled = true; }, reset() { enabled = Boolean(initial); } };
}

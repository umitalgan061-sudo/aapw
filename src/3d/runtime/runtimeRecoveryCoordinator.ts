// @ts-nocheck
/**
 * Graceful runtime recovery coordinator.
 *
 * Coordinates bounded recovery actions after context loss, asset failures, persistence faults or
 * repeated frame stalls. It emits intents only; it never rebuilds a renderer or mutates gameplay.
 */

import { clamp, finiteOr, integerOr, createDisposer } from './modernRuntimeContract.js';

export const RECOVERY_REASONS = Object.freeze([
  'renderer-context-lost',
  'renderer-init-failed',
  'asset-load-failed',
  'persistence-failed',
  'frame-stall',
  'memory-pressure',
  'unknown',
]);

const RECOVERY_LEVELS = Object.freeze(['observe', 'soft', 'hard', 'terminal']);

function normalizeReason(reason) {
  return RECOVERY_REASONS.includes(reason) ? reason : 'unknown';
}

function chooseLevel(reason, failures) {
  if (failures >= 5) return 'terminal';
  if (reason === 'renderer-context-lost' || reason === 'renderer-init-failed') return failures >= 2 ? 'hard' : 'soft';
  if (reason === 'memory-pressure') return failures >= 3 ? 'hard' : 'soft';
  if (reason === 'persistence-failed') return failures >= 2 ? 'hard' : 'soft';
  return failures >= 3 ? 'hard' : 'observe';
}

export function createRuntimeRecoveryCoordinator(options = {}) {
  const maxAttempts = clamp(integerOr(options.maxAttempts, 5), 1, 20);
  const cooldownMs = clamp(finiteOr(options.cooldownMs, 2500), 100, 60000);
  const resetAfterMs = clamp(finiteOr(options.resetAfterMs, 30000), cooldownMs, 300000);
  const dispose = createDisposer();
  const attempts = new Map();
  const lastAttempt = new Map();
  const history = [];
  let active = false;
  let sequence = 0;
  let lastActivityMs = 0;

  function count(reason) { return attempts.get(reason) || 0; }

  function record(reason, timestampMs, metadata = {}) {
    const safeReason = normalizeReason(reason);
    const now = Math.max(0, finiteOr(timestampMs, lastActivityMs));
    lastActivityMs = Math.max(lastActivityMs, now);
    const current = count(safeReason);
    const previous = lastAttempt.get(safeReason);
    if (previous != null && now - previous < cooldownMs) {
      return Object.freeze({ accepted: false, reason: safeReason, level: 'observe', attempts: current, cooldownRemainingMs: cooldownMs - (now - previous) });
    }
    const next = current + 1;
    attempts.set(safeReason, next);
    lastAttempt.set(safeReason, now);
    const level = chooseLevel(safeReason, next);
    const intent = Object.freeze({
      sequence: sequence++,
      accepted: true,
      reason: safeReason,
      level,
      attempts: next,
      timestampMs: now,
      metadata: Object.freeze({ ...metadata }),
    });
    history.push(intent);
    if (history.length > 128) history.shift();
    active = level !== 'observe';
    return intent;
  }

  function acknowledge(reason, timestampMs = lastActivityMs) {
    const safeReason = normalizeReason(reason);
    const now = Math.max(0, finiteOr(timestampMs, lastActivityMs));
    attempts.delete(safeReason);
    lastAttempt.delete(safeReason);
    if (now - lastActivityMs >= resetAfterMs) active = false;
    return Object.freeze({ acknowledged: true, reason: safeReason, timestampMs: now });
  }

  function maintenance(timestampMs = lastActivityMs) {
    const now = Math.max(0, finiteOr(timestampMs, lastActivityMs));
    lastActivityMs = Math.max(lastActivityMs, now);
    for (const [reason, attemptMs] of lastAttempt.entries()) {
      if (now - attemptMs >= resetAfterMs) {
        attempts.delete(reason);
        lastAttempt.delete(reason);
      }
    }
    if (lastAttempt.size === 0) active = false;
    return Object.freeze({ active, timestampMs: now, reasons: [...lastAttempt.keys()] });
  }

  function intentFor(reason, metadata, timestampMs) {
    return record(reason, timestampMs, metadata);
  }

  function historySnapshot() {
    return Object.freeze(history.slice());
  }

  function diagnostics() {
    return Object.freeze({
      active,
      sequence,
      maxAttempts,
      cooldownMs,
      resetAfterMs,
      attempts: Object.freeze(Object.fromEntries(attempts.entries())),
      recent: historySnapshot(),
    });
  }

  function registerResetHook(callback) { return dispose.add(callback); }

  function reset() {
    attempts.clear();
    lastAttempt.clear();
    history.length = 0;
    active = false;
    sequence = 0;
    lastActivityMs = 0;
  }

  return Object.freeze({
    record,
    acknowledge,
    maintenance,
    intentFor,
    historySnapshot,
    diagnostics,
    registerResetHook,
    reset,
    get active() { return active; },
    get attempts() { return Object.fromEntries(attempts.entries()); },
  });
}

export function createRecoveryActionTable() {
  return Object.freeze({
    observe: Object.freeze(['record-telemetry', 'continue']),
    soft: Object.freeze(['shed-effects', 'reduce-quality', 'retry-bound-operation']),
    hard: Object.freeze(['reinitialize-presentation', 'clear-unpinned-assets', 'reload-save-slot']),
    terminal: Object.freeze(['stop-runtime', 'show-recovery-state', 'preserve-diagnostics']),
  });
}

export function validateRecoveryIntent(intent) {
  const problems = [];
  if (!intent || !RECOVERY_REASONS.includes(intent.reason)) problems.push('invalid recovery reason');
  if (!RECOVERY_LEVELS.includes(intent?.level)) problems.push('invalid recovery level');
  if (!Number.isInteger(intent?.attempts) || intent.attempts < 1) problems.push('invalid attempt count');
  if (!Number.isFinite(intent?.timestampMs) || intent.timestampMs < 0) problems.push('invalid timestamp');
  return Object.freeze({ valid: problems.length === 0, problems });
}

export function chooseRecoveryReason(signal = {}) {
  if (signal.contextLost) return 'renderer-context-lost';
  if (signal.rendererInitFailed) return 'renderer-init-failed';
  if (signal.assetFailure) return 'asset-load-failed';
  if (signal.persistenceFailure) return 'persistence-failed';
  if (signal.frameStall) return 'frame-stall';
  if (signal.memoryPressure) return 'memory-pressure';
  return 'unknown';
}

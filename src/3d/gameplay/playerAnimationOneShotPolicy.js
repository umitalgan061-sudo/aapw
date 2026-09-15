/**
 * Bounded one-shot animation presentation policy.
 *
 * One-shot gating is intentionally presentation-only. It does not own attack cooldowns,
 * hitboxes, stamina, combat authority or animation assets. A caller supplies the source timing
 * facts and this policy decides whether a presentation request may start, hold or finish.
 *
 * @module gameplay/playerAnimationOneShotPolicy
 */

export const PLAYER_ANIMATION_ONESHOT_POLICY_VERSION = '2026-09-15-v1';

export const PLAYER_ANIMATION_ONESHOT_LIMITS = Object.freeze({
  maxWindowSeconds: 2.5,
  minWindowSeconds: 0.03,
  minRetriggerGapSeconds: 0.08,
  maxRequestsPerWindow: 4,
  maxHistoryEntries: 32,
});

export const PLAYER_ANIMATION_ONESHOT_STATES = Object.freeze([
  'ready',
  'starting',
  'holding',
  'ending',
  'cooldown',
]);

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeAction(value) {
  return typeof value === 'string' && value.length > 0 ? value : 'none';
}

function normalizeWindow(value) {
  return clamp(finite(value, 0.5), PLAYER_ANIMATION_ONESHOT_LIMITS.minWindowSeconds, PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds);
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalRequest(request = {}) {
  return JSON.stringify({
    action: normalizeAction(request.action),
    windowSeconds: normalizeWindow(request.windowSeconds),
    priority: clamp(Math.floor(finite(request.priority, 0)), 0, 9),
    variant: typeof request.variant === 'string' ? request.variant : 'default',
  });
}

export function normalizePlayerAnimationOneShotRequest(request = {}) {
  return Object.freeze({
    action: normalizeAction(request.action),
    windowSeconds: normalizeWindow(request.windowSeconds),
    priority: clamp(Math.floor(finite(request.priority, 0)), 0, 9),
    variant: typeof request.variant === 'string' ? request.variant : 'default',
    fingerprint: stableHash(canonicalRequest(request)),
  });
}

export function createPlayerAnimationOneShotState() {
  return Object.freeze({
    phase: 'ready',
    action: 'none',
    variant: 'default',
    remainingSeconds: 0,
    elapsedSeconds: 0,
    lastRequestAtSeconds: -Infinity,
    requestsInWindow: 0,
    requestFingerprint: '',
    transitionCount: 0,
    rejectionCount: 0,
  });
}

export function validatePlayerAnimationOneShotState(state) {
  const value = state && typeof state === 'object' ? state : {};
  const failures = [];
  if (!PLAYER_ANIMATION_ONESHOT_STATES.includes(value.phase)) failures.push('phase');
  if (!Number.isFinite(value.remainingSeconds) || value.remainingSeconds < 0) failures.push('remainingSeconds');
  if (!Number.isFinite(value.elapsedSeconds) || value.elapsedSeconds < 0) failures.push('elapsedSeconds');
  if (!Number.isInteger(value.requestsInWindow) || value.requestsInWindow < 0) failures.push('requestsInWindow');
  if (!Number.isInteger(value.rejectionCount) || value.rejectionCount < 0) failures.push('rejectionCount');
  if (!Number.isInteger(value.transitionCount) || value.transitionCount < 0) failures.push('transitionCount');
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

export function resolvePlayerAnimationOneShotDecision(state, request, nowSeconds = 0) {
  const current = state && typeof state === 'object' ? state : createPlayerAnimationOneShotState();
  const normalized = normalizePlayerAnimationOneShotRequest(request);
  const now = Math.max(0, finite(nowSeconds));
  const active = current.phase !== 'ready' && current.phase !== 'cooldown';
  const gap = now - finite(current.lastRequestAtSeconds, -Infinity);
  const sameAction = current.action === normalized.action && current.variant === normalized.variant;
  const cooldownBlocked = current.phase === 'cooldown' && gap < PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds;
  const duplicateBlocked = active && sameAction && gap < PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds;
  const quotaBlocked = current.requestsInWindow >= PLAYER_ANIMATION_ONESHOT_LIMITS.maxRequestsPerWindow && gap < normalized.windowSeconds;
  if (normalized.action === 'none') {
    return Object.freeze({ accepted: false, reason: 'empty-action', request: normalized });
  }
  if (cooldownBlocked) return Object.freeze({ accepted: false, reason: 'cooldown', request: normalized });
  if (duplicateBlocked) return Object.freeze({ accepted: false, reason: 'duplicate', request: normalized });
  if (quotaBlocked && normalized.priority < 8) return Object.freeze({ accepted: false, reason: 'window-quota', request: normalized });
  if (active && normalized.priority < 4 && !sameAction) return Object.freeze({ accepted: false, reason: 'lower-priority-active', request: normalized });
  return Object.freeze({ accepted: true, reason: active ? 'priority-replace' : 'ready', request: normalized });
}

export function startPlayerAnimationOneShot(state, request, nowSeconds = 0) {
  const current = state && typeof state === 'object' ? state : createPlayerAnimationOneShotState();
  const decision = resolvePlayerAnimationOneShotDecision(current, request, nowSeconds);
  if (!decision.accepted) {
    return Object.freeze({
      state: Object.freeze({ ...current, rejectionCount: current.rejectionCount + 1 }),
      decision,
      changed: false,
    });
  }
  const next = Object.freeze({
    ...current,
    phase: 'starting',
    action: decision.request.action,
    variant: decision.request.variant,
    remainingSeconds: decision.request.windowSeconds,
    elapsedSeconds: 0,
    lastRequestAtSeconds: Math.max(0, finite(nowSeconds)),
    requestsInWindow: gapFromLastWindow(current, nowSeconds) ? 1 : current.requestsInWindow + 1,
    requestFingerprint: decision.request.fingerprint,
    transitionCount: current.transitionCount + 1,
  });
  return Object.freeze({ state: next, decision, changed: true });
}

function gapFromLastWindow(state, nowSeconds) {
  const gap = Math.max(0, finite(nowSeconds) - finite(state.lastRequestAtSeconds, -Infinity));
  return !Number.isFinite(gap) || gap >= PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds;
}

export function advancePlayerAnimationOneShot(state, deltaSeconds = 0) {
  const current = state && typeof state === 'object' ? state : createPlayerAnimationOneShotState();
  const delta = clamp(finite(deltaSeconds), 0, PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds);
  if (current.phase === 'ready') return Object.freeze({ state: current, ended: false, progressed: false });
  const remaining = Math.max(0, current.remainingSeconds - delta);
  let phase = current.phase;
  let ended = false;
  if (remaining <= 0) {
    phase = current.phase === 'cooldown' ? 'ready' : 'cooldown';
    ended = current.phase !== 'cooldown';
  } else if (current.phase === 'starting') {
    phase = 'holding';
  }
  const next = Object.freeze({
    ...current,
    phase,
    remainingSeconds: phase === 'cooldown' ? PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds : round(remaining),
    elapsedSeconds: round(current.elapsedSeconds + delta),
  });
  return Object.freeze({ state: next, ended, progressed: delta > 0 });
}

export function forceEndPlayerAnimationOneShot(state) {
  const current = state && typeof state === 'object' ? state : createPlayerAnimationOneShotState();
  if (current.phase === 'ready') return Object.freeze({ state: current, changed: false });
  return Object.freeze({
    state: Object.freeze({ ...current, phase: 'cooldown', remainingSeconds: PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds }),
    changed: true,
  });
}

export function tickPlayerAnimationOneShotController(controllerState, request = null, deltaSeconds = 0, nowSeconds = 0) {
  let state = controllerState && typeof controllerState === 'object' ? controllerState : createPlayerAnimationOneShotState();
  let decision = null;
  let started = false;
  if (request) {
    const result = startPlayerAnimationOneShot(state, request, nowSeconds);
    state = result.state;
    decision = result.decision;
    started = result.changed;
  }
  const advanced = advancePlayerAnimationOneShot(state, deltaSeconds);
  state = advanced.state;
  const validation = validatePlayerAnimationOneShotState(state);
  if (!validation.ok) throw new Error(`Invalid one-shot state: ${validation.failures.join(',')}`);
  return Object.freeze({ state, decision, started, ended: advanced.ended, validation });
}

export function createPlayerAnimationOneShotController({ onSignal = null, historyLimit = PLAYER_ANIMATION_ONESHOT_LIMITS.maxHistory } = {}) {
  let state = createPlayerAnimationOneShotState();
  let nowSeconds = 0;
  const history = [];
  const limit = clamp(Math.floor(finite(historyLimit, 32)), 1, 128);
  let sequence = 0;
  const publish = (signal) => {
    history.push(Object.freeze({ ...signal }));
    while (history.length > limit) history.shift();
    if (typeof onSignal === 'function') onSignal(signal);
  };
  const update = (deltaSeconds, request = null) => {
    const delta = Math.max(0, finite(deltaSeconds));
    nowSeconds = round(nowSeconds + delta);
    const previous = state;
    const result = tickPlayerAnimationOneShotController(state, request, delta, nowSeconds);
    state = result.state;
    if (result.started) {
      publish({ type: 'action-start', sequence: ++sequence, action: state.action, variant: state.variant, fingerprint: state.requestFingerprint, atSeconds: nowSeconds });
    }
    if (result.ended) {
      publish({ type: 'action-end', sequence: ++sequence, action: previous.action, variant: previous.variant, atSeconds: nowSeconds });
    }
    if (result.decision && !result.decision.accepted) {
      publish({ type: 'action-rejected', sequence: ++sequence, action: result.decision.request.action, reason: result.decision.reason, atSeconds: nowSeconds });
    }
    return Object.freeze({ ...result, snapshot: snapshot() });
  };
  const snapshot = () => Object.freeze({
    version: PLAYER_ANIMATION_ONESHOT_POLICY_VERSION,
    nowSeconds,
    state,
    sequence,
    history: Object.freeze(history.slice()),
  });
  const reset = () => {
    state = createPlayerAnimationOneShotState();
    nowSeconds = 0;
    sequence = 0;
    history.length = 0;
  };
  return Object.freeze({ update, snapshot, reset, readHistory: () => history.slice() });
}

export function resolvePlayerAnimationOneShotWeight(remainingSeconds, windowSeconds) {
  const total = normalizeWindow(windowSeconds);
  const remaining = clamp(finite(remainingSeconds), 0, total);
  const progress = total <= 0 ? 1 : 1 - remaining / total;
  const fadeIn = clamp(progress / 0.12, 0, 1);
  const fadeOut = clamp(remaining / Math.max(total * 0.2, 0.04), 0, 1);
  return round(Math.min(fadeIn, fadeOut));
}

export function resolvePlayerAnimationOneShotPhase(state) {
  return PLAYER_ANIMATION_ONESHOT_STATES.includes(state?.phase) ? state.phase : 'ready';
}

export function resolvePlayerAnimationOneShotFingerprint(request) {
  return normalizePlayerAnimationOneShotRequest(request).fingerprint;
}

export function isPlayerAnimationOneShotActive(state) {
  const phase = resolvePlayerAnimationOneShotPhase(state);
  return phase === 'starting' || phase === 'holding' || phase === 'ending';
}

export function auditPlayerAnimationOneShotPolicy() {
  const initial = createPlayerAnimationOneShotState();
  const validation = validatePlayerAnimationOneShotState(initial);
  const request = normalizePlayerAnimationOneShotRequest({ action: 'heavy-attack', windowSeconds: 0.7, priority: 8 });
  return Object.freeze({
    version: PLAYER_ANIMATION_ONESHOT_POLICY_VERSION,
    ok: validation.ok && request.action === 'heavy-attack' && request.fingerprint.length === 8,
    validation,
    request,
    capabilities: Object.freeze(['bounded-one-shot-window', 'priority-retrigger-gate', 'deterministic-request-fingerprint', 'action-start-end-signals', 'bounded-history']),
  });
}

export const PLAYER_ANIMATION_ONESHOT_POLICY = Object.freeze({
  version: PLAYER_ANIMATION_ONESHOT_POLICY_VERSION,
  limits: PLAYER_ANIMATION_ONESHOT_LIMITS,
  states: PLAYER_ANIMATION_ONESHOT_STATES,
});

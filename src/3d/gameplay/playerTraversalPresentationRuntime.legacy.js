/**
 * Runtime facade for player traversal presentation.
 *
 * The runtime owns the presentation state machine's temporal bookkeeping while keeping all world,
 * physics, input, and renderer ownership outside this module. Callers submit immutable cue snapshots on
 * each tick. The facade turns those snapshots into a stable state, transition event, consumer projection,
 * and compact metrics record. It intentionally accepts a caller-provided clock so deterministic replays
 * never depend on wall-clock APIs.
 */
import {
  buildPlayerTraversalPresentationState,
  compareTraversalPresentationState,
  normalizePlayerTraversalPresentationCue,
  projectPlayerTraversalPresentationState,
  resolveTraversalTerminalRecovery,
} from './playerTraversalPresentationPolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_RUNTIME_VERSION = '2026-09-15-v1';

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function round(value, digits = 4) {
  const f = 10 ** digits;
  const r = Math.round(finite(value) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
function freeze(value) { return Object.freeze(value); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }

export function createPlayerTraversalPresentationRuntime(options = {}) {
  const maxHistory = Math.max(1, Math.floor(finite(options.maxHistory, 32)));
  const audio = options.audio !== false;
  const vfx = options.vfx !== false;
  const debug = options.debug !== false;
  let state = null;
  let tickIndex = 0;
  let clockSeconds = 0;
  let lastInput = null;
  let history = [];
  let transitionCount = 0;
  let terminalCount = 0;
  let recoveryCount = 0;
  let confidenceFloor = 1;
  let confidenceCeiling = 0;

  function snapshot() {
    return freeze({
      version: PLAYER_TRAVERSAL_PRESENTATION_RUNTIME_VERSION,
      tickIndex,
      clockSeconds: round(clockSeconds),
      state: state ? freeze({ ...state }) : null,
      history: freeze(history.slice()),
      metrics: freeze({
        transitionCount,
        terminalCount,
        recoveryCount,
        confidenceFloor: round(confidenceFloor),
        confidenceCeiling: round(confidenceCeiling),
        historyLength: history.length,
      }),
    });
  }

  function pushHistory(nextState) {
    const entry = freeze({
      tickIndex,
      clockSeconds: round(clockSeconds),
      state: nextState.state,
      phase: nextState.phase,
      event: nextState.event,
      confidence: nextState.confidence,
    });
    history = [...history, entry].slice(-maxHistory);
  }

  function tick(input = {}) {
    const normalized = normalizePlayerTraversalPresentationCue(input);
    const requestedClock = finite(input.clockSeconds, clockSeconds + normalized.deltaSeconds);
    clockSeconds = Math.max(clockSeconds, requestedClock);
    tickIndex += 1;
    lastInput = normalized;
    const previous = state;
    const next = buildPlayerTraversalPresentationState(previous, {
      ...normalized,
      elapsedSeconds: Math.max(0, clockSeconds - (previous?.startClockSeconds ?? 0)),
    });
    if (!compareTraversalPresentationState(previous, next)) transitionCount += 1;
    if (next.terminal) terminalCount += 1;
    if (resolveTraversalTerminalRecovery(previous, next) !== 'none') recoveryCount += 1;
    confidenceFloor = Math.min(confidenceFloor, next.confidence);
    confidenceCeiling = Math.max(confidenceCeiling, next.confidence);
    state = freeze({
      ...next,
      startClockSeconds: previous?.state === next.state ? previous.startClockSeconds : clockSeconds,
    });
    pushHistory(state);
    const projection = projectPlayerTraversalPresentationState(state, { audio, vfx, debug });
    return freeze({
      state,
      projection,
      changed: !compareTraversalPresentationState(previous, state),
      tickIndex,
      clockSeconds: round(clockSeconds),
    });
  }

  function reset(reason = 'caller-reset') {
    state = null;
    tickIndex = 0;
    clockSeconds = 0;
    lastInput = null;
    history = [];
    transitionCount = 0;
    terminalCount = 0;
    recoveryCount = 0;
    confidenceFloor = 1;
    confidenceCeiling = 0;
    return freeze({ version: PLAYER_TRAVERSAL_PRESENTATION_RUNTIME_VERSION, reset: true, reason });
  }

  function hydrate(snapshotInput = {}) {
    const nextState = snapshotInput.state;
    if (nextState && typeof nextState === 'object' && typeof nextState.state === 'string') {
      state = freeze({ ...nextState });
    } else {
      state = null;
    }
    tickIndex = Math.max(0, Math.floor(finite(snapshotInput.tickIndex)));
    clockSeconds = Math.max(0, finite(snapshotInput.clockSeconds));
    history = Array.isArray(snapshotInput.history) ? snapshotInput.history.slice(-maxHistory).map((entry) => freeze({ ...entry })) : [];
    const metrics = snapshotInput.metrics ?? {};
    transitionCount = Math.max(0, Math.floor(finite(metrics.transitionCount)));
    terminalCount = Math.max(0, Math.floor(finite(metrics.terminalCount)));
    recoveryCount = Math.max(0, Math.floor(finite(metrics.recoveryCount)));
    confidenceFloor = clamp01(metrics.confidenceFloor ?? 1);
    confidenceCeiling = clamp01(metrics.confidenceCeiling ?? 0);
    return snapshot();
  }

  function seek(seconds) {
    clockSeconds = Math.max(0, finite(seconds));
    return snapshot();
  }

  function current() { return state; }
  function metrics() { return snapshot().metrics; }
  function getLastInput() { return lastInput; }
  function historyEntries() { return freeze(history.slice()); }

  function consume(input = {}) {
    return tick({ ...input, clockSeconds: finite(input.clockSeconds, clockSeconds + finite(input.deltaSeconds, 1 / 60)) });
  }

  return freeze({ tick, consume, reset, hydrate, seek, current, metrics, snapshot, getLastInput, historyEntries });
}

export function summarizePlayerTraversalRuntime(runtime) {
  const snapshot = runtime?.snapshot?.() ?? {};
  const state = snapshot.state ?? {};
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_RUNTIME_VERSION,
    tickIndex: snapshot.tickIndex ?? 0,
    clockSeconds: round(snapshot.clockSeconds),
    state: text(state.state, 'clear'),
    phase: text(state.phase, 'idle'),
    event: text(state.event, 'none'),
    confidence: round(clamp01(state.confidence)),
    transitions: snapshot.metrics?.transitionCount ?? 0,
    terminals: snapshot.metrics?.terminalCount ?? 0,
  });
}

export function replayPlayerTraversalRuntime(runtime, records = []) {
  const outputs = [];
  for (const record of records) outputs.push(runtime.tick(record));
  return freeze(outputs);
}

export function comparePlayerTraversalRuntimeSnapshots(left = {}, right = {}) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createPlayerTraversalRuntimeSeedSnapshot(runtime) {
  const snapshot = runtime.snapshot();
  return freeze({
    version: snapshot.version,
    tickIndex: snapshot.tickIndex,
    clockSeconds: snapshot.clockSeconds,
    state: snapshot.state,
  });
}

export function validatePlayerTraversalRuntime(runtime) {
  const snapshot = runtime.snapshot();
  const errors = [];
  if (snapshot.tickIndex < 0) errors.push('negative tick index');
  if (snapshot.clockSeconds < 0) errors.push('negative clock');
  if (snapshot.metrics.confidenceFloor < 0 || snapshot.metrics.confidenceFloor > 1) errors.push('confidence floor out of range');
  if (snapshot.metrics.confidenceCeiling < 0 || snapshot.metrics.confidenceCeiling > 1) errors.push('confidence ceiling out of range');
  if (snapshot.metrics.confidenceFloor > snapshot.metrics.confidenceCeiling && snapshot.tickIndex > 0) errors.push('confidence bounds inverted');
  return freeze({ valid: errors.length === 0, errors: freeze(errors), snapshot });
}

export function getPlayerTraversalRuntimeHealth(runtime) {
  const validation = validatePlayerTraversalRuntime(runtime);
  return freeze({ healthy: validation.valid, errors: validation.errors, metrics: runtime.metrics() });
}

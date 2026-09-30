/**
 * Deterministic temporal policy layer for player animation presentation.
 *
 * Ownership boundary:
 * - player.js remains the owner of movement and combat state.
 * - playerAnimationDirector remains the semantic/action resolver.
 * - this module owns only presentation-time normalization, event gating and observability.
 *
 * No THREE, EventBus, ActorRegistry, scene, collider or model-placement imports belong here.
 *
 * @module gameplay/playerAnimationTemporalPolicy
 */

import { resolvePlayerAnimationTransition } from './playerAnimationDirector.js';

export const PLAYER_ANIMATION_TEMPORAL_POLICY_VERSION = '2026-09-15-v1';

export const PLAYER_ANIMATION_TEMPORAL_LIMITS = Object.freeze({
  maxDeltaSeconds: 0.1,
  maxCatchUpSeconds: 0.24,
  maxCatchUpSteps: 4,
  maxHistory: 48,
  maxSignalsPerUpdate: 8,
  minFootstepIntervalSeconds: 0.12,
  maxFootstepIntervalSeconds: 1.4,
  maxRate: 1.6,
  minRate: 0.5,
  sprintEnterSpeedMps: 5.6,
  sprintExitSpeedMps: 5.1,
  locomotionSpeedMps: 0.15,
});

export const PLAYER_ANIMATION_TEMPORAL_SIGNAL_TYPES = Object.freeze([
  'transition',
  'footstep',
  'action-start',
  'action-end',
  'surface-change',
  'presentation-warning',
]);

const SEMANTICS = new Set([
  'idle',
  'locomotion',
  'sprint',
  'guard',
  'light-attack',
  'heavy-attack',
  'dodge',
  'hit-stagger',
]);

const COMBAT_SEMANTICS = new Set(['light-attack', 'heavy-attack', 'dodge', 'hit-stagger']);

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

function normalizePhase(value) {
  let phase = finite(value);
  phase %= 1;
  if (phase < 0) phase += 1;
  return round(phase);
}

function normalizeSemantic(value) {
  return SEMANTICS.has(value) ? value : 'idle';
}

function normalizeSurface(input = {}) {
  const key = typeof input.materialKey === 'string' && input.materialKey.length > 0
    ? input.materialKey
    : 'generic';
  return Object.freeze({
    materialKey: key,
    confidence: round(clamp(finite(input.confidence, 1), 0, 1)),
    slip: round(clamp(finite(input.slip, 0), 0, 1)),
    muted: input.muted === true,
    source: typeof input.source === 'string' ? input.source : 'unknown',
  });
}

function normalizeInput(input = {}) {
  return Object.freeze({
    planarSpeedMps: round(Math.max(0, finite(input.planarSpeedMps)), 3),
    runIntent: input.runIntent === true,
    attackKind: typeof input.attackKind === 'string' ? input.attackKind : 'none',
    guarding: input.guarding === true,
    dodgeRemaining: Math.max(0, finite(input.dodgeRemaining)),
    hitStaggerRemaining: Math.max(0, finite(input.hitStaggerRemaining)),
    movementState: typeof input.movementState === 'string' ? input.movementState : 'idle',
    phase: normalizePhase(input.phase),
    phaseScale: clamp(finite(input.phaseScale, 1), 0, 2),
    baseRate: clamp(finite(input.baseRate, 1), PLAYER_ANIMATION_TEMPORAL_LIMITS.minRate, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxRate),
    environmentRateScale: clamp(finite(input.environmentRateScale, 1), 0.65, 1.35),
    strideMeters: clamp(finite(input.strideMeters, 2.05), 0.4, 4),
    sprintStrideScale: clamp(finite(input.sprintStrideScale, 1.22), 0.8, 1.6),
    surface: normalizeSurface(input.surface),
  });
}

function isLocomotion(state) {
  return state === 'locomotion' || state === 'sprint';
}

function resolveStrideSeconds(semantic, speedMps, strideMeters, sprintStrideScale) {
  if (!isLocomotion(semantic) || speedMps < PLAYER_ANIMATION_TEMPORAL_LIMITS.locomotionSpeedMps) return null;
  const scale = semantic === 'sprint' ? sprintStrideScale : 1;
  return round(clamp((strideMeters * scale) / Math.max(speedMps, 0.15), 0.18, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxFootstepIntervalSeconds));
}

function resolvePlaybackRate(semantic, speedMps, baseRate, environmentRateScale) {
  let rate = baseRate;
  if (semantic === 'locomotion') rate *= clamp(speedMps / 3.2, 0.75, 1.2);
  if (semantic === 'sprint') rate *= clamp(speedMps / 6.5, 0.9, 1.35);
  if (semantic === 'dodge') rate *= 1.45;
  if (COMBAT_SEMANTICS.has(semantic) && semantic !== 'dodge') rate *= 1.05;
  rate *= environmentRateScale;
  return round(clamp(rate, PLAYER_ANIMATION_TEMPORAL_LIMITS.minRate, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxRate));
}

function phaseCrossed(previous, next, target) {
  const a = normalizePhase(previous);
  const b = normalizePhase(next);
  const t = normalizePhase(target);
  if (a <= b) return t > a && t <= b;
  return t > a || t <= b;
}

function phaseAdvance(phase, deltaSeconds, semantic, speedMps, strideMeters, sprintStrideScale, playbackRate, phaseScale) {
  const strideSeconds = resolveStrideSeconds(semantic, speedMps, strideMeters, sprintStrideScale);
  if (strideSeconds === null) {
    return Object.freeze({ phase: semantic === 'idle' ? 0 : normalizePhase(phase), advance: 0, strideSeconds: null });
  }
  const advance = (deltaSeconds * playbackRate * phaseScale) / strideSeconds;
  return Object.freeze({ phase: normalizePhase(phase + advance), advance: round(advance), strideSeconds });
}

function transitionReason(previous, next, input) {
  if (previous === next) {
    if (next === 'sprint') return input.runIntent ? 'run-intent-held' : 'sprint-hysteresis-held';
    return 'state-held';
  }
  if (next === 'sprint') return 'sprint-enter';
  if (previous === 'sprint') return 'sprint-exit';
  if (COMBAT_SEMANTICS.has(next)) return `combat-${next}`;
  if (next === 'locomotion') return 'locomotion-enter';
  if (next === 'idle') return 'idle-enter';
  return 'state-transition';
}

function createSequence() {
  let value = 0;
  return Object.freeze({
    next() {
      value += 1;
      return value;
    },
    read() {
      return value;
    },
    reset() {
      value = 0;
    },
  });
}

function cloneState(state) {
  return {
    semanticState: normalizeSemantic(state.semanticState),
    previousSemanticState: normalizeSemantic(state.previousSemanticState),
    phase: normalizePhase(state.phase),
    elapsedSeconds: Math.max(0, finite(state.elapsedSeconds)),
    frameCount: Math.max(0, Math.floor(finite(state.frameCount))),
    transitionCount: Math.max(0, Math.floor(finite(state.transitionCount))),
    footstepCount: Math.max(0, Math.floor(finite(state.footstepCount))),
    lastFootstepAtSeconds: finite(state.lastFootstepAtSeconds, -Infinity),
    playbackRate: clamp(finite(state.playbackRate, 1), PLAYER_ANIMATION_TEMPORAL_LIMITS.minRate, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxRate),
    surface: normalizeSurface(state.surface),
    transitionReason: typeof state.transitionReason === 'string' ? state.transitionReason : 'initial',
    lastInput: normalizeInput(state.lastInput),
  };
}

export function createPlayerAnimationTemporalInitialState() {
  return Object.freeze({
    semanticState: 'idle',
    previousSemanticState: 'idle',
    phase: 0,
    elapsedSeconds: 0,
    frameCount: 0,
    transitionCount: 0,
    footstepCount: 0,
    lastFootstepAtSeconds: -Infinity,
    playbackRate: 1,
    surface: normalizeSurface(),
    transitionReason: 'initial',
    lastInput: normalizeInput(),
  });
}

export function resolvePlayerAnimationTemporalTransition(input = {}, previousState = createPlayerAnimationTemporalInitialState()) {
  const normalized = normalizeInput(input);
  const previousSemanticState = normalizeSemantic(previousState.semanticState);
  const semanticState = resolvePlayerAnimationTransition({
    previousSemanticState,
    planarSpeedMps: normalized.planarSpeedMps,
    runIntent: normalized.runIntent,
    attackKind: normalized.attackKind,
    guarding: normalized.guarding,
    dodgeRemaining: normalized.dodgeRemaining,
    hitStaggerRemaining: normalized.hitStaggerRemaining,
    sprintEnterSpeedMps: PLAYER_ANIMATION_TEMPORAL_LIMITS.sprintEnterSpeedMps,
    sprintExitSpeedMps: PLAYER_ANIMATION_TEMPORAL_LIMITS.sprintExitSpeedMps,
  });
  const playbackRate = resolvePlaybackRate(
    semanticState,
    normalized.planarSpeedMps,
    normalized.baseRate,
    normalized.environmentRateScale,
  );
  return Object.freeze({
    ...cloneState(previousState),
    semanticState,
    previousSemanticState,
    playbackRate,
    surface: normalized.surface,
    transitionReason: transitionReason(previousSemanticState, semanticState, normalized),
    lastInput: normalized,
  });
}

export function resolvePlayerAnimationTemporalStep(state, input = {}, deltaSeconds = 0) {
  const current = resolvePlayerAnimationTemporalTransition(input, state);
  const delta = clamp(finite(deltaSeconds), 0, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxDeltaSeconds);
  const previousPhase = normalizePhase(current.phase);
  const nextPhase = phaseAdvance(
    previousPhase,
    delta,
    current.semanticState,
    current.lastInput.planarSpeedMps,
    current.lastInput.strideMeters,
    current.lastInput.sprintStrideScale,
    current.playbackRate,
    current.lastInput.phaseScale,
  );
  const crossedLeft = nextPhase.strideSeconds !== null && phaseCrossed(previousPhase, nextPhase.phase, 0.08);
  const crossedRight = nextPhase.strideSeconds !== null && phaseCrossed(previousPhase, nextPhase.phase, 0.58);
  const next = Object.freeze({
    ...current,
    phase: nextPhase.phase,
    elapsedSeconds: round(current.elapsedSeconds + delta),
    frameCount: current.frameCount + 1,
    transitionCount: current.transitionCount + (current.semanticState === current.previousSemanticState ? 0 : 1),
    footstepCount: current.footstepCount + (crossedLeft ? 1 : 0) + (crossedRight ? 1 : 0),
    lastFootstepAtSeconds: (crossedLeft || crossedRight) ? round(current.elapsedSeconds + delta) : current.lastFootstepAtSeconds,
  });
  return Object.freeze({
    state: next,
    phaseAdvance: nextPhase.advance,
    strideSeconds: nextPhase.strideSeconds,
    footsteps: Object.freeze([
      ...(crossedLeft ? ['left'] : []),
      ...(crossedRight ? ['right'] : []),
    ]),
  });
}

export function validatePlayerAnimationTemporalState(state) {
  const value = state && typeof state === 'object' ? state : {};
  const failures = [];
  if (!SEMANTICS.has(value.semanticState)) failures.push('semanticState');
  if (!SEMANTICS.has(value.previousSemanticState)) failures.push('previousSemanticState');
  if (!Number.isFinite(value.phase) || value.phase < 0 || value.phase >= 1) failures.push('phase');
  if (!Number.isFinite(value.elapsedSeconds) || value.elapsedSeconds < 0) failures.push('elapsedSeconds');
  if (!Number.isInteger(value.frameCount) || value.frameCount < 0) failures.push('frameCount');
  if (!Number.isInteger(value.transitionCount) || value.transitionCount < 0) failures.push('transitionCount');
  if (!Number.isInteger(value.footstepCount) || value.footstepCount < 0) failures.push('footstepCount');
  if (!Number.isFinite(value.playbackRate) || value.playbackRate < PLAYER_ANIMATION_TEMPORAL_LIMITS.minRate || value.playbackRate > PLAYER_ANIMATION_TEMPORAL_LIMITS.maxRate) failures.push('playbackRate');
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

function createRing(limit) {
  const entries = [];
  return Object.freeze({
    push(value) {
      entries.push(Object.freeze({ ...value }));
      while (entries.length > limit) entries.shift();
    },
    read() {
      return entries.slice();
    },
    clear() {
      entries.length = 0;
    },
  });
}

function createFingerprint(value) {
  const stable = JSON.stringify({
    semanticState: value.semanticState,
    previousSemanticState: value.previousSemanticState,
    phase: value.phase,
    playbackRate: value.playbackRate,
    footstepCount: value.footstepCount,
    surface: value.surface,
    transitionReason: value.transitionReason,
  });
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function shouldEmitFootstep(state) {
  if (!isLocomotion(state.semanticState)) return false;
  if (state.surface.muted) return false;
  if (state.surface.confidence < 0.2) return false;
  return true;
}

function buildSignals(result, previousState, sequence) {
  const signals = [];
  if (result.state.semanticState !== previousState.semanticState) {
    signals.push({
      type: 'transition',
      sequence: sequence.next(),
      from: previousState.semanticState,
      to: result.state.semanticState,
      reason: result.state.transitionReason,
      atSeconds: result.state.elapsedSeconds,
    });
  }
  if (result.state.surface.materialKey !== previousState.surface.materialKey) {
    signals.push({
      type: 'surface-change',
      sequence: sequence.next(),
      from: previousState.surface.materialKey,
      to: result.state.surface.materialKey,
      confidence: result.state.surface.confidence,
      atSeconds: result.state.elapsedSeconds,
    });
  }
  if (result.state.semanticState !== previousState.semanticState && COMBAT_SEMANTICS.has(result.state.semanticState)) {
    signals.push({
      type: 'action-start',
      sequence: sequence.next(),
      semanticState: result.state.semanticState,
      atSeconds: result.state.elapsedSeconds,
    });
  }
  if (previousState.semanticState !== result.state.semanticState && COMBAT_SEMANTICS.has(previousState.semanticState)) {
    signals.push({
      type: 'action-end',
      sequence: sequence.next(),
      semanticState: previousState.semanticState,
      atSeconds: result.state.elapsedSeconds,
    });
  }
  if (shouldEmitFootstep(result.state)) {
    for (const foot of result.footsteps) {
      signals.push({
        type: 'footstep',
        sequence: sequence.next(),
        foot,
        phase: result.state.phase,
        materialKey: result.state.surface.materialKey,
        intensity: round(clamp(0.35 + result.state.surface.confidence * 0.5 + (1 - result.state.surface.slip) * 0.15, 0, 1)),
        atSeconds: result.state.elapsedSeconds,
      });
    }
  }
  return signals.slice(0, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxSignalsPerUpdate).map((signal) => Object.freeze(signal));
}

export function createPlayerAnimationTemporalController({
  emitSignal = null,
  maxHistory = PLAYER_ANIMATION_TEMPORAL_LIMITS.maxHistory,
} = {}) {
  let state = createPlayerAnimationTemporalInitialState();
  let accumulatorSeconds = 0;
  const sequence = createSequence();
  const history = createRing(clamp(Math.floor(finite(maxHistory, 48)), 1, 128));
  let lastFingerprint = '';

  const publish = (signal) => {
    history.push(signal);
    if (typeof emitSignal === 'function') emitSignal(signal);
  };

  const snapshot = () => {
    const output = Object.freeze({
      version: PLAYER_ANIMATION_TEMPORAL_POLICY_VERSION,
      state,
      accumulatorSeconds: round(accumulatorSeconds),
      sequence: sequence.read(),
      history: history.read(),
    });
    lastFingerprint = createFingerprint(output.state);
    return Object.freeze({ ...output, fingerprint: lastFingerprint });
  };

  const update = (deltaSeconds, input = {}) => {
    const requested = clamp(finite(deltaSeconds), 0, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds);
    accumulatorSeconds = clamp(
      accumulatorSeconds + requested,
      0,
      PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds,
    );
    const fixed = PLAYER_ANIMATION_TEMPORAL_LIMITS.maxDeltaSeconds;
    const steps = Math.min(
      PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSteps,
      Math.max(1, Math.ceil(accumulatorSeconds / fixed)),
    );
    const stepDelta = accumulatorSeconds / steps;
    const previous = state;
    let emitted = [];
    for (let index = 0; index < steps; index += 1) {
      const result = resolvePlayerAnimationTemporalStep(state, input, stepDelta);
      state = result.state;
      accumulatorSeconds = Math.max(0, accumulatorSeconds - stepDelta);
      const signals = buildSignals(result, index === 0 ? previous : result.state, sequence);
      emitted = emitted.concat(signals);
      for (const signal of signals) publish(signal);
    }
    const validation = validatePlayerAnimationTemporalState(state);
    if (!validation.ok) throw new Error(`Invalid player animation temporal state: ${validation.failures.join(',')}`);
    return Object.freeze({
      state,
      signals: Object.freeze(emitted),
      steps,
      validation,
      snapshot: snapshot(),
    });
  };

  const reset = () => {
    state = createPlayerAnimationTemporalInitialState();
    accumulatorSeconds = 0;
    history.clear();
    sequence.reset();
    lastFingerprint = '';
  };

  return Object.freeze({
    update,
    snapshot,
    reset,
    readHistory: () => history.read(),
    readFingerprint: () => lastFingerprint,
  });
}

export function resolvePlayerAnimationSignalBudget(signals = [], limit = PLAYER_ANIMATION_TEMPORAL_LIMITS.maxSignalsPerUpdate) {
  const input = Array.isArray(signals) ? signals : [];
  const max = clamp(Math.floor(finite(limit, 8)), 0, 64);
  const priority = new Map([
    ['presentation-warning', 6],
    ['transition', 5],
    ['action-start', 4],
    ['action-end', 3],
    ['footstep', 2],
    ['surface-change', 1],
  ]);
  return Object.freeze(input
    .map((signal, index) => ({ signal, index, score: priority.get(signal?.type) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map(({ signal }) => Object.freeze({ ...signal })));
}

export function resolvePlayerAnimationSurfacePresentation(surface = {}) {
  const normalized = normalizeSurface(surface);
  const muted = normalized.muted || normalized.confidence < 0.2;
  return Object.freeze({
    ...normalized,
    muted,
    footstepGain: muted ? 0 : round(clamp(0.25 + normalized.confidence * 0.6 + (1 - normalized.slip) * 0.15, 0, 1)),
    playbackScale: round(clamp(1 - normalized.slip * 0.2, 0.8, 1.05)),
  });
}

export function resolvePlayerAnimationPhaseWindow(previous, next, target, tolerance = 0) {
  const a = normalizePhase(previous);
  const b = normalizePhase(next);
  const t = normalizePhase(target);
  const safeTolerance = clamp(finite(tolerance), 0, 0.25);
  if (Math.abs(a - t) <= safeTolerance || Math.abs(b - t) <= safeTolerance) return true;
  return a <= b ? t > a && t <= b : t > a || t <= b;
}

export function resolvePlayerAnimationTemporalBudget(deltaSeconds = 0) {
  const requested = Math.max(0, finite(deltaSeconds));
  return Object.freeze({
    requestedSeconds: round(requested),
    clampedSeconds: round(clamp(requested, 0, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds)),
    maxSteps: PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSteps,
    fixedStep: PLAYER_ANIMATION_TEMPORAL_LIMITS.maxDeltaSeconds,
    catchUpLimited: requested > PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds,
  });
}

export function getPlayerAnimationTemporalCapabilities() {
  return Object.freeze([
    'bounded-fixed-step',
    'sprint-hysteresis',
    'temporal-footstep-phase',
    'surface-aware-signal-gating',
    'combat-action-start-end-signals',
    'deterministic-snapshot-fingerprint',
    'bounded-signal-budget',
    'presentation-only-ownership',
  ]);
}

export function getPlayerAnimationTemporalLimits() {
  return Object.freeze({
    ...PLAYER_ANIMATION_TEMPORAL_LIMITS,
  });
}

export function isPlayerAnimationTemporalSignal(value) {
  return PLAYER_ANIMATION_TEMPORAL_SIGNAL_TYPES.includes(value);
}

export function isPlayerAnimationCombatSemantic(value) {
  return COMBAT_SEMANTICS.has(normalizeSemantic(value));
}

export function isPlayerAnimationLocomotionSemantic(value) {
  return isLocomotion(normalizeSemantic(value));
}

export function createPlayerAnimationTemporalScenario(samples = []) {
  const controller = createPlayerAnimationTemporalController();
  const outputs = [];
  const list = Array.isArray(samples) ? samples.slice(0, 256) : [];
  for (const sample of list) {
    outputs.push(controller.update(finite(sample?.deltaSeconds), sample?.input ?? {}));
  }
  const final = outputs.at(-1)?.snapshot ?? controller.snapshot();
  return Object.freeze({
    count: outputs.length,
    fingerprint: final.fingerprint,
    finalState: final.state.semanticState,
    frameCount: final.state.frameCount,
    transitionCount: final.state.transitionCount,
    footstepCount: final.state.footstepCount,
    signals: outputs.flatMap((output) => output.signals),
  });
}

export function comparePlayerAnimationTemporalScenarios(first = [], second = []) {
  const a = createPlayerAnimationTemporalScenario(first);
  const b = createPlayerAnimationTemporalScenario(second);
  return Object.freeze({
    equal: a.fingerprint === b.fingerprint,
    first: a,
    second: b,
  });
}

export function buildPlayerAnimationTemporalWarning(state, input = {}) {
  const warnings = [];
  const value = state && typeof state === 'object' ? state : {};
  if (!validatePlayerAnimationTemporalState(value).ok) warnings.push('invalid-state');
  if (!Number.isFinite(Number(input.planarSpeedMps))) warnings.push('malformed-speed');
  if (input.surface && Number.isFinite(Number(input.surface.confidence)) && Number(input.surface.confidence) < 0) warnings.push('invalid-surface-confidence');
  if (finite(input.deltaSeconds, 0) > PLAYER_ANIMATION_TEMPORAL_LIMITS.maxCatchUpSeconds) warnings.push('delta-clamped');
  return Object.freeze({
    type: 'presentation-warning',
    warnings: Object.freeze([...new Set(warnings)]),
    count: new Set(warnings).size,
  });
}

export function auditPlayerAnimationTemporalPolicy() {
  const initial = createPlayerAnimationTemporalInitialState();
  const validation = validatePlayerAnimationTemporalState(initial);
  const budget = resolvePlayerAnimationTemporalBudget(999);
  return Object.freeze({
    version: PLAYER_ANIMATION_TEMPORAL_POLICY_VERSION,
    ok: validation.ok && budget.catchUpLimited,
    validation,
    budget,
    capabilities: getPlayerAnimationTemporalCapabilities(),
  });
}

export function normalizePlayerAnimationTemporalInput(input = {}) {
  return normalizeInput(input);
}

export function normalizePlayerAnimationTemporalPhase(value) {
  return normalizePhase(value);
}

export function resolvePlayerAnimationTemporalPlaybackRate({
  semanticState = 'idle',
  planarSpeedMps = 0,
  baseRate = 1,
  environmentRateScale = 1,
} = {}) {
  return resolvePlaybackRate(
    normalizeSemantic(semanticState),
    Math.max(0, finite(planarSpeedMps)),
    clamp(finite(baseRate, 1), PLAYER_ANIMATION_TEMPORAL_LIMITS.minRate, PLAYER_ANIMATION_TEMPORAL_LIMITS.maxRate),
    clamp(finite(environmentRateScale, 1), 0.65, 1.35),
  );
}

export function resolvePlayerAnimationTemporalStride({
  semanticState = 'idle',
  planarSpeedMps = 0,
  strideMeters = 2.05,
  sprintStrideScale = 1.22,
} = {}) {
  return resolveStrideSeconds(
    normalizeSemantic(semanticState),
    Math.max(0, finite(planarSpeedMps)),
    clamp(finite(strideMeters, 2.05), 0.4, 4),
    clamp(finite(sprintStrideScale, 1.22), 0.8, 1.6),
  );
}

export function resolvePlayerAnimationTemporalFingerprint(state) {
  return createFingerprint(state && typeof state === 'object' ? state : createPlayerAnimationTemporalInitialState());
}

export function resolvePlayerAnimationTemporalTransitionReason(previous, next, input = {}) {
  return transitionReason(normalizeSemantic(previous), normalizeSemantic(next), normalizeInput(input));
}

export function createPlayerAnimationTemporalReadModel(controller) {
  if (!controller || typeof controller.snapshot !== 'function') {
    return Object.freeze({ available: false, fingerprint: '', history: Object.freeze([]) });
  }
  const snapshot = controller.snapshot();
  return Object.freeze({
    available: true,
    fingerprint: snapshot.fingerprint,
    semanticState: snapshot.state.semanticState,
    phase: snapshot.state.phase,
    playbackRate: snapshot.state.playbackRate,
    frameCount: snapshot.state.frameCount,
    transitionCount: snapshot.state.transitionCount,
    footstepCount: snapshot.state.footstepCount,
    history: Object.freeze(snapshot.history),
  });
}

export function assertPlayerAnimationTemporalOwnership(source = '') {
  const text = String(source);
  const forbidden = [
    "from 'three'",
    "from \"three\"",
    'EventBus',
    'ActorRegistry',
    'EditorMaterialStudio',
    'WorldAssetPlacementPipeline',
    'MaterialAssignmentCore',
  ];
  const violations = forbidden.filter((token) => text.includes(token));
  return Object.freeze({ ok: violations.length === 0, violations: Object.freeze(violations) });
}

export const PLAYER_ANIMATION_TEMPORAL_POLICY = Object.freeze({
  version: PLAYER_ANIMATION_TEMPORAL_POLICY_VERSION,
  limits: PLAYER_ANIMATION_TEMPORAL_LIMITS,
  signalTypes: PLAYER_ANIMATION_TEMPORAL_SIGNAL_TYPES,
  capabilities: getPlayerAnimationTemporalCapabilities(),
});

/**
 * Deterministic transition policy over the existing player combat/locomotion blend output.
 *
 * This module does not own an AnimationMixer, scene objects, input, or gameplay state. It derives
 * bounded cross-fade and interruption guidance for the existing animation owner.
 *
 * @module gameplay/playerCombatAnimationTransition
 */

const MAX_FADE_SECONDS = 0.45;
const MIN_FADE_SECONDS = 0.02;
const MAX_QUEUE_DEPTH = 4;
const TERMINAL_STATES = new Set(['defeated', 'dead']);
const INTERRUPTIBLE_STATES = new Set(['idle', 'locomotion', 'guard', 'dodge', 'hit-stagger', 'recovery']);

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeState(value) {
  return String(value || 'idle').trim().toLowerCase();
}

function normalizeAction(value) {
  const action = String(value || 'idle').trim().toLowerCase();
  return action || 'idle';
}

function priorityFor(state) {
  if (state === 'defeated' || state === 'dead') return 100;
  if (state === 'hit-stagger' || state === 'guard-break') return 90;
  if (state === 'dodge' || state === 'parry') return 80;
  if (state === 'heavy-attack') return 70;
  if (state === 'light-attack' || state === 'ranged-attack' || state === 'archery') return 60;
  if (state === 'guard') return 40;
  if (state === 'locomotion') return 20;
  return 10;
}

function fadeSeconds({ fromState, toState, normalizedProgress, speedMps, defaultFadeSeconds }) {
  const progress = clamp(finite(normalizedProgress), 0, 1);
  const speed = clamp(Math.max(0, finite(speedMps)), 0, 20);
  const base = clamp(finite(defaultFadeSeconds, 0.12), MIN_FADE_SECONDS, MAX_FADE_SECONDS);
  const urgency = Math.max(priorityFor(toState) - priorityFor(fromState), 0) / 100;
  const attackTail = (toState.includes('attack') || toState === 'archery') ? (1 - progress) * 0.08 : 0;
  const locomotionDamp = toState === 'locomotion' ? Math.min(speed / 20, 0.4) * 0.08 : 0;
  return Number(clamp(base - urgency * 0.06 - attackTail + locomotionDamp, MIN_FADE_SECONDS, MAX_FADE_SECONDS).toFixed(4));
}

function freezeArray(values) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

export function resolvePlayerCombatAnimationTransition({
  fromState = 'idle',
  toState = 'idle',
  fromAction = 'idle',
  toAction = 'idle',
  normalizedProgress = 0,
  speedMps = 0,
  grounded = true,
  interrupted = false,
  queue = [],
  defaultFadeSeconds = 0.12,
} = {}) {
  const sourceState = normalizeState(fromState);
  const targetState = normalizeState(toState);
  const sourceAction = normalizeAction(fromAction);
  const targetAction = normalizeAction(toAction);
  const progress = clamp(finite(normalizedProgress), 0, 1);
  const isTerminal = TERMINAL_STATES.has(targetState);
  const canInterrupt = !isTerminal && (interrupted || INTERRUPTIBLE_STATES.has(sourceState));
  const stateChanged = sourceState !== targetState || sourceAction !== targetAction;
  const sameAction = sourceAction === targetAction;
  const targetPriority = priorityFor(targetState);
  const sourcePriority = priorityFor(sourceState);
  const hardCut = isTerminal || (canInterrupt && targetPriority - sourcePriority >= 30);
  const crossFadeSeconds = stateChanged && !hardCut
    ? fadeSeconds({ fromState: sourceState, toState: targetState, normalizedProgress: progress, speedMps, defaultFadeSeconds })
    : 0;
  const acceptedQueue = Array.isArray(queue)
    ? queue.slice(0, MAX_QUEUE_DEPTH).map((item, index) => ({
      index,
      action: normalizeAction(item?.action),
      state: normalizeState(item?.state || item?.action),
      accepted: !isTerminal && index < MAX_QUEUE_DEPTH,
    }))
    : [];

  return Object.freeze({
    fromState: sourceState,
    toState: targetState,
    fromAction: sourceAction,
    toAction: targetAction,
    normalizedProgress: Number(progress.toFixed(4)),
    grounded: Boolean(grounded),
    stateChanged,
    sameAction,
    canInterrupt,
    hardCut,
    crossFadeSeconds,
    preserveFootContact: Boolean(grounded) && !hardCut && targetState === 'locomotion',
    queue: freezeArray(acceptedQueue),
  });
}

export function validatePlayerCombatAnimationTransition(transition) {
  if (!transition || typeof transition !== 'object') return false;
  if (!Number.isFinite(transition.crossFadeSeconds) || transition.crossFadeSeconds < 0 || transition.crossFadeSeconds > MAX_FADE_SECONDS) return false;
  if (!Number.isFinite(transition.normalizedProgress) || transition.normalizedProgress < 0 || transition.normalizedProgress > 1) return false;
  if (!Array.isArray(transition.queue) || transition.queue.length > MAX_QUEUE_DEPTH) return false;
  return transition.hardCut || transition.crossFadeSeconds >= 0;
}

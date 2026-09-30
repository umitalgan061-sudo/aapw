/** Explicit transition policy used by animation consumers to blend creature states safely. */
import { CREATURE_LOCOMOTION_STATES } from './creatureLocomotionStateSynthesis.js';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp01(value) { return Math.max(0, Math.min(1, n(value))); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_TRANSITION_POLICY_VERSION = '2026-09-15-v1';

const FAMILY = Object.freeze({
  airborne: new Set(['takeoff', 'flight-climb', 'flight-cruise', 'flight-descend']),
  reactive: new Set(['approach', 'flee', 'herd-flee', 'flock-flee']),
  recovery: new Set(['landing-soft', 'landing-hard', 'reacquire-ground', 'recover', 'slip-recover', 'contact-unstable']),
});

const DIRECT = Object.freeze({
  'idle>wander': 0.18,
  'wander>approach': 0.12,
  'wander>flee': 0.10,
  'approach>flee': 0.08,
  'flee>herd-flee': 0.06,
  'flee>flock-flee': 0.06,
  'takeoff>flight-climb': 0.10,
  'flight-climb>flight-cruise': 0.16,
  'flight-cruise>flight-descend': 0.18,
  'flight-descend>landing-soft': 0.12,
  'flight-descend>landing-hard': 0.16,
  'landing-soft>reacquire-ground': 0.10,
  'landing-hard>reacquire-ground': 0.14,
});

function has(setName, state) { return FAMILY[setName].has(text(state)); }

export function classifyCreatureLocomotionState(state) {
  const name = text(state, 'idle');
  if (!CREATURE_LOCOMOTION_STATES.includes(name)) return 'fallback';
  if (has('airborne', name)) return 'airborne';
  if (has('reactive', name)) return 'reactive';
  if (has('recovery', name)) return 'recovery';
  return name === 'idle' ? 'idle' : 'ground';
}

export function resolveCreatureTransitionDuration(fromState, toState, options = {}) {
  const from = text(fromState, 'idle');
  const to = text(toState, from);
  const direct = DIRECT[`${from}>${to}`];
  const fromFamily = classifyCreatureLocomotionState(from);
  const toFamily = classifyCreatureLocomotionState(to);
  const base = direct ?? (fromFamily === toFamily ? 0.12 : fromFamily === 'reactive' || toFamily === 'reactive' ? 0.09 : 0.14);
  const speed = clamp01(options.speedRatio ?? 0.5);
  const urgency = clamp01(options.urgency ?? 0);
  const speedScale = 1 - speed * 0.2;
  const urgencyScale = 1 - urgency * 0.35;
  return round(Math.max(0.04, base * speedScale * urgencyScale));
}

export function resolveCreatureTransitionCurve(fromState, toState, options = {}) {
  const duration = resolveCreatureTransitionDuration(fromState, toState, options);
  const fromFamily = classifyCreatureLocomotionState(fromState);
  const toFamily = classifyCreatureLocomotionState(toState);
  let curve = 'smoothstep';
  if (toState === 'landing-hard') curve = 'ease-out-impact';
  else if (fromFamily === 'airborne' || toFamily === 'airborne') curve = 'airborne-crossfade';
  else if (fromFamily === 'reactive' || toFamily === 'reactive') curve = 'alert-crossfade';
  return freeze({ curve, durationSeconds: duration, familyChange: fromFamily !== toFamily });
}

export function buildCreatureTransitionPolicy(fromState, toState, options = {}) {
  const from = text(fromState, 'idle');
  const to = text(toState, from);
  const curve = resolveCreatureTransitionCurve(from, to, options);
  return freeze({
    version: CREATURE_LOCOMOTION_TRANSITION_POLICY_VERSION,
    fromState: from,
    toState: to,
    fromFamily: classifyCreatureLocomotionState(from),
    toFamily: classifyCreatureLocomotionState(to),
    durationSeconds: curve.durationSeconds,
    curve: curve.curve,
    interruptible: !['landing-hard', 'takeoff'].includes(to),
    preserveFootContact: !['takeoff', 'flight-climb', 'flight-cruise', 'flight-descend'].includes(to),
    preserveAlert: has('reactive', from) && has('reactive', to),
  });
}

export function sampleCreatureTransition(policy, elapsedSeconds) {
  const duration = Math.max(0.001, n(policy?.durationSeconds, 0.1));
  const progress = clamp01(n(elapsedSeconds) / duration);
  let value = progress;
  switch (policy?.curve) {
    case 'ease-out-impact': value = 1 - ((1 - progress) ** 3); break;
    case 'airborne-crossfade': value = progress * progress * (3 - 2 * progress); break;
    case 'alert-crossfade': value = 1 - ((1 - progress) ** 2); break;
    default: value = progress * progress * (3 - 2 * progress); break;
  }
  return round(value);
}

export function canInterruptCreatureTransition(policy, eventName) {
  if (!policy?.interruptible) return false;
  const event = text(eventName, 'none');
  return !['landing-hard', 'takeoff-enter'].includes(event);
}

export function resolveCreatureTransitionLayerWeights(policy, elapsedSeconds) {
  const progress = sampleCreatureTransition(policy, elapsedSeconds);
  return freeze({
    from: round(1 - progress),
    to: round(progress),
    progress,
    complete: progress >= 1,
  });
}

export function validateCreatureTransitionPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') return ['policy-object'];
  if (!CREATURE_LOCOMOTION_STATES.includes(policy.fromState)) errors.push('from-state');
  if (!CREATURE_LOCOMOTION_STATES.includes(policy.toState)) errors.push('to-state');
  if (!(policy.durationSeconds >= 0.04)) errors.push('duration');
  if (!text(policy.curve)) errors.push('curve');
  return errors;
}

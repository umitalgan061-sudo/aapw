/**
 * Deterministic transition budget for the existing player animation runtime.
 *
 * The caller owns clips, AnimationMixer and state mutation. This policy only decides whether a
 * requested transition is accepted and which bounded blend window to use.
 */

const DEFAULTS = Object.freeze({
  maxTransitionsPerSecond: 12,
  minBlendSeconds: 0.04,
  maxBlendSeconds: 0.32,
  combatBlendSeconds: 0.08,
  locomotionBlendSeconds: 0.18,
  reactionBlendSeconds: 0.06,
  hysteresisSeconds: 0.05,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeName = (value, fallback = 'idle') => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || fallback;
};

const REACTION_STATES = new Set(['hit', 'hit-stagger', 'guard-break', 'defeat']);
const COMBAT_STATES = new Set(['light', 'heavy', 'ranged', 'guard', 'parry', 'dodge']);
const LOCOMOTION_STATES = new Set(['idle', 'walking', 'running', 'sprinting', 'fall', 'land']);

function categoryFor(name) {
  if (REACTION_STATES.has(name)) return 'reaction';
  if (COMBAT_STATES.has(name)) return 'combat';
  if (LOCOMOTION_STATES.has(name)) return 'locomotion';
  return 'other';
}

function normalizeOptions(options = {}) {
  return {
    maxTransitionsPerSecond: Math.max(1, finite(options.maxTransitionsPerSecond, DEFAULTS.maxTransitionsPerSecond)),
    minBlendSeconds: clamp(finite(options.minBlendSeconds, DEFAULTS.minBlendSeconds), 0, 2),
    maxBlendSeconds: clamp(finite(options.maxBlendSeconds, DEFAULTS.maxBlendSeconds), 0, 2),
    combatBlendSeconds: clamp(finite(options.combatBlendSeconds, DEFAULTS.combatBlendSeconds), 0, 2),
    locomotionBlendSeconds: clamp(finite(options.locomotionBlendSeconds, DEFAULTS.locomotionBlendSeconds), 0, 2),
    reactionBlendSeconds: clamp(finite(options.reactionBlendSeconds, DEFAULTS.reactionBlendSeconds), 0, 2),
    hysteresisSeconds: clamp(finite(options.hysteresisSeconds, DEFAULTS.hysteresisSeconds), 0, 2),
  };
}

function chooseBlend(from, to, options) {
  if (from === to) return 0;
  const category = categoryFor(to);
  const base = category === 'reaction'
    ? options.reactionBlendSeconds
    : category === 'combat'
      ? options.combatBlendSeconds
      : category === 'locomotion'
        ? options.locomotionBlendSeconds
        : options.locomotionBlendSeconds;
  return clamp(base, options.minBlendSeconds, Math.max(options.minBlendSeconds, options.maxBlendSeconds));
}

export function createPlayerAnimationTransitionBudget({ now = () => Date.now(), options = {} } = {}) {
  const config = normalizeOptions(options);
  const history = [];
  let disposed = false;
  let current = 'idle';

  function request(nextState, { timestamp = now(), force = false, interruptible = true } = {}) {
    if (disposed) return Object.freeze({ accepted: false, reason: 'disposed', from: current, to: current, blendSeconds: 0 });
    const to = normalizeName(nextState, current);
    const time = Number.isFinite(Number(timestamp)) ? Number(timestamp) : now();
    const from = current;
    if (to === from && !force) return Object.freeze({ accepted: false, reason: 'same-state', from, to, blendSeconds: 0 });
    const windowStart = time - 1000;
    while (history.length && history[0] < windowStart) history.shift();
    if (!force && history.length >= Math.floor(config.maxTransitionsPerSecond)) {
      return Object.freeze({ accepted: false, reason: 'rate-limited', from, to, blendSeconds: 0, transitionsInWindow: history.length });
    }
    if (!interruptible && categoryFor(from) === 'combat' && categoryFor(to) === 'locomotion' && !force) {
      return Object.freeze({ accepted: false, reason: 'non-interruptible', from, to, blendSeconds: 0 });
    }
    if (!force && history.length && time - history[history.length - 1] < config.hysteresisSeconds * 1000) {
      return Object.freeze({ accepted: false, reason: 'hysteresis', from, to, blendSeconds: 0 });
    }
    const blendSeconds = chooseBlend(from, to, config);
    history.push(time);
    current = to;
    return Object.freeze({ accepted: true, reason: 'accepted', from, to, blendSeconds, category: categoryFor(to), transitionsInWindow: history.length });
  }

  function snapshot() {
    return Object.freeze({ current, transitionsInWindow: history.length, disposed });
  }

  function dispose() {
    disposed = true;
    history.length = 0;
  }

  return Object.freeze({ request, snapshot, dispose });
}

export { DEFAULTS as PLAYER_ANIMATION_TRANSITION_DEFAULTS };

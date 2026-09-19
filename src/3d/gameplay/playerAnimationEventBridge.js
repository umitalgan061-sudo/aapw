/**
 * Projects accepted player actions into deterministic animation event receipts.
 * The caller remains authoritative for AnimationMixer, clips and state mutation.
 * @module gameplay/playerAnimationEventBridge
 */

const ACTION_TO_CLIP = Object.freeze({
  light: 'attack_light',
  heavy: 'attack_heavy',
  guard: 'guard_start',
  parry: 'parry_start',
  dodge: 'dodge',
  ranged: 'attack_ranged',
  archery: 'attack_archery',
  lockOn: 'target_lock',
});

const DEFAULT_PHASES = Object.freeze({
  attack_light: Object.freeze({ leadInMs: 60, activeMs: 120, recoveryMs: 260 }),
  attack_heavy: Object.freeze({ leadInMs: 140, activeMs: 180, recoveryMs: 520 }),
  guard_start: Object.freeze({ leadInMs: 40, activeMs: 220, recoveryMs: 160 }),
  parry_start: Object.freeze({ leadInMs: 30, activeMs: 90, recoveryMs: 280 }),
  dodge: Object.freeze({ leadInMs: 20, activeMs: 260, recoveryMs: 180 }),
  attack_ranged: Object.freeze({ leadInMs: 90, activeMs: 80, recoveryMs: 300 }),
  attack_archery: Object.freeze({ leadInMs: 120, activeMs: 120, recoveryMs: 420 }),
  target_lock: Object.freeze({ leadInMs: 0, activeMs: 0, recoveryMs: 120 }),
});

function clampMs(value, fallback = 0, max = 2000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(max, Math.round(numeric)));
}

function normalizeAction(action) {
  if (action === 'lightAttack') return 'light';
  if (action === 'heavyAttack') return 'heavy';
  if (action === 'target-lock') return 'lockOn';
  return action;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeDeep(nested);
  return value;
}

export function createPlayerAnimationEventBridge({
  now = () => Date.now(),
  phases = DEFAULT_PHASES,
  maxHistory = 24,
} = {}) {
  const history = [];
  let serial = 0;
  let disposed = false;

  function project(action, { source = 'unknown', timestamp = now(), comboStep = 0, intensity = 1 } = {}) {
    if (disposed) return null;
    const kind = normalizeAction(action);
    const clip = ACTION_TO_CLIP[kind];
    if (!clip) return null;
    const phase = phases?.[clip] ?? DEFAULT_PHASES[clip];
    if (!phase) return null;
    const event = {
      serial: ++serial,
      action: kind,
      clip,
      source: String(source).slice(0, 32),
      timestamp: Number.isFinite(timestamp) ? timestamp : now(),
      comboStep: Math.max(0, Math.floor(Number(comboStep) || 0)),
      intensity: Math.max(0, Math.min(1.5, Number(intensity) || 0)),
      phases: {
        leadInMs: clampMs(phase.leadInMs),
        activeMs: clampMs(phase.activeMs),
        recoveryMs: clampMs(phase.recoveryMs),
      },
      interruptibleAfterMs: clampMs(phase.leadInMs + phase.activeMs),
    };
    freezeDeep(event);
    history.push(event);
    if (history.length > Math.max(1, Math.min(64, Math.floor(Number(maxHistory) || 24)))) history.splice(0, history.length - Math.max(1, Math.min(64, Math.floor(Number(maxHistory) || 24))));
    return event;
  }

  function recent(limit = 8) {
    const count = Math.max(0, Math.min(history.length, Math.floor(Number(limit) || 0)));
    return Object.freeze(history.slice(-count));
  }

  function reset() {
    history.length = 0;
    serial = 0;
  }

  function dispose() {
    disposed = true;
    history.length = 0;
  }

  return Object.freeze({ project, recent, reset, dispose });
}

export function validatePlayerAnimationEvent(event) {
  return Boolean(event && Number.isInteger(event.serial) && typeof event.clip === 'string' && event.phases && Number.isFinite(event.phases.activeMs));
}

export { ACTION_TO_CLIP as PLAYER_ANIMATION_ACTION_CLIPS };

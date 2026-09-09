/**
 * Normalize keyboard, gamepad and touch intents into one bounded player command.
 * This is a side-effect-free adapter; the existing player state machine remains
 * authoritative for input polling, movement, combat and state mutation.
 * @module gameplay/playerInputIntentNormalizer
 */

const ACTIONS = new Set(['light', 'heavy', 'dodge', 'guard', 'parry', 'rangedRelease', 'interact']);
const SOURCES = new Set(['keyboard', 'gamepad', 'touch', 'mouse', 'unknown']);
const MAX_AXIS = 1;
const EPSILON = 1e-4;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeAxis = (value) => clamp(finite(value), -MAX_AXIS, MAX_AXIS);
const normalizeDeadZone = (value, fallback = 0.12) => clamp(finite(value, fallback), 0, 0.95);
const normalizeSource = (value) => SOURCES.has(value) ? value : 'unknown';
const normalizeAction = (value) => ACTIONS.has(value) ? value : null;

function applyDeadZone(value, deadZone) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  const sign = value < 0 ? -1 : 1;
  return sign * ((magnitude - deadZone) / (1 - deadZone));
}

function normalizeButton(value) {
  if (typeof value === 'boolean') return value;
  return Boolean(finite(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stable(value[key]);
    return acc;
  }, {});
}

export function normalizePlayerInputIntent(input = {}, options = {}) {
  const deadZone = normalizeDeadZone(options.deadZone);
  const source = normalizeSource(input.source);
  const moveX = applyDeadZone(normalizeAxis(input.moveX), deadZone);
  const moveY = applyDeadZone(normalizeAxis(input.moveY), deadZone);
  const lookX = applyDeadZone(normalizeAxis(input.lookX), deadZone);
  const lookY = applyDeadZone(normalizeAxis(input.lookY), deadZone);
  const action = normalizeAction(input.action);
  const pressed = normalizeButton(input.pressed);
  const held = normalizeButton(input.held);
  const canceled = normalizeButton(input.canceled);
  const sprint = normalizeButton(input.sprint);
  const moveMagnitude = clamp(Math.hypot(moveX, moveY), 0, Math.SQRT2);
  const lookMagnitude = clamp(Math.hypot(lookX, lookY), 0, Math.SQRT2);
  const hasMotion = moveMagnitude > EPSILON;
  const hasLook = lookMagnitude > EPSILON;

  return deepFreeze({
    schema: 'player-input-intent/v1',
    source,
    action,
    pressed,
    held,
    canceled,
    sprint,
    axes: { moveX, moveY, lookX, lookY },
    magnitudes: { move: moveMagnitude, look: lookMagnitude },
    flags: {
      hasMotion,
      hasLook,
      combatIntent: Boolean(action),
      locomotionIntent: hasMotion || sprint,
    },
    normalized: true,
    deadZone,
  });
}

export function serializePlayerInputIntent(intent) {
  return JSON.stringify(stable(intent));
}

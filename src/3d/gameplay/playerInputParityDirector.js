/**
 * Deterministic input parity projection for the existing player runtime.
 * Keeps keyboard/mouse, gamepad and mobile/PWA gesture sources equivalent without owning input mutation.
 * @module gameplay/playerInputParityDirector
 */

const SOURCE_ORDER = Object.freeze(['keyboard-mouse', 'gamepad', 'mobile']);
const ACTION_ORDER = Object.freeze(['move', 'look', 'light', 'heavy', 'block', 'parry', 'dodge', 'lock-on', 'interact']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeVector2(value) {
  const x = finite(value?.x), y = finite(value?.y);
  const length = Math.hypot(x, y);
  if (length <= 1) return Object.freeze({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
  return Object.freeze({ x: Number((x / length).toFixed(4)), y: Number((y / length).toFixed(4)) });
}

function normalizeAction(action, source) {
  const pressed = Boolean(action?.pressed);
  const justPressed = Boolean(action?.justPressed);
  const value = clamp(finite(action?.value), 0, 1);
  return Object.freeze({ action, source, pressed, justPressed, value });
}

function chooseAction(observations, action) {
  const candidates = SOURCE_ORDER
    .map((source) => normalizeAction(observations?.[source]?.actions?.[action], source))
    .filter((entry) => entry.pressed || entry.justPressed || entry.value > 0);
  return candidates.sort((a, b) => {
    if (Number(b.justPressed) !== Number(a.justPressed)) return Number(b.justPressed) - Number(a.justPressed);
    if (Number(b.pressed) !== Number(a.pressed)) return Number(b.pressed) - Number(a.pressed);
    if (b.value !== a.value) return b.value - a.value;
    return SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
  })[0] ?? Object.freeze({ action, source: 'none', pressed: false, justPressed: false, value: 0 });
}

export function projectPlayerInputParity(observations = {}, options = {}) {
  const deadzone = clamp(finite(options.deadzone, 0.18), 0, 0.9);
  const move = normalizeVector2(observations?.move);
  const look = normalizeVector2(observations?.look);
  const sourceHealth = SOURCE_ORDER.map((source) => Object.freeze({
    source,
    connected: observations?.[source]?.connected !== false,
    confidence: clamp(finite(observations?.[source]?.confidence, 1), 0, 1),
  }));
  const selectedActions = ACTION_ORDER.map((action) => chooseAction(observations, action));
  const activeSources = sourceHealth.filter((entry) => entry.connected && entry.confidence > 0);
  const moveMagnitude = Math.hypot(move.x, move.y);
  const lookMagnitude = Math.hypot(look.x, look.y);
  const normalizedMoveMagnitude = moveMagnitude < deadzone ? 0 : clamp((moveMagnitude - deadzone) / (1 - deadzone), 0, 1);
  const normalizedLookMagnitude = lookMagnitude < deadzone ? 0 : clamp((lookMagnitude - deadzone) / (1 - deadzone), 0, 1);
  const output = {
    move: Object.freeze({ vector: move, magnitude: Number(normalizedMoveMagnitude.toFixed(4)) }),
    look: Object.freeze({ vector: look, magnitude: Number(normalizedLookMagnitude.toFixed(4)) }),
    actions: Object.freeze(selectedActions),
    sourceHealth: Object.freeze(sourceHealth),
    activeSourceCount: activeSources.length,
    primarySource: activeSources[0]?.source ?? 'none',
    deadzone,
    parityReady: activeSources.length > 0,
  };
  return Object.freeze(output);
}

export function serializePlayerInputParity(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

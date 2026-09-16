/**
 * Deterministic input-device context over the shipped playerInputParity contract.
 *
 * The existing input adapter remains authoritative for keyboard, mouse, gamepad and touch
 * ingestion. This module only classifies the latest source activity and exposes a bounded
 * context snapshot for HUD/camera/UX consumers; it does not own listeners or gameplay state.
 */

const DEVICES = Object.freeze(['keyboard', 'mouse', 'gamepad', 'touch', 'unknown']);
const ACTIONS = Object.freeze(['moveForward', 'moveBackward', 'moveLeft', 'moveRight', 'lightAttack', 'heavyAttack', 'block', 'dodge', 'lockOn']);
const MAX_ACTIVITY = 16;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeDevice = (value) => DEVICES.includes(value) ? value : 'unknown';
const freeze = (value) => Object.freeze(value);

function inferDevice({ source = 'unknown', action = '', axis = false } = {}) {
  if (source === 'keyboard' || source === 'mouse' || source === 'gamepad' || source === 'touch') return source;
  if (axis) return 'gamepad';
  if (String(action).startsWith('Mouse')) return 'mouse';
  if (String(action).startsWith('Key')) return 'keyboard';
  return 'unknown';
}

function normalizeActivity(entry = {}, sequence = 0) {
  const action = String(entry.action || '');
  const device = inferDevice({ source: entry.device, action, axis: Boolean(entry.axis) });
  return freeze({
    sequence,
    device,
    action: ACTIONS.includes(action) ? action : '',
    axis: Boolean(entry.axis),
    pressed: Boolean(entry.pressed),
    magnitude: clamp(finite(entry.magnitude, entry.axis ? 1 : 0), 0, 1),
    timestamp: Math.max(0, finite(entry.timestamp, 0)),
  });
}

export function createPlayerInputDeviceContext({
  now = () => 0,
  maxActivity = MAX_ACTIVITY,
  initialDevice = 'unknown',
} = {}) {
  const limit = clamp(Math.floor(finite(maxActivity, MAX_ACTIVITY)), 1, MAX_ACTIVITY);
  let disposed = false;
  let sequence = 0;
  let activeDevice = normalizeDevice(initialDevice);
  const activity = [];

  function record(entry = {}) {
    if (disposed) return snapshot();
    const next = normalizeActivity({ ...entry, timestamp: entry.timestamp ?? now() }, ++sequence);
    if (next.device !== 'unknown') activeDevice = next.device;
    activity.push(next);
    if (activity.length > limit) activity.splice(0, activity.length - limit);
    return snapshot();
  }

  function recordKeyboard(code, pressed = true, timestamp = now()) {
    return record({ device: 'keyboard', action: code, pressed, timestamp });
  }

  function recordMouse(button, pressed = true, timestamp = now()) {
    return record({ device: 'mouse', action: `Mouse${button}`, pressed, timestamp });
  }

  function recordGamepad({ action = '', magnitude = 1, axis = false, timestamp = now() } = {}) {
    return record({ device: 'gamepad', action, magnitude, axis, pressed: magnitude > 0, timestamp });
  }

  function recordTouch(control, pressed = true, timestamp = now()) {
    return record({ device: 'touch', action: control, pressed, timestamp });
  }

  function snapshot() {
    return freeze({
      activeDevice,
      lastActivity: activity.at(-1) || null,
      activity: freeze([...activity]),
      sequence,
      disposed,
    });
  }

  function reset() {
    if (disposed) return snapshot();
    sequence = 0;
    activeDevice = 'unknown';
    activity.length = 0;
    return snapshot();
  }

  function dispose() {
    disposed = true;
    activity.length = 0;
    return snapshot();
  }

  return freeze({ record, recordKeyboard, recordMouse, recordGamepad, recordTouch, snapshot, reset, dispose });
}

export function validatePlayerInputDeviceContext(value) {
  return Boolean(value && DEVICES.includes(value.activeDevice) && Number.isInteger(value.sequence)
    && Array.isArray(value.activity) && value.activity.every((entry) => DEVICES.includes(entry.device)
      && (entry.action === '' || ACTIONS.includes(entry.action))
      && Number.isFinite(entry.magnitude) && entry.magnitude >= 0 && entry.magnitude <= 1));
}

export { DEVICES, ACTIONS, inferDevice };

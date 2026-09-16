import { createPlayerInputParity } from './playerInputParity.js';
import { createPlayerCombatFrameDirector } from './playerCombatFrameDirector.js';

const ACTION_MAP = Object.freeze({
  lightAttack: 'lightAttack', heavyAttack: 'heavyAttack', block: 'block',
  dodge: 'dodge', lockOn: 'lockOn', parry: 'parry',
});
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

function normalizeAction(value) {
  const action = String(value ?? '').trim();
  return ACTION_MAP[action] || null;
}

function freezeFrame(frame) {
  return Object.freeze({
    ...frame,
    intent: Object.freeze({ ...(frame.intent || {}) }),
    input: Object.freeze({ ...(frame.input || {}), move: Object.freeze({ ...(frame.input?.move || {}) }) }),
  });
}

/**
 * Bridges the existing cross-device input parity producer to the existing combat-frame director.
 * It owns neither player state mutation nor collision/damage; downstream owners consume the receipt.
 */
export function createPlayerCombatFrameBridge({
  input = null,
  director = null,
  readTarget = null,
  resolveHit = null,
  resolveAnimation = null,
  resolveEquipment = null,
  applyResources = null,
  maxBufferedActions = 8,
} = {}) {
  const parity = input || createPlayerInputParity();
  const frameDirector = director || createPlayerCombatFrameDirector({
    readInput: ({ intent }) => intent,
    resolveTarget: ({ intent, frame }) => {
      try { return typeof readTarget === 'function' ? readTarget({ intent, frame }) : null; } catch { return null; }
    },
    resolveHit,
    resolveAnimation,
    resolveEquipment,
    applyResources,
  });

  let disposed = false;
  let sequence = 0;
  const buffered = [];

  const push = (action, source = 'unknown', timestamp = 0) => {
    const normalized = normalizeAction(action);
    if (!normalized || disposed) return false;
    buffered.push(Object.freeze({ action: normalized, source: String(source), timestamp: Math.max(0, finite(timestamp)), sequence: sequence++ }));
    if (buffered.length > Math.max(1, Math.floor(finite(maxBufferedActions, 8)))) {
      buffered.splice(0, buffered.length - Math.max(1, Math.floor(finite(maxBufferedActions, 8))));
    }
    return true;
  };

  const ingestKeyboard = (code, isDown = true, timestamp = 0) => {
    const accepted = parity.ingestKeyboard(code, isDown);
    if (accepted && isDown) {
      const action = parity.consumePressed()[0];
      if (action) push(action, 'keyboard', timestamp);
    }
    return accepted;
  };

  const ingestMouse = (button, isDown = true, timestamp = 0) => {
    const accepted = parity.ingestMouse(button, isDown);
    if (accepted && isDown) {
      const action = parity.consumePressed()[0];
      if (action) push(action, 'mouse', timestamp);
    }
    return accepted;
  };

  const ingestTouch = (control, isDown = true, timestamp = 0) => {
    const accepted = parity.ingestTouch(control, isDown);
    if (accepted && isDown) {
      const action = parity.consumePressed()[0];
      if (action) push(action, 'touch', timestamp);
    }
    return accepted;
  };

  const ingestGamepad = (state = {}, timestamp = 0) => {
    parity.ingestGamepad(state);
    for (const action of parity.consumePressed()) push(action, 'gamepad', timestamp);
    return parity.snapshot();
  };

  const setMove = (x, y) => parity.setMove(x, y);

  const step = (inputState = {}) => {
    if (disposed) return Object.freeze({ disposed: true, frame: 0, intent: { action: 'none', accepted: false }, input: parity.snapshot() });
    const queued = buffered.shift() || { action: 'none', source: 'none', timestamp: 0, sequence: sequence++ };
    const intent = queued.action === 'none' ? {} : {
      action: queued.action,
      source: queued.source,
      timestamp: queued.timestamp,
      sequence: queued.sequence,
      strength: clamp(inputState.strength, 0, 1),
      targetId: inputState.targetId ?? null,
    };
    const result = frameDirector.step({ ...inputState, intent, input: parity.snapshot() });
    return freezeFrame({ ...result, intent: result.intent, input: parity.snapshot(), buffered: buffered.length });
  };

  const snapshot = () => Object.freeze({
    disposed,
    buffered: buffered.map((entry) => ({ ...entry })),
    input: parity.snapshot(),
    director: frameDirector.snapshot(),
  });

  const reset = () => { buffered.length = 0; sequence = 0; parity.reset(); frameDirector.reset(); };
  const dispose = () => { if (disposed) return; disposed = true; buffered.length = 0; parity.reset(); frameDirector.dispose(); };

  return Object.freeze({ ingestKeyboard, ingestMouse, ingestTouch, ingestGamepad, setMove, step, snapshot, reset, dispose });
}

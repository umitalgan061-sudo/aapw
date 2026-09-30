const ACTIONS = Object.freeze([
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'lightAttack',
  'heavyAttack',
  'block',
  'dodge',
  'lockOn',
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

const KEY_ACTIONS = Object.freeze({
  KeyW: 'moveForward', KeyS: 'moveBackward', KeyA: 'moveLeft', KeyD: 'moveRight',
  Mouse0: 'lightAttack', Mouse1: 'block', KeyR: 'heavyAttack',
  Space: 'dodge', KeyQ: 'lockOn',
});

const BUTTON_ACTIONS = Object.freeze({
  0: 'lightAttack', 1: 'heavyAttack', 2: 'dodge', 3: 'block', 4: 'lockOn',
});

const TOUCH_ACTIONS = Object.freeze({ light: 'lightAttack', heavy: 'heavyAttack',
  dodge: 'dodge', block: 'block', lock: 'lockOn' });

function normalizeStick(x, y, deadzone = 0.15) {
  const sx = clamp(finite(x), -1, 1);
  const sy = clamp(finite(y), -1, 1);
  const magnitude = Math.hypot(sx, sy);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const scaled = clamp((magnitude - deadzone) / (1 - deadzone), 0, 1) / magnitude;
  return { x: clamp(sx * scaled, -1, 1), y: clamp(sy * scaled, -1, 1) };
}

export function createPlayerInputParity(options = {}) {
  const deadzone = clamp(finite(options.deadzone, 0.15), 0, 0.95);
  const held = new Set();
  const pressed = new Set();
  let move = { x: 0, y: 0 };

  const press = (action) => { if (ACTIONS.includes(action)) { held.add(action); pressed.add(action); } };
  const release = (action) => { if (ACTIONS.includes(action)) held.delete(action); };

  const ingestKeyboard = (code, isDown = true) => {
    const action = KEY_ACTIONS[code];
    if (!action) return false;
    (isDown ? press : release)(action);
    return true;
  };

  const ingestMouse = (button, isDown = true) => ingestKeyboard(`Mouse${button}`, isDown);

  const ingestGamepad = (state = {}) => {
    move = normalizeStick(state.leftX, state.leftY, deadzone);
    const buttons = Array.isArray(state.buttons) ? state.buttons : [];
    buttons.forEach((value, index) => ((finite(value) >= 0.5) ? press : release)(BUTTON_ACTIONS[index]));
    return snapshot();
  };

  const ingestTouch = (control, isDown = true) => {
    const action = TOUCH_ACTIONS[control];
    if (!action) return false;
    (isDown ? press : release)(action);
    return true;
  };

  const setMove = (x, y) => { move = normalizeStick(x, y, deadzone); return move; };
  const consumePressed = () => { const result = [...pressed].sort(); pressed.clear(); return result; };
  const snapshot = () => ({ move: { ...move }, held: [...held].sort(), pressed: [...pressed].sort() });
  const reset = () => { held.clear(); pressed.clear(); move = { x: 0, y: 0 }; };

  return Object.freeze({ ingestKeyboard, ingestMouse, ingestGamepad, ingestTouch, setMove, consumePressed, snapshot, reset });
}

export { ACTIONS, normalizeStick };

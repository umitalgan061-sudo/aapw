/**
 * Canonical player intent adapter shared by keyboard, gamepad and touch/PWA input.
 * It only normalizes input; player.js remains authoritative for movement/combat state.
 * @module gameplay/playerInputParity
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const deadzone = (value, threshold = 0.14) => {
  const numeric = Number(value) || 0;
  const magnitude = Math.abs(numeric);
  if (magnitude <= threshold) return 0;
  const scaled = (magnitude - threshold) / (1 - threshold);
  return Math.sign(numeric) * clamp(scaled, 0, 1);
};

function axisFromKeyboard(keys = {}) {
  const x = (keys.right || keys.d ? 1 : 0) - (keys.left || keys.a ? 1 : 0);
  const z = (keys.down || keys.s ? 1 : 0) - (keys.up || keys.w ? 1 : 0);
  return { x, z };
}

function axisFromStick(stick = {}) {
  return { x: deadzone(stick.x), z: deadzone(stick.y) };
}

function chooseAxis(keyboard, stick, stickMagnitude = 0) {
  return Number(stickMagnitude) > 0.08 ? stick : keyboard;
}

export function normalizePlayerInput({ keyboard = {}, gamepad = {}, touch = {} } = {}) {
  const keyboardAxis = axisFromKeyboard(keyboard);
  const stick = axisFromStick(gamepad.leftStick ?? {});
  const stickMagnitude = Math.hypot(stick.x, stick.z);
  const touchAxis = axisFromStick(touch.moveStick ?? {});
  const touchMagnitude = Math.hypot(touchAxis.x, touchAxis.z);
  const selected = touchMagnitude > 0.08 ? touchAxis : chooseAxis(keyboardAxis, stick, stickMagnitude);
  const moveMagnitude = clamp(Math.hypot(selected.x, selected.z), 0, 1);
  return Object.freeze({
    moveX: Number(selected.x.toFixed(4)),
    moveZ: Number(selected.z.toFixed(4)),
    moveMagnitude: Number(moveMagnitude.toFixed(4)),
    sprint: Boolean(keyboard.sprint || gamepad.sprint || touch.sprint),
    guard: Boolean(keyboard.guard || gamepad.guard || touch.guard),
    dodgePressed: Boolean(keyboard.dodgePressed || gamepad.dodgePressed || touch.dodgePressed),
    lightPressed: Boolean(keyboard.lightPressed || gamepad.lightPressed || touch.lightPressed),
    heavyPressed: Boolean(keyboard.heavyPressed || gamepad.heavyPressed || touch.heavyPressed),
    lockOnPressed: Boolean(keyboard.lockOnPressed || gamepad.lockOnPressed || touch.lockOnPressed),
  });
}

export const PLAYER_INPUT_PARITY_LIMITS = Object.freeze({
  deadzone: 0.14,
  touchPriorityMagnitude: 0.08,
  maxMagnitude: 1,
});

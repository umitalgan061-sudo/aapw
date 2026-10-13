/**
 * Canonical, DOM-free player intent normalization for keyboard, gamepad and touch/PWA input.
 * The existing player controller remains authoritative for movement/combat state transitions.
 */

export type PlayerInputAxes = Readonly<{ x: number; y: number }>;

export type PlayerInputSource = Readonly<{
  move?: PlayerInputAxes;
  sprint?: boolean;
  guard?: boolean;
  dodgePressed?: boolean;
  lightPressed?: boolean;
  heavyPressed?: boolean;
  lockOnPressed?: boolean;
}>;

export type PlayerInputIntent = Readonly<{
  moveX: number;
  moveZ: number;
  moveMagnitude: number;
  sprint: boolean;
  guard: boolean;
  dodgePressed: boolean;
  lightPressed: boolean;
  heavyPressed: boolean;
  lockOnPressed: boolean;
}>;

export const PLAYER_INPUT_PARITY_LIMITS = Object.freeze({
  deadzone: 0.14,
  touchPriorityMagnitude: 0.08,
  maxMagnitude: 1,
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function normalizeAxis(value: number | undefined): number {
  const numeric = Number(value) || 0;
  const magnitude = Math.abs(numeric);
  if (magnitude <= PLAYER_INPUT_PARITY_LIMITS.deadzone) return 0;
  const scaled = (magnitude - PLAYER_INPUT_PARITY_LIMITS.deadzone) / (1 - PLAYER_INPUT_PARITY_LIMITS.deadzone);
  return Math.sign(numeric) * clamp(scaled, 0, 1);
}

function readMove(source: PlayerInputSource | undefined): PlayerInputAxes {
  return Object.freeze({
    x: normalizeAxis(source?.move?.x),
    y: normalizeAxis(source?.move?.y),
  });
}

function magnitude(move: PlayerInputAxes): number {
  return Math.hypot(move.x, move.y);
}

function chooseMove(keyboard: PlayerInputSource | undefined, gamepad: PlayerInputSource | undefined, touch: PlayerInputSource | undefined): PlayerInputAxes {
  const touchMove = readMove(touch);
  if (magnitude(touchMove) > PLAYER_INPUT_PARITY_LIMITS.touchPriorityMagnitude) return touchMove;
  const gamepadMove = readMove(gamepad);
  if (magnitude(gamepadMove) > PLAYER_INPUT_PARITY_LIMITS.touchPriorityMagnitude) return gamepadMove;
  return readMove(keyboard);
}

export function normalizePlayerInput({ keyboard, gamepad, touch }: Readonly<{
  keyboard?: PlayerInputSource;
  gamepad?: PlayerInputSource;
  touch?: PlayerInputSource;
}> = {}): PlayerInputIntent {
  const move = chooseMove(keyboard, gamepad, touch);
  const moveMagnitude = clamp(magnitude(move), 0, PLAYER_INPUT_PARITY_LIMITS.maxMagnitude);
  return Object.freeze({
    moveX: Number(move.x.toFixed(4)),
    moveZ: Number((-move.y).toFixed(4)),
    moveMagnitude: Number(moveMagnitude.toFixed(4)),
    sprint: Boolean(keyboard?.sprint || gamepad?.sprint || touch?.sprint),
    guard: Boolean(keyboard?.guard || gamepad?.guard || touch?.guard),
    dodgePressed: Boolean(keyboard?.dodgePressed || gamepad?.dodgePressed || touch?.dodgePressed),
    lightPressed: Boolean(keyboard?.lightPressed || gamepad?.lightPressed || touch?.lightPressed),
    heavyPressed: Boolean(keyboard?.heavyPressed || gamepad?.heavyPressed || touch?.heavyPressed),
    lockOnPressed: Boolean(keyboard?.lockOnPressed || gamepad?.lockOnPressed || touch?.lockOnPressed),
  });
}

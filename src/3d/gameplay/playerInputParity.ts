/** Production TypeScript owner for src/3d/gameplay/playerInputParity.js. Legacy .js remains compatibility-only. */

export const ACTIONS = Object.freeze([
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'lightAttack',
  'heavyAttack',
  'block',
  'dodge',
  'lockOn',
] as const);

export type PlayerInputAction = typeof ACTIONS[number];
export interface PlayerGamepadState {
  readonly leftX?: unknown;
  readonly leftY?: unknown;
  readonly buttons?: readonly unknown[];
}
export interface PlayerInputSnapshot {
  readonly move: Readonly<{ x: number; y: number }>;
  readonly held: readonly PlayerInputAction[];
  readonly pressed: readonly PlayerInputAction[];
}
export interface PlayerInputParityOptions {
  readonly deadzone?: unknown;
}
export interface PlayerInputParityRuntime {
  readonly ingestKeyboard: (code: string, isDown?: boolean) => boolean;
  readonly ingestMouse: (button: number, isDown?: boolean) => boolean;
  readonly ingestGamepad: (state?: PlayerGamepadState) => PlayerInputSnapshot;
  readonly ingestTouch: (control: string, isDown?: boolean) => boolean;
  readonly setMove: (x: unknown, y: unknown) => Readonly<{ x: number; y: number }>;
  readonly consumePressed: () => readonly PlayerInputAction[];
  readonly snapshot: () => PlayerInputSnapshot;
  readonly reset: () => void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

const KEY_ACTIONS: Readonly<Record<string, PlayerInputAction>> = Object.freeze({
  KeyW: 'moveForward', KeyS: 'moveBackward', KeyA: 'moveLeft', KeyD: 'moveRight',
  Mouse0: 'lightAttack', Mouse1: 'block', KeyR: 'heavyAttack',
  Space: 'dodge', KeyQ: 'lockOn',
});

const BUTTON_ACTIONS: Readonly<Record<number, PlayerInputAction>> = Object.freeze({
  0: 'lightAttack', 1: 'heavyAttack', 2: 'dodge', 3: 'block', 4: 'lockOn',
});

const TOUCH_ACTIONS: Readonly<Record<string, PlayerInputAction>> = Object.freeze({
  light: 'lightAttack', heavy: 'heavyAttack',
  dodge: 'dodge', block: 'block', lock: 'lockOn',
});

export function normalizeStick(x: unknown, y: unknown, deadzone = 0.15): Readonly<{ x: number; y: number }> {
  const sx = clamp(finite(x), -1, 1);
  const sy = clamp(finite(y), -1, 1);
  const magnitude = Math.hypot(sx, sy);
  if (magnitude <= deadzone) return Object.freeze({ x: 0, y: 0 });
  const scaled = clamp((magnitude - deadzone) / (1 - deadzone), 0, 1) / magnitude;
  return Object.freeze({ x: clamp(sx * scaled, -1, 1), y: clamp(sy * scaled, -1, 1) });
}

export function createPlayerInputParity(options: PlayerInputParityOptions = {}): PlayerInputParityRuntime {
  const deadzone = clamp(finite(options.deadzone, 0.15), 0, 0.95);
  const held = new Set<PlayerInputAction>();
  const pressed = new Set<PlayerInputAction>();
  let move: Readonly<{ x: number; y: number }> = Object.freeze({ x: 0, y: 0 });

  const isAction = (value: unknown): value is PlayerInputAction =>
    typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);

  const press = (action: unknown): void => {
    if (!isAction(action)) return;
    held.add(action);
    pressed.add(action);
  };
  const release = (action: unknown): void => {
    if (!isAction(action)) return;
    held.delete(action);
  };

  const ingestKeyboard = (code: string, isDown = true): boolean => {
    const action = KEY_ACTIONS[code];
    if (!action) return false;
    (isDown ? press : release)(action);
    return true;
  };

  const ingestMouse = (button: number, isDown = true): boolean =>
    ingestKeyboard(`Mouse${Math.max(0, Math.trunc(button))}`, isDown);

  const snapshot = (): PlayerInputSnapshot => Object.freeze({
    move,
    held: Object.freeze([...held].sort()),
    pressed: Object.freeze([...pressed].sort()),
  });

  const ingestGamepad = (state: PlayerGamepadState = {}): PlayerInputSnapshot => {
    move = normalizeStick(state.leftX, state.leftY, deadzone);
    const buttons = Array.isArray(state.buttons) ? state.buttons : [];
    buttons.forEach((value, index) => {
      const action = BUTTON_ACTIONS[index];
      if (!action) return;
      (finite(value) >= 0.5 ? press : release)(action);
    });
    return snapshot();
  };

  const ingestTouch = (control: string, isDown = true): boolean => {
    const action = TOUCH_ACTIONS[control];
    if (!action) return false;
    (isDown ? press : release)(action);
    return true;
  };

  const setMove = (x: unknown, y: unknown): Readonly<{ x: number; y: number }> => {
    move = normalizeStick(x, y, deadzone);
    return move;
  };

  const consumePressed = (): readonly PlayerInputAction[] => {
    const result = Object.freeze([...pressed].sort() as PlayerInputAction[]);
    pressed.clear();
    return result;
  };

  const reset = (): void => {
    held.clear();
    pressed.clear();
    move = Object.freeze({ x: 0, y: 0 });
  };

  return Object.freeze({
    ingestKeyboard,
    ingestMouse,
    ingestGamepad,
    ingestTouch,
    setMove,
    consumePressed,
    snapshot,
    reset,
  });
}

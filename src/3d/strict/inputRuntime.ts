import type { GameplayAction, InputIntent, InputPolicy, InputSource, RawInputSample, Result } from './liveCoreTypes.ts';
import { actionId, clamp, err, normalizeActionList, ok, radialDeadzone } from './liveCoreTypes.ts';export interface KeyBindingMap {
  readonly [key: string]: GameplayAction | readonly GameplayAction[];
}

export interface GamepadSample {
  readonly connected: boolean;
  readonly index: number;
  readonly axes: readonly number[];
  readonly buttons: readonly boolean[];
  readonly buttonValues: readonly number[];
}

export const DEFAULT_INPUT_POLICY: InputPolicy = Object.freeze({
  radialDeadzone: 0.16,
  triggerDeadzone: 0.08,
  maxLookRate: 2.8,
  maxZoomRate: 2,
  repeatWindowSeconds: 0.08,
  maximumActionCount: 24,
});

export const DEFAULT_KEY_BINDINGS: KeyBindingMap = Object.freeze({
  KeyW: 'move',
  ArrowUp: 'move',
  KeyS: 'move',
  ArrowDown: 'move',
  KeyA: 'move',
  ArrowLeft: 'move',
  KeyD: 'move',
  ArrowRight: 'move',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  KeyQ: 'guard',
  KeyE: 'light',
  KeyR: 'heavy',
  Tab: 'lock-on',
  Escape: 'pause',
  KeyF: 'interact',
});

const ALLOWED_ACTIONS = new Set<GameplayAction>([
  'move', 'look', 'jump', 'dodge', 'light', 'heavy', 'parry', 'guard',
  'lock-on', 'interact', 'sprint', 'pause',
]);

const finiteTimestamp = (value: number | undefined): number =>
  Number.isFinite(value) && value !== undefined ? Math.max(0, value) : 0;

const normalizeActions = (
  values: readonly GameplayAction[] | undefined,
  policy: InputPolicy,
): readonly GameplayAction[] =>
  normalizeActionList(
    (values ?? []).filter((value) => ALLOWED_ACTIONS.has(value)),
    policy.maximumActionCount,
  );

export const normalizeInputSample = (
  sample: RawInputSample,
  sequence: number,
  policy: InputPolicy = DEFAULT_INPUT_POLICY,
): Result<InputIntent> => {
  const source = sample.source;
  const allowedSources: readonly InputSource[] = ['keyboard', 'mouse', 'touch', 'gamepad', 'xr', 'synthetic'];
  if (!allowedSources.includes(source)) return err('INVALID_INPUT', 'Unsupported input source.', true);

  const move = radialDeadzone(sample.moveX ?? 0, sample.moveY ?? 0, clamp(policy.radialDeadzone, 0, 0.95));
  const look = radialDeadzone(sample.lookX ?? 0, sample.lookY ?? 0, clamp(policy.radialDeadzone, 0, 0.95));
  const maxLook = Math.max(0, policy.maxLookRate);
  const maxZoom = Math.max(0, policy.maxZoomRate);
  const heldList = normalizeActions(sample.held, policy);
  const pressedList = normalizeActions(sample.pressed, policy);
  const releasedList = normalizeActions(sample.released, policy);
  const held = new Set<GameplayAction>(heldList);
  const pressed = new Set<GameplayAction>(pressedList);
  const released = new Set<GameplayAction>(releasedList);

  return ok(Object.freeze({
    source,
    move,
    look: Object.freeze({
      x: clamp(look.x * maxLook, -maxLook, maxLook),
      y: clamp(look.y * maxLook, -maxLook, maxLook),
      magnitude: look.magnitude,
    }),
    cameraZoom: clamp(sample.zoom ?? 0, -maxZoom, maxZoom),
    held,
    pressed,
    released,
    sequence: Math.max(0, Math.floor(sequence)),
    timestampSeconds: finiteTimestamp(sample.timestampSeconds),
  }));
};

export const calculateActionEdges = (
  previousHeld: ReadonlySet<GameplayAction>,
  currentHeld: ReadonlySet<GameplayAction>,
): Readonly<{
  pressed: ReadonlySet<GameplayAction>;
  released: ReadonlySet<GameplayAction>;
}> => {
  const pressed = new Set<GameplayAction>();
  const released = new Set<GameplayAction>();
  for (const action of currentHeld) if (!previousHeld.has(action)) pressed.add(action);
  for (const action of previousHeld) if (!currentHeld.has(action)) released.add(action);
  return Object.freeze({ pressed, released });
};

export const normalizeGamepadAxis = (value: number, deadzone = DEFAULT_INPUT_POLICY.radialDeadzone): number =>
  radialDeadzone(value, 0, deadzone).x;

export const normalizeTrigger = (value: number, deadzone = DEFAULT_INPUT_POLICY.triggerDeadzone): number => {
  const normalized = clamp(value, 0, 1);
  if (normalized <= deadzone) return 0;
  return clamp((normalized - deadzone) / Math.max(1e-9, 1 - deadzone), 0, 1);
};

export const buildGamepadInputSample = (
  gamepad: GamepadSample,
  previousButtons: readonly boolean[] = [],
  timestampSeconds = 0,
): RawInputSample => {
  if (!gamepad.connected) {
    return Object.freeze({
      source: 'gamepad',
      timestampSeconds,
      moveX: 0,
      moveY: 0,
      lookX: 0,
      lookY: 0,
      zoom: 0,
      held: [],
      pressed: [],
      released: [],
    });
  }
  const move = radialDeadzone(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0, DEFAULT_INPUT_POLICY.radialDeadzone);
  const look = radialDeadzone(gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0, DEFAULT_INPUT_POLICY.radialDeadzone);
  const mapping: readonly [number, GameplayAction][] = [
    [0, 'jump'], [1, 'dodge'], [2, 'light'], [3, 'heavy'],
    [4, 'guard'], [5, 'parry'], [10, 'sprint'], [11, 'lock-on'],
  ];
  const held: GameplayAction[] = [];
  const pressed: GameplayAction[] = [];
  const released: GameplayAction[] = [];
  for (const [index, action] of mapping) {
    const current = Boolean(gamepad.buttons[index]);
    const previous = Boolean(previousButtons[index]);
    if (current) held.push(action);
    if (current && !previous) pressed.push(action);
    if (!current && previous) released.push(action);
  }
  const zoomIn = normalizeTrigger(gamepad.buttonValues[7] ?? 0);
  const zoomOut = normalizeTrigger(gamepad.buttonValues[6] ?? 0);
  return Object.freeze({
    source: 'gamepad',
    moveX: move.x,
    moveY: -move.y,
    lookX: look.x,
    lookY: -look.y,
    zoom: zoomIn - zoomOut,
    held,
    pressed,
    released,
    timestampSeconds,
  });
};

export const bindingActionsForKey = (
  code: string,
  bindings: KeyBindingMap = DEFAULT_KEY_BINDINGS,
): readonly GameplayAction[] => {
  const value = bindings[code];
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return Object.freeze(values.filter((action): action is GameplayAction => ALLOWED_ACTIONS.has(action)));
};

export const buildKeyboardSample = (
  pressedCodes: readonly string[],
  heldCodes: readonly string[],
  releasedCodes: readonly string[],
  bindings: KeyBindingMap = DEFAULT_KEY_BINDINGS,
  timestampSeconds = 0,
): RawInputSample => {
  const toActions = (codes: readonly string[]): GameplayAction[] =>
    codes.flatMap((code) => bindingActionsForKey(code, bindings));
  return Object.freeze({
    source: 'keyboard',
    held: toActions(heldCodes),
    pressed: toActions(pressedCodes),
    released: toActions(releasedCodes),
    timestampSeconds,
  });
};

export const buildTouchSample = (
  moveX: number,
  moveY: number,
  lookX: number,
  lookY: number,
  actions: {
    readonly held?: readonly GameplayAction[];
    readonly pressed?: readonly GameplayAction[];
    readonly released?: readonly GameplayAction[];
  } = {},
  timestampSeconds = 0,
): RawInputSample =>
  Object.freeze({
    source: 'touch',
    moveX,
    moveY,
    lookX,
    lookY,
    held: [...(actions.held ?? [])],
    pressed: [...(actions.pressed ?? [])],
    released: [...(actions.released ?? [])],
    timestampSeconds,
  });

export const mergeInputIntents = (
  primary: InputIntent,
  secondary: InputIntent,
  sequence: number,
): Result<InputIntent> => {
  if (primary.source !== secondary.source && primary.source !== 'synthetic' && secondary.source !== 'synthetic') {
    return err('INVALID_INPUT', 'Non-synthetic input sources cannot be merged directly.', true);
  }
  const held = new Set<GameplayAction>([...primary.held, ...secondary.held]);
  const pressed = new Set<GameplayAction>([...primary.pressed, ...secondary.pressed]);
  const released = new Set<GameplayAction>([...primary.released, ...secondary.released]);
  const moveX = Math.max(-1, Math.min(1, primary.move.x + secondary.move.x));
  const moveY = Math.max(-1, Math.min(1, primary.move.y + secondary.move.y));
  const lookX = clamp(primary.look.x + secondary.look.x, -DEFAULT_INPUT_POLICY.maxLookRate, DEFAULT_INPUT_POLICY.maxLookRate);
  const lookY = clamp(primary.look.y + secondary.look.y, -DEFAULT_INPUT_POLICY.maxLookRate, DEFAULT_INPUT_POLICY.maxLookRate);
  return ok(Object.freeze({
    source: 'synthetic',
    move: radialDeadzone(moveX, moveY, 0),
    look: Object.freeze({ x: lookX, y: lookY, magnitude: clamp(Math.hypot(lookX, lookY), 0, DEFAULT_INPUT_POLICY.maxLookRate) }),
    cameraZoom: clamp(primary.cameraZoom + secondary.cameraZoom, -DEFAULT_INPUT_POLICY.maxZoomRate, DEFAULT_INPUT_POLICY.maxZoomRate),
    held,
    pressed,
    released,
    sequence: Math.max(primary.sequence, secondary.sequence, sequence),
    timestampSeconds: Math.max(primary.timestampSeconds, secondary.timestampSeconds),
  }));
};

export class StrictInputRuntime {
  #policy: InputPolicy;
  #sequence = 0;
  #previousHeld = new Set<GameplayAction>();
  #lastAcceptedTimestamp = 0;
  #droppedSamples = 0;
  #disposed = false;

  constructor(policy: InputPolicy = DEFAULT_INPUT_POLICY) {
    this.#policy = Object.freeze({ ...policy });
  }

  submit(sample: RawInputSample): Result<InputFrame> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Input runtime is disposed.');
    const timestamp = finiteTimestamp(sample.timestampSeconds);
    if (timestamp + 1e-6 < this.#lastAcceptedTimestamp) {
      this.#droppedSamples += 1;
      return err('INVALID_INPUT', 'Input timestamp moved backwards.', true, {
        timestamp,
        previous: this.#lastAcceptedTimestamp,
      });
    }
    const normalized = normalizeInputSample(sample, ++this.#sequence, this.#policy);
    if (!normalized.ok) {
      this.#droppedSamples += 1;
      return normalized;
    }
    const intent = normalized.value;
    const edges = calculateActionEdges(this.#previousHeld, intent.held);
    this.#previousHeld = new Set(intent.held);
    this.#lastAcceptedTimestamp = Math.max(this.#lastAcceptedTimestamp, intent.timestampSeconds);
    return ok(Object.freeze({
      intent: Object.freeze({
        ...intent,
        pressed: new Set([...intent.pressed, ...edges.pressed]),
        released: new Set([...intent.released, ...edges.released]),
      }),
      accepted: true,
      rejectedActions: [],
    }));
  }

  diagnostics(): Readonly<{ sequence: number; droppedSamples: number; previousHeld: readonly GameplayAction[]; lastTimestamp: number }> {
    return Object.freeze({
      sequence: this.#sequence,
      droppedSamples: this.#droppedSamples,
      previousHeld: Object.freeze([...this.#previousHeld].sort()),
      lastTimestamp: this.#lastAcceptedTimestamp,
    });
  }

  reset(): void {
    this.#previousHeld.clear();
    this.#sequence = 0;
    this.#lastAcceptedTimestamp = 0;
    this.#droppedSamples = 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.#previousHeld.clear();
  }
}

export const actionToken = (action: GameplayAction): string => actionId(action).toString();
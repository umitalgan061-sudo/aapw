import { clamp, clamp01, type R35InputFrame } from './contracts';

export type R35InputDevice = 'keyboard' | 'mouse' | 'gamepad' | 'touch';
export type R35InputAction =
  | 'move-forward'
  | 'move-back'
  | 'move-left'
  | 'move-right'
  | 'look-left'
  | 'look-right'
  | 'look-up'
  | 'look-down'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'dodge'
  | 'attack'
  | 'block'
  | 'interact'
  | 'pause'
  | 'inventory'
  | 'map';

export interface InputBinding {
  readonly action: R35InputAction;
  readonly device: R35InputDevice;
  readonly code: string;
  readonly analog?: 'x' | 'y' | 'value';
  readonly scale: number;
  readonly deadzone: number;
}

export interface RawInputSample {
  readonly device: R35InputDevice;
  readonly code: string;
  readonly pressed?: boolean;
  readonly value?: number;
  readonly x?: number;
  readonly y?: number;
  readonly timestampMs: number;
}

export interface ActionState {
  readonly held: boolean;
  readonly pressed: boolean;
  readonly released: boolean;
  readonly value: number;
  readonly ageTicks: number;
}

export interface NormalizedInput {
  readonly tick: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly buttons: number;
  readonly pressed: readonly R35InputAction[];
  readonly released: readonly R35InputAction[];
  readonly actions: ReadonlyMap<R35InputAction, ActionState>;
}

export interface InputPipelineConfig {
  readonly maxSamplesPerTick: number;
  readonly bufferTicks: number;
  readonly mouseSensitivity: number;
  readonly touchSensitivity: number;
  readonly gamepadSensitivity: number;
  readonly triggerThreshold: number;
  readonly repeatDelayTicks: number;
}

const DEFAULT_BINDINGS: readonly InputBinding[] = [
  { action: 'move-forward', device: 'keyboard', code: 'KeyW', scale: 1, deadzone: 0 },
  { action: 'move-back', device: 'keyboard', code: 'KeyS', scale: -1, deadzone: 0 },
  { action: 'move-left', device: 'keyboard', code: 'KeyA', scale: -1, deadzone: 0 },
  { action: 'move-right', device: 'keyboard', code: 'KeyD', scale: 1, deadzone: 0 },
  { action: 'look-left', device: 'keyboard', code: 'ArrowLeft', scale: -1, deadzone: 0 },
  { action: 'look-right', device: 'keyboard', code: 'ArrowRight', scale: 1, deadzone: 0 },
  { action: 'look-up', device: 'keyboard', code: 'ArrowUp', scale: 1, deadzone: 0 },
  { action: 'look-down', device: 'keyboard', code: 'ArrowDown', scale: -1, deadzone: 0 },
  { action: 'jump', device: 'keyboard', code: 'Space', scale: 1, deadzone: 0 },
  { action: 'sprint', device: 'keyboard', code: 'ShiftLeft', scale: 1, deadzone: 0 },
  { action: 'crouch', device: 'keyboard', code: 'KeyC', scale: 1, deadzone: 0 },
  { action: 'dodge', device: 'keyboard', code: 'AltLeft', scale: 1, deadzone: 0 },
  { action: 'attack', device: 'mouse', code: 'Mouse0', scale: 1, deadzone: 0 },
  { action: 'block', device: 'mouse', code: 'Mouse2', scale: 1, deadzone: 0 },
  { action: 'interact', device: 'keyboard', code: 'KeyE', scale: 1, deadzone: 0 },
  { action: 'pause', device: 'keyboard', code: 'Escape', scale: 1, deadzone: 0 },
  { action: 'inventory', device: 'keyboard', code: 'KeyI', scale: 1, deadzone: 0 },
  { action: 'map', device: 'keyboard', code: 'KeyM', scale: 1, deadzone: 0 },
];

const ACTION_BITS = new Map<R35InputAction, number>([
  ['jump', 1 << 0],
  ['sprint', 1 << 1],
  ['crouch', 1 << 2],
  ['dodge', 1 << 3],
  ['attack', 1 << 4],
  ['block', 1 << 5],
  ['interact', 1 << 6],
  ['pause', 1 << 7],
  ['inventory', 1 << 8],
  ['map', 1 << 9],
]);

function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const normalized = (magnitude - deadzone) / Math.max(1e-6, 1 - deadzone);
  return Math.sign(value) * clamp01(normalized);
}

function actionState(held: boolean, pressed: boolean, released: boolean, value: number, ageTicks: number): ActionState {
  return Object.freeze({ held, pressed, released, value: clamp(value, -1, 1), ageTicks: Math.max(0, ageTicks) });
}

export class R35InputPipeline {
  readonly config: InputPipelineConfig;
  readonly bindings: InputBinding[];
  #queue: RawInputSample[] = [];
  #states = new Map<R35InputAction, { held: boolean; value: number; pressedTick: number; releasedTick: number }>();
  #lastFrame: NormalizedInput | null = null;
  #sequence = 0;
  #lastTick = 0;

  constructor(config?: Partial<InputPipelineConfig>, bindings: readonly InputBinding[] = DEFAULT_BINDINGS) {
    this.config = {
      maxSamplesPerTick: 128,
      bufferTicks: 12,
      mouseSensitivity: 1,
      touchSensitivity: 1.15,
      gamepadSensitivity: 0.9,
      triggerThreshold: 0.5,
      repeatDelayTicks: 24,
      ...config,
    };
    this.bindings = bindings.map((binding) => ({
      ...binding,
      scale: Number.isFinite(binding.scale) ? binding.scale : 1,
      deadzone: clamp01(binding.deadzone),
    }));
  }

  enqueue(sample: RawInputSample): void {
    if (!Number.isFinite(sample.timestampMs)) return;
    if (this.#queue.length >= this.config.maxSamplesPerTick * this.config.bufferTicks) this.#queue.shift();
    this.#queue.push({ ...sample });
  }

  setAction(action: R35InputAction, held: boolean, value = held ? 1 : 0, tick = this.#lastTick): void {
    const current = this.#states.get(action) ?? { held: false, value: 0, pressedTick: -1, releasedTick: -1 };
    if (held !== current.held) {
      if (held) current.pressedTick = tick;
      else current.releasedTick = tick;
    }
    current.held = held;
    current.value = clamp(value, -1, 1);
    this.#states.set(action, current);
  }

  normalize(tick: number): NormalizedInput {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError('tick must be a non-negative integer');
    this.#lastTick = tick;
    const samples = this.consumeSamples();
    for (const sample of samples) this.applySample(sample, tick);
    const moveX = clamp(this.readActionAxis('move-left', 'move-right'), -1, 1);
    const moveY = clamp(this.readActionAxis('move-back', 'move-forward'), -1, 1);
    const lookX = clamp(
      this.aggregateLook(samples, 'look-left', 'look-right', 'x') + this.readActionAxis('look-left', 'look-right'),
      -1,
      1,
    );
    const lookY = clamp(
      this.aggregateLook(samples, 'look-down', 'look-up', 'y') + this.readActionAxis('look-down', 'look-up'),
      -1,
      1,
    );
    const pressed: R35InputAction[] = [];
    const released: R35InputAction[] = [];
    const actionMap = new Map<R35InputAction, ActionState>();

    for (const action of ACTION_BITS.keys()) {
      const state = this.#states.get(action) ?? { held: false, value: 0, pressedTick: -1, releasedTick: -1 };
      const justPressed = state.pressedTick === tick;
      const justReleased = state.releasedTick === tick;
      if (justPressed) pressed.push(action);
      if (justReleased) released.push(action);
      actionMap.set(
        action,
        actionState(
          state.held,
          justPressed,
          justReleased,
          state.value,
          state.held ? tick - state.pressedTick : tick - state.releasedTick,
        ),
      );
    }

    const finalButtons = pressed.reduce((mask, action) => mask | (ACTION_BITS.get(action) ?? 0), 0);
    const frame: NormalizedInput = Object.freeze({
      tick,
      moveX: clamp(moveX + this.readActionAxis('move-left', 'move-right'), -1, 1),
      moveY: clamp(moveY + this.readActionAxis('move-back', 'move-forward'), -1, 1),
      lookX,
      lookY,
      buttons: finalButtons >>> 0,
      pressed: Object.freeze(pressed),
      released: Object.freeze(released),
      actions: actionMap,
    });
    this.#lastFrame = frame;
    this.#sequence += 1;
    return frame;
  }

  toRuntimeFrame(tick: number, source: R35InputFrame['source'] = 'mixed'): R35InputFrame {
    const normalized = this.#lastFrame?.tick === tick ? this.#lastFrame : this.normalize(tick);
    return Object.freeze({
      tick,
      sequence: this.#sequence,
      moveX: normalized.moveX,
      moveY: normalized.moveY,
      lookX: normalized.lookX,
      lookY: normalized.lookY,
      buttons: normalized.buttons,
      pressed: normalized.pressed.map(String),
      released: normalized.released.map(String),
      source,
    });
  }

  clear(): void {
    this.#queue.length = 0;
    for (const action of this.#states.values()) {
      action.held = false;
      action.value = 0;
    }
  }

  lastFrame(): NormalizedInput | null {
    return this.#lastFrame;
  }

  private consumeSamples(): RawInputSample[] {
    const samples = this.#queue.splice(0, this.config.maxSamplesPerTick);
    samples.sort((a, b) => a.timestampMs - b.timestampMs);
    return samples;
  }

  private aggregateLook(
    samples: readonly RawInputSample[],
    negative: R35InputAction,
    positive: R35InputAction,
    axis: 'x' | 'y',
  ): number {
    let value = 0;
    for (const sample of samples) {
      const binding = this.bindings.find((entry) => entry.action === negative || entry.action === positive);
      if (!binding || binding.device !== sample.device || binding.code !== sample.code || !binding.analog) continue;
      const raw = axis === 'x' ? sample.x ?? 0 : sample.y ?? 0;
      const sensitivity =
        sample.device === 'mouse'
          ? this.config.mouseSensitivity
          : sample.device === 'touch'
            ? this.config.touchSensitivity
            : this.config.gamepadSensitivity;
      const normalized = applyDeadzone(raw * sensitivity, binding.deadzone) * binding.scale;
      value += normalized;
    }
    return clamp(value, -1, 1);
  }

  private readActionAxis(negative: R35InputAction, positive: R35InputAction): number {
    return clamp((this.#states.get(positive)?.value ?? 0) + (this.#states.get(negative)?.value ?? 0), -1, 1);
  }

  private applySample(sample: RawInputSample, tick: number): void {
    const matching = this.bindings.filter(
      (binding) => binding.device === sample.device && binding.code === sample.code,
    );
    for (const binding of matching) {
      if (binding.analog) {
        const raw = binding.analog === 'x' ? sample.x ?? 0 : binding.analog === 'y' ? sample.y ?? 0 : sample.value ?? 0;
        const sensitivity =
          sample.device === 'mouse'
            ? this.config.mouseSensitivity
            : sample.device === 'touch'
              ? this.config.touchSensitivity
              : this.config.gamepadSensitivity;
        const value = applyDeadzone(raw * sensitivity, binding.deadzone) * binding.scale;
        this.setAction(binding.action, Math.abs(value) >= this.config.triggerThreshold, value, tick);
        continue;
      }
      const held = sample.pressed ?? false;
      this.setAction(binding.action, held, held ? binding.scale : 0, tick);
    }
  }
}

export function createR35InputPipeline(config?: Partial<InputPipelineConfig>): R35InputPipeline {
  return new R35InputPipeline(config);
}

export function encodeInputButtons(actions: readonly R35InputAction[]): number {
  return actions.reduce((mask, action) => mask | (ACTION_BITS.get(action) ?? 0), 0) >>> 0;
}

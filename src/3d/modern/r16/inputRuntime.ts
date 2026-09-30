import { digestValue, normalizeTick, clamp01 } from './deterministic.js';
import type { R16Result, R16Source } from './types.js';

export type R16InputDevice = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'xr' | 'system';
export type R16InputPhase = 'pressed' | 'held' | 'released' | 'analog' | 'pointer';
export type R16InputAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'attack'
  | 'block'
  | 'dodge'
  | 'cameraLook'
  | 'cameraZoom'
  | 'pause'
  | 'accept'
  | 'cancel';

export interface R16InputEnvelope {
  readonly id: string;
  readonly action: R16InputAction;
  readonly device: R16InputDevice;
  readonly phase: R16InputPhase;
  readonly tick: number;
  readonly source: R16Source;
  readonly valueX: number;
  readonly valueY: number;
  readonly strength: number;
  readonly sequence: number;
  readonly digest: string;
}

export interface R16InputBinding {
  readonly action: R16InputAction;
  readonly device: R16InputDevice;
  readonly code: string;
  readonly phase: R16InputPhase;
  readonly scale?: number;
  readonly deadzone?: number;
  readonly chord?: readonly string[];
}

export interface R16InputMap {
  readonly id: string;
  readonly revision: number;
  readonly bindings: readonly R16InputBinding[];
}

export interface R16InputSnapshot {
  readonly tick: number;
  readonly pressed: readonly R16InputAction[];
  readonly held: readonly R16InputAction[];
  readonly released: readonly R16InputAction[];
  readonly analog: Readonly<Record<string, number>>;
  readonly pointer: Readonly<{ x: number; y: number; dx: number; dy: number }>;
  readonly digest: string;
}

export interface R16PointerState {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly buttons: number;
  readonly captured: boolean;
}

export interface R16InputRuntimeConfig {
  readonly maxEvents: number;
  readonly maxBindings: number;
  readonly maxActionLength: number;
  readonly maxQueueSize: number;
  readonly duplicateWindowTicks: number;
  readonly defaultDeadzone: number;
  readonly analogEpsilon: number;
}

const DEFAULT_INPUT_CONFIG: R16InputRuntimeConfig = Object.freeze({
  maxEvents: 2048,
  maxBindings: 256,
  maxActionLength: 64,
  maxQueueSize: 4096,
  duplicateWindowTicks: 2,
  defaultDeadzone: 0.08,
  analogEpsilon: 0.0005,
});

export class R16InputRuntime {
  readonly #config: R16InputRuntimeConfig;
  readonly #bindings = new Map<string, R16InputBinding>();
  readonly #queue: R16InputEnvelope[] = [];
  readonly #dedupe = new Map<string, number>();
  readonly #held = new Set<R16InputAction>();
  readonly #pressed = new Set<R16InputAction>();
  readonly #released = new Set<R16InputAction>();
  readonly #analog = new Map<string, number>();
  #pointer: R16PointerState = Object.freeze({
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    buttons: 0,
    captured: false,
  });
  #sequence = 0;
  #tick = 0;
  #dropped = 0;
  #source: R16Source = 'ui';

  constructor(config: Partial<R16InputRuntimeConfig> = {}) {
    this.#config = Object.freeze({
      ...DEFAULT_INPUT_CONFIG,
      ...sanitizeConfig(config),
    });
  }

  setSource(source: R16Source): void {
    this.#source = source;
  }

  register(binding: R16InputBinding): R16Result<void> {
    const validation = validateBinding(binding, this.#config);

    if (!validation.ok) {
      return validation;
    }

    const key = bindingKey(binding);

    if (!this.#bindings.has(key) && this.#bindings.size >= this.#config.maxBindings) {
      return {
        ok: false,
        error: {
          code: 'INPUT_BINDING_CAP',
          message: 'Input binding capacity reached',
          retryable: true,
        },
      };
    }

    this.#bindings.set(
      key,
      Object.freeze({
        ...binding,
        scale: Number.isFinite(binding.scale) ? binding.scale : 1,
        deadzone: Number.isFinite(binding.deadzone)
          ? clamp01(binding.deadzone ?? this.#config.defaultDeadzone)
          : this.#config.defaultDeadzone,
        chord: binding.chord ? Object.freeze([...binding.chord]) : undefined,
      }),
    );

    return {
      ok: true,
      value: undefined,
    };
  }

  unregister(
    action: R16InputAction,
    device: R16InputDevice,
    code: string,
  ): boolean {
    return this.#bindings.delete(
      bindingKey({
        action,
        device,
        code,
        phase: 'pressed',
      }),
    );
  }

  bindings(): readonly R16InputBinding[] {
    return Object.freeze(
      [...this.#bindings.values()].sort(
        (left, right) =>
          left.action.localeCompare(right.action) ||
          left.device.localeCompare(right.device) ||
          left.code.localeCompare(right.code),
      ),
    );
  }

  beginTick(tick: number): void {
    this.#tick = normalizeTick(tick);
    this.#pressed.clear();
    this.#released.clear();

    for (const key of [...this.#dedupe.keys()]) {
      const acceptedTick = this.#dedupe.get(key) ?? -1;

      if (acceptedTick < this.#tick - this.#config.duplicateWindowTicks) {
        this.#dedupe.delete(key);
      }
    }
  }

  pushDigital(
    action: R16InputAction,
    phase: Extract<R16InputPhase, 'pressed' | 'held' | 'released'>,
    device: R16InputDevice,
    code: string,
    value = 1,
  ): R16Result<R16InputEnvelope> {
    return this.push({
      action,
      phase,
      device,
      code,
      valueX: value,
      valueY: 0,
      strength: Math.abs(value),
    });
  }

  pushAnalog(
    action: R16InputAction,
    device: R16InputDevice,
    code: string,
    x: number,
    y: number,
    deadzone = this.#config.defaultDeadzone,
  ): R16Result<R16InputEnvelope> {
    const magnitude = Math.hypot(x, y);
    const normalizedDeadzone = clamp01(deadzone);

    if (magnitude <= normalizedDeadzone) {
      return this.push({
        action,
        phase: 'analog',
        device,
        code,
        valueX: 0,
        valueY: 0,
        strength: 0,
      });
    }

    const remappedStrength = Math.min(
      1,
      (magnitude - normalizedDeadzone) /
        Math.max(0.0001, 1 - normalizedDeadzone),
    );

    const scale = remappedStrength / Math.max(0.0001, magnitude);

    return this.push({
      action,
      phase: 'analog',
      device,
      code,
      valueX: x * scale,
      valueY: y * scale,
      strength: remappedStrength,
    });
  }

  pushPointer(
    x: number,
    y: number,
    buttons: number,
    device: Extract<R16InputDevice, 'mouse' | 'touch' | 'xr'> = 'mouse',
  ): R16Result<R16InputEnvelope> {
    const nextX = finite(x);
    const nextY = finite(y);
    const dx = nextX - this.#pointer.x;
    const dy = nextY - this.#pointer.y;

    this.#pointer = Object.freeze({
      x: nextX,
      y: nextY,
      dx,
      dy,
      buttons: Math.max(0, Math.trunc(buttons)),
      captured: this.#pointer.captured,
    });

    const action = buttons > 0 ? 'cameraLook' : 'cameraLook';

    return this.push({
      action,
      phase: 'pointer',
      device,
      code: 'pointer',
      valueX: dx,
      valueY: dy,
      strength: Math.min(1, Math.hypot(dx, dy) / 32),
    });
  }

  capturePointer(captured: boolean): void {
    this.#pointer = Object.freeze({
      ...this.#pointer,
      captured,
    });
  }

  push(input: {
    readonly action: R16InputAction;
    readonly phase: R16InputPhase;
    readonly device: R16InputDevice;
    readonly code: string;
    readonly valueX: number;
    readonly valueY: number;
    readonly strength: number;
  }): R16Result<R16InputEnvelope> {
    const binding = this.resolveBinding(
      input.action,
      input.device,
      input.code,
      input.phase,
    );

    if (!binding.ok) {
      return binding;
    }

    const bindingValue = binding.value;

    if (bindingValue.chord && !this.chordSatisfied(bindingValue.chord)) {
      return {
        ok: false,
        error: {
          code: 'INPUT_CHORD',
          message: 'Required input chord is not satisfied',
          retryable: false,
        },
      };
    }

    const scaledX =
      finite(input.valueX) *
      (Number.isFinite(bindingValue.scale) ? bindingValue.scale ?? 1 : 1);
    const scaledY =
      finite(input.valueY) *
      (Number.isFinite(bindingValue.scale) ? bindingValue.scale ?? 1 : 1);
    const strength = clamp01(
      Number.isFinite(input.strength) ? input.strength : 0,
    );

    const dedupeKey = [
      input.action,
      input.device,
      input.code,
      input.phase,
      scaledX.toFixed(4),
      scaledY.toFixed(4),
      this.#tick,
    ].join('|');

    const previous = this.#dedupe.get(dedupeKey);

    if (previous !== undefined) {
      return {
        ok: false,
        error: {
          code: 'INPUT_DUPLICATE',
          message: 'Duplicate input event suppressed',
          retryable: false,
        },
      };
    }

    this.#dedupe.set(dedupeKey, this.#tick);

    if (this.#queue.length >= this.#config.maxQueueSize) {
      this.#queue.shift();
      this.#dropped += 1;
    }

    const envelope: R16InputEnvelope = Object.freeze({
      id: this.#nextId(),
      action: input.action,
      device: input.device,
      phase: input.phase,
      tick: this.#tick,
      source: this.#source,
      valueX: scaledX,
      valueY: scaledY,
      strength,
      sequence: this.#sequence,
      digest: digestValue({
        action: input.action,
        device: input.device,
        code: input.code,
        phase: input.phase,
        tick: this.#tick,
        valueX: scaledX,
        valueY: scaledY,
        strength,
      }),
    });

    this.#queue.push(envelope);
    this.updateActionState(envelope);
    return {
      ok: true,
      value: envelope,
    };
  }

  drain(limit = this.#config.maxEvents): readonly R16InputEnvelope[] {
    const count = Math.max(1, Math.trunc(limit));
    const events = this.#queue.splice(0, count);

    return Object.freeze(events);
  }

  snapshot(): R16InputSnapshot {
    const pressed = [...this.#pressed].sort();
    const held = [...this.#held].sort();
    const released = [...this.#released].sort();
    const analog = Object.fromEntries(
      [...this.#analog.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );

    return Object.freeze({
      tick: this.#tick,
      pressed: Object.freeze(pressed),
      held: Object.freeze(held),
      released: Object.freeze(released),
      analog: Object.freeze(analog),
      pointer: Object.freeze({
        x: this.#pointer.x,
        y: this.#pointer.y,
        dx: this.#pointer.dx,
        dy: this.#pointer.dy,
      }),
      digest: digestValue({
        tick: this.#tick,
        pressed,
        held,
        released,
        analog,
        pointer: this.#pointer,
      }),
    });
  }

  stats(): Readonly<{
    bindings: number;
    queued: number;
    dropped: number;
    held: number;
    analog: number;
    pointerCaptured: boolean;
  }> {
    return Object.freeze({
      bindings: this.#bindings.size,
      queued: this.#queue.length,
      dropped: this.#dropped,
      held: this.#held.size,
      analog: this.#analog.size,
      pointerCaptured: this.#pointer.captured,
    });
  }

  clear(): void {
    this.#bindings.clear();
    this.#queue.length = 0;
    this.#dedupe.clear();
    this.#held.clear();
    this.#pressed.clear();
    this.#released.clear();
    this.#analog.clear();
    this.#sequence = 0;
    this.#tick = 0;
    this.#dropped = 0;
    this.#pointer = Object.freeze({
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      buttons: 0,
      captured: false,
    });
  }

  resolveBinding(
    action: R16InputAction,
    device: R16InputDevice,
    code: string,
    phase: R16InputPhase,
  ): R16Result<R16InputBinding> {
    const exact = this.#bindings.get(
      bindingKey({
        action,
        device,
        code,
        phase,
      }),
    );

    if (exact) {
      return {
        ok: true,
        value: exact,
      };
    }

    const heldFallback = this.#bindings.get(
      bindingKey({
        action,
        device,
        code,
        phase: 'held',
      }),
    );

    if (heldFallback) {
      return {
        ok: true,
        value: heldFallback,
      };
    }

    return {
      ok: false,
      error: {
        code: 'INPUT_BINDING_MISSING',
        message: 'Input binding is not registered',
        retryable: false,
      },
    };
  }

  chordSatisfied(chord: readonly string[]): boolean {
    if (chord.length === 0) {
      return true;
    }

    return chord.every((code) =>
      [...this.#bindings.values()].some(
        (binding) =>
          binding.code === code &&
          this.#held.has(binding.action),
      ),
    );
  }

  #nextId(): string {
    this.#sequence += 1;
    return 'input-' + this.#tick.toString(36) + '-' + this.#sequence.toString(36);
  }

  updateActionState(event: R16InputEnvelope): void {
    if (event.phase === 'pressed') {
      this.#pressed.add(event.action);
      this.#held.add(event.action);
      this.#released.delete(event.action);
    }

    if (event.phase === 'held') {
      this.#held.add(event.action);
    }

    if (event.phase === 'released') {
      this.#released.add(event.action);
      this.#held.delete(event.action);
    }

    if (event.phase === 'analog') {
      const current = this.#analog.get(event.action) ?? 0;
      const value = Math.abs(event.valueX) > Math.abs(current)
        ? event.valueX
        : current;
      this.#analog.set(
        event.action,
        Math.abs(value) >= this.#config.analogEpsilon ? value : 0,
      );
    }
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function bindingKey(binding: Pick<R16InputBinding, 'action' | 'device' | 'code' | 'phase'>): string {
  return [
    binding.action,
    binding.device,
    binding.code.slice(0, 96),
    binding.phase,
  ].join('|');
}

function validateBinding(
  binding: R16InputBinding,
  config: R16InputRuntimeConfig,
): R16Result<void> {
  if (!binding.action || binding.action.length > config.maxActionLength) {
    return {
      ok: false,
      error: {
        code: 'INPUT_ACTION_INVALID',
        message: 'Input action is invalid',
        retryable: false,
      },
    };
  }

  if (!binding.code || binding.code.length > 96) {
    return {
      ok: false,
      error: {
        code: 'INPUT_CODE_INVALID',
        message: 'Input code is invalid',
        retryable: false,
      },
    };
  }

  if (
    binding.scale !== undefined &&
    (!Number.isFinite(binding.scale) || Math.abs(binding.scale) > 32)
  ) {
    return {
      ok: false,
      error: {
        code: 'INPUT_SCALE_INVALID',
        message: 'Input binding scale is outside safe bounds',
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    value: undefined,
  };
}

function sanitizeConfig(
  config: Partial<R16InputRuntimeConfig>,
): Partial<R16InputRuntimeConfig> {
  const output: Partial<R16InputRuntimeConfig> = {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }

    (output as Record<string, unknown>)[key] =
      Math.max(0, Math.trunc(value));
  }

  return output;
}

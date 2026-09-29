import type { Vec2 } from './contracts.ts';
import { clamp01 } from './contracts.ts';

export type InputDeviceR25 =
  | 'keyboard'
  | 'mouse'
  | 'touch'
  | 'gamepad'
  | 'wheel'
  | 'virtual';

export type IntentKindR25 =
  | 'move'
  | 'look'
  | 'aim'
  | 'jump'
  | 'dodge'
  | 'interact'
  | 'attack'
  | 'block'
  | 'sprint'
  | 'pause'
  | 'menu'
  | 'camera'
  | 'unknown';

export type InputPhaseR25 = 'pressed' | 'released' | 'changed';

export interface RawInputR25 {
  readonly device: InputDeviceR25;
  readonly code: string;
  readonly phase: InputPhaseR25;
  readonly timestampMs: number;
  readonly x?: number;
  readonly y?: number;
  readonly value?: number;
  readonly repeat?: boolean;
}

export interface IntentR25 {
  readonly kind: IntentKindR25;
  readonly phase: InputPhaseR25;
  readonly device: InputDeviceR25;
  readonly timestampMs: number;
  readonly vector: Vec2;
  readonly scalar: number;
  readonly source: string;
  readonly sequence: number;
}

export interface InputSnapshotR25 {
  readonly sequence: number;
  readonly queueLength: number;
  readonly dropped: number;
  readonly active: readonly IntentKindR25[];
  readonly axes: Readonly<Record<string, number>>;
}

export interface InputIntentOptionsR25 {
  readonly maxQueue?: number;
  readonly deadzone?: number;
  readonly axisSmoothing?: number;
  readonly maxLookRate?: number;
  readonly clock?: () => number;
}

const CODE_TO_INTENT: Readonly<Record<string, IntentKindR25>> = Object.freeze({
  KeyW: 'move',
  KeyA: 'move',
  KeyS: 'move',
  KeyD: 'move',
  ArrowUp: 'move',
  ArrowDown: 'move',
  ArrowLeft: 'move',
  ArrowRight: 'move',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'interact',
  KeyF: 'interact',
  KeyQ: 'dodge',
  KeyR: 'attack',
  Mouse0: 'attack',
  Mouse1: 'block',
  Mouse2: 'aim',
  Escape: 'pause',
  F1: 'menu',
  F2: 'menu',
  F3: 'camera',
  F4: 'camera',
});

const KEY_TO_VECTOR: Readonly<Record<string, Vec2>> = Object.freeze({
  KeyW: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyS: { x: 0, y: -1 },
  KeyD: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowDown: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
});

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function axis(value: number, deadzone: number): number {
  const n = Math.max(-1, Math.min(1, finite(value, 0)));
  const magnitude = Math.abs(n);
  if (magnitude <= deadzone) return 0;
  const normalized = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(n) * normalized;
}

function vectorMagnitude(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

function normalizeVector(vector: Vec2): Vec2 {
  const magnitude = vectorMagnitude(vector);
  if (magnitude <= 1) return freeze(vector);
  return freeze({
    x: vector.x / magnitude,
    y: vector.y / magnitude,
  });
}

export class InputIntentR25 {
  readonly #maxQueue: number;
  readonly #deadzone: number;
  readonly #smoothing: number;
  readonly #maxLookRate: number;
  readonly #clock: () => number;
  readonly #queue: IntentR25[] = [];
  readonly #pressed = new Set<IntentKindR25>();
  readonly #axes = new Map<string, number>();
  #sequence = 0;
  #dropped = 0;
  #disposed = false;

  public constructor(options: InputIntentOptionsR25 = {}) {
    this.#maxQueue = Math.max(16, Math.trunc(finite(options.maxQueue, 512)));
    this.#deadzone = Math.max(0, Math.min(0.5, finite(options.deadzone, 0.12)));
    this.#smoothing = Math.max(0.01, Math.min(1, finite(options.axisSmoothing, 0.25)));
    this.#maxLookRate = Math.max(0.01, finite(options.maxLookRate, 4));
    this.#clock = options.clock ?? (() => globalThis.performance?.now?.() ?? Date.now());
  }

  public enqueue(raw: RawInputR25): IntentR25 | null {
    this.#assertLive();
    const intent = this.#normalize(raw);
    if (!intent) return null;

    if (intent.phase === 'pressed') this.#pressed.add(intent.kind);
    if (intent.phase === 'released') this.#pressed.delete(intent.kind);

    if (intent.kind === 'move' || intent.kind === 'look') {
      this.#coalesce(intent.kind, intent);
      return intent;
    }

    if (this.#queue.length >= this.#maxQueue) {
      this.#queue.shift();
      this.#dropped += 1;
    }

    this.#queue.push(intent);
    return intent;
  }

  public enqueueMove(
    x: number,
    y: number,
    phase: InputPhaseR25 = 'changed',
    device: InputDeviceR25 = 'virtual',
  ): IntentR25 | null {
    return this.enqueue({
      device,
      code: 'MoveAxis',
      phase,
      timestampMs: this.#clock(),
      x,
      y,
    });
  }

  public enqueueLook(
    x: number,
    y: number,
    phase: InputPhaseR25 = 'changed',
    device: InputDeviceR25 = 'mouse',
  ): IntentR25 | null {
    return this.enqueue({
      device,
      code: 'LookAxis',
      phase,
      timestampMs: this.#clock(),
      x,
      y,
    });
  }

  public drain(max = this.#maxQueue): readonly IntentR25[] {
    this.#assertLive();
    const count = Math.max(0, Math.trunc(max));
    return freeze(this.#queue.splice(0, count));
  }

  public peek(): readonly IntentR25[] {
    return freeze([...this.#queue]);
  }

  public isPressed(kind: IntentKindR25): boolean {
    return this.#pressed.has(kind);
  }

  public axisValue(name: string): number {
    return this.#axes.get(name) ?? 0;
  }

  public snapshot(): InputSnapshotR25 {
    return freeze({
      sequence: this.#sequence,
      queueLength: this.#queue.length,
      dropped: this.#dropped,
      active: freeze([...this.#pressed].sort()),
      axes: freeze(Object.fromEntries(
        [...this.#axes.entries()].sort(([a], [b]) => a.localeCompare(b)),
      )),
    });
  }

  public reset(): void {
    this.#queue.length = 0;
    this.#pressed.clear();
    this.#axes.clear();
    this.#dropped = 0;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.reset();
  }

  #normalize(raw: RawInputR25): IntentR25 | null {
    const timestampMs = Math.max(0, finite(raw.timestampMs, this.#clock()));
    let kind: IntentKindR25 = CODE_TO_INTENT[raw.code] ?? 'unknown';
    let vector: Vec2 = freeze({
      x: finite(raw.x, 0),
      y: finite(raw.y, 0),
    });
    let scalar = clamp01(Math.abs(finite(raw.value, 0)));

    if (raw.code === 'MoveAxis') {
      kind = 'move';
      vector = normalizeVector(freeze({
        x: axis(finite(raw.x, 0), this.#deadzone),
        y: axis(finite(raw.y, 0), this.#deadzone),
      }));
      scalar = vectorMagnitude(vector);
      this.#setAxis('move.x', vector.x);
      this.#setAxis('move.y', vector.y);
    } else if (raw.code === 'LookAxis') {
      kind = 'look';
      vector = freeze({
        x: Math.max(-this.#maxLookRate, Math.min(this.#maxLookRate, finite(raw.x, 0))),
        y: Math.max(-this.#maxLookRate, Math.min(this.#maxLookRate, finite(raw.y, 0))),
      });
      scalar = Math.min(1, vectorMagnitude(vector) / this.#maxLookRate);
      this.#setAxis('look.x', vector.x);
      this.#setAxis('look.y', vector.y);
    } else if (raw.device === 'keyboard') {
      const source = KEY_TO_VECTOR[raw.code];
      if (source) {
        vector = source;
        scalar = vectorMagnitude(vector);
        this.#setAxis(`key.${raw.code}`, raw.phase === 'released' ? 0 : scalar);
      }
    } else if (kind === 'unknown') {
      return null;
    }

    return freeze({
      kind,
      phase: raw.phase,
      device: raw.device,
      timestampMs,
      vector,
      scalar,
      source: raw.code.slice(0, 96),
      sequence: ++this.#sequence,
    });
  }

  #coalesce(kind: IntentKindR25, incoming: IntentR25): void {
    const index = this.#queue.findIndex((intent) => (
      intent.kind === kind && intent.phase === 'changed'
    ));
    if (index >= 0) {
      this.#queue[index] = incoming;
    } else if (this.#queue.length >= this.#maxQueue) {
      this.#queue.shift();
      this.#queue.push(incoming);
      this.#dropped += 1;
    } else {
      this.#queue.push(incoming);
    }
  }

  #setAxis(name: string, target: number): void {
    const previous = this.#axes.get(name) ?? 0;
    const next = previous + (target - previous) * this.#smoothing;
    this.#axes.set(name, Math.abs(next) < 0.0001 ? 0 : next);
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_INPUT_DISPOSED');
  }
}

export function keyboardInput(
  code: string,
  phase: InputPhaseR25,
  timestampMs: number,
): RawInputR25 {
  return freeze({
    device: 'keyboard',
    code,
    phase,
    timestampMs: Math.max(0, finite(timestampMs, 0)),
  });
}

export function pointerInput(
  button: number,
  phase: InputPhaseR25,
  timestampMs: number,
): RawInputR25 {
  return freeze({
    device: 'mouse',
    code: `Mouse${Math.max(0, Math.trunc(button))}`,
    phase,
    timestampMs: Math.max(0, finite(timestampMs, 0)),
  });
}

export function gamepadAxisInput(
  axisIndex: number,
  value: number,
  timestampMs: number,
): RawInputR25 {
  return freeze({
    device: 'gamepad',
    code: `GamepadAxis${Math.max(0, Math.trunc(axisIndex))}`,
    phase: 'changed',
    timestampMs: Math.max(0, finite(timestampMs, 0)),
    value: Math.max(-1, Math.min(1, finite(value, 0))),
  });
}

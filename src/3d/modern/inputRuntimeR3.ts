import type { InputPort, InputSample } from './portsR3.ts';

export type InputPhase = 'started' | 'changed' | 'ended';
export type InputDevice = InputSample['source'];

export interface RawInputEvent {
  readonly action: string;
  readonly value: number;
  readonly phase: InputPhase;
  readonly source: InputDevice;
  readonly code?: string;
  readonly atMs?: number;
}

export interface InputActionState {
  readonly action: string;
  readonly value: number;
  readonly pressed: boolean;
  readonly justPressed: boolean;
  readonly justReleased: boolean;
  readonly source: InputDevice;
  readonly lastChangedAtMs: number;
  readonly repeatCount: number;
}

export interface InputRuntimeSnapshot {
  readonly enabled: boolean;
  readonly frame: number;
  readonly actions: readonly InputActionState[];
  readonly droppedEvents: number;
  readonly consumedEvents: number;
}

export interface BindingRule {
  readonly action: string;
  readonly codes: readonly string[];
  readonly scale: number;
  readonly deadZone: number;
  readonly digital: boolean;
}

export interface InputRuntimeOptions {
  readonly maxQueueSize?: number;
  readonly repeatDelayMs?: number;
  readonly repeatIntervalMs?: number;
  readonly maxActionValue?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export class InputRuntimeR3 implements InputPort {
  readonly #states = new Map<string, InputActionState>();
  readonly #bindings = new Map<string, BindingRule[]>();
  readonly #queue: InputSample[] = [];
  readonly #maxQueueSize: number;
  readonly #repeatDelayMs: number;
  readonly #repeatIntervalMs: number;
  readonly #maxActionValue: number;
  #enabled = true;
  #frame = 0;
  #droppedEvents = 0;
  #consumedEvents = 0;
  #lastNowMs = 0;

  constructor(options: InputRuntimeOptions = {}) {
    this.#maxQueueSize = Math.max(16, Math.floor(options.maxQueueSize ?? 512));
    this.#repeatDelayMs = Math.max(50, options.repeatDelayMs ?? 350);
    this.#repeatIntervalMs = Math.max(16, options.repeatIntervalMs ?? 80);
    this.#maxActionValue = Math.max(1, options.maxActionValue ?? 1);
  }

  bind(rule: BindingRule): void {
    const action = rule.action.trim();
    if (!action) throw new Error('Input binding action cannot be empty.');
    const normalized: BindingRule = {
      action,
      codes: [...new Set(rule.codes.map((code) => code.trim()).filter(Boolean))],
      scale: Number.isFinite(rule.scale) ? rule.scale : 1,
      deadZone: clamp(Number.isFinite(rule.deadZone) ? rule.deadZone : 0, 0, 0.95),
      digital: rule.digital,
    };
    const list = this.#bindings.get(action) ?? [];
    list.push(normalized);
    this.#bindings.set(action, list);
  }

  unbind(action: string): void {
    this.#bindings.delete(action);
    this.#states.delete(action);
  }

  clearBindings(): void {
    this.#bindings.clear();
  }

  ingest(event: RawInputEvent): boolean {
    if (!this.#enabled) return false;
    const source = event.source;
    const atMs = Number.isFinite(event.atMs) ? Math.max(0, event.atMs as number) : this.#lastNowMs;
    const value = this.#normalizeValue(event.value, source);
    const sample: InputSample = {
      action: event.action.trim(),
      value,
      source,
      ...(event.code ? { code: event.code.trim() } : {}),
      atMs,
    };
    if (!sample.action) return false;
    if (this.#queue.length >= this.#maxQueueSize) {
      this.#queue.shift();
      this.#droppedEvents += 1;
    }
    this.#queue.push(sample);
    this.#applySample(sample, event.phase);
    return true;
  }

  ingestCode(code: string, value: number, source: InputDevice, atMs?: number): number {
    let count = 0;
    for (const rules of this.#bindings.values()) {
      for (const rule of rules) {
        if (!rule.codes.includes(code)) continue;
        const scaled = rule.digital ? Math.sign(value) * Math.abs(rule.scale) : value * rule.scale;
        if (Math.abs(scaled) < rule.deadZone) continue;
        if (this.ingest({ action: rule.action, value: scaled, phase: 'changed', source, code, atMs })) count += 1;
      }
    }
    return count;
  }

  beginFrame(frame: number, nowMs: number): void {
    this.#frame = Math.max(0, Math.floor(frame));
    this.#lastNowMs = Math.max(this.#lastNowMs, Number.isFinite(nowMs) ? nowMs : this.#lastNowMs);
    for (const [action, state] of this.#states) {
      this.#states.set(action, {
        ...state,
        justPressed: false,
        justReleased: false,
      });
    }
  }

  updateRepeat(nowMs: number): void {
    const safeNow = Number.isFinite(nowMs) ? Math.max(this.#lastNowMs, nowMs) : this.#lastNowMs;
    this.#lastNowMs = safeNow;
    for (const [action, state] of this.#states) {
      if (!state.pressed) continue;
      const heldMs = safeNow - state.lastChangedAtMs;
      if (heldMs < this.#repeatDelayMs) continue;
      const repeatAge = heldMs - this.#repeatDelayMs;
      const expectedRepeats = Math.floor(repeatAge / this.#repeatIntervalMs) + 1;
      if (expectedRepeats > state.repeatCount) {
        this.#states.set(action, { ...state, repeatCount: expectedRepeats, justPressed: false, justReleased: false });
      }
    }
  }

  snapshot(): readonly InputSample[] {
    return this.#queue.map((sample) => ({ ...sample }));
  }

  consume(): readonly InputSample[] {
    const output = this.#queue.splice(0, this.#queue.length);
    this.#consumedEvents += output.length;
    return output;
  }

  action(action: string): InputActionState {
    return this.#states.get(action) ?? this.#emptyState(action);
  }

  has(action: string): boolean {
    return this.action(action).pressed;
  }

  value(action: string): number {
    return this.action(action).value;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.flush();
  }

  flush(): void {
    this.#queue.length = 0;
    for (const [action, state] of this.#states) {
      this.#states.set(action, {
        ...state,
        value: 0,
        pressed: false,
        justPressed: false,
        justReleased: state.pressed,
        repeatCount: 0,
      });
    }
  }

  reset(): void {
    this.#states.clear();
    this.#queue.length = 0;
    this.#frame = 0;
    this.#droppedEvents = 0;
    this.#consumedEvents = 0;
    this.#lastNowMs = 0;
  }

  runtimeSnapshot(): InputRuntimeSnapshot {
    return {
      enabled: this.#enabled,
      frame: this.#frame,
      actions: [...this.#states.values()].sort((a, b) => a.action.localeCompare(b.action)),
      droppedEvents: this.#droppedEvents,
      consumedEvents: this.#consumedEvents,
    };
  }

  #applySample(sample: InputSample, phase: InputPhase): void {
    const previous = this.#states.get(sample.action) ?? this.#emptyState(sample.action);
    const nextPressed = phase === 'ended' ? false : Math.abs(sample.value) > 0;
    const nextValue = nextPressed ? clamp(sample.value, -this.#maxActionValue, this.#maxActionValue) : 0;
    this.#states.set(sample.action, {
      action: sample.action,
      value: nextValue,
      pressed: nextPressed,
      justPressed: !previous.pressed && nextPressed,
      justReleased: previous.pressed && !nextPressed,
      source: sample.source,
      lastChangedAtMs: sample.atMs,
      repeatCount: !previous.pressed && nextPressed ? 0 : previous.repeatCount,
    });
  }

  #normalizeValue(value: number, source: InputDevice): number {
    if (!Number.isFinite(value)) return 0;
    const limit = source === 'gamepad' || source === 'virtual' ? this.#maxActionValue * 2 : this.#maxActionValue;
    return clamp(value, -limit, limit);
  }

  #emptyState(action: string): InputActionState {
    return {
      action,
      value: 0,
      pressed: false,
      justPressed: false,
      justReleased: false,
      source: 'virtual',
      lastChangedAtMs: 0,
      repeatCount: 0,
    };
  }
}

export interface DigitalAxisPair {
  readonly negative: string;
  readonly positive: string;
}

export interface MovementVector {
  readonly x: number;
  readonly y: number;
}

export function resolveDigitalAxis(input: InputRuntimeR3, pair: DigitalAxisPair, scale = 1): number {
  const positive = input.value(pair.positive);
  const negative = input.value(pair.negative);
  return clamp((positive - negative) * scale, -1, 1);
}

export function resolveMovementVector(
  input: InputRuntimeR3,
  horizontal: DigitalAxisPair,
  vertical: DigitalAxisPair,
): MovementVector {
  const x = resolveDigitalAxis(input, horizontal);
  const y = resolveDigitalAxis(input, vertical);
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}

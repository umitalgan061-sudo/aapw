/**
 * Modern input pipeline V3.
 *
 * Converts noisy browser/device events into bounded commands with stable
 * sequence numbers, explicit timestamps, repeat suppression and deterministic
 * snapshots. The output surface is deliberately independent of DOM classes so
 * gameplay systems can also feed synthetic input during replay and tests.
 *
 * @module inputPipelineV3
 */

export type InputDevice =
  | 'keyboard'
  | 'mouse'
  | 'touch'
  | 'gamepad'
  | 'synthetic';

export type InputKind =
  | 'button'
  | 'axis'
  | 'pointer'
  | 'gesture';

export type InputPhase = 'pressed' | 'released' | 'changed' | 'repeat';

export type InputEnvelope = {
  readonly sequence: number;
  readonly device: InputDevice;
  readonly kind: InputKind;
  readonly action: string;
  readonly phase: InputPhase;
  readonly value: number;
  readonly x?: number;
  readonly y?: number;
  readonly pressure?: number;
  readonly timestampMs: number;
  readonly source?: string;
};

export type InputActionBinding = {
  readonly action: string;
  readonly sources: readonly string[];
  readonly scale?: number;
  readonly deadZone?: number;
  readonly invert?: boolean;
  readonly repeatable?: boolean;
  readonly consumeOnPress?: boolean;
};

export type InputSnapshot = {
  readonly sequence: number;
  readonly timestampMs: number;
  readonly actions: Readonly<Record<string, number>>;
  readonly pressed: readonly string[];
  readonly released: readonly string[];
  readonly pointer: {
    readonly x: number;
    readonly y: number;
    readonly dx: number;
    readonly dy: number;
    readonly pressure: number;
    readonly active: boolean;
  };
};

export type InputPipelineOptions = {
  readonly maxQueue?: number;
  readonly maxActions?: number;
  readonly deadZone?: number;
  readonly repeatDelayMs?: number;
  readonly repeatIntervalMs?: number;
};

type MutableActionState = {
  value: number;
  lastValue: number;
  pressed: boolean;
  released: boolean;
  repeatAtMs: number | null;
  consumed: boolean;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeAxis = (value: number, deadZone: number): number => {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) {
    return 0;
  }
  const normalized = (magnitude - deadZone) / Math.max(1e-6, 1 - deadZone);
  return Math.sign(value) * clamp(normalized, 0, 1);
};

const normalizeName = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ':');

export class InputPipelineV3 {
  readonly #bindings = new Map<string, InputActionBinding>();
  readonly #sourceToActions = new Map<string, string[]>();
  readonly #queue: InputEnvelope[] = [];
  readonly #actions = new Map<string, MutableActionState>();
  readonly #consumedSequences = new Set<number>();

  readonly #maxQueue: number;
  readonly #maxActions: number;
  readonly #deadZone: number;
  readonly #repeatDelayMs: number;
  readonly #repeatIntervalMs: number;

  #sequence = 0;
  #timestampMs = 0;
  #pointerX = 0;
  #pointerY = 0;
  #previousPointerX = 0;
  #previousPointerY = 0;
  #pointerPressure = 0;
  #pointerActive = false;

  constructor(options: InputPipelineOptions = {}) {
    this.#maxQueue = clamp(Math.floor(options.maxQueue ?? 512), 32, 8192);
    this.#maxActions = clamp(Math.floor(options.maxActions ?? 256), 16, 2048);
    this.#deadZone = clamp(options.deadZone ?? 0.08, 0, 0.75);
    this.#repeatDelayMs = clamp(options.repeatDelayMs ?? 325, 50, 2000);
    this.#repeatIntervalMs = clamp(options.repeatIntervalMs ?? 90, 20, 1000);
  }

  bind(binding: InputActionBinding): () => void {
    const action = normalizeName(binding.action);
    if (!action) {
      throw new Error('Input action cannot be empty');
    }
    if (this.#bindings.has(action)) {
      throw new Error(`Input action already bound: ${action}`);
    }
    if (this.#bindings.size >= this.#maxActions) {
      throw new Error('Input action capacity reached');
    }

    const normalized: InputActionBinding = {
      ...binding,
      action,
      sources: binding.sources.map(normalizeName),
      scale: binding.scale ?? 1,
      deadZone: binding.deadZone ?? this.#deadZone,
      invert: binding.invert ?? false,
      repeatable: binding.repeatable ?? false,
      consumeOnPress: binding.consumeOnPress ?? false,
    };

    this.#bindings.set(action, normalized);
    for (const source of normalized.sources) {
      const actions = this.#sourceToActions.get(source) ?? [];
      actions.push(action);
      actions.sort();
      this.#sourceToActions.set(source, actions);
    }
    this.#actions.set(action, {
      value: 0,
      lastValue: 0,
      pressed: false,
      released: false,
      repeatAtMs: null,
      consumed: false,
    });

    return () => {
      const current = this.#bindings.get(action);
      if (current !== normalized) {
        return;
      }
      this.#bindings.delete(action);
      this.#actions.delete(action);
      for (const source of normalized.sources) {
        const actions = this.#sourceToActions.get(source);
        if (!actions) {
          continue;
        }
        const next = actions.filter((item) => item !== action);
        if (next.length === 0) {
          this.#sourceToActions.delete(source);
        } else {
          this.#sourceToActions.set(source, next);
        }
      }
    };
  }

  enqueue(
    event: Omit<InputEnvelope, 'sequence'> & { sequence?: number },
  ): number {
    const sequence = event.sequence ?? ++this.#sequence;
    this.#sequence = Math.max(this.#sequence, sequence);
    const envelope: InputEnvelope = {
      ...event,
      sequence,
      action: normalizeName(event.action),
      source: event.source ? normalizeName(event.source) : undefined,
      timestampMs: Math.max(0, event.timestampMs),
    };

    if (this.#queue.length >= this.#maxQueue) {
      this.#queue.shift();
    }
    this.#queue.push(envelope);
    return sequence;
  }

  emitButton(
    device: InputDevice,
    source: string,
    phase: Exclude<InputPhase, 'changed'>,
    timestampMs: number,
    value = phase === 'released' ? 0 : 1,
  ): number {
    const normalizedSource = normalizeName(source);
    return this.enqueue({
      device,
      kind: 'button',
      action: normalizedSource,
      phase,
      value: clamp(value, 0, 1),
      timestampMs,
      source: normalizedSource,
    });
  }

  emitAxis(
    device: InputDevice,
    source: string,
    value: number,
    timestampMs: number,
  ): number {
    const normalizedSource = normalizeName(source);
    return this.enqueue({
      device,
      kind: 'axis',
      action: normalizedSource,
      phase: 'changed',
      value: clamp(value, -1, 1),
      timestampMs,
      source: normalizedSource,
    });
  }

  emitPointer(
    device: Extract<InputDevice, 'mouse' | 'touch' | 'synthetic'>,
    source: string,
    x: number,
    y: number,
    timestampMs: number,
    pressure = 0,
  ): number {
    return this.enqueue({
      device,
      kind: 'pointer',
      action: normalizeName(source),
      phase: 'changed',
      value: 0,
      x: safeCoordinate(x),
      y: safeCoordinate(y),
      pressure: clamp(pressure, 0, 1),
      timestampMs,
      source: normalizeName(source),
    });
  }

  step(timestampMs: number): InputSnapshot {
    this.#timestampMs = Math.max(this.#timestampMs, timestampMs);

    for (const state of this.#actions.values()) {
      state.lastValue = state.value;
      state.pressed = false;
      state.released = false;
      state.consumed = false;
    }

    const events = this.#drain(timestampMs);
    for (const event of events) {
      this.#applyPointer(event);
      this.#applyEvent(event);
    }

    this.#emitRepeats(timestampMs);

    const actions: Record<string, number> = {};
    const pressed: string[] = [];
    const released: string[] = [];

    for (const [name, state] of this.#actions) {
      actions[name] = clamp(state.value, -1, 1);
      if (state.pressed) {
        pressed.push(name);
      }
      if (state.released) {
        released.push(name);
      }
    }

    return {
      sequence: this.#sequence,
      timestampMs: this.#timestampMs,
      actions,
      pressed: pressed.sort(),
      released: released.sort(),
      pointer: {
        x: this.#pointerX,
        y: this.#pointerY,
        dx: this.#pointerX - this.#previousPointerX,
        dy: this.#pointerY - this.#previousPointerY,
        pressure: this.#pointerPressure,
        active: this.#pointerActive,
      },
    };
  }

  #drain(timestampMs: number): InputEnvelope[] {
    const ready: InputEnvelope[] = [];
    const pending: InputEnvelope[] = [];

    for (const event of this.#queue) {
      if (event.timestampMs <= timestampMs) {
        ready.push(event);
      } else {
        pending.push(event);
      }
    }

    this.#queue.length = 0;
    this.#queue.push(...pending);
    ready.sort((a, b) => a.timestampMs - b.timestampMs || a.sequence - b.sequence);
    return ready;
  }

  #applyPointer(event: InputEnvelope): void {
    if (event.kind !== 'pointer') {
      return;
    }
    this.#previousPointerX = this.#pointerX;
    this.#previousPointerY = this.#pointerY;
    this.#pointerX = safeCoordinate(event.x ?? 0);
    this.#pointerY = safeCoordinate(event.y ?? 0);
    this.#pointerPressure = clamp(event.pressure ?? 0, 0, 1);
    this.#pointerActive = event.phase !== 'released';
  }

  #applyEvent(event: InputEnvelope): void {
    const source = normalizeName(event.source ?? event.action);
    const actions = this.#sourceToActions.get(source) ?? [];
    for (const action of actions) {
      const binding = this.#bindings.get(action);
      const state = this.#actions.get(action);
      if (!binding || !state) {
        continue;
      }

      let value = event.value * (binding.scale ?? 1);
      if (event.kind === 'axis') {
        value = normalizeAxis(value, binding.deadZone ?? this.#deadZone);
      }
      if (binding.invert) {
        value *= -1;
      }

      if (event.phase === 'pressed') {
        state.pressed = true;
        state.value = Math.max(state.value, value);
        state.repeatAtMs = binding.repeatable
          ? event.timestampMs + this.#repeatDelayMs
          : null;
        if (binding.consumeOnPress) {
          state.consumed = true;
          this.#consumedSequences.add(event.sequence);
        }
      } else if (event.phase === 'released') {
        state.released = true;
        state.value = 0;
        state.repeatAtMs = null;
      } else {
        state.value = clamp(value, -1, 1);
      }
    }
  }

  #emitRepeats(timestampMs: number): void {
    for (const [action, state] of this.#actions) {
      if (state.repeatAtMs === null || state.value === 0) {
        continue;
      }
      const binding = this.#bindings.get(action);
      if (!binding?.repeatable) {
        state.repeatAtMs = null;
        continue;
      }
      let loops = 0;
      while (state.repeatAtMs !== null && timestampMs >= state.repeatAtMs && loops < 8) {
        state.pressed = true;
        state.repeatAtMs += this.#repeatIntervalMs;
        loops += 1;
      }
    }
  }

  consume(action: string): boolean {
    const state = this.#actions.get(normalizeName(action));
    if (!state || state.consumed) {
      return false;
    }
    state.consumed = true;
    return true;
  }

  isDown(action: string): boolean {
    return (this.#actions.get(normalizeName(action))?.value ?? 0) !== 0;
  }

  value(action: string): number {
    return this.#actions.get(normalizeName(action))?.value ?? 0;
  }

  snapshot(): InputSnapshot {
    const actions: Record<string, number> = {};
    const pressed: string[] = [];
    const released: string[] = [];
    for (const [name, state] of this.#actions) {
      actions[name] = state.value;
      if (state.pressed) {
        pressed.push(name);
      }
      if (state.released) {
        released.push(name);
      }
    }
    return {
      sequence: this.#sequence,
      timestampMs: this.#timestampMs,
      actions,
      pressed: pressed.sort(),
      released: released.sort(),
      pointer: {
        x: this.#pointerX,
        y: this.#pointerY,
        dx: this.#pointerX - this.#previousPointerX,
        dy: this.#pointerY - this.#previousPointerY,
        pressure: this.#pointerPressure,
        active: this.#pointerActive,
      },
    };
  }

  clear(): void {
    this.#queue.length = 0;
    this.#consumedSequences.clear();
    this.#timestampMs = 0;
    this.#pointerX = 0;
    this.#pointerY = 0;
    this.#previousPointerX = 0;
    this.#previousPointerY = 0;
    this.#pointerPressure = 0;
    this.#pointerActive = false;
    for (const state of this.#actions.values()) {
      state.value = 0;
      state.lastValue = 0;
      state.pressed = false;
      state.released = false;
      state.repeatAtMs = null;
      state.consumed = false;
    }
  }

  inspectBindings(): readonly InputActionBinding[] {
    return [...this.#bindings.values()].map((binding) => ({
      ...binding,
      sources: [...binding.sources],
    }));
  }
}

function safeCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function createDefaultGameplayBindings(): readonly InputActionBinding[] {
  return [
    { action: 'move:forward', sources: ['key:w', 'gamepad:left-stick-y-negative'], scale: 1 },
    { action: 'move:back', sources: ['key:s', 'gamepad:left-stick-y-positive'], scale: 1 },
    { action: 'move:left', sources: ['key:a', 'gamepad:left-stick-x-negative'], scale: 1 },
    { action: 'move:right', sources: ['key:d', 'gamepad:left-stick-x-positive'], scale: 1 },
    { action: 'sprint', sources: ['key:shift', 'gamepad:button:l3'], repeatable: false },
    { action: 'dodge', sources: ['key:space', 'gamepad:button:a'], consumeOnPress: true },
    { action: 'attack:primary', sources: ['mouse:primary', 'gamepad:button:rt'], consumeOnPress: true },
    { action: 'attack:secondary', sources: ['mouse:secondary', 'gamepad:button:rb'], consumeOnPress: true },
    { action: 'block', sources: ['key:q', 'gamepad:button:lt'] },
    { action: 'interact', sources: ['key:e', 'gamepad:button:x'], consumeOnPress: true },
    { action: 'pause', sources: ['key:escape', 'gamepad:button:start'], consumeOnPress: true },
  ];
}

export function sampleMovementAxes(snapshot: InputSnapshot): {
  readonly x: number;
  readonly y: number;
  readonly magnitude: number;
} {
  const x = clamp((snapshot.actions['move:right'] ?? 0) - (snapshot.actions['move:left'] ?? 0), -1, 1);
  const y = clamp((snapshot.actions['move:forward'] ?? 0) - (snapshot.actions['move:back'] ?? 0), -1, 1);
  const magnitude = Math.min(1, Math.hypot(x, y));
  return { x, y, magnitude };
}

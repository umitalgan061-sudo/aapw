export type InputContextR26 = 'gameplay' | 'menu' | 'editor' | 'debug' | 'vehicle' | 'photo';

export type InputPhaseR26 = 'pressed' | 'released' | 'changed';

export interface RawInputR26 {
  readonly device: 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'virtual';
  readonly code: string;
  readonly phase: InputPhaseR26;
  readonly value?: number;
  readonly x?: number;
  readonly y?: number;
  readonly timestampMs: number;
}

export interface InputActionR26 {
  readonly id: string;
  readonly context: InputContextR26;
  readonly phase: InputPhaseR26;
  readonly value: number;
  readonly x: number;
  readonly y: number;
  readonly source: string;
  readonly sequence: number;
  readonly timestampMs: number;
}

export interface ActionBindingR26 {
  readonly action: string;
  readonly context: InputContextR26;
  readonly device: RawInputR26['device'];
  readonly code: string;
  readonly modifier?: string;
  readonly deadzone?: number;
  readonly scale?: number;
  readonly consume?: boolean;
}

export interface InputSnapshotR26 {
  readonly sequence: number;
  readonly activeContext: InputContextR26;
  readonly pressed: readonly string[];
  readonly axes: Readonly<Record<string, number>>;
  readonly dropped: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const clean = (value: string): string => value.trim().slice(0, 96);

export class InputRuntimeR26 {
  readonly #bindings: ActionBindingR26[] = [];
  readonly #contexts = new Set<InputContextR26>(['gameplay']);
  readonly #pressed = new Set<string>();
  readonly #axes = new Map<string, number>();
  readonly #queue: InputActionR26[] = [];
  readonly #maxQueue: number;
  #context: InputContextR26 = 'gameplay';
  #sequence = 0;
  #dropped = 0;

  constructor(maxQueue = 1024) {
    this.#maxQueue = Math.max(32, Math.floor(maxQueue));
  }

  registerBinding(binding: ActionBindingR26): void {
    const normalized = Object.freeze({
      ...binding,
      action: clean(binding.action),
      context: binding.context,
      device: binding.device,
      code: clean(binding.code),
      ...(binding.modifier ? { modifier: clean(binding.modifier) } : {}),
      deadzone: clamp(binding.deadzone ?? 0.08, 0, 0.5),
      scale: Number.isFinite(binding.scale) ? binding.scale : 1,
      consume: binding.consume !== false,
    });
    if (!normalized.action || !normalized.code) throw new Error('R26_INPUT_BINDING_INVALID');
    this.#bindings.push(normalized);
    this.#bindings.sort((a, b) =>
      a.context.localeCompare(b.context) ||
      a.device.localeCompare(b.device) ||
      a.code.localeCompare(b.code) ||
      a.action.localeCompare(b.action),
    );
  }

  clearBindings(): void {
    this.#bindings.length = 0;
  }

  setContext(context: InputContextR26): void {
    this.#context = context;
    this.#pressed.clear();
  }

  context(): InputContextR26 {
    return this.#context;
  }

  enableContext(context: InputContextR26): void {
    this.#contexts.add(context);
  }

  disableContext(context: InputContextR26): void {
    if (context === 'gameplay') return;
    this.#contexts.delete(context);
  }

  handle(raw: RawInputR26): readonly InputActionR26[] {
    const bindings = this.#bindings.filter((binding) =>
      binding.context === this.#context &&
      this.#contexts.has(binding.context) &&
      binding.device === raw.device &&
      binding.code === clean(raw.code) &&
      (!binding.modifier || this.#pressed.has(binding.modifier)),
    );
    const actions: InputActionR26[] = [];

    for (const binding of bindings) {
      const value = this.#normalize(raw.value ?? 0, binding.deadzone ?? 0.08, binding.scale ?? 1);
      const x = this.#normalize(raw.x ?? 0, binding.deadzone ?? 0.08, binding.scale ?? 1);
      const y = this.#normalize(raw.y ?? 0, binding.deadzone ?? 0.08, binding.scale ?? 1);
      const action = Object.freeze({
        id: binding.action,
        context: this.#context,
        phase: raw.phase,
        value,
        x,
        y,
        source: raw.code.slice(0, 96),
        sequence: ++this.#sequence,
        timestampMs: Math.max(0, Number.isFinite(raw.timestampMs) ? raw.timestampMs : 0),
      });
      actions.push(action);
      this.#enqueue(action);
    }

    this.#updatePressed(raw);
    return Object.freeze(actions);
  }

  press(action: string, timestampMs: number, value = 1): InputActionR26 {
    const result = this.handle({
      device: 'virtual',
      code: clean(action),
      phase: 'pressed',
      value,
      timestampMs,
    })[0];
    if (result) return result;
    const synthetic = Object.freeze({
      id: clean(action),
      context: this.#context,
      phase: 'pressed' as const,
      value: clamp(value, -1, 1),
      x: 0,
      y: 0,
      source: 'virtual',
      sequence: ++this.#sequence,
      timestampMs: Math.max(0, timestampMs),
    });
    this.#enqueue(synthetic);
    this.#pressed.add(synthetic.id);
    return synthetic;
  }

  release(action: string, timestampMs: number): InputActionR26 {
    const synthetic = Object.freeze({
      id: clean(action),
      context: this.#context,
      phase: 'released' as const,
      value: 0,
      x: 0,
      y: 0,
      source: 'virtual',
      sequence: ++this.#sequence,
      timestampMs: Math.max(0, timestampMs),
    });
    this.#enqueue(synthetic);
    this.#pressed.delete(synthetic.id);
    return synthetic;
  }

  setAxis(name: string, value: number): void {
    const key = clean(name);
    const previous = this.#axes.get(key) ?? 0;
    const target = clamp(value, -1, 1);
    this.#axes.set(key, previous + (target - previous) * 0.35);
  }

  axis(name: string): number {
    return this.#axes.get(clean(name)) ?? 0;
  }

  isPressed(action: string): boolean {
    return this.#pressed.has(clean(action));
  }

  drain(limit = this.#maxQueue): readonly InputActionR26[] {
    return Object.freeze(this.#queue.splice(0, Math.max(0, Math.floor(limit))));
  }

  peek(): readonly InputActionR26[] {
    return Object.freeze([...this.#queue]);
  }

  snapshot(): InputSnapshotR26 {
    return Object.freeze({
      sequence: this.#sequence,
      activeContext: this.#context,
      pressed: Object.freeze([...this.#pressed].sort()),
      axes: Object.freeze(Object.fromEntries(
        [...this.#axes.entries()].sort(([a], [b]) => a.localeCompare(b)),
      )),
      dropped: this.#dropped,
    });
  }

  reset(): void {
    this.#pressed.clear();
    this.#axes.clear();
    this.#queue.length = 0;
    this.#dropped = 0;
  }

  serializeActions(actions: readonly InputActionR26[]): string {
    return actions.map((action) => [
      action.sequence,
      action.id,
      action.phase,
      action.value.toFixed(4),
      action.x.toFixed(4),
      action.y.toFixed(4),
      action.timestampMs.toFixed(2),
    ].join('|')).join('\n');
  }

  replay(serialized: string): readonly InputActionR26[] {
    const actions: InputActionR26[] = [];
    for (const line of serialized.split('\n')) {
      const parts = line.split('|');
      if (parts.length < 7) continue;
      const sequence = parts[0];
      const id = parts[1];
      const phase = parts[2];
      const value = parts[3];
      const x = parts[4];
      const y = parts[5];
      const timestamp = parts[6];
      if (!sequence || !id || !phase || !timestamp) continue;
      actions.push(Object.freeze({
        id,
        context: this.#context,
        phase: phase as InputPhaseR26,
        value: Number(value),
        x: Number(x),
        y: Number(y),
        source: 'replay',
        sequence: Number(sequence),
        timestampMs: Number(timestamp),
      }));
    }
    return Object.freeze(actions);
  }

  #normalize(value: number, deadzone: number, scale: number): number {
    const raw = clamp(value, -1, 1);
    const magnitude = Math.abs(raw);
    if (magnitude <= deadzone) return 0;
    const remapped = (magnitude - deadzone) / Math.max(0.0001, 1 - deadzone);
    return clamp(Math.sign(raw) * remapped * scale, -1, 1);
  }

  #updatePressed(raw: RawInputR26): void {
    const code = clean(raw.code);
    if (raw.phase === 'pressed') this.#pressed.add(code);
    if (raw.phase === 'released') this.#pressed.delete(code);
  }

  #enqueue(action: InputActionR26): void {
    if (this.#queue.length >= this.#maxQueue) {
      this.#queue.shift();
      this.#dropped += 1;
    }
    this.#queue.push(action);
  }
}

export const makeKeyboardInputR26 = (
  code: string,
  phase: InputPhaseR26,
  timestampMs: number,
): RawInputR26 => Object.freeze({
  device: 'keyboard',
  code,
  phase,
  timestampMs,
});

export const makeGamepadAxisR26 = (
  axis: number,
  value: number,
  timestampMs: number,
): RawInputR26 => Object.freeze({
  device: 'gamepad',
  code: 'axis:' + String(Math.floor(axis)),
  phase: 'changed',
  value: clamp(value, -1, 1),
  timestampMs,
});

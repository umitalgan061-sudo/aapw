import { clampP, finiteP, integerP, nonNegativeP, type EventSinkP, type InputActionStateP, type InputSampleP } from './contracts.ts';

export type ActionNameP = keyof InputActionStateP;

export interface InputBindingP {
  readonly action: ActionNameP;
  readonly codes: readonly string[];
  readonly axis?: 'x' | 'z' | 'lookX' | 'lookY';
  readonly repeatable: boolean;
  readonly deadzone: number;
  readonly sensitivity: number;
}

export interface RawInputEventP {
  readonly kind: 'key' | 'axis' | 'pointer' | 'touch';
  readonly code?: string;
  readonly action?: ActionNameP;
  readonly value?: number;
  readonly x?: number;
  readonly y?: number;
  readonly timestampMs: number;
}

export interface InputPipelineConfigP {
  readonly maxHistory: number;
  readonly maxRawEvents: number;
  readonly duplicateWindowMs: number;
}

export interface InputPipelineStatsP {
  readonly history: number;
  readonly rawQueued: number;
  readonly droppedRaw: number;
  readonly sequence: number;
  readonly repeatSuppressed: number;
}

const DEFAULTS: InputPipelineConfigP = Object.freeze({ maxHistory: 1024, maxRawEvents: 4096, duplicateWindowMs: 20 });

const DEFAULT_STATE: InputActionStateP = Object.freeze({ moveX: 0, moveZ: 0, lookX: 0, lookY: 0, jump: false, sprint: false, dodge: false, primary: false, secondary: false, interact: false, pause: false });

function normalizeAxis(value: number, deadzone: number, sensitivity: number): number {
  const scaled = clampP(value, -1, 1);
  const magnitude = Math.abs(scaled);
  if (magnitude <= deadzone) return 0;
  const normalized = (magnitude - deadzone) / Math.max(0.0001, 1 - deadzone);
  return Math.sign(scaled) * clampP(normalized * sensitivity, -1, 1);
}

export class ProductionInputPipeline {
  readonly config: InputPipelineConfigP;
  readonly bindings: readonly InputBindingP[];
  readonly #events?: EventSinkP;
  #state: InputActionStateP = DEFAULT_STATE;
  #history: InputSampleP[] = [];
  #raw: RawInputEventP[] = [];
  #sequence = 0;
  #droppedRaw = 0;
  #repeatSuppressed = 0;
  #lastEvent = new Map<string, number>();

  constructor(bindings: readonly InputBindingP[] = defaultBindings(), config: Partial<InputPipelineConfigP> = {}, events?: EventSinkP) {
    this.bindings = Object.freeze([...bindings]);
    this.config = Object.freeze({
      maxHistory: Math.max(32, integerP(config.maxHistory ?? DEFAULTS.maxHistory, DEFAULTS.maxHistory)),
      maxRawEvents: Math.max(64, integerP(config.maxRawEvents ?? DEFAULTS.maxRawEvents, DEFAULTS.maxRawEvents)),
      duplicateWindowMs: Math.max(0, nonNegativeP(config.duplicateWindowMs ?? DEFAULTS.duplicateWindowMs)),
    });
    this.#events = events;
  }

  enqueue(event: RawInputEventP): void {
    const timestamp = Math.max(0, finiteP(event.timestampMs));
    const key = `${event.kind}:${event.code ?? event.action ?? ''}:${Math.round(event.value ?? 0)}`;
    const previous = this.#lastEvent.get(key);
    if (previous !== undefined && timestamp - previous < this.config.duplicateWindowMs) {
      this.#repeatSuppressed += 1;
      return;
    }
    this.#lastEvent.set(key, timestamp);
    if (this.#raw.length >= this.config.maxRawEvents) { this.#raw.shift(); this.#droppedRaw += 1; }
    this.#raw.push(Object.freeze({ ...event, timestampMs: timestamp }));
  }

  press(action: ActionNameP): void { this.#state = Object.freeze({ ...this.#state, [action]: true }); }
  release(action: ActionNameP): void { this.#state = Object.freeze({ ...this.#state, [action]: false }); }
  setAxis(action: Extract<ActionNameP, 'moveX' | 'moveZ' | 'lookX' | 'lookY'>, value: number): void {
    const binding = this.bindings.find(candidate => candidate.action === action);
    const next = normalizeAxis(value, binding?.deadzone ?? 0.12, binding?.sensitivity ?? 1);
    this.#state = Object.freeze({ ...this.#state, [action]: next });
  }

  process(tick: number, timeMs: number): InputSampleP {
    this.#consumeRaw();
    const sample: InputSampleP = Object.freeze({ ...this.#state, tick: Math.max(0, integerP(tick)), sequence: ++this.#sequence, timeMs: Math.max(0, finiteP(timeMs)) });
    if (this.#history.length >= this.config.maxHistory) this.#history.shift();
    this.#history.push(sample);
    this.#events?.emit('input:sample', sample);
    this.#clearOneShotActions();
    return sample;
  }

  history(fromTick = 0): readonly InputSampleP[] {
    const start = Math.max(0, integerP(fromTick));
    return Object.freeze(this.#history.filter(sample => sample.tick >= start));
  }

  replay(samples: readonly InputSampleP[], startTick = 0, onSample?: (sample: InputSampleP) => void): number {
    const filtered = samples.filter(sample => sample.tick >= startTick).sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    for (const sample of filtered) { this.#state = Object.freeze({ moveX: sample.moveX, moveZ: sample.moveZ, lookX: sample.lookX, lookY: sample.lookY, jump: sample.jump, sprint: sample.sprint, dodge: sample.dodge, primary: sample.primary, secondary: sample.secondary, interact: sample.interact, pause: sample.pause }); this.#sequence = Math.max(this.#sequence, sample.sequence); onSample?.(sample); }
    return filtered.length;
  }

  clearHistory(): void { this.#history.length = 0; }
  snapshot(): InputActionStateP { return Object.freeze({ ...this.#state }); }
  stats(): InputPipelineStatsP { return Object.freeze({ history: this.#history.length, rawQueued: this.#raw.length, droppedRaw: this.#droppedRaw, sequence: this.#sequence, repeatSuppressed: this.#repeatSuppressed }); }

  #consumeRaw(): void {
    while (this.#raw.length > 0) {
      const event = this.#raw.shift()!;
      if (event.action) {
        if (event.kind === 'axis') this.setAxis(event.action as Extract<ActionNameP, 'moveX' | 'moveZ' | 'lookX' | 'lookY'>, event.value ?? 0);
        else if ((event.value ?? 1) > 0) this.press(event.action);
        else this.release(event.action);
        continue;
      }
      if (event.kind === 'axis' && event.code) {
        const binding = this.bindings.find(candidate => candidate.codes.includes(event.code));
        if (binding?.axis) this.setAxis(binding.axis, event.value ?? 0);
      }
      if (event.kind === 'key' && event.code) {
        for (const binding of this.bindings) if (binding.codes.includes(event.code)) {
          if (binding.repeatable || (event.value ?? 1) === 1) this.press(binding.action);
        }
      }
    }
  }

  #clearOneShotActions(): void {
    this.#state = Object.freeze({ ...this.#state, jump: false, dodge: false, primary: false, secondary: false, interact: false, pause: false });
  }
}

export function defaultBindings(): readonly InputBindingP[] {
  return Object.freeze([
    { action: 'moveX', codes: ['KeyA', 'KeyD'], axis: 'x', repeatable: true, deadzone: 0.12, sensitivity: 1 },
    { action: 'moveZ', codes: ['KeyW', 'KeyS'], axis: 'z', repeatable: true, deadzone: 0.12, sensitivity: 1 },
    { action: 'lookX', codes: ['PointerX'], axis: 'lookX', repeatable: true, deadzone: 0.02, sensitivity: 1 },
    { action: 'lookY', codes: ['PointerY'], axis: 'lookY', repeatable: true, deadzone: 0.02, sensitivity: 1 },
    { action: 'jump', codes: ['Space'], repeatable: false, deadzone: 0, sensitivity: 1 },
    { action: 'sprint', codes: ['ShiftLeft', 'ShiftRight'], repeatable: true, deadzone: 0, sensitivity: 1 },
    { action: 'dodge', codes: ['ControlLeft', 'ControlRight'], repeatable: false, deadzone: 0, sensitivity: 1 },
    { action: 'primary', codes: ['Mouse0'], repeatable: false, deadzone: 0, sensitivity: 1 },
    { action: 'secondary', codes: ['Mouse2'], repeatable: false, deadzone: 0, sensitivity: 1 },
    { action: 'interact', codes: ['KeyE'], repeatable: false, deadzone: 0, sensitivity: 1 },
    { action: 'pause', codes: ['Escape'], repeatable: false, deadzone: 0, sensitivity: 1 },
  ]);
}

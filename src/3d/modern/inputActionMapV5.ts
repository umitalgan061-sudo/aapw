import {
  type InputDeviceV4,
  type InputModeV4,
  type InputSampleV4,
  type Vec3V4,
  type RuntimeSourceV4,
  vec3V4,
  clampV4,
} from './runtimeContractsV4';

export type ActionValueV5 = number | boolean | Vec3V4;
export type ActionKindV5 = 'digital' | 'analog' | 'axis2d' | 'axis3d';

export interface ActionDefinitionV5 {
  readonly name: string;
  readonly kind: ActionKindV5;
  readonly deadZone: number;
  readonly scale: number;
  readonly repeatDelayMs: number;
  readonly repeatIntervalMs: number;
  readonly modes: readonly InputModeV4[];
}

export interface ActionBindingV5 {
  readonly device: InputDeviceV4;
  readonly code: string;
  readonly action: string;
  readonly component?: 'x' | 'y' | 'z';
  readonly inverted?: boolean;
  readonly priority?: number;
}

export interface ActionEventV5 {
  readonly action: string;
  readonly kind: ActionKindV5;
  readonly value: ActionValueV5;
  readonly previous: ActionValueV5;
  readonly timestamp: number;
  readonly sequence: number;
  readonly source: RuntimeSourceV4;
  readonly repeated: boolean;
}

export interface InputActionMetricsV5 {
  readonly definitions: number;
  readonly bindings: number;
  readonly samples: number;
  readonly actions: number;
  readonly dropped: number;
  readonly repeatEvents: number;
}

export interface InputActionOptionsV5 {
  readonly maxSamples?: number;
  readonly maxEvents?: number;
  readonly now?: () => number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const scalar = (value: ActionValueV5): number => typeof value === 'number' ? value : typeof value === 'boolean' ? Number(value) : Math.hypot(value.x, value.y, value.z);
const sourceForDevice = (device: InputDeviceV4): RuntimeSourceV4 => device === 'xr' || device === 'virtual' ? 'worker' : 'ui';

export class InputActionMapV5 {
  readonly maxSamples: number;
  readonly maxEvents: number;
  #now: () => number;
  #definitions = new Map<string, ActionDefinitionV5>();
  #bindings: ActionBindingV5[] = [];
  #state = new Map<string, ActionValueV5>();
  #lastChanged = new Map<string, number>();
  #samples = 0;
  #events = 0;
  #sequence = 0;
  #dropped = 0;
  #repeatEvents = 0;
  #history: ActionEventV5[] = [];
  #mode: InputModeV4 = 'gameplay';

  constructor(options: InputActionOptionsV5 = {}) {
    this.maxSamples = Math.max(64, Math.trunc(options.maxSamples ?? 4096));
    this.maxEvents = Math.max(64, Math.trunc(options.maxEvents ?? 2048));
    this.#now = options.now ?? (() => performance.now());
  }

  setMode(mode: InputModeV4): void { this.#mode = mode; }
  mode(): InputModeV4 { return this.#mode; }

  define(definition: ActionDefinitionV5): void {
    if (!definition.name.trim()) throw new Error('Action name is required');
    if (this.#definitions.has(definition.name)) throw new Error(`Action already defined: ${definition.name}`);
    this.#definitions.set(definition.name, Object.freeze({ ...definition, deadZone: clampV4(finite(definition.deadZone), 0, 0.95), scale: finite(definition.scale, 1), repeatDelayMs: Math.max(0, finite(definition.repeatDelayMs)), repeatIntervalMs: Math.max(1, finite(definition.repeatIntervalMs)) }));
  }

  redefine(definition: ActionDefinitionV5): void {
    this.#definitions.set(definition.name, Object.freeze({ ...definition, deadZone: clampV4(finite(definition.deadZone), 0, 0.95), scale: finite(definition.scale, 1), repeatDelayMs: Math.max(0, finite(definition.repeatDelayMs)), repeatIntervalMs: Math.max(1, finite(definition.repeatIntervalMs)) }));
  }

  bind(binding: ActionBindingV5): void {
    if (!this.#definitions.has(binding.action)) throw new Error(`Action is not defined: ${binding.action}`);
    const normalized = Object.freeze({ ...binding, priority: Math.trunc(binding.priority ?? 0), inverted: Boolean(binding.inverted) });
    this.#bindings = this.#bindings.filter((entry) => !(entry.device === binding.device && entry.code === binding.code && entry.action === binding.action && entry.component === binding.component));
    this.#bindings.push(normalized);
    this.#bindings.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.device.localeCompare(b.device) || a.code.localeCompare(b.code) || a.action.localeCompare(b.action));
  }

  unbind(device: InputDeviceV4, code: string, action?: string): number {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter((entry) => !(entry.device === device && entry.code === code && (action === undefined || entry.action === action)));
    return before - this.#bindings.length;
  }

  feed(sample: InputSampleV4): readonly ActionEventV5[] {
    this.#samples += 1;
    const bindings = this.#bindings.filter((binding) => binding.device === sample.device && binding.code === sample.code);
    const events: ActionEventV5[] = [];
    for (const binding of bindings) {
      const definition = this.#definitions.get(binding.action);
      if (!definition || !definition.modes.includes(this.#mode)) continue;
      const normalized = this.#value(definition, binding, sample);
      const previous = this.#state.get(binding.action) ?? this.#defaultValue(definition.kind);
      const now = sample.timestamp;
      const changed = this.#changed(definition.kind, previous, normalized);
      const last = this.#lastChanged.get(binding.action) ?? -Infinity;
      let repeated = false;
      if (!changed && sample.pressed && definition.repeatDelayMs > 0 && now - last >= definition.repeatDelayMs && now - last >= definition.repeatIntervalMs) {
        repeated = true;
        this.#repeatEvents += 1;
      }
      if (!changed && !repeated) continue;
      this.#state.set(binding.action, normalized);
      this.#lastChanged.set(binding.action, now);
      const event = Object.freeze({ action: binding.action, kind: definition.kind, value: normalized, previous, timestamp: now, sequence: ++this.#sequence, source: sourceForDevice(sample.device), repeated });
      this.#history.push(event);
      while (this.#history.length > this.maxEvents) { this.#history.shift(); this.#dropped += 1; }
      events.push(event);
      this.#events += 1;
    }
    return Object.freeze(events);
  }

  digital(action: string, pressed: boolean, timestamp = this.#now(), device: InputDeviceV4 = 'virtual', code = action): readonly ActionEventV5[] {
    return this.feed({ device, code, value: pressed ? 1 : 0, pressed, timestamp, sequence: ++this.#sequence });
  }

  analog(action: string, value: number, timestamp = this.#now(), device: InputDeviceV4 = 'virtual', code = action): readonly ActionEventV5[] {
    return this.feed({ device, code, value: clampV4(finite(value), -1, 1), pressed: Math.abs(value) > 0.001, timestamp, sequence: ++this.#sequence });
  }

  actionValue(action: string): ActionValueV5 {
    return this.#state.get(action) ?? this.#defaultValue(this.#definitions.get(action)?.kind ?? 'digital');
  }

  isPressed(action: string): boolean {
    const value = this.actionValue(action);
    return typeof value === 'boolean' ? value : scalar(value) > 0.5;
  }

  history(limit = this.#history.length): readonly ActionEventV5[] { return Object.freeze(this.#history.slice(-Math.max(0, Math.trunc(limit)))); }
  definitions(): readonly ActionDefinitionV5[] { return Object.freeze([...this.#definitions.values()].sort((a, b) => a.name.localeCompare(b.name))); }
  bindings(): readonly ActionBindingV5[] { return Object.freeze(this.#bindings.slice()); }

  metrics(): InputActionMetricsV5 { return Object.freeze({ definitions: this.#definitions.size, bindings: this.#bindings.length, samples: this.#samples, actions: this.#events, dropped: this.#dropped, repeatEvents: this.#repeatEvents }); }

  clearState(): void { this.#state.clear(); this.#lastChanged.clear(); }
  reset(): void { this.#state.clear(); this.#lastChanged.clear(); this.#history.length = 0; this.#samples = 0; this.#events = 0; this.#sequence = 0; this.#dropped = 0; this.#repeatEvents = 0; }

  installGameplayDefaults(): void {
    const digital = (name: string, ...modes: InputModeV4[]) => this.define({ name, kind: 'digital', deadZone: 0.05, scale: 1, repeatDelayMs: 0, repeatIntervalMs: 250, modes: modes.length ? modes : ['gameplay'] });
    const analog = (name: string, ...modes: InputModeV4[]) => this.define({ name, kind: 'analog', deadZone: 0.12, scale: 1, repeatDelayMs: 0, repeatIntervalMs: 100, modes: modes.length ? modes : ['gameplay'] });
    digital('move.forward'); digital('move.backward'); digital('move.left'); digital('move.right'); digital('jump'); digital('sprint'); digital('crouch'); digital('interact'); digital('pause', 'gameplay', 'menu'); analog('look.x'); analog('look.y');
    this.bind({ device: 'keyboard', code: 'KeyW', action: 'move.forward', priority: 100 });
    this.bind({ device: 'keyboard', code: 'KeyS', action: 'move.backward', priority: 100 });
    this.bind({ device: 'keyboard', code: 'KeyA', action: 'move.left', priority: 100 });
    this.bind({ device: 'keyboard', code: 'KeyD', action: 'move.right', priority: 100 });
    this.bind({ device: 'keyboard', code: 'Space', action: 'jump', priority: 100 });
    this.bind({ device: 'keyboard', code: 'ShiftLeft', action: 'sprint', priority: 100 });
    this.bind({ device: 'keyboard', code: 'KeyC', action: 'crouch', priority: 100 });
    this.bind({ device: 'keyboard', code: 'KeyE', action: 'interact', priority: 100 });
    this.bind({ device: 'keyboard', code: 'Escape', action: 'pause', priority: 100 });
    this.bind({ device: 'gamepad', code: 'axis:rightX', action: 'look.x', priority: 80 });
    this.bind({ device: 'gamepad', code: 'axis:rightY', action: 'look.y', priority: 80, inverted: true });
  }

  #defaultValue(kind: ActionKindV5): ActionValueV5 { return kind === 'digital' ? false : kind === 'analog' ? 0 : kind === 'axis2d' ? vec3V4() : vec3V4(); }

  #value(definition: ActionDefinitionV5, binding: ActionBindingV5, sample: InputSampleV4): ActionValueV5 {
    const raw = (binding.inverted ? -1 : 1) * finite(sample.value) * definition.scale;
    const normalized = Math.abs(raw) <= definition.deadZone ? 0 : clampV4(Math.sign(raw) * ((Math.abs(raw) - definition.deadZone) / Math.max(0.001, 1 - definition.deadZone)), -1, 1);
    if (definition.kind === 'digital') return sample.pressed && Math.abs(normalized) > 0 ? true : sample.pressed;
    if (definition.kind === 'axis2d') return binding.component === 'x' ? vec3V4(normalized, 0, 0) : vec3V4(0, normalized, 0);
    if (definition.kind === 'axis3d') return binding.component === 'z' ? vec3V4(0, 0, normalized) : binding.component === 'y' ? vec3V4(0, normalized, 0) : vec3V4(normalized, 0, 0);
    return normalized;
  }

  #changed(kind: ActionKindV5, previous: ActionValueV5, next: ActionValueV5): boolean {
    if (kind === 'digital') return previous !== next;
    if (typeof previous === 'number' && typeof next === 'number') return Math.abs(previous - next) > 0.001;
    if (typeof previous === 'object' && typeof next === 'object') return Math.abs(previous.x - next.x) + Math.abs(previous.y - next.y) + Math.abs(previous.z - next.z) > 0.001;
    return previous !== next;
  }
}

export function createInputActionMapV5(options: InputActionOptionsV5 = {}): InputActionMapV5 { return new InputActionMapV5(options); }

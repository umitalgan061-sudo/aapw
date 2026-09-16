import { clamp, integer, type Disposable, type Tick } from './primitives.js';
import type { InputAction, InputCommand, InputDevice } from './inputReplay.js';

export interface InputBinding { readonly device: InputDevice; readonly code: string; readonly action: InputAction; readonly scale: number; readonly deadzone: number; readonly digital: boolean; }
export interface RoutedInputState { readonly actions: Readonly<Record<InputAction, number>>; readonly axes: Readonly<Record<string, number>>; readonly active: readonly InputAction[]; readonly tick: Tick; readonly revision: number; }
export interface InputRouterStats { readonly bindings: number; readonly routed: number; readonly rejected: number; readonly revisions: number; }

export class DeterministicInputRouter implements Disposable {
  readonly maxBindings: number;
  #bindings: InputBinding[] = [];
  #actions: Record<InputAction, number> = Object.create(null) as Record<InputAction, number>;
  #axes: Record<string, number> = Object.create(null) as Record<string, number>;
  #routed = 0;
  #rejected = 0;
  #revision = 0;
  #disposed = false;
  #tick: Tick = 0 as Tick;

  constructor(maxBindings = 256) {
    this.maxBindings = clamp(integer(maxBindings), 8, 2048);
  }

  bind(binding: InputBinding): boolean {
    if (this.#disposed || this.#bindings.length >= this.maxBindings) return false;
    if (!binding.code || !binding.action) return false;
    if (this.#bindings.some((item) => item.device === binding.device && item.code === binding.code)) return false;
    this.#bindings.push(Object.freeze({ ...binding, scale: clamp(binding.scale, -4, 4), deadzone: clamp(binding.deadzone, 0, .9) }));
    this.#bindings.sort((a, b) => a.device.localeCompare(b.device) || a.code.localeCompare(b.code));
    return true;
  }

  unbind(device: InputDevice, code: string): boolean {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter((binding) => binding.device !== device || binding.code !== code);
    return before !== this.#bindings.length;
  }

  route(command: InputCommand): RoutedInputState | null {
    if (this.#disposed) return null;
    const matches = this.#bindings.filter((binding) => binding.device === command.device && binding.code === command.action);
    if (!matches.length) {
      this.#rejected += 1;
      return null;
    }
    this.#tick = command.tick;
    for (const binding of matches) {
      const raw = binding.digital ? (command.pressed ? 1 : 0) : command.value * binding.scale;
      const value = Math.abs(raw) < binding.deadzone ? 0 : clamp(raw, -1, 1);
      this.#actions[binding.action] = Math.max(this.#actions[binding.action] ?? 0, value);
      if (binding.action === 'move' || binding.action === 'look') this.#axes[binding.action] = value;
    }
    this.#routed += 1;
    this.#revision += 1;
    return this.snapshot();
  }

  inject(action: InputAction, value: number, tick: Tick): RoutedInputState {
    if (!this.#disposed) {
      this.#tick = tick;
      this.#actions[action] = clamp(value, -1, 1);
      this.#revision += 1;
    }
    return this.snapshot();
  }

  endFrame(): RoutedInputState {
    const snapshot = this.snapshot();
    this.#actions = Object.create(null) as Record<InputAction, number>;
    this.#axes = Object.create(null) as Record<string, number>;
    return snapshot;
  }

  snapshot(): RoutedInputState {
    const actions = { ...this.#actions };
    const active = Object.keys(actions).filter((key) => Math.abs(actions[key as InputAction] ?? 0) > .001).sort() as InputAction[];
    return Object.freeze({ actions: Object.freeze(actions), axes: Object.freeze({ ...this.#axes }), active: Object.freeze(active), tick: this.#tick, revision: this.#revision });
  }

  bindings(): readonly InputBinding[] {
    return Object.freeze(this.#bindings.map((binding) => Object.freeze({ ...binding })));
  }

  stats(): InputRouterStats {
    return Object.freeze({ bindings: this.#bindings.length, routed: this.#routed, rejected: this.#rejected, revisions: this.#revision });
  }

  reset(): void {
    this.#actions = Object.create(null) as Record<InputAction, number>;
    this.#axes = Object.create(null) as Record<string, number>;
    this.#revision = 0;
    this.#tick = 0 as Tick;
  }

  dispose(): void {
    this.#disposed = true;
    this.#bindings.length = 0;
    this.reset();
  }
}

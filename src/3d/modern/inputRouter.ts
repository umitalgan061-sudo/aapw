import type { ActionBinding, InputAction, UnixMillis } from './types';
import { platformEvents } from './eventBus';

export interface InputRouterOptions {
  readonly bindings?: readonly ActionBinding[];
  readonly maxActionsPerFrame?: number;
  readonly clock?: () => UnixMillis;
}

const DEFAULT_BINDINGS: readonly ActionBinding[] = [
  { action: 'move.forward', codes: ['KeyW', 'ArrowUp'] },
  { action: 'move.back', codes: ['KeyS', 'ArrowDown'] },
  { action: 'move.left', codes: ['KeyA', 'ArrowLeft'] },
  { action: 'move.right', codes: ['KeyD', 'ArrowRight'] },
  { action: 'interact', codes: ['KeyE'] },
  { action: 'pause', codes: ['Escape'] },
  { action: 'sprint', codes: ['ShiftLeft', 'ShiftRight'] },
];

/** Unified input surface for keyboard, pointer, touch and virtual controls. */
export class InputRouter {
  readonly bindings: readonly ActionBinding[];
  #actions = new Map<string, InputAction>();
  #pressed = new Set<string>();
  #maxActions: number;
  #clock: () => UnixMillis;
  #attachedTarget: Window | HTMLElement | null = null;
  #handlers: Array<[string, EventListener]> = [];

  constructor(options: InputRouterOptions = {}) {
    this.bindings = [...(options.bindings ?? DEFAULT_BINDINGS)];
    this.#maxActions = Math.max(16, Math.floor(options.maxActionsPerFrame ?? 256));
    this.#clock = options.clock ?? (() => Date.now() as UnixMillis);
    this.#validateBindings();
  }

  attach(target: Window | HTMLElement = window): void {
    this.detach();
    this.#attachedTarget = target;
    const keydown = ((event: KeyboardEvent) => {
      if (event.repeat) return;
      this.#pressed.add(event.code);
      this.#publishForCode(event.code, 1, 'keyboard');
    }) as EventListener;
    const keyup = ((event: KeyboardEvent) => {
      this.#pressed.delete(event.code);
      this.#publishForCode(event.code, 0, 'keyboard');
    }) as EventListener;
    target.addEventListener('keydown', keydown);
    target.addEventListener('keyup', keyup);
    target.addEventListener('blur', this.#clearKeyboard as EventListener);
    this.#handlers = [['keydown', keydown], ['keyup', keyup], ['blur', this.#clearKeyboard as EventListener]];
  }

  detach(): void {
    if (!this.#attachedTarget) return;
    for (const [name, handler] of this.#handlers) this.#attachedTarget.removeEventListener(name, handler);
    this.#handlers = [];
    this.#attachedTarget = null;
    this.#pressed.clear();
    this.#actions.clear();
  }

  push(action: Omit<InputAction, 'timestamp'> & { readonly timestamp?: UnixMillis }): boolean {
    if (this.#actions.size >= this.#maxActions && !this.#actions.has(action.action)) return false;
    const event: InputAction = { ...action, timestamp: action.timestamp ?? this.#clock() };
    this.#actions.set(event.action, event);
    platformEvents.emit('input:action', event);
    return true;
  }

  consume(): readonly InputAction[] {
    const actions = [...this.#actions.values()];
    this.#actions.clear();
    return actions;
  }

  isPressed(code: string): boolean {
    return this.#pressed.has(code);
  }

  axis(negativeAction: string, positiveAction: string): number {
    const negative = this.#actions.get(negativeAction)?.value ?? 0;
    const positive = this.#actions.get(positiveAction)?.value ?? 0;
    return Math.max(-1, Math.min(1, positive - negative));
  }

  snapshot(): ReadonlySet<string> {
    return new Set(this.#pressed);
  }

  clear(): void {
    this.#actions.clear();
    this.#pressed.clear();
  }

  #publishForCode(code: string, value: number, source: InputAction['source']): void {
    for (const binding of this.bindings) {
      if (!binding.codes.includes(code)) continue;
      const scale = binding.scale ?? 1;
      this.push({ action: binding.action, value: value * scale, source });
    }
  }

  #clearKeyboard = (): void => {
    for (const code of this.#pressed) this.#publishForCode(code, 0, 'keyboard');
    this.#pressed.clear();
  };

  #validateBindings(): void {
    const actions = new Set<string>();
    for (const binding of this.bindings) {
      if (!binding.action || binding.codes.length === 0) throw new TypeError('Input binding requires action and code');
      if (actions.has(binding.action)) throw new TypeError(`Duplicate input action: ${binding.action}`);
      if (binding.deadZone !== undefined && (binding.deadZone < 0 || binding.deadZone >= 1)) {
        throw new RangeError(`Invalid deadZone for ${binding.action}`);
      }
      actions.add(binding.action);
    }
  }
}

export function applyDeadZone(value: number, deadZone = 0.08): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  const normalized = (magnitude - deadZone) / (1 - deadZone);
  return Math.sign(value) * Math.min(1, normalized);
}

export function radialDeadZone(x: number, y: number, deadZone = 0.1): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= deadZone) return { x: 0, y: 0 };
  const scale = (length - deadZone) / ((1 - deadZone) * Math.max(length, Number.EPSILON));
  return { x: x * scale, y: y * scale };
}

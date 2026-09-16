import { clamp, freeze, type InputSnapshot } from '../domain/contracts.ts';

export type ActionName =
  | 'confirm' | 'cancel' | 'pause' | 'menu' | 'select' | 'attack' | 'heavyAttack'
  | 'block' | 'parry' | 'dodge' | 'interact' | 'cameraLeft' | 'cameraRight'
  | 'cameraUp' | 'cameraDown' | 'zoomIn' | 'zoomOut' | 'nextKingdom' | 'previousKingdom';

export type InputDevice = InputSnapshot['device'];

export interface RawInputEvent {
  readonly device: InputDevice;
  readonly code: string;
  readonly pressed?: boolean;
  readonly value?: number;
  readonly time: number;
  readonly serial: number;
}

export interface ActionBinding {
  readonly action: ActionName;
  readonly device: InputDevice;
  readonly codes: readonly string[];
  readonly deadZone?: number;
  readonly scale?: number;
}

export interface ActionState {
  readonly action: ActionName;
  readonly pressed: boolean;
  readonly justPressed: boolean;
  readonly justReleased: boolean;
  readonly value: number;
  readonly device: InputDevice;
  readonly serial: number;
}

export interface InputFrame {
  readonly sequence: number;
  readonly timestamp: number;
  readonly activeDevice: InputDevice;
  readonly actions: Readonly<Record<ActionName, ActionState>>;
  readonly axes: Readonly<Record<string, number>>;
}

const defaultActions: readonly ActionName[] = [
  'confirm','cancel','pause','menu','select','attack','heavyAttack','block','parry','dodge',
  'interact','cameraLeft','cameraRight','cameraUp','cameraDown','zoomIn','zoomOut','nextKingdom','previousKingdom',
];

export const defaultBindings: readonly ActionBinding[] = Object.freeze([
  { action: 'confirm', device: 'keyboard', codes: ['Enter', 'Space'] },
  { action: 'cancel', device: 'keyboard', codes: ['Escape', 'Backspace'] },
  { action: 'pause', device: 'keyboard', codes: ['Escape', 'KeyP'] },
  { action: 'menu', device: 'keyboard', codes: ['Tab'] },
  { action: 'attack', device: 'keyboard', codes: ['KeyJ', 'Mouse0'] },
  { action: 'heavyAttack', device: 'keyboard', codes: ['KeyK', 'Mouse2'] },
  { action: 'block', device: 'keyboard', codes: ['ShiftLeft', 'Mouse1'] },
  { action: 'parry', device: 'keyboard', codes: ['KeyL'] },
  { action: 'dodge', device: 'keyboard', codes: ['KeySpace'] },
  { action: 'interact', device: 'keyboard', codes: ['KeyE'] },
  { action: 'nextKingdom', device: 'keyboard', codes: ['BracketRight'] },
  { action: 'previousKingdom', device: 'keyboard', codes: ['BracketLeft'] },
  { action: 'zoomIn', device: 'mouse', codes: ['WheelUp'], scale: 1 },
  { action: 'zoomOut', device: 'mouse', codes: ['WheelDown'], scale: 1 },
  { action: 'cameraLeft', device: 'gamepad', codes: ['AxisXNegative'], deadZone: 0.12 },
  { action: 'cameraRight', device: 'gamepad', codes: ['AxisXPositive'], deadZone: 0.12 },
  { action: 'cameraUp', device: 'gamepad', codes: ['AxisYNegative'], deadZone: 0.12 },
  { action: 'cameraDown', device: 'gamepad', codes: ['AxisYPositive'], deadZone: 0.12 },
]);

export class ActionRouter {
  readonly #bindings: readonly ActionBinding[];
  readonly #pressed = new Map<string, boolean>();
  readonly #values = new Map<string, number>();
  readonly #serials = new Map<ActionName, number>();
  readonly #states = new Map<ActionName, ActionState>();
  #sequence = 0;
  #serial = 0;
  #activeDevice: InputDevice = 'unknown';
  #timestamp = 0;
  #disposed = false;

  constructor(bindings: readonly ActionBinding[] = defaultBindings) {
    this.#bindings = bindings.map((binding) => freeze({ ...binding, codes: [...binding.codes] }));
    this.#resetStates();
  }

  feed(event: RawInputEvent): void {
    if (this.#disposed || !event.code) return;
    this.#timestamp = Math.max(this.#timestamp, event.time);
    this.#activeDevice = event.device;
    this.#serial += 1;
    const key = `${event.device}:${event.code}`;
    if (event.value !== undefined) this.#values.set(key, clamp(event.value, -1, 1));
    else this.#pressed.set(key, event.pressed ?? true);
    for (const binding of this.#bindings) {
      if (binding.device !== event.device || !binding.codes.includes(event.code)) continue;
      const pressed = event.value === undefined ? (event.pressed ?? true) : Math.abs(event.value) > (binding.deadZone ?? 0.1);
      const previous = this.#states.get(binding.action);
      const value = event.value === undefined ? (pressed ? (binding.scale ?? 1) : 0) : Math.sign(event.value) * Math.max(0, Math.abs(event.value) - (binding.deadZone ?? 0));
      this.#states.set(binding.action, freeze({
        action: binding.action,
        pressed,
        justPressed: pressed && !previous?.pressed,
        justReleased: !pressed && Boolean(previous?.pressed),
        value: clamp(value, -1, 1),
        device: event.device,
        serial: this.#serial,
      }));
      this.#serials.set(binding.action, this.#serial);
    }
  }

  nextFrame(): InputFrame {
    this.#sequence += 1;
    const actions = {} as Record<ActionName, ActionState>;
    for (const action of defaultActions) {
      const previous = this.#states.get(action) ?? this.#emptyState(action);
      actions[action] = freeze({ ...previous, justPressed: false, justReleased: false });
    }
    return freeze({ sequence: this.#sequence, timestamp: this.#timestamp, activeDevice: this.#activeDevice, actions, axes: this.#readAxes() });
  }

  snapshot(): InputSnapshot {
    const frame = this.nextFrame();
    const actions = Object.fromEntries(Object.entries(frame.actions).map(([key, state]) => [key, state.pressed]));
    return freeze({ sequence: frame.sequence, device: frame.activeDevice, actions, axes: frame.axes, pointer: null });
  }

  consume(action: ActionName): ActionState {
    const current = this.#states.get(action) ?? this.#emptyState(action);
    const consumed = freeze({ ...current, justPressed: false, justReleased: false });
    this.#states.set(action, consumed);
    return consumed;
  }

  isDown(action: ActionName): boolean { return this.#states.get(action)?.pressed ?? false; }
  wasPressed(action: ActionName): boolean { return this.#states.get(action)?.justPressed ?? false; }
  value(action: ActionName): number { return this.#states.get(action)?.value ?? 0; }
  activeDevice(): InputDevice { return this.#activeDevice; }

  reset(): void {
    this.#pressed.clear();
    this.#values.clear();
    this.#timestamp = 0;
    this.#serial = 0;
    this.#sequence = 0;
    this.#resetStates();
  }

  dispose(): void { this.#disposed = true; this.reset(); }

  #resetStates(): void { for (const action of defaultActions) this.#states.set(action, this.#emptyState(action)); }
  #emptyState(action: ActionName): ActionState { return freeze({ action, pressed: false, justPressed: false, justReleased: false, value: 0, device: 'unknown', serial: 0 }); }

  #readAxes(): Readonly<Record<string, number>> {
    const axes: Record<string, number> = {};
    for (const [key, value] of this.#values) axes[key] = clamp(value, -1, 1);
    return freeze(axes);
  }
}

export const normalizePointer = (event: PointerEvent, rect: DOMRect): { x: number; y: number; inside: boolean } => {
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const x = clamp((event.clientX - rect.left) / width, 0, 1);
  const y = clamp((event.clientY - rect.top) / height, 0, 1);
  return freeze({ x, y, inside: event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom });
};

export const buildBrowserInputRouter = (router = new ActionRouter()): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const key = (event: KeyboardEvent) => router.feed({ device: 'keyboard', code: event.code, pressed: event.type === 'keydown', time: event.timeStamp, serial: 0 });
  const mouse = (event: MouseEvent) => router.feed({ device: 'mouse', code: `Mouse${event.button}`, pressed: event.type === 'mousedown', time: event.timeStamp, serial: 0 });
  window.addEventListener('keydown', key, { passive: true });
  window.addEventListener('keyup', key, { passive: true });
  window.addEventListener('mousedown', mouse, { passive: true });
  window.addEventListener('mouseup', mouse, { passive: true });
  return () => {
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', key);
    window.removeEventListener('mousedown', mouse);
    window.removeEventListener('mouseup', mouse);
  };
};

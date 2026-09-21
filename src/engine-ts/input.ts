import type { Disposable } from './coreTypes.ts';
import { clamp, stableSort } from './coreTypes.ts';

export type InputAction =
  | 'move-forward' | 'move-back' | 'move-left' | 'move-right'
  | 'jump' | 'crouch' | 'sprint' | 'interact' | 'attack'
  | 'inventory' | 'map' | 'pause' | 'camera-reset' | 'confirm' | 'cancel';

export type InputDevice = 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'xr';

export interface ActionBinding {
  readonly action: InputAction;
  readonly device: InputDevice;
  readonly code: string;
  readonly scale?: number;
  readonly deadZone?: number;
}

export interface ActionState {
  readonly action: InputAction;
  readonly value: number;
  readonly pressed: boolean;
  readonly justPressed: boolean;
  readonly justReleased: boolean;
  readonly source: InputDevice | 'system';
  readonly updatedAt: number;
}

export interface InputFrame {
  readonly frameId: number;
  readonly actions: ReadonlyMap<InputAction, ActionState>;
  readonly pointer: { readonly x: number; readonly y: number; readonly dx: number; readonly dy: number; readonly buttons: number };
  readonly wheelY: number;
  readonly text: string;
}

const ALL_ACTIONS: readonly InputAction[] = [
  'move-forward', 'move-back', 'move-left', 'move-right', 'jump', 'crouch', 'sprint',
  'interact', 'attack', 'inventory', 'map', 'pause', 'camera-reset', 'confirm', 'cancel',
];

const DEFAULT_BINDINGS: readonly ActionBinding[] = Object.freeze([
  { action: 'move-forward', device: 'keyboard', code: 'KeyW' },
  { action: 'move-back', device: 'keyboard', code: 'KeyS' },
  { action: 'move-left', device: 'keyboard', code: 'KeyA' },
  { action: 'move-right', device: 'keyboard', code: 'KeyD' },
  { action: 'jump', device: 'keyboard', code: 'Space' },
  { action: 'crouch', device: 'keyboard', code: 'ControlLeft' },
  { action: 'sprint', device: 'keyboard', code: 'ShiftLeft' },
  { action: 'interact', device: 'keyboard', code: 'KeyE' },
  { action: 'attack', device: 'pointer', code: 'Mouse0' },
  { action: 'inventory', device: 'keyboard', code: 'KeyI' },
  { action: 'map', device: 'keyboard', code: 'KeyM' },
  { action: 'pause', device: 'keyboard', code: 'Escape' },
  { action: 'camera-reset', device: 'keyboard', code: 'KeyR' },
  { action: 'confirm', device: 'keyboard', code: 'Enter' },
  { action: 'cancel', device: 'keyboard', code: 'Escape' },
]);

const emptyAction = (action: InputAction, now: number): ActionState => Object.freeze({ action, value: 0, pressed: false, justPressed: false, justReleased: false, source: 'system', updatedAt: now });

export class InputMapper {
  private bindings: ActionBinding[];
  private readonly activeCodes = new Set<string>();
  private readonly previousValues = new Map<InputAction, number>();
  private readonly values = new Map<InputAction, ActionState>();
  private frameIdValue = 0;

  constructor(bindings: readonly ActionBinding[] = DEFAULT_BINDINGS) {
    this.bindings = this.normalizeBindings(bindings);
    const now = 0;
    for (const action of ALL_ACTIONS) this.values.set(action, emptyAction(action, now));
  }

  setBindings(bindings: readonly ActionBinding[]): void { this.bindings = this.normalizeBindings(bindings); }
  get currentBindings(): readonly ActionBinding[] { return [...this.bindings]; }

  pressCode(code: string, device: InputDevice = 'keyboard', now = Date.now()): void {
    this.activeCodes.add(`${device}:${code}`);
    this.updateFromHardware(device, code, 1, now);
  }

  releaseCode(code: string, device: InputDevice = 'keyboard', now = Date.now()): void {
    this.activeCodes.delete(`${device}:${code}`);
    this.updateFromHardware(device, code, 0, now);
  }

  setAnalog(code: string, value: number, device: InputDevice = 'gamepad', now = Date.now()): void {
    this.updateFromHardware(device, code, clamp(value, -1, 1), now);
  }

  advanceFrame(now = Date.now()): InputFrame {
    this.frameIdValue += 1;
    for (const action of ALL_ACTIONS) {
      const state = this.values.get(action) ?? emptyAction(action, now);
      const previous = this.previousValues.get(action) ?? 0;
      this.previousValues.set(action, state.value);
      this.values.set(action, Object.freeze({
        ...state,
        justPressed: previous === 0 && state.value !== 0,
        justReleased: previous !== 0 && state.value === 0,
        updatedAt: now,
      }));
    }
    return this.snapshotFrame(now);
  }

  action(action: InputAction): ActionState { return this.values.get(action) ?? emptyAction(action, Date.now()); }
  axis2D(): { x: number; y: number } {
    return {
      x: clamp(this.action('move-right').value - this.action('move-left').value, -1, 1),
      y: clamp(this.action('move-forward').value - this.action('move-back').value, -1, 1),
    };
  }

  consume(action: InputAction): boolean {
    const state = this.action(action);
    if (!state.justPressed) return false;
    this.values.set(action, Object.freeze({ ...state, justPressed: false }));
    return true;
  }

  reset(): void {
    this.activeCodes.clear();
    for (const action of ALL_ACTIONS) {
      this.values.set(action, emptyAction(action, Date.now()));
      this.previousValues.set(action, 0);
    }
  }

  private updateFromHardware(device: InputDevice, code: string, value: number, now: number): void {
    const matches = this.bindings.filter(binding => binding.device === device && binding.code === code);
    for (const binding of matches) {
      const scaled = clamp(value * (binding.scale ?? 1), -1, 1);
      const deadZone = clamp(binding.deadZone ?? 0.08, 0, 0.95);
      const normalized = Math.abs(scaled) < deadZone ? 0 : scaled;
      const current = this.values.get(binding.action) ?? emptyAction(binding.action, now);
      this.values.set(binding.action, Object.freeze({ ...current, value: normalized, pressed: normalized !== 0, source: device, updatedAt: now }));
    }
  }

  private snapshotFrame(now: number): InputFrame {
    return Object.freeze({
      frameId: this.frameIdValue,
      actions: new Map(this.values),
      pointer: { x: 0, y: 0, dx: 0, dy: 0, buttons: 0 },
      wheelY: 0,
      text: '',
    });
  }

  private normalizeBindings(bindings: readonly ActionBinding[]): ActionBinding[] {
    const dedupe = new Map<string, ActionBinding>();
    for (const binding of bindings) {
      if (!ALL_ACTIONS.includes(binding.action) || !binding.code) continue;
      const key = `${binding.action}|${binding.device}|${binding.code}`;
      dedupe.set(key, Object.freeze({ ...binding, scale: binding.scale ?? 1, deadZone: binding.deadZone ?? 0.08 }));
    }
    return stableSort([...dedupe.values()], (left, right) =>
      left.action.localeCompare(right.action) || left.device.localeCompare(right.device) || left.code.localeCompare(right.code));
  }
}

export interface GestureSample { readonly x: number; readonly y: number; readonly time: number; }
export interface GestureResult { readonly dx: number; readonly dy: number; readonly distance: number; readonly velocity: number; readonly durationMs: number; readonly direction: 'left' | 'right' | 'up' | 'down' | 'none'; }

export const resolveGesture = (samples: readonly GestureSample[]): GestureResult => {
  if (samples.length < 2) return { dx: 0, dy: 0, distance: 0, velocity: 0, durationMs: 0, direction: 'none' };
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const distance = Math.hypot(dx, dy);
  const durationMs = Math.max(1, last.time - first.time);
  const velocity = distance / durationMs;
  if (distance < 12) return { dx, dy, distance, velocity, durationMs, direction: 'none' };
  const direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
  return { dx, dy, distance, velocity, durationMs, direction };
};

export interface RumbleCommand { readonly lowFrequency: number; readonly highFrequency: number; readonly durationMs: number; readonly reason: string; }

export class InputRumbleRouter implements Disposable {
  private readonly gamepads = new Set<Gamepad>();
  private disposed = false;

  register(gamepad: Gamepad): void { if (!this.disposed) this.gamepads.add(gamepad); }
  unregister(gamepad: Gamepad): void { this.gamepads.delete(gamepad); }

  pulse(command: RumbleCommand): void {
    if (this.disposed) return;
    for (const gamepad of this.gamepads) {
      const actuator = gamepad.vibrationActuator;
      if (actuator?.playEffect) {
        void actuator.playEffect('dual-rumble', { startDelay: 0, duration: Math.max(0, command.durationMs), weakMagnitude: clamp(command.lowFrequency, 0, 1), strongMagnitude: clamp(command.highFrequency, 0, 1) }).catch(() => undefined);
      }
    }
  }

  dispose(): void { this.disposed = true; this.gamepads.clear(); }
}

export class InputRecorder {
  private readonly frames: InputFrame[] = [];
  record(frame: InputFrame): void { this.frames.push(frame); }
  clear(): void { this.frames.length = 0; }
  get length(): number { return this.frames.length; }
  export(): readonly InputFrame[] { return this.frames.map(frame => Object.freeze({ ...frame, actions: new Map(frame.actions) })); }
  playback(frameIndex: number): InputFrame | undefined { return this.frames[Math.max(0, Math.trunc(frameIndex))]; }
}

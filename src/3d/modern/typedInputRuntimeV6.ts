import type { TickId } from './runtimeContractsV4';
import { type InputSnapshotV6, frameId, finiteOrV6 } from './typedSceneContractsV6';

export type InputDeviceV6 = 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'xr' | 'virtual';
export type InputActionV6 = 'move.forward' | 'move.backward' | 'move.left' | 'move.right' | 'camera.orbitX' | 'camera.orbitY' | 'camera.zoom' | 'camera.reset' | 'sprint' | 'jump' | 'interact' | 'pause' | 'debug';

export interface InputEventV6 {
  readonly device: InputDeviceV6;
  readonly code: string;
  readonly value?: number;
  readonly pressed?: boolean;
  readonly timestamp: number;
}

export interface InputBindingV6 {
  readonly device: InputDeviceV6;
  readonly code: string;
  readonly action: InputActionV6;
  readonly scale?: number;
  readonly deadZone?: number;
  readonly priority?: number;
  readonly repeat?: boolean;
}

export interface InputRuntimeOptionsV6 {
  readonly maxQueue?: number;
  readonly maxHistory?: number;
  readonly analogDeadZone?: number;
  readonly now?: () => number;
}

export interface InputRuntimeMetricsV6 {
  readonly queued: number;
  readonly consumed: number;
  readonly dropped: number;
  readonly bindings: number;
  readonly frames: number;
  readonly keyboardEvents: number;
  readonly touchEvents: number;
  readonly pointerEvents: number;
  readonly gamepadEvents: number;
  readonly xrEvents: number;
}

const ACTIONS = new Set<InputActionV6>([
  'move.forward','move.backward','move.left','move.right','camera.orbitX','camera.orbitY','camera.zoom','camera.reset','sprint','jump','interact','pause','debug',
]);

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function deadZone(value: number, threshold: number): number { const magnitude = Math.abs(value); if (magnitude <= threshold) return 0; const sign = Math.sign(value); return sign * ((magnitude - threshold) / Math.max(0.0001, 1 - threshold)); }

export class TypedInputRuntimeV6 {
  readonly maxQueue: number;
  readonly maxHistory: number;
  readonly analogDeadZone: number;
  #now: () => number;
  #bindings: InputBindingV6[] = [];
  #queue: InputEventV6[] = [];
  #pressed = new Set<string>();
  #history: InputSnapshotV6[] = [];
  #metrics: InputRuntimeMetricsV6 = Object.freeze({ queued: 0, consumed: 0, dropped: 0, bindings: 0, frames: 0, keyboardEvents: 0, touchEvents: 0, pointerEvents: 0, gamepadEvents: 0, xrEvents: 0 });

  constructor(options: InputRuntimeOptionsV6 = {}) {
    this.maxQueue = Math.max(32, Math.trunc(options.maxQueue ?? 4096));
    this.maxHistory = Math.max(16, Math.trunc(options.maxHistory ?? 240));
    this.analogDeadZone = clamp(finiteOrV6(options.analogDeadZone, 0.12), 0, 0.9);
    this.#now = options.now ?? (() => performance.now());
  }

  bind(binding: InputBindingV6): void {
    if (!ACTIONS.has(binding.action)) throw new Error(`Unknown input action: ${binding.action}`);
    if (!binding.code.trim()) throw new Error('Input binding code cannot be empty');
    const normalized: InputBindingV6 = Object.freeze({ ...binding, scale: finiteOrV6(binding.scale, 1), deadZone: clamp(finiteOrV6(binding.deadZone, this.analogDeadZone), 0, 0.95), priority: Math.trunc(finiteOrV6(binding.priority, 0)) });
    this.#bindings = [...this.#bindings.filter((entry) => !(entry.device === normalized.device && entry.code === normalized.code && entry.action === normalized.action)), normalized].sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.#metrics = Object.freeze({ ...this.#metrics, bindings: this.#bindings.length });
  }

  unbind(device: InputDeviceV6, code: string, action?: InputActionV6): number {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter((entry) => !(entry.device === device && entry.code === code && (action === undefined || entry.action === action)));
    this.#metrics = Object.freeze({ ...this.#metrics, bindings: this.#bindings.length });
    return before - this.#bindings.length;
  }

  clearBindings(): void { this.#bindings = []; this.#metrics = Object.freeze({ ...this.#metrics, bindings: 0 }); }

  push(event: InputEventV6): boolean {
    const value = finiteOrV6(event.value, event.pressed ? 1 : 0);
    const normalized: InputEventV6 = Object.freeze({ ...event, code: String(event.code).slice(0, 128), timestamp: finiteOrV6(event.timestamp, this.#now()), value, pressed: event.pressed === undefined ? value !== 0 : Boolean(event.pressed) });
    if (this.#queue.length >= this.maxQueue) { this.#queue.shift(); this.#metrics = Object.freeze({ ...this.#metrics, dropped: this.#metrics.dropped + 1 }); }
    this.#queue.push(normalized);
    const key = `${normalized.device}:${normalized.code}`;
    if (normalized.pressed) this.#pressed.add(key); else this.#pressed.delete(key);
    const metricKey = `${normalized.device}Events` as keyof InputRuntimeMetricsV6;
    const current = Number(this.#metrics[metricKey] ?? 0);
    this.#metrics = Object.freeze({ ...this.#metrics, queued: this.#queue.length, [metricKey]: current + 1 });
    return true;
  }

  press(device: InputDeviceV6, code: string, timestamp = this.#now()): boolean { return this.push({ device, code, pressed: true, value: 1, timestamp }); }
  release(device: InputDeviceV6, code: string, timestamp = this.#now()): boolean { return this.push({ device, code, pressed: false, value: 0, timestamp }); }
  axis(device: InputDeviceV6, code: string, value: number, timestamp = this.#now()): boolean { return this.push({ device, code, value: clamp(finiteOrV6(value), -1, 1), pressed: Math.abs(value) > this.analogDeadZone, timestamp }); }

  consume(tick: TickId, frame: number): InputSnapshotV6 {
    const events = this.#queue.splice(0);
    let moveX = 0; let moveZ = 0; let cameraX = 0; let cameraY = 0; let sprint = false; let jump = false; let interact = false; let pause = false; let debug = false;
    let source: InputSnapshotV6['source'] = 'system';
    const sorted = events.map((event) => ({ event, bindings: this.#bindings.filter((binding) => binding.device === event.device && binding.code === event.code) })).sort((a,b) => (b.bindings[0]?.priority ?? 0) - (a.bindings[0]?.priority ?? 0));
    for (const { event, bindings } of sorted) {
      for (const binding of bindings) {
        const raw = event.value ?? (event.pressed ? 1 : 0);
        const adjusted = Math.abs(raw) <= (binding.deadZone ?? this.analogDeadZone) ? 0 : deadZone(raw, binding.deadZone ?? this.analogDeadZone) * (binding.scale ?? 1);
        source = event.device;
        switch (binding.action) {
          case 'move.forward': moveZ -= Math.abs(adjusted) > 0 ? adjusted : 0; break;
          case 'move.backward': moveZ += Math.abs(adjusted) > 0 ? adjusted : 0; break;
          case 'move.left': moveX -= Math.abs(adjusted) > 0 ? adjusted : 0; break;
          case 'move.right': moveX += Math.abs(adjusted) > 0 ? adjusted : 0; break;
          case 'camera.orbitX': cameraX += adjusted; break;
          case 'camera.orbitY': cameraY += adjusted; break;
          case 'sprint': sprint ||= Boolean(event.pressed); break;
          case 'jump': jump ||= Boolean(event.pressed); break;
          case 'interact': interact ||= Boolean(event.pressed); break;
          case 'pause': pause ||= Boolean(event.pressed); break;
          case 'debug': debug ||= Boolean(event.pressed); break;
          case 'camera.zoom': cameraY += adjusted * 0.5; break;
          case 'camera.reset': break;
        }
      }
    }
    moveX = clamp(moveX, -1, 1); moveZ = clamp(moveZ, -1, 1); cameraX = clamp(cameraX, -1, 1); cameraY = clamp(cameraY, -1, 1);
    const snapshot: InputSnapshotV6 = Object.freeze({ tick, frame: frameId(frame), moveX, moveZ, cameraX, cameraY, sprint, jump, interact, pause, debug, source });
    this.#history = [...this.#history, snapshot].slice(-this.maxHistory);
    this.#metrics = Object.freeze({ ...this.#metrics, queued: this.#queue.length, consumed: this.#metrics.consumed + events.length, frames: this.#metrics.frames + 1 });
    return snapshot;
  }

  isPressed(device: InputDeviceV6, code: string): boolean { return this.#pressed.has(`${device}:${code}`); }
  queued(): number { return this.#queue.length; }
  history(): readonly InputSnapshotV6[] { return Object.freeze(this.#history.slice()); }
  metrics(): InputRuntimeMetricsV6 { return this.#metrics; }
  clear(): void { this.#queue = []; this.#pressed.clear(); this.#history = []; this.#metrics = Object.freeze({ ...this.#metrics, queued: 0 }); }
}

export function installDefaultInputBindingsV6(runtime: TypedInputRuntimeV6): void {
  const keyboard: Array<[string, InputActionV6]> = [['KeyW','move.forward'],['ArrowUp','move.forward'],['KeyS','move.backward'],['ArrowDown','move.backward'],['KeyA','move.left'],['ArrowLeft','move.left'],['KeyD','move.right'],['ArrowRight','move.right'],['ShiftLeft','sprint'],['Space','jump'],['KeyE','interact'],['Escape','pause'],['F3','debug']];
  for (const [code, action] of keyboard) runtime.bind({ device: 'keyboard', code, action, priority: 10 });
  runtime.bind({ device: 'gamepad', code: 'axis:leftY', action: 'move.forward', priority: 8 });
  runtime.bind({ device: 'gamepad', code: 'axis:leftX', action: 'move.right', priority: 8 });
  runtime.bind({ device: 'gamepad', code: 'button:0', action: 'jump', priority: 9 });
  runtime.bind({ device: 'gamepad', code: 'button:1', action: 'interact', priority: 9 });
  runtime.bind({ device: 'gamepad', code: 'button:4', action: 'sprint', priority: 8 });
  runtime.bind({ device: 'touch', code: 'joystickY', action: 'move.forward', priority: 6, deadZone: 0.16 });
  runtime.bind({ device: 'touch', code: 'joystickX', action: 'move.right', priority: 6, deadZone: 0.16 });
  runtime.bind({ device: 'touch', code: 'cameraX', action: 'camera.orbitX', priority: 5 });
  runtime.bind({ device: 'touch', code: 'cameraY', action: 'camera.orbitY', priority: 5 });
}

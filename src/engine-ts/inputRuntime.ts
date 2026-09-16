import type { Disposable, EntityId, Vec3 } from './coreTypes.js';
import { clamp } from './coreTypes.js';

export type InputDevice = 'keyboard' | 'mouse' | 'pointer' | 'touch' | 'gamepad' | 'xr' | 'virtual';
export type InputMode = 'gameplay' | 'menu' | 'debug' | 'spectator' | 'cinematic';
export type IntentType = 'move' | 'look' | 'sprint' | 'jump' | 'attack' | 'interact' | 'pause' | 'camera';

export interface InputSample { readonly device: InputDevice; readonly code: string; readonly value: number; readonly pressed: boolean; readonly timestamp: number; readonly sequence: number; }
export interface InputBinding { readonly device: InputDevice; readonly code: string; readonly intent: IntentType; readonly scale: number; readonly deadZone: number; readonly mode: InputMode | '*'; readonly priority: number; }
export interface InputIntent { readonly type: IntentType; readonly value: number; readonly vector: Vec3; readonly source: InputDevice; readonly priority: number; readonly timestamp: number; }
export interface InputFrame { readonly tick: number; readonly intents: readonly InputIntent[]; readonly move: Vec3; readonly look: Vec3; readonly sprint: boolean; readonly actions: readonly IntentType[]; }
export interface InputRuntimeStats { readonly samples: number; readonly intents: number; readonly bindings: number; readonly dropped: number; }

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function deadZone(value: number, threshold: number): number { const v = finite(value); const t = clamp(threshold, 0, 0.99); if (Math.abs(v) <= t) return 0; return Math.sign(v) * ((Math.abs(v) - t) / (1 - t)); }
function vectorLength(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }

export class InputRuntime implements Disposable {
  #bindings: InputBinding[] = [];
  #samples: InputSample[] = [];
  #sequence = 1;
  #dropped = 0;
  #mode: InputMode = 'gameplay';
  #disposed = false;
  #stats: InputRuntimeStats = Object.freeze({ samples: 0, intents: 0, bindings: 0, dropped: 0 });

  setMode(mode: InputMode): void { this.#mode = mode; }
  get mode(): InputMode { return this.#mode; }

  bind(binding: InputBinding): boolean {
    if (this.#disposed || !binding.device || !binding.code || !binding.intent) return false;
    const duplicate = this.#bindings.some(item => item.device === binding.device && item.code === binding.code && item.mode === binding.mode);
    if (duplicate) return false;
    this.#bindings.push(Object.freeze({ ...binding, scale: finite(binding.scale, 1), deadZone: clamp(binding.deadZone, 0, 0.99), priority: finite(binding.priority) }));
    this.#bindings.sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
    this.#refreshStats();
    return true;
  }

  unbind(device: InputDevice, code: string, mode: InputMode | '*' = '*'): boolean {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter(binding => !(binding.device === device && binding.code === code && binding.mode === mode));
    this.#refreshStats();
    return before !== this.#bindings.length;
  }

  push(sample: Omit<InputSample, 'sequence'>): boolean {
    if (this.#disposed || this.#samples.length >= 2048) { this.#dropped += 1; this.#refreshStats(); return false; }
    this.#samples.push(Object.freeze({ ...sample, sequence: this.#sequence++ }));
    this.#refreshStats();
    return true;
  }

  consume(tick: number, maxSamples = 256): InputFrame {
    if (this.#disposed) return Object.freeze({ tick, intents: [], move: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, sprint: false, actions: [] });
    const count = Math.max(0, Math.min(maxSamples, this.#samples.length));
    const samples = this.#samples.splice(0, count);
    const intents: InputIntent[] = [];
    let move = { x: 0, y: 0, z: 0 };
    let look = { x: 0, y: 0, z: 0 };
    let sprint = false;
    const actions: IntentType[] = [];
    for (const sample of samples) {
      const binding = this.#bindings.find(item => item.device === sample.device && item.code === sample.code && (item.mode === '*' || item.mode === this.#mode));
      if (!binding) continue;
      const value = deadZone(sample.value * binding.scale, binding.deadZone);
      const intent = Object.freeze({ type: binding.intent, value, vector: Object.freeze({ x: 0, y: 0, z: 0 }), source: sample.device, priority: binding.priority, timestamp: sample.timestamp });
      intents.push(intent);
      switch (binding.intent) {
        case 'move': move = { x: clamp(move.x + value, -1, 1), y: 0, z: clamp(move.z + value, -1, 1) }; break;
        case 'look': look = { x: clamp(look.x + value, -1, 1), y: 0, z: look.z }; break;
        case 'camera': look = { x: look.x, y: clamp(look.y + value, -1, 1), z: look.z }; break;
        case 'sprint': sprint = sprint || (sample.pressed && value > 0); break;
        case 'jump': case 'attack': case 'interact': case 'pause': actions.push(binding.intent); break;
        default: break;
      }
    }
    const magnitude = vectorLength(move);
    if (magnitude > 1) move = { x: move.x / magnitude, y: 0, z: move.z / magnitude };
    this.#refreshStats(intents.length);
    return Object.freeze({ tick, intents: Object.freeze(intents), move: Object.freeze(move), look: Object.freeze(look), sprint, actions: Object.freeze([...new Set(actions)]) });
  }

  bindDefaults(): void {
    const defaults: InputBinding[] = [
      { device: 'keyboard', code: 'KeyW', intent: 'move', scale: 1, deadZone: 0, mode: 'gameplay', priority: 10 },
      { device: 'keyboard', code: 'KeyS', intent: 'move', scale: -1, deadZone: 0, mode: 'gameplay', priority: 10 },
      { device: 'keyboard', code: 'KeyA', intent: 'move', scale: -1, deadZone: 0, mode: 'gameplay', priority: 10 },
      { device: 'keyboard', code: 'KeyD', intent: 'move', scale: 1, deadZone: 0, mode: 'gameplay', priority: 10 },
      { device: 'keyboard', code: 'ShiftLeft', intent: 'sprint', scale: 1, deadZone: 0, mode: 'gameplay', priority: 20 },
      { device: 'keyboard', code: 'Space', intent: 'jump', scale: 1, deadZone: 0, mode: 'gameplay', priority: 20 },
      { device: 'mouse', code: 'Button0', intent: 'attack', scale: 1, deadZone: 0, mode: 'gameplay', priority: 30 },
      { device: 'keyboard', code: 'KeyE', intent: 'interact', scale: 1, deadZone: 0, mode: 'gameplay', priority: 30 },
      { device: 'keyboard', code: 'Escape', intent: 'pause', scale: 1, deadZone: 0, mode: '*', priority: 100 },
    ];
    for (const binding of defaults) this.bind(binding);
  }

  stats(): InputRuntimeStats { return this.#stats; }
  clear(): void { this.#samples.length = 0; this.#dropped = 0; this.#refreshStats(); }
  dispose(): void { this.#disposed = true; this.#bindings.length = 0; this.#samples.length = 0; }

  #refreshStats(intents = 0): void { this.#stats = Object.freeze({ samples: this.#samples.length, intents, bindings: this.#bindings.length, dropped: this.#dropped }); }
}

export const inputActor = (id: string): EntityId => id as EntityId;

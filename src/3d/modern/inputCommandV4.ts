import {
  type InputDeviceV4,
  type InputIntentV4,
  type InputModeV4,
  type InputSampleV4,
  type RuntimeSourceV4,
  type Vec3V4,
  type CommandResultV4,
  vec3V4,
  clampV4,
} from './runtimeContractsV4';

export interface InputBindingV4 {
  readonly device: InputDeviceV4;
  readonly code: string;
  readonly intent: string;
  readonly scale?: number;
  readonly deadZone?: number;
  readonly priority?: number;
  readonly modes?: readonly InputModeV4[];
}

export interface InputCommandV4 {
  readonly intent: string;
  readonly value: number;
  readonly vector: Vec3V4;
  readonly pressed: boolean;
  readonly tick: number;
  readonly sequence: number;
  readonly source: RuntimeSourceV4;
}

export interface InputStateV4 {
  readonly mode: InputModeV4;
  readonly samples: number;
  readonly intents: number;
  readonly commands: number;
  readonly dropped: number;
  readonly sequence: number;
}

export interface InputRouterOptionsV4 {
  readonly maxSamples?: number;
  readonly maxCommands?: number;
  readonly now?: () => number;
}

const deviceOrder: readonly InputDeviceV4[] = ['keyboard', 'mouse', 'pointer', 'touch', 'gamepad', 'xr', 'virtual'];
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const normalize = (value: number, deadZone: number): number => {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  const sign = Math.sign(value);
  return sign * ((magnitude - deadZone) / Math.max(0.0001, 1 - deadZone));
};

export class InputCommandRouterV4 {
  readonly maxSamples: number;
  readonly maxCommands: number;
  #now: () => number;
  #mode: InputModeV4 = 'gameplay';
  #bindings: InputBindingV4[] = [];
  #samples: InputSampleV4[] = [];
  #commands: InputCommandV4[] = [];
  #held = new Map<string, number>();
  #sequence = 0;
  #dropped = 0;

  constructor(options: InputRouterOptionsV4 = {}) {
    this.maxSamples = Math.max(64, Math.trunc(options.maxSamples ?? 2048));
    this.maxCommands = Math.max(32, Math.trunc(options.maxCommands ?? 512));
    this.#now = options.now ?? (() => performance.now());
  }

  setMode(mode: InputModeV4): void {
    this.#mode = mode;
    this.#commands.length = 0;
  }

  mode(): InputModeV4 {
    return this.#mode;
  }

  bind(binding: InputBindingV4): void {
    if (!binding.code.trim() || !binding.intent.trim()) throw new Error('Input binding requires code and intent');
    const normalized: InputBindingV4 = Object.freeze({ ...binding, scale: finite(binding.scale ?? 1, 1), deadZone: clampV4(finite(binding.deadZone ?? 0), 0, 0.95), priority: Math.trunc(binding.priority ?? 0), modes: binding.modes ? Object.freeze([...binding.modes]) : undefined });
    this.#bindings = this.#bindings.filter((entry) => !(entry.device === binding.device && entry.code === binding.code && entry.intent === binding.intent));
    this.#bindings.push(normalized);
    this.#bindings.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || deviceOrder.indexOf(a.device) - deviceOrder.indexOf(b.device) || a.code.localeCompare(b.code));
  }

  unbind(device: InputDeviceV4, code: string, intent?: string): number {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter((entry) => !(entry.device === device && entry.code === code && (intent === undefined || entry.intent === intent)));
    return before - this.#bindings.length;
  }

  bindings(): readonly InputBindingV4[] {
    return Object.freeze(this.#bindings.slice());
  }

  sample(sample: InputSampleV4): readonly InputCommandV4[] {
    this.#samples.push(Object.freeze({ ...sample }));
    while (this.#samples.length > this.maxSamples) this.#samples.shift();
    const commands = this.#translate(sample);
    for (const command of commands) this.#pushCommand(command);
    return Object.freeze(commands);
  }

  sampleDigital(device: InputDeviceV4, code: string, pressed: boolean, timestamp = this.#now()): readonly InputCommandV4[] {
    return this.sample({ device, code, value: pressed ? 1 : 0, pressed, timestamp, sequence: ++this.#sequence });
  }

  sampleAnalog(device: InputDeviceV4, code: string, value: number, timestamp = this.#now()): readonly InputCommandV4[] {
    const normalized = clampV4(finite(value), -1, 1);
    return this.sample({ device, code, value: normalized, pressed: Math.abs(normalized) > 0.001, timestamp, sequence: ++this.#sequence });
  }

  consume(max = this.#commands.length): readonly InputCommandV4[] {
    const count = Math.max(0, Math.trunc(max));
    const commands = this.#commands.splice(0, count);
    return Object.freeze(commands);
  }

  peek(): readonly InputCommandV4[] {
    return Object.freeze(this.#commands.slice());
  }

  held(device: InputDeviceV4, code: string): number {
    return this.#held.get(`${device}:${code}`) ?? 0;
  }

  clear(): void {
    this.#samples.length = 0;
    this.#commands.length = 0;
    this.#held.clear();
  }

  state(): InputStateV4 {
    return Object.freeze({ mode: this.#mode, samples: this.#samples.length, intents: this.#bindings.length, commands: this.#commands.length, dropped: this.#dropped, sequence: this.#sequence });
  }

  intent(type: string, value = 0, vector = vec3V4(), priority = 0, source: RuntimeSourceV4 = 'ui'): InputIntentV4 {
    return Object.freeze({ type, scalar: value, vector, digital: Math.abs(value) > 0.001, priority, source });
  }

  commandResult(command: InputCommandV4): CommandResultV4<InputCommandV4> {
    return Object.freeze({ accepted: true, applied: true, value: command });
  }

  #translate(sample: InputSampleV4): InputCommandV4[] {
    const bindings = this.#bindings.filter((binding) => binding.device === sample.device && binding.code === sample.code && (!binding.modes || binding.modes.includes(this.#mode)));
    if (bindings.length === 0) return [];
    const results: InputCommandV4[] = [];
    for (const binding of bindings) {
      const value = clampV4(normalize(sample.value * (binding.scale ?? 1), binding.deadZone ?? 0), -1, 1);
      this.#held.set(`${sample.device}:${sample.code}`, sample.pressed ? value : 0);
      const vector = this.#vectorForIntent(binding.intent, value);
      results.push(Object.freeze({ intent: binding.intent, value, vector, pressed: sample.pressed, tick: sample.sequence, sequence: ++this.#sequence, source: this.#sourceForDevice(sample.device) }));
    }
    return results;
  }

  #pushCommand(command: InputCommandV4): void {
    if (this.#commands.length >= this.maxCommands) {
      this.#commands.shift();
      this.#dropped += 1;
    }
    this.#commands.push(command);
  }

  #vectorForIntent(intent: string, value: number): Vec3V4 {
    if (intent === 'move.forward') return vec3V4(0, 0, -value);
    if (intent === 'move.backward') return vec3V4(0, 0, value);
    if (intent === 'move.left') return vec3V4(-value, 0, 0);
    if (intent === 'move.right') return vec3V4(value, 0, 0);
    if (intent === 'move.up') return vec3V4(0, value, 0);
    if (intent === 'move.down') return vec3V4(0, -value, 0);
    if (intent === 'look.x') return vec3V4(value, 0, 0);
    if (intent === 'look.y') return vec3V4(0, value, 0);
    return vec3V4();
  }

  #sourceForDevice(device: InputDeviceV4): RuntimeSourceV4 {
    return device === 'virtual' || device === 'xr' ? 'worker' : 'ui';
  }
}

export function installDefaultGameplayBindingsV4(router: InputCommandRouterV4): void {
  const keyboard = (code: string, intent: string): void => router.bind({ device: 'keyboard', code, intent, priority: 100 });
  keyboard('KeyW', 'move.forward');
  keyboard('KeyS', 'move.backward');
  keyboard('KeyA', 'move.left');
  keyboard('KeyD', 'move.right');
  keyboard('Space', 'jump');
  keyboard('ShiftLeft', 'sprint');
  keyboard('KeyE', 'interact');
  keyboard('Escape', 'menu');
  router.bind({ device: 'gamepad', code: 'axis:leftX', intent: 'move.horizontal', deadZone: 0.12, scale: 1, priority: 80 });
  router.bind({ device: 'gamepad', code: 'axis:leftY', intent: 'move.vertical', deadZone: 0.12, scale: -1, priority: 80 });
  router.bind({ device: 'gamepad', code: 'button:a', intent: 'jump', priority: 80 });
}

export type InputSource = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'xr' | 'synthetic';
export type InputPhase = 'pressed' | 'changed' | 'released';
export type InputAction = 'move-forward' | 'move-backward' | 'move-left' | 'move-right' | 'jump' | 'sprint' | 'crouch' | 'interact' | 'attack' | 'block' | 'inventory' | 'pause' | 'camera-look' | 'camera-zoom';

export interface RawInputEvent {
  readonly source: InputSource;
  readonly code: string;
  readonly value: number;
  readonly timestamp: number;
  readonly phase: InputPhase;
  readonly pointerId?: number;
}

export interface ActionBinding {
  readonly action: InputAction;
  readonly source: InputSource;
  readonly code: string;
  readonly scale: number;
  readonly deadZone: number;
  readonly invert?: boolean;
  readonly chord?: readonly string[];
}

export interface NormalizedAction {
  readonly action: InputAction;
  readonly value: number;
  readonly source: InputSource;
  readonly timestamp: number;
  readonly phase: InputPhase;
}

export interface InputSnapshot {
  readonly frameId: number;
  readonly actions: Readonly<Record<InputAction, number>>;
  readonly activeSources: readonly InputSource[];
  readonly pointerPosition?: { readonly x: number; readonly y: number };
}

export interface InputDeviceCapabilities {
  readonly keyboard: boolean;
  readonly mouse: boolean;
  readonly touch: boolean;
  readonly gamepad: boolean;
  readonly xr: boolean;
  readonly maxPointers: number;
}

const validSources = new Set<InputSource>(['keyboard','mouse','touch','gamepad','xr','synthetic']);
const validPhases = new Set<InputPhase>(['pressed','changed','released']);

export class InputNormalizer {
  readonly #bindings = new Map<string, ActionBinding[]>();
  #frame = 0;
  readonly #actions = new Map<InputAction, number>();

  bind(binding: ActionBinding): () => void {
    if (!binding.code.trim()) throw new TypeError('Input binding code is required');
    if (!validSources.has(binding.source)) throw new TypeError('Input binding source is invalid');
    if (!Number.isFinite(binding.scale)) throw new RangeError('Input scale must be finite');
    if (!Number.isFinite(binding.deadZone) || binding.deadZone < 0 || binding.deadZone >= 1) throw new RangeError('Input dead zone invalid');
    const key = `${binding.source}:${binding.code}`;
    const list = this.#bindings.get(key) ?? [];
    list.push(Object.freeze({ ...binding, chord: binding.chord ? [...binding.chord] : undefined }));
    this.#bindings.set(key, list);
    return () => {
      const current = this.#bindings.get(key);
      if (!current) return;
      const next = current.filter((item) => item !== binding);
      if (next.length === 0) this.#bindings.delete(key); else this.#bindings.set(key, next);
    };
  }

  process(event: RawInputEvent, activeCodes: ReadonlySet<string> = new Set()): readonly NormalizedAction[] {
    if (!validSources.has(event.source) || !validPhases.has(event.phase)) return [];
    if (!Number.isFinite(event.value) || !Number.isFinite(event.timestamp)) return [];
    const bindings = this.#bindings.get(`${event.source}:${event.code}`) ?? [];
    const output: NormalizedAction[] = [];
    for (const binding of bindings) {
      if (binding.chord && binding.chord.some((code) => !activeCodes.has(code))) continue;
      const magnitude = Math.abs(event.value) < binding.deadZone ? 0 : (Math.abs(event.value) - binding.deadZone) / (1 - binding.deadZone);
      const value = (binding.invert ? -1 : 1) * Math.max(-1, Math.min(1, magnitude * Math.sign(event.value) * binding.scale));
      this.#actions.set(binding.action, value);
      output.push({ action: binding.action, value, source: event.source, timestamp: event.timestamp, phase: event.phase });
    }
    return output;
  }

  beginFrame(): void {
    this.#frame += 1;
    for (const [action, value] of this.#actions) if (value !== 0) this.#actions.set(action, value * 0.85);
  }

  snapshot(): InputSnapshot {
    const actions = Object.create(null) as Record<InputAction, number>;
    const names: InputAction[] = ['move-forward','move-backward','move-left','move-right','jump','sprint','crouch','interact','attack','block','inventory','pause','camera-look','camera-zoom'];
    for (const action of names) actions[action] = this.#actions.get(action) ?? 0;
    return Object.freeze({ frameId: this.#frame, actions: Object.freeze(actions), activeSources: [...new Set(this.#bindings.keys().map((key) => key.split(':')[0] as InputSource))] });
  }

  clear(): void { this.#bindings.clear(); this.#actions.clear(); }
}

export function detectInputCapabilities(navigatorLike: { readonly maxTouchPoints?: number; readonly getGamepads?: () => unknown } = {}): InputDeviceCapabilities {
  const hasWindow = typeof window !== 'undefined';
  const maxPointers = Math.max(0, Math.floor(navigatorLike.maxTouchPoints ?? (hasWindow ? 0 : 0)));
  return {
    keyboard: hasWindow,
    mouse: hasWindow,
    touch: maxPointers > 0,
    gamepad: typeof navigatorLike.getGamepads === 'function',
    xr: hasWindow && typeof navigator !== 'undefined' && 'xr' in navigator,
    maxPointers,
  };
}

export function normalizeActionValue(value: number, deadZone = 0.05): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) <= deadZone) return 0;
  const magnitude = (Math.abs(value) - deadZone) / (1 - deadZone);
  return Math.max(-1, Math.min(1, magnitude * Math.sign(value)));
}

import { InputIntent, Tick, Vec2, asTick, clamp } from './domain.ts';

export interface RawInputState {
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly dodge: boolean;
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly interact: boolean;
}

export interface InputBinding {
  readonly action: keyof RawInputState;
  readonly codes: readonly string[];
  readonly deadZone: number;
  readonly scale: number;
}

export const DEFAULT_BINDINGS: readonly InputBinding[] = [
  { action: 'moveX', codes: ['KeyD', 'ArrowRight'], deadZone: 0.05, scale: 1 },
  { action: 'moveY', codes: ['KeyW', 'ArrowUp'], deadZone: 0.05, scale: 1 },
  { action: 'jump', codes: ['Space'], deadZone: 0, scale: 1 },
  { action: 'sprint', codes: ['ShiftLeft', 'ShiftRight'], deadZone: 0, scale: 1 },
  { action: 'dodge', codes: ['KeyC'], deadZone: 0, scale: 1 },
  { action: 'primary', codes: ['Mouse0', 'KeyE'], deadZone: 0, scale: 1 },
  { action: 'secondary', codes: ['Mouse2'], deadZone: 0, scale: 1 },
  { action: 'interact', codes: ['KeyF'], deadZone: 0, scale: 1 },
];

export const applyDeadZone = (value: number, deadZone: number): number => {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  const normalized = (magnitude - deadZone) / (1 - Math.min(0.999, deadZone));
  return Math.sign(value) * clamp(normalized, 0, 1);
};

export const normalizeStick = (x: number, y: number, deadZone = 0.12): Vec2 => {
  const nx = applyDeadZone(x, deadZone);
  const ny = applyDeadZone(y, deadZone);
  const magnitude = Math.hypot(nx, ny);
  if (magnitude <= 1) return { x: nx, y: ny };
  return { x: nx / magnitude, y: ny / magnitude };
};

export class InputBufferV5 {
  readonly #states = new Map<number, RawInputState>();
  readonly maxTicks: number;

  constructor(maxTicks = 240) { this.maxTicks = Math.max(1, Math.trunc(maxTicks)); }

  push(tick: Tick | number, state: RawInputState): void {
    this.#states.set(Number(asTick(Number(tick))), { ...state });
    const floor = Number(asTick(Number(tick))) - this.maxTicks;
    for (const key of this.#states.keys()) if (key < floor) this.#states.delete(key);
  }

  get(tick: Tick | number): RawInputState | undefined {
    const value = this.#states.get(Number(asTick(Number(tick))));
    return value ? { ...value } : undefined;
  }

  sampleLatest(atOrBefore: Tick | number): RawInputState | undefined {
    const limit = Number(asTick(Number(atOrBefore)));
    let best = -1;
    for (const key of this.#states.keys()) if (key <= limit && key > best) best = key;
    return best < 0 ? undefined : this.get(asTick(best));
  }

  clearThrough(tick: Tick | number): void {
    const limit = Number(asTick(Number(tick)));
    for (const key of this.#states.keys()) if (key <= limit) this.#states.delete(key);
  }

  size(): number { return this.#states.size; }
}

export class InputMapperV5 {
  readonly #bindings: readonly InputBinding[];
  readonly #keys = new Set<string>();
  #mouseButtons = new Set<number>();
  #look: Vec2 = { x: 0, y: 0 };

  constructor(bindings: readonly InputBinding[] = DEFAULT_BINDINGS) { this.#bindings = [...bindings]; }

  press(code: string): void { this.#keys.add(code); }
  release(code: string): void { this.#keys.delete(code); }
  setMouse(button: number, down: boolean): void {
    if (down) this.#mouseButtons.add(button); else this.#mouseButtons.delete(button);
  }
  setLook(x: number, y: number): void { this.#look = normalizeStick(x, y); }

  sample(): RawInputState {
    const active = (binding: InputBinding): boolean => binding.codes.some((code) => code.startsWith('Mouse') ? this.#mouseButtons.has(Number(code.slice(5))) : this.#keys.has(code));
    const valueFor = (action: keyof RawInputState): boolean => this.#bindings.filter((binding) => binding.action === action).some(active);
    const axis = (action: keyof RawInputState, positiveCodes: readonly string[], negativeCodes: readonly string[]): number => {
      const positive = positiveCodes.some((code) => this.#keys.has(code));
      const negative = negativeCodes.some((code) => this.#keys.has(code));
      return (positive ? 1 : 0) - (negative ? 1 : 0);
    };
    const moveX = axis('moveX', ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    const moveY = axis('moveY', ['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    return {
      moveX,
      moveY,
      lookX: this.#look.x,
      lookY: this.#look.y,
      jump: valueFor('jump'),
      sprint: valueFor('sprint'),
      dodge: valueFor('dodge'),
      primary: valueFor('primary'),
      secondary: valueFor('secondary'),
      interact: valueFor('interact'),
    };
  }
}

export const toIntent = (entity: InputIntent['entity'], tick: Tick | number, raw: RawInputState): InputIntent => ({
  tick: asTick(Number(tick)),
  entity,
  move: normalizeStick(raw.moveX, raw.moveY),
  look: normalizeStick(raw.lookX, raw.lookY, 0.08),
  jump: !!raw.jump,
  sprint: !!raw.sprint,
  dodge: !!raw.dodge,
  primary: !!raw.primary,
  secondary: !!raw.secondary,
  interact: !!raw.interact,
});

export const applyLookSensitivity = (look: Vec2, sensitivity: number): Vec2 => ({ x: look.x * clamp(sensitivity, 0, 8), y: look.y * clamp(sensitivity, 0, 8) });

export interface GestureSample { readonly dx: number; readonly dy: number; readonly durationMs: number; readonly fingers: number; }
export const classifyGesture = (sample: GestureSample): 'tap' | 'swipe' | 'drag' | 'pinch' | 'unknown' => {
  const distance = Math.hypot(sample.dx, sample.dy);
  if (sample.fingers >= 2 && distance < 24) return 'pinch';
  if (distance < 12 && sample.durationMs < 220) return 'tap';
  if (distance >= 32 && sample.durationMs < 500) return 'swipe';
  if (distance >= 16) return 'drag';
  return 'unknown';
};

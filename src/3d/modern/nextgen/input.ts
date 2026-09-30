import { InputFrame, Tick, Vec2, clamp, normalizeVec2, tickValue } from './types.ts';

export const enum InputButton {
  Primary = 1 << 0,
  Secondary = 1 << 1,
  Jump = 1 << 2,
  Sprint = 1 << 3,
  Dodge = 1 << 4,
  Interact = 1 << 5,
  Pause = 1 << 6,
}

export interface RawInputState {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  buttons: number;
  axes: readonly number[];
}

export interface InputHistoryConfig {
  capacity: number;
  inputLeadTicks: number;
  maxLookDelta: number;
  maxAxis: number;
}

const DEFAULT_CONFIG: InputHistoryConfig = {
  capacity: 256,
  inputLeadTicks: 2,
  maxLookDelta: 20,
  maxAxis: 1,
};

export class DeterministicInputBuffer {
  readonly #config: InputHistoryConfig;
  readonly #frames = new Map<number, InputFrame>();
  #sequence = 0;
  #latestTick: Tick = tickValue(0);

  constructor(config: Partial<InputHistoryConfig> = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (this.#config.capacity < 2) throw new RangeError('Input capacity must be at least 2');
  }

  get latestTick(): Tick { return this.#latestTick; }
  get size(): number { return this.#frames.size; }

  capture(tick: Tick, raw: RawInputState): InputFrame {
    if (tick < this.#latestTick) throw new Error(`Input tick regression: ${tick}`);
    const move = normalizeVec2({ x: clamp(raw.moveX, -this.#config.maxAxis, this.#config.maxAxis), y: clamp(raw.moveY, -this.#config.maxAxis, this.#config.maxAxis) });
    const look = {
      x: clamp(raw.lookX, -this.#config.maxLookDelta, this.#config.maxLookDelta),
      y: clamp(raw.lookY, -this.#config.maxLookDelta, this.#config.maxLookDelta),
    };
    const frame: InputFrame = {
      tick,
      sequence: ++this.#sequence,
      move,
      look,
      buttons: raw.buttons | 0,
      axes: raw.axes.slice(0, 16).map((axis) => clamp(Number(axis) || 0, -1, 1)),
    };
    this.#frames.set(Number(tick), frame);
    this.#latestTick = tick;
    this.#trim();
    return frame;
  }

  sample(tick: Tick): InputFrame {
    const exact = this.#frames.get(Number(tick));
    if (exact) return exact;
    let candidate: InputFrame | undefined;
    for (const [key, frame] of this.#frames) {
      if (key <= Number(tick) && (!candidate || key > Number(candidate.tick))) candidate = frame;
    }
    return candidate ? { ...candidate, tick } : this.#empty(tick);
  }

  predicted(serverTick: Tick): InputFrame[] {
    const start = Math.max(0, Number(serverTick) + 1);
    const end = start + this.#config.inputLeadTicks;
    const result: InputFrame[] = [];
    for (let tick = start; tick <= end; tick += 1) result.push(this.sample(tickValue(tick)));
    return result;
  }

  reconcile(authoritativeTick: Tick): InputFrame[] {
    return [...this.#frames.entries()]
      .filter(([tick]) => tick > Number(authoritativeTick))
      .sort(([a], [b]) => a - b)
      .map(([, frame]) => frame);
  }

  dropThrough(tick: Tick): number {
    let removed = 0;
    for (const key of this.#frames.keys()) {
      if (key <= Number(tick)) {
        this.#frames.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.#frames.clear();
    this.#sequence = 0;
    this.#latestTick = tickValue(0);
  }

  #empty(tick: Tick): InputFrame {
    return { tick, sequence: this.#sequence, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, buttons: 0, axes: [] };
  }

  #trim(): void {
    while (this.#frames.size > this.#config.capacity) {
      const oldest = this.#frames.keys().next().value;
      if (oldest === undefined) break;
      this.#frames.delete(oldest);
    }
  }
}

export function buttonPressed(frame: InputFrame, button: InputButton): boolean {
  return (frame.buttons & button) !== 0;
}

export function combineInput(a: InputFrame, b: InputFrame, tick: Tick): InputFrame {
  const move: Vec2 = normalizeVec2({ x: a.move.x + b.move.x, y: a.move.y + b.move.y });
  const look: Vec2 = { x: a.look.x + b.look.x, y: a.look.y + b.look.y };
  return {
    tick,
    sequence: Math.max(a.sequence, b.sequence),
    move,
    look,
    buttons: a.buttons | b.buttons,
    axes: Array.from({ length: Math.max(a.axes.length, b.axes.length) }, (_, index) => clamp((a.axes[index] ?? 0) + (b.axes[index] ?? 0), -1, 1)),
  };
}

export function neutralInput(tick: Tick): InputFrame {
  return { tick, sequence: 0, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, buttons: 0, axes: [] };
}

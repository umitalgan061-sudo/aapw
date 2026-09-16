import type { Result } from './platform.js';
import { err, ok } from './platform.js';

export type Seed = number & { readonly __seed: unique symbol };
export type DeterministicId = string & { readonly __deterministicId: unique symbol };

export interface RngState {
  readonly seed: number;
  readonly state: number;
  readonly calls: number;
}

export interface RandomStreamSnapshot {
  readonly state: RngState;
  readonly label: string;
}

const UINT32_MAX = 0xffffffff;
const UINT32_SCALE = 1 / 0x100000000;
const normalizeSeed = (seed: number): number => (Math.floor(seed) >>> 0);

export function asSeed(seed: number): Seed {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Seed must be a safe integer');
  return normalizeSeed(seed) as Seed;
}

export class DeterministicRng {
  #state: number;
  #calls = 0;
  readonly #seed: number;

  constructor(seed: Seed | number) {
    this.#seed = normalizeSeed(Number(seed));
    this.#state = this.#seed || 0x6d2b79f5;
  }

  nextUint(): number {
    let state = this.#state;
    state = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    state = Math.imul(state ^ (state >>> 15), 0x735a2d97);
    state ^= state >>> 15;
    this.#state = state >>> 0;
    this.#calls += 1;
    return this.#state;
  }

  next(): number { return this.nextUint() * UINT32_SCALE; }

  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new RangeError('Invalid integer range');
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min = 0, max = 1): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new RangeError('Invalid float range');
    return min + this.next() * (max - min);
  }

  bool(probability = 0.5): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new RangeError('Probability must be in [0,1]');
    return this.next() < probability;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError('Cannot pick from empty collection');
    return values[this.int(0, values.length - 1)] as T;
  }

  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      const current = result[i] as T;
      result[i] = result[j] as T;
      result[j] = current;
    }
    return result;
  }

  fork(label: string): DeterministicRng {
    return new DeterministicRng(hashSeed(this.#state, label));
  }

  snapshot(label = 'default'): RandomStreamSnapshot {
    return { state: { seed: this.#seed, state: this.#state, calls: this.#calls }, label };
  }

  restore(snapshot: RandomStreamSnapshot): void {
    if (snapshot.state.seed !== this.#seed) throw new Error('Cannot restore an RNG snapshot from another seed');
    this.#state = normalizeSeed(snapshot.state.state);
    this.#calls = Math.max(0, Math.floor(snapshot.state.calls));
  }

  get state(): RngState { return { seed: this.#seed, state: this.#state, calls: this.#calls }; }
}

export function hashSeed(seed: number, label: string): Seed {
  let h = normalizeSeed(seed) ^ 0x9e3779b9;
  for (let i = 0; i < label.length; i += 1) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return normalizeSeed(h) as Seed;
}

export function deterministicId(namespace: string, index: number, seed: Seed): DeterministicId {
  if (!namespace.trim()) throw new TypeError('Deterministic id namespace is required');
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Deterministic id index must be non-negative');
  return `${namespace}:${normalizeSeed(Number(seed)).toString(16)}:${index.toString(36)}` as DeterministicId;
}

export interface ReplayEvent {
  readonly tick: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ReplayLog {
  readonly seed: Seed;
  readonly version: 1;
  readonly events: readonly ReplayEvent[];
}

export class ReplayRecorder {
  readonly #seed: Seed;
  readonly #events: ReplayEvent[] = [];

  constructor(seed: Seed) { this.#seed = seed; }

  record(event: ReplayEvent): void {
    if (!Number.isSafeInteger(event.tick) || event.tick < 0) throw new RangeError('Replay tick must be non-negative');
    this.#events.push(Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) }));
  }

  finish(): ReplayLog { return Object.freeze({ seed: this.#seed, version: 1, events: [...this.#events] }); }

  clear(): void { this.#events.length = 0; }

  get size(): number { return this.#events.length; }
}

export interface ReplayCursor { readonly index: number; readonly tick: number; }

export function verifyReplayOrdering(log: ReplayLog): Result<void, Error> {
  let previousTick = -1;
  for (const event of log.events) {
    if (event.tick < previousTick) return err(new Error('Replay events are not monotonically ordered'));
    previousTick = event.tick;
  }
  return ok(undefined);
}

export function consumeReplay(log: ReplayLog, fromTick: number, toTick: number): readonly ReplayEvent[] {
  if (toTick < fromTick) throw new RangeError('Replay range is inverted');
  return log.events.filter((event) => event.tick >= fromTick && event.tick <= toTick);
}

export function stableSort<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return values.map((value, index) => ({ value, index })).sort((a, b) => compare(a.value, b.value) || a.index - b.index).map(({ value }) => value);
}

export function quantize(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) throw new RangeError('Quantization step must be positive');
  return Math.round(value / step) * step;
}

export function deterministicHash(values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const scaled = Math.floor(value * 1000003) >>> 0;
    hash ^= scaled;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

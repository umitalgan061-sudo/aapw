import { freeze, type Result, err, ok, type RuntimeError, type UnixMs, unixMs } from '../domain/contracts.ts';

export interface Clock {
  now(): UnixMs;
  tick(deltaMs: number): UnixMs;
}

export interface FixedStepClockOptions {
  readonly startMs?: number;
  readonly stepMs?: number;
  readonly maxDeltaMs?: number;
}

export interface ClockSample {
  readonly now: UnixMs;
  readonly deltaMs: number;
  readonly stepMs: number;
  readonly steps: number;
  readonly remainderMs: number;
}

export class FixedStepClock implements Clock {
  readonly #stepMs: number;
  readonly #maxDeltaMs: number;
  #nowMs: number;
  #accumulator = 0;

  constructor(options: FixedStepClockOptions = {}) {
    this.#stepMs = Math.max(1, Math.floor(options.stepMs ?? 1000 / 60));
    this.#maxDeltaMs = Math.max(this.#stepMs, Math.floor(options.maxDeltaMs ?? 250));
    this.#nowMs = Math.max(0, options.startMs ?? 0);
  }

  now(): UnixMs {
    return unixMs(this.#nowMs);
  }

  tick(deltaMs: number): UnixMs {
    const delta = Math.min(this.#maxDeltaMs, Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0));
    this.#nowMs += delta;
    return this.now();
  }

  sample(deltaMs: number): ClockSample {
    const delta = Math.min(this.#maxDeltaMs, Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0));
    this.#nowMs += delta;
    this.#accumulator += delta;
    const steps = Math.floor(this.#accumulator / this.#stepMs);
    this.#accumulator -= steps * this.#stepMs;
    return freeze({ now: this.now(), deltaMs: delta, stepMs: this.#stepMs, steps, remainderMs: this.#accumulator });
  }

  reset(value = 0): void {
    this.#nowMs = Math.max(0, Number.isFinite(value) ? value : 0);
    this.#accumulator = 0;
  }
}

export interface DeterministicRandom {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(values: readonly T[]): T | undefined;
  fork(label: string): DeterministicRandom;
  state(): number;
}

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mix = (value: number): number => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909);
  x ^= x >>> 16;
  return x >>> 0;
};

export class MulberryRandom implements DeterministicRandom {
  #state: number;

  constructor(seed = 0xdecafbad) {
    this.#state = mix(seed >>> 0);
  }

  next(): number {
    let t = (this.#state += 0x6d2b79f5);
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    const value = ((t ^ t >>> 14) >>> 0) / 4294967296;
    this.#state = mix(this.#state);
    return value;
  }

  int(min: number, max: number): number {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    if (high < low) return low;
    return low + Math.floor(this.next() * (high - low + 1));
  }

  pick<T>(values: readonly T[]): T | undefined {
    return values.length ? values[this.int(0, values.length - 1)] : undefined;
  }

  fork(label: string): DeterministicRandom {
    return new MulberryRandom(mix(this.#state ^ hashString(label)));
  }

  state(): number {
    return this.#state >>> 0;
  }
}

export interface ReplayStep<T> {
  readonly index: number;
  readonly input: T;
  readonly stateHash: string;
}

export interface ReplayResult<T> {
  readonly ok: boolean;
  readonly steps: readonly ReplayStep<T>[];
  readonly finalHash: string;
  readonly error?: RuntimeError;
}

export interface ReplayRunner<TInput, TState> {
  seed(state: TState): TState;
  step(state: TState, input: TInput, index: number): TState;
  digest(state: TState): string;
}

export const runReplay = <TInput, TState>(
  initial: TState,
  inputs: readonly TInput[],
  runner: ReplayRunner<TInput, TState>,
): ReplayResult<TInput> => {
  let state = runner.seed(initial);
  const steps: ReplayStep<TInput>[] = [];
  try {
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index] as TInput;
      state = runner.step(state, input, index);
      steps.push(freeze({ index, input, stateHash: runner.digest(state) }));
    }
    return freeze({ ok: true, steps, finalHash: runner.digest(state) });
  } catch (error) {
    return freeze({ ok: false, steps, finalHash: '', error: {
      code: 'REPLAY_FAILED',
      message: error instanceof Error ? error.message : String(error),
    } });
  }
};

export const deterministicDigest = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (typeof input === 'number') return Number.isFinite(input) ? Number(input.toFixed(8)) : null;
    if (Array.isArray(input)) return input.map(normalize);
    if (input instanceof Map) return [...input.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, item]) => [normalize(key), normalize(item)]);
    if (input && typeof input === 'object') {
      return Object.keys(input as Record<string, unknown>).sort().reduce<Record<string, unknown>>((out, key) => {
        out[key] = normalize((input as Record<string, unknown>)[key]);
        return out;
      }, {});
    }
    return input;
  };
  const text = JSON.stringify(normalize(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const safeClockResult = (value: unknown): Result<UnixMs> => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return err({ code: 'INVALID_CLOCK', message: 'Clock value must be a finite non-negative number.' });
  }
  return ok(unixMs(value));
};

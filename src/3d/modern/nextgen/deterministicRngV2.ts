import { hashString, mixHash } from './types.ts';

export interface RandomStreamSnapshot {
  seed: number;
  state: number;
  calls: number;
}

export interface RandomForkOptions {
  label: string;
  salt?: number;
}

export interface RandomRange {
  min: number;
  max: number;
}

function normalizeSeed(seed: number): number {
  if (!Number.isInteger(seed)) throw new RangeError('Random seeds must be integers');
  return seed >>> 0;
}

function stepState(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

export class DeterministicRandomStream {
  readonly #seed: number;
  #state: number;
  #calls = 0;

  constructor(seed: number, state?: number) {
    this.#seed = normalizeSeed(seed);
    const initialState = state ?? this.#seed;
    this.#state = normalizeSeed(initialState || 0x9e3779b9);
  }

  get seed(): number { return this.#seed; }
  get state(): number { return this.#state; }
  get calls(): number { return this.#calls; }

  nextUint(): number {
    this.#state = stepState(this.#state || 0x9e3779b9);
    this.#calls += 1;
    return this.#state;
  }

  nextFloat(): number {
    return this.nextUint() / 0x100000000;
  }

  nextSigned(): number {
    return this.nextFloat() * 2 - 1;
  }

  nextBoolean(probability = 0.5): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError('probability must be between 0 and 1');
    }
    return this.nextFloat() < probability;
  }

  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError('nextInt requires integer min <= max');
    }
    const span = max - min + 1;
    return min + Math.floor(this.nextFloat() * span);
  }

  nextRange(range: RandomRange): number {
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max < range.min) {
      throw new RangeError('nextRange requires finite min <= max');
    }
    return range.min + (range.max - range.min) * this.nextFloat();
  }

  pick<T>(values: readonly T[]): T | undefined {
    if (values.length === 0) return undefined;
    return values[this.nextInt(0, values.length - 1)];
  }

  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.nextInt(0, index);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  fork(options: RandomForkOptions | string): DeterministicRandomStream {
    const normalized = typeof options === 'string' ? { label: options } : options;
    const labelHash = hashString(normalized.label);
    const salt = normalized.salt ?? 0;
    const childSeed = mixHash(mixHash(this.#seed, labelHash), salt);
    return new DeterministicRandomStream(childSeed);
  }

  snapshot(): RandomStreamSnapshot {
    return { seed: this.#seed, state: this.#state, calls: this.#calls };
  }

  restore(snapshot: RandomStreamSnapshot): void {
    if (normalizeSeed(snapshot.seed) !== this.#seed) throw new Error('Cannot restore a snapshot from another seed');
    if (!Number.isInteger(snapshot.calls) || snapshot.calls < 0) throw new RangeError('Invalid random call count');
    this.#state = normalizeSeed(snapshot.state);
    this.#calls = snapshot.calls;
  }

  clone(): DeterministicRandomStream {
    return new DeterministicRandomStream(this.#seed, this.#state).withCalls(this.#calls);
  }

  withCalls(calls: number): this {
    if (!Number.isInteger(calls) || calls < 0) throw new RangeError('calls must be a non-negative integer');
    this.#calls = calls;
    return this;
  }

  digest(): number {
    return mixHash(mixHash(this.#seed, this.#state), this.#calls);
  }
}

export class RandomRegistry {
  readonly #root: DeterministicRandomStream;
  readonly #streams = new Map<string, DeterministicRandomStream>();

  constructor(seed: number) {
    this.#root = new DeterministicRandomStream(seed);
  }

  root(): DeterministicRandomStream { return this.#root; }

  stream(name: string, salt = 0): DeterministicRandomStream {
    const key = `${name}:${salt}`;
    const existing = this.#streams.get(key);
    if (existing) return existing;
    const created = this.#root.fork({ label: name, salt });
    this.#streams.set(key, created);
    return created;
  }

  digest(): number {
    let digest = this.#root.digest();
    for (const [name, stream] of [...this.#streams.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      digest = mixHash(digest, hashString(name));
      digest = mixHash(digest, stream.digest());
    }
    return digest;
  }

  clear(): void {
    this.#streams.clear();
  }
}

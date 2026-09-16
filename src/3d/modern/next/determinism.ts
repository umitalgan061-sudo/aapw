import { entityId, tick, type EntityId, type Tick } from './types.ts';

const UINT32_MAX = 0xffffffff;
const TAU = Math.PI * 2;

export function hashString(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashInts(values: readonly number[], seed = 0x9e3779b9): number {
  let hash = seed >>> 0;
  for (const value of values) {
    const normalized = Number.isFinite(value) ? Math.trunc(value) : 0;
    hash ^= normalized >>> 0;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

export function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export class DeterministicRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = mix32(seed || 0x6d2b79f5);
  }

  get state(): number {
    return this.#state >>> 0;
  }

  clone(): DeterministicRandom {
    const copy = new DeterministicRandom(1);
    copy.#state = this.#state;
    return copy;
  }

  nextUint32(): number {
    let x = this.#state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state;
  }

  nextFloat(): number {
    return this.nextUint32() / (UINT32_MAX + 1);
  }

  range(min: number, max: number): number {
    if (max < min) throw new RangeError('max must be >= min');
    return min + (max - min) * this.nextFloat();
  }

  int(min: number, maxInclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxInclusive) || maxInclusive < min) {
      throw new RangeError('integer bounds are invalid');
    }
    return min + Math.floor(this.nextFloat() * (maxInclusive - min + 1));
  }

  chance(probability: number): boolean {
    return this.nextFloat() < Math.max(0, Math.min(1, probability));
  }

  angle(): number {
    return this.nextFloat() * TAU;
  }

  fork(label: string | number): DeterministicRandom {
    const salt = typeof label === 'number' ? label : hashString(label);
    return new DeterministicRandom(hashInts([this.#state, salt]));
  }
}

export function seededRandom(seed: number, ...salt: number[]): DeterministicRandom {
  return new DeterministicRandom(hashInts([seed, ...salt]));
}

export function deterministicId(seed: number, namespace: string, local: number): EntityId {
  return entityId(mix32(hashInts([seed, hashString(namespace), local])) & 0x1fffffff);
}

export function tickSeed(seed: number, currentTick: Tick): number {
  return mix32(hashInts([seed, tick(currentTick)]));
}

export function quantize(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}

export function quantizeAngleRadians(angle: number, steps = 4096): number {
  if (!Number.isInteger(steps) || steps < 2) throw new RangeError('steps must be >= 2');
  const wrapped = ((angle % TAU) + TAU) % TAU;
  return Math.round((wrapped / TAU) * steps) % steps;
}

export function stableNumber(value: number, precision = 1e-6): number {
  if (!Number.isFinite(value)) return 0;
  return quantize(value, precision);
}

export interface DeterministicSequence {
  readonly seed: number;
  readonly values: readonly number[];
}

export function sequence(seed: number, length: number, salt = 0): DeterministicSequence {
  if (!Number.isInteger(length) || length < 0 || length > 1_000_000) {
    throw new RangeError('sequence length outside safe bounds');
  }
  const rng = seededRandom(seed, salt);
  const values = Array.from({ length }, () => rng.nextUint32());
  return { seed: mix32(seed), values };
}

export function deterministicChecksum(parts: readonly (string | number | boolean)[]): string {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = `${typeof part}:${String(part)}|`;
    hash = hashString(text, hash);
  }
  return hash.toString(16).padStart(8, '0');
}

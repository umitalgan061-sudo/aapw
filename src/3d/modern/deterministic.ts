import type { DeterministicClock, FrameId, UnixMillis, WorldSeed } from './types';

const UINT32_MAX = 0xffff_ffff;
const DEFAULT_EPOCH = 1_735_689_600_000;

function assertFiniteInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
}

/** Fast, deterministic 32-bit hash suitable for world decoration and stable IDs. */
export function hash32(input: string | number): number {
  const text = String(input);
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16_777_619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2_246_822_519) >>> 0;
  h ^= h >>> 13;
  return Math.imul(h, 3_266_489_909) >>> 0;
}

export function combineSeeds(...values: readonly number[]): WorldSeed {
  let state = 2_166_136_261;
  for (const value of values) {
    assertFiniteInteger(value, 'seed');
    state ^= hash32(value);
    state = Math.imul(state ^ (state >>> 15), 2_245_682_101) >>> 0;
  }
  return state as WorldSeed;
}

/** Counter-based PRNG: random values depend only on seed and sample index, never on call order. */
export function sample01(seed: WorldSeed | number, index: number): number {
  assertFiniteInteger(Number(seed), 'seed');
  assertFiniteInteger(index, 'index');
  let x = (Number(seed) ^ Math.imul(index + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x / 4_294_967_296;
}

export function sampleRange(seed: WorldSeed | number, index: number, min: number, max: number): number {
  if (!(Number.isFinite(min) && Number.isFinite(max)) || max < min) {
    throw new RangeError('sampleRange requires finite min <= max');
  }
  return min + (max - min) * sample01(seed, index);
}

export function quantize(value: number, step = 0.001): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) throw new RangeError('invalid quantization step');
  return Math.round(value / step) * step;
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const encode = (input: unknown): unknown => {
    if (typeof input === 'bigint') return `${input.toString()}n`;
    if (input && typeof input === 'object') {
      if (seen.has(input)) throw new TypeError('Cannot serialize cyclic data');
      seen.add(input);
      if (Array.isArray(input)) return input.map(encode);
      const record = input as Record<string, unknown>;
      return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
        const next = record[key];
        if (next !== undefined) acc[key] = encode(next);
        return acc;
      }, {});
    }
    if (typeof input === 'number') {
      if (Number.isNaN(input)) return 'NaN';
      if (input === Infinity) return 'Infinity';
      if (input === -Infinity) return '-Infinity';
    }
    return input;
  };
  return JSON.stringify(encode(value));
}

/** FNV-1a over UTF-8-ish UTF-16 code units; stable across browsers and Node. */
export function checksum(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export class FixedStepClock implements DeterministicClock {
  #epochMs: number;
  #nowMs: number;
  #frameId = 0 as FrameId;
  #stepMs: number;
  #accumulatorMs = 0;

  constructor(options: { readonly epochMs?: number; readonly stepMs?: number } = {}) {
    this.#epochMs = options.epochMs ?? DEFAULT_EPOCH;
    this.#nowMs = this.#epochMs;
    this.#stepMs = options.stepMs ?? 16.6666666667;
    if (!Number.isFinite(this.#stepMs) || this.#stepMs <= 0) throw new RangeError('stepMs must be positive');
  }

  now(): UnixMillis {
    return Math.trunc(this.#nowMs) as UnixMillis;
  }

  frame(): FrameId {
    return this.#frameId;
  }

  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('deltaMs must be non-negative');
    this.#accumulatorMs += Math.min(deltaMs, this.#stepMs * 8);
    while (this.#accumulatorMs >= this.#stepMs) {
      this.#accumulatorMs -= this.#stepMs;
      this.#nowMs += this.#stepMs;
      this.#frameId = (Number(this.#frameId) + 1) as FrameId;
    }
  }

  reset(epochMs = this.#epochMs): void {
    this.#nowMs = epochMs;
    this.#frameId = 0 as FrameId;
    this.#accumulatorMs = 0;
  }

  alpha(): number {
    return this.#accumulatorMs / this.#stepMs;
  }
}

export function createSeededId(prefix: string, seed: WorldSeed | number, index: number): string {
  return `${prefix}_${hash32(`${seed}:${index}`).toString(16).padStart(8, '0')}`;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const UINT32 = {
  MAX: UINT32_MAX,
  toSigned(value: number): number {
    return value | 0;
  },
  toUnsigned(value: number): number {
    return value >>> 0;
  },
};

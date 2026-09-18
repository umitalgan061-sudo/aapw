import { ContentHashV7, TickV7, hashV7, tickV7 } from './types.ts';

export class DeterministicRngV7 {
  #state: number;
  readonly #initialSeed: number;
  constructor(seed: number) {
    this.#initialSeed = seed >>> 0;
    this.#state = this.#initialSeed || 0x9e3779b9;
  }
  get seed(): number { return this.#initialSeed; }
  nextUint(): number {
    let x = this.#state >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5; x >>>= 0;
    this.#state = x >>> 0;
    return this.#state;
  }
  nextFloat(): number { return this.nextUint() / 0x100000000; }
  nextInt(min: number, maxExclusive: number): number {
    if (maxExclusive <= min) return Math.trunc(min);
    return min + Math.floor(this.nextFloat() * (maxExclusive - min));
  }
  fork(label: number): DeterministicRngV7 {
    return new DeterministicRngV7(hashNumbersV7(this.#initialSeed, label));
  }
  digest(): number { return hashNumbersV7(this.#initialSeed, this.#state); }
}

export function hashNumbersV7(...values: readonly number[]): number {
  let hash = 2166136261;
  for (const value of values) {
    const normalized = Number.isFinite(value) ? Math.trunc(value * 1000003) : 0;
    hash ^= normalized >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function hashStringV7(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function stableStringifyV7(value: unknown): string {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): unknown => {
    if (current === null || typeof current !== 'object') return current;
    if (seen.has(current)) throw new TypeError('Cannot hash cyclic structures');
    seen.add(current);
    if (Array.isArray(current)) {
      const result = current.map(visit);
      seen.delete(current);
      return result;
    }
    const record = current as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) result[key] = visit(record[key]);
    seen.delete(current);
    return result;
  };
  return JSON.stringify(visit(value));
}

export function checksumV7(value: unknown): ContentHashV7 {
  const serialized = stableStringifyV7(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hashV7((hash >>> 0).toString(16).padStart(8, '0'));
}

export class FixedClockV7 {
  readonly #stepSeconds: number;
  #accumulator = 0;
  #tick: TickV7 = tickV7(0);
  constructor(fixedHz = 60) {
    if (!Number.isFinite(fixedHz) || fixedHz <= 0) throw new RangeError('fixedHz must be positive');
    this.#stepSeconds = 1 / fixedHz;
  }
  get tick(): TickV7 { return this.#tick; }
  get accumulatorSeconds(): number { return this.#accumulator; }
  advance(deltaSeconds: number, maxSteps: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be finite and non-negative');
    this.#accumulator = Math.min(this.#accumulator + deltaSeconds, this.#stepSeconds * Math.max(1, Math.trunc(maxSteps)));
    let steps = 0;
    while (this.#accumulator + 1e-12 >= this.#stepSeconds && steps < maxSteps) {
      this.#accumulator -= this.#stepSeconds;
      this.#tick = tickV7(Number(this.#tick) + 1);
      steps += 1;
    }
    return steps;
  }
  consumeTick(): TickV7 { this.#tick = tickV7(Number(this.#tick) + 1); return this.#tick; }
}

export class SequenceWindowV7 {
  readonly #size: number;
  #highest: number = -1;
  #bits = new Uint32Array(1);
  constructor(size = 1024) {
    this.#size = Math.max(32, Math.min(4096, Math.trunc(size)));
    this.#bits = new Uint32Array(Math.ceil(this.#size / 32));
  }
  accept(sequence: number): boolean {
    const seq = Math.trunc(sequence);
    if (seq < 0) return false;
    if (this.#highest < 0) { this.#highest = seq; this.#mark(seq); return true; }
    const distance = seq - this.#highest;
    if (distance > 0) { this.#shift(distance); this.#highest = seq; this.#mark(seq); return true; }
    if (-distance >= this.#size) return false;
    if (this.#isMarked(seq)) return false;
    this.#mark(seq);
    return true;
  }
  highest(): number { return Math.max(0, this.#highest); }
  #shift(distance: number): void {
    if (distance >= this.#size) { this.#bits.fill(0); return; }
    const whole = Math.floor(distance / 32);
    const rem = distance % 32;
    if (whole > 0) this.#bits.copyWithin(whole, 0, this.#bits.length - whole);
    if (rem > 0) {
      for (let i = this.#bits.length - 1; i > 0; i -= 1) this.#bits[i] = (this.#bits[i] << rem) | (this.#bits[i - 1] >>> (32 - rem));
      this.#bits[0] <<= rem;
    }
    for (let i = 0; i < whole; i += 1) this.#bits[i] = 0;
  }
  #mark(sequence: number): void {
    const offset = this.#highest - sequence;
    if (offset < 0 || offset >= this.#size) return;
    const word = Math.floor(offset / 32), bit = offset % 32;
    this.#bits[word] |= 1 << bit;
  }
  #isMarked(sequence: number): boolean {
    const offset = this.#highest - sequence;
    if (offset < 0 || offset >= this.#size) return false;
    const word = Math.floor(offset / 32), bit = offset % 32;
    return (this.#bits[word] & (1 << bit)) !== 0;
  }
}

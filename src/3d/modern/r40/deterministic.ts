import type { Tick, Vec3 } from './types';

const UINT32_MAX = 0xFFFFFFFF;
const EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
export function saturate(value: number): number { return clamp(value, 0, 1); }
export function quantize(value: number, step = 1 / 4096): number {
  if (!(step > 0) || !Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}
export function quantizeVec3(value: Vec3, step = 1 / 1024): Vec3 {
  return Object.freeze({ x: quantize(value.x, step), y: quantize(value.y, step), z: quantize(value.z, step) });
}
export function stableNumber(value: number): number {
  if (Object.is(value, -0)) return 0;
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(9));
}
export function hashString(input: string): string {
  let h1 = 0x811C9DC5;
  let h2 = 0x9E3779B9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i; h2 = Math.imul(h2, 0x85EBCA77); h2 ^= h2 >>> 13;
  }
  h1 ^= h1 >>> 16; h2 ^= h2 >>> 16;
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
export function hashJson(value: unknown): string { return hashString(stableSerialize(value)); }
export function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(stableNumber(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return String(value) + 'n';
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableSerialize(record[key])).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

export class DeterministicRng {
  #state: number;
  constructor(seed: number | string) {
    this.#state = typeof seed === 'string' ? this.#seedString(seed) : seed >>> 0;
    if (this.#state === 0) this.#state = 0x6D2B79F5;
  }
  #seedString(seed: string): number {
    let value = 2166136261;
    for (let i = 0; i < seed.length; i += 1) { value ^= seed.charCodeAt(i); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }
  nextUint32(): number {
    let t = (this.#state + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
    this.#state = t >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  }
  next(): number { return this.nextUint32() / (UINT32_MAX + 1); }
  signed(): number { return this.next() * 2 - 1; }
  integer(min: number, max: number): number {
    const lo = Math.ceil(min); const hi = Math.floor(max);
    if (hi <= lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(values: readonly T[]): T | undefined { return values.length === 0 ? undefined : values[this.integer(0, values.length - 1)]; }
  fork(label: string): DeterministicRng { return new DeterministicRng(hashString(String(this.#state) + ':' + label)); }
  snapshot(): number { return this.#state >>> 0; }
  restore(state: number): void { this.#state = state >>> 0 || 0x6D2B79F5; }
}

export function stableSort<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return values.map((value, index) => ({ value, index }))
    .sort((a, b) => compare(a.value, b.value) || a.index - b.index)
    .map(({ value }) => value);
}
export function vec3DistanceSquared(a: Vec3, b: Vec3): number {
  const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z;
  return x * x + y * y + z * z;
}
export function vec3Distance(a: Vec3, b: Vec3): number { return Math.sqrt(vec3DistanceSquared(a, b)); }
export function vec3Length(value: Vec3): number { return Math.hypot(value.x, value.y, value.z); }
export function vec3Normalize(value: Vec3): Vec3 {
  const length = vec3Length(value);
  if (length <= EPSILON) return Object.freeze({ x: 0, y: 0, z: 0 });
  return Object.freeze({ x: value.x / length, y: value.y / length, z: value.z / length });
}
export function vec3Add(a: Vec3, b: Vec3): Vec3 { return Object.freeze({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }); }
export function vec3Sub(a: Vec3, b: Vec3): Vec3 { return Object.freeze({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }); }
export function vec3Scale(value: Vec3, scale: number): Vec3 {
  return Object.freeze({ x: value.x * scale, y: value.y * scale, z: value.z * scale });
}
export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const n = saturate(t);
  return Object.freeze({ x: a.x + (b.x - a.x) * n, y: a.y + (b.y - a.y) * n, z: a.z + (b.z - a.z) * n });
}
export function integrateVec3(position: Vec3, velocity: Vec3, dt: number): Vec3 { return vec3Add(position, vec3Scale(velocity, dt)); }
export function deterministicTick(nowMs: number, fixedMs: number): Tick {
  return Math.max(0, Math.floor(Math.max(0, nowMs) / Math.max(1, fixedMs))) as Tick;
}

export class FixedClock {
  readonly hz: number;
  readonly fixedMs: number;
  #tick = 0;
  #accumulatorMs = 0;
  constructor(hz = 60) { this.hz = clamp(Math.trunc(hz), 1, 240); this.fixedMs = 1000 / this.hz; }
  push(deltaMs: number, maxSteps = 4): { readonly ticks: readonly Tick[]; readonly alpha: number } {
    this.#accumulatorMs += clamp(deltaMs, 0, 250);
    const produced: Tick[] = [];
    while (this.#accumulatorMs + EPSILON >= this.fixedMs && produced.length < maxSteps) {
      this.#accumulatorMs -= this.fixedMs; this.#tick += 1; produced.push(this.#tick as Tick);
    }
    if (produced.length === maxSteps && this.#accumulatorMs >= this.fixedMs) this.#accumulatorMs %= this.fixedMs;
    return Object.freeze({ ticks: Object.freeze(produced), alpha: saturate(this.#accumulatorMs / this.fixedMs) });
  }
  get tick(): Tick { return this.#tick as Tick; }
  reset(tickValue: Tick = 0 as Tick): void { this.#tick = Math.max(0, Number(tickValue)); this.#accumulatorMs = 0; }
}

export class RollingWindow {
  readonly capacity: number;
  #values: number[] = [];
  constructor(capacity = 120) { this.capacity = Math.max(1, Math.trunc(capacity)); }
  add(value: number): void {
    this.#values.push(Number.isFinite(value) ? value : 0);
    if (this.#values.length > this.capacity) this.#values.shift();
  }
  average(): number { return this.#values.length === 0 ? 0 : this.#values.reduce((a, b) => a + b, 0) / this.#values.length; }
  max(): number { return this.#values.length === 0 ? 0 : Math.max(...this.#values); }
  percentile(percent: number): number {
    if (this.#values.length === 0) return 0;
    const sorted = [...this.#values].sort((a, b) => a - b);
    const index = saturate(percent) * (sorted.length - 1);
    const lower = Math.floor(index); const upper = Math.ceil(index);
    return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
  }
  snapshot(): readonly number[] { return Object.freeze([...this.#values]); }
  clear(): void { this.#values.length = 0; }
}

export function deterministicJitter(seed: string, tickValue: Tick, amplitude: number): number {
  return new DeterministicRng(seed + ':' + String(Number(tickValue))).signed() * amplitude;
}
export function decay(value: number, halfLifeTicks: number, elapsedTicks: number): number {
  if (!(halfLifeTicks > 0)) return 0;
  return Math.max(0, value) * Math.pow(0.5, Math.max(0, elapsedTicks) / halfLifeTicks);
}
export function criticallyDamped(current: number, target: number, velocity: number, dt: number, frequency: number): { value: number; velocity: number } {
  const w = Math.max(0.001, frequency) * 2 * Math.PI;
  const x = current - target; const e = Math.exp(-w * Math.max(0, dt));
  return {
    value: stableNumber(target + (x + (velocity + w * x) * dt) * e),
    velocity: stableNumber((velocity - w * (velocity + w * x) * dt) * e),
  };
}
export function deterministicBackoff(attempt: number, baseMs: number, capMs: number, seed: string): number {
  const nominal = Math.min(capMs, Math.max(baseMs, baseMs * (2 ** Math.min(10, Math.max(0, Math.trunc(attempt))))));
  const spread = nominal * 0.1;
  return Math.max(baseMs, nominal - spread + new DeterministicRng(seed + ':' + String(attempt)).next() * spread * 2);
}

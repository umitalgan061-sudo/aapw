import {
  asSequence,
  asTick,
  type InputFrame,
  type RuntimeClockState,
  type Sequence,
  type Tick,
  type Vec3,
} from './coreContracts';

const UINT32_MAX = 0xffffffff;
const UINT32_SCALE = 1 / 0x100000000;

export function u32(value: number): number {
  return value >>> 0;
}

export function mix32(value: number): number {
  let x = u32(value + 0x9e3779b9);
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return u32(x);
}

export function hashString32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return u32(hash);
}

export function hashNumbers32(values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const bits = u32(Math.trunc(value * 1000003));
    hash ^= bits;
    hash = Math.imul(hash, 0x01000193);
    hash = mix32(hash);
  }
  return u32(hash);
}

export function hashObject32(value: unknown): number {
  return hashString32(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export class DeterministicRng {
  #state: number;

  constructor(seed: number) {
    this.#state = mix32(seed);
  }

  seed(): number {
    return this.#state;
  }

  nextU32(): number {
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = u32(x || 0x6d2b79f5);
    return this.#state;
  }

  next01(): number {
    return this.nextU32() * UINT32_SCALE;
  }

  nextRange(min: number, max: number): number {
    if (max < min) throw new Error('rng range max must be >= min');
    return min + (max - min) * this.next01();
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    if (max < min) throw new Error('rng integer range is empty');
    const span = max - min + 1;
    return min + Math.floor(this.next01() * span);
  }

  fork(label: string): DeterministicRng {
    return new DeterministicRng(mix32(this.#state ^ hashString32(label)));
  }

  clone(): DeterministicRng {
    const copy = new DeterministicRng(1);
    copy.#state = this.#state;
    return copy;
  }
}

export interface FixedStepConfig {
  readonly fixedDeltaSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDeltaSeconds: number;
}

export interface StepResult {
  readonly steps: number;
  readonly simulationDeltaSeconds: number;
  readonly accumulatedSeconds: number;
  readonly droppedSeconds: number;
}

export class FixedStepClock {
  #config: FixedStepConfig;
  #tick = 0;
  #simulationSeconds = 0;
  #wallSeconds = 0;
  #accumulator = 0;

  constructor(config: FixedStepConfig) {
    if (config.fixedDeltaSeconds <= 0) throw new Error('fixed delta must be positive');
    if (config.maxCatchUpSteps < 1) throw new Error('max catch-up steps must be positive');
    if (config.maxFrameDeltaSeconds < config.fixedDeltaSeconds) throw new Error('frame delta cap must cover one fixed step');
    this.#config = { ...config };
  }

  advance(realDeltaSeconds: number, step: (clock: RuntimeClockState) => void): StepResult {
    const clamped = Math.min(this.#config.maxFrameDeltaSeconds, Math.max(0, realDeltaSeconds));
    this.#wallSeconds += clamped;
    this.#accumulator += clamped;
    let steps = 0;
    let droppedSeconds = 0;

    while (this.#accumulator >= this.#config.fixedDeltaSeconds && steps < this.#config.maxCatchUpSteps) {
      this.#tick += 1;
      this.#simulationSeconds += this.#config.fixedDeltaSeconds;
      this.#accumulator -= this.#config.fixedDeltaSeconds;
      steps += 1;
      step(this.state());
    }

    if (this.#accumulator >= this.#config.fixedDeltaSeconds) {
      const retained = this.#accumulator % this.#config.fixedDeltaSeconds;
      droppedSeconds = this.#accumulator - retained;
      this.#accumulator = retained;
    }

    return {
      steps,
      simulationDeltaSeconds: steps * this.#config.fixedDeltaSeconds,
      accumulatedSeconds: this.#accumulator,
      droppedSeconds,
    };
  }

  state(): RuntimeClockState {
    return {
      tick: asTick(this.#tick),
      simulationSeconds: this.#simulationSeconds,
      wallSeconds: this.#wallSeconds,
      deltaSeconds: this.#config.fixedDeltaSeconds,
      fixedDeltaSeconds: this.#config.fixedDeltaSeconds,
    };
  }

  reset(): void {
    this.#tick = 0;
    this.#simulationSeconds = 0;
    this.#wallSeconds = 0;
    this.#accumulator = 0;
  }
}

export function quantize(value: number, quantum = 1 / 4096): number {
  if (quantum <= 0) return value;
  return Math.round(value / quantum) * quantum;
}

export function quantizeVec3(value: Vec3, quantum = 1 / 4096): Vec3 {
  return { x: quantize(value.x, quantum), y: quantize(value.y, quantum), z: quantize(value.z, quantum) };
}

export function normalizeInputFrame(input: InputFrame): InputFrame {
  return {
    sequence: asSequence(input.sequence),
    tick: asTick(input.tick),
    moveX: Math.max(-1, Math.min(1, quantize(input.moveX, 1 / 1024))),
    moveZ: Math.max(-1, Math.min(1, quantize(input.moveZ, 1 / 1024))),
    lookX: quantize(input.lookX, 1 / 4096),
    lookY: quantize(input.lookY, 1 / 4096),
    buttons: u32(input.buttons),
    analog: Object.fromEntries(
      Object.entries(input.analog)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, quantize(Math.max(-1, Math.min(1, value)), 1 / 1024)]),
    ),
  };
}

export interface DeterministicInputBuffer {
  push(input: InputFrame): void;
  at(tick: Tick): InputFrame | undefined;
  latest(): InputFrame | undefined;
  since(sequence: Sequence): readonly InputFrame[];
  clearThrough(sequence: Sequence): void;
  size(): number;
}

export class InputRingBuffer implements DeterministicInputBuffer {
  #capacity: number;
  #items = new Map<number, InputFrame>();

  constructor(capacity: number) {
    if (capacity < 2) throw new Error('input ring capacity must be >= 2');
    this.#capacity = capacity;
  }

  push(input: InputFrame): void {
    const normalized = normalizeInputFrame(input);
    const key = Number(normalized.sequence);
    this.#items.set(key, normalized);
    while (this.#items.size > this.#capacity) {
      const oldest = this.#items.keys().next().value;
      if (oldest === undefined) break;
      this.#items.delete(oldest);
    }
  }

  at(tick: Tick): InputFrame | undefined {
    for (const input of this.#items.values()) {
      if (input.tick === tick) return input;
    }
    return undefined;
  }

  latest(): InputFrame | undefined {
    const values = [...this.#items.values()];
    return values.at(-1);
  }

  since(sequence: Sequence): readonly InputFrame[] {
    return [...this.#items.entries()]
      .filter(([key]) => key > sequence)
      .sort(([a], [b]) => a - b)
      .map(([, input]) => input);
  }

  clearThrough(sequence: Sequence): void {
    for (const key of this.#items.keys()) {
      if (key <= sequence) this.#items.delete(key);
    }
  }

  size(): number {
    return this.#items.size;
  }
}

export interface TickDigestInput {
  readonly tick: Tick;
  readonly values: readonly number[];
  readonly labels?: readonly string[];
}

export function tickDigest(input: TickDigestInput): number {
  const labels = input.labels ?? [];
  let hash = mix32(Number(input.tick));
  for (const [index, value] of input.values.entries()) {
    hash = mix32(hash ^ Math.trunc(quantize(value) * 1000003) ^ index);
  }
  for (const label of labels) hash = mix32(hash ^ hashString32(label));
  return hash >>> 0;
}

export interface Checkpoint<T> {
  readonly tick: Tick;
  readonly digest: number;
  readonly state: T;
}

export class CheckpointRing<T> {
  #capacity: number;
  #items: Checkpoint<T>[] = [];

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('checkpoint capacity must be positive');
    this.#capacity = capacity;
  }

  push(checkpoint: Checkpoint<T>): void {
    this.#items.push(structuredClone(checkpoint));
    if (this.#items.length > this.#capacity) this.#items.splice(0, this.#items.length - this.#capacity);
  }

  nearestAtOrBefore(tick: Tick): Checkpoint<T> | undefined {
    for (let i = this.#items.length - 1; i >= 0; i -= 1) {
      if (this.#items[i]!.tick <= tick) return structuredClone(this.#items[i]!);
    }
    return undefined;
  }

  latest(): Checkpoint<T> | undefined {
    const latest = this.#items.at(-1);
    return latest ? structuredClone(latest) : undefined;
  }

  all(): readonly Checkpoint<T>[] {
    return this.#items.map((item) => structuredClone(item));
  }

  clear(): void {
    this.#items = [];
  }

  size(): number {
    return this.#items.length;
  }
}

export interface DeterministicTimer {
  readonly id: string;
  readonly dueTick: Tick;
  readonly repeatEveryTicks?: number;
}

export class TickTimerWheel {
  #wheelSize: number;
  #buckets: Map<number, DeterministicTimer>[];

  constructor(wheelSize = 256) {
    if (wheelSize < 8) throw new Error('timer wheel is too small');
    this.#wheelSize = wheelSize;
    this.#buckets = Array.from({ length: wheelSize }, () => new Map());
  }

  schedule(timer: DeterministicTimer): void {
    const index = Number(timer.dueTick) % this.#wheelSize;
    this.#buckets[index]!.set(timer.id, structuredClone(timer));
  }

  cancel(id: string): boolean {
    return this.#buckets.some((bucket) => bucket.delete(id));
  }

  advance(tick: Tick): DeterministicTimer[] {
    const bucket = this.#buckets[Number(tick) % this.#wheelSize]!;
    const due: DeterministicTimer[] = [];
    for (const timer of bucket.values()) {
      if (timer.dueTick <= tick) {
        due.push(structuredClone(timer));
        bucket.delete(timer.id);
        if (timer.repeatEveryTicks && timer.repeatEveryTicks > 0) {
          this.schedule({ ...timer, dueTick: asTick(Number(tick) + timer.repeatEveryTicks) });
        }
      }
    }
    return due.sort((a, b) => Number(a.dueTick) - Number(b.dueTick) || a.id.localeCompare(b.id));
  }

  clear(): void {
    for (const bucket of this.#buckets) bucket.clear();
  }
}

export interface DeterministicSequenceState {
  readonly next: Sequence;
}

export class SequenceSource {
  #next = 1;

  allocate(): Sequence {
    const value = this.#next;
    this.#next = this.#next >= UINT32_MAX ? 1 : this.#next + 1;
    return asSequence(value);
  }

  snapshot(): DeterministicSequenceState {
    return { next: asSequence(this.#next) };
  }

  restore(state: DeterministicSequenceState): void {
    const value = Number(state.next);
    if (!Number.isInteger(value) || value < 1 || value > UINT32_MAX) throw new Error('invalid sequence state');
    this.#next = value;
  }
}

/**
 * V6 deterministic kernel.
 * Owns monotonic simulation time, tick budgeting, seeded random streams,
 * sequence allocation, rolling measurements and lifecycle-safe scheduling.
 * It intentionally contains no DOM, Three.js or wall-clock gameplay state.
 */

export type TickId = number & { readonly __brand: 'TickId' };
export type Sequence = number & { readonly __brand: 'Sequence' };

export interface KernelConfig {
  tickHz: number;
  maxCatchUpTicks: number;
  maxDeltaSeconds: number;
  seed: number;
  measurementWindow: number;
}

export interface TickContext {
  readonly id: TickId;
  readonly deltaSeconds: number;
  readonly simulationSeconds: number;
  readonly alpha: number;
  readonly random: DeterministicRandom;
}

export interface KernelMeasurement {
  readonly tickId: TickId;
  readonly durationSeconds: number;
  readonly budgetSeconds: number;
  readonly overBudget: boolean;
}

export interface KernelSnapshot {
  readonly tickId: TickId;
  readonly simulationSeconds: number;
  readonly accumulatorSeconds: number;
  readonly droppedSeconds: number;
  readonly randomState: number;
  readonly sequence: Sequence;
  readonly state: 'running' | 'paused' | 'disposed';
}

const DEFAULT_CONFIG: KernelConfig = {
  tickHz: 60,
  maxCatchUpTicks: 5,
  maxDeltaSeconds: 0.25,
  seed: 0x5eeda11,
  measurementWindow: 120,
};

function assertFinitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and > 0`);
  return value;
}

function normalizeSeed(seed: number): number {
  const normalized = seed | 0;
  return normalized === 0 ? 0x6d2b79f5 : normalized;
}

export class DeterministicRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = normalizeSeed(seed);
  }

  nextUint(): number {
    let t = this.#state;
    t ^= t << 13;
    t ^= t >>> 17;
    t ^= t << 5;
    this.#state = t | 0;
    return (this.#state >>> 0);
  }

  nextFloat(): number {
    return this.nextUint() / 0x1_0000_0000;
  }

  range(min: number, max: number): number {
    if (!(max >= min)) throw new RangeError('max must be >= min');
    return min + (max - min) * this.nextFloat();
  }

  integer(minInclusive: number, maxInclusive: number): number {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    if (max < min) throw new RangeError('integer range is empty');
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError('cannot pick from an empty collection');
    return values[this.integer(0, values.length - 1)]!;
  }

  fork(salt: number): DeterministicRandom {
    return new DeterministicRandom((this.#state ^ salt) | 0);
  }

  get state(): number {
    return this.#state;
  }

  restore(state: number): void {
    this.#state = normalizeSeed(state);
  }
}

export class DeterministicKernel {
  readonly #config: KernelConfig;
  readonly #random: DeterministicRandom;
  readonly #measurements: KernelMeasurement[] = [];
  #tickId = 0 as TickId;
  #simulationSeconds = 0;
  #accumulatorSeconds = 0;
  #droppedSeconds = 0;
  #sequence = 0 as Sequence;
  #state: KernelSnapshot['state'] = 'paused';

  constructor(config: Partial<KernelConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.#config = {
      tickHz: assertFinitePositive(merged.tickHz, 'tickHz'),
      maxCatchUpTicks: Math.max(1, Math.floor(merged.maxCatchUpTicks)),
      maxDeltaSeconds: assertFinitePositive(merged.maxDeltaSeconds, 'maxDeltaSeconds'),
      seed: normalizeSeed(merged.seed),
      measurementWindow: Math.max(1, Math.floor(merged.measurementWindow)),
    };
    this.#random = new DeterministicRandom(this.#config.seed);
  }

  get tickSeconds(): number {
    return 1 / this.#config.tickHz;
  }

  get state(): KernelSnapshot['state'] {
    return this.#state;
  }

  start(): void {
    this.#assertNotDisposed();
    this.#state = 'running';
  }

  pause(): void {
    this.#assertNotDisposed();
    this.#state = 'paused';
  }

  dispose(): void {
    this.#state = 'disposed';
    this.#measurements.length = 0;
  }

  advance(realDeltaSeconds: number, runTick: (context: TickContext) => number = () => 0): number {
    this.#assertNotDisposed();
    if (this.#state !== 'running') return 0;
    const clamped = Math.min(Math.max(realDeltaSeconds, 0), this.#config.maxDeltaSeconds);
    this.#accumulatorSeconds += clamped;
    let processed = 0;
    while (this.#accumulatorSeconds >= this.tickSeconds && processed < this.#config.maxCatchUpTicks) {
      const next = (this.#tickId + 1) as TickId;
      const context: TickContext = {
        id: next,
        deltaSeconds: this.tickSeconds,
        simulationSeconds: this.#simulationSeconds + this.tickSeconds,
        alpha: Math.min(1, this.#accumulatorSeconds / this.tickSeconds),
        random: this.#random,
      };
      const measured = Math.max(0, Number(runTick(context)) || 0);
      this.#tickId = next;
      this.#simulationSeconds = context.simulationSeconds;
      this.#accumulatorSeconds -= this.tickSeconds;
      this.#pushMeasurement({
        tickId: next,
        durationSeconds: measured,
        budgetSeconds: this.tickSeconds,
        overBudget: measured > this.tickSeconds,
      });
      processed += 1;
    }
    if (this.#accumulatorSeconds >= this.tickSeconds) {
      const dropped = this.#accumulatorSeconds - (this.#accumulatorSeconds % this.tickSeconds);
      this.#accumulatorSeconds %= this.tickSeconds;
      this.#droppedSeconds += dropped;
    }
    return processed;
  }

  nextSequence(): Sequence {
    this.#assertNotDisposed();
    this.#sequence = (this.#sequence + 1) as Sequence;
    return this.#sequence;
  }

  snapshot(): KernelSnapshot {
    return {
      tickId: this.#tickId,
      simulationSeconds: this.#simulationSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
      droppedSeconds: this.#droppedSeconds,
      randomState: this.#random.state,
      sequence: this.#sequence,
      state: this.#state,
    };
  }

  restore(snapshot: KernelSnapshot): void {
    this.#assertNotDisposed();
    if (snapshot.tickId < 0 || snapshot.simulationSeconds < 0 || snapshot.accumulatorSeconds < 0) {
      throw new RangeError('invalid kernel snapshot');
    }
    this.#tickId = snapshot.tickId;
    this.#simulationSeconds = snapshot.simulationSeconds;
    this.#accumulatorSeconds = Math.min(snapshot.accumulatorSeconds, this.tickSeconds);
    this.#droppedSeconds = Math.max(0, snapshot.droppedSeconds);
    this.#sequence = snapshot.sequence;
    this.#random.restore(snapshot.randomState);
    this.#state = snapshot.state === 'disposed' ? 'paused' : snapshot.state;
  }

  measurements(): readonly KernelMeasurement[] {
    return this.#measurements;
  }

  averageTickDuration(): number {
    if (this.#measurements.length === 0) return 0;
    return this.#measurements.reduce((sum, sample) => sum + sample.durationSeconds, 0) / this.#measurements.length;
  }

  overBudgetRatio(): number {
    if (this.#measurements.length === 0) return 0;
    return this.#measurements.filter((sample) => sample.overBudget).length / this.#measurements.length;
  }

  cloneRandom(): DeterministicRandom {
    const clone = new DeterministicRandom(1);
    clone.restore(this.#random.state);
    return clone;
  }

  #pushMeasurement(sample: KernelMeasurement): void {
    this.#measurements.push(sample);
    while (this.#measurements.length > this.#config.measurementWindow) this.#measurements.shift();
  }

  #assertNotDisposed(): void {
    if (this.#state === 'disposed') throw new Error('deterministic kernel is disposed');
  }
}

export interface DeterministicTask<T> {
  readonly id: string;
  readonly execute: (context: TickContext) => T;
  readonly cadenceTicks: number;
  nextTick: number;
}

export class DeterministicTaskScheduler {
  readonly #tasks = new Map<string, DeterministicTask<unknown>>();

  register<T>(task: DeterministicTask<T>): void {
    if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(task.id)) throw new TypeError('invalid task id');
    if (!Number.isInteger(task.cadenceTicks) || task.cadenceTicks < 1) throw new RangeError('invalid cadence');
    if (this.#tasks.has(task.id)) throw new Error(`task already registered: ${task.id}`);
    this.#tasks.set(task.id, task as DeterministicTask<unknown>);
  }

  remove(id: string): boolean {
    return this.#tasks.delete(id);
  }

  run(context: TickContext): number {
    let ran = 0;
    const ordered = [...this.#tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const task of ordered) {
      if (context.id < task.nextTick) continue;
      task.execute(context);
      task.nextTick = context.id + task.cadenceTicks;
      ran += 1;
    }
    return ran;
  }

  clear(): void {
    this.#tasks.clear();
  }

  describe(): readonly { id: string; cadenceTicks: number; nextTick: number }[] {
    return [...this.#tasks.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({ id: task.id, cadenceTicks: task.cadenceTicks, nextTick: task.nextTick }));
  }
}

export interface ChecksumState {
  readonly count: number;
  readonly hash: number;
}

export function checksumNumbers(values: readonly number[]): ChecksumState {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const normalized = Number.isFinite(value) ? Math.trunc(value * 1_000_000) : 0;
    hash ^= normalized;
    hash = Math.imul(hash, 0x01000193);
  }
  return { count: values.length, hash: hash >>> 0 };
}

export function checksumStrings(values: readonly string[]): ChecksumState {
  let hash = 0x811c9dc5;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return { count: values.length, hash: hash >>> 0 };
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function digest(value: unknown): number {
  return checksumStrings([stableJson(value)]).hash;
}

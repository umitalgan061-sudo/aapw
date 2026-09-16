export type Tick = number;
export type EntityId = number;
export type SystemId = string;

export interface SimulationClockConfig {
  readonly tickRateHz: number;
  readonly maxFrameDeltaSeconds: number;
  readonly maxCatchUpTicks: number;
  readonly maxTicksPerFrame: number;
}

export interface SimulationFrame {
  readonly tick: Tick;
  readonly deltaSeconds: number;
  readonly simulatedTicks: number;
  readonly alpha: number;
  readonly droppedSeconds: number;
}

export interface SimulationContext {
  readonly tick: Tick;
  readonly deltaSeconds: number;
  readonly frameDeltaSeconds: number;
  readonly deterministicSeed: number;
  readonly frameIndex: number;
}

export interface SimulationSystem {
  readonly id: SystemId;
  readonly order: number;
  readonly fixedUpdate: (context: SimulationContext) => void;
  readonly lateUpdate?: (context: SimulationContext) => void;
}

export interface TickState {
  readonly tick: Tick;
  readonly accumulatorSeconds: number;
  readonly frameIndex: number;
}

export interface KernelSnapshot {
  readonly version: 1;
  readonly state: TickState;
  readonly droppedSeconds: number;
}

export interface DeterministicRngState {
  readonly state: number;
}

const DEFAULT_CONFIG: SimulationClockConfig = {
  tickRateHz: 60,
  maxFrameDeltaSeconds: 0.25,
  maxCatchUpTicks: 8,
  maxTicksPerFrame: 8,
};

const UINT32_MAX_PLUS_ONE = 0x1_0000_0000;

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
}

export function normalizeSimulationClockConfig(
  partial: Partial<SimulationClockConfig> = {},
): SimulationClockConfig {
  const config: SimulationClockConfig = {
    ...DEFAULT_CONFIG,
    ...partial,
  };
  assertFinitePositive(config.tickRateHz, 'tickRateHz');
  assertFinitePositive(config.maxFrameDeltaSeconds, 'maxFrameDeltaSeconds');
  assertFiniteNonNegative(config.maxCatchUpTicks, 'maxCatchUpTicks');
  assertFiniteNonNegative(config.maxTicksPerFrame, 'maxTicksPerFrame');
  if (!Number.isInteger(config.maxCatchUpTicks) || !Number.isInteger(config.maxTicksPerFrame)) {
    throw new RangeError('catch-up limits must be integers');
  }
  if (config.maxTicksPerFrame > config.maxCatchUpTicks) {
    throw new RangeError('maxTicksPerFrame cannot exceed maxCatchUpTicks');
  }
  return Object.freeze(config);
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

export class DeterministicRng {
  readonly #seed: number;
  #state: number;

  public constructor(seed: number) {
    if (!Number.isFinite(seed)) throw new RangeError('seed must be finite');
    this.#seed = mix32(seed);
    this.#state = this.#seed || 0xa341316c;
  }

  public get seed(): number {
    return this.#seed;
  }

  public get state(): DeterministicRngState {
    return { state: this.#state >>> 0 };
  }

  public restore(state: DeterministicRngState): void {
    if (!Number.isInteger(state.state) || state.state < 0 || state.state >= UINT32_MAX_PLUS_ONE) {
      throw new RangeError('invalid RNG state');
    }
    this.#state = state.state >>> 0 || 0xa341316c;
  }

  public nextUint(): number {
    let x = this.#state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state;
  }

  public nextFloat(): number {
    return this.nextUint() / UINT32_MAX_PLUS_ONE;
  }

  public nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError('integer bounds are required');
    }
    if (maxExclusive <= minInclusive) throw new RangeError('invalid integer range');
    const width = maxExclusive - minInclusive;
    return minInclusive + Math.floor(this.nextFloat() * width);
  }

  public fork(streamId: number): DeterministicRng {
    const child = new DeterministicRng(mix32(this.#seed ^ mix32(streamId)));
    child.#state = mix32(this.#state ^ mix32(streamId + 0x9e3779b9));
    return child;
  }
}

interface RegisteredSystem {
  readonly system: SimulationSystem;
  readonly insertionOrder: number;
}

export class SimulationKernel {
  readonly #config: SimulationClockConfig;
  readonly #tickDeltaSeconds: number;
  readonly #systems: RegisteredSystem[] = [];
  readonly #rng: DeterministicRng;
  #accumulatorSeconds = 0;
  #tick: Tick = 0;
  #frameIndex = 0;
  #droppedSeconds = 0;
  #insertionOrder = 0;
  #running = false;

  public constructor(
    seed: number,
    config: Partial<SimulationClockConfig> = {},
  ) {
    this.#config = normalizeSimulationClockConfig(config);
    this.#tickDeltaSeconds = 1 / this.#config.tickRateHz;
    this.#rng = new DeterministicRng(seed);
  }

  public get tick(): Tick {
    return this.#tick;
  }

  public get frameIndex(): number {
    return this.#frameIndex;
  }

  public get isRunning(): boolean {
    return this.#running;
  }

  public get fixedDeltaSeconds(): number {
    return this.#tickDeltaSeconds;
  }

  public get rng(): DeterministicRng {
    return this.#rng;
  }

  public get config(): SimulationClockConfig {
    return this.#config;
  }

  public start(): void {
    this.#running = true;
  }

  public stop(): void {
    this.#running = false;
  }

  public addSystem(system: SimulationSystem): () => void {
    if (!system.id.trim()) throw new Error('system id must not be empty');
    if (!Number.isFinite(system.order)) throw new RangeError('system order must be finite');
    if (this.#systems.some((entry) => entry.system.id === system.id)) {
      throw new Error(`duplicate system id: ${system.id}`);
    }
    const entry: RegisteredSystem = {
      system,
      insertionOrder: this.#insertionOrder++,
    };
    this.#systems.push(entry);
    this.#sortSystems();
    return () => {
      const index = this.#systems.indexOf(entry);
      if (index >= 0) this.#systems.splice(index, 1);
    };
  }

  public listSystems(): readonly SystemId[] {
    return this.#systems.map((entry) => entry.system.id);
  }

  public advance(frameDeltaSeconds: number): SimulationFrame {
    assertFiniteNonNegative(frameDeltaSeconds, 'frameDeltaSeconds');
    this.#frameIndex += 1;
    if (!this.#running) {
      return {
        tick: this.#tick,
        deltaSeconds: 0,
        simulatedTicks: 0,
        alpha: 0,
        droppedSeconds: 0,
      };
    }

    const clampedDelta = Math.min(frameDeltaSeconds, this.#config.maxFrameDeltaSeconds);
    const clampedOverflow = frameDeltaSeconds - clampedDelta;
    this.#accumulatorSeconds += clampedDelta;
    this.#droppedSeconds += clampedOverflow;

    const maximumTicks = Math.min(this.#config.maxTicksPerFrame, this.#config.maxCatchUpTicks);
    let simulatedTicks = 0;
    while (this.#accumulatorSeconds + Number.EPSILON >= this.#tickDeltaSeconds && simulatedTicks < maximumTicks) {
      this.#stepFixed();
      simulatedTicks += 1;
      this.#accumulatorSeconds -= this.#tickDeltaSeconds;
    }

    if (simulatedTicks >= maximumTicks && this.#accumulatorSeconds >= this.#tickDeltaSeconds) {
      const retained = this.#accumulatorSeconds % this.#tickDeltaSeconds;
      this.#droppedSeconds += this.#accumulatorSeconds - retained;
      this.#accumulatorSeconds = retained;
    }

    const alpha = this.#accumulatorSeconds / this.#tickDeltaSeconds;
    const frame: SimulationFrame = {
      tick: this.#tick,
      deltaSeconds: this.#tickDeltaSeconds,
      simulatedTicks,
      alpha,
      droppedSeconds: this.#droppedSeconds,
    };
    this.#runLateUpdates(frameDeltaSeconds);
    return frame;
  }

  public step(): SimulationFrame {
    if (!this.#running) this.#running = true;
    this.#frameIndex += 1;
    this.#stepFixed();
    return {
      tick: this.#tick,
      deltaSeconds: this.#tickDeltaSeconds,
      simulatedTicks: 1,
      alpha: 0,
      droppedSeconds: this.#droppedSeconds,
    };
  }

  public snapshot(): KernelSnapshot {
    return Object.freeze({
      version: 1,
      state: Object.freeze({
        tick: this.#tick,
        accumulatorSeconds: this.#accumulatorSeconds,
        frameIndex: this.#frameIndex,
      }),
      droppedSeconds: this.#droppedSeconds,
    });
  }

  public restore(snapshot: KernelSnapshot): void {
    if (snapshot.version !== 1) throw new Error(`unsupported kernel snapshot version: ${snapshot.version}`);
    if (!Number.isInteger(snapshot.state.tick) || snapshot.state.tick < 0) throw new Error('invalid tick');
    if (!Number.isInteger(snapshot.state.frameIndex) || snapshot.state.frameIndex < 0) throw new Error('invalid frame index');
    assertFiniteNonNegative(snapshot.state.accumulatorSeconds, 'snapshot accumulatorSeconds');
    assertFiniteNonNegative(snapshot.droppedSeconds, 'snapshot droppedSeconds');
    this.#tick = snapshot.state.tick;
    this.#accumulatorSeconds = snapshot.state.accumulatorSeconds;
    this.#frameIndex = snapshot.state.frameIndex;
    this.#droppedSeconds = snapshot.droppedSeconds;
  }

  public digest(): string {
    const systemDigest = this.#systems.map((entry) => `${entry.system.order}:${entry.system.id}`).join('|');
    const payload = `${this.#tick};${this.#frameIndex};${this.#accumulatorSeconds.toFixed(12)};${this.#droppedSeconds.toFixed(12)};${this.#rng.state.state};${systemDigest}`;
    return digestString(payload);
  }

  #sortSystems(): void {
    this.#systems.sort((left, right) => left.system.order - right.system.order || left.insertionOrder - right.insertionOrder);
  }

  #stepFixed(): void {
    this.#tick += 1;
    const context: SimulationContext = {
      tick: this.#tick,
      deltaSeconds: this.#tickDeltaSeconds,
      frameDeltaSeconds: this.#tickDeltaSeconds,
      deterministicSeed: this.#rng.state.state,
      frameIndex: this.#frameIndex,
    };
    for (const entry of this.#systems) entry.system.fixedUpdate(context);
  }

  #runLateUpdates(frameDeltaSeconds: number): void {
    const context: SimulationContext = {
      tick: this.#tick,
      deltaSeconds: this.#tickDeltaSeconds,
      frameDeltaSeconds,
      deterministicSeed: this.#rng.state.state,
      frameIndex: this.#frameIndex,
    };
    for (const entry of this.#systems) entry.system.lateUpdate?.(context);
  }
}

export function digestString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + index;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export interface FixedPointVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface QuantizedVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function quantizeVector(vector: FixedPointVector, scale = 1000): QuantizedVector {
  assertFinitePositive(scale, 'scale');
  return {
    x: Math.round(vector.x * scale),
    y: Math.round(vector.y * scale),
    z: Math.round(vector.z * scale),
  };
}

export function dequantizeVector(vector: QuantizedVector, scale = 1000): FixedPointVector {
  assertFinitePositive(scale, 'scale');
  return {
    x: vector.x / scale,
    y: vector.y / scale,
    z: vector.z / scale,
  };
}

export function deterministicLerp(from: number, to: number, amount: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(amount)) {
    throw new RangeError('lerp inputs must be finite');
  }
  const clamped = Math.max(0, Math.min(1, amount));
  return from + (to - from) * clamped;
}

export function smoothApproach(current: number, target: number, rate: number, deltaSeconds: number): number {
  assertFiniteNonNegative(rate, 'rate');
  assertFiniteNonNegative(deltaSeconds, 'deltaSeconds');
  if (!Number.isFinite(current) || !Number.isFinite(target)) throw new RangeError('values must be finite');
  const blend = 1 - Math.exp(-rate * deltaSeconds);
  return deterministicLerp(current, target, blend);
}

export function clampMagnitude(value: number, maximum: number): number {
  assertFiniteNonNegative(maximum, 'maximum');
  if (!Number.isFinite(value)) throw new RangeError('value must be finite');
  return Math.max(-maximum, Math.min(maximum, value));
}

export interface TickAccumulator {
  readonly tickRateHz: number;
  readonly tickDeltaSeconds: number;
  readonly accumulatorSeconds: number;
  readonly interpolationAlpha: number;
}

export function calculateAccumulator(
  accumulatorSeconds: number,
  frameDeltaSeconds: number,
  tickRateHz: number,
): TickAccumulator {
  assertFiniteNonNegative(accumulatorSeconds, 'accumulatorSeconds');
  assertFiniteNonNegative(frameDeltaSeconds, 'frameDeltaSeconds');
  assertFinitePositive(tickRateHz, 'tickRateHz');
  const tickDeltaSeconds = 1 / tickRateHz;
  const total = accumulatorSeconds + frameDeltaSeconds;
  const remainder = total % tickDeltaSeconds;
  return Object.freeze({
    tickRateHz,
    tickDeltaSeconds,
    accumulatorSeconds: remainder,
    interpolationAlpha: remainder / tickDeltaSeconds,
  });
}

export interface ReplayTickRecord {
  readonly tick: number;
  readonly inputDigest: string;
  readonly stateDigest: string;
}

export class ReplayRecorder {
  readonly #records: ReplayTickRecord[] = [];
  readonly #maxRecords: number;

  public constructor(maxRecords = 4096) {
    if (!Number.isInteger(maxRecords) || maxRecords <= 0) throw new RangeError('maxRecords must be positive integer');
    this.#maxRecords = maxRecords;
  }

  public record(record: ReplayTickRecord): void {
    if (!Number.isInteger(record.tick) || record.tick < 0) throw new RangeError('record tick must be non-negative integer');
    if (!record.inputDigest || !record.stateDigest) throw new Error('replay digests must not be empty');
    const previous = this.#records.at(-1);
    if (previous && record.tick <= previous.tick) throw new Error('replay ticks must be strictly increasing');
    this.#records.push(Object.freeze({ ...record }));
    if (this.#records.length > this.#maxRecords) this.#records.shift();
  }

  public records(): readonly ReplayTickRecord[] {
    return this.#records;
  }

  public find(tick: number): ReplayTickRecord | undefined {
    return this.#records.find((record) => record.tick === tick);
  }

  public digest(): string {
    return digestString(this.#records.map((record) => `${record.tick}:${record.inputDigest}:${record.stateDigest}`).join('|'));
  }

  public clear(): void {
    this.#records.length = 0;
  }
}

export interface TimelineEvent<TPayload> {
  readonly tick: number;
  readonly order: number;
  readonly type: string;
  readonly payload: TPayload;
}

export class DeterministicTimeline<TPayload> {
  readonly #events: TimelineEvent<TPayload>[] = [];
  #order = 0;

  public schedule(tick: number, type: string, payload: TPayload): TimelineEvent<TPayload> {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError('tick must be non-negative integer');
    if (!type.trim()) throw new Error('event type must not be empty');
    const event = Object.freeze({ tick, order: this.#order++, type, payload });
    this.#events.push(event);
    this.#events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    return event;
  }

  public drainThrough(tick: number): readonly TimelineEvent<TPayload>[] {
    const drained: TimelineEvent<TPayload>[] = [];
    while (this.#events.length > 0 && this.#events[0].tick <= tick) {
      const event = this.#events.shift();
      if (event) drained.push(event);
    }
    return drained;
  }

  public peek(): TimelineEvent<TPayload> | undefined {
    return this.#events[0];
  }

  public clear(): void {
    this.#events.length = 0;
  }

  public size(): number {
    return this.#events.length;
  }
}

export function createSimulationKernel(seed: number, config?: Partial<SimulationClockConfig>): SimulationKernel {
  return new SimulationKernel(seed, config);
}

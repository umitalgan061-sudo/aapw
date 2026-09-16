import type { Budget, Disposable, EngineResult, EventEnvelope, FrameCommand, FrameEnvelope, RuntimeHealth, Sequence, TelemetrySample, TimeSample } from './types.js';
import { FRAME_ID, TICK_ID } from './types.js';
import { TypedEventBus } from './eventBus.js';
import { EcsWorld } from './ecs.js';
import { FixedStepScheduler } from './scheduler.js';
import { RingBuffer } from './collections.js';
import { hashTuple, toHex32 } from './deterministic.js';

export interface RuntimeKernelOptions {
  readonly scheduler?: ConstructorParameters<typeof FixedStepScheduler>[0];
  readonly budget?: Partial<Budget>;
  readonly eventQueue?: number;
  readonly telemetrySamples?: number;
  readonly commandHistory?: number;
  readonly failAfterErrors?: number;
}

export interface RuntimeFrameInput {
  readonly deltaSeconds: number;
  readonly commands?: readonly FrameCommand[];
}

export interface RuntimeFrameResult {
  readonly frame: FrameEnvelope;
  readonly health: RuntimeHealth;
  readonly telemetry: readonly TelemetrySample[];
}

export class RuntimeKernel implements Disposable {
  public readonly world: EcsWorld;
  public readonly events: TypedEventBus;
  public readonly scheduler: FixedStepScheduler;
  private readonly telemetryBuffer: RingBuffer<TelemetrySample>;
  private readonly commandBuffer: RingBuffer<FrameCommand>;
  private readonly failAfterErrors: number;
  private readonly abort = new AbortController();
  private errorCount = 0;
  private recoveryCount = 0;
  private currentHealth: RuntimeHealth = Object.freeze({ phase: 'booting', score: 1, faults: 0, recoveries: 0 });
  private frameCommands: FrameCommand[] = [];
  private frameEvents: EventEnvelope[] = [];
  private lastChecksum = '';
  private _disposed = false;
  private initialized = false;

  public constructor(options: RuntimeKernelOptions = {}) {
    this.world = new EcsWorld();
    this.events = new TypedEventBus({ maxQueuedEvents: options.eventQueue ?? 4096 });
    this.scheduler = new FixedStepScheduler(options.scheduler ?? {}, options.budget ?? {});
    this.telemetryBuffer = new RingBuffer(options.telemetrySamples ?? 2048);
    this.commandBuffer = new RingBuffer(options.commandHistory ?? 2048);
    this.failAfterErrors = Math.max(1, Math.trunc(options.failAfterErrors ?? 8));
  }

  public get disposed(): boolean { return this._disposed; }
  public get health(): RuntimeHealth { return this.currentHealth; }
  public get lastChecksum(): string { return this.lastChecksum; }

  public initialize(): EngineResult<void> {
    if (this._disposed) return this.failResult('RUNTIME_DISPOSED');
    if (this.initialized) return { ok: true, meta: { status: 'ok', code: 'ALREADY_INITIALIZED' } };
    this.initialized = true;
    this.currentHealth = Object.freeze({ phase: 'ready', score: 1, faults: 0, recoveries: 0 });
    this.events.setClock(TICK_ID(0), FRAME_ID(0));
    return { ok: true, meta: { status: 'ok', code: 'INITIALIZED' } };
  }

  public registerSystem(system: Parameters<FixedStepScheduler['addSystem']>[0]): boolean { return this.scheduler.addSystem(system); }

  public submitCommand(command: FrameCommand): EngineResult<void> {
    if (this._disposed) return this.failResult('RUNTIME_DISPOSED');
    const accepted = this.commandBuffer.push(command);
    if (!accepted && this.commandBuffer.isFull) return this.failResult('COMMAND_HISTORY_FULL');
    return { ok: true, meta: { status: 'ok', code: 'COMMAND_ACCEPTED' } };
  }

  public publish<T>(name: string, payload: T): EngineResult<void> {
    if (this._disposed) return this.failResult('RUNTIME_DISPOSED');
    return this.events.publish(name, payload) ? { ok: true, meta: { status: 'ok', code: 'EVENT_PUBLISHED' } } : this.failResult('EVENT_REJECTED');
  }

  public advance(input: RuntimeFrameInput): RuntimeFrameResult {
    if (this._disposed) return { frame: this.emptyFrame(), health: this.currentHealth, telemetry: this.telemetryBuffer.toArray() };
    if (!this.initialized) this.initialize();
    const started = nowMs();
    this.frameCommands = input.commands ? [...input.commands] : this.commandBuffer.drain(512);
    for (const command of this.frameCommands) this.commandBuffer.push(command);
    const stats = this.scheduler.advance(input.deltaSeconds);
    this.events.setClock(stats.tick, stats.frame);
    this.record('runtime.frame.ms', nowMs() - started, 'ms');
    this.record('runtime.tick', Number(stats.tick), 'count');
    this.record('runtime.systems', stats.executedSystems, 'count');
    this.frameEvents = [];
    this.captureHealth(stats.failedSystems);
    this.lastChecksum = this.computeFrameChecksum(stats);
    const frame: FrameEnvelope = Object.freeze({ frame: stats.frame, tick: stats.tick, deltaSeconds: Math.max(0, input.deltaSeconds), commands: [...this.frameCommands], events: [...this.frameEvents], checksum: this.lastChecksum });
    return { frame, health: this.currentHealth, telemetry: this.telemetryBuffer.toArray() };
  }

  public async flushEvents(): Promise<number> { return this._disposed ? 0 : this.events.flush(); }

  public record(name: string, value: number, unit = 'unit', tags: Readonly<Record<string, string>> = {}): void {
    if (this._disposed || !Number.isFinite(value)) return;
    const sample: TelemetrySample = Object.freeze({ name, value, unit, frame: this.scheduler.currentFrame, tick: this.scheduler.currentTick, tags: Object.freeze({ ...tags }) });
    this.telemetryBuffer.push(sample);
  }

  public snapshot(): Readonly<{ health: RuntimeHealth; scheduler: ReturnType<FixedStepScheduler['stats']>; entities: number; components: number; checksum: string }> {
    return Object.freeze({ health: this.currentHealth, scheduler: this.scheduler.stats, entities: this.world.entityCount, components: this.world.componentStoreCount, checksum: this.lastChecksum });
  }

  public recover(reason = 'runtime-fault'): EngineResult<void> {
    if (this._disposed) return this.failResult('RUNTIME_DISPOSED');
    this.currentHealth = Object.freeze({ phase: 'recovering', score: Math.max(0, this.currentHealth.score - 0.05), faults: this.errorCount, recoveries: this.recoveryCount, ...(reason ? { lastFault: reason } : {}) });
    this.scheduler.reset();
    this.events.reset();
    this.recoveryCount += 1;
    this.currentHealth = Object.freeze({ phase: 'ready', score: Math.max(0.5, this.currentHealth.score), faults: this.errorCount, recoveries: this.recoveryCount });
    return { ok: true, meta: { status: 'ok', code: 'RECOVERED' } };
  }

  public dispose(): void {
    if (this._disposed) return;
    this.abort.abort();
    this.scheduler.dispose();
    this.events.dispose();
    this.world.dispose();
    this.telemetryBuffer.dispose();
    this.commandBuffer.dispose();
    this.frameCommands = [];
    this.frameEvents = [];
    this.currentHealth = Object.freeze({ phase: 'disposed', score: 0, faults: this.errorCount, recoveries: this.recoveryCount });
    this._disposed = true;
  }

  private captureHealth(failedSystems: number): void {
    if (failedSystems <= 0) return;
    this.errorCount += failedSystems;
    const score = Math.max(0, 1 - this.errorCount / (this.failAfterErrors * 2));
    const phase = this.errorCount >= this.failAfterErrors ? 'failed' : 'degraded';
    this.currentHealth = Object.freeze({ phase, score, faults: this.errorCount, recoveries: this.recoveryCount, lastFault: `${failedSystems} system failure(s)` });
  }

  private computeFrameChecksum(stats: ReturnType<FixedStepScheduler['stats']>): string {
    const entityCount = this.world.entityCount;
    const hash = hashTuple(stats.frame, stats.tick, Math.round(stats.accumulator * 1e6), entityCount, this.frameCommands.map(command => String(command.id)).join('|'));
    return toHex32(hash);
  }

  private failResult(code: string): EngineResult<void> { return { ok: false, meta: { status: this._disposed ? 'disposed' : 'rejected', code } }; }
  private emptyFrame(): FrameEnvelope { return Object.freeze({ frame: FRAME_ID(0), tick: TICK_ID(0), deltaSeconds: 0, commands: [], events: [], checksum: '00000000' }); }
}

const nowMs = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export const createRuntimeKernel = (options: RuntimeKernelOptions = {}): RuntimeKernel => {
  const runtime = new RuntimeKernel(options);
  runtime.initialize();
  return runtime;
};

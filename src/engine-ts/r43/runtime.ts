import {
  failure,
  stableDigest,
  success,
  type InputIntent,
  type QualityDecision,
  type QualityTier,
  type Result,
  type R43Config,
  type RuntimeCommand,
  type RuntimeHealth,
  type RuntimeSnapshot,
} from './contracts.ts';
import { AssetOrchestrator, type AssetProvider } from './assets.ts';
import { FixedStepClock } from './clock.ts';
import { InputBuffer, InputHistory, type InputBinding } from './input.ts';
import { NetworkSession, type SnapshotDelta } from './network.ts';
import { HealthMonitor, TelemetryRegistry } from './observability.ts';
import { CheckpointStore, MemorySaveStorage, RuntimeSaveManager, SaveCodec } from './persistence.ts';
import { RenderBudgetGovernor, RenderGraph } from './render.ts';
import { DeterministicScheduler } from './scheduler.ts';
import { CommandSecurityGate, createDefaultSecurityPolicy } from './security.ts';
import { SimulationKernel } from './simulation.ts';

export interface R43RuntimeOptions {
  readonly config?: Partial<R43Config>;
  readonly bindings?: readonly InputBinding[];
  readonly seed?: number;
}

export interface RuntimeFrameResult {
  readonly frame: number;
  readonly tick: number;
  readonly quality: QualityDecision;
  readonly health: RuntimeHealth;
  readonly snapshot: RuntimeSnapshot;
  readonly events: readonly { type: string; frame: number; tick: number; payload?: unknown }[];
  readonly digest: string;
}

const DEFAULT_CONFIG: R43Config = Object.freeze({
  fixedStepHz: 60,
  maxSubSteps: 5,
  maxFrameDeltaSeconds: 0.25,
  frameBudget: {
    targetFrameMs: 16.67,
    simulationMs: 4,
    renderMs: 8,
    streamingMs: 2,
    networkMs: 1,
    scriptingMs: 1.67,
  },
  limits: {
    maxEntities: 20000,
    maxCommandsPerFrame: 256,
    maxEventsPerFrame: 4096,
    maxSnapshots: 64,
    maxAssetBytes: 256 * 1024 * 1024,
    maxNetworkPayloadBytes: 128 * 1024,
    maxSaveBytes: 8 * 1024 * 1024,
  },
  initialQuality: 'high',
  networkSnapshotHz: 20,
  saveSchema: 'aapw.r43',
});

export class R43Runtime {
  readonly config: R43Config;
  readonly clock: FixedStepClock;
  readonly world: SimulationKernel['world'];
  readonly spatial: SimulationKernel['spatial'];
  readonly scheduler: DeterministicScheduler;
  readonly simulation: SimulationKernel;
  readonly render: RenderGraph;
  readonly quality: RenderBudgetGovernor;
  readonly assets: AssetOrchestrator<unknown>;
  readonly telemetry: TelemetryRegistry;
  readonly health: HealthMonitor;
  readonly security: CommandSecurityGate;
  readonly network: NetworkSession<Record<string, unknown>>;
  readonly checkpoints: CheckpointStore;

  #input = new InputBuffer();
  #inputHistory = new InputHistory(240);
  #bindings: readonly InputBinding[];
  #save: RuntimeSaveManager<Record<string, unknown>>;
  #paused = false;
  #initialized = false;
  #qualityDecision: QualityDecision;
  #lastHealth: RuntimeHealth;
  #frameEvents: { type: string; frame: number; tick: number; payload?: unknown }[] = [];

  constructor(options: R43RuntimeOptions = {}) {
    this.config = mergeConfig(DEFAULT_CONFIG, options.config);
    this.clock = new FixedStepClock({
      hz: this.config.fixedStepHz,
      maxSubSteps: this.config.maxSubSteps,
      maxDeltaSeconds: this.config.maxFrameDeltaSeconds,
    });
    this.scheduler = new DeterministicScheduler();
    this.simulation = new SimulationKernel({ clock: this.clock, scheduler: this.scheduler, spatialCellSize: 32 });
    this.world = this.simulation.world;
    this.spatial = this.simulation.spatial;
    this.render = new RenderGraph();
    this.quality = new RenderBudgetGovernor(this.config.initialQuality, 0.5, 1);
    this.assets = new AssetOrchestrator({ maxBytes: this.config.limits.maxAssetBytes, concurrency: 6 });
    this.telemetry = new TelemetryRegistry(8192);
    this.health = new HealthMonitor(120);
    this.security = new CommandSecurityGate(createDefaultSecurityPolicy());
    this.network = new NetworkSession({
      sessionId: stableDigest({ seed: options.seed ?? 0, schema: this.config.saveSchema }),
      snapshotHz: this.config.networkSnapshotHz,
      maxPayloadBytes: this.config.limits.maxNetworkPayloadBytes,
    });
    this.checkpoints = new CheckpointStore(this.config.limits.maxSnapshots);
    const storage = new MemorySaveStorage();
    const codec = new SaveCodec<Record<string, unknown>>({
      schema: this.config.saveSchema,
      version: 1,
      maxBytes: this.config.limits.maxSaveBytes,
    });
    this.#save = new RuntimeSaveManager(codec, storage, 'aapw:r43:runtime');
    this.#bindings = Object.freeze([...(options.bindings ?? defaultBindings())]);
    this.#qualityDecision = this.quality.observe(0, this.config.frameBudget.targetFrameMs);
    this.#lastHealth = this.health.observe({
      frameMs: this.config.frameBudget.targetFrameMs,
      cpuMs: this.config.frameBudget.simulationMs,
      gpuMs: this.config.frameBudget.renderMs,
      memoryPressure: 0,
      networkPressure: 0,
      assetPressure: 0,
    });
  }

  registerSystem(...systems: Parameters<DeterministicScheduler['add']>): void {
    for (const system of systems) this.scheduler.add(system);
  }

  initialize(): Result<RuntimeFrameResult> {
    if (this.#initialized) return success(this.snapshotResult());
    this.#initialized = true;
    this.telemetry.count('runtime.boot', 1, 0);
    return success(this.snapshotResult());
  }

  submitInput(frame: number, raw: Parameters<InputBuffer['sample']>[1]): InputIntent {
    const sampled = this.#input.sample(frame, raw, this.#bindings);
    this.#inputHistory.push(sampled);
    return sampled.intent;
  }

  enqueue(command: RuntimeCommand, nowSeconds = this.clock.simTimeSeconds()): Result<true> {
    if (!this.security.validatePayload(command).ok) return failure({ code: 'R43_COMMAND_REJECTED', message: 'Command payload rejected.', retryable: false });
    const valid = this.security.validateCommand(command, nowSeconds);
    if (!valid.ok || !valid.value) return valid;
    if (this.simulation.commandCount() >= this.config.limits.maxCommandsPerFrame) {
      return failure({ code: 'R43_COMMAND_QUEUE_LIMIT', message: 'Command budget reached.', retryable: true });
    }
    this.simulation.enqueue(valid.value);
    return success(true);
  }

  frame(deltaSeconds: number, frameMs: number, cpuMs: number, gpuMs = 0): Result<RuntimeFrameResult> {
    if (!this.#initialized) this.initialize();
    if (this.#paused) return success(this.snapshotResult());
    const advance = this.simulation.advance(deltaSeconds);
    this.#qualityDecision = this.quality.observe(frameMs, this.config.frameBudget.targetFrameMs, deltaSeconds);
    const assetStats = this.assets.stats();
    const assetPressure = Math.min(1, assetStats.cache.utilization * 0.65 + assetStats.queued / Math.max(1, this.config.limits.maxEventsPerFrame) * 0.35);
    const networkPressure = Math.min(1, this.network.sent.size() / this.config.limits.maxSnapshots);
    this.#lastHealth = this.health.observe({
      frameMs,
      cpuMs,
      gpuMs,
      memoryPressure: 0,
      networkPressure,
      assetPressure,
    });
    this.telemetry.record('runtime.frame.ms', frameMs, advance.clock.frame);
    this.telemetry.record('runtime.cpu.ms', cpuMs, advance.clock.frame);
    this.telemetry.record('runtime.gpu.ms', gpuMs, advance.clock.frame);
    this.telemetry.record('runtime.health.score', this.#lastHealth.score, advance.clock.frame);
    this.#frameEvents = this.simulation.eventsSince(Math.max(0, advance.clock.frame - 1)).slice(-this.config.limits.maxEventsPerFrame) as typeof this.#frameEvents;
    const snapshot = advance.snapshot;
    if (advance.clock.tick % Math.max(1, Math.round(this.config.fixedStepHz / this.config.networkSnapshotHz)) === 0) {
      this.network.createEnvelope({ digest: snapshot.digest, entities: snapshot.entities }, snapshot.tick, this.clock.simTimeSeconds() * 1000, this.network.received.highest());
      this.checkpoints.push(snapshot);
    }
    return success(Object.freeze({
      frame: advance.clock.frame,
      tick: advance.clock.tick,
      quality: this.#qualityDecision,
      health: this.#lastHealth,
      snapshot,
      events: Object.freeze([...this.#frameEvents]),
      digest: stableDigest({ frame: advance.clock.frame, tick: advance.clock.tick, snapshot: snapshot.digest, quality: this.#qualityDecision, health: this.#lastHealth.score }),
    }));
  }

  async requestAsset<T>(
    descriptor: Omit<Parameters<AssetOrchestrator<T>['request']>[0], 'provider'>,
    provider: AssetProvider<T>,
  ): Promise<Result<unknown>> {
    return this.assets.request({ ...descriptor, provider }) as Promise<Result<unknown>>;
  }

  async saveState(payload: Record<string, unknown> = this.toSaveState()): Promise<Result<unknown>> {
    return this.#save.save(payload, this.clock.tick());
  }

  async loadState(): Promise<Result<unknown>> {
    const loaded = await this.#save.load();
    if (!loaded.ok || loaded.value === null || loaded.value === undefined) return loaded;
    return success(loaded.value.payload);
  }

  pause(reason = 'manual'): Result<true> {
    this.#paused = true;
    this.telemetry.count('runtime.pause', 1, this.clock.frame());
    this.simulation.emit('runtime:paused', { reason });
    return success(true);
  }

  resume(): Result<true> {
    this.#paused = false;
    this.telemetry.count('runtime.resume', 1, this.clock.frame());
    this.simulation.emit('runtime:resumed');
    return success(true);
  }

  qualityDecision(): QualityDecision {
    return this.#qualityDecision;
  }

  healthSnapshot(): RuntimeHealth {
    return this.#lastHealth;
  }

  inputHistory(): ReturnType<InputHistory['values']> {
    return this.#inputHistory.values();
  }

  snapshotResult(): RuntimeFrameResult {
    const snapshot = this.simulation.snapshot();
    return Object.freeze({
      frame: this.clock.frame(),
      tick: this.clock.tick(),
      quality: this.#qualityDecision,
      health: this.#lastHealth,
      snapshot,
      events: Object.freeze([...this.#frameEvents]),
      digest: stableDigest({ frame: this.clock.frame(), tick: this.clock.tick(), snapshot: snapshot.digest }),
    });
  }

  toSaveState(): Record<string, unknown> {
    return {
      runtime: this.snapshotResult(),
      quality: this.#qualityDecision,
      input: this.#inputHistory.values(),
    };
  }

  shutdown(): void {
    this.#paused = true;
    this.assets.clear();
    this.telemetry.count('runtime.shutdown', 1, this.clock.frame());
    this.#frameEvents = [];
    this.#initialized = false;
  }
}

function mergeConfig(base: R43Config, override?: Partial<R43Config>): R43Config {
  if (!override) return base;
  return Object.freeze({
    ...base,
    ...override,
    frameBudget: Object.freeze({ ...base.frameBudget, ...(override.frameBudget ?? {}) }),
    limits: Object.freeze({ ...base.limits, ...(override.limits ?? {}) }),
  });
}

function defaultBindings(): readonly InputBinding[] {
  return Object.freeze([
    { action: 'move-x', axis: 'horizontal', direction: 1 },
    { action: 'move-y', axis: 'vertical', direction: 1 },
    { action: 'look-x', axis: 'look-horizontal', direction: 1 },
    { action: 'look-y', axis: 'look-vertical', direction: 1 },
    { action: 'jump', button: 'jump' },
    { action: 'attack', button: 'attack' },
    { action: 'guard', button: 'guard' },
  ]);
}

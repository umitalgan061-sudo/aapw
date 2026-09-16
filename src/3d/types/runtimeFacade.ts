import type { AssetId, AssetProvider, Backend, DeviceCapabilities, FramePlan, QualityTier, RuntimeHealth, RuntimeState, Tick, WorldId } from './platform.js';
import { asTick, asWorldId } from './platform.js';
import { TypedEventBus, FixedStepClock } from './runtime.js';
import { DeterministicRng, asSeed, type ReplayRecorder } from './determinism.js';
import { AssetStreamScheduler } from './assetStream.js';
import { BudgetedResourceCache } from './resourceCache.js';
import { SpatialHashIndex, type SpatialItem } from './spatialIndex.js';
import { TransactionalStateStore } from './stateStore.js';
import { RuntimeTelemetry } from './telemetry.js';
import { RuntimeIntegrityMonitor, RecoverySupervisor } from './runtimeIntegrity.js';
import { InputNormalizer } from './input.js';
import type { InputSnapshot } from './input.js';
import { deriveRenderFeatures, buildFramePlan, AdaptiveRenderScale, type FrameInput, type RenderFeatureDecision } from './renderBridge.js';

export interface RuntimeFacadeConfig {
  readonly worldId: string;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly capabilities: DeviceCapabilities;
  readonly budgets: RuntimeState['budgets'];
  readonly seed: number;
  readonly cacheBytes: number;
  readonly cacheEntries: number;
  readonly streamConcurrency: number;
  readonly streamBytesPerFrame: number;
}

export interface RuntimeFacadeSnapshot {
  readonly runtime: RuntimeState;
  readonly input: InputSnapshot;
  readonly health: RuntimeHealth;
  readonly frameScale: number;
  readonly backend: Backend;
  readonly quality: QualityTier;
}

export interface RuntimeFacadeDependencies {
  readonly assets: AssetProvider;
}

export class TypedRuntimeFacade<State extends object = Record<string, unknown>> {
  readonly #bus = new TypedEventBus<{
    runtime: RuntimeState;
    frame: FramePlan;
    health: RuntimeHealth;
    recovery: { action: string; reason: string };
    input: InputSnapshot;
  }>();
  readonly #clock: FixedStepClock;
  readonly #rng: DeterministicRng;
  readonly #streams: AssetStreamScheduler;
  readonly #cache: BudgetedResourceCache<unknown>;
  readonly #spatial = new SpatialHashIndex(16);
  readonly #state: TransactionalStateStore<State>;
  readonly #telemetry = new RuntimeTelemetry();
  readonly #integrity = new RuntimeIntegrityMonitor();
  readonly #recovery = new RecoverySupervisor();
  readonly #input = new InputNormalizer();
  readonly #scale = new AdaptiveRenderScale(0.5, 1);
  readonly #features: RenderFeatureDecision;
  readonly #worldId: WorldId;
  readonly #backend: Backend;
  readonly #quality: QualityTier;
  readonly #capabilities: DeviceCapabilities;
  readonly #budgets: RuntimeState['budgets'];
  #runtime: RuntimeState;
  #frameId = 0;
  #lastHealth: RuntimeHealth = { frameTimeMs: 0, droppedFrames: 0, memoryBytes: 0, gpuMemoryBytes: 0, assetQueueDepth: 0, simulationQueueDepth: 0, recoveredDeviceCount: 0 };

  constructor(config: RuntimeFacadeConfig, dependencies: RuntimeFacadeDependencies, initialState: State) {
    this.#worldId = asWorldId(config.worldId);
    this.#backend = config.backend;
    this.#quality = config.quality;
    this.#capabilities = Object.freeze({ ...config.capabilities });
    this.#budgets = Object.freeze({ ...config.budgets });
    this.#runtime = Object.freeze({ worldId: this.#worldId, tick: asTick(0), mode: 'interactive', backend: config.backend, quality: config.quality, budgets: this.#budgets, capabilities: this.#capabilities });
    this.#clock = new FixedStepClock({ fixedStepMs: 1000 / 60, maxDeltaMs: 200, maxCatchUpSteps: 5 });
    this.#rng = new DeterministicRng(asSeed(config.seed));
    this.#streams = new AssetStreamScheduler(dependencies.assets, { maxConcurrent: Math.max(1, Math.floor(config.streamConcurrency)), maxBytesPerFrame: Math.max(0, config.streamBytesPerFrame), maxRetriesPerFrame: 4 });
    this.#cache = new BudgetedResourceCache<unknown>({ maxBytes: Math.max(1, config.cacheBytes), maxEntries: Math.max(1, config.cacheEntries) });
    this.#state = new TransactionalStateStore<State>({ initial: initialState, freeze: true, historyLimit: 64 });
    this.#features = deriveRenderFeatures(config.backend, config.quality);
    for (const probe of [
      ...[] as const,
    ]) this.#integrity.register(probe);
  }

  on<K extends 'runtime' | 'frame' | 'health' | 'recovery' | 'input'>(event: K, listener: (payload: { runtime: RuntimeState; frame: FramePlan; health: RuntimeHealth; recovery: { action: string; reason: string }; input: InputSnapshot }[K]) => void): () => void {
    return this.#bus.on(event, listener);
  }

  beginFrame(nowMs: number): void {
    this.#frameId += 1;
    this.#streams.beginFrame();
    this.#input.beginFrame();
    this.#clock.advance(nowMs, (_delta, tick) => { this.#runtime = Object.freeze({ ...this.#runtime, tick }); });
  }

  updateSpatial(items: readonly SpatialItem[]): void { this.#spatial.rebuild(items); }

  nearby(position: SpatialItem['position'], radius: number, tag?: string): readonly SpatialItem[] {
    return this.#spatial.query({ center: position, radius, ...(tag ? { tag } : {}) });
  }

  prepareFrame(input: Omit<FrameInput, 'frameId'>): FramePlan {
    const resolution = { ...input.resolution, scale: this.#scale.scale };
    const plan = buildFramePlan({ ...input, frameId: this.#frameId, resolution }, this.#features);
    this.#telemetry.frame(plan.estimatedGpuMs, plan.estimatedGpuMs, plan.visibleObjectIds.length, plan.animatedObjectIds.length);
    this.#bus.emit('frame', plan);
    return plan;
  }

  updateFrameScale(frameMs: number): number { return this.#scale.update(frameMs, this.#budgets.frameMs); }

  input(): InputNormalizer { return this.#input; }
  assets(): AssetStreamScheduler { return this.#streams; }
  cache(): BudgetedResourceCache<unknown> { return this.#cache; }
  state(): TransactionalStateStore<State> { return this.#state; }
  rng(): DeterministicRng { return this.#rng; }
  telemetry(): RuntimeTelemetry { return this.#telemetry; }
  integrity(): RuntimeIntegrityMonitor { return this.#integrity; }
  recovery(): RecoverySupervisor { return this.#recovery; }

  async health(): Promise<RuntimeHealth> {
    const report = await this.#integrity.run();
    const metrics = this.#telemetry.snapshot();
    const health: RuntimeHealth = {
      ...this.#lastHealth,
      assetQueueDepth: this.#streams.metrics().queued,
      frameTimeMs: metrics.histograms['frame.duration_ms']?.p50 ?? 0,
      memoryBytes: this.#cache.bytes(),
      gpuMemoryBytes: this.#cache.bytes(),
      lastErrorCode: report.level === 'healthy' ? undefined : `INTEGRITY_${report.level.toUpperCase()}`,
    };
    this.#lastHealth = health;
    this.#bus.emit('health', health);
    return health;
  }

  async recover(): Promise<boolean> {
    const report = await this.#integrity.run();
    const decision = this.#recovery.decide(report);
    this.#bus.emit('recovery', { action: decision.action, reason: decision.reason });
    if (decision.action === 'continue') return true;
    if (decision.action === 'shed-quality') return true;
    if (decision.action === 'reload-assets') { this.#cache.clear(); return true; }
    if (decision.action === 'rebuild-renderer') return true;
    if (decision.action === 'restore-checkpoint') { this.#state.replaceSilently(this.#state.snapshot()); return true; }
    this.#streams.dispose();
    return decision.action === 'restart-runtime';
  }

  snapshot(): RuntimeFacadeSnapshot {
    return { runtime: this.#runtime, input: this.#input.snapshot(), health: this.#lastHealth, frameScale: this.#scale.scale, backend: this.#backend, quality: this.#quality };
  }

  dispose(): void {
    this.#streams.dispose();
    this.#cache.clear();
    this.#spatial.clear();
    this.#bus.clear();
  }

  get frameId(): number { return this.#frameId; }
  get tick(): Tick { return this.#runtime.tick; }
  get worldId(): WorldId { return this.#worldId; }
  get assetCount(): number { return this.#streams.list().length; }
  get assetIds(): readonly AssetId[] { return this.#streams.list().map((record) => record.request.asset.id); }
  get capabilities(): DeviceCapabilities { return this.#capabilities; }
  get backend(): Backend { return this.#backend; }
  get quality(): QualityTier { return this.#quality; }
}

export function createRuntimeFacade<State extends object>(config: RuntimeFacadeConfig, dependencies: RuntimeFacadeDependencies, initialState: State): TypedRuntimeFacade<State> {
  return new TypedRuntimeFacade(config, dependencies, initialState);
}

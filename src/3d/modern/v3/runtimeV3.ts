import {
  asAssetKey,
  asEntityId,
  asSequence,
  asTick,
  type AssetManifestEntry,
  type AssetRecord,
  type AssetState,
  type EntityId,
  type InputFrame,
  type NetworkEntityState,
  type RenderView,
  type RenderableState,
  type RuntimeConfig,
  type RuntimeDiagnosticReport,
  type RuntimeEventMap,
  type RuntimeHealth,
  type RuntimePhase,
  type RuntimeTask,
  type Tick,
  type Transform,
} from './coreContracts';
import { EntityRegistryV3, V3_HEALTH, V3_POSITION, V3_VELOCITY } from './ecsV3';
import { InputRingBuffer, CheckpointRing, DeterministicRng, SequenceSource } from './deterministicKernel';
import { SimulationPipeline, createHealthSystem } from './simulationPipeline';
import { RenderPlannerV3, enforceRenderBudget, chooseAdaptiveQuality, type QualityProfile } from './renderPipelineV3';
import {
  InputCommandHistory,
  SnapshotBuffer,
  createSnapshot,
  decideReconciliation,
  type NetcodeConfig,
} from './netcodeV3';
import { MemorySaveAdapter, SaveManager, createJsonCodec, type SaveRecord } from './persistenceV3';
import { BudgetControllerV3, FrameProfilerV3, HealthEvaluatorV3, MetricRegistryV3, TraceRecorderV3, buildDiagnosticReport } from './observabilityV3';

export interface RuntimeEventBus {
  on<K extends keyof RuntimeEventMap>(event: K, listener: (payload: RuntimeEventMap[K]) => void): () => void;
  emit<K extends keyof RuntimeEventMap>(event: K, payload: RuntimeEventMap[K]): void;
}

export class TypedEventBus implements RuntimeEventBus {
  #listeners = new Map<keyof RuntimeEventMap, Set<(payload: unknown) => void>>();

  on<K extends keyof RuntimeEventMap>(event: K, listener: (payload: RuntimeEventMap[K]) => void): () => void {
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    const safe = listener as (payload: unknown) => void;
    listeners.add(safe);
    return () => listeners?.delete(safe);
  }

  emit<K extends keyof RuntimeEventMap>(event: K, payload: RuntimeEventMap[K]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload);
  }

  clear(): void {
    this.#listeners.clear();
  }
}

interface AssetCacheEntry {
  manifest: AssetManifestEntry;
  state: AssetState;
  value?: unknown;
  error?: string;
  refCount: number;
  lastUsedTick: Tick;
  residentBytes: number;
}

export class AssetCacheV3 {
  #entries = new Map<string, AssetCacheEntry>();
  #budgetBytes: number;
  #loader: (manifest: AssetManifestEntry, signal: AbortSignal) => Promise<{ value: unknown; bytes: number }>;

  constructor(options: {
    readonly budgetBytes: number;
    readonly loader?: (manifest: AssetManifestEntry, signal: AbortSignal) => Promise<{ value: unknown; bytes: number }>;
  }) {
    if (options.budgetBytes < 1) throw new Error('asset cache budget must be positive');
    this.#budgetBytes = options.budgetBytes;
    this.#loader = options.loader ?? (async () => ({ value: null, bytes: 0 }));
  }

  register(manifest: AssetManifestEntry): void {
    const key = String(manifest.key);
    const existing = this.#entries.get(key);
    if (existing) {
      if (existing.manifest.url !== manifest.url) throw new Error(`asset manifest conflict: ${key}`);
      return;
    }
    this.#entries.set(key, {
      manifest: structuredClone(manifest),
      state: 'unknown',
      refCount: 0,
      lastUsedTick: asTick(0),
      residentBytes: 0,
    });
  }

  get<T>(key: string, tick: Tick): AssetRecord<T> | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    entry.lastUsedTick = tick;
    return {
      descriptor: entry.manifest,
      state: entry.state,
      ...(entry.value !== undefined ? { value: entry.value as T } : {}),
      ...(entry.error ? { error: { code: 'ASSET', message: entry.error, retryable: true } } : {}),
      lastUsedAt: tick as any,
      residentBytes: entry.residentBytes,
      refCount: entry.refCount,
    } as AssetRecord<T>;
  }

  async acquire<T>(key: string, tick: Tick, signal?: AbortSignal): Promise<T> {
    const entry = this.#entries.get(key);
    if (!entry) throw new Error(`unknown asset: ${key}`);
    entry.refCount += 1;
    entry.lastUsedTick = tick;
    if (entry.state === 'ready') return entry.value as T;
    if (entry.state === 'loading') throw new Error(`concurrent asset load is not supported by this cache: ${key}`);
    entry.state = 'loading';
    try {
      const controller = signal ? undefined : new AbortController();
      const result = await this.#loader(entry.manifest, signal ?? controller!.signal);
      entry.value = result.value;
      entry.residentBytes = Math.max(0, result.bytes);
      entry.state = 'ready';
      this.#evictToBudget();
      return result.value as T;
    } catch (error) {
      entry.state = 'failed';
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  release(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
  }

  evict(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry || entry.refCount > 0 || entry.state !== 'ready') return false;
    entry.value = undefined;
    entry.residentBytes = 0;
    entry.state = 'evicted';
    return true;
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      if (entry.refCount === 0) {
        entry.value = undefined;
        entry.residentBytes = 0;
        if (entry.state === 'ready') entry.state = 'evicted';
      }
    }
  }

  residentBytes(): number {
    return [...this.#entries.values()].reduce((sum, entry) => sum + entry.residentBytes, 0);
  }

  summary(): { residentBytes: number; ready: number; failed: number; evicted: number } {
    const states = [...this.#entries.values()];
    return {
      residentBytes: this.residentBytes(),
      ready: states.filter((entry) => entry.state === 'ready').length,
      failed: states.filter((entry) => entry.state === 'failed').length,
      evicted: states.filter((entry) => entry.state === 'evicted').length,
    };
  }

  #evictToBudget(): void {
    while (this.residentBytes() > this.#budgetBytes) {
      const candidate = [...this.#entries.values()]
        .filter((entry) => entry.refCount === 0 && entry.state === 'ready')
        .sort((a, b) => Number(a.lastUsedTick) - Number(b.lastUsedTick) || String(a.manifest.key).localeCompare(String(b.manifest.key)))[0];
      if (!candidate) break;
      this.evict(String(candidate.manifest.key));
    }
  }
}

export interface RuntimeTaskRunner {
  run<T>(task: RuntimeTask<T>, signal?: AbortSignal): Promise<T>;
}

export class BoundedTaskRunner implements RuntimeTaskRunner {
  #running = 0;
  #maxConcurrent: number;

  constructor(maxConcurrent = 4) {
    this.#maxConcurrent = Math.max(1, maxConcurrent);
  }

  async run<T>(task: RuntimeTask<T>, signal = new AbortController().signal): Promise<T> {
    if (signal.aborted) throw new DOMException('Task aborted', 'AbortError');
    while (this.#running >= this.#maxConcurrent) await Promise.resolve();
    this.#running += 1;
    try {
      return await task.run({
        now: 0 as any,
        frame: 0 as any,
        signal,
        budget: { cpuMs: task.estimatedMs, gpuMs: 0, maxTasks: 1 },
      });
    } finally {
      this.#running -= 1;
    }
  }
}

export interface RuntimeSnapshotState {
  readonly tick: Tick;
  readonly digest: number;
  readonly entities: readonly NetworkEntityState[];
}

export class RuntimeV3<TSave extends Record<string, unknown> = Record<string, unknown>> {
  readonly config: RuntimeConfig;
  readonly world: EntityRegistryV3;
  readonly simulation: SimulationPipeline;
  readonly renderer: RenderPlannerV3;
  readonly events: TypedEventBus;
  readonly assets: AssetCacheV3;
  readonly metrics: MetricRegistryV3;
  readonly profiler = new FrameProfilerV3();
  readonly traces = new TraceRecorderV3();
  readonly budget: BudgetControllerV3;
  readonly healthEvaluator = new HealthEvaluatorV3();
  readonly inputHistory: InputCommandHistory;
  readonly snapshotBuffer: SnapshotBuffer;
  readonly checkpoints: CheckpointRing<RuntimeSnapshotState>;
  readonly sequences = new SequenceSource();
  readonly rng: DeterministicRng;
  readonly saves: SaveManager<TSave>;
  #quality: RuntimeConfig['quality'];
  #lastHealth: RuntimeHealth = {
    score: 100,
    grade: 'A',
    frameTimeP95Ms: 0,
    memoryPressure: 0,
    networkPressure: 0,
    streamingPressure: 0,
    recommendations: [],
  };
  #networkRttMs = 0;
  #networkLossRatio = 0;
  #rollbacks = 0;
  #lastBudget = {
    tick: asTick(0),
    frameMs: 0,
    simulationMs: 0,
    renderMs: 0,
    streamingMs: 0,
    networkMs: 0,
    persistenceMs: 0,
    budgetMisses: 0,
  };

  constructor(config: RuntimeConfig) {
    this.config = structuredClone(config);
    this.#quality = config.quality;
    this.world = new EntityRegistryV3();
    this.simulation = new SimulationPipeline({
      world: this.world,
      fixedDeltaSeconds: config.fixedDeltaSeconds,
      maxCatchUpSteps: config.maxCatchUpSteps,
      budget: config.budget,
      mode: config.mode,
    });
    this.simulation.addSystem(createHealthSystem());
    this.renderer = new RenderPlannerV3({ backend: config.backend, quality: config.quality });
    this.events = new TypedEventBus();
    this.assets = new AssetCacheV3({ budgetBytes: 512 * 1024 * 1024 });
    this.metrics = new MetricRegistryV3(() => ({ tick: this.simulation.clock.state().tick, timestampMs: Date.now() }));
    this.budget = new BudgetControllerV3({
      targetFrameMs: 1000 / 60,
      simulationBudgetMs: config.budget.simulationMs,
      renderBudgetMs: config.budget.renderMs,
      streamingBudgetMs: config.budget.streamingMs,
      networkBudgetMs: config.budget.networkMs,
      persistenceBudgetMs: config.budget.persistenceMs,
    });
    this.inputHistory = new InputCommandHistory(config.inputHistory);
    this.snapshotBuffer = new SnapshotBuffer(config.snapshotHistory);
    this.checkpoints = new CheckpointRing(config.rollbackWindowTicks + 2);
    this.rng = new DeterministicRng(0x5a17f00d);
    this.saves = this.#createSaveManager();
  }

  registerAsset(manifest: AssetManifestEntry): void {
    this.assets.register(manifest);
    this.events.emit('asset:state', { key: asAssetKey(String(manifest.key)), state: 'unknown' });
  }

  createPlayer(): EntityId {
    const player = this.world.create(asEntityId('player'));
    this.world.add(player, V3_POSITION.type, V3_POSITION.defaultValue());
    this.world.add(player, V3_VELOCITY.type, V3_VELOCITY.defaultValue());
    this.world.add(player, V3_HEALTH.type, V3_HEALTH.defaultValue());
    return player;
  }

  queueInput(input: InputFrame): void {
    this.inputHistory.push({
      sequence: input.sequence,
      tick: input.tick,
      clientTimeMs: Date.now(),
      payload: input,
    });
  }

  frame(realDeltaSeconds: number, view: RenderView, renderables: readonly RenderableState[]): RuntimeDiagnosticReport {
    this.profiler.beginFrame();
    const frameStart = performance.now();
    this.events.emit('runtime:phase', { phase: 'input' });
    const latestInputs = this.inputHistory.after(asSequence(0)).map((command) => command.payload);
    this.simulation.setInputs(latestInputs);

    this.events.emit('runtime:phase', { phase: 'simulation' });
    const simulationStart = performance.now();
    const simulationResult = this.simulation.step(realDeltaSeconds);
    const simulationMs = performance.now() - simulationStart;
    this.profiler.simulation.push(simulationMs);
    this.metrics.observe('runtime.simulation.ms', simulationMs, 'ms');
    this.metrics.observe('runtime.entities', this.world.entityCount(), 'count');

    this.events.emit('runtime:phase', { phase: 'network' });
    const networkStart = performance.now();
    this.captureSnapshot();
    const networkMs = performance.now() - networkStart;
    this.profiler.network.push(networkMs);
    this.metrics.observe('runtime.network.ms', networkMs, 'ms');

    this.events.emit('runtime:phase', { phase: 'render' });
    const renderStart = performance.now();
    const plan = this.renderer.plan({ view, renderables, quality: this.#quality, backend: this.config.backend });
    const renderDecision = enforceRenderBudget(plan, this.config.budget.renderMs);
    const renderMs = performance.now() - renderStart;
    this.profiler.render.push(renderMs);
    this.metrics.observe('runtime.render.ms', renderMs, 'ms');
    this.metrics.set('runtime.visible', plan.visibleCount, 'count');
    this.metrics.set('runtime.draws', plan.drawCount, 'count');

    if (!renderDecision.allowed) this.metrics.observe('runtime.render.budget_miss', 1, 'count');
    this.#lastBudget = this.budget.record({
      tick: this.simulation.clock.state().tick,
      frameMs: performance.now() - frameStart,
      simulationMs,
      renderMs,
      streamingMs: 0,
      networkMs,
      persistenceMs: 0,
    });

    const health = this.healthEvaluator.evaluate({
      frame: this.profiler.frame.snapshot(),
      memoryPressure: Math.min(1, this.assets.residentBytes() / (512 * 1024 * 1024)),
      networkLoss: this.#networkLossRatio,
      streamingPressure: 0,
    });
    this.#lastHealth = health;
    const adaptive = chooseAdaptiveQuality(this.#quality, {
      frameTimeP95Ms: health.frameTimeP95Ms,
      targetFrameMs: 1000 / 60,
      gpuPressure: 0,
      memoryPressure: health.memoryPressure,
    });
    if (adaptive.tier !== this.#quality) {
      const previous = this.#quality;
      this.#quality = adaptive.tier;
      this.renderer.setQuality(adaptive.tier);
      this.events.emit('render:quality', { from: previous, to: adaptive.tier, reason: adaptive.reason });
    }

    this.events.emit('runtime:tick', this.simulation.clock.state());
    this.events.emit('runtime:phase', { phase: 'streaming' });
    this.profiler.endFrame();
    return this.diagnosticReport();
  }

  captureSnapshot(): void {
    const tick = this.simulation.clock.state().tick;
    const entities: NetworkEntityState[] = [];
    for (const entity of this.world.query({ all: [V3_POSITION.type, V3_VELOCITY.type] }).entities) {
      const position = this.world.unsafeGet<{ x: number; y: number; z: number }>(entity, V3_POSITION.type)!;
      const velocity = this.world.unsafeGet<{ x: number; y: number; z: number }>(entity, V3_VELOCITY.type)!;
      entities.push({
        entity,
        position,
        velocity,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        flags: this.world.isEnabled(entity) ? 1 : 0,
      });
    }
    const acknowledged = this.inputHistory.latest()?.sequence ?? asSequence(0);
    const snapshot = createSnapshot(this.sequences.allocate(), tick, Date.now(), acknowledged, entities);
    this.snapshotBuffer.push(snapshot);
    this.checkpoints.push({
      tick,
      digest: this.simulation.digest(),
      state: { tick, digest: this.simulation.digest(), entities },
    });
    this.events.emit('network:snapshot', { tick, sequence: snapshot.sequence });
  }

  reconcile(authoritative: NetworkEntityState, predicted: NetworkEntityState | undefined, netcode?: NetcodeConfig): boolean {
    const decision = decideReconciliation(predicted, authoritative, netcode);
    if (!decision.rollback) return false;
    const checkpoint = this.checkpoints.latest();
    if (!checkpoint) return false;
    this.#rollbacks += 1;
    this.events.emit('network:rollback', { from: checkpoint.tick, to: this.simulation.clock.state().tick });
    return true;
  }

  async save(slot: number, payload: TSave, playtimeMs: number): Promise<SaveRecord<TSave>> {
    const start = performance.now();
    this.events.emit('runtime:phase', { phase: 'persistence' });
    const record = await this.saves.save(slot, payload, playtimeMs);
    this.metrics.observe('runtime.persistence.ms', performance.now() - start, 'ms');
    this.events.emit('save:committed', { slot, revision: record.revision });
    return record;
  }

  async load(slot: number): Promise<SaveRecord<TSave> | null> {
    const start = performance.now();
    const record = await this.saves.load(slot);
    this.metrics.observe('runtime.persistence.load.ms', performance.now() - start, 'ms');
    return record;
  }

  diagnosticReport(): RuntimeDiagnosticReport {
    return buildDiagnosticReport({
      clock: this.simulation.clock.state(),
      health: this.#lastHealth,
      budgets: this.#lastBudget,
      systems: this.simulation.systemMetrics(),
      assets: this.assets.summary(),
      network: {
        rttMs: this.#networkRttMs,
        lossRatio: this.#networkLossRatio,
        snapshots: this.snapshotBuffer.size(),
        rollbacks: this.#rollbacks,
      },
    });
  }

  shutdown(): void {
    this.assets.clear();
    this.snapshotBuffer.clear();
    this.checkpoints.clear();
    this.inputHistory.through(asSequence(Number.MAX_SAFE_INTEGER));
    this.events.emit('runtime:phase', { phase: 'teardown' });
    this.events.clear();
  }

  #createSaveManager(): SaveManager<TSave> {
    const codec = createJsonCodec<TSave>({
      schema: 1,
      validate: (value): value is TSave => typeof value === 'object' && value !== null && !Array.isArray(value),
    });
    return new SaveManager({ codec, adapter: new MemorySaveAdapter() });
  }
}

export function createDefaultRuntimeConfig(): RuntimeConfig {
  return {
    mode: 'local',
    lane: 'main',
    fixedDeltaSeconds: 1 / 60,
    maxCatchUpSteps: 5,
    rollbackWindowTicks: 120,
    snapshotHistory: 64,
    inputHistory: 256,
    quality: 'high',
    backend: 'webgpu',
    budget: {
      simulationMs: 6,
      renderMs: 8,
      streamingMs: 3,
      networkMs: 2,
      persistenceMs: 1,
      maxTasks: 64,
      maxEntityUpdates: 25000,
    },
  };
}

export function runtimeTransform(position: { x: number; y: number; z: number }): Transform {
  return {
    position,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

import type { EntityId } from './simulationKernel.ts';
import { DeterministicTimeline, SimulationKernel } from './simulationKernel.ts';
import { EcsScheduler, EcsWorld, TransformSchema, VelocitySchema, type EcsSystem } from './ecsRuntime.ts';
import { ObservabilityHub, BudgetMonitor, TraceRecorder } from './observabilityHub.ts';
import { ReplicationHistory, SnapshotBuilder, type ReplicatedEntity, type ReplicationSnapshot } from './networkReplicationV3.ts';
import { MemorySaveStore, PersistentSaveManager, type SaveEnvelope } from './saveMigrationEngine.ts';
import { AssetCache, StreamingOrchestrator, type AssetRequest } from './streamingOrchestrator.ts';

export interface RuntimeApplicationConfig {
  readonly worldSeed: number;
  readonly tickRateHz?: number;
  readonly cacheBytes?: number;
  readonly streamConcurrency?: number;
  readonly profileId?: string;
}

export interface RuntimeFrameResult {
  readonly tick: number;
  readonly simulatedTicks: number;
  readonly interpolationAlpha: number;
  readonly replicationDigest: string;
  readonly worldDigest: string;
  readonly runtimeDigest: string;
}

export interface RuntimeEntityView {
  readonly id: EntityId;
  readonly transform?: ReturnType<EcsWorld['get']>;
}

export class RuntimeApplication {
  readonly #config: Required<RuntimeApplicationConfig>;
  readonly #kernel: SimulationKernel;
  readonly #world = new EcsWorld();
  readonly #scheduler = new EcsScheduler();
  readonly #observability = new ObservabilityHub();
  readonly #budgets = new BudgetMonitor(this.#observability);
  readonly #traces = new TraceRecorder();
  readonly #timeline = new DeterministicTimeline<{ readonly type: string; readonly payload: unknown }>();
  readonly #replication = new ReplicationHistory(32);
  readonly #snapshotBuilder = new SnapshotBuilder();
  readonly #saveStore = new MemorySaveStore();
  readonly #saveManager: PersistentSaveManager<RuntimeSavePayload>;
  readonly #assetCache: AssetCache<unknown>;
  readonly #streams: StreamingOrchestrator<unknown>;
  #started = false;
  #lastSnapshot: ReplicationSnapshot | null = null;

  public constructor(config: RuntimeApplicationConfig, assetLoader: (request: AssetRequest, signal: AbortSignal) => Promise<unknown> = async (request) => request.key) {
    this.#config = {
      worldSeed: config.worldSeed,
      tickRateHz: config.tickRateHz ?? 60,
      cacheBytes: config.cacheBytes ?? 64_000_000,
      streamConcurrency: config.streamConcurrency ?? 4,
      profileId: config.profileId ?? 'default',
    };
    this.#kernel = new SimulationKernel(this.#config.worldSeed, { tickRateHz: this.#config.tickRateHz });
    this.#assetCache = new AssetCache(this.#config.cacheBytes);
    this.#streams = new StreamingOrchestrator(assetLoader, this.#config.cacheBytes, { maxConcurrent: this.#config.streamConcurrency });
    this.#saveManager = new PersistentSaveManager(this.#saveStore, 2);
    this.#saveManager.migrationGraph.register({
      fromVersion: 1,
      toVersion: 2,
      id: 'runtime-v1-to-v2',
      migrate: (value: unknown) => ({ ...(value as Record<string, unknown>), migrated: true }),
    });
    this.#registerCoreSystems();
    this.#registerBudgets();
  }

  public get kernel(): SimulationKernel { return this.#kernel; }
  public get world(): EcsWorld { return this.#world; }
  public get scheduler(): EcsScheduler { return this.#scheduler; }
  public get observability(): ObservabilityHub { return this.#observability; }
  public get streams(): StreamingOrchestrator<unknown> { return this.#streams; }
  public get saves(): PersistentSaveManager<RuntimeSavePayload> { return this.#saveManager; }
  public get timeline(): DeterministicTimeline<{ readonly type: string; readonly payload: unknown }> { return this.#timeline; }

  public start(): void {
    if (this.#started) return;
    this.#kernel.start();
    this.#started = true;
    this.#observability.event('runtime.started');
  }

  public stop(): void {
    if (!this.#started) return;
    this.#kernel.stop();
    this.#started = false;
    this.#observability.event('runtime.stopped');
  }

  public spawnActor(input: SpawnActorInput = {}): EntityId {
    const entity = this.#world.createEntity();
    this.#world.add(entity, TransformSchema, {
      x: input.x ?? 0,
      y: input.y ?? 0,
      z: input.z ?? 0,
      yaw: input.yaw ?? 0,
    });
    this.#world.add(entity, VelocitySchema, {
      x: input.vx ?? 0,
      y: input.vy ?? 0,
      z: input.vz ?? 0,
    });
    this.#observability.increment('entity.spawned');
    return entity;
  }

  public despawnActor(entity: EntityId): void {
    if (!this.#world.isAlive(entity)) return;
    this.#world.destroyEntity(entity);
    this.#observability.increment('entity.despawned');
  }

  public scheduleEvent(tick: number, type: string, payload: unknown): void {
    this.#timeline.schedule(tick, type, { type, payload: structuredClone(payload) });
  }

  public async frame(frameDeltaSeconds: number): Promise<RuntimeFrameResult> {
    if (!this.#started) this.start();
    const traceStart = performance.now();
    const frame = this.#kernel.advance(frameDeltaSeconds);
    this.#observability.setTick(frame.tick);
    this.#scheduler.run(this.#world, this.#kernel.fixedDeltaSeconds, frame.tick);
    const timelineEvents = this.#timeline.drainThrough(frame.tick);
    for (const event of timelineEvents) this.#observability.event(`timeline.${event.type}`);
    const snapshot = this.#buildSnapshot();
    this.#replication.push(snapshot);
    this.#lastSnapshot = snapshot;
    this.#observability.gauge('world.entities', this.#world.count());
    this.#observability.gauge('stream.queue', this.#streams.queueCount);
    this.#observability.observe('frame.runtime.ms', performance.now() - traceStart);
    this.#budgets.checkFrame(frameDeltaSeconds * 1000);
    this.#traces.record('runtime.frame', frame.tick, frame.tick, performance.now() - traceStart);
    return {
      tick: frame.tick,
      simulatedTicks: frame.simulatedTicks,
      interpolationAlpha: frame.alpha,
      replicationDigest: snapshot.digest,
      worldDigest: this.#world.digest(),
      runtimeDigest: this.digest(),
    };
  }

  public async flushStreams(): Promise<void> {
    await this.#streams.pump(this.#kernel.tick);
  }

  public queueAsset(request: AssetRequest): void {
    this.#streams.enqueue(request, this.#kernel.tick);
  }

  public async save(payload: RuntimeSavePayload): Promise<void> {
    await this.#saveManager.save(this.#config.profileId, this.#config.worldSeed, this.#kernel.tick, payload);
    this.#observability.event('save.written');
  }

  public async load(): Promise<SaveEnvelope<RuntimeSavePayload> | null> {
    const result = await this.#saveManager.load(this.#config.profileId);
    this.#observability.event(result ? 'save.loaded' : 'save.missing');
    return result;
  }

  public snapshot(): RuntimeSnapshot {
    return Object.freeze({
      kernel: this.#kernel.snapshot(),
      world: this.#world.snapshot(),
      replication: this.#lastSnapshot,
    });
  }

  public digest(): string {
    return [
      this.#kernel.digest(),
      this.#world.digest(),
      this.#lastSnapshot?.digest ?? 'none',
      this.#streams.stats().cachedBytes,
      this.#observability.snapshot().tick,
    ].join(':');
  }

  public diagnostics(): RuntimeDiagnostics {
    const observation = this.#observability.snapshot();
    const streaming = this.#streams.stats();
    return {
      tick: this.#kernel.tick,
      entities: this.#world.count(),
      systems: this.#scheduler.list(),
      streams: streaming,
      alerts: observation.alerts,
      metrics: observation,
      traces: this.#traces.list(),
      digest: this.digest(),
    };
  }

  public dispose(): void {
    this.stop();
    this.#streams.dispose();
    this.#assetCache.clear();
    this.#timeline.clear();
    this.#observability.event('runtime.disposed');
  }

  #registerCoreSystems(): void {
    const system: EcsSystem = {
      id: 'core.transform-integration',
      phase: 'simulate',
      order: 100,
      query: { all: [TransformSchema.type, VelocitySchema.type] },
      update: (world, entities, deltaSeconds) => {
        for (const entity of entities) {
          const transform = world.require(entity, TransformSchema.type);
          const velocity = world.require(entity, VelocitySchema.type);
          transform.x += velocity.x * deltaSeconds;
          transform.y += velocity.y * deltaSeconds;
          transform.z += velocity.z * deltaSeconds;
        }
      },
    };
    this.#scheduler.add(system);
  }

  #registerBudgets(): void {
    this.#budgets.register({ metric: 'frame.ms', warning: 16.7, error: 33.4, unit: 'ms' });
    this.#budgets.register({ metric: 'network.rtt.ms', warning: 100, error: 250, unit: 'ms' });
    this.#budgets.register({ metric: 'heap.bytes', warning: 512_000_000, error: 900_000_000, unit: 'bytes' });
  }

  #buildSnapshot(): ReplicationSnapshot {
    const entities: ReplicatedEntity[] = [];
    const ids = this.#world.query({ all: [TransformSchema.type, VelocitySchema.type] });
    for (const entity of ids) {
      const transform = this.#world.require(entity, TransformSchema.type);
      entities.push({
        id: entity,
        generation: this.#world.generation(entity),
        transform: { x: transform.x, y: transform.y, z: transform.z, yaw: transform.yaw },
        components: [],
      });
    }
    return this.#snapshotBuilder.build(this.#kernel.tick, this.#kernel.tick, entities, [], this.#lastSnapshot?.tick ?? null);
  }
}

export interface SpawnActorInput {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly yaw?: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly vz?: number;
}

export interface RuntimeSavePayload {
  readonly schema: 'runtime-r2';
  readonly digest: string;
  readonly entityCount: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly migrated?: boolean;
}

export interface RuntimeSnapshot {
  readonly kernel: ReturnType<SimulationKernel['snapshot']>;
  readonly world: ReturnType<EcsWorld['snapshot']>;
  readonly replication: ReplicationSnapshot | null;
}

export interface RuntimeDiagnostics {
  readonly tick: number;
  readonly entities: number;
  readonly systems: readonly string[];
  readonly streams: ReturnType<StreamingOrchestrator<unknown>['stats']>;
  readonly alerts: ReturnType<ObservabilityHub['snapshot']>['alerts'];
  readonly metrics: ReturnType<ObservabilityHub['snapshot']>;
  readonly traces: ReturnType<TraceRecorder['list']>;
  readonly digest: string;
}

export function createRuntimeApplication(config: RuntimeApplicationConfig): RuntimeApplication {
  return new RuntimeApplication(config);
}

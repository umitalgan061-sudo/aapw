import {R32_DEFAULT_CONFIG} from './contracts.ts';
import {R32Application} from './application.ts';
import {RenderPipelineR32} from './renderPipeline.ts';
import {PerformanceGovernor} from './performanceGovernor.ts';
import {RuntimeRecoveryController} from './recoveryController.ts';
import {DeterministicRateLimiter,SecurityAuditLog} from './securityBoundary.ts';
import {InputIntentPipeline} from './inputPipeline.ts';
import {JsonPersistenceCoordinator,MemoryStorage} from './persistenceCoordinator.ts';
import {JsonSnapshotCodec,SnapshotHistory} from './snapshotCodec.ts';
import {WorldRuntime} from './worldRuntime.ts';
import {EntityRegistry} from './entityRegistry.ts';
import type {R32ApplicationOptions,R32ApplicationState} from './application.ts';
import type {RuntimeConfigR32,RuntimeDiagnostics,RuntimeEvent,RuntimeEventMap} from './contracts.ts';
import type {GovernorSnapshot} from './performanceGovernor.ts';
import type {EntityRegistryOptions} from './entityRegistry.ts';
import type {WorldChunkSource,WorldRuntimeOptions} from './worldRuntime.ts';

  R32_DEFAULT_CONFIG,
  RuntimeConfigR32,
  RuntimeDiagnostics,
  RuntimeEvent,
  RuntimeEventMap,
} from './contracts.ts';
import { R32Application, R32ApplicationOptions } from './application.ts';
import { RenderPipelineR32 } from './renderPipeline.ts';
import { PerformanceGovernor, GovernorSnapshot } from './performanceGovernor.ts';
import { RuntimeRecoveryController } from './recoveryController.ts';
import { DeterministicRateLimiter, SecurityAuditLog } from './securityBoundary.ts';
import { InputIntentPipeline } from './inputPipeline.ts';
import { JsonPersistenceCoordinator, MemoryStorage } from './persistenceCoordinator.ts';
import { JsonSnapshotCodec, SnapshotHistory } from './snapshotCodec.ts';
import { WorldRuntime, WorldRuntimeOptions, WorldChunkSource } from './worldRuntime.ts';
import { EntityRegistry, EntityRegistryOptions } from './entityRegistry.ts';

export interface R32PlatformOptions extends R32ApplicationOptions {
  readonly config?: RuntimeConfigR32;
  readonly worldSource?: WorldChunkSource;
  readonly worldOptions?: WorldRuntimeOptions;
  readonly entityOptions?: EntityRegistryOptions;
  readonly persistenceNamespace?: string;
  readonly persistenceSchema?: string;
}

export interface R32PlatformSnapshot {
  readonly diagnostics: RuntimeDiagnostics;
  readonly performance: GovernorSnapshot;
  readonly recovery: ReturnType<RuntimeRecoveryController['snapshot']>;
  readonly entities: ReturnType<EntityRegistry['stats']>;
  readonly world: ReturnType<WorldRuntime['stats']> | null;
}

export class R32Platform {
  readonly application: R32Application;
  readonly render: RenderPipelineR32;
  readonly performance: PerformanceGovernor;
  readonly recovery: RuntimeRecoveryController;
  readonly rateLimiter: DeterministicRateLimiter;
  readonly audit: SecurityAuditLog;
  readonly input: InputIntentPipeline;
  readonly persistence: JsonPersistenceCoordinator<unknown>;
  readonly snapshots: SnapshotHistory<unknown>;
  readonly entities: EntityRegistry;
  readonly world: WorldRuntime | null;

  constructor(options: R32PlatformOptions = {}) {
    this.application = new R32Application({
      ...options,
      config: options.config ?? R32_DEFAULT_CONFIG,
    });

    this.render = new RenderPipelineR32({
      softMilliseconds: this.application.config.budgets.render.softMilliseconds,
      hardMilliseconds: this.application.config.budgets.render.hardMilliseconds,
    });

    this.performance = new PerformanceGovernor();

    this.recovery = new RuntimeRecoveryController();

    this.rateLimiter = new DeterministicRateLimiter({
      capacity: this.application.config.network.commandRatePerTick * 4,
      refillPerTick: this.application.config.network.commandRatePerTick,
    });

    this.audit = new SecurityAuditLog();

    this.input = new InputIntentPipeline();

    this.persistence = new JsonPersistenceCoordinator(
      new MemoryStorage(),
      {
        namespace: options.persistenceNamespace ?? 'aapw',
        schema: options.persistenceSchema ?? 'runtime-state',
        version: 1,
        maxBytes: 2 * 1024 * 1024,
        backupCount: 3,
      },
    );

    this.snapshots = new SnapshotHistory(
      new JsonSnapshotCodec(),
      this.application.config.stateHistoryLimit,
    );

    this.entities = new EntityRegistry(
      options.entityOptions ?? {
        maxEntities: 10000,
        maxTagsPerEntity: 16,
      },
    );

    this.world =
      options.worldSource === undefined
        ? null
        : new WorldRuntime(
          options.worldSource,
          options.worldOptions ?? {
            chunkSizeMeters: 256,
            viewDistance: 2,
            maxResidentChunks: 64,
          },
        );
  }

  start():void {
    this.application.start();
  }

  pause():void {
    this.application.pause();
  }

  resume():void {
    this.application.resume();
  }

  tick(deltaSeconds:number):R32PlatformSnapshot {
    const diagnostics=this.application.tick(deltaSeconds);

    const performance=this.performance.observe({
      frameMilliseconds:diagnostics.health.frameMilliseconds.max,
      memoryBytes:diagnostics.health.memoryBytes,
      droppedTasks:diagnostics.health.droppedTasks,
      networkRttMilliseconds:undefined,
      gpuMilliseconds:undefined,
      visibleEntities:this.entities.stats().active,
    });

    return {
      diagnostics,
      performance,
      recovery:this.recovery.snapshot(diagnostics.clock.tick),
      entities:this.entities.stats(),
      world:this.world?.stats()??null,
    };
  }

  async saveState(tick:number):Promise<void> {
    await this.persistence.save(
      this.application.state.snapshot().state,
      tick,
      {
        runtimeMajor:this.application.version.major,
      },
    );
  }

  async loadState():Promise<unknown|null> {
    const record=await this.persistence.load();

    if(!record){
      return null;
    }

    return record.envelope.payload;
  }

  captureSnapshot(tick:number):void {
    this.snapshots.push(
      tick,
      {
        application:this.application.state.snapshot(),
        entities:this.entities.snapshot(),
      },
    );
  }

  on<K extends keyof RuntimeEventMap>(
    type:K,
    listener:(event:RuntimeEvent<K>)=>void,
  ):()=>void {
    return this.application.on(type,listener);
  }

  diagnostics():RuntimeDiagnostics {
    return this.application.diagnostics();
  }

  shutdown():void {
    this.world
      ? void this.world.clear()
      : undefined;

    this.render.dispose();
    this.application.shutdown();
  }

  dispose():void {
    this.shutdown();
    this.recovery.clearFaults();
    this.audit.clear();
    this.input.reset();
    this.snapshots.clear();
  }
}

export function createR32Platform(
  options:R32PlatformOptions = {},
):R32Platform {
  return new R32Platform(options);
}

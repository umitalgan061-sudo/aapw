/**
 * Unified AAPW v3 runtime facade.
 *
 * Consumers use this facade instead of reaching into individual authorities. It composes ECS,
 * deterministic simulation, secure commands, world queries, asset loading, performance governance,
 * workers and versioned saves while retaining an explicit legacy-bridge surface for gradual migration.
 */

import { EngineKernelV3, installCoreGameplaySystemsV3, type EnginePresentationPortV3, type EngineInputPortV3 } from './engineKernelV3.ts';
import { createDefaultEcsWorldV3, Transform, Velocity, Health, Stamina, Identity, Network, Lifetime, type EntityId } from './ecsRuntimeV3.ts';
import { AssetPipelineV3, type AssetBudgetV3, type AssetDecoderV3, type AssetDescriptor, type AssetId, type AssetTransportV3 } from './assetPipelineV3.ts';
import { WorldQueryV3, type ObstacleV3, type Vec3V3, type WorldEntityV3 } from './worldQueryV3.ts';
import { SaveRuntimeV3, type SavePayloadV3, type SaveStorageV3, createEmptySaveV3 } from './saveRuntimeV3.ts';
import { CommandRegistryV3, createDefaultCommandRegistryV3, type CommandRequestV3, type CommandDecisionV3 } from './securityRuntimeV3.ts';
import { PerformanceGovernorV3, createPerformanceGovernorV3, type PerformanceSampleV3, type QualityDecisionV3, type PerformanceTier } from './performanceRuntimeV3.ts';
import { WorkerRouterV3, type WorkerPortV3 } from './workerRuntimeV3.ts';

export interface RuntimeFacadeOptionsV3 {
  readonly input?: EngineInputPortV3;
  readonly presentation?: EnginePresentationPortV3;
  readonly transport: AssetTransportV3;
  readonly storage: SaveStorageV3;
  readonly assetBudget?: Partial<AssetBudgetV3>;
  readonly initialPerformanceTier?: PerformanceTier;
  readonly workerPort?: WorkerPortV3;
}

export interface RuntimeFacadeSnapshotV3 {
  readonly phase: string;
  readonly tick: number;
  readonly checksum: string;
  readonly entityCount: number;
  readonly loadedAssets: number;
  readonly cacheBytes: number;
  readonly performanceTier: PerformanceTier;
}

export class AapwRuntimeFacadeV3 {
  readonly world = createDefaultEcsWorldV3();
  readonly engine: EngineKernelV3;
  readonly assets: AssetPipelineV3;
  readonly queries: WorldQueryV3;
  readonly saves: SaveRuntimeV3;
  readonly commands: CommandRegistryV3;
  readonly performance: PerformanceGovernorV3;
  readonly workers: WorkerRouterV3 | null;

  #started = false;
  #nextCommandSequence = 0;

  constructor(options: RuntimeFacadeOptionsV3) {
    this.engine = new EngineKernelV3({
      world: this.world,
      input: options.input,
      presentation: options.presentation,
      listener: {
        onError: (error, stage) => console.error(`[aapw:v3] ${stage}`, error),
      },
    });
    installCoreGameplaySystemsV3(this.engine);
    this.assets = new AssetPipelineV3(options.transport, options.assetBudget);
    this.queries = new WorldQueryV3({ heightSampler: () => 0, waterDepthSampler: () => 0 });
    this.saves = new SaveRuntimeV3(options.storage);
    this.commands = createDefaultCommandRegistryV3();
    this.performance = createPerformanceGovernorV3(options.initialPerformanceTier ?? 'balanced');
    this.workers = options.workerPort ? new WorkerRouterV3(options.workerPort) : null;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.workers?.start();
    this.engine.start();
  }

  stop(): void {
    if (!this.#started) return;
    this.engine.stop();
    this.workers?.stop();
    this.#started = false;
  }

  frame(realDeltaSeconds: number): ReturnType<EngineKernelV3['frame']> {
    if (!this.#started) this.start();
    return this.engine.frame({ realDeltaSeconds });
  }

  spawnPlayer(name: string, position: Vec3V3 = { x: 0, y: 0, z: 0 }): EntityId {
    const id = this.world.spawn();
    this.world.createAndAttach(id, Identity, { archetype: 'player', displayName: name, tags: ['player'] });
    this.world.createAndAttach(id, Transform, { x: position.x, y: position.y, z: position.z });
    this.world.createAndAttach(id, Velocity, {});
    this.world.createAndAttach(id, Health, {});
    this.world.createAndAttach(id, Stamina, {});
    this.world.createAndAttach(id, Network, { authority: 'local', replicationPriority: 4 });
    this.world.createAndAttach(id, Lifetime, { spawnTick: this.engine.clock.tick });
    this.queries.registerEntity({ id, position: { ...position }, radius: 0.45, tags: ['player'], active: true });
    return id;
  }

  registerEntity(entity: WorldEntityV3): void { this.queries.registerEntity(entity); }
  unregisterEntity(id: number): void { this.queries.removeEntity(id); }
  registerObstacle(obstacle: ObstacleV3): void { this.queries.registerObstacle(obstacle); }
  registerAsset(descriptor: AssetDescriptor): AssetDescriptor { return this.assets.declare(descriptor); }
  registerDecoder<T>(decoder: AssetDecoderV3<T>): void { this.assets.registerDecoder(decoder); }

  authorizeCommand(name: string, args: readonly unknown[], origin: CommandRequestV3['origin'], timeSeconds: number): CommandDecisionV3 {
    const request: CommandRequestV3 = { origin, name, args, sequence: this.#nextCommandSequence++ };
    return this.commands.inspect(request, timeSeconds);
  }

  recordPerformance(sample: PerformanceSampleV3): QualityDecisionV3 {
    return this.performance.sample(sample);
  }

  async save(slot: string, worldSeed: number, questState: SavePayloadV3['questState'] = {}, playerState: SavePayloadV3['playerState'] = {}): Promise<void> {
    const payload: SavePayloadV3 = {
      ...createEmptySaveV3(worldSeed),
      tick: this.engine.clock.tick,
      entities: this.world.snapshot().map((entry) => ({
        id: entry.id,
        archetype: String(this.world.get(entry.id, Identity)?.archetype ?? 'generic'),
        transform: this.world.get(entry.id, Transform),
        values: {
          health: this.world.get(entry.id, Health)?.current ?? null,
          stamina: this.world.get(entry.id, Stamina)?.current ?? null,
        },
      })),
      questState,
      playerState,
    };
    await this.saves.write(slot, payload);
  }

  async load(slot: string): Promise<SavePayloadV3 | null> {
    return this.saves.read(slot);
  }

  snapshot(): RuntimeFacadeSnapshotV3 {
    return Object.freeze({
      phase: this.engine.phase,
      tick: this.engine.clock.tick,
      checksum: this.engine.checksum(),
      entityCount: this.world.size(),
      loadedAssets: this.assets.metrics().readyCount,
      cacheBytes: this.assets.metrics().cachedBytes,
      performanceTier: this.performance.tier,
    });
  }
}

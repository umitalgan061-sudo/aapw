import { EntityId, EntityRecord, InputIntent, RuntimeSnapshot, Tick, Vec3, asEntityId, asTick, checksumObject } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';
import { ModernRuntimeV5 } from './runtime.ts';
import { DeterministicSimulationV5, MovementIntent } from './simulation.ts';
import { LegacyWorldAdapterV5, LegacyEntityLike } from './compatibility.ts';
import { AnimationGraphV5, AnimationGraphDefinition } from './animationGraph.ts';
import { SaveRuntimeV5, snapshotFromWorld, restoreWorld } from './persistence.ts';
import { SpatialIndexV5, WorldQueryV5 } from './worldQuery.ts';

export interface ServiceOptions {
  readonly save?: SaveRuntimeV5;
  readonly animationGraph?: AnimationGraphDefinition;
  readonly terrain?: Parameters<WorldQueryV5['terrainAt']>[0] extends never ? never : (x: number, z: number) => ReturnType<WorldQueryV5['terrainAt']>;
}

export interface ServiceStatus {
  readonly ready: boolean;
  readonly tick: Tick;
  readonly entities: number;
  readonly digest: string;
}

const defaultTerrain = (x: number, z: number) => ({ height: 0, normal: { x: 0, y: 1, z: 0 }, material: `${Math.trunc(x)}:${Math.trunc(z)}` });

export class GameServiceV5 {
  readonly runtime: ModernRuntimeV5;
  readonly simulation: DeterministicSimulationV5;
  readonly legacy: LegacyWorldAdapterV5;
  readonly animation: AnimationGraphV5 | null;
  readonly #save: SaveRuntimeV5;

  constructor(runtime: ModernRuntimeV5 = new ModernRuntimeV5(), options: ServiceOptions = {}) {
    const spatial = new SpatialIndexV5();
    const query = new WorldQueryV5(runtime.world, spatial, options.terrain ?? defaultTerrain);
    this.runtime = runtime;
    this.simulation = new DeterministicSimulationV5(runtime.world, query);
    this.legacy = new LegacyWorldAdapterV5(runtime.world);
    this.animation = options.animationGraph ? new AnimationGraphV5(options.animationGraph) : null;
    this.#save = options.save ?? new SaveRuntimeV5();
  }

  start(): void { this.runtime.start(); }
  stop(): void { this.runtime.stop(); }

  async frame(deltaSeconds: number, intents: readonly MovementIntent[] = []): Promise<void> {
    if (!this.runtime.running) this.start();
    this.simulation.step(intents);
    await this.runtime.step(deltaSeconds);
    this.animation?.update(deltaSeconds, { moving: intents.some((intent) => Math.hypot(intent.desiredDirection.x, intent.desiredDirection.z) > 0.01) });
  }

  async submitIntent(intent: InputIntent): Promise<boolean> { return this.runtime.submitIntent(intent); }

  spawnPlayer(position: Vec3 = { x: 0, y: 0, z: 0 }): EntityId {
    const id = this.runtime.world.spawnWithDefaults(['transform', 'velocity', 'health', 'stamina', 'animation', 'combat', 'network', 'render', 'metadata']);
    const transform = this.runtime.world.requireComponent(id, 'transform');
    this.runtime.world.setComponent(id, { ...transform, position: { ...position } });
    return id;
  }

  importLegacy(entity: LegacyEntityLike): EntityId | null { return this.legacy.import(entity).entity?.id ?? null; }
  exportLegacy(id: EntityId): LegacyEntityLike | null { return this.legacy.export(id); }
  snapshot(): RuntimeSnapshot { return snapshotFromWorld(this.runtime.world, { service: 'game-service-v5' }); }
  async save(): Promise<void> { await this.#save.save(this.snapshot()); }

  async load(): Promise<boolean> {
    const result = await this.#save.load();
    if (!result.ok || !result.snapshot) return false;
    restoreWorld(this.runtime.world, result.snapshot);
    return true;
  }

  entities(): readonly EntityRecord[] { return this.runtime.world.snapshot(); }
  status(): ServiceStatus { const entities = this.runtime.world.snapshot(); return { ready: this.runtime.running, tick: asTick(Number(this.runtime.tick)), entities: entities.length, digest: checksumObject(entities) }; }
}

export const createGameService = (options: ServiceOptions = {}): GameServiceV5 => new GameServiceV5(new ModernRuntimeV5(), options);
export const normalizeEntityId = (value: number): EntityId => asEntityId(value);

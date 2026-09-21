import { EntityId, Revision, Tick, WorldSnapshot, revisionValue, stableChecksum, tickValue } from './types.ts';
import { ActorSimulationV2, ActorState, ActorTarget } from './actorSimulationV2.ts';
import { RandomRegistry } from './deterministicRngV2.ts';
import { DialogueGraphV2, DialogueRuntimeV2 } from './dialogueRuntimeV2.ts';
import { InteractionRuntimeV2, InteractionTarget, TriggerRuntimeV2 } from './interactionRuntimeV2.ts';
import { InventoryRuntimeV2, ItemRegistryV2, InventorySnapshot } from './inventoryRuntimeV2.ts';
import { NetworkTransportV2, TransportConfig } from './networkTransportV2.ts';
import { RuntimePolicyV2 } from './runtimePolicyV2.ts';
import { AdaptiveRenderPipelineV2, RenderFrameInput } from './renderFramePipelineV2.ts';
import { AssetLifecycleManagerV2 } from './assetLifecycleV2.ts';
import { WorldStreamingOrchestratorV2 } from './streamingOrchestratorV2.ts';
import { WorkerSchedulerV2 } from './workerSchedulerV2.ts';
import { WorldEventJournalV2 } from './worldEventJournalV2.ts';
import { WorldStateCodecV2 } from './worldStateCodecV2.ts';
import { NextGenSimulationCoordinatorV2 } from './simulationCoordinatorV2.ts';

export interface NextGenFacadeOptions { seed: number; transport?: Partial<TransportConfig>; }
export interface RuntimeFrameSummary { tick: Tick; actorCount: number; streamResident: number; assetBytes: number; workerQueued: number; networkState: string; renderQuality: string; policyMode: string; digest: number; }

export class NextGenRuntimeFacadeV2 {
  readonly random: RandomRegistry;
  readonly actors: ActorSimulationV2;
  readonly interactions: InteractionRuntimeV2;
  readonly triggers: TriggerRuntimeV2;
  readonly items: ItemRegistryV2;
  readonly inventory: InventoryRuntimeV2;
  readonly dialogues: DialogueGraphV2;
  readonly dialogueRuntime: DialogueRuntimeV2;
  readonly network: NetworkTransportV2<unknown>;
  readonly policy: RuntimePolicyV2;
  readonly render: AdaptiveRenderPipelineV2;
  readonly assets: AssetLifecycleManagerV2;
  readonly streaming: WorldStreamingOrchestratorV2;
  readonly workers: WorkerSchedulerV2;
  readonly journal: WorldEventJournalV2<unknown>;
  readonly codec: WorldStateCodecV2;
  readonly coordinator: NextGenSimulationCoordinatorV2;
  #tick: Tick = tickValue(0);
  #revision: Revision = revisionValue(0);

  constructor(options: NextGenFacadeOptions) {
    this.random = new RandomRegistry(options.seed);
    this.actors = new ActorSimulationV2(options.seed);
    this.interactions = new InteractionRuntimeV2();
    this.triggers = new TriggerRuntimeV2();
    this.items = new ItemRegistryV2();
    this.inventory = new InventoryRuntimeV2(this.items);
    this.dialogues = new DialogueGraphV2();
    this.dialogueRuntime = new DialogueRuntimeV2(this.dialogues);
    this.network = new NetworkTransportV2(options.transport);
    this.network.registerDefaults();
    this.policy = new RuntimePolicyV2();
    this.render = new AdaptiveRenderPipelineV2();
    this.render.registerStandardPasses();
    this.assets = new AssetLifecycleManagerV2();
    this.streaming = new WorldStreamingOrchestratorV2();
    this.workers = new WorkerSchedulerV2();
    this.journal = new WorldEventJournalV2();
    this.codec = new WorldStateCodecV2();
    this.coordinator = new NextGenSimulationCoordinatorV2({ seed: options.seed, actors: this.actors, interactions: this.interactions, triggers: this.triggers, streaming: this.streaming, journal: this.journal, policy: this.policy });
  }

  get tick(): Tick { return this.#tick; }
  get revision(): Revision { return this.#revision; }

  boot(): void { this.network.connect(this.#tick); }

  spawnActor(actor: ActorState): void {
    this.actors.spawn(actor);
    this.#revision = revisionValue(Number(this.#revision) + 1);
    this.journal.append({ tick: this.#tick, kind: 'spawn', source: 'facade', entity: Number(actor.id), payload: { kind: actor.kind } });
  }

  despawnActor(id: EntityId): boolean {
    const result = this.actors.despawn(id);
    if (result) {
      this.#revision = revisionValue(Number(this.#revision) + 1);
      this.journal.append({ tick: this.#tick, kind: 'despawn', source: 'facade', entity: Number(id), payload: null });
    }
    return result;
  }

  registerInteractionTarget(target: InteractionTarget): void { this.interactions.registerMany(target.definitions); }

  step(deltaSeconds: number, targets: readonly ActorTarget[] = [], interests: Parameters<NextGenSimulationCoordinatorV2['step']>[0]['interests'] = []): RuntimeFrameSummary {
    const report = this.coordinator.step({ deltaSeconds, targets, interests });
    this.#tick = report.tick;
    this.#revision = revisionValue(Number(this.#revision) + 1);
    this.assets.update(this.#tick);
    this.network.update(this.#tick);
    return this.summary();
  }

  adaptRender(input: RenderFrameInput): ReturnType<AdaptiveRenderPipelineV2['decide']> { return this.render.decide(input); }

  snapshot(): WorldSnapshot {
    const entities = this.actors.list().map((actor) => ({
      id: actor.id,
      mask: 1,
      components: { kind: actor.kind, position: actor.position, velocity: actor.velocity, health: actor.stats.health, stamina: actor.stats.stamina, mode: actor.mode },
    }));
    return { tick: this.#tick, revision: this.#revision, entities, checksum: stableChecksum(entities) };
  }

  restore(snapshot: WorldSnapshot): void {
    if (stableChecksum(snapshot.entities) !== snapshot.checksum) throw new Error('Refusing invalid world snapshot');
    const actors: ActorState[] = [];
    for (const entity of snapshot.entities) {
      const c = entity.components;
      if (typeof c.kind !== 'string' || !c.position || typeof c.position !== 'object') continue;
      const current = this.actors.get(entity.id);
      if (!current) continue;
      const position = c.position as { x: number; y: number; z: number };
      const velocity = c.velocity as { x: number; y: number; z: number } | undefined;
      actors.push({
        ...current,
        position: { ...position },
        velocity: velocity ? { ...velocity } : current.velocity,
        stats: { ...current.stats, health: Number(c.health ?? current.stats.health), stamina: Number(c.stamina ?? current.stats.stamina) },
        mode: (c.mode as ActorState['mode']) ?? current.mode,
      });
    }
    this.actors.restore(actors);
    this.#tick = tickValue(Number(snapshot.tick));
    this.#revision = revisionValue(Number(snapshot.revision));
  }

  saveInventory(owner: EntityId): InventorySnapshot { return this.inventory.snapshot(owner); }

  summary(): RuntimeFrameSummary {
    const assetStats = this.assets.stats();
    const streamStats = this.streaming.stats();
    const workerStats = this.workers.stats();
    return { tick: this.#tick, actorCount: this.actors.actorCount, streamResident: streamStats.resident, assetBytes: assetStats.bytes, workerQueued: workerStats.queued, networkState: this.network.state, renderQuality: this.render.quality, policyMode: this.policy.policy.mode, digest: this.digest() };
  }

  digest(): number {
    let digest = this.random.digest() ^ this.actors.digest() ^ this.streaming.digest() ^ this.assets.digest() ^ this.workers.digest() ^ this.network.digest() ^ this.journal.hash() ^ this.policy.snapshot().checksum;
    digest ^= stableChecksum({ ownerCount: this.inventoryOwners(), revision: this.#revision, tick: this.#tick });
    return digest >>> 0;
  }

  private inventoryOwners(): number { return this.inventoryOwnerDigestHint(); }
  private inventoryOwnerDigestHint(): number { return this.items.digest(); }
}

export function createNextGenRuntime(seed = 0x51f15e): NextGenRuntimeFacadeV2 { return new NextGenRuntimeFacadeV2({ seed }); }

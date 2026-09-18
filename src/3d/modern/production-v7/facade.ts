import {
  ActorComponentSetV7, CommandEnvelopeV7, ContentHashV7, EntityIdV7, EntityRecordV7, InputCommandV7,
  RuntimeCommandV7, RuntimeConfigV7, RuntimeHealthV7, RuntimeModeV7, RuntimePhaseV7, RuntimeBudgetsV7,
  SequenceV7, TickV7, WorldSnapshotV7, entityIdV7, revisionV7, tickV7, vec3V7, DEFAULT_RUNTIME_CONFIG_V7,
} from './types.ts';
import { BudgetSchedulerV7 } from './scheduler.ts';
import { EntityStoreV7 } from './entityStore.ts';
import { SpatialIndexV7 } from './spatialIndex.ts';
import { DeterministicWorldSimulationV7 } from './worldSimulation.ts';
import { NetworkRuntimeV7 } from './network.ts';
import type { NetworkConfigV7 } from './network.ts';
import { AssetCacheV7 } from './assets.ts';
import { RuntimeCodecV7 } from './codec.ts';
import { MemorySaveStorageV7, SaveManagerV7 } from './persistence.ts';
import { RuntimeTelemetryV7 } from './observability.ts';
import { RuntimeSecurityV7 } from './security.ts';
import { AdaptiveRenderPolicyV7, budgetDefaultsV7, resolveRenderProfileV7 } from './renderPolicy.ts';
import { RuntimeRecoveryV7 } from './recovery.ts';
import { RuntimeDiagnosticsV7 } from './diagnostics.ts';
import { detectPlatformProfileV7 } from './platform.ts';
import { checksumV7, FixedClockV7, hashNumbersV7 } from './deterministic.ts';

export interface ProductionRuntimeOptionsV7 {
  readonly seed?: number;
  readonly config?: Partial<RuntimeConfigV7>;
  readonly network?: Partial<NetworkConfigV7>;
  readonly profile?: ReturnType<typeof detectPlatformProfileV7>;
}

export interface ProductionFrameReportV7 {
  readonly tick: TickV7;
  readonly phase: RuntimePhaseV7;
  readonly mode: RuntimeModeV7;
  readonly steps: number;
  readonly droppedSeconds: number;
  readonly commandsApplied: number;
  readonly commandsRejected: number;
  readonly schedulerSpentMs: number;
  readonly entities: number;
  readonly network: ReturnType<NetworkRuntimeV7<unknown>['stats']>;
  readonly assets: ReturnType<AssetCacheV7['stats']>;
  readonly health: RuntimeHealthV7;
  readonly renderPressure: number;
  readonly recoverySuggested: boolean;
  readonly checksum: ContentHashV7;
}

const emptyComponents = (): ActorComponentSetV7 => Object.freeze({
  transform: Object.freeze({ position: vec3V7(), yaw: 0, pitch: 0, scale: vec3V7(1, 1, 1) }),
  kinematics: Object.freeze({ velocity: vec3V7(), acceleration: vec3V7(), grounded: true, maxSpeed: 5 }),
  vital: Object.freeze({ health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, poise: 100, maxPoise: 100, invulnerableUntilTick: tickV7(0) }),
  interest: Object.freeze({ priority: 0, simulationLod: 1, renderLod: 1, alwaysRelevant: false }),
  network: Object.freeze({ owner: 'server', dirtyRevision: revisionV7(0), lastAckedSequence: 0 as SequenceV7, replicated: true }),
  tags: Object.freeze([]),
});

export class ProductionRuntimeV7 {
  readonly config: RuntimeConfigV7;
  readonly entities: EntityStoreV7;
  readonly spatial: SpatialIndexV7;
  readonly simulation: DeterministicWorldSimulationV7;
  readonly scheduler: BudgetSchedulerV7;
  readonly network: NetworkRuntimeV7<unknown>;
  readonly assets: AssetCacheV7;
  readonly codec: RuntimeCodecV7;
  readonly telemetry: RuntimeTelemetryV7;
  readonly security: RuntimeSecurityV7;
  readonly render: AdaptiveRenderPolicyV7;
  readonly recovery: RuntimeRecoveryV7;
  readonly diagnostics: RuntimeDiagnosticsV7;
  readonly saves: SaveManagerV7<ProductionRuntimeSaveStateV7>;
  readonly #clock: FixedClockV7;
  #phase: RuntimePhaseV7 = 'booting';
  #mode: RuntimeModeV7 = 'full';
  #revision = 0;

  constructor(options: ProductionRuntimeOptionsV7 = {}) {
    this.config = Object.freeze({ ...DEFAULT_RUNTIME_CONFIG_V7, ...options.config });
    const profile = options.profile ?? detectPlatformProfileV7({ webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator, offscreenCanvas: typeof OffscreenCanvas !== 'undefined' });
    this.#mode = profile.mode;
    this.entities = new EntityStoreV7();
    this.spatial = new SpatialIndexV7(this.config.worldCellMeters);
    this.simulation = new DeterministicWorldSimulationV7(this.entities, this.spatial, {
      fixedHz: this.config.fixedHz, maxCatchUpSteps: this.config.maxCatchUpSteps,
    });
    this.scheduler = new BudgetSchedulerV7(options.seed ?? 0x2f7a11);
    this.network = new NetworkRuntimeV7(options.network);
    this.assets = new AssetCacheV7(this.config.asset);
    this.codec = new RuntimeCodecV7();
    this.telemetry = new RuntimeTelemetryV7();
    this.security = new RuntimeSecurityV7();
    this.render = new AdaptiveRenderPolicyV7(resolveRenderProfileV7(profile));
    this.recovery = new RuntimeRecoveryV7();
    this.diagnostics = new RuntimeDiagnosticsV7();
    this.saves = new SaveManagerV7(new MemorySaveStorageV7());
    this.#clock = new FixedClockV7(this.config.fixedHz);
  }

  get phase(): RuntimePhaseV7 { return this.#phase; }
  get mode(): RuntimeModeV7 { return this.#mode; }
  get tick(): TickV7 { return this.#clock.tick; }
  get revision(): number { return this.#revision; }

  boot(): void {
    if (this.#phase === 'running') return;
    this.#phase = 'running';
    this.recovery.start();
    this.network.connect();
    this.network.markConnected();
  }

  stop(): void {
    this.#phase = 'stopped';
    this.network.disconnect();
  }

  spawn(id: EntityIdV7, archetype = 'actor', components: ActorComponentSetV7 = emptyComponents()): boolean {
    if (!this.security.validateCommand({ type: 'spawn', id, archetype, components }, this.tick)) return false;
    this.entities.upsert(Object.freeze({ id, archetype, components, createdTick: this.tick }));
    this.#revision += 1;
    return true;
  }

  despawn(id: EntityIdV7): boolean {
    if (!this.security.validateCommand({ type: 'despawn', id }, this.tick)) return false;
    const removed = this.entities.remove(id);
    if (removed) this.#revision += 1;
    return removed;
  }

  enqueue(command: RuntimeCommandV7, tick: TickV7 = this.tick): boolean {
    if (!this.security.validateCommand(command, tick)) return false;
    const envelope: CommandEnvelopeV7 = Object.freeze({
      sequence: (this.#revision + 1) as SequenceV7, tick, revision: revisionV7(this.#revision), command,
    });
    return this.#applyEnvelope(envelope);
  }

  pushInput(input: InputCommandV7): boolean {
    if (!this.security.validateInput(input)) return false;
    return this.network.pushInput(input);
  }

  step(deltaSeconds: number, renderBudget?: Parameters<AdaptiveRenderPolicyV7['decide']>[0]): ProductionFrameReportV7 {
    if (this.#phase !== 'running') this.boot();
    const simulation = this.simulation.advance(deltaSeconds);
    const tick = simulation.tick;
    const commandBudget = Math.max(1, this.config.network.maxCommandsPerSecond);
    let commandsApplied = 0; let commandsRejected = 0;
    const inputs = this.network.consumeInputs(tick);
    for (const input of inputs) {
      for (const action of input.actions) {
        const command = this.#actionToCommand(input, action);
        if (command && this.enqueue(command, input.tick)) commandsApplied += 1;
        else commandsRejected += 1;
      }
      if (commandsApplied >= commandBudget) break;
    }

    const schedulerReport = this.scheduler.runTick(tick, this.config.schedulerMs);
    this.network.tick(tick);
    const health = this.telemetryHealth(tick);
    const budget = renderBudget ?? budgetDefaultsV7(this.render.profile).render;
    const renderDecision = this.render.decide(budget, health);
    const recovery = this.recovery.plan(health, {
      ...budgetDefaultsV7(this.render.profile),
      render: budget,
      schedulerMs: this.config.schedulerMs,
    });
    const suggested = health.degraded && recovery.steps.length > 0;
    if (suggested && this.recovery.mode !== health.mode) this.recovery.setMode(health.mode);
    this.telemetry.sample(tick, 'frame.ms', budget.frameMs, 'ms');
    this.telemetry.sample(tick, 'simulation.ms', simulation.steps * 0.5, 'ms');
    this.telemetry.sample(tick, 'network.rtt.ms', this.network.stats().estimatedRttMs, 'ms');
    this.telemetry.sample(tick, 'memory.heap.ratio', Math.min(1, this.assets.stats().bytes / Math.max(1, this.config.asset.maxBytes)), 'ratio');
    const snapshot = this.diagnostics.publish({
      tick, mode: this.#mode, phase: this.#phase, health,
      entityCount: this.entities.stats().count, spatialCells: this.spatial.stats().cells,
      queuedTasks: this.scheduler.queuedCount(), assetBytes: this.assets.stats().bytes,
      networkState: this.network.state,
    });
    const checksum = checksumV7({ tick, revision: this.#revision, commandsApplied, simulation, schedulerReport, renderPressure: renderDecision.pressure, diagnostics: snapshot.checksum });
    return Object.freeze({
      tick, phase: this.#phase, mode: this.#mode, steps: simulation.steps, droppedSeconds: simulation.droppedSeconds,
      commandsApplied, commandsRejected, schedulerSpentMs: schedulerReport.spentMs, entities: this.entities.size,
      network: this.network.stats(), assets: this.assets.stats(), health, renderPressure: renderDecision.pressure,
      recoverySuggested: suggested, checksum,
    });
  }

  snapshot(): WorldSnapshotV7 {
    const entities = this.entities.snapshot();
    const base = {
      tick: this.tick, revision: revisionV7(this.#revision), baseline: null,
      entities, deltas: [],
    };
    return Object.freeze({ ...base, checksum: checksumV7(base) });
  }

  restore(snapshot: WorldSnapshotV7): void {
    if (checksumV7({ tick: snapshot.tick, revision: snapshot.revision, baseline: snapshot.baseline, entities: snapshot.entities, deltas: snapshot.deltas }) !== snapshot.checksum) throw new Error('Snapshot checksum mismatch');
    this.entities.restore(snapshot.entities);
    this.#revision = Number(snapshot.revision);
    this.spatialRestore();
  }

  save(slot = 0): void {
    const state: ProductionRuntimeSaveStateV7 = {
      snapshot: this.snapshot(),
      mode: this.#mode,
      phase: this.#phase,
    };
    this.saves.save(slot, this.tick, revisionV7(this.#revision), state);
  }

  load(slot = 0): boolean {
    const envelope = this.saves.load(slot);
    if (!envelope) return false;
    this.restore(envelope.payload.snapshot);
    this.#mode = envelope.payload.mode;
    this.#phase = envelope.payload.phase;
    return true;
  }

  diagnose(): RuntimeDiagnosticSnapshotV7 {
    const latest = this.diagnostics.latest();
    if (!latest) {
      const health = this.telemetryHealth(this.tick);
      return this.diagnostics.publish({
        tick: this.tick, mode: this.#mode, phase: this.#phase, health,
        entityCount: this.entities.size, spatialCells: this.spatial.stats().cells,
        queuedTasks: this.scheduler.queuedCount(), assetBytes: this.assets.stats().bytes,
        networkState: this.network.state,
      });
    }
    return latest;
  }

  renderDecision(budget: Parameters<AdaptiveRenderPolicyV7['decide']>[0]): ReturnType<AdaptiveRenderPolicyV7['decide']> {
    return this.render.decide(budget, this.telemetryHealth(this.tick));
  }

  recoveryPlan(): ReturnType<RuntimeRecoveryV7['plan']> {
    const health = this.telemetryHealth(this.tick);
    return this.recovery.plan(health, {
      ...budgetDefaultsV7(this.render.profile),
      render: budgetDefaultsV7(this.render.profile).render,
      schedulerMs: this.config.schedulerMs,
    });
  }

  digest(): number {
    return hashNumbersV7(this.#revision, Number(this.tick), this.entities.size, this.spatial.stats().cells, this.scheduler.queuedCount(), this.assets.stats().bytes, this.telemetry.digest(), this.diagnostics.digest());
  }

  #applyEnvelope(envelope: CommandEnvelopeV7): boolean {
    const c = envelope.command;
    switch (c.type) {
      case 'spawn': this.entities.upsert(Object.freeze({ id: c.id, archetype: c.archetype, components: c.components, createdTick: envelope.tick })); break;
      case 'despawn': if (!this.entities.remove(c.id)) return false; break;
      case 'move': if (!this.entities.setTransform(c.id, { ...this.entities.get(c.id)?.components.transform ?? emptyComponents().transform, position: c.position }) || !this.entities.setKinematics(c.id, { ...this.entities.get(c.id)?.components.kinematics ?? emptyComponents().kinematics, velocity: c.velocity })) return false; break;
      case 'damage': if (this.entities.applyDamage(c.id, c.amount, envelope.tick) <= 0) return false; break;
      case 'heal': if (this.entities.heal(c.id, c.amount) <= 0) return false; break;
      case 'interest': if (!this.entities.setInterest(c.id, { priority: c.priority, simulationLod: c.simulationLod, renderLod: c.renderLod, alwaysRelevant: this.entities.get(c.id)?.components.interest.alwaysRelevant ?? false })) return false; break;
      case 'tag': if (c.enabled ? !this.entities.addTag(c.id, c.tag) : !this.entities.removeTag(c.id, c.tag)) return false; break;
      case 'mode': this.#mode = c.mode; this.recovery.setMode(c.mode); break;
    }
    this.#revision += 1;
    return true;
  }

  #actionToCommand(input: InputCommandV7, action: string): RuntimeCommandV7 | null {
    const id = entityIdV7(1);
    if (action === 'damage-self') return { type: 'damage', id, amount: 5, source: id };
    if (action === 'heal-self') return { type: 'heal', id, amount: 5 };
    if (action === 'move') return { type: 'move', id, position: input.move, velocity: input.move };
    if (action === 'tag-player') return { type: 'tag', id, tag: 'player', enabled: true };
    return null;
  }

  #telemetryHealth(tick: TickV7): RuntimeHealthV7 {
    return this.telemetry.summarize(tick);
  }

  spatialRestore(): void {
    for (const entity of this.entities.list()) {
      const p = entity.components.transform.position;
      this.spatial.upsert({
        id: entity.id, layer: 0, active: entity.components.vital.health > 0,
        bounds: { min: { x: p.x - 1, y: p.y, z: p.z - 1 }, max: { x: p.x + 1, y: p.y + 2, z: p.z + 1 } },
      });
    }
  }
}

export interface ProductionRuntimeSaveStateV7 {
  readonly snapshot: WorldSnapshotV7;
  readonly mode: RuntimeModeV7;
  readonly phase: RuntimePhaseV7;
}

export interface RuntimeDiagnosticSnapshotV7 {
  readonly tick: TickV7;
  readonly mode: RuntimeModeV7;
  readonly phase: RuntimePhaseV7;
  readonly health: RuntimeHealthV7;
  readonly entityCount: number;
  readonly spatialCells: number;
  readonly queuedTasks: number;
  readonly assetBytes: number;
  readonly networkState: string;
  readonly checksum: ContentHashV7;
}

export const createProductionRuntimeV7 = (options: ProductionRuntimeOptionsV7 = {}): ProductionRuntimeV7 => new ProductionRuntimeV7(options);

import type {
  BudgetPolicy,
  CameraState,
  CharacterState,
  EntityRecord,
  InputIntent,
  RenderCandidate,
  RenderBackend,
  RuntimeBudget,
  RuntimeMode,
  RuntimeSnapshot,
  QualityTier,
  Vec3,
} from './kernelTypes.ts';
import {
  asEntityId,
  clamp,
  fault,
  stableHash,
  vec3,
} from './kernelTypes.ts';
import {
  CharacterController,
  DEFAULT_MOVEMENT_POLICY,
  type GroundQuery,
} from './characterController.ts';
import { CameraRig, DEFAULT_CAMERA_POLICY, type CameraCollision, type CameraTarget } from './cameraRig.ts';
import { DeterministicClock, DEFAULT_CLOCK_POLICY, type ClockPolicy } from './deterministicClock.ts';
import { InputHub, DEFAULT_INPUT_POLICY, type RawSample } from './inputHub.ts';
import { AssetScheduler, DEFAULT_ASSET_SCHEDULER_POLICY, type AssetRequest } from './assetScheduler.ts';
import { WorldStreamDirector, DEFAULT_STREAM_POLICY } from './worldStreamDirector.ts';
import { EntityRegistry, DEFAULT_ENTITY_BUDGET_POLICY, type EntitySpec } from './entityRegistry.ts';
import { CombatDirector, DEFAULT_COMBAT_POLICY, type AttackRequest, type CombatantSpec } from './combatDirector.ts';
import { NPCBrain, DEFAULT_NPC_POLICY, type NPCSpec, type PerceivedTarget } from './npcBrain.ts';
import { QuestDirector, type QuestDefinition, type QuestProgressEvent } from './questDirector.ts';
import { SaveRuntime, DEFAULT_SAVE_POLICY, type StorageAdapter } from './persistence.ts';
import { RenderDirector, chooseRenderPolicy, type RenderCapabilities } from './renderDirector.ts';
import { TelemetryRuntime, DEFAULT_TELEMETRY_POLICY } from './telemetry.ts';
import { RecoverySupervisor, DEFAULT_RECOVERY_POLICY, type RecoveryRequest } from './recoverySupervisor.ts';

export interface ProductionRuntimeOptions {
  readonly ground?: GroundQuery;
  readonly cameraSweep?: (from: Vec3, to: Vec3, radius: number) => CameraCollision | null;
  readonly renderCapabilities?: RenderCapabilities;
  readonly rendererBackend?: 'auto' | RenderBackend;
  readonly quality?: 'auto' | QualityTier;
  readonly storage?: StorageAdapter;
  readonly clock?: ClockPolicy;
  readonly budgets?: Partial<BudgetPolicy>;
}

export interface ProductionFrameInput {
  readonly deltaSeconds: number;
  readonly timestampSeconds?: number;
  readonly inputSamples?: readonly RawSample[];
  readonly cameraYawDelta?: number;
  readonly cameraPitchDelta?: number;
  readonly cameraDistanceDelta?: number;
  readonly renderCandidates?: readonly RenderCandidate[];
  readonly entitySpecs?: readonly EntitySpec[];
  readonly streamVelocity?: Vec3;
  readonly perceivedTargets?: ReadonlyMap<string, readonly PerceivedTarget[]>;
}

export interface ProductionFrameOutput {
  readonly snapshot: RuntimeSnapshot;
  readonly character: CharacterState;
  readonly camera: CameraState;
  readonly input: InputIntent | null;
  readonly renderPlan: ReturnType<RenderDirector['plan']>;
  readonly streamPlan: ReturnType<WorldStreamDirector['plan']>;
  readonly diagnostics: ReturnType<ProductionRuntime['diagnostics']>;
}

export interface ProductionRuntimeDiagnostics {
  readonly mode: RuntimeMode;
  readonly tick: number;
  readonly frame: number;
  readonly character: ReturnType<CharacterController['diagnostics']>;
  readonly camera: ReturnType<CameraRig['diagnostics']>;
  readonly input: ReturnType<InputHub['diagnostics']>;
  readonly assets: ReturnType<AssetScheduler['diagnostics']>;
  readonly stream: ReturnType<WorldStreamDirector['diagnostics']>;
  readonly entities: ReturnType<EntityRegistry['diagnostics']>;
  readonly combat: ReturnType<CombatDirector['diagnostics']>;
  readonly npc: ReturnType<NPCBrain['diagnostics']>;
  readonly quests: ReturnType<QuestDirector['diagnostics']>;
  readonly render: ReturnType<RenderDirector['policy']>;
  readonly telemetry: ReturnType<TelemetryRuntime['snapshot']>;
  readonly recovery: ReturnType<RecoverySupervisor['diagnostics']>;
  readonly digest: string;
}

const DEFAULT_CAPABILITIES: RenderCapabilities = Object.freeze({
  secureContext: true,
  webgpu: false,
  webgl2: true,
  hardwareConcurrency: 8,
  memoryGiB: 8,
  devicePixelRatio: 1,
});

const DEFAULT_BUDGETS: BudgetPolicy = Object.freeze({
  maxFrameMs: 16.67,
  maxSimulationMs: 6,
  maxRenderMs: 8,
  maxInputMs: 1,
  maxStreamingMs: 2,
  maxMemoryBytes: 768 * 1024 * 1024,
  maxEntities: 4096,
  maxResidentAssets: 768 * 1024 * 1024,
});

const defaultGround: GroundQuery = Object.freeze({
  sample: () => 0,
  material: () => 'default-ground',
  maxSlopeDegrees: () => 0,
});

const noopSweep = (_from: Vec3, _to: Vec3, _radius: number): CameraCollision | null => null;

export class ProductionRuntime {
  readonly clock: DeterministicClock;
  readonly input: InputHub;
  readonly character: CharacterController;
  readonly camera: CameraRig;
  readonly assets: AssetScheduler;
  readonly streams: WorldStreamDirector;
  readonly entities: EntityRegistry;
  readonly combat: CombatDirector;
  readonly npc: NPCBrain;
  readonly quests: QuestDirector;
  readonly save: SaveRuntime;
  readonly render: RenderDirector;
  readonly telemetry: TelemetryRuntime;
  readonly recovery: RecoverySupervisor;
  readonly budgets: BudgetPolicy;

  #mode: RuntimeMode = 'boot';
  #lastInput: InputIntent | null = null;
  #lastSnapshot: RuntimeSnapshot | null = null;
  #disposed = false;
  #frameBudgetViolations = 0;

  constructor(options: ProductionRuntimeOptions = {}) {
    this.budgets = Object.freeze({ ...DEFAULT_BUDGETS, ...(options.budgets ?? {}) });

    this.clock = new DeterministicClock(options.clock ?? DEFAULT_CLOCK_POLICY);
    this.input = new InputHub(DEFAULT_INPUT_POLICY);
    this.character = new CharacterController(
      options.ground ?? defaultGround,
      { entity: 'player', position: vec3(0, (options.ground ?? defaultGround).sample(0, 8), 8) },
      DEFAULT_MOVEMENT_POLICY,
      {},
    );
    this.camera = new CameraRig(DEFAULT_CAMERA_POLICY, {
      sweep: options.cameraSweep ?? noopSweep,
    });
    this.assets = new AssetScheduler(DEFAULT_ASSET_SCHEDULER_POLICY);
    this.streams = new WorldStreamDirector(DEFAULT_STREAM_POLICY);
    this.entities = new EntityRegistry({
      ...DEFAULT_ENTITY_BUDGET_POLICY,
      maxEntities: this.budgets.maxEntities,
      maxResidentBytes: this.budgets.maxMemoryBytes,
    });
    this.combat = new CombatDirector(DEFAULT_COMBAT_POLICY);
    this.npc = new NPCBrain(DEFAULT_NPC_POLICY);
    this.quests = new QuestDirector();
    this.save = new SaveRuntime(options.storage ?? new (class {
      #data = new Map<string, string>();
      read(key: string): string | null { return this.#data.get(key) ?? null; }
      write(key: string, value: string): void { this.#data.set(key, value); }
      remove(key: string): void { this.#data.delete(key); }
    })(), DEFAULT_SAVE_POLICY);

    const capabilities = options.renderCapabilities ?? DEFAULT_CAPABILITIES;
    this.render = new RenderDirector(
      chooseRenderPolicy(
        capabilities,
        options.rendererBackend ?? 'auto',
        options.quality ?? 'auto',
      ),
    );
    this.telemetry = new TelemetryRuntime(DEFAULT_TELEMETRY_POLICY);
    this.recovery = new RecoverySupervisor(DEFAULT_RECOVERY_POLICY);
  }

  initialize(): void {
    if (this.#disposed) return;
    this.#mode = 'live';
    this.clock.setPaused(false);
    this.telemetry.log('R24 production runtime initialized');
  }

  pause(reason = 'user'): void {
    if (this.#disposed || this.#mode === 'stopped') return;
    this.#mode = 'paused';
    this.clock.setPaused(true);
    this.telemetry.log('runtime paused:' + reason.slice(0, 128));
  }

  resume(reason = 'user'): void {
    if (this.#disposed || this.#mode === 'stopped') return;
    this.#mode = 'live';
    this.clock.setPaused(false);
    this.telemetry.log('runtime resumed:' + reason.slice(0, 128));
  }

  setDegraded(degraded: boolean, reason = 'budget'): void {
    if (this.#disposed) return;
    this.#mode = degraded ? 'degraded' : 'live';
    this.telemetry.gauge('runtime.degraded', degraded ? 1 : 0, this.clock.tickId(), { reason: reason.slice(0, 32) });
  }

  pushInput(sample: RawSample): boolean {
    const result = this.input.push(sample);
    if (!result.ok) {
      this.telemetry.increment('input.reject', 1, this.clock.tickId());
      return false;
    }
    return true;
  }

  admitAsset(request: AssetRequest): boolean {
    const result = this.assets.admit(request, this.clock.tickId());
    if (!result.ok) {
      this.telemetry.increment('asset.reject', 1, this.clock.tickId());
      return false;
    }
    this.telemetry.increment(result.value.accepted ? 'asset.accept' : 'asset.deny', 1, this.clock.tickId());
    return result.value.accepted;
  }

  registerEntity(spec: EntitySpec): string {
    const id = this.entities.upsert(spec);
    return String(id);
  }

  registerCombatant(spec: CombatantSpec): string {
    return String(this.combat.register(spec));
  }

  registerNPC(spec: NPCSpec): string {
    return String(this.npc.register(spec));
  }

  registerQuest(definition: QuestDefinition): string {
    return String(this.quests.register(definition));
  }

  progressQuest(event: QuestProgressEvent): boolean {
    return this.quests.progress(event);
  }

  attack(request: AttackRequest): ReturnType<CombatDirector['attack']> {
    return this.combat.attack(request);
  }

  recover(request: RecoveryRequest): ReturnType<RecoverySupervisor['request']> {
    const plan = this.recovery.request(request);
    if (plan.accepted) {
      this.setDegraded(plan.action !== 'reduce-quality' && plan.action !== 'restart-renderer', 'recovery');
      this.telemetry.increment('recovery.action', 1, plan.tick, { action: plan.action });
    }
    return plan;
  }

  tick(input: ProductionFrameInput): ProductionFrameOutput {
    if (this.#disposed) {
      return this.#emptyFrame();
    }

    const clockStep = this.clock.tick(input.deltaSeconds);
    const frameStart = clockStep.deltaSeconds;
    const tick = clockStep.tick;

    this.telemetry.gauge('frame.deltaSeconds', clockStep.deltaSeconds, tick);
    this.telemetry.gauge('frame.fixedSteps', clockStep.fixedSteps, tick);

    for (const sample of input.inputSamples ?? []) this.pushInput(sample);
    const inputs = this.input.drain();
    const merged = this.input.merge(inputs);
    this.#lastInput = inputs.length ? merged : this.#lastInput;

    let movementResult: ReturnType<CharacterController['step']> | null = null;
    for (let i = 0; i < clockStep.fixedSteps; i += 1) {
      const movement = this.character.step(
        this.clock.policy.fixedStepSeconds,
        this.#lastInput,
        this.character.state().heading + ((this.#lastInput?.look.x ?? 0) * 0.04),
      );
      if (movement.ok) movementResult = movement;
      this.combat.tick(this.clock.policy.fixedStepSeconds);
      this.quests.tick(tick);
      this.npc.tick(this.clock.policy.fixedStepSeconds, tick);
    }

    if (input.entitySpecs) {
      for (const spec of input.entitySpecs) this.entities.upsert(spec);
    }

    for (const [id, targets] of input.perceivedTargets ?? new Map<string, readonly PerceivedTarget[]>()) {
      this.npc.perceive(id, targets, tick);
    }

    const character = this.character.state();
    const cameraTarget: CameraTarget = Object.freeze({
      position: vec3(character.position.x, character.position.y + 1.2, character.position.z),
      lookAt: vec3(character.position.x, character.position.y + 1.5, character.position.z),
      velocity: character.velocity,
      combat: character.velocity.x !== 0 || character.velocity.z !== 0,
    });
    const cameraResult = this.camera.update(
      clockStep.deltaSeconds,
      cameraTarget,
      input.cameraYawDelta ?? 0,
      input.cameraPitchDelta ?? 0,
      input.cameraDistanceDelta ?? 0,
    );
    const camera = cameraResult.ok ? cameraResult.value.state : this.camera.state();

    const streamPlan = this.streams.plan(
      character.position,
      input.streamVelocity ?? character.velocity,
      tick,
    );

    const renderPlan = this.render.plan(
      input.renderCandidates ?? this.#buildFallbackCandidates(),
      clockStep.frame,
    );

    const budget: RuntimeBudget = Object.freeze({
      frameMs: frameStart * 1000,
      simulationMs: clockStep.fixedSteps * this.clock.policy.fixedStepSeconds * 1000,
      renderMs: renderPlan.estimatedGpuMs,
      inputMs: inputs.length * 0.005,
      streamingMs: streamPlan.loads.length * 0.03,
      telemetryMs: 0.08,
      memoryBytes: this.assets.diagnostics().residentBytes + this.streams.diagnostics().residentBytes,
      maxMemoryBytes: this.budgets.maxMemoryBytes,
    });

    const frameOverBudget = budget.frameMs > this.budgets.maxFrameMs
      || budget.simulationMs > this.budgets.maxSimulationMs
      || budget.renderMs > this.budgets.maxRenderMs
      || budget.memoryBytes > budget.maxMemoryBytes;
    if (frameOverBudget) {
      this.#frameBudgetViolations += 1;
      this.telemetry.increment('runtime.budget.violation', 1, tick);
      if (this.#frameBudgetViolations >= 3) {
        this.setDegraded(true, 'budget');
        this.render.adapt(budget.renderMs, budget.frameMs);
      }
    } else {
      this.#frameBudgetViolations = Math.max(0, this.#frameBudgetViolations - 1);
      this.recovery.markStable(tick);
    }

    this.assets.tick(tick);

    const snapshot: RuntimeSnapshot = Object.freeze({
      tick,
      frame: clockStep.frame,
      mode: this.#mode,
      character,
      camera,
      quality: this.render.policy().quality,
      backend: this.render.policy().backend,
      budget,
      digest: stableHash({
        tick,
        frame: clockStep.frame,
        mode: this.#mode,
        character,
        camera,
        stream: streamPlan.digest,
        render: renderPlan.digest,
        budget,
      }),
    });
    this.#lastSnapshot = snapshot;

    this.telemetry.observe('runtime.frameMs', budget.frameMs, tick);
    this.telemetry.observe('runtime.renderMs', budget.renderMs, tick);
    this.telemetry.observe('runtime.memoryBytes', budget.memoryBytes, tick);

    return Object.freeze({
      snapshot,
      character,
      camera,
      input: this.#lastInput,
      renderPlan,
      streamPlan,
      diagnostics: this.diagnostics(),
    });
  }

  #buildFallbackCandidates(): readonly RenderCandidate[] {
    const entities = this.entities.queryRadius(this.character.state().position, 150);
    return Object.freeze(entities.map((entity) => ({
      entity: entity.id,
      distance: Math.hypot(entity.position.x - this.character.state().position.x, entity.position.z - this.character.state().position.z),
      importance: entity.importance,
      triangles: entity.lod === 0 ? 9000 : entity.lod === 1 ? 4500 : entity.lod === 2 ? 1800 : 600,
      instances: 1,
      castsShadow: entity.lod <= 1,
      transparent: false,
    })));
  }

  snapshot(): RuntimeSnapshot | null { return this.#lastSnapshot; }

  diagnostics(): ProductionRuntimeDiagnostics {
    const diagnostic = {
      mode: this.#mode,
      tick: this.clock.tickId(),
      frame: this.clock.frameId(),
      character: this.character.diagnostics(),
      camera: this.camera.diagnostics(),
      input: this.input.diagnostics(),
      assets: this.assets.diagnostics(),
      stream: this.streams.diagnostics(),
      entities: this.entities.diagnostics(),
      combat: this.combat.diagnostics(),
      npc: this.npc.diagnostics(),
      quests: this.quests.diagnostics(),
      render: this.render.policy(),
      telemetry: this.telemetry.snapshot(),
      recovery: this.recovery.diagnostics(),
    };
    return Object.freeze({ ...diagnostic, digest: stableHash(diagnostic) });
  }

  async save(slot = 'autosave'): Promise<boolean> {
    const snapshot = this.#lastSnapshot;
    if (!snapshot || this.#disposed) return false;
    const result = await this.save.save(slot, snapshot, snapshot.tick);
    this.telemetry.increment(result.ok ? 'save.success' : 'save.failure', 1, snapshot.tick);
    return result.ok;
  }

  async load(slot = 'autosave'): Promise<RuntimeSnapshot | null> {
    if (this.#disposed) return null;
    const result = await this.save.load<RuntimeSnapshot>(slot);
    if (!result.ok) {
      this.telemetry.increment('load.failure', 1, this.clock.tickId());
      return null;
    }
    const snapshot = result.value.payload;
    this.character.teleport(snapshot.character.position);
    this.camera.setPose(snapshot.camera.position, snapshot.camera.target);
    this.clock.seek(snapshot.tick);
    this.#mode = snapshot.mode;
    this.#lastSnapshot = snapshot;
    this.telemetry.increment('load.success', 1, snapshot.tick);
    return snapshot;
  }

  #emptyFrame(): ProductionFrameOutput {
    const character = this.character.state();
    const camera = this.camera.state();
    const renderPlan = this.render.plan([], this.clock.frameId());
    const streamPlan = this.streams.plan(character.position, vec3(), this.clock.tickId());
    const snapshot: RuntimeSnapshot = Object.freeze({
      tick: this.clock.tickId(),
      frame: this.clock.frameId(),
      mode: 'stopped',
      character,
      camera,
      quality: this.render.policy().quality,
      backend: this.render.policy().backend,
      budget: Object.freeze({
        frameMs: 0,
        simulationMs: 0,
        renderMs: 0,
        inputMs: 0,
        streamingMs: 0,
        telemetryMs: 0,
        memoryBytes: 0,
        maxMemoryBytes: this.budgets.maxMemoryBytes,
      }),
      digest: stableHash({ disposed: true }),
    });
    return Object.freeze({
      snapshot,
      character,
      camera,
      input: null,
      renderPlan,
      streamPlan,
      diagnostics: this.diagnostics(),
    });
  }

  stop(): void {
    if (this.#disposed) return;
    this.#mode = 'stopped';
    this.clock.setPaused(true);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stop();
    this.input.dispose();
    this.character.dispose();
    this.camera.dispose();
    this.assets.dispose();
    this.streams.dispose();
    this.entities.dispose();
    this.combat.dispose();
    this.npc.dispose();
    this.quests.dispose();
    this.save.dispose();
    this.render.dispose();
    this.telemetry.dispose();
    this.recovery.dispose();
    this.clock.dispose();
  }
}

export const createProductionRuntime = (options: ProductionRuntimeOptions = {}): ProductionRuntime =>
  new ProductionRuntime(options);

export const DEFAULT_NEXTGEN_BUDGETS: BudgetPolicy = DEFAULT_BUDGETS;

export const nextgenRuntimeIdentity = () => stableHash({
  package: 'aapw-nextgen',
  generation: 'r24',
  deterministic: true,
});

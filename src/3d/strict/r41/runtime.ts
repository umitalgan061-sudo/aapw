
import type {
  CommandEnvelope,
  Entity,
  HealthReport,
  InputFrame,
  NetworkEntity,
  RenderInput,
  RenderPlan,
  RuntimeConfig,
  RuntimeMode,
  RuntimeSnapshot,
  RuntimeEvent,
  SystemContext,
  SystemDefinition,
  TelemetrySample,
  Transform,
  WorldSnapshot,
} from './types.ts';
import {
  R41_VERSION,
  clamp,
  cloneEntity,
  finite,
  nowMonotonic,
  quat,
  stableHash,
  vec2,
  vec3,
} from './types.ts';
import { DeterministicClockR41 } from './clock.ts';
import { EventStoreR41 } from './eventStore.ts';
import { CommandPipelineR41, type CommandInput } from './commandPipeline.ts';
import { WorkSchedulerR41, createDefaultBudgetsR41 } from './scheduler.ts';
import { NetworkSessionR41 } from './network.ts';
import { AssetGraphR41, type AssetDeclaration } from './assets.ts';
import { RenderGovernorR41 } from './render.ts';
import { MemorySaveStoreR41, PersistenceR41, RollbackJournalR41 } from './persistence.ts';

export interface RuntimeOptions {
  readonly config?: Partial<RuntimeConfig>;
  readonly now?: () => number;
}

export interface RuntimeFrameInput {
  readonly deltaSeconds: number;
  readonly cameraPosition?: { readonly x: number; readonly y: number; readonly z: number };
  readonly render?: Partial<RenderInput>;
}

export interface EntityInput {
  readonly id: string;
  readonly kind: Entity['kind'];
  readonly position?: Entity['transform']['position'];
  readonly rotation?: Entity['transform']['rotation'];
  readonly scale?: Entity['transform']['scale'];
  readonly velocity?: Entity['velocity'];
  readonly health?: number;
  readonly stamina?: number;
  readonly active?: boolean;
  readonly lod?: Entity['lod'];
  readonly tags?: readonly string[];
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface RuntimeFrame {
  readonly tick: number;
  readonly steppedTicks: number;
  readonly snapshot: RuntimeSnapshot;
  readonly render: RenderPlan;
  readonly events: readonly RuntimeEvent[];
  readonly scheduler: ReturnType<WorkSchedulerR41['snapshot']>;
}

const DEFAULT_CONFIG: RuntimeConfig = Object.freeze({
  seed: 41,
  fixedStepSeconds: 1 / 60,
  maxCatchUpSteps: 6,
  maxEntities: 8192,
  maxCommandsPerTick: 128,
  maxEvents: 8192,
  maxTelemetrySamples: 512,
  snapshotHistory: 64,
  networkRole: 'offline',
  quality: 'balanced',
  frameBudgets: createDefaultBudgetsR41(),
});

export class ProductionRuntimeR41 {
  readonly config: RuntimeConfig;
  readonly clock: DeterministicClockR41;
  readonly events: EventStoreR41;
  readonly commands: CommandPipelineR41;
  readonly scheduler: WorkSchedulerR41;
  readonly network: NetworkSessionR41;
  readonly assets: AssetGraphR41;
  readonly render: RenderGovernorR41;
  readonly persistence: PersistenceR41;
  readonly rollback: RollbackJournalR41;

  #mode: RuntimeMode = 'booting';
  #revision = 0;
  #frame = 0;
  #inputs: InputFrame[] = [];
  #entities = new Map<string, Entity>();
  #systems: SystemDefinition[] = [];
  #telemetry: TelemetrySample[] = [];
  #lastRender: RenderPlan;
  #lastFrame: RuntimeFrame | null = null;
  #now: () => number;

  constructor(options: RuntimeOptions = {}) {
    this.config = normalizeConfig(options.config);
    this.#now = options.now ?? nowMonotonic;
    this.clock = new DeterministicClockR41({
      fixedStepSeconds: this.config.fixedStepSeconds,
      maxCatchUpSteps: this.config.maxCatchUpSteps,
    });
    this.events = new EventStoreR41(this.config.maxEvents);
    this.commands = new CommandPipelineR41({
      maxPerTick: this.config.maxCommandsPerTick,
      maxHistory: this.config.maxEvents,
    });
    this.scheduler = new WorkSchedulerR41(this.config.frameBudgets);
    this.network = new NetworkSessionR41({ maxSnapshots: this.config.snapshotHistory });
    this.assets = new AssetGraphR41();
    this.render = new RenderGovernorR41({ initialTier: this.config.quality });
    this.persistence = new PersistenceR41({ store: new MemorySaveStoreR41(), profileId: 'r41', now: this.#now });
    this.rollback = new RollbackJournalR41(this.config.snapshotHistory);
    this.#lastRender = this.createDefaultRender();
    this.registerBuiltInSystems();
  }

  get mode(): RuntimeMode { return this.#mode; }
  get tick(): number { return this.clock.tick; }
  get frame(): number { return this.#frame; }
  get revision(): number { return this.#revision; }

  start(): boolean {
    if (this.#mode === 'disposed' || this.#mode === 'faulted') return false;
    if (this.#mode === 'running') return true;
    const from = this.#mode;
    this.#mode = 'running';
    this.emit({ type: 'runtime.mode', tick: this.tick, from, to: 'running', reason: 'start' });
    return true;
  }

  pause(reason = 'manual-pause'): boolean {
    if (this.#mode !== 'running') return false;
    const from = this.#mode;
    this.#mode = 'paused';
    this.clock.pause();
    this.emit({ type: 'runtime.mode', tick: this.tick, from, to: 'paused', reason });
    return true;
  }

  resume(reason = 'manual-resume'): boolean {
    if (this.#mode !== 'paused') return false;
    const from = this.#mode;
    this.clock.resume();
    this.#mode = 'running';
    this.emit({ type: 'runtime.mode', tick: this.tick, from, to: 'running', reason });
    return true;
  }

  stop(reason = 'runtime-stop'): boolean {
    if (this.#mode === 'disposed') return false;
    if (this.#mode === 'stopped') return true;
    const from = this.#mode;
    this.#mode = 'stopped';
    this.clock.pause();
    this.emit({ type: 'runtime.mode', tick: this.tick, from, to: 'stopped', reason });
    return true;
  }

  dispose(): void {
    if (this.#mode === 'disposed') return;
    const from = this.#mode;
    this.#mode = 'disposed';
    this.clock.pause();
    this.scheduler.clear();
    this.commands.clear();
    this.network.disconnect();
    this.rollback.clear();
    this.events.append({ type: 'runtime.mode', tick: this.tick, from, to: 'disposed', reason: 'dispose' });
    void from;
  }

  registerSystem(system: SystemDefinition): void {
    if (!system.id.trim()) throw new Error('R41 system id is required');
    if (this.#systems.some(existing => existing.id === system.id)) {
      throw new Error('duplicate R41 system: ' + system.id);
    }
    this.#systems.push(Object.freeze({ ...system }));
    this.#systems.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  registerEntity(input: EntityInput): boolean {
    const id = sanitizeId(input.id);
    if (!id || this.#entities.has(id)) return false;
    if (this.#entities.size >= this.config.maxEntities) return false;
    const entity = createEntity({ ...input, id }, this.#revision + 1);
    this.#entities.set(id, entity);
    this.#revision += 1;
    this.emit({ type: 'entity.spawn', tick: this.tick, entityId: id, kind: entity.kind });
    return true;
  }

  updateEntity(id: string, patch: Partial<Entity>): boolean {
    const key = sanitizeId(id);
    const current = this.#entities.get(key);
    if (!current) return false;

    const transform = patch.transform
      ? normalizeTransform({
          position: patch.transform.position ?? current.transform.position,
          rotation: patch.transform.rotation ?? current.transform.rotation,
          scale: patch.transform.scale ?? current.transform.scale,
        })
      : current.transform;

    const next = cloneEntity(Object.freeze({
      ...current,
      ...patch,
      id: key,
      transform,
      velocity: patch.velocity ? vec3(patch.velocity.x, patch.velocity.y, patch.velocity.z) : current.velocity,
      health: clamp(finite(patch.health, current.health), 0, 100),
      stamina: clamp(finite(patch.stamina, current.stamina), 0, 100),
      active: patch.active ?? current.active,
      revision: current.revision + 1,
    }));
    this.#entities.set(key, next);
    this.#revision += 1;
    this.emit({ type: 'entity.patch', tick: this.tick, entityId: key, revision: next.revision });
    return true;
  }

  removeEntity(id: string): boolean {
    const key = sanitizeId(id);
    if (!this.#entities.delete(key)) return false;
    this.#revision += 1;
    this.emit({ type: 'entity.remove', tick: this.tick, entityId: key });
    return true;
  }

  entity(id: string): Entity | null {
    const entity = this.#entities.get(sanitizeId(id));
    return entity ? cloneEntity(entity) : null;
  }

  entities(): readonly Entity[] {
    return Object.freeze([...this.#entities.values()].sort((a, b) => a.id.localeCompare(b.id)).map(cloneEntity));
  }

  pushInput(input: Omit<InputFrame, 'sequence'>): InputFrame {
    const last = this.#inputs[this.#inputs.length - 1];
    const sequence = (last?.sequence ?? 0) + 1;
    const frame: InputFrame = Object.freeze({
      ...input,
      tick: Math.trunc(input.tick),
      sequence,
      move: vec2(input.move.x, input.move.y),
      look: vec2(input.look.x, input.look.y),
    });
    this.#inputs.push(frame);
    const maxInputs = Math.max(this.config.maxEvents, 128);
    if (this.#inputs.length > maxInputs) this.#inputs.splice(0, this.#inputs.length - maxInputs);
    return frame;
  }

  dispatchCommand(input: CommandInput): ReturnType<CommandPipelineR41['dispatch']> {
    const receipt = this.commands.dispatch(input, this.tick);
    if (receipt.accepted) {
      this.emit({ type: 'command.accepted', tick: this.tick, commandId: receipt.id });
    } else {
      this.emit({
        type: 'command.rejected',
        tick: this.tick,
        commandId: receipt.id,
        reason: receipt.reason,
      });
    }
    return receipt;
  }

  queueWork<T>(item: import('./types.ts').WorkItem<T>): boolean {
    return this.scheduler.enqueue(item);
  }

  declareAsset(input: AssetDeclaration): void {
    const node = this.assets.declare(input, this.tick);
    this.emit({ type: 'asset.state', tick: this.tick, assetId: node.id, state: node.state });
  }

  setAssetState(id: string, state: import('./types.ts').AssetState): boolean {
    const node = this.assets.transition(id, state, this.tick);
    if (!node) return false;
    this.emit({ type: 'asset.state', tick: this.tick, assetId: node.id, state: node.state });
    return true;
  }

  connectNetwork(): void { this.network.connect(); }
  disconnectNetwork(): void { this.network.disconnect(); }

  async frame(input: RuntimeFrameInput): Promise<RuntimeFrame> {
    this.assertRunnable();
    const started = this.#now();
    let steppedTicks = 0;

    const step = (clockStep: { readonly tick: number; readonly deltaSeconds: number }): void => {
      steppedTicks += 1;
      this.emit({ type: 'runtime.tick', tick: clockStep.tick, deltaSeconds: clockStep.deltaSeconds });
      this.simulateStep(clockStep.tick, clockStep.deltaSeconds);
    };

    this.clock.pushFrameDelta(clamp(finite(input.deltaSeconds), 0, 0.25), step);

    const renderStart = this.#now();
    const render = this.render.decide(this.createRenderInput(input));
    const renderMs = Math.max(0, this.#now() - renderStart);

    const schedulerResults = await this.scheduler.runTick(this.tick, this.#now);
    const scheduler = this.scheduler.snapshot(this.tick);
    const frameMs = Math.max(0, this.#now() - started);

    if (render.tier !== this.#lastRender.tier || Math.abs(render.scale - this.#lastRender.scale) > 0.0001) {
      this.emit({
        type: 'quality.changed',
        tick: this.tick,
        from: this.#lastRender.tier,
        to: render.tier,
        reason: render.reason,
      });
    }
    this.#lastRender = render;

    const telemetry = this.createTelemetry(frameMs, renderMs, render);
    this.#telemetry.push(telemetry);
    if (this.#telemetry.length > this.config.maxTelemetrySamples) this.#telemetry.shift();

    const health = this.health();
    const snapshot = this.snapshot(render, telemetry, health);
    this.rollback.push(snapshotWorld(this));

    if (this.config.networkRole !== 'offline') {
      const entities = this.entities().map(toNetworkEntity);
      this.network.encodeSnapshot(this.tick, this.#frame + 1, this.latestInputSequence(), entities);
    }

    this.#frame += 1;
    const frame: RuntimeFrame = Object.freeze({
      tick: this.tick,
      steppedTicks,
      snapshot,
      render,
      events: Object.freeze(this.events.byTick(this.tick)),
      scheduler: Object.freeze(scheduler),
    });
    this.#lastFrame = frame;
    void schedulerResults;
    return frame;
  }

  save(slot = 'autosave'): WorldSnapshot {
    const snapshot = snapshotWorld(this);
    this.persistence.save(slot, snapshot, { runtime: 'r41', version: String(R41_VERSION) });
    return snapshot;
  }

  load(slot = 'autosave'): boolean {
    const envelope = this.persistence.load(slot);
    if (!envelope) return false;
    restoreWorld(this, envelope.world);
    return true;
  }

  rollbackTo(tick: number): boolean {
    const snapshot = this.rollback.atOrBefore(tick);
    if (!snapshot) return false;
    restoreWorld(this, snapshot);
    this.commands.rejectStale(this.tick);
    this.events.pruneBeforeTick(this.tick);
    return true;
  }

  snapshot(
    render: RenderPlan = this.#lastRender,
    telemetry = this.latestTelemetry(),
    health = this.health(),
  ): RuntimeSnapshot {
    const entities = this.entities();
    const checksum = stableHash({
      mode: this.#mode,
      tick: this.tick,
      revision: this.#revision,
      entities,
      render,
      telemetry,
    });
    return Object.freeze({
      mode: this.#mode,
      tick: this.tick,
      revision: this.#revision,
      entities: entities.length,
      activeEntities: entities.filter(entity => entity.active).length,
      queuedCommands: this.commands.history().filter(command => command.tick >= this.tick).length,
      queuedWork: this.scheduler.snapshot(this.tick).queued,
      residentAssetBytes: this.assets.stats().residentBytes,
      network: this.network.metrics(),
      render,
      telemetry,
      health,
      checksum,
    });
  }

  latestTelemetry(): TelemetrySample {
    return this.#telemetry[this.#telemetry.length - 1] ?? Object.freeze({
      tick: this.tick,
      frameMs: 0,
      simulationMs: 0,
      renderMs: 0,
      networkMs: 0,
      streamingMs: 0,
      persistenceMs: 0,
      entityCount: this.#entities.size,
      activeCount: [...this.#entities.values()].filter(entity => entity.active).length,
      memoryBytes: estimateMemory(this.#entities.size, this.assets.stats().residentBytes),
      quality: this.render.tier,
    });
  }

  health(): HealthReport {
    const samples = this.#telemetry.slice(-60);
    const averageFrame = average(samples.map(sample => sample.frameMs));
    const memory = this.assets.stats().utilization;
    const scheduler = this.scheduler.snapshot(this.tick);
    const warnings: string[] = [];
    const critical: string[] = [];

    if (averageFrame > 20) warnings.push('frame-time-high');
    if (averageFrame > 33) critical.push('frame-time-critical');
    if (memory > 0.9) warnings.push('asset-memory-high');
    if (memory > 1) critical.push('asset-memory-overflow');
    if (scheduler.failed > 0) warnings.push('scheduled-work-failed');
    if (this.clock.snapshot().droppedSteps > 0) warnings.push('simulation-steps-dropped');
    if (this.commands.history().length >= this.config.maxEvents * 0.9) warnings.push('command-history-near-capacity');

    const penalty = critical.length * 30 + warnings.length * 10 + Math.max(0, averageFrame - 16.67) * 1.2;
    const score = clamp(100 - penalty, 0, 100);
    return Object.freeze({
      score,
      ok: critical.length === 0 && this.#mode !== 'faulted',
      mode: this.#mode,
      tick: this.tick,
      warnings: Object.freeze(warnings),
      critical: Object.freeze(critical),
      sampleCount: samples.length,
    });
  }

  lastFrame(): RuntimeFrame | null { return this.#lastFrame; }

  registerDefaultPlayer(id = 'player'): boolean {
    return this.registerEntity({
      id,
      kind: 'player',
      position: vec3(0, 0, 0),
      velocity: vec3(),
      health: 100,
      stamina: 100,
      tags: ['player', 'local'],
    });
  }

  latestInputSequence(): number {
    return this.#inputs[this.#inputs.length - 1]?.sequence ?? 0;
  }

  private registerBuiltInSystems(): void {
    this.registerSystem({
      id: 'r41.input-movement',
      class: 'simulation',
      priority: 'critical',
      order: 10,
      run: context => this.runMovementSystem(context),
    });

    this.registerSystem({
      id: 'r41.commands',
      class: 'gameplay',
      priority: 'high',
      order: 20,
      run: context => this.runCommandSystem(context),
    });

    this.registerSystem({
      id: 'r41.stamina',
      class: 'gameplay',
      priority: 'normal',
      order: 30,
      run: context => this.runStaminaSystem(context),
    });

    this.registerSystem({
      id: 'r41.lod',
      class: 'streaming',
      priority: 'normal',
      order: 40,
      run: context => this.runLodSystem(context),
    });
  }

  private runMovementSystem(context: SystemContext): void {
    const input = context.inputs.find(value => value.tick === context.tick);
    if (!input) return;
    const player = [...this.#entities.values()].find(entity => entity.kind === 'player' && entity.active);
    if (!player) return;
    const speed = input.sprint ? 8 : 4;
    const position = vec3(
      player.transform.position.x + input.move.x * speed * context.deltaSeconds,
      player.transform.position.y,
      player.transform.position.z + input.move.y * speed * context.deltaSeconds,
    );
    this.updateEntity(player.id, {
      transform: { ...player.transform, position },
      velocity: vec3(input.move.x * speed, player.velocity.y, input.move.y * speed),
    });
  }

  private runCommandSystem(context: SystemContext): void {
    for (const command of context.commands) {
      const entity = this.#entities.get(command.entityId);
      if (!entity) continue;
      if (command.kind === 'teleport') {
        this.updateEntity(entity.id, {
          transform: {
            ...entity.transform,
            position: vec3(
              finite(command.payload.x),
              finite(command.payload.y),
              finite(command.payload.z),
            ),
          },
        });
      } else if (command.kind === 'attack') {
        this.updateEntity(entity.id, { stamina: clamp(entity.stamina - 5, 0, 100) });
      } else if (command.kind === 'dodge') {
        this.updateEntity(entity.id, { stamina: clamp(entity.stamina - 15, 0, 100) });
      } else if (command.kind === 'jump') {
        this.updateEntity(entity.id, { velocity: vec3(entity.velocity.x, 7, entity.velocity.z) });
      }
    }
  }

  private runStaminaSystem(context: SystemContext): void {
    for (const entity of [...this.#entities.values()]) {
      if (!entity.active) continue;
      const recovering = clamp(entity.stamina + context.deltaSeconds * 2.5, 0, 100);
      if (recovering !== entity.stamina) this.updateEntity(entity.id, { stamina: recovering });
    }
  }

  private runLodSystem(context: SystemContext): void {
    const player = [...this.#entities.values()].find(entity => entity.kind === 'player');
    if (!player) return;
    for (const entity of [...this.#entities.values()]) {
      const distance = Math.sqrt(distanceSquared(player.transform.position, entity.transform.position));
      const lod = distance <= 75 ? 0 : distance <= 250 ? 1 : distance <= 800 ? 2 : 3;
      if (lod !== entity.lod) this.updateEntity(entity.id, { lod });
    }
    void context;
  }

  private simulateStep(tick: number, deltaSeconds: number): void {
    const inputs = this.#inputs.filter(input => input.tick === tick);
    const commands = this.commands.commandsForTick(tick);
    const context: SystemContext = Object.freeze({
      tick,
      deltaSeconds,
      entities: this.entities(),
      inputs: Object.freeze(inputs),
      commands: Object.freeze(commands),
    });

    for (const system of this.#systems) {
      try {
        const result = system.run(context);
        if (result instanceof Promise) {
          void result.catch(error => this.emit({
            type: 'fault',
            tick,
            domain: system.id,
            message: stringifyError(error),
          }));
        }
      } catch (error) {
        this.#mode = 'degraded';
        this.emit({
          type: 'fault',
          tick,
          domain: system.id,
          message: stringifyError(error),
        });
      }
    }
  }

  private createRenderInput(input: RuntimeFrameInput): RenderInput {
    const partial = input.render ?? {};
    return {
      backend: partial.backend ?? 'webgl2',
      width: Math.max(1, Math.trunc(partial.width ?? 1280)),
      height: Math.max(1, Math.trunc(partial.height ?? 720)),
      frameMs: finite(partial.frameMs, 16.67),
      cpuMs: finite(partial.cpuMs, 8),
      gpuMs: partial.gpuMs ?? null,
      memoryPressure: clamp(finite(partial.memoryPressure, this.assets.stats().utilization), 0, 1.5),
      thermalPressure: clamp(finite(partial.thermalPressure, 0), 0, 1.5),
      requestedFeatures: partial.requestedFeatures ?? [
        'dynamicResolution',
        'temporalHistory',
        'taa',
        'fog',
        'instancing',
        'occlusionHints',
      ],
      webgpuAvailable: partial.webgpuAvailable ?? false,
      textureCompression: partial.textureCompression ?? true,
      visibility: clamp(finite(partial.visibility, 1), 0, 1),
      cameraCut: partial.cameraCut ?? false,
      reducedMotion: partial.reducedMotion ?? false,
      saveData: partial.saveData ?? false,
    };
  }

  private createTelemetry(frameMs: number, renderMs: number, render: RenderPlan): TelemetrySample {
    return Object.freeze({
      tick: this.tick,
      frameMs,
      simulationMs: Math.max(0, frameMs - renderMs),
      renderMs,
      networkMs: 0,
      streamingMs: 0,
      persistenceMs: 0,
      entityCount: this.#entities.size,
      activeCount: [...this.#entities.values()].filter(entity => entity.active).length,
      memoryBytes: estimateMemory(this.#entities.size, this.assets.stats().residentBytes),
      quality: render.tier,
    });
  }

  private createDefaultRender(): RenderPlan {
    return this.render.decide({
      backend: 'webgl2',
      width: 1,
      height: 1,
      frameMs: 16.67,
      cpuMs: 8,
      gpuMs: null,
      memoryPressure: 0,
      thermalPressure: 0,
      requestedFeatures: ['dynamicResolution'],
      webgpuAvailable: false,
      textureCompression: true,
      visibility: 1,
      cameraCut: true,
      reducedMotion: false,
      saveData: false,
    });
  }

  private emit(event: Omit<RuntimeEvent, 'sequence'>): RuntimeEvent {
    return this.events.append(event);
  }

  private assertRunnable(): void {
    if (!['running', 'loading', 'degraded'].includes(this.#mode)) {
      throw new Error('R41 runtime is not runnable in mode ' + this.#mode);
    }
  }
}

function normalizeConfig(config: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return Object.freeze({
    ...DEFAULT_CONFIG,
    ...config,
    seed: Math.trunc(finite(config.seed, DEFAULT_CONFIG.seed)),
    fixedStepSeconds: clamp(finite(config.fixedStepSeconds, DEFAULT_CONFIG.fixedStepSeconds), 1 / 240, 0.25),
    maxCatchUpSteps: Math.max(1, Math.trunc(finite(config.maxCatchUpSteps, DEFAULT_CONFIG.maxCatchUpSteps))),
    maxEntities: Math.max(1, Math.trunc(finite(config.maxEntities, DEFAULT_CONFIG.maxEntities))),
    maxCommandsPerTick: Math.max(1, Math.trunc(finite(config.maxCommandsPerTick, DEFAULT_CONFIG.maxCommandsPerTick))),
    maxEvents: Math.max(128, Math.trunc(finite(config.maxEvents, DEFAULT_CONFIG.maxEvents))),
    maxTelemetrySamples: Math.max(32, Math.trunc(finite(config.maxTelemetrySamples, DEFAULT_CONFIG.maxTelemetrySamples))),
    snapshotHistory: Math.max(4, Math.trunc(finite(config.snapshotHistory, DEFAULT_CONFIG.snapshotHistory))),
    frameBudgets: Object.freeze([...(config.frameBudgets ?? DEFAULT_CONFIG.frameBudgets)]),
  });
}

function createEntity(input: EntityInput, revision: number): Entity {
  return cloneEntity(Object.freeze({
    id: input.id.trim().slice(0, 128),
    kind: input.kind,
    transform: normalizeTransform({
      position: input.position ?? vec3(),
      rotation: input.rotation ?? quat(),
      scale: input.scale ?? vec3(1, 1, 1),
    }),
    velocity: vec3(input.velocity?.x, input.velocity?.y, input.velocity?.z),
    health: clamp(finite(input.health, 100), 0, 100),
    stamina: clamp(finite(input.stamina, 100), 0, 100),
    active: input.active ?? true,
    lod: input.lod ?? 1,
    revision,
    tags: Object.freeze((input.tags ?? []).map(tag => sanitizeText(tag, 48)).filter(Boolean)),
    data: Object.freeze({ ...(input.data ?? {}) }),
  }));
}

function normalizeTransform(transform: Transform): Transform {
  return Object.freeze({
    position: vec3(transform.position.x, transform.position.y, transform.position.z),
    rotation: quat(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w),
    scale: vec3(transform.scale.x, transform.scale.y, transform.scale.z),
  });
}

function snapshotWorld(runtime: ProductionRuntimeR41): WorldSnapshot {
  const entities = runtime.entities();
  const base = {
    version: R41_VERSION,
    tick: runtime.tick,
    revision: runtime.revision,
    seed: runtime.config.seed,
    entities,
    flags: Object.freeze({}),
    values: Object.freeze({}),
  };
  return Object.freeze({ ...base, checksum: stableHash(base) });
}

function restoreWorld(runtime: ProductionRuntimeR41, snapshot: WorldSnapshot): void {
  const base = {
    version: snapshot.version,
    tick: snapshot.tick,
    revision: snapshot.revision,
    seed: snapshot.seed,
    entities: snapshot.entities,
    flags: snapshot.flags,
    values: snapshot.values,
  };
  if (stableHash(base) !== snapshot.checksum) throw new Error('R41 world snapshot checksum mismatch');
  if (snapshot.seed !== runtime.config.seed) throw new Error('R41 save seed mismatch');

  const map = runtime as unknown as {
    '#entities'?: Map<string, Entity>;
  };
  void map;

  for (const entity of runtime.entities()) runtime.removeEntity(entity.id);
  for (const entity of snapshot.entities) {
    runtime.registerEntity({
      id: entity.id,
      kind: entity.kind,
      position: entity.transform.position,
      rotation: entity.transform.rotation,
      scale: entity.transform.scale,
      velocity: entity.velocity,
      health: entity.health,
      stamina: entity.stamina,
      active: entity.active,
      lod: entity.lod,
      tags: entity.tags,
      data: entity.data,
    });
  }
  runtime.clock.reset(snapshot.tick);
}

function toNetworkEntity(entity: Entity): NetworkEntity {
  return Object.freeze({
    id: entity.id,
    revision: entity.revision,
    position: entity.transform.position,
    velocity: entity.velocity,
    rotation: entity.transform.rotation,
    health: entity.health,
    stamina: entity.stamina,
    flags: entity.active ? 1 : 0,
  });
}

function distanceSquared(a: Entity['transform']['position'], b: Entity['transform']['position']): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

function estimateMemory(entityCount: number, assetBytes: number): number {
  return Math.max(0, entityCount * 768 + assetBytes);
}

function average(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sanitizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128) : '';
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\\u0000-\\u001F\\u007F]/g, '').slice(0, maxLength);
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

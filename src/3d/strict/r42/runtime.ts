/**
 * Integrated production runtime host for R42.
 * Production TypeScript owner.
 */
import type {
  ActionCommand,
  BudgetRule,
  ClockSnapshot,
  FrameMetrics,
  InputFrame,
  NetworkMode,
  QualityTier,
  RenderCapabilities,
  RenderSettings,
  RuntimeConfig,
  RuntimeEvent,
  RuntimeMode,
  RuntimePlugin,
  RuntimePluginContext,
  RuntimePolicy,
  RuntimeSnapshot,
  SaveEnvelope,
  Vec3,
} from './types.ts';
import { deepFreeze, hashValue, safeInteger, vec3 } from './types.ts';
import { DeterministicClockR42 } from './clock.ts';
import { InputCommandBufferR42, InputNormalizerR42, type RawInput } from './input.ts';
import { EntityWorldR42, type SpawnInput } from './world.ts';
import { SimulationAuthorityR42, type SimulationRules, DEFAULT_SIMULATION_RULES } from './simulation.ts';
import { RenderGovernorR42, type RenderObservation } from './render.ts';
import { AssetRegistryR42, type AssetDeclaration } from './assets.ts';
import { NetworkAuthorityR42 } from './network.ts';
import { SaveSystemR42, MemorySaveStoreR42 } from './persistence.ts';
import { BudgetSchedulerR42, createR42Budgets } from './scheduler.ts';
import { DeterministicWorkerPoolR42 } from './workers.ts';
import { RuntimeObservabilityR42 } from './observability.ts';
import { RuntimeSecurityR42 } from './security.ts';

const DEFAULT_CAPABILITIES: RenderCapabilities = Object.freeze({
  webgpu: false,
  webgl2: true,
  maxTextureSize: 8192,
  maxSamples: 4,
  compressedTextures: true,
  devicePixelRatio: 1,
  reducedMotion: false,
  saveData: false,
});

const DEFAULT_POLICY: RuntimePolicy = Object.freeze({
  fixedStepSeconds: 1 / 60,
  maxCatchUpSteps: 8,
  maxFrameDeltaSeconds: 0.25,
  maxEntities: 8192,
  maxCommandsPerTick: 128,
  maxEventsPerTick: 512,
  maxAssetBytes: 256 * 1024 * 1024,
  maxNetworkPacketBytes: 128 * 1024,
  inputHistory: 256,
  snapshotHistory: 64,
  budgets: createR42Budgets(),
});

export interface RuntimeOptions {
  readonly seed?: number;
  readonly network?: NetworkMode;
  readonly quality?: QualityTier;
  readonly policy?: Partial<RuntimePolicy>;
  readonly capabilities?: Partial<RenderCapabilities>;
  readonly simulation?: Partial<SimulationRules>;
  readonly now?: () => number;
}

export interface FrameInput {
  readonly deltaSeconds: number;
  readonly render?: Partial<RenderObservation>;
}

export interface RuntimeFrame {
  readonly tick: number;
  readonly steps: number;
  readonly snapshot: RuntimeSnapshot;
  readonly render: RenderSettings;
  readonly events: readonly RuntimeEvent[];
}

export class ProductionRuntimeR42 {
  readonly config: RuntimeConfig;
  readonly clock: DeterministicClockR42;
  readonly input: InputNormalizerR42;
  readonly commands: InputCommandBufferR42;
  readonly world: EntityWorldR42;
  readonly simulation: SimulationAuthorityR42;
  readonly render: RenderGovernorR42;
  readonly assets: AssetRegistryR42;
  readonly network: NetworkAuthorityR42;
  readonly persistence: SaveSystemR42;
  readonly scheduler: BudgetSchedulerR42;
  readonly workers: DeterministicWorkerPoolR42;
  readonly observability: RuntimeObservabilityR42;
  readonly security: RuntimeSecurityR42;

  #mode: RuntimeMode = 'booting';
  #revision = 0;
  #eventSequence = 0;
  #events: RuntimeEvent[] = [];
  #plugins: RuntimePlugin[] = [];
  #lastFrame: RuntimeFrame | null = null;
  #lastRender: RenderSettings;
  #now: () => number;

  constructor(options: RuntimeOptions = {}) {
    const policy = Object.freeze({
      ...DEFAULT_POLICY,
      ...options.policy,
      budgets: options.policy?.budgets ?? DEFAULT_POLICY.budgets,
    });
    const capabilities = Object.freeze({
      ...DEFAULT_CAPABILITIES,
      ...options.capabilities,
    });
    this.config = deepFreeze({
      seed: safeInteger(options.seed, 42),
      network: options.network ?? 'offline',
      quality: options.quality ?? 'balanced',
      policy,
      capabilities,
    });

    this.#now = options.now ?? (() => performance.now());
    this.clock = new DeterministicClockR42({
      fixedStepSeconds: policy.fixedStepSeconds,
      maxCatchUpSteps: policy.maxCatchUpSteps,
      maxFrameDeltaSeconds: policy.maxFrameDeltaSeconds,
    });
    this.input = new InputNormalizerR42({ maxHistory: policy.inputHistory });
    this.commands = new InputCommandBufferR42(policy.maxCommandsPerTick, policy.snapshotHistory * 16);
    this.world = new EntityWorldR42(policy.maxEntities, 32);
    this.simulation = new SimulationAuthorityR42(this.world, {
      ...DEFAULT_SIMULATION_RULES,
      ...(options.simulation ?? {}),
    });
    this.render = new RenderGovernorR42(this.config.quality);
    this.assets = new AssetRegistryR42(policy.maxAssetBytes);
    this.network = new NetworkAuthorityR42({
      maxSnapshots: policy.snapshotHistory,
      maxPacketBytes: policy.maxNetworkPacketBytes,
      maxInputHistory: policy.inputHistory,
    });
    this.persistence = new SaveSystemR42(new MemorySaveStoreR42(), 8 * 1024 * 1024, policy.maxEntities);
    this.scheduler = new BudgetSchedulerR42(policy.budgets);
    this.workers = new DeterministicWorkerPoolR42({ maxConcurrency: 2, maxQueue: 256 });
    this.observability = new RuntimeObservabilityR42({ capacity: 512 });
    this.security = new RuntimeSecurityR42({ maxPacketBytes: policy.maxNetworkPacketBytes });
    this.#lastRender = this.render.evaluate(this.config.capabilities, {
      frameMs: 16.67,
      gpuMs: null,
      memoryPressure: 0,
      thermalPressure: 0,
      visibleObjects: 0,
      cameraCut: true,
    }, this.config.quality);
  }

  get mode(): RuntimeMode { return this.#mode; }
  get tick(): number { return this.clock.tick; }
  get revision(): number { return this.#revision; }
  get lastFrame(): RuntimeFrame | null { return this.#lastFrame; }

  async initialize(): Promise<void> {
    if (this.#mode === 'disposed') throw new Error('R42 runtime is disposed.');
    if (this.#mode !== 'booting') return;
    this.transition('loading', 'initialization');
    const snapshot = this.snapshot();
    const context = this.pluginContext(snapshot);
    for (const plugin of this.#plugins) {
      if (plugin.enabled && plugin.initialize) await plugin.initialize(context);
    }
    this.transition('running', 'initialized');
  }

  async frame(input: FrameInput): Promise<RuntimeFrame> {
    if (this.#mode === 'booting' || this.#mode === 'loading') await this.initialize();
    if (this.#mode === 'disposed' || this.#mode === 'faulted') throw new Error('R42 runtime unavailable in mode: ' + this.#mode);

    const frameStart = this.#now();
    const delta = Math.max(0, Math.min(input.deltaSeconds, this.config.policy.maxFrameDeltaSeconds));
    const renderObservation: RenderObservation = {
      frameMs: input.render?.frameMs ?? delta * 1000,
      gpuMs: input.render?.gpuMs ?? null,
      memoryPressure: input.render?.memoryPressure ?? 0,
      thermalPressure: input.render?.thermalPressure ?? 0,
      visibleObjects: input.render?.visibleObjects ?? this.world.size,
      cameraCut: input.render?.cameraCut ?? false,
    };

    this.#events = [];
    const advance = this.clock.advance(delta, (tick, stepSeconds) => {
      this.runTick(tick, stepSeconds);
    });

    this.#lastRender = this.render.evaluate(this.config.capabilities, renderObservation, this.config.quality);
    await this.scheduler.run(this.tick);
    const workerResults = await this.workers.drain();
    if (workerResults.some(result => result.failed)) this.observability.increment('faults');

    const memoryBytes = estimateMemory(this.world.size, this.assets.stats().residentBytes);
    const metrics: FrameMetrics = deepFreeze({
      tick: this.tick,
      frameMs: Math.max(0, this.#now() - frameStart),
      simulationMs: advance.steps * this.clock.fixedStepSeconds * 1000,
      renderMs: Math.max(0, renderObservation.frameMs),
      networkMs: 0,
      streamingMs: 0,
      assetsMs: 0,
      persistenceMs: 0,
      entityCount: this.world.size,
      activeEntities: this.world.values().filter(entity => entity.active).length,
      memoryBytes,
      quality: this.#lastRender.quality,
      backend: this.#lastRender.backend,
      droppedSteps: advance.droppedSteps,
    });

    this.observability.record(metrics);
    const snapshot = this.snapshot(metrics);
    const frame: RuntimeFrame = deepFreeze({
      tick: this.tick,
      steps: advance.steps,
      snapshot,
      render: this.#lastRender,
      events: Object.freeze([...this.#events]),
    });
    this.#lastFrame = frame;
    for (const plugin of this.#plugins) {
      if (plugin.enabled && plugin.afterTick) await plugin.afterTick(this.pluginContext(snapshot));
    }
    return frame;
  }

  feedInput(raw: RawInput): InputFrame {
    return this.input.normalize({ ...raw, tick: raw.tick ?? this.tick });
  }

  bindInput(frame: InputFrame, entityId: string): readonly ActionCommand[] {
    return this.buildCommands(frame, entityId);
  }

  spawn(input: SpawnInput): void {
    const entity = this.world.spawn(input);
    this.#revision += 1;
    this.emit('entity.spawn', { entityId: entity.id, kind: entity.kind });
  }

  remove(entityId: string): boolean {
    const removed = this.world.remove(entityId);
    if (removed) {
      this.#revision += 1;
      this.emit('entity.remove', { entityId });
    }
    return removed;
  }

  registerAsset(asset: AssetDeclaration): void {
    const record = this.assets.declare(asset);
    this.emit('asset.state', { assetId: record.id, state: record.state });
  }

  requestAsset(id: string): boolean {
    const accepted = this.assets.request({
      id,
      priority: this.assets.get(id)?.priority ?? 'normal',
      requestedTick: this.tick,
    });
    if (accepted) this.emit('asset.state', { assetId: id, state: 'queued' });
    return accepted;
  }

  registerPlugin(plugin: RuntimePlugin): boolean {
    if (this.#mode === 'running') return false;
    if (this.#plugins.some(value => value.id === plugin.id)) return false;
    this.#plugins.push(Object.freeze({ ...plugin }));
    this.#plugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return true;
  }

  async save(slot = 'default', metadata: Readonly<Record<string, string>> = {}): Promise<SaveEnvelope> {
    const envelope = this.persistence.encode(slot, this.tick, this.#revision, this.world.values(), metadata);
    await this.persistence.store.write(envelope.slot, this.persistence.serialize(envelope));
    return envelope;
  }

  async load(slot = 'default'): Promise<SaveEnvelope | null> {
    return this.persistence.load(slot);
  }

  pause(): void {
    if (this.#mode !== 'running') return;
    this.clock.setPaused(true);
    this.transition('paused', 'manual pause');
  }

  resume(): void {
    if (this.#mode !== 'paused') return;
    this.clock.setPaused(false);
    this.transition('running', 'manual resume');
  }

  async dispose(): Promise<void> {
    if (this.#mode === 'disposed') return;
    const snapshot = this.snapshot();
    for (const plugin of [...this.#plugins].reverse()) {
      if (plugin.enabled && plugin.dispose) await plugin.dispose(this.pluginContext(snapshot));
    }
    this.workers.clear();
    this.scheduler.clear();
    this.observability.reset();
    this.transition('disposed', 'dispose');
  }

  snapshot(metrics?: FrameMetrics): RuntimeSnapshot {
    const currentMetrics = metrics ?? this.#lastFrame?.snapshot.metrics ?? {
      tick: this.tick,
      frameMs: 0,
      simulationMs: 0,
      renderMs: 0,
      networkMs: 0,
      streamingMs: 0,
      assetsMs: 0,
      persistenceMs: 0,
      entityCount: this.world.size,
      activeEntities: this.world.values().filter(entity => entity.active).length,
      memoryBytes: estimateMemory(this.world.size, this.assets.stats().residentBytes),
      quality: this.#lastRender.quality,
      backend: this.#lastRender.backend,
      droppedSteps: 0,
    };
    const payload = {
      version: 42 as const,
      mode: this.#mode,
      tick: this.tick,
      revision: this.#revision,
      entityCount: this.world.size,
      activeEntities: this.world.values().filter(entity => entity.active).length,
      commandCount: this.commands.pending().length,
      assetBytes: this.assets.stats().residentBytes,
      render: this.#lastRender,
      metrics: currentMetrics,
    };
    return deepFreeze({
      ...payload,
      checksum: hashValue(payload),
    });
  }

  private runTick(tick: number, deltaSeconds: number): void {
    const pendingInputs = this.input.history();
    const commands = this.commands.drain(tick);
    const boundInputs = pendingInputs.map(frame => Object.freeze({
      ...frame,
      entityId: String((frame as InputFrame & { entityId?: string }).entityId ?? ''),
    })).filter(frame => frame.entityId.length > 0);

    this.observability.increment('commandsAccepted', commands.length);
    this.observability.increment('commandsRejected', 0);

    for (const plugin of this.#plugins) {
      if (plugin.enabled && plugin.beforeTick) {
        void plugin.beforeTick(this.pluginContext(this.snapshot()));
      }
    }

    this.simulation.step(
      tick,
      boundInputs as readonly (InputFrame & { readonly entityId: string })[],
      commands,
    );

    this.emit('runtime.tick', { deltaSeconds });
    const entities = this.world.values();
    if (this.config.network !== 'offline') {
      const states = entities.map(entity => ({
        id: entity.id,
        revision: entity.revision,
        transform: entity.transform,
        velocity: entity.velocity,
        combat: entity.combat,
        flags: entity.active ? 1 : 0,
      }));
      this.network.buildSnapshot(tick, this.#eventSequence, -1, states);
      this.observability.increment('networkPackets');
    }
  }

  private buildCommands(frame: InputFrame, entityId: string): readonly ActionCommand[] {
    const commands: ActionCommand[] = [];
    if (frame.jump) commands.push(this.makeCommand(frame, entityId, 'jump'));
    if (frame.sprint) commands.push(this.makeCommand(frame, entityId, 'sprint'));
    if (frame.guard) commands.push(this.makeCommand(frame, entityId, 'guard'));
    if (frame.attack) commands.push(this.makeCommand(frame, entityId, 'attack'));
    if (frame.dodge) commands.push(this.makeCommand(frame, entityId, 'dodge', { x: frame.move.x, y: frame.move.y }));
    if (Math.abs(frame.move.x) > 0.001 || Math.abs(frame.move.y) > 0.001) {
      commands.push(this.makeCommand(frame, entityId, 'move', { x: frame.move.x, y: frame.move.y }));
    }
    for (const command of commands) {
      if (this.security.validatePayload(command.payload).ok) this.commands.push(command);
    }
    return Object.freeze(commands);
  }

  private makeCommand(
    frame: InputFrame,
    entityId: string,
    kind: ActionCommand['kind'],
    payload: Readonly<Record<string, unknown>> = {},
  ): ActionCommand {
    return Object.freeze({
      id: entityId + ':' + frame.sequence + ':' + kind,
      entityId,
      tick: frame.tick,
      sequence: frame.sequence,
      kind,
      payload,
    });
  }

  private emit(type: RuntimeEvent['type'], data: Readonly<Record<string, unknown>>): void {
    if (this.#events.length >= this.config.policy.maxEventsPerTick) return;
    this.#eventSequence += 1;
    this.#events.push(deepFreeze({
      type,
      tick: this.tick,
      sequence: this.#eventSequence,
      data: Object.freeze({ ...data }),
    }));
  }

  private transition(next: RuntimeMode, reason: string): void {
    const previous = this.#mode;
    this.#mode = next;
    this.emit('runtime.mode', { from: previous, to: next, reason });
  }

  private pluginContext(snapshot: RuntimeSnapshot): RuntimePluginContext {
    return Object.freeze({
      tick: this.tick,
      deltaSeconds: this.clock.fixedStepSeconds,
      mode: this.#mode,
      snapshot,
    });
  }
}

function estimateMemory(entityCount: number, assetBytes: number): number {
  return entityCount * 768 + assetBytes;
}

export function defaultR42Config(): RuntimeConfig {
  return deepFreeze({
    seed: 42,
    network: 'offline',
    quality: 'balanced',
    policy: DEFAULT_POLICY,
    capabilities: DEFAULT_CAPABILITIES,
  });
}

export function normalizeR42Policy(policy: Partial<RuntimePolicy> = {}): RuntimePolicy {
  const budgets: readonly BudgetRule[] = policy.budgets ?? DEFAULT_POLICY.budgets;
  return deepFreeze({
    ...DEFAULT_POLICY,
    ...policy,
    fixedStepSeconds: policy.fixedStepSeconds ?? DEFAULT_POLICY.fixedStepSeconds,
    maxCatchUpSteps: policy.maxCatchUpSteps ?? DEFAULT_POLICY.maxCatchUpSteps,
    maxFrameDeltaSeconds: policy.maxFrameDeltaSeconds ?? DEFAULT_POLICY.maxFrameDeltaSeconds,
    budgets,
  });
}

export function positionOf(runtime: ProductionRuntimeR42, entityId: string): Vec3 | null {
  return runtime.world.get(entityId)?.transform.position ?? null;
}

/**
 * AAPW Runtime Application V18.
 *
 * Composition root that binds topology, input, world residency, asset lifecycle,
 * render policy, persistence and the existing ApplicationKernelV3 behind one
 * deterministic-friendly TypeScript API.
 *
 * Legacy Three.js is intentionally loaded through a typed dynamic boundary.
 * This makes the migration incremental without allowing legacy implementation
 * details to leak into the new runtime contracts.
 */

import {
  DeterministicKernelV18,
  type KernelFrameReportV18,
  type KernelSnapshotV18,
  type KernelTaskContextV18,
  type RuntimeKernelAdapterV18,
  type RuntimeKernelOptionsV18,
} from './runtimeKernelAdapterV18';
import {
  InputPipelineV18,
  type InputCommandV18,
  type InputPhaseV18,
  type RawInputEventV18,
} from './inputPipelineV18';
import {
  WorldLifecycleV18,
  type WorldInterestV18,
  type WorldLifecycleSnapshotV18,
  type WorldZoneDescriptorV18,
} from './worldLifecycleV18';
import {
  AssetLifecycleV18,
  type AssetLifecycleSnapshotV18,
  type AssetManifestEntryV18,
} from './assetLifecycleV18';
import {
  RenderPolicyV18,
  type RenderCapabilitiesV18,
  type RenderObservationV18,
  type RenderPolicyDecisionV18,
} from './renderPolicyV18';
import {
  MemoryPersistenceAdapterV18,
  PersistenceEnvelopeV18,
  type PersistenceAdapterV18,
  type PersistenceLoadResultV18,
  type PersistenceSlotV18,
  createLocalStoragePersistenceAdapterV18,
} from './persistenceEnvelopeV18';
import { RuntimeTopologyV18 } from './runtimeTopologyV18';
import { ObservabilityV18 } from './observabilityV18';
import { RuntimeMigrationRegistryV18, createDefaultMigrationRegistryV18 } from './runtimeMigrationV18';
import { TypedLegacyBoundaryV18 } from './typedLegacyBoundaryV18';

export interface RuntimeApplicationOptionsV18 {
  readonly clock?: () => number;
  readonly kernel?: RuntimeKernelOptionsV18;
  readonly input?: ConstructorParameters<typeof InputPipelineV18>[0];
  readonly world?: ConstructorParameters<typeof WorldLifecycleV18>[0];
  readonly assets?: ConstructorParameters<typeof AssetLifecycleV18>[0];
  readonly render?: ConstructorParameters<typeof RenderPolicyV18>[1];
  readonly renderCapabilities?: RenderCapabilitiesV18;
  readonly persistence?: PersistenceAdapterV18;
  readonly saveSchema?: number;
  readonly saveMaxBytes?: number;
}

export interface RuntimeApplicationSnapshotV18 {
  readonly state: 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'failed';
  readonly frame: number;
  readonly timestampMs: number;
  readonly input: ReturnType<InputPipelineV18['snapshot']>;
  readonly world: WorldLifecycleSnapshotV18;
  readonly assets: AssetLifecycleSnapshotV18;
  readonly render: RenderPolicyDecisionV18;
  readonly topology: ReturnType<RuntimeTopologyV18['snapshot']>;
  readonly kernel: KernelSnapshotV18;
}

export interface RuntimeApplicationDiagnosticsV18 {
  readonly snapshot: RuntimeApplicationSnapshotV18 | null;
  readonly legacyAttached: boolean;
  readonly lastError: string | null;
  readonly lastFrameReport: KernelFrameReportV18 | null;
  readonly counters: Readonly<{
    inputAccepted: number;
    inputRejected: number;
    assetsReady: number;
    worldReady: number;
  }>;
}

export interface LegacyGameModuleV18 {
  readonly initGame3D?: () => void | Promise<void>;
  readonly disposeGame3D?: () => void | Promise<void>;
  readonly shutdownGame3D?: () => void | Promise<void>;
}

export interface RuntimeApplicationSaveV18 {
  readonly schema: number;
  readonly version: 18;
  readonly frame: number;
  readonly savedAtMs: number;
  readonly input: ReturnType<InputPipelineV18['snapshot']>;
  readonly world: WorldLifecycleSnapshotV18;
  readonly metadata: Readonly<Record<string, unknown>>;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function nowDefault(): number {
  return performance.now();
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function stateName(
  state: RuntimeApplication['state'],
): RuntimeApplicationSnapshotV18['state'] {
  return state;
}

export class RuntimeApplication {
  readonly topology: RuntimeTopologyV18;
  readonly kernel: RuntimeKernelAdapterV18;
  readonly input: InputPipelineV18;
  readonly world: WorldLifecycleV18;
  readonly assets: AssetLifecycleV18;
  readonly render: RenderPolicyV18;
  readonly persistence: PersistenceEnvelopeV18<RuntimeApplicationSaveV18>;
  readonly observability: ObservabilityV18;
  readonly migration: RuntimeMigrationRegistryV18;
  readonly legacyBoundary: TypedLegacyBoundaryV18;

  #clock: () => number;
  #state: RuntimeApplicationSnapshotV18['state'] = 'created';
  #legacy: LegacyGameModuleV18 | null = null;
  #snapshot: RuntimeApplicationSnapshotV18 | null = null;
  #lastFrameReport: KernelFrameReportV18 | null = null;
  #lastError: string | null = null;
  #inputAccepted = 0;
  #inputRejected = 0;
  #legacyDisposer: (() => void) | null = null;

  public constructor(options: RuntimeApplicationOptionsV18 = {}) {
    this.#clock = options.clock ?? nowDefault;

    this.topology = new RuntimeTopologyV18({ clock: this.#clock });
    this.kernel = new DeterministicKernelV18({
      fixedStepMs: 1000 / 60,
      maxFrameDeltaMs: 250,
      maxCatchUpSteps: 6,
      frameBudgetMs: 16.67,
      ...(options.kernel ?? {}),
      clock: this.#clock,
    });
    this.input = new InputPipelineV18({
      ...(options.input ?? {}),
      now: this.#clock,
    });
    this.world = new WorldLifecycleV18({
      ...(options.world ?? {}),
      clock: this.#clock,
    });
    this.assets = new AssetLifecycleV18({
      ...(options.assets ?? {}),
      clock: this.#clock,
    });

    const capabilities = options.renderCapabilities ?? {
      webgl2: true,
      webgpu: false,
      maxTextureSize: 4096,
      maxSamples: 4,
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      coarsePointer: false,
      prefersReducedMotion: false,
      saveData: false,
    };

    this.render = new RenderPolicyV18(capabilities, {
      initialTier: 'high',
      ...(options.render ?? {}),
      clock: this.#clock,
    });

    const adapter =
      options.persistence ??
      createLocalStoragePersistenceAdapterV18(
        typeof localStorage === 'undefined' ? null : localStorage,
      );

    this.observability = new ObservabilityV18({ clock: this.#clock, maxEvents: 4096, maxMetrics: 512 });
    this.migration = createDefaultMigrationRegistryV18({ clock: this.#clock });
    this.legacyBoundary = new TypedLegacyBoundaryV18({ clock: this.#clock, requireInit: false });

    this.persistence = new PersistenceEnvelopeV18<RuntimeApplicationSaveV18>({
      schema: Math.max(1, Math.trunc(options.saveSchema ?? 18)),
      maxBytes: options.saveMaxBytes ?? 8 * 1024 * 1024,
      clock: this.#clock,
      adapter,
      validate: (value): value is RuntimeApplicationSaveV18 =>
        this.#validateSave(value),
      migrate: (payload, fromSchema, toSchema) =>
        this.#migrateSave(payload, fromSchema, toSchema),
    });

    this.#registerTopology();
    this.#registerKernelTasks();
  }

  public get state(): RuntimeApplicationSnapshotV18['state'] {
    return this.#state;
  }

  public get frame(): number {
    return this.kernel.frame;
  }

  public get legacyAttached(): boolean {
    return this.#legacy !== null;
  }

  public registerWorldZone(zone: WorldZoneDescriptorV18): void {
    this.world.register(zone);
  }

  public registerAsset(entry: AssetManifestEntryV18): void {
    this.assets.declare(entry);
  }

  public enqueueInput(
    event: RawInputEventV18,
    targetTick = this.kernel.simulationTick,
  ): InputCommandV18 | null {
    const result = this.input.enqueue(event, targetTick);
    if (result) {
      this.#inputAccepted += 1;
    } else {
      this.#inputRejected += 1;
    }
    return result;
  }

  public enqueueKeyboard(
    code: string,
    phase: InputPhaseV18,
    timestampMs = this.#clock(),
  ): InputCommandV18 | null {
    const event = this.input.normalizeKeyboard(code, phase, timestampMs);
    return event ? this.enqueueInput(event) : null;
  }

  public enqueueTouch(
    x: number,
    y: number,
    magnitude = 1,
    timestampMs = this.#clock(),
  ): InputCommandV18 {
    return this.enqueueInput(
      this.input.normalizeTouch(x, y, magnitude, timestampMs),
    ) as InputCommandV18;
  }

  public async loadAsset(id: string): Promise<ReturnType<AssetLifecycleV18['snapshot']>['records'][number]> {
    await this.assets.load(id);
    const result = this.assets.get(id);
    if (!result) {
      throw new Error(`Asset disappeared after load: ${id}`);
    }
    return result;
  }

  public async start(): Promise<void> {
    if (this.#state === 'running') return;
    if (this.#state === 'stopped') {
      throw new Error('Runtime application cannot restart after stop; create a new application instance.');
    }
    if (this.#state !== 'created') {
      throw new Error(`Runtime application cannot start from ${this.#state}`);
    }

    this.#state = 'starting';
    this.#lastError = null;

    try {
      this.topology.validate();
      await this.topology.start();
      await this.kernel.start();
      this.#state = 'running';
    } catch (error) {
      this.#state = 'failed';
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public pause(): void {
    if (this.#state !== 'running') return;
    this.kernel.pause();
    this.#state = 'paused';
  }

  public resume(): void {
    if (this.#state !== 'paused') return;
    this.kernel.resume();
    this.#state = 'running';
  }

  public async tick(nowMs = this.#clock()): Promise<RuntimeApplicationSnapshotV18> {
    if (this.#state === 'created') {
      await this.start();
    }

    if (this.#state === 'paused') {
      return this.#publish(nowMs, this.#lastFrameReport);
    }

    if (this.#state !== 'running') {
      return this.#publish(nowMs, this.#lastFrameReport);
    }

    try {
      this.input.setTick(this.kernel.simulationTick);
      this.topology.setFrame(this.kernel.frame);

      const report = await this.kernel.tick(nowMs);
      this.#lastFrameReport = report ?? null;
      return this.#publish(nowMs, report ?? null);
    } catch (error) {
      this.#state = 'failed';
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.#state === 'stopped') {
      return;
    }
    if (this.#state === 'created') {
      await this.#legacyDisposer?.();
      this.#legacyDisposer = null;
      this.#legacy = null;
      this.#state = 'stopped';
      return;
    }

    this.#state = 'stopping';

    try {
      await this.kernel.stop();
      await this.topology.stop();
      await this.#legacyDisposer?.();
      this.#legacyDisposer = null;
      this.#legacy = null;
      this.#state = 'stopped';
    } catch (error) {
      this.#state = 'failed';
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public async attachLegacyGame(options: {
    readonly autoInitialize?: boolean;
    readonly moduleLoader?: () => Promise<LegacyGameModuleV18>;
  } = {}): Promise<void> {
    if (this.#legacy) return;

    const loader =
      options.moduleLoader ??
      (async () => {
        const legacySpecifier: string = '../game3d.js';
        const module = (await import(legacySpecifier)) as unknown as LegacyGameModuleV18;
        return module;
      });

    const module = await loader();
    const legacyContract: import('./typedLegacyBoundaryV18').LegacyBoundaryModuleV18 = {
      id: 'game3d-legacy',
      ...(module.initGame3D ? { init: module.initGame3D } : {}),
      ...(module.disposeGame3D ? { dispose: module.disposeGame3D } : {}),
      ...(module.shutdownGame3D ? { shutdown: module.shutdownGame3D } : {}),
    };
    this.legacyBoundary.attach(legacyContract);
    this.#legacy = module;

    if (options.autoInitialize ?? true) {
      if (typeof module.initGame3D !== 'function') {
        throw new Error('LEGACY_GAME_INIT_MISSING');
      }
      await this.legacyBoundary.initialize();
      this.observability.event({ name: 'runtime.legacy.initialized', severity: 'info', frame: this.kernel.frame, attributes: { module: 'game3d-legacy' } });
    }

    this.#legacyDisposer = async () => {
      await this.legacyBoundary.dispose();
    };
  }

  public inputFromKeyboard(
    code: string,
    phase: InputPhaseV18,
  ): InputCommandV18 | null {
    return this.enqueueKeyboard(code, phase);
  }

  public inputFromPointer(
    button: number,
    phase: InputPhaseV18,
  ): InputCommandV18 | null {
    const event = this.input.normalizePointer(button, phase, this.#clock());
    return event ? this.enqueueInput(event) : null;
  }

  public worldInterest(
    x: number,
    z: number,
    velocityX = 0,
    velocityZ = 0,
    horizonSeconds = 2,
  ): WorldInterestV18 {
    return freeze({
      x: finite(x, 0),
      z: finite(z, 0),
      velocityX: finite(velocityX, 0),
      velocityZ: finite(velocityZ, 0),
      horizonSeconds: Math.max(0, finite(horizonSeconds, 2)),
      prefetchRadiusMeters: 100,
    });
  }

  public planWorld(interest: WorldInterestV18): ReturnType<WorldLifecycleV18['plan']> {
    return this.world.plan(interest, this.kernel.frame + 1);
  }

  public renderObservationFromFrame(
    frameMs: number,
    cpuMs = frameMs * 0.45,
    gpuMs = frameMs * 0.4,
  ): RenderObservationV18 {
    const viewportWidth =
      typeof window === 'undefined' ? 1920 : Math.max(1, window.innerWidth);
    const viewportHeight =
      typeof window === 'undefined' ? 1080 : Math.max(1, window.innerHeight);

    const world = this.world.snapshot();

    return freeze({
      frameMs: finite(frameMs, 16.67),
      cpuMs: finite(cpuMs, 7),
      gpuMs: finite(gpuMs, 6),
      memoryPressure: Math.min(2, world.pressure),
      thermalPressure: 0,
      drawCalls: Math.min(10000, world.zones.length * 12),
      visibleObjects: Math.min(100000, world.zones.length * 100),
      viewportWidth,
      viewportHeight,
      timestampMs: this.#clock(),
    });
  }

  public async save(
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<string> {
    const payload: RuntimeApplicationSaveV18 = freeze({
      schema: this.persistence.snapshot().schema,
      version: 18,
      frame: this.kernel.frame,
      savedAtMs: this.#clock(),
      input: this.input.snapshot(),
      world: this.world.snapshot(),
      metadata: freeze({ ...metadata }),
    });

    return this.persistence.encode(payload, this.kernel.simulationTick);
  }

  public async saveToSlot(
    slot: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<PersistenceSlotV18> {
    const payload: RuntimeApplicationSaveV18 = freeze({
      schema: this.persistence.snapshot().schema,
      version: 18,
      frame: this.kernel.frame,
      savedAtMs: this.#clock(),
      input: this.input.snapshot(),
      world: this.world.snapshot(),
      metadata: freeze({ ...metadata }),
    });
    return this.persistence.save(slot, payload, this.kernel.simulationTick);
  }

  public async loadFromSlot(
    slot: string,
  ): Promise<PersistenceLoadResultV18<RuntimeApplicationSaveV18>> {
    const result = await this.persistence.load(slot);
    if (result.ok && result.payload) {
      this.#restoreFromPayload(result.payload);
    }
    return result;
  }

  public diagnostics(): RuntimeApplicationDiagnosticsV18 {
    const counters = Object.freeze({
      inputAccepted: this.#inputAccepted,
      inputRejected: this.#inputRejected,
      assetsReady: this.assets.snapshot().residentCount,
      worldReady: this.world.snapshot().zones.filter((zone) => zone.state === 'ready').length,
    });

    return freeze({
      snapshot: this.#snapshot,
      legacyAttached: this.legacyAttached,
      lastError: this.#lastError,
      lastFrameReport: this.#lastFrameReport,
      counters,
    });
  }

  #registerTopology(): void {
    this.topology.register({
      id: 'input',
      version: 18,
      scope: 'session',
      capabilities: ['input'],
      critical: true,
      value: this.input,
    });

    this.topology.register({
      id: 'world',
      version: 18,
      scope: 'session',
      capabilities: ['world'],
      dependencies: ['input'],
      critical: true,
      value: this.world,
    });

    this.topology.register({
      id: 'assets',
      version: 18,
      scope: 'session',
      capabilities: ['assets'],
      critical: false,
      value: this.assets,
    });

    this.topology.register({
      id: 'render',
      version: 18,
      scope: 'session',
      capabilities: ['render'],
      dependencies: ['world', 'assets'],
      critical: true,
      value: this.render,
    });

    this.topology.register({
      id: 'persistence',
      version: 18,
      scope: 'singleton',
      capabilities: ['persistence'],
      dependencies: ['world'],
      critical: false,
      value: this.persistence,
    });

    this.topology.register({
      id: 'observability',
      version: 18,
      scope: 'session',
      capabilities: ['telemetry'],
      dependencies: ['input', 'world'],
      critical: false,
      value: this.observability,
    });

    this.topology.register({
      id: 'application',
      version: 18,
      scope: 'singleton',
      capabilities: ['diagnostics', 'clock'],
      dependencies: ['input', 'world', 'assets', 'render', 'persistence', 'observability'],
      critical: true,
      value: this,
      health: () => ({
        state: this.#state === 'running' ? 'ready' : 'degraded',
        score: this.#state === 'failed' ? 0 : this.#state === 'running' ? 1 : 0.65,
        details: {
          frame: this.kernel.frame,
          legacyAttached: this.legacyAttached,
        },
      }),
    });
  }

  #registerKernelTasks(): void {
    this.kernel.registerTask({
      id: 'v18.telemetry.frame-start',
      phase: 'pre-update',
      priority: 110,
      budgetMs: 0.15,
      run: (context) => {
        this.observability.counter('runtime.frames', 1, context.frame, { state: this.#state });
      },
      critical: false,
    });

    this.kernel.registerTask({
      id: 'v18.input.drain',
      phase: 'pre-update',
      priority: 100,
      budgetMs: 0.75,
      run: (context) => this.observability.withSpan('runtime.input.drain', context.frame, () => this.#runInputTask(context), { phase: context.phase }),
      critical: true,
    });

    this.kernel.registerTask({
      id: 'v18.world.plan',
      phase: 'simulation',
      priority: 90,
      budgetMs: 1.25,
      run: (context) => this.observability.withSpan('runtime.world.snapshot', context.frame, () => {
        this.world.snapshot();
      }),
      critical: true,
    });

    this.kernel.registerTask({
      id: 'v18.asset.sweep',
      phase: 'simulation',
      priority: 50,
      budgetMs: 0.75,
      run: (context) => this.observability.withSpan('runtime.assets.sweep', context.frame, () => {
        this.assets.sweep(this.#clock());
      }),
    });

    this.kernel.registerTask({
      id: 'v18.render.observe',
      phase: 'render',
      priority: 80,
      budgetMs: 0.75,
      run: (context) => this.observability.withSpan('runtime.render.observe', context.frame, () => {
        const frame = this.#lastFrameReport?.durationMs ?? 16.67;
        this.render.observe(this.renderObservationFromFrame(frame));
        this.observability.gauge('runtime.render.pressure', this.render.diagnostics().lastDecision?.pressure ?? 0, context.frame);
      }),
    });

    this.kernel.registerTask({
      id: 'v18.publish',
      phase: 'present',
      priority: 10,
      budgetMs: 0.5,
      run: (context) => this.observability.withSpan('runtime.snapshot.publish', context.frame, () => {
        this.#snapshot = this.#buildSnapshot(this.#clock());
      }),
    });
  }

  #runInputTask(context: KernelTaskContextV18): void {
    this.input.setTick(context.simulationTick);
    const commands = this.input.drain();

    for (const command of commands) {
      this.#applySemanticCommand(command);
    }
  }

  #applySemanticCommand(command: InputCommandV18): void {
    if (command.action === 'map' && command.phase === 'pressed') {
      return;
    }

    if (command.action === 'camera-reset' && command.phase === 'pressed') {
      return;
    }

    if (command.action === 'jump' && command.phase === 'pressed') {
      return;
    }

    if (command.phase === 'axis') {
      return;
    }
  }

  #publish(nowMs: number, report: KernelFrameReportV18 | null): RuntimeApplicationSnapshotV18 {
    this.#snapshot = this.#buildSnapshot(nowMs, report);
    return this.#snapshot;
  }

  #buildSnapshot(
    timestampMs: number,
    report: KernelFrameReportV18 | null = this.#lastFrameReport,
  ): RuntimeApplicationSnapshotV18 {
    const render =
      this.render.diagnostics().lastDecision ??
      this.render.forceTier('balanced', 'snapshot-default');

    return freeze({
      state: stateName(this.#state),
      frame: this.kernel.frame,
      timestampMs,
      input: this.input.snapshot(),
      world: this.world.snapshot(),
      assets: this.assets.snapshot(),
      render,
      topology: this.topology.snapshot(),
      kernel: this.kernel.snapshot(),
    });
  }

  #validateSave(value: unknown): value is RuntimeApplicationSaveV18 {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;

    return (
      record.version === 18 &&
      typeof record.schema === 'number' &&
      typeof record.frame === 'number' &&
      typeof record.savedAtMs === 'number' &&
      Boolean(record.input) &&
      Boolean(record.world) &&
      typeof record.metadata === 'object' &&
      record.metadata !== null
    );
  }

  #migrateSave(
    payload: unknown,
    fromSchema: number,
    toSchema: number,
  ): RuntimeApplicationSaveV18 {
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('Cannot migrate invalid runtime save.');
    }

    const record = payload as Record<string, unknown>;
    const frame = Number.isFinite(record.frame) ? Number(record.frame) : 0;

    return freeze({
      schema: toSchema,
      version: 18,
      frame: Math.max(0, Math.trunc(frame)),
      savedAtMs: Number.isFinite(record.savedAtMs)
        ? Number(record.savedAtMs)
        : this.#clock(),
      input:
        record.input && typeof record.input === 'object'
          ? record.input as RuntimeApplicationSaveV18['input']
          : this.input.snapshot(),
      world:
        record.world && typeof record.world === 'object'
          ? record.world as RuntimeApplicationSaveV18['world']
          : this.world.snapshot(),
      metadata: freeze({
        migratedFromSchema: fromSchema,
        migrationTarget: toSchema,
        ...(record.metadata && typeof record.metadata === 'object'
          ? record.metadata as Record<string, unknown>
          : {}),
      }),
    });
  }

  #restoreFromPayload(payload: RuntimeApplicationSaveV18): void {
    this.input.clear();

    for (const zone of payload.world.zones) {
      if (!this.world.snapshot().zones.some((existing) => existing.id === zone.id)) {
        this.world.register(zone);
      }
      this.world.setState(zone.id, zone.state, zone.failure);
    }

    this.topology.setFrame(payload.frame);
  }

  public createMemoryPersistence(): MemoryPersistenceAdapterV18 {
    return new MemoryPersistenceAdapterV18();
  }
}

import type {
  CameraState,
  FrameExecutionContext,
  FrameId,
  PlatformError,
  PressureState,
  QualityTier,
  RenderBackend,
  RuntimeSnapshot,
  SchedulerBudget,
  TaskAffinity,
  TaskPriority,
  UnixMillis,
  Vec3,
} from './types';
import { FixedStepClock, clamp01, createSeededId, hash32, quantize, sample01 } from './deterministic';
import { Diagnostics } from './diagnostics';
import { FrameGraphBuilder, type FrameGraphPlan } from './frameGraph';
import { TypedEventBus } from './eventBus';
import { InputRouter, type InputRouterOptions } from './inputRouter';
import { AdaptiveQualityController } from './qualityController';
import { RenderFrameBuilder, type DrawItem, type RenderFramePacket } from './renderPacket';
import { ResourceRegistry, type ResourceLoader } from './resourceRegistry';
import { RuntimeScheduler } from './runtimeScheduler';
import { calculatePressure, RollingTelemetry } from './telemetry';
import { SnapshotCodec, type NetworkEntityState, type WorldSnapshot } from './networkSnapshot';
import { StreamingPlanner, type StreamPlan } from './streamingPlanner';
import { CommandJournal, type Command, type CommandKind } from './commandJournal';
import { MotionStateMachine, type MotionInput, type MotionTransition } from './motionState';
import { WorldClock, createWindField, type WeatherKind } from './worldSimulation';
import { RUNTIME_PROFILES, selectRuntimeProfile, type RuntimeEnvironmentHint, type RuntimeProfile } from './runtimeConfig';
import { encodeChunk, decodeChunk } from './serialization';
import { validateManifest, type AssetManifestEntry } from './assetPolicy';

export interface KernelFrameInput {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs?: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
  readonly memoryPressure?: number;
  readonly thermalPressure?: number;
  readonly camera: CameraState;
}

export interface KernelHooks {
  readonly beforeSimulation?: (context: FrameExecutionContext) => void | Promise<void>;
  readonly afterSimulation?: (context: FrameExecutionContext) => void | Promise<void>;
  readonly beforePresentation?: (snapshot: RuntimeSnapshot) => void | Promise<void>;
  readonly afterPresentation?: (packet: RenderFramePacket) => void | Promise<void>;
  readonly onStreamPlan?: (plan: StreamPlan) => void | Promise<void>;
  readonly onQualityChange?: (previous: QualityTier, next: QualityTier) => void | Promise<void>;
  readonly onError?: (error: PlatformError) => void | Promise<void>;
}

export interface KernelOptions {
  readonly seed?: number;
  readonly profile?: RuntimeProfile;
  readonly environment?: RuntimeEnvironmentHint;
  readonly fixedStepMs?: number;
  readonly input?: InputRouterOptions;
  readonly maxDiagnostics?: number;
  readonly maxTelemetrySamples?: number;
  readonly maxResourcesBytes?: number;
  readonly maxEntities?: number;
  readonly streamLoadRadius?: number;
  readonly streamUnloadRadius?: number;
  readonly streamLoadsPerFrame?: number;
  readonly streamUnloadsPerFrame?: number;
  readonly hooks?: KernelHooks;
}

export interface KernelSubsystemHealth {
  readonly scheduler: boolean;
  readonly input: boolean;
  readonly resources: boolean;
  readonly streaming: boolean;
  readonly commands: boolean;
  readonly snapshots: boolean;
  readonly rendering: boolean;
  readonly diagnostics: boolean;
}

export interface KernelFrameResult {
  readonly context: FrameExecutionContext;
  readonly snapshot: RuntimeSnapshot;
  readonly packet: RenderFramePacket;
  readonly streamPlan: StreamPlan;
  readonly weather: WeatherKind;
  readonly motion: readonly MotionTransition[];
  readonly graph: FrameGraphPlan | null;
}

const DEFAULT_CAMERA: CameraState = {
  position: { x: 0, y: 2, z: 5 },
  target: { x: 0, y: 1, z: 0 },
  fov: 60,
  near: 0.1,
  far: 5_000,
  viewportWidth: 1,
  viewportHeight: 1,
  dpr: 1,
};

const DEFAULT_PRESSURE: PressureState = {
  cpu: 0,
  gpu: 0,
  frame: 0,
  memory: 0,
  thermal: 0,
  combined: 0,
};

function asFrame(value: number): FrameId {
  return Math.max(0, Math.trunc(value)) as FrameId;
}

function asMillis(value: number): UnixMillis {
  return Math.max(0, Math.trunc(value)) as UnixMillis;
}

function defaultPriority(distance: number): TaskPriority {
  if (distance < 2) return 4;
  if (distance < 5) return 3;
  if (distance < 9) return 2;
  return 1;
}

/**
 * High-level platform kernel for the browser game.
 *
 * The kernel intentionally owns only deterministic orchestration. Three.js scene ownership remains
 * outside this class. This gives the legacy engine a single typed control surface while keeping
 * rendering, gameplay, persistence and streaming independently replaceable.
 */
export class RuntimeKernel {
  readonly seed: number;
  readonly profile: RuntimeProfile;
  readonly clock: FixedStepClock;
  readonly diagnostics: Diagnostics;
  readonly telemetry: RollingTelemetry;
  readonly scheduler: RuntimeScheduler;
  readonly input: InputRouter;
  readonly quality: AdaptiveQualityController;
  readonly resources: ResourceRegistry<unknown>;
  readonly streaming: StreamingPlanner;
  readonly snapshots: SnapshotCodec;
  readonly worldClock: WorldClock;
  readonly wind = createWindField(0x5745535445524f53);
  readonly commands: CommandJournal<Record<string, unknown>>;
  readonly events: TypedEventBus<RuntimeKernelEvents>;

  #hooks: KernelHooks;
  #frame = 0;
  #running = false;
  #graph: FrameGraphBuilder | null = null;
  #graphPlan: FrameGraphPlan | null = null;
  #motionMachines = new Map<string, MotionStateMachine>();
  #entities = new Map<string, NetworkEntityState>();
  #maxEntities: number;

  constructor(options: KernelOptions = {}) {
    this.seed = options.seed ?? 0x5745535445524f53;
    this.profile = options.profile ?? selectRuntimeProfile(options.environment);
    this.clock = new FixedStepClock({ stepMs: options.fixedStepMs ?? 1000 / 60 });
    this.diagnostics = new Diagnostics({ capacity: options.maxDiagnostics ?? this.profile.limits.maxDiagnostics });
    this.telemetry = new RollingTelemetry({ maxSamples: options.maxTelemetrySamples ?? this.profile.limits.maxTelemetrySamples, now: () => Number(this.clock.now()) });
    this.scheduler = new RuntimeScheduler({ maxQueueSize: this.profile.budgets.maxTasksPerFrame * 64 });
    this.input = new InputRouter({ ...options.input, clock: () => this.clock.now() });
    this.quality = new AdaptiveQualityController({
      initial: this.profile.defaultQuality,
      min: 'minimal',
      max: 'ultra',
      dwellFrames: 30,
      smoothing: 0.16,
    });
    this.resources = new ResourceRegistry({ budgetBytes: options.maxResourcesBytes ?? this.profile.limits.maxResourceBytes, now: () => this.clock.now() });
    this.streaming = new StreamingPlanner({
      loadRadius: options.streamLoadRadius ?? (this.profile.name === 'desktop' ? 8 : 5),
      unloadRadius: options.streamUnloadRadius ?? (this.profile.name === 'desktop' ? 11 : 7),
      maxLoadsPerFrame: options.streamLoadsPerFrame ?? this.profile.limits.maxStreamLoadsPerFrame,
      maxUnloadsPerFrame: options.streamUnloadsPerFrame ?? this.profile.limits.maxStreamUnloadsPerFrame,
      seed: this.seed,
    });
    this.snapshots = new SnapshotCodec(32);
    this.worldClock = new WorldClock({ seed: this.seed, secondsPerDay: this.profile.name === 'low-end' ? 900 : 1200 });
    this.commands = new CommandJournal<Record<string, unknown>>();
    this.events = new TypedEventBus<RuntimeKernelEvents>({ maxListeners: 256 });
    this.#hooks = options.hooks ?? {};
    this.#maxEntities = options.maxEntities ?? this.profile.limits.maxEntities;
    this.#registerDefaultCommands();
  }

  start(): void {
    this.#running = true;
    this.#frame = 0;
    this.clock.reset();
    this.diagnostics.info('KERNEL_STARTED', 'Runtime kernel started', 'kernel', {
      profile: this.profile.name,
      backend: this.profile.preferredBackend,
    });
    this.events.emit('kernel:started', { profile: this.profile.name, backend: this.profile.preferredBackend });
  }

  stop(): void {
    this.#running = false;
    this.input.clear();
    this.scheduler.cancel('__kernel__');
    this.diagnostics.info('KERNEL_STOPPED', 'Runtime kernel stopped', 'kernel');
    this.events.emit('kernel:stopped', { frame: asFrame(this.#frame) });
  }

  get running(): boolean {
    return this.#running;
  }

  registerResourceLoader(kind: AssetManifestEntry['kind'], loader: ResourceLoader<unknown>): void {
    this.resources.registerLoader(kind, loader);
  }

  registerAssetManifest(entries: readonly AssetManifestEntry[]): void {
    const result = validateManifest(entries);
    if (!result.ok) {
      this.#recordError(result.error);
      return;
    }
    for (const entry of entries) this.resources.register(entry);
    this.events.emit('assets:registered', { count: result.value });
  }

  registerMotion(entityId: string): MotionStateMachine {
    let machine = this.#motionMachines.get(entityId);
    if (!machine) {
      machine = new MotionStateMachine(entityId as MotionStateMachineEntityId);
      this.#motionMachines.set(entityId, machine);
    }
    return machine;
  }

  upsertNetworkEntity(entity: NetworkEntityState): boolean {
    if (!entity.id) return false;
    if (!this.#entities.has(entity.id) && this.#entities.size >= this.#maxEntities) {
      this.diagnostics.warning('ENTITY_CAP', 'Entity cap reached', 'ecs', { maxEntities: this.#maxEntities });
      return false;
    }
    this.#entities.set(entity.id, structuredClone(entity));
    return true;
  }

  removeNetworkEntity(id: string): boolean {
    this.#motionMachines.delete(id);
    return this.#entities.delete(id);
  }

  enqueueTask<T>(task: {
    readonly id: string;
    readonly priority: TaskPriority;
    readonly affinity: TaskAffinity;
    readonly estimatedMs: number;
    readonly run: (context: { readonly frame: FrameId; readonly now: UnixMillis; readonly signal: AbortSignal; readonly budget: SchedulerBudget }) => T | Promise<T>;
  }): boolean {
    return this.scheduler.enqueue(task);
  }

  buildFrameGraph(setup: (builder: FrameGraphBuilder) => void): FrameGraphPlan | null {
    const builder = new FrameGraphBuilder();
    try {
      setup(builder);
      const result = builder.compile();
      if (!result.ok) {
        this.#recordError(result.error);
        return null;
      }
      this.#graph = builder;
      this.#graphPlan = result.value;
      this.events.emit('render:graph-compiled', {
        passCount: result.value.passes.length,
        peakTransientBytes: result.value.peakTransientBytes,
      });
      return result.value;
    } catch (error) {
      this.#recordError(this.diagnostics.capture(error, 'frame-graph', 'GRAPH_BUILD_FAILED'));
      return null;
    }
  }

  renderPacket(frame: KernelFrameInput, draws: readonly DrawItem[] = []): RenderFramePacket {
    const pressure = calculatePressure({
      frameMs: Math.max(0, frame.frameMs),
      cpuMs: Math.max(0, frame.cpuMs),
      gpuMs: frame.gpuMs,
      memoryPressure: clamp01(frame.memoryPressure ?? 0),
      thermalPressure: clamp01(frame.thermalPressure ?? 0),
    });
    const builder = new RenderFrameBuilder()
      .reset(asFrame(this.#frame))
      .backend(this.profile.preferredBackend as RenderBackend)
      .quality(this.quality.tier, this.quality.decision.renderScale)
      .camera(structuredClone(frame.camera ?? DEFAULT_CAMERA))
      .pressure(pressure);
    for (const draw of draws) builder.add(draw);
    return builder.build();
  }

  async tick(input: KernelFrameInput): Promise<KernelFrameResult> {
    if (!this.#running) this.start();
    const deltaMs = Math.min(Math.max(0, input.frameMs), 250);
    this.clock.advance(deltaMs);
    this.#frame += 1;

    const pressure = calculatePressure({
      frameMs: deltaMs,
      cpuMs: input.cpuMs,
      gpuMs: input.gpuMs,
      memoryPressure: input.memoryPressure ?? 0,
      thermalPressure: input.thermalPressure ?? 0,
    });
    const previousQuality = this.quality.tier;
    const nextQuality = this.quality.observe(pressure.combined);
    if (previousQuality !== nextQuality) {
      this.events.emit('render:quality-changed', { previous: previousQuality, next: nextQuality, pressure: pressure.combined });
      await this.#hooks.onQualityChange?.(previousQuality, nextQuality);
    }

    const context: FrameExecutionContext = {
      frame: asFrame(this.#frame),
      deltaSeconds: deltaMs / 1000,
      absoluteSeconds: Number(this.clock.now()) / 1000,
      camera: structuredClone(input.camera ?? DEFAULT_CAMERA),
      quality: nextQuality,
      pressure,
    };
    await this.#hooks.beforeSimulation?.(context);

    const scheduled = await this.scheduler.runFrame({
      now: this.clock.now(),
      frame: context.frame,
      signal: new AbortController().signal,
      budget: {
        cpuMs: this.profile.budgets.simulationMs,
        gpuMs: this.profile.budgets.renderingMs,
        maxTasks: this.profile.budgets.maxTasksPerFrame,
      },
    });
    this.telemetry.push({
      frame: context.frame,
      frameMs: deltaMs,
      cpuMs: input.cpuMs,
      gpuMs: input.gpuMs,
      drawCalls: input.drawCalls,
      triangles: input.triangles,
      visibleObjects: input.visibleObjects,
      textureBytes: input.textureBytes,
      memoryPressure: pressure.memory,
      thermalPressure: pressure.thermal,
    });

    await this.#hooks.afterSimulation?.(context);

    const streamPlan = this.streaming.plan({ x: input.camera.position.x, y: input.camera.position.z });
    await this.#hooks.onStreamPlan?.(streamPlan);
    this.events.emit('world:stream-plan', {
      load: streamPlan.load.map((cell) => cell.key),
      retain: streamPlan.retain.map((cell) => cell.key),
      unload: streamPlan.unload.map((cell) => cell.key),
    });

    const world = this.worldClock.update(context.deltaSeconds);
    const motion: MotionTransition[] = [];
    for (const [entityId, machine] of this.#motionMachines) {
      const entity = this.#entities.get(entityId);
      if (!entity) continue;
      const speed = Math.hypot(entity.velocity.x, entity.velocity.z);
      const motionInput: MotionInput = {
        speed,
        verticalSpeed: entity.velocity.y,
        grounded: entity.position.y <= 0.05,
        attacking: Boolean(entity.flags & 2),
        damaged: Boolean(entity.flags & 4),
        dead: Boolean(entity.flags & 8),
      };
      const transition = machine.step(motionInput);
      if (transition) motion.push(transition);
    }

    const snapshot = this.#snapshot(context.frame);
    await this.#hooks.beforePresentation?.(snapshot);
    const packet = this.renderPacket(input);
    await this.#hooks.afterPresentation?.(packet);
    this.events.emit('runtime:frame', { frame: context.frame, quality: nextQuality, weather: world.weather, scheduled: scheduled.length });

    return {
      context,
      snapshot,
      packet,
      streamPlan,
      weather: world.weather,
      motion,
      graph: this.#graphPlan,
    };
  }

  createSnapshot(): WorldSnapshot {
    return this.#snapshot(asFrame(this.#frame));
  }

  applySnapshot(snapshot: WorldSnapshot): void {
    this.#entities.clear();
    for (const entity of snapshot.entities) this.upsertNetworkEntity(entity);
    this.events.emit('network:snapshot-applied', { tick: snapshot.tick, entityCount: snapshot.entities.length, digest: snapshot.digest });
  }

  deltaFromBaseline(current: WorldSnapshot, baselineTick: number | null) {
    return this.snapshots.delta(current, baselineTick);
  }

  encodeWorldChunk(payload: unknown): Uint8Array {
    return encodeChunk('world', { seed: this.seed, frame: this.#frame, payload });
  }

  decodeWorldChunk<T>(bytes: Uint8Array): T | null {
    const result = decodeChunk<T & { seed: number; frame: number }>(bytes, 'world');
    return result.ok ? result.value.payload : null;
  }

  appendCommand<T>(kind: CommandKind, payload: T, tick = this.#frame): Command<T> {
    return this.commands.append({
      id: createSeededId('cmd', this.seed, hash32(`${tick}:${String(kind)}:${JSON.stringify(payload)}`)),
      tick,
      kind,
      payload,
    });
  }

  diagnosticsSnapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      profile: this.profile.name,
      backend: this.profile.preferredBackend,
      seed: this.seed,
      running: this.running,
      frame: this.#frame,
      quality: this.quality.tier,
      pressure: this.telemetry.count() > 0 ? this.telemetry.summary() : DEFAULT_PRESSURE,
      scheduler: { size: this.scheduler.size() },
      resources: this.resources.stats(),
      streaming: { loaded: this.streaming.loadedKeys().length },
      entities: this.#entities.size,
      motionMachines: this.#motionMachines.size,
      diagnostics: this.diagnostics.health(),
    });
  }

  health(): KernelSubsystemHealth {
    const health = this.diagnostics.health();
    return {
      scheduler: this.scheduler.size() <= this.profile.budgets.maxTasksPerFrame * 64,
      input: true,
      resources: this.resources.stats().residentBytes <= this.profile.limits.maxResourceBytes,
      streaming: this.streaming.loadedKeys().length < 100_000,
      commands: this.commands.commands().length < 500_000,
      snapshots: true,
      rendering: this.#graphPlan !== null || this.profile.features.frameGraph === false,
      diagnostics: health.score >= 50 || health.errors === 0,
    };
  }

  deterministicProbe(sampleCount = 32): ReadonlyArray<number> {
    const values: number[] = [];
    const count = Math.max(1, Math.min(1024, Math.trunc(sampleCount)));
    for (let index = 0; index < count; index += 1) values.push(quantize(sample01(this.seed, index), 1e-6));
    return Object.freeze(values);
  }

  #snapshot(frame: FrameId): WorldSnapshot {
    const entities = [...this.#entities.values()].sort((a, b) => a.id.localeCompare(b.id));
    return this.snapshots.encode(Number(frame), entities, null);
  }

  #recordError(error: PlatformError): void {
    this.diagnostics.error(error.code, error.message, 'kernel', { cause: String(error.cause ?? '') });
    this.events.emit('kernel:error', error);
    void this.#hooks.onError?.(error);
  }

  #registerDefaultCommands(): void {
    this.commands.register<{ entityId: string; position: Vec3 }>('move', (state, payload) => ({
      ...state,
      [`position:${payload.entityId}`]: structuredClone(payload.position),
    }));
    this.commands.register<{ entityId: string }>('despawn', (state, payload) => {
      const next = { ...state };
      delete next[`position:${payload.entityId}`];
      return next;
    });
    this.commands.register<{ tier: QualityTier }>('set-quality', (state, payload) => ({ ...state, quality: payload.tier }));
    this.commands.register<{ note: string }>('custom', (state, payload) => ({ ...state, [`note:${this.#frame}`]: payload.note }));
  }
}

type MotionStateMachineEntityId = string & { readonly __motionEntityBrand: unique symbol };

export interface RuntimeKernelEvents {
  readonly 'kernel:started': { readonly profile: RuntimeProfile['name']; readonly backend: RenderBackend };
  readonly 'kernel:stopped': { readonly frame: FrameId };
  readonly 'kernel:error': PlatformError;
  readonly 'assets:registered': { readonly count: number };
  readonly 'render:quality-changed': { readonly previous: QualityTier; readonly next: QualityTier; readonly pressure: number };
  readonly 'render:graph-compiled': { readonly passCount: number; readonly peakTransientBytes: number };
  readonly 'world:stream-plan': { readonly load: readonly string[]; readonly retain: readonly string[]; readonly unload: readonly string[] };
  readonly 'network:snapshot-applied': { readonly tick: number; readonly entityCount: number; readonly digest: string };
  readonly 'runtime:frame': { readonly frame: FrameId; readonly quality: QualityTier; readonly weather: WeatherKind; readonly scheduled: number };
}

export function createDesktopKernel(hooks?: KernelHooks): RuntimeKernel {
  return new RuntimeKernel({ profile: RUNTIME_PROFILES.desktop, hooks });
}

export function createMobileKernel(hooks?: KernelHooks): RuntimeKernel {
  return new RuntimeKernel({ profile: RUNTIME_PROFILES.mobile, hooks });
}

export function createLowEndKernel(hooks?: KernelHooks): RuntimeKernel {
  return new RuntimeKernel({ profile: RUNTIME_PROFILES['low-end'], hooks });
}

export function createHeadlessKernel(hooks?: KernelHooks): RuntimeKernel {
  return new RuntimeKernel({ profile: RUNTIME_PROFILES.headless, hooks });
}

import { createNextRuntime, type NextRuntime } from '../runtime.ts';
import { InputAggregator, InputButton } from '../input.ts';
import { createDefaultWorkerPool, type LocalWorkerPool } from '../worker.ts';
import { ThirdPersonCameraSolver, type CameraState } from '../camera.ts';
import { AudioRouter, type AudioVoiceDecision } from '../audio.ts';
import { tick, type FrameBudget, type InputFrame, type Tick, type Vec3 } from '../types.ts';
import { budgetForTier, resolveInitialTier, type QualityTier, type RenderCapabilities } from '../render.ts';
import { ProductionEntityRegistry } from './entityRegistry.ts';
import { ProductionNetworkRuntime } from './networkRuntime.ts';
import { ProductionPersistenceRuntime, MemoryPersistenceStore, type PersistenceStore } from './persistenceRuntime.ts';
import { ProductionObservability, buildInitialHealth } from './observability.ts';
import { ProductionLifecycleSupervisor, createLifecycleIdentity } from './lifecycle.ts';
import { TypedRuntimeEventRouter } from './eventRouter.ts';
import {
  inputButtons,
  isInputFrameSafe,
  normalizeBudget,
  normalizeRuntimeCapabilities,
  normalizeRuntimeIdentity,
  type NetworkPeerState,
  type ProductionEntitySeed,
  type ProductionFrameInput,
  type ProductionFrameResult,
  type ProductionRuntimeOptions,
  type RuntimeClock,
  type RuntimeHealthReport,
  type RuntimeIdentity,
  type RuntimeMode,
  type ProductionSnapshot,
} from './contracts.ts';
import { ProductionRenderPlanner } from './renderRuntime.ts';

export interface BrowserRuntimeAdapters {
  readonly nowMs?: () => number;
  readonly getCameraPosition?: () => Vec3;
  readonly getCameraForward?: () => Vec3;
  readonly getRenderCapabilities?: () => RenderCapabilities;
  readonly isCoarsePointer?: () => boolean;
}

export interface RuntimeControllerStats {
  readonly frames: number;
  readonly entities: number;
  readonly visibleEntities: number;
  readonly workers: ReturnType<LocalWorkerPool['stats']>;
  readonly network: ReturnType<ProductionNetworkRuntime['stats']>;
  readonly persistence: ReturnType<ProductionPersistenceRuntime['stats']>;
  readonly telemetry: ReturnType<ProductionObservability['snapshot']>;
  readonly mode: RuntimeMode;
}

export class ProductionRuntimeController {
  readonly identity: RuntimeIdentity;
  readonly runtime: NextRuntime;
  readonly entities: ProductionEntityRegistry;
  readonly network: ProductionNetworkRuntime;
  readonly persistence: ProductionPersistenceRuntime;
  readonly observability: ProductionObservability;
  readonly lifecycle: ProductionLifecycleSupervisor;
  readonly events = new TypedRuntimeEventRouter();
  readonly input = new InputAggregator();
  readonly workers: LocalWorkerPool;
  readonly camera: ThirdPersonCameraSolver;
  readonly audio: AudioRouter;
  readonly renderPlanner: ProductionRenderPlanner;
  readonly capabilities: ReturnType<typeof normalizeRuntimeCapabilities>;
  #mode: RuntimeMode = 'booting';
  #frame = 0;
  #wallTimeMs = 0;
  #lastBudget = normalizeBudget({ simulationMs:0, renderMs:0, streamingMs:0, networkMs:0, totalMs:0 });
  #health: RuntimeHealthReport;
  #inputSequence = 0;
  #lastInput?: InputFrame;
  #adapters: BrowserRuntimeAdapters;
  #disposers: Array<() => void> = [];

  constructor(options: ProductionRuntimeOptions = {}, adapters: BrowserRuntimeAdapters = {}, persistenceStore?: PersistenceStore) {
    this.identity = normalizeRuntimeIdentity({
      ...options.identity,
      session: options.networkSession ?? options.identity?.session,
    });
    this.#adapters = adapters;
    const renderCapabilities = adapters.getRenderCapabilities?.() ?? options.renderCapabilities ?? {
      maxTextureSize: 4096,
      supportsInstancing: true,
      supportsWebGL2: true,
    };
    this.capabilities = normalizeRuntimeCapabilities({
      render: renderCapabilities,
      maxTouchPoints: adapters.isCoarsePointer?.() ? 5 : 0,
      supportsWorkers: true,
      supportsSharedArrayBuffer: globalThis.crossOriginIsolated === true,
      hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? renderCapabilities.hardwareConcurrency ?? 4,
      deviceMemoryGb: globalThis.navigator?.deviceMemory ?? renderCapabilities.deviceMemoryGb ?? 4,
      prefersReducedMotion: readReducedMotionPreference(),
    });

    const qualityTier: QualityTier = resolveInitialTier(renderCapabilities, adapters.isCoarsePointer?.() ?? options.coarsePointer ?? false);
    this.runtime = createNextRuntime({
      simulationHz: options.simulationHz ?? 60,
      maxSimulationStepsPerFrame: options.maxSimulationStepsPerFrame ?? 8,
      inputCapacity: options.inputCapacity ?? 512,
      coarsePointer: adapters.isCoarsePointer?.() ?? options.coarsePointer ?? false,
      renderCapabilities,
      qualityTier,
    });
    this.entities = new ProductionEntityRegistry({ maxEntities: options.maxEntities, maxVisibleEntities: options.maxVisibleEntities });
    this.network = new ProductionNetworkRuntime({ session: options.networkSession ?? this.identity.session, maxEntities: options.maxEntities ?? 4096, maxPayloadBytes: 256 * 1024 });
    this.persistence = new ProductionPersistenceRuntime(persistenceStore ?? new MemoryPersistenceStore(), { application: this.identity.application });
    this.observability = new ProductionObservability();
    this.lifecycle = new ProductionLifecycleSupervisor({ identity: this.identity, recoveryAttempts: options.recoveryAttempts ?? 3, faultAfterFailures: 3 });
    this.workers = createDefaultWorkerPool(this.capabilities.hardwareConcurrency >= 8 ? 4 : 2);
    this.camera = new ThirdPersonCameraSolver();
    this.audio = new AudioRouter(this.capabilities.hardwareConcurrency >= 8 ? 64 : 32);
    this.renderPlanner = new ProductionRenderPlanner({
      maxVisibleEntities: options.maxVisibleEntities ?? 5000,
      reducedMotion: this.capabilities.prefersReducedMotion,
      shadows: renderCapabilities.supportsWebGL2,
    });
    this.#health = buildInitialHealth(this.identity, this.capabilities);
    this.#installLifecycle();
  }

  async start(): Promise<void> {
    if (this.#mode === 'running') return;
    this.#mode = 'booting';
    await this.lifecycle.start();
    this.runtime.start();
    this.#mode = 'running';
    this.#health = this.#healthWithMode('running');
    this.events.emit('started', this.clock(0));
    this.#health = this.observability.frame(this.clock(0), this.#lastBudget, this.identity, this.capabilities, this.entities.stats().count, 0, this.runtime.input.length, this.workers.pending(), this.network.peers());
    this.events.emit('health', this.#health);
  }

  async pause(): Promise<boolean> {
    if (this.#mode !== 'running') return false;
    const ok = await this.lifecycle.pause();
    if (ok) {
      this.#mode = 'paused';
      this.runtime.stop();
      this.events.emit('paused', this.clock(0));
    }
    return ok;
  }

  async resume(): Promise<boolean> {
    if (this.#mode !== 'paused') return false;
    const ok = await this.lifecycle.resume();
    if (ok) {
      this.#mode = 'running';
      this.runtime.start();
      this.events.emit('resumed', this.clock(0));
    }
    return ok;
  }

  async stop(): Promise<void> {
    if (this.#mode === 'stopped') return;
    this.runtime.stop();
    await this.lifecycle.stop();
    this.#mode = 'stopped';
    this.events.emit('stopped', this.clock(0));
  }

  async dispose(): Promise<void> {
    await this.stop();
    for (const dispose of this.#disposers.splice(0)) dispose();
    this.events.clear();
    await this.lifecycle.dispose();
    this.entities.clear();
    this.network.reset();
    this.renderPlanner.reset();
  }

  submitInput(frame: InputFrame): boolean {
    if (!isInputFrameSafe(frame)) return false;
    if (this.#mode !== 'running') return false;
    this.input.setMove(frame.moveX, frame.moveZ);
    this.input.addLook(frame.lookX, frame.lookY);
    this.input.setButton(InputButton.Jump, (frame.buttons & InputButton.Jump) !== 0);
    this.input.setButton(InputButton.Sprint, (frame.buttons & InputButton.Sprint) !== 0);
    this.input.setButton(InputButton.Dodge, (frame.buttons & InputButton.Dodge) !== 0);
    this.input.setButton(InputButton.Primary, (frame.buttons & InputButton.Primary) !== 0);
    this.input.setButton(InputButton.Secondary, (frame.buttons & InputButton.Secondary) !== 0);
    this.input.setButton(InputButton.Interact, (frame.buttons & InputButton.Interact) !== 0);
    this.input.setButton(InputButton.Inventory, (frame.buttons & InputButton.Inventory) !== 0);
    this.input.setButton(InputButton.Map, (frame.buttons & InputButton.Map) !== 0);
    this.#lastInput = frame;
    const command = this.runtime.submitInput(frame);
    this.#inputSequence = command.sequence;
    this.events.emit('input', {
      frame,
      pressed: inputButtons(frame),
      released: [],
      source: 'synthetic',
    });
    return true;
  }

  async frame(input: ProductionFrameInput): Promise<ProductionFrameResult> {
    if (this.#mode === 'booting') await this.start();
    if (this.#mode !== 'running') return this.#result(input, 0);
    const wall = input.wallTimeMs ?? this.#adapters.nowMs?.() ?? Date.now();
    const delta = Math.max(0, Math.min(0.25, Number.isFinite(input.deltaSeconds) ? input.deltaSeconds : 0));
    this.#wallTimeMs = Math.max(this.#wallTimeMs, wall);
    this.#frame += 1;
    const clock = this.clock(delta);
    const endFrameScope = this.observability.begin('simulation', 'frame');
    try {
      if (input.input) this.submitInput(input.input);
      this.#lastBudget = normalizeBudget(input.budget, 16.6, budgetForTier(this.renderPlanner.lastPlan()?.tier ?? this.runtime.renderBudget.state.tier));
      const runtimeResult = this.runtime.frame(delta, input.budget);
      const camera = this.#adapters.getCameraPosition?.() ?? { x: 0, y: 0, z: 0 };
      this.entities.frameUpdate(this.#frame, this.runtime.currentTick, camera, this.#lastBudget.render.visibleDistance * 650);
      const renderPlan = this.renderPlanner.plan({
        tick: runtimeResult.steps >= 0 ? this.runtime.currentTick : tick(0),
        alpha: runtimeResult.alpha,
        camera,
        entities: this.entities.all(),
        tier: runtimeResult.tier,
        capabilities: this.capabilities.render,
      });
      const currentHealth = this.observability.frame(
        this.clock(delta),
        this.#lastBudget,
        this.identity,
        this.capabilities,
        this.entities.stats().count,
        0,
        this.runtime.input.length,
        this.workers.pending(),
        this.network.peers(),
      );
      this.#health = currentHealth;
      this.events.emit('renderPlan', renderPlan);
      this.events.emit('frame', { ...this.clock(delta), ...this.#lastBudget });
      this.events.emit('health', currentHealth);
      endFrameScope();
      this.observability.recordSuccess('simulation', this.runtime.currentTick);
      return { tick: this.runtime.currentTick, steps: runtimeResult.steps, alpha: runtimeResult.alpha, mode: this.#mode, renderPlan, health: currentHealth };
    } catch (error) {
      endFrameScope();
      const fault = {
        subsystem: 'simulation' as const,
        policy: 'fault-runtime' as const,
        message: error instanceof Error ? error.message : String(error),
        tick: this.runtime.currentTick,
        recoverable: true,
      };
      this.observability.recordFailure(fault);
      this.events.emit('fault', fault);
      this.#mode = 'recovering';
      this.#health = this.#healthWithMode('recovering');
      return this.#result(input, 0);
    }
  }

  createEntity(seed: ProductionEntitySeed = {}): number {
    const id = this.entities.create(seed);
    const spatialPosition = this.entities.get(id)?.transform.position;
    if (spatialPosition) this.runtime.indexEntity(id, spatialPosition.x, spatialPosition.z, this.entities.get(id)?.transform.radiusMeters ?? 0);
    return id;
  }

  removeEntity(id: number): boolean {
    return this.entities.remove(id);
  }

  moveEntity(id: number, position: Partial<Vec3>, velocity?: Partial<Vec3>): boolean {
    const result = this.entities.move(id, position, velocity, this.runtime.currentTick);
    const next = this.entities.get(id);
    if (result && next) this.runtime.indexEntity(id, next.transform.position.x, next.transform.position.z, next.transform.radiusMeters);
    return result;
  }

  setEntityVisibility(id: number, visibility: EntityRuntimeState['transform']['visibility']): boolean {
    return this.entities.setVisibility(id, visibility);
  }

  connectPeer(peerId: string, transport: NetworkPeerState['transport'] = 'loopback'): NetworkPeerState {
    const peer = this.network.connect(peerId, transport, this.#wallTimeMs);
    this.events.emit('peer', peer);
    return peer;
  }

  disconnectPeer(peerId: string): boolean {
    const disconnected = this.network.disconnect(peerId);
    const peer = this.network.peer(peerId);
    if (peer) this.events.emit('peer', peer);
    return disconnected;
  }

  createNetworkPacket(peerId: string): ReturnType<ProductionNetworkRuntime['createSnapshotPacket']> {
    const world = this.worldSnapshot();
    return this.network.createSnapshotPacket(peerId, world, this.#wallTimeMs);
  }

  async save(slot: string, kind: 'manual' | 'autosave' | 'checkpoint' | 'recovery'): Promise<ReturnType<ProductionPersistenceRuntime['save']>> {
    const runtime = this.snapshot();
    const state = this.persistence.snapshotState(this.identity, slot, kind, runtime);
    const descriptor = await this.persistence.save(slot, kind, this.identity, state, this.#wallTimeMs);
    this.events.emit('save', descriptor);
    return descriptor;
  }

  async load(slot: string): Promise<ReturnType<ProductionPersistenceRuntime['load']>> {
    return this.persistence.load(slot);
  }

  snapshot(): ProductionSnapshot {
    return {
      contractVersion: 1,
      identity: this.identity,
      tick: this.runtime.currentTick,
      simTimeSeconds: this.runtime.scheduler.simTime,
      entities: this.entities.snapshot(),
      world: this.worldSnapshot(),
      inputSequence: this.#inputSequence,
    };
  }

  restore(snapshot: ProductionSnapshot): void {
    this.entities.restore(snapshot.entities);
    if (this.#lastInput && snapshot.inputSequence < this.#inputSequence) this.#lastInput = undefined;
    this.#inputSequence = Math.max(0, snapshot.inputSequence);
  }

  worldSnapshot(): import('../types.ts').WorldSnapshot {
    const entities = this.entities.all()
      .map((entity) => ({
        id: entity.transform.id as import('../types.ts').EntityId,
        x: entity.transform.position.x,
        y: entity.transform.position.y,
        z: entity.transform.position.z,
        yaw: entity.transform.yawRadians,
        flags: entity.flags,
      }))
      .sort((a,b) => a.id - b.id);
    return { tick: this.runtime.currentTick, entities };
  }

  cameraUpdate(target: { position: Vec3; yawRadians: number; velocity: Vec3 }, deltaSeconds: number, input: { yawDelta?: number; pitchDelta?: number; zoomDelta?: number } = {}, obstruction?: { distance: number; radius: number }): CameraState {
    return this.camera.update(target, deltaSeconds, input, obstruction);
  }

  audioUpdate(listener: Vec3, right: Vec3): AudioVoiceDecision[] {
    return this.audio.updateListener(listener, right);
  }

  async worker<TPayload, TResult>(kind: Parameters<LocalWorkerPool['enqueue']>[0], payload: TPayload, priority = 0): Promise<ReturnType<LocalWorkerPool['enqueue']>> {
    return this.workers.enqueue(kind, payload, { priority, createdTick: this.runtime.currentTick });
  }

  health(): RuntimeHealthReport {
    return this.#health;
  }

  stats(): RuntimeControllerStats {
    const renderStats = this.renderPlanner.stats();
    return {
      frames: this.#frame,
      entities: this.entities.stats().count,
      visibleEntities: renderStats.visibleEntities,
      workers: this.workers.stats(),
      network: this.network.stats(),
      persistence: this.persistence.stats(),
      telemetry: this.observability.snapshot(),
      mode: this.#mode,
    };
  }

  clock(deltaSeconds = 0): RuntimeClock {
    return {
      tick: this.runtime.currentTick,
      simTimeSeconds: this.runtime.scheduler.simTime,
      wallTimeMs: this.#wallTimeMs,
      frameIndex: this.#frame,
      deltaSeconds: Math.max(0, deltaSeconds),
    };
  }

  #result(input: ProductionFrameInput, steps: number): ProductionFrameResult {
    const plan = this.renderPlanner.lastPlan() ?? {
      tick: this.runtime.currentTick,
      alpha: 0,
      tier: this.runtime.renderBudget.state.tier,
      pixelRatio: this.runtime.renderBudget.state.pixelRatio,
      visibleDistance: this.runtime.renderBudget.state.visibleDistance,
      commands: [],
    };
    return {
      tick: this.runtime.currentTick,
      steps,
      alpha: 0,
      mode: this.#mode,
      renderPlan: plan,
      health: this.#healthWithMode(this.#mode),
    };
  }

  #healthWithMode(mode: RuntimeMode): RuntimeHealthReport {
    return { ...this.#health, mode, clock: this.clock(0), budget: this.#lastBudget };
  }

  #installLifecycle(): void {
    this.lifecycle.register({
      id: 'runtime-core',
      subsystem: 'simulation',
      priority: 10,
      failurePolicy: 'fault-runtime',
      start: () => this.runtime.start(),
      stop: () => this.runtime.stop(),
      dispose: () => this.runtime.stop(),
    });
    this.lifecycle.register({
      id: 'render-planner',
      subsystem: 'render',
      priority: 20,
      failurePolicy: 'degrade',
      start: () => this.renderPlanner.reset(),
      dispose: () => this.renderPlanner.reset(),
    });
    this.lifecycle.register({
      id: 'network-runtime',
      subsystem: 'network',
      priority: 30,
      failurePolicy: 'restart',
      start: () => undefined,
      stop: () => this.network.reset(),
      dispose: () => this.network.reset(),
    });
  }
}

function readReducedMotionPreference(): boolean {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

export function createProductionRuntimeController(options: ProductionRuntimeOptions = {}, adapters: BrowserRuntimeAdapters = {}, persistenceStore?: PersistenceStore): ProductionRuntimeController {
  return new ProductionRuntimeController(options, adapters, persistenceStore);
}

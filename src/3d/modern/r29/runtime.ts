import { R29BudgetDirector } from './budgetDirector.ts';
import { R29FixedStepClock, R29FramePacer } from './clock.ts';
import {
  R29_DEFAULT_BUDGET,
  freezeR29,
  stableObjectDigestR29,
  type R29Backend,
  type R29FrameResult,
  type R29InputIntent,
  type R29LifecycleComponent,
  type R29NetworkSnapshot,
  type R29Phase,
  type R29RuntimeCapabilities,
  type R29RuntimeHooks,
  type R29RuntimeMode,
  type R29RuntimeOptions,
  type R29RuntimeSnapshot,
} from './contracts.ts';
import { R29EventBus, R29IncidentRecorder } from './eventBus.ts';
import { R29InputRuntime, type R29RawInput } from './inputRuntime.ts';
import { R29NetworkCoordinator } from './networkCoordinator.ts';
import { R29RenderCoordinator, createHeadlessR29Backend, type R29RenderBackendAdapter } from './renderCoordinator.ts';
import { R29ServiceRegistry, createR29Service } from './serviceRegistry.ts';
import { scoreR29Health, R29Telemetry } from './telemetry.ts';
import { R29WorldRuntime } from './worldRuntime.ts';
import { R29AssetCache } from './assetCache.ts';

export interface R29TaskRegistration {
  readonly id: string;
  readonly phase: R29Phase;
  readonly priority: number;
  readonly cadenceFrames?: number;
  readonly optional?: boolean;
  readonly budgetMs: number;
  readonly run: (runtime: R29Runtime) => void | Promise<void>;
}

export interface R29TaskRun {
  readonly id: string;
  readonly phase: R29Phase;
  readonly elapsedMs: number;
  readonly skipped: boolean;
  readonly failed: boolean;
  readonly error?: string;
}

const PHASE_ORDER: readonly R29Phase[] = Object.freeze([
  'input',
  'simulation',
  'streaming',
  'network',
  'render',
  'telemetry',
]);

export class R29Runtime implements R29LifecycleComponent {
  readonly id = 'r29.runtime';
  readonly clock: R29FixedStepClock;
  readonly pacer: R29FramePacer;
  readonly events: R29EventBus;
  readonly incidents: R29IncidentRecorder;
  readonly input: R29InputRuntime;
  readonly network: R29NetworkCoordinator;
  readonly renderer: R29RenderCoordinator;
  readonly world: R29WorldRuntime;
  readonly assets: R29AssetCache;
  readonly budgets: R29BudgetDirector;
  readonly telemetry: R29Telemetry;
  readonly services: R29ServiceRegistry;
  readonly capabilities: R29RuntimeCapabilities;
  readonly backend: R29Backend;

  #mode: R29RuntimeMode = 'created';
  #phase: R29Phase = 'boot';
  #tasks = new Map<string, R29TaskRegistration>();
  #hooks: R29RuntimeHooks;
  #started = false;
  #disposed = false;
  #frame = 0;
  #lastPlan = this.worldPlan(0);
  #lastRenderPlan = this.renderer.plan();
  #lastFrameMs = 0;
  #lastNetworkMs = 0;
  #lastSimulationMs = 0;
  #lastTelemetryMs = 0;
  #lastInput: R29InputIntent | null = null;
  #lastResult: R29FrameResult = Object.freeze({
    steps: 0,
    droppedSteps: 0,
    simulationMs: 0,
    renderMs: 0,
    networkMs: 0,
    telemetryMs: 0,
  });

  constructor(options: R29RuntimeOptions = {}, hooks: R29RuntimeHooks = {}) {
    this.clock = new R29FixedStepClock({
      tickRate: options.tickRate ?? 60,
      maxStepsPerFrame: options.maxStepsPerFrame ?? 5,
      maxFrameDeltaSeconds: options.maxFrameDeltaSeconds ?? 0.25,
    });
    this.pacer = new R29FramePacer({ targetFps: options.tickRate ?? 60 });
    this.events = new R29EventBus();
    this.incidents = new R29IncidentRecorder({ eventBus: this.events });
    this.input = new R29InputRuntime();
    this.network = new R29NetworkCoordinator();
    this.capabilities = detectCapabilities();
    const adapters: R29RenderBackendAdapter[] = [{ backend: 'webgpu', available: this.capabilities.webGpu }, { backend: 'webgl2', available: this.capabilities.webGl2 }, createHeadlessR29Backend()];
    this.renderer = new R29RenderCoordinator({
      preferredBackend: options.backend,
      adapters,
      tier: options.qualityTier ?? 'high',
    });
    this.backend = this.renderer.plan().backend;
    this.world = new R29WorldRuntime({
      maxResidentBytes: options.memoryBudgetBytes ?? R29_DEFAULT_BUDGET.memoryBytes,
    });
    this.assets = new R29AssetCache({
      maxResidentBytes: Math.floor((options.memoryBudgetBytes ?? R29_DEFAULT_BUDGET.memoryBytes) * 0.6),
    });
    this.budgets = new R29BudgetDirector({
      initialTier: options.qualityTier ?? 'high',
      budget: options.memoryBudgetBytes ? { memoryBytes: options.memoryBudgetBytes } : {},
    });
    this.telemetry = new R29Telemetry();
    this.services = new R29ServiceRegistry();
    this.#hooks = hooks;
    this.services.register({ service: this.inputService(), eager: false });
    this.services.register({ service: this.worldService(), eager: false });
    this.services.register({ service: this.assetService(), eager: false });
    this.services.register({ service: this.renderService(), dependencies: ['r29.world', 'r29.assets'] });
    this.services.register({ service: this.networkService(), dependencies: ['r29.input'] });
    this.#installDefaultTasks();
    this.#validateConfiguration();
  }

  async start(): Promise<void> {
    this.#assertLive();
    if (this.#started) return;
    if (this.#mode === 'failed') throw new Error('R29_RUNTIME_FAILED');
    this.#mode = 'starting';
    try {
      const failures = this.services.validate();
      if (failures.length > 0) throw new Error(`R29_SERVICE_GRAPH_INVALID:${failures.join('|')}`);
      await this.renderer.initialize();
      await this.services.start('r29.input');
      await this.services.start('r29.world');
      await this.services.start('r29.assets');
      await this.services.start('r29.render');
      await this.services.start('r29.network');
      this.#started = true;
      this.#mode = 'running';
      this.#phase = 'input';
      this.events.emitSafe('runtime.started', { tick: this.clock.tick() }, (error) => this.#reportError(error));
    } catch (error) {
      this.#mode = 'failed';
      this.incidents.critical(this.clock.tick(), 'R29_BOOT_FAILURE', error instanceof Error ? error.message : String(error));
      this.#hooks.onError?.(error);
      throw error;
    }
  }

  pause(): void {
    if (this.#mode !== 'running' && this.#mode !== 'degraded') return;
    this.#mode = 'paused';
    this.events.emitSafe('runtime.paused', { tick: this.clock.tick() });
  }

  resume(): void {
    if (this.#mode !== 'paused') return;
    this.#mode = 'running';
    this.events.emitSafe('runtime.resumed', { tick: this.clock.tick() });
  }

  async stop(): Promise<void> {
    if (this.#mode === 'stopped' || this.#mode === 'created') {
      this.#mode = 'stopped';
      return;
    }
    if (this.#mode === 'stopping') return;
    this.#mode = 'stopping';
    await this.services.stop();
    this.#mode = 'stopped';
    this.#started = false;
    this.events.emitSafe('runtime.stopped', { tick: this.clock.tick() });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#mode = 'stopped';
    this.services.dispose();
    this.renderer.dispose();
    this.assets.dispose();
    this.world.reset();
    this.network.reset();
    this.input.reset();
    this.telemetry.clear();
    this.incidents.clear();
    this.events.clear();
  }

  enqueueInput(raw: R29RawInput): boolean {
    this.#assertLive();
    const result = this.input.enqueue(raw);
    if (!result.accepted || !result.intent) {
      this.telemetry.counter('r29.input.rejected', 1, this.clock.tick());
      this.events.emitSafe('input.rejected', { sequence: raw.sequence, reason: result.reason });
      return false;
    }
    this.#lastInput = result.intent;
    this.telemetry.counter('r29.input.accepted', 1, this.clock.tick());
    this.events.emitSafe('input.accepted', { sequence: result.intent.sequence, tick: result.intent.tick });
    this.network.queuePrediction(result.intent, this.worldDigest());
    return true;
  }

  registerTask(task: R29TaskRegistration): void {
    this.#assertLive();
    if (this.#tasks.has(task.id)) throw new Error(`R29_TASK_DUPLICATE:${task.id}`);
    this.#tasks.set(task.id, { ...task, cadenceFrames: Math.max(1, Math.floor(task.cadenceFrames ?? 1)), optional: Boolean(task.optional) });
  }

  registerZone(zone: Parameters<R29WorldRuntime['registerZone']>[0]): void {
    this.world.registerZone(zone);
  }

  registerAsset(entry: Parameters<R29AssetCache['declare']>[0]): void {
    this.assets.declare(entry);
  }

  async frame(deltaSeconds: number): Promise<R29FrameResult> {
    this.#assertLive();
    if (!this.#started) await this.start();
    const safeDelta = Math.max(0, Math.min(this.clock.maxFrameDeltaSeconds, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const frameStart = performance.now();
    this.#frame += 1;

    const advance = this.clock.advance(safeDelta);
    await this.#runTasks('input');
    const simulationStart = performance.now();
    if (this.#mode !== 'paused') {
      for (let step = 0; step < advance.steps; step += 1) await this.#runTasks('simulation');
    }
    this.#lastSimulationMs = performance.now() - simulationStart;

    const streamingStart = performance.now();
    await this.#runTasks('streaming');
    const networkStart = performance.now();
    await this.#runTasks('network');
    this.#lastNetworkMs = performance.now() - networkStart;

    const renderStart = performance.now();
    await this.#runTasks('render');
    this.#lastRenderPlan = this.renderer.plan();
    const renderMs = performance.now() - renderStart;
    this.#lastFrameMs = performance.now() - frameStart;

    const telemetryStart = performance.now();
    this.pacer.sample(this.#lastFrameMs);
    this.budgets.observe({
      frameMs: this.#lastFrameMs,
      simulationMs: this.#lastSimulationMs,
      renderMs,
      networkMs: this.#lastNetworkMs,
      telemetryMs: 0.1,
      memoryBytes: this.world.snapshot().residentBytes + this.assets.residentBytes(),
      visibleObjects: this.world.snapshot().activeEntities,
      drawCalls: this.#lastRenderPlan.passes.length * 180,
    }, {
      frameMs: this.#lastFrameMs,
      cpuMs: this.#lastSimulationMs + renderMs,
      gpuMs: this.#lastRenderPlan.estimatedGpuMs,
      drawCalls: this.#lastRenderPlan.passes.length * 180,
      visibleObjects: this.world.snapshot().activeEntities,
      textureBytes: this.assets.residentBytes(),
      geometryBytes: 0,
      backend: this.#lastRenderPlan.backend,
      thermalPressure: 0,
    });
    this.#syncModeFromBudget();
    this.telemetry.recordFrame(
      this.clock.tick(),
      this.#lastFrameMs,
      this.#lastSimulationMs,
      renderMs,
      this.#lastNetworkMs,
    );
    await this.#runTasks('telemetry');
    this.#lastTelemetryMs = performance.now() - telemetryStart;

    this.#lastResult = Object.freeze({
      steps: advance.steps,
      droppedSteps: advance.droppedSteps,
      simulationMs: this.#lastSimulationMs,
      renderMs,
      networkMs: this.#lastNetworkMs,
      telemetryMs: this.#lastTelemetryMs,
    });
    this.events.emitSafe('frame.completed', {
      frame: this.#frame,
      tick: this.clock.tick(),
      elapsedMs: this.#lastFrameMs,
    }, (error) => this.#reportError(error));

    if (advance.droppedSteps > 0) {
      this.incidents.warning(this.clock.tick(), 'R29_SPIRAL_GUARD', 'Fixed-step backlog was truncated.', {
        droppedSteps: advance.droppedSteps,
      });
    }

    const snapshot = this.snapshot();
    this.#hooks.onSnapshot?.(snapshot);
    return this.#lastResult;
  }

  snapshot(): R29RuntimeSnapshot {
    const world = this.world.snapshot();
    const budget = this.budgets.snapshot();
    const network = this.network.report();
    const resources = {
      residentBytes: this.world.snapshot().residentBytes + this.assets.residentBytes(),
      reservedBytes: this.assets.stats().reservedBytes,
      maxBytes: budget.budget.memoryBytes,
      assetCount: this.assets.snapshot().length,
      zoneCount: world.zones.length,
    };
    const frameStats = this.telemetry.summary();
    const memoryPressure = resources.residentBytes / Math.max(1, resources.maxBytes);
    const renderPressure = budget.pressure.render;
    const healthScore = scoreR29Health(
      frameStats.p95FrameMs,
      memoryPressure,
      renderPressure,
      network.score,
      this.incidents.count('critical'),
    );
    const health = freezeR29({
      status: this.modeHealth(healthScore),
      score: healthScore,
      mode: this.#mode,
      tick: this.clock.tick(),
      quality: budget.quality,
      budget: budget.pressure,
      network,
      resources: freezeR29(resources),
      incidents: this.incidents.recent(32),
      recommendations: freezeR29(this.recommendations(healthScore, memoryPressure, renderPressure, network.score)),
    });
    return freezeR29({
      runtimeVersion: 'r29',
      mode: this.#mode,
      phase: this.#phase,
      tick: this.clock.tick(),
      frame: this.#frame,
      backend: this.#lastRenderPlan.backend,
      quality: budget.quality,
      budget: budget.pressure,
      worldRevision: world.revision,
      entityCount: world.entities.length,
      activeEntityCount: world.activeEntities,
      streaming: this.#lastPlan,
      render: this.#lastRenderPlan,
      network,
      resources: freezeR29(resources),
      health,
    });
  }

  worldDigest(): string {
    const world = this.world.snapshot();
    return stableObjectDigestR29({
      revision: world.revision,
      entities: world.entities.map((entity) => ({
        id: entity.id,
        position: entity.transform.position,
        velocity: entity.transform.velocity,
        active: entity.transform.active,
      })),
    });
  }

  consumeLastInput(): R29InputIntent | null {
    const input = this.#lastInput;
    this.#lastInput = null;
    return input;
  }

  lastNetworkSnapshot(): R29NetworkSnapshot {
    const world = this.world.snapshot();
    return this.network.buildSnapshot({
      tick: this.clock.tick(),
      worldRevision: world.revision,
      entities: world.entities.map((entity) => ({
        id: entity.id,
        position: entity.transform.position,
        velocity: entity.transform.velocity,
        rotationY: entity.transform.rotationY,
        revision: entity.transform.revision,
      })),
    });
  }

  get mode(): R29RuntimeMode {
    return this.#mode;
  }

  get phase(): R29Phase {
    return this.#phase;
  }

  #installDefaultTasks(): void {
    this.registerTask({
      id: 'r29.input.drain',
      phase: 'input',
      priority: 100,
      budgetMs: 0.35,
      run: (runtime) => {
        runtime.input.sampleForTick(runtime.clock.tick());
      },
    });
    this.registerTask({
      id: 'r29.world.stream',
      phase: 'streaming',
      priority: 90,
      budgetMs: 0.8,
      run: (runtime) => {
        runtime.#lastPlan = runtime.world.plan(
          { x: 0, y: 0, z: 0, velocityX: 0, velocityZ: 0, radiusMeters: 512, prefetchMeters: 256, importance: 1 },
          runtime.#frame,
        );
      },
    });
    this.registerTask({
      id: 'r29.asset.sweep',
      phase: 'streaming',
      priority: 50,
      cadenceFrames: 30,
      budgetMs: 0.2,
      optional: true,
      run: (runtime) => {
        const evicted = runtime.assets.sweep(runtime.clock.tick());
        runtime.telemetry.counter('r29.assets.evicted', evicted.length, runtime.clock.tick());
      },
    });
    this.registerTask({
      id: 'r29.network.health',
      phase: 'network',
      priority: 60,
      budgetMs: 0.2,
      cadenceFrames: 4,
      optional: true,
      run: (runtime) => {
        const report = runtime.network.report();
        runtime.telemetry.gauge('r29.network.score', report.score, runtime.clock.tick(), 'score');
        runtime.events.emitSafe('network.health', { score: report.score, health: report.health });
      },
    });
    this.registerTask({
      id: 'r29.render.compile',
      phase: 'render',
      priority: 100,
      budgetMs: 0.1,
      run: (runtime) => {
        runtime.renderer.setTier(runtime.budgets.snapshot().quality.tier);
      },
    });
  }

  async #runTasks(phase: R29Phase): Promise<void> {
    this.#phase = phase;
    const tasks = [...this.#tasks.values()]
      .filter((task) => task.phase === phase)
      .filter((task) => this.#frame % (task.cadenceFrames ?? 1) === 0)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const task of tasks) {
      try {
        if (task.optional && this.budgets.snapshot().pressure.aggregate > 1.05) continue;
        await task.run(this);
      } catch (error) {
        this.telemetry.counter(`r29.task.${task.id}.failed`, 1, this.clock.tick());
        this.incidents.error(this.clock.tick(), 'R29_TASK_FAILURE', task.id, {
          error: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
        });
        this.#hooks.onError?.(error);
        if (!task.optional) {
          this.events.emitSafe('runtime.degraded', { tick: this.clock.tick(), reason: task.id });
          this.#mode = 'degraded';
        }
      }
    }
  }

  #syncModeFromBudget(): void {
    const pressure = this.budgets.snapshot().pressure.aggregate;
    if (this.#mode === 'paused' || this.#mode === 'failed' || this.#mode === 'stopped') return;
    if (pressure >= 1.08) {
      if (this.#mode !== 'degraded') this.events.emitSafe('runtime.degraded', { tick: this.clock.tick(), reason: 'budget-pressure' });
      this.#mode = 'degraded';
    } else if (pressure < 0.68 && this.#mode === 'degraded') {
      this.#mode = 'running';
      this.events.emitSafe('runtime.recovered', { tick: this.clock.tick() });
    }
  }

  #validateConfiguration(): void {
    const invalid = [...this.#tasks.values()]
      .filter((task) => !task.id || !task.phase || task.budgetMs < 0)
      .map((task) => task.id || '<empty>');
    if (invalid.length) throw new Error(`R29_TASK_CONFIGURATION_INVALID:${invalid.join('|')}`);
  }

  modeHealth(score: number): R29RuntimeSnapshot['health']['status'] {
    if (this.#mode === 'failed' || score < 45) return 'critical';
    if (this.#mode === 'degraded' || score < 75) return 'degraded';
    return 'healthy';
  }

  recommendations(score: number, memoryPressure: number, renderPressure: number, networkScore: number): readonly string[] {
    const recommendations: string[] = [];
    if (score < 75) recommendations.push('lower-runtime-quality-tier');
    if (memoryPressure > 0.85) recommendations.push('evict-cold-assets-and-zones');
    if (renderPressure > 1) recommendations.push('reduce-optional-render-passes');
    if (networkScore < 60) recommendations.push('increase-interpolation-and-input-redundancy');
    if (this.#lastRenderPlan.hazards.length > 0) recommendations.push('repair-render-pass-dependencies');
    if (recommendations.length === 0) recommendations.push('runtime-within-budget');
    return Object.freeze([...new Set(recommendations)]);
  }

  #reportError(error: unknown): void {
    this.telemetry.counter('r29.event.listener.error', 1, this.clock.tick());
    this.incidents.warning(this.clock.tick(), 'R29_EVENT_LISTENER_ERROR', error instanceof Error ? error.message : String(error));
    this.#hooks.onError?.(error);
  }

  inputService(): R29LifecycleComponent {
    return createR29Service('r29.input', () => this.input.reset(), () => undefined, () => this.input.reset());
  }

  worldService(): R29LifecycleComponent {
    return createR29Service('r29.world', () => undefined, () => undefined, () => this.world.reset());
  }

  assetService(): R29LifecycleComponent {
    return createR29Service('r29.assets', () => undefined, () => undefined, () => this.assets.dispose());
  }

  renderService(): R29LifecycleComponent {
    return createR29Service('r29.render', () => undefined, () => undefined, () => this.renderer.dispose());
  }

  networkService(): R29LifecycleComponent {
    return createR29Service('r29.network', () => undefined, () => undefined, () => this.network.reset());
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R29_RUNTIME_DISPOSED');
  }

  private worldPlan(frame: number): ReturnType<R29WorldRuntime['plan']> {
    return this.world.plan(
      { x: 0, y: 0, z: 0, velocityX: 0, velocityZ: 0, radiusMeters: 512, prefetchMeters: 256, importance: 1 },
      frame,
    );
  }
}

function detectCapabilities(): R29RuntimeCapabilities {
  if (typeof window === 'undefined') {
    return {
      webGpu: false,
      webGl2: false,
      worker: false,
      sharedArrayBuffer: false,
      pointerLock: false,
      devicePixelRatio: 1,
      hardwareConcurrency: 1,
    };
  }
  return {
    webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    webGl2: typeof document !== 'undefined',
    worker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    pointerLock: 'pointerLockElement' in document,
    devicePixelRatio: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1,
    hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 1,
  };
}

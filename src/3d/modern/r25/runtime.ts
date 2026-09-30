import type {
  AssetManifestEntry,
  R25RuntimeSnapshot,
  RenderObservation,
  RuntimeBudget,
  RuntimeClock,
  RuntimePhase,
  RuntimeState,
  WorldZoneDescriptor,
} from './contracts.ts';
import {
  gradeFromScore,
  percentile,
} from './contracts.ts';
import { R25Scheduler, createR25Task } from './scheduler.ts';
import { RenderGraphR25, buildStandardR25Graph } from './renderGraph.ts';
import {
  AdaptiveQualityR25,
  FramePacerR25,
  estimateDynamicPixelRatio,
} from './adaptiveQuality.ts';
import {
  buildR25RenderProfile,
  detectR25Capabilities,
  selectR25Backend,
} from './backend.ts';
import { AssetRuntimeR25 } from './assetRuntime.ts';
import { WorldRuntimeR25, worldInterest } from './worldRuntime.ts';
import { InputIntentR25, type IntentR25, type RawInputR25 } from './inputIntent.ts';
import { ObservabilityR25 } from './observability.ts';
import {
  DEFAULT_R25_SECURITY_POLICY,
  MessageRateLimiterR25,
  validateInputPayload,
} from './security.ts';

export interface R25RuntimeOptions {
  readonly clock?: Partial<RuntimeClock>;
  readonly frameBudgetMs?: number;
  readonly fixedStepMs?: number;
  readonly maxResidentWorldBytes?: number;
  readonly maxResidentAssetBytes?: number;
  readonly maxAssetConcurrency?: number;
  readonly assetTransport?: ConstructorParameters<typeof AssetRuntimeR25>[0]['transport'];
  readonly canvas?: HTMLCanvasElement;
  readonly forceBackend?: 'webgpu' | 'webgl2' | 'webgl' | 'none';
  readonly preferWebGpu?: boolean;
  readonly qualityTier?: 'ultra' | 'high' | 'balanced' | 'low' | 'safe';
  readonly debugRender?: boolean;
}

export interface R25TickResult {
  readonly snapshot: R25RuntimeSnapshot;
  readonly intentsProcessed: number;
  readonly worldLoads: readonly string[];
  readonly worldUnloads: readonly string[];
  readonly renderPasses: number;
}

interface InternalClock extends RuntimeClock {
  advance(deltaMs: number): void;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function createClock(input?: Partial<RuntimeClock>): InternalClock {
  let timeMs = finite(input?.nowMs?.(), 0);
  let tick = Math.max(0, Math.trunc(finite(input?.simulationTick?.(), 0)));
  const fixedStep = Math.max(1, finite(input?.fixedStepMs?.(), 1000 / 60));

  return {
    nowMs: () => timeMs,
    simulationTick: () => tick,
    fixedStepMs: () => fixedStep,
    advance(deltaMs: number): void {
      timeMs += Math.max(0, finite(deltaMs, fixedStep));
      tick += 1;
    },
  };
}

function noopAssetTransport(): NonNullable<R25RuntimeOptions['assetTransport']> {
  return {
    async load(entry) {
      return freeze({
        bytes: entry.bytes,
        payload: null,
      });
    },
  };
}

export class RuntimeR25 {
  readonly clock: InternalClock;
  readonly input: InputIntentR25;
  readonly scheduler: R25Scheduler;
  readonly assets: AssetRuntimeR25;
  readonly world: WorldRuntimeR25;
  readonly observability: ObservabilityR25;
  readonly renderGraph: RenderGraphR25;
  readonly quality: AdaptiveQualityR25;
  readonly pacer: FramePacerR25;
  readonly backend: ReturnType<typeof selectR25Backend>;
  readonly capabilities: ReturnType<typeof detectR25Capabilities>;

  #state: RuntimeState = 'created';
  #frame = 0;
  #lastWorldPlan = {
    load: [] as readonly WorldPlanId[],
    unload: [] as readonly WorldPlanId[],
  };
  #frameTimes: number[] = [];
  #debugRender: boolean;
  #disposed = false;
  #rateLimiter: MessageRateLimiterR25;
  #legacyTick: (() => void | Promise<void>) | null = null;
  #lastIntentsProcessed = 0;

  public constructor(options: R25RuntimeOptions = {}) {
    this.clock = createClock({
      nowMs: options.clock?.nowMs,
      simulationTick: options.clock?.simulationTick,
      fixedStepMs: options.clock?.fixedStepMs ?? options.fixedStepMs ?? 1000 / 60,
    });

    this.input = new InputIntentR25({
      clock: () => this.clock.nowMs(),
      maxQueue: 1024,
      deadzone: 0.12,
      axisSmoothing: 0.3,
    });

    this.scheduler = new R25Scheduler({
      frameBudgetMs: options.frameBudgetMs ?? 16.67,
      overrunGraceMs: 1.5,
      clock: () => this.clock.nowMs(),
      onTaskError: (task, error) => {
        this.observability.event({
          name: 'runtime.task.error',
          severity: 'error',
          frame: this.#frame,
          attributes: {
            task: String(task.id),
            error: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
          },
        });
      },
    });

    this.observability = new ObservabilityR25({
      clock: () => this.clock.nowMs(),
      maxEvents: 2048,
      maxMetrics: 4096,
      maxSpans: 2048,
      maxHistogramSamples: 1024,
    });

    this.world = new WorldRuntimeR25({
      maxResidentBytes: options.maxResidentWorldBytes ?? 768 * 1024 * 1024,
      unloadHysteresisMeters: 180,
      predictionWeight: 1.3,
      distanceWeight: 0.01,
      priorityWeight: 1.2,
      pressureWeight: 2.5,
    });

    this.assets = new AssetRuntimeR25({
      maxResidentBytes: options.maxResidentAssetBytes ?? 512 * 1024 * 1024,
      maxConcurrentLoads: options.maxAssetConcurrency ?? 6,
      maxAttempts: 3,
      retryBaseDelayMs: 150,
      retryMaxDelayMs: 2500,
      clock: this.clock,
      transport: options.assetTransport ?? noopAssetTransport(),
    });

    this.capabilities = detectR25Capabilities();
    this.backend = selectR25Backend(this.capabilities, {
      force: options.forceBackend,
      preferWebGpu: options.preferWebGpu ?? true,
      allowWebglFallback: true,
      requireSecureContext: true,
    });

    const profile = buildR25RenderProfile(this.capabilities, this.backend);
    this.quality = new AdaptiveQualityR25(
      options.qualityTier
        ? freeze({ ...profile, tier: options.qualityTier })
        : profile,
      {
        clock: () => this.clock.nowMs(),
        targetFrameMs: 1000 / Math.max(1, profile.targetFps),
        downgradeSamples: 6,
        upgradeSamples: 36,
        cooldownFrames: 24,
      },
    );

    this.pacer = new FramePacerR25({
      targetFps: profile.targetFps,
      maxDeltaMs: 250,
      smoothingAlpha: 0.12,
    });

    this.renderGraph = buildStandardR25Graph(
      this.capabilities.viewportWidth,
      this.capabilities.viewportHeight,
      {
        enableTemporalHistory: profile.temporalHistory,
        shadowScale: profile.shadowResolution / 4096,
      },
    );

    this.#debugRender = options.debugRender === true;
    this.#rateLimiter = new MessageRateLimiterR25(
      DEFAULT_R25_SECURITY_POLICY.maxMessagesPerSecond,
    );

    this.#registerTasks();
  }

  public get state(): RuntimeState {
    return this.#state;
  }

  public get frame(): number {
    return this.#frame;
  }

  public registerZone(zone: WorldZoneDescriptor): void {
    this.#assertLive();
    this.world.register(zone);
  }

  public registerAsset(entry: AssetManifestEntry): void {
    this.#assertLive();
    this.assets.declare(entry);
  }

  public attachLegacyTick(handler: (() => void | Promise<void>) | null): void {
    this.#legacyTick = handler;
  }

  public enqueueInput(raw: RawInputR25): IntentR25 | null {
    this.#assertLive();
    if (!this.#rateLimiter.allow(raw.timestampMs)) {
      this.observability.counter('runtime.input.rate_limited', 1);
      return null;
    }

    const validation = validateInputPayload(raw);
    if (!validation.ok) {
      this.observability.counter('runtime.input.invalid', 1);
      return null;
    }

    const intent = this.input.enqueue(raw);
    if (intent) {
      this.observability.counter('runtime.input.accepted', 1);
    } else {
      this.observability.counter('runtime.input.rejected', 1);
    }
    return intent;
  }

  public setWorldInterest(
    x: number,
    z: number,
    velocityX = 0,
    velocityZ = 0,
    importance = 1,
    horizonSeconds = 2,
    prefetchRadiusMeters = 120,
  ): void {
    this.#lastWorldPlan = this.world.plan(
      worldInterest(x, z, {
        velocity: { x: velocityX, y: velocityZ },
        importance,
        horizonSeconds,
        prefetchRadiusMeters,
      }),
      this.#frame,
    );
  }

  public async start(): Promise<void> {
    this.#assertLive();
    if (this.#state === 'running') return;
    if (this.#state !== 'created') {
      throw new Error(`R25_START_INVALID:${this.#state}`);
    }
    this.#state = 'starting';
    try {
      this.#validateGraph();
      this.#state = 'running';
      this.observability.event({
        name: 'runtime.started',
        severity: 'info',
        frame: this.#frame,
        attributes: { backend: this.backend.backend, tier: this.quality.profile.tier },
      });
    } catch (error) {
      this.#state = 'failed';
      this.observability.event({
        name: 'runtime.start.failed',
        severity: 'error',
        frame: this.#frame,
        attributes: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  public pause(): void {
    if (this.#state !== 'running') return;
    this.#state = 'paused';
    this.observability.event({
      name: 'runtime.paused',
      severity: 'info',
      frame: this.#frame,
      attributes: {},
    });
  }

  public resume(): void {
    if (this.#state !== 'paused') return;
    this.#state = 'running';
    this.observability.event({
      name: 'runtime.resumed',
      severity: 'info',
      frame: this.#frame,
      attributes: {},
    });
  }

  public async tick(deltaMs = this.clock.fixedStepMs()): Promise<R25TickResult> {
    this.#assertLive();

    if (this.#state === 'created') {
      await this.start();
    }

    const delta = this.#state === 'paused'
      ? 0
      : Math.max(0, Math.min(250, finite(deltaMs, this.clock.fixedStepMs())));

    this.clock.advance(delta);
    this.#frame += 1;

    const pacer = this.pacer.sample(delta);
    this.observability.sample('runtime.frame.ms', delta);

    const schedulerResult = await this.scheduler.runFrame({
      deltaMs: delta,
      fixedDeltaMs: this.clock.fixedStepMs(),
      simulationTick: this.clock.simulationTick(),
      timestampMs: this.clock.nowMs(),
      budget: this.#budget(),
    });

    const renderObservation: RenderObservation = freeze({
      frameMs: pacer.smoothedFrameMs,
      cpuMs: Math.max(0.01, schedulerResult.budgetUsedMs * 0.58),
      gpuMs: Math.max(0.01, this.renderGraph.compile().gpuEstimateMs),
      memoryPressure: this.#memoryPressure(),
      thermalPressure: 0,
      drawCalls: this.renderGraph.compile().passes.length * 100,
      visibleObjects: Math.min(
        this.quality.profile.maxVisibleObjects,
        this.world.snapshot().zones.length * 500,
      ),
      timestampMs: this.clock.nowMs(),
    });

    const decision = this.quality.observe(renderObservation);
    this.observability.gauge('runtime.quality.score', decision.score);
    this.observability.gauge('runtime.render.pixelRatio', estimateDynamicPixelRatio(
      decision.pixelRatio,
      renderObservation.frameMs,
      1000 / Math.max(1, decision.targetFps),
    ));

    const graphPasses = this.renderGraph.execute({
      frame: this.#frame,
      backend: this.backend.backend,
      debug: this.#debugRender,
      onError: (pass, error) => {
        this.observability.event({
          name: 'runtime.render.pass-error',
          severity: 'error',
          frame: this.#frame,
          attributes: {
            pass: String(pass.id),
            error: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
          },
        });
      },
    });

    this.#frameTimes.push(delta);
    if (this.#frameTimes.length > 512) {
      this.#frameTimes.splice(0, this.#frameTimes.length - 512);
    }

    return freeze({
      snapshot: this.snapshot(),
      intentsProcessed: this.#lastIntentsProcessed,
      worldLoads: this.#lastWorldPlan.load,
      worldUnloads: this.#lastWorldPlan.unload,
      renderPasses: graphPasses.length,
    });
  }

  public async stop(): Promise<void> {
    if (this.#state === 'stopped' || this.#state === 'created') {
      this.#state = 'stopped';
      return;
    }

    if (this.#state === 'stopping') return;
    this.#state = 'stopping';

    try {
      this.input.reset();
      this.scheduler.clear();
      this.#state = 'stopped';
      this.observability.event({
        name: 'runtime.stopped',
        severity: 'info',
        frame: this.#frame,
        attributes: {},
      });
    } catch (error) {
      this.#state = 'failed';
      throw error;
    }
  }

  public snapshot(): R25RuntimeSnapshot {
    const world = this.world.snapshot();
    const scheduler = this.scheduler.snapshot();
    const observability = this.observability.snapshot();
    const decision = this.quality.decision();

    const frameP95 = percentile(this.#frameTimes, 0.95);
    const memoryPressure = clamp01(world.pressure);
    const renderPressure = clamp01(
      scheduler.budgetUsedMs / Math.max(1, scheduler.budgetLimitMs),
    );
    const assetSnapshot = this.assets.snapshot();
    const assetPressure = clamp01(
      assetSnapshot.residentBytes / Math.max(1, assetSnapshot.maxResidentBytes),
    );
    const healthScore = clamp01(
      1 -
        frameP95 / Math.max(1, decision.targetFps === 120 ? 8.33 : 16.67) * 0.4 -
        memoryPressure * 0.2 -
        renderPressure * 0.25 -
        assetPressure * 0.15,
    );

    return freeze({
      state: this.#state,
      frame: this.#frame,
      timestampMs: this.clock.nowMs(),
      backend: this.backend.backend,
      profile: decision,
      scheduler,
      assets: assetSnapshot,
      world,
      observability,
      health: freeze({
        state: this.#state,
        frame: this.#frame,
        score: healthScore,
        grade: gradeFromScore(healthScore),
        frameP95Ms: frameP95,
        memoryPressure,
        renderPressure,
        assetPressure,
        worldPressure: memoryPressure,
        recommendations: freeze(this.#recommendations(healthScore, frameP95, renderPressure, assetPressure)),
      }),
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.input.dispose();
    this.scheduler.dispose();
    this.assets.dispose();
    this.world.dispose();
    this.observability.reset();
    this.#legacyTick = null;
    this.#frameTimes.length = 0;
  }

  #registerTasks(): void {
    this.scheduler.registerMany([
      createR25Task({
        id: 'r25.input.drain',
        phase: 'input',
        priority: 100,
        budgetMs: 0.35,
        cadenceFrames: 1,
        enabled: true,
        run: () => {
          const intents = this.input.drain(128);
          this.#lastIntentsProcessed = intents.length;
          this.observability.counter('runtime.intent.processed', intents.length);
        },
      }),
      createR25Task({
        id: 'r25.world.plan',
        phase: 'streaming',
        priority: 90,
        budgetMs: 0.75,
        cadenceFrames: 1,
        enabled: true,
        run: () => {
          this.#lastWorldPlan = this.world.plan(
            worldInterest(0, 0),
            this.#frame,
          );
        },
      }),
      createR25Task({
        id: 'r25.assets.sweep',
        phase: 'streaming',
        priority: 50,
        budgetMs: 0.3,
        cadenceFrames: 15,
        enabled: true,
        run: () => {
          const evicted = this.assets.sweep(this.clock.simulationTick());
          this.observability.counter('runtime.assets.evicted', evicted.length);
        },
      }),
      createR25Task({
        id: 'r25.legacy.tick',
        phase: 'simulation',
        priority: 80,
        budgetMs: 1,
        cadenceFrames: 1,
        enabled: true,
        run: async () => {
          await this.#legacyTick?.();
        },
      }),
      createR25Task({
        id: 'r25.telemetry.flush',
        phase: 'telemetry',
        priority: 10,
        budgetMs: 0.15,
        cadenceFrames: 4,
        enabled: true,
        run: () => {
          this.observability.gauge('runtime.world.pressure', this.world.snapshot().pressure);
          this.observability.gauge('runtime.asset.pressure', this.#memoryPressure());
        },
      }),
    ]);
  }

  #budget(): RuntimeBudget {
    const profile = this.quality.profile;
    return freeze({
      frameMs: 1000 / Math.max(1, profile.targetFps),
      cpuMs: profile.targetFps >= 120 ? 6.5 : 10,
      gpuMs: profile.targetFps >= 120 ? 7.2 : 13.5,
      memoryBytes: this.world.snapshot().residentBytes,
      assetBytes: this.assets.snapshot().residentBytes,
      residentZones: this.world.snapshot().zones.filter((zone) => zone.state === 'ready').length,
    });
  }

  #memoryPressure(): number {
    const world = this.world.snapshot();
    const assets = this.assets.snapshot();
    return clamp01(
      world.pressure * 0.55 +
      assets.residentBytes / Math.max(1, assets.maxResidentBytes) * 0.45,
    );
  }

  #validateGraph(): void {
    const plan = this.renderGraph.compile();
    if (plan.hazards.length > 0) {
      throw new Error(`R25_GRAPH_INVALID:${plan.hazards.join('|')}`);
    }
    if (plan.passes.length === 0) {
      throw new Error('R25_GRAPH_EMPTY');
    }
  }

  #recommendations(
    score: number,
    frameP95: number,
    renderPressure: number,
    assetPressure: number,
  ): readonly string[] {
    const recommendations: string[] = [];
    if (frameP95 > 24) recommendations.push('reduce-dynamic-resolution');
    if (renderPressure > 0.9) recommendations.push('lower-post-processing');
    if (assetPressure > 0.85) recommendations.push('evict-cold-assets');
    if (score < 0.55) recommendations.push('enter-safe-render-tier');
    if (this.backend.backend === 'webgl') recommendations.push('prefer-webgpu-or-webgl2');
    return Object.freeze(recommendations);
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_RUNTIME_DISPOSED');
  }
}

type WorldPlanId = string;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

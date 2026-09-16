import { DeviceTier, RuntimeConfig, RuntimeEventMap, RuntimeHealth, RuntimeMode, TIER_CONFIG, DEFAULT_BUDGETS, TaskLane, RuntimeClockState, asTick, clamp, stableNumber } from './contracts.ts';
import { DeterministicClock, DeterministicWorld } from './deterministicWorld.ts';
import { EcsWorld, registerCoreComponents } from './ecs.ts';
import { AdaptiveBudgetController, FrameScheduler } from './scheduler.ts';
import { InputBuffer, InputRecorder, RawInputState } from './input.ts';
import { TelemetryCollector, HealthMonitor } from './telemetry.ts';
import { NetworkSession, NetworkMetrics } from './network.ts';
import { RenderGraph, DEFAULT_RENDER_BUDGET, RenderCandidate } from './render.ts';

export interface RuntimeHooks {
  readonly now?: () => number;
  readonly beforeTick?: (tick: number) => void;
  readonly afterTick?: (tick: number) => void;
  readonly onHealth?: (health: RuntimeHealth) => void;
}

export interface RuntimeSnapshot {
  readonly mode: RuntimeMode;
  readonly clock: RuntimeClockState;
  readonly health: RuntimeHealth | null;
  readonly entities: number;
  readonly frame: number;
  readonly network: NetworkMetrics;
}

const createConfig = (tier: DeviceTier, networkMode: RuntimeConfig['networkMode']): RuntimeConfig => Object.freeze({ deviceTier: tier, mode: 'booting', networkMode, ...TIER_CONFIG[tier] });

export class NextGenRuntime {
  readonly config: RuntimeConfig;
  readonly ecs: EcsWorld;
  readonly clock: DeterministicClock;
  readonly world: DeterministicWorld;
  readonly scheduler: FrameScheduler;
  readonly input: InputBuffer;
  readonly recorder: InputRecorder;
  readonly telemetry: TelemetryCollector;
  readonly healthMonitor: HealthMonitor;
  readonly network: NetworkSession | null;
  readonly render: RenderGraph;
  readonly components: ReturnType<typeof registerCoreComponents>;
  readonly #listeners = new Map<keyof RuntimeEventMap, Set<(value: never) => void>>();
  readonly #hooks: RuntimeHooks;
  readonly #budgetController: AdaptiveBudgetController;
  #mode: RuntimeMode = 'stopped';
  #frame = 0;
  #running = false;
  #lastNow: number | null = null;
  #lastHealth: RuntimeHealth | null = null;

  constructor(options: { readonly tier?: DeviceTier; readonly networkMode?: RuntimeConfig['networkMode']; readonly seed?: number; readonly hooks?: RuntimeHooks } = {}) {
    const tier = options.tier ?? 'balanced';
    this.config = createConfig(tier, options.networkMode ?? 'offline');
    this.#hooks = options.hooks ?? {};
    const now = this.#hooks.now ?? (() => performance.now());
    this.ecs = new EcsWorld();
    this.components = registerCoreComponents(this.ecs);
    this.clock = new DeterministicClock({ fixedStepMs: this.config.fixedStepMs, maxCatchUpSteps: this.config.maxCatchUpSteps });
    this.world = new DeterministicWorld(options.seed ?? 0x41a4d2);
    this.scheduler = new FrameScheduler();
    this.input = new InputBuffer();
    this.recorder = new InputRecorder();
    this.telemetry = new TelemetryCollector();
    this.healthMonitor = new HealthMonitor();
    this.network = options.networkMode === 'offline' ? null : new NetworkSession(options.networkMode === 'host' ? 'host' : options.networkMode === 'server' ? 'server' : 'client');
    this.render = new RenderGraph(DEFAULT_RENDER_BUDGET);
    this.#budgetController = new AdaptiveBudgetController(this.config.budgets);
    this.#lastNow = now();
  }

  on<K extends keyof RuntimeEventMap>(event: K, listener: (value: RuntimeEventMap[K]) => void): () => void {
    let listeners = this.#listeners.get(event);
    if (!listeners) { listeners = new Set(); this.#listeners.set(event, listeners); }
    listeners.add(listener as (value: never) => void);
    return () => listeners.delete(listener as (value: never) => void);
  }

  start(now = this.#hooks.now?.() ?? performance.now()): void {
    if (this.#running) return;
    this.#running = true;
    this.#setMode('running');
    this.#lastNow = now;
  }

  pause(): void { if (this.#running) this.#setMode('paused'); }
  resume(): void { if (this.#running && this.#mode === 'paused') this.#setMode('running'); }

  stop(): void {
    this.#running = false;
    if (this.#mode !== 'stopped') this.#setMode('stopping');
    this.scheduler.shutdown();
    this.#setMode('stopped');
  }

  frame(now = this.#hooks.now?.() ?? performance.now(), rawInput: RawInputState = {}): RuntimeSnapshot {
    if (!this.#running) this.start(now);
    const previous = this.#lastNow ?? now;
    const realDeltaMs = clamp(now - previous, 0, 250);
    this.#lastNow = now;
    this.#frame += 1;
    const inputFrame = this.input.push(this.clock.tick + 1, rawInput);
    this.recorder.record(inputFrame);
    const started = now;
    const clockResult = this.clock.advance(realDeltaMs, (dtSeconds, tick) => {
      this.telemetry.beginTick(tick);
      this.#hooks.beforeTick?.(tick);
      this.world.step(dtSeconds);
      this.ecs.setTick(Number(tick));
      this.#hooks.afterTick?.(tick);
      this.#emit('tick', { state: this.clockState(realDeltaMs, dtSeconds) });
    });
    this.telemetry.recordFrame(Math.max(0, (this.#hooks.now?.() ?? performance.now()) - started));
    const frameMs = stableNumber(Math.max(0, (this.#hooks.now?.() ?? performance.now()) - started));
    const adaptive = this.#budgetController.observe(frameMs);
    const memory = this.#estimateMemory();
    const health = this.healthMonitor.evaluate({ frameMs, simulationMs: this.telemetry.snapshot().lane.simulation.mean, memoryBytes: memory, networkBytes: this.network?.metrics().receivedBytes ?? 0, activeEntities: this.ecs.metrics().alive, queuedStreams: 0, assetBytes: 0 }, adaptive.budgets, { maxEntities: this.config.maxEntities, maxAssetBytes: this.config.maxAssetBytes, maxNetworkBytes: this.config.maxNetworkBytesPerTick });
    this.#lastHealth = health;
    this.#hooks.onHealth?.(health);
    this.#emit('health', { health });
    return this.snapshot(clockResult.state.realDeltaSeconds * 1000);
  }

  submitRender(item: RenderCandidate): boolean { return this.render.submit(item); }
  buildRenderPlan(): ReturnType<RenderGraph['plan']> { const plan = this.render.plan(); this.#emit('render', { plan }); return plan; }

  registerTask(task: Parameters<FrameScheduler['register']>[0]): void { this.scheduler.register(task); }

  snapshot(realDeltaMs = 0): RuntimeSnapshot {
    const state = this.clockState(realDeltaMs / 1000, this.config.fixedStepMs / 1000);
    return Object.freeze({ mode: this.#mode, clock: state, health: this.#lastHealth, entities: this.ecs.metrics().alive, frame: this.#frame, network: this.network?.metrics() ?? Object.freeze({ sentBytes: 0, receivedBytes: 0, snapshots: 0, deltas: 0, corrections: 0, rejectedPackets: 0, rttMs: 0, jitterMs: 0 }) });
  }

  mode(): RuntimeMode { return this.#mode; }
  get running(): boolean { return this.#running; }

  private clockState(realDeltaMs: number, simulationDeltaSeconds: number): RuntimeClockState {
    return Object.freeze({ tick: asTick(this.clock.tick), elapsedSeconds: this.clock.elapsedSeconds, realDeltaSeconds: realDeltaMs / 1000, simulationDeltaSeconds: stableNumber(simulationDeltaSeconds), timeScale: 1, paused: this.#mode === 'paused' });
  }

  private #setMode(next: RuntimeMode): void {
    const previous = this.#mode;
    if (previous === next) return;
    this.#mode = next;
    this.#emit('mode', { previous, next });
  }

  private #emit<K extends keyof RuntimeEventMap>(event: K, value: RuntimeEventMap[K]): void {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) (listener as (value: RuntimeEventMap[K]) => void)(value);
  }

  private #estimateMemory(): number {
    const entities = this.ecs.metrics();
    return entities.components * 96 + entities.alive * 256;
  }
}

export const createRuntime = (tier: DeviceTier = 'balanced', networkMode: RuntimeConfig['networkMode'] = 'offline', seed = 1): NextGenRuntime => new NextGenRuntime({ tier, networkMode, seed });

export const runtimeDeviceTier = (hardwareConcurrency = 4, memoryGb = 4, pixelRatio = 1): DeviceTier => {
  const score = hardwareConcurrency * 0.8 + memoryGb * 1.4 + pixelRatio * 0.4;
  if (score >= 16) return 'ultra';
  if (score >= 11) return 'high';
  if (score >= 7) return 'balanced';
  return 'low';
};

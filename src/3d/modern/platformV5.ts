import {
  type RuntimePhaseV4,
  type RuntimeHealthV4,
  type QualityTierV4,
  type RuntimeStatsV4,
  type RenderViewV4,
  type BudgetUsageV4,
  type RuntimeSnapshotV4,
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  tickId,
  vec3V4,
} from './runtimeContractsV4';
import { RuntimeKernelV5, type KernelSubsystemV5 } from './runtimeKernelV5';
import { EcsWorldV5, type MovementCommandV5 } from './ecsWorldV5';
import { StateStoreV5 } from './stateStoreV5';
import { NetcodeV5 } from './netcodeV5';
import { AssetGraphV5 } from './assetGraphV5';
import { RenderGraphV5 } from './renderGraphV5';
import { ObservabilityV4 } from './observabilityV4';

export interface PlatformV5Options {
  readonly id?: string;
  readonly now?: () => number;
  readonly fixedStepMs?: number;
  readonly maxEntities?: number;
  readonly maxFrameDeltaMs?: number;
}

export interface PlatformFrameV5 {
  readonly frame: number;
  readonly tick: number;
  readonly phase: RuntimePhaseV4;
  readonly stats: RuntimeStatsV4;
  readonly health: RuntimeHealthV4;
}

export interface PlatformSnapshotV5 {
  readonly kernel: ReturnType<RuntimeKernelV5['snapshot']>;
  readonly state: readonly import('./stateStoreV5').StateEntryV5[];
  readonly checksum: string;
}

export interface PlatformMetricsV5 {
  readonly kernel: ReturnType<RuntimeKernelV5['metrics']>;
  readonly ecs: ReturnType<EcsWorldV5['metrics']>;
  readonly state: ReturnType<StateStoreV5['metrics']>;
  readonly network: ReturnType<NetcodeV5['metrics']>;
  readonly assets: ReturnType<AssetGraphV5['metrics']>;
  readonly render: ReturnType<RenderGraphV5['metrics']>;
  readonly observability: ReturnType<ObservabilityV4['snapshot']>;
}

const hash = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export class ModernPlatformV5 {
  readonly kernel: RuntimeKernelV5;
  readonly ecs: EcsWorldV5;
  readonly state: StateStoreV5;
  readonly network: NetcodeV5;
  readonly assets: AssetGraphV5;
  readonly renderGraph: RenderGraphV5;
  readonly observability: ObservabilityV4;
  #player: import('./ecsWorldV5').EntityHandleV5 | null = null;
  #playerCommand: MovementCommandV5 = { direction: vec3V4(), sprint: false, jumpPressed: false, crouch: false };
  #running = false;
  #phase: RuntimePhaseV4 = 'boot';
  #errors = 0;
  #lastFrameMs = 0;

  constructor(options: PlatformV5Options = {}) {
    this.kernel = new RuntimeKernelV5({ id: options.id, now: options.now, fixedStepMs: options.fixedStepMs, maxFrameDeltaMs: options.maxFrameDeltaMs });
    this.ecs = new EcsWorldV5({ maxEntities: options.maxEntities });
    this.state = new StateStoreV5({ now: options.now });
    this.network = new NetcodeV5({ now: options.now });
    this.assets = new AssetGraphV5();
    this.renderGraph = new RenderGraphV5();
    this.observability = new ObservabilityV4({ now: options.now });
    this.installSystems();
  }

  phase(): RuntimePhaseV4 { return this.#phase; }

  boot(): OutcomeV4<boolean> {
    const result = this.kernel.start();
    if (!result.ok) return result;
    this.#running = true;
    this.#phase = 'running';
    this.observability.setPhase('running');
    return okV4(true);
  }

  pause(): boolean {
    const result = this.kernel.pause();
    if (result) { this.#phase = 'paused'; this.observability.setPhase('paused'); }
    return result;
  }

  resume(): boolean {
    const result = this.kernel.resume();
    if (result) { this.#phase = 'running'; this.observability.setPhase('running'); }
    return result;
  }

  stop(): boolean {
    const result = this.kernel.stop();
    if (result) { this.#running = false; this.#phase = 'stopped'; this.observability.setPhase('stopped'); }
    return result;
  }

  spawnPlayer(x = 0, y = 0, z = 0): OutcomeV4<import('./ecsWorldV5').EntityHandleV5> {
    const spawned = this.ecs.spawn(vec3V4(x, y, z));
    if (spawned.ok) this.#player = spawned.value;
    return spawned;
  }

  player(): import('./ecsWorldV5').EntityHandleV5 | null { return this.#player; }

  setPlayerCommand(command: MovementCommandV5): void {
    this.#playerCommand = Object.freeze({ direction: vec3V4(command.direction.x, command.direction.y, command.direction.z), sprint: Boolean(command.sprint), jumpPressed: Boolean(command.jumpPressed), crouch: Boolean(command.crouch) });
  }

  movePlayer(x: number, y: number, z: number, sprint = false): void { this.setPlayerCommand({ direction: vec3V3(x, y, z), sprint, jumpPressed: false, crouch: false }); }

  async frame(view: RenderViewV4): Promise<OutcomeV4<PlatformFrameV5>> {
    if (!this.#running || this.#phase !== 'running') return failV4(createRuntimeErrorV4('PLATFORM_NOT_RUNNING', 'Modern platform is not running', true));
    const started = this.kernel.metrics().frame;
    try {
      const report = await this.kernel.frame();
      this.#phase = report.phase === 'degraded' ? 'running' : report.phase as RuntimePhaseV4;
      this.#lastFrameMs = report.deltaMs;
      const player = this.#player;
      const entityCount = this.ecs.metrics().live;
      const packetUsage: BudgetUsageV4 = { frameMs: report.deltaMs, cpuMs: this.kernel.metrics().averageFrameMs, gpuMs: 0, networkBytes: this.network.metrics().sentBytes + this.network.metrics().receivedBytes, assetBytes: 0, drawCalls: 0, triangles: 0, activeEntities: entityCount, visibleEntities: 0, queuedAssets: this.assets.metrics().nodes, };
      const stats: RuntimeStatsV4 = { frame: report.frame, tick: report.tick, deltaMs: report.deltaMs, cpuMs: this.kernel.metrics().averageFrameMs, gpuMs: 0, entityCount, visibleCount: 0, queuedCommands: 0, queuedAssets: packetUsage.queuedAssets };
      const health = this.health();
      this.observability.frame(report.deltaMs, report.errors, this.#phase);
      void view;
      void player;
      void started;
      return okV4(Object.freeze({ frame: report.frame, tick: Number(report.tick), phase: this.#phase, stats, health }));
    } catch (cause) {
      this.#errors += 1;
      this.observability.log('error', cause instanceof Error ? cause.message : 'Modern platform frame failed');
      return failV4(createRuntimeErrorV4('PLATFORM_FRAME_FAILED', cause instanceof Error ? cause.message.slice(0, 300) : 'Frame failed', true));
    }
  }

  health(): RuntimeHealthV4 {
    const kernel = this.kernel.metrics();
    const obs = this.observability.health();
    const network = this.network.metrics();
    const assets = this.assets.metrics();
    const render = this.renderGraph.metrics();
    const score = Math.max(0, Math.min(100, obs.score - this.#errors * 4 - Math.min(20, network.malformedPackets * 2) - Math.min(20, assets.failed) - Math.min(20, render.invalidPlans * 3)));
    return Object.freeze({ phase: this.#phase, score, errors: this.#errors + kernel.totalErrors, warnings: kernel.totalOverruns + render.invalidPlans, stalled: kernel.worstFrameMs > 150, memoryPressure: 0, networkPressure: Math.min(1, (network.sentBytes + network.receivedBytes) / 10_000_000), renderPressure: 0, simulationDrift: Math.max(0, kernel.averageFrameMs / this.kernel.fixedStepMs - 1) });
  }

  snapshot(): PlatformSnapshotV5 {
    const kernel = this.kernel.snapshot();
    const state = this.state.snapshotWithMetadata();
    return Object.freeze({ kernel, state, checksum: hash({ kernel, state }) });
  }

  restore(snapshot: PlatformSnapshotV5): OutcomeV4<boolean> {
    if (hash({ kernel: snapshot.kernel, state: snapshot.state }) !== snapshot.checksum) return failV4(createRuntimeErrorV4('PLATFORM_SNAPSHOT_CHECKSUM', 'Platform snapshot checksum mismatch', false));
    const restored = this.kernel.restore(snapshot.kernel);
    if (!restored.ok) return restored;
    const state = this.state.restore(snapshot.state, true);
    if (!state.ok) return state;
    this.#phase = this.kernel.phase() as RuntimePhaseV4;
    this.#running = this.#phase === 'running' || this.#phase === 'degraded';
    return okV4(true);
  }

  recover(reason = 'manual'): Promise<OutcomeV4<boolean>> {
    this.#phase = 'recovering';
    return this.kernel.recover(reason).then((result) => {
      this.#phase = result.ok ? 'running' : 'failed';
      this.#running = result.ok;
      return result;
    });
  }

  metrics(): PlatformMetricsV5 {
    return Object.freeze({ kernel: this.kernel.metrics(), ecs: this.ecs.metrics(), state: this.state.metrics(), network: this.network.metrics(), assets: this.assets.metrics(), render: this.renderGraph.metrics(), observability: this.observability.snapshot() });
  }

  quality(): QualityTierV4 { return this.renderGraph.quality(); }
  setQuality(quality: QualityTierV4): void { this.renderGraph.setQuality(quality); }

  installSubsystem(subsystem: KernelSubsystemV5): void { this.kernel.register(subsystem); }

  #installSystems(): void {
    this.kernel.register({ name: 'v5.ecs', subsystem: 'ecs', priority: 'high', maxMs: 3, run: (context) => { if (this.#player) { this.ecs.move(this.#player, this.#playerCommand, context.deltaMs / 1000, context.tick); this.ecs.tickStamina(this.#player, this.#playerCommand.sprint, context.deltaMs / 1000); } } });
    this.kernel.register({ name: 'v5.state', subsystem: 'world', priority: 'normal', maxMs: 1, run: (context) => { this.state.set('runtime.tick', Number(context.tick), 'system', context.tick); } });
    this.kernel.register({ name: 'v5.network', subsystem: 'network', priority: 'normal', maxMs: 1, run: () => { this.network.tick(); } });
    this.kernel.register({ name: 'v5.assets', subsystem: 'assets', priority: 'low', maxMs: 1, run: () => { this.assets.topologicalReady(8); } });
    this.kernel.register({ name: 'v5.render', subsystem: 'render', priority: 'normal', maxMs: 2, run: () => { this.renderGraph.evaluatePressure(this.#lastFrameMs, 0, 0, 0); } });
    this.kernel.register({ name: 'v5.telemetry', subsystem: 'telemetry', priority: 'background', maxMs: 0.5, run: () => { this.observability.metric('ecs.entities', this.ecs.metrics().live); } });
  }
}

function vec3V3(x = 0, y = 0, z = 0) { return vec3V4(x, y, z); }

export function createModernPlatformV5(options: PlatformV5Options = {}): ModernPlatformV5 {
  return new ModernPlatformV5(options);
}

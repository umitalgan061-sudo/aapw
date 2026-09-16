import {
  type BudgetUsageV4,
  type InputModeV4,
  type RuntimeHealthV4,
  type RuntimeId,
  type RuntimePhaseV4,
  type RuntimeSnapshotV4,
  type RuntimeStatsV4,
  type TickId,
  type RenderPacketV4,
  type RenderViewV4,
  runtimeId,
  tickId,
  createRuntimeErrorV4,
  type OutcomeV4,
  okV4,
  failV4,
  defaultBudgetV4,
  type QualityTierV4,
  vec3V4,
} from './runtimeContractsV4';
import { CommandBusV4 } from './commandBusV4';
import { SchedulerV4, type SchedulerContextV4 } from './schedulerV4';
import { SpatialIndexV4 } from './spatialIndexV4';
import { AssetStreamingV4 } from './assetStreamingV4';
import { NetworkReplicationV4 } from './networkReplicationV4';
import { RenderPipelineV4, createDefaultViewV4 } from './renderPipelineV4';
import { InputCommandRouterV4, installDefaultGameplayBindingsV4 } from './inputCommandV4';

export interface RuntimeOrchestratorOptionsV4 {
  readonly id?: string;
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly now?: () => number;
  readonly assetFetcher: ConstructorParameters<typeof AssetStreamingV4>[0];
}

export interface RuntimeFrameResultV4 {
  readonly frame: number;
  readonly tick: TickId;
  readonly simulationSteps: number;
  readonly render: RenderPacketV4;
  readonly stats: RuntimeStatsV4;
  readonly health: RuntimeHealthV4;
}

export interface RuntimeHooksV4 {
  readonly onPhase?: (phase: RuntimePhaseV4) => void;
  readonly onError?: (error: Error) => void;
  readonly onFrame?: (result: RuntimeFrameResultV4) => void;
  readonly onSnapshot?: (snapshot: RuntimeSnapshotV4) => void;
}

export interface RuntimeSnapshotStateV4 {
  readonly version: number;
  readonly phase: RuntimePhaseV4;
  readonly inputMode: InputModeV4;
  readonly quality: QualityTierV4;
  readonly tick: number;
  readonly frame: number;
  readonly entities: number;
  readonly assets: number;
  readonly peers: number;
}

export interface RuntimeMetricsV4 {
  readonly frames: number;
  readonly ticks: number;
  readonly errors: number;
  readonly snapshots: number;
  readonly recoveries: number;
  readonly commands: number;
  readonly entityQueries: number;
}

const checksum = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export class RuntimeOrchestratorV4 {
  readonly id: RuntimeId;
  readonly commandBus: CommandBusV4;
  readonly scheduler: SchedulerV4<SchedulerContextV4>;
  readonly spatial: SpatialIndexV4;
  readonly assets: AssetStreamingV4;
  readonly network: NetworkReplicationV4;
  readonly render: RenderPipelineV4;
  readonly input: InputCommandRouterV4;
  readonly fixedStepMs: number;
  readonly maxCatchUpSteps: number;
  #now: () => number;
  #phase: RuntimePhaseV4 = 'boot';
  #lastTime = 0;
  #frame = 0;
  #tick = 0;
  #errors = 0;
  #recoveries = 0;
  #snapshots = 0;
  #hooks: RuntimeHooksV4 = {};
  #lastSnapshot: RuntimeSnapshotV4<RuntimeSnapshotStateV4> | null = null;
  #running = false;
  #stopping = false;
  #frameInFlight = false;

  constructor(options: RuntimeOrchestratorOptionsV4) {
    this.id = runtimeId(options.id ?? `runtime-v4-${Math.trunc(Date.now())}`);
    this.fixedStepMs = Math.max(1, options.fixedStepMs ?? 1000 / 60);
    this.maxCatchUpSteps = Math.max(1, Math.trunc(options.maxCatchUpSteps ?? 4));
    this.#now = options.now ?? (() => performance.now());
    this.#lastTime = this.#now();
    this.commandBus = new CommandBusV4({ now: this.#now });
    this.scheduler = new SchedulerV4<SchedulerContextV4>({ fixedStepMs: this.fixedStepMs, maxCatchUpSteps: this.maxCatchUpSteps, now: this.#now });
    this.spatial = new SpatialIndexV4(32);
    this.assets = new AssetStreamingV4(options.assetFetcher, undefined, { now: this.#now });
    this.network = new NetworkReplicationV4();
    this.render = new RenderPipelineV4({ initialQuality: 'high', now: this.#now });
    this.input = new InputCommandRouterV4({ now: this.#now });
    installDefaultGameplayBindingsV4(this.input);
    this.#installCoreCommands();
    this.#installCoreTasks();
  }

  setHooks(hooks: RuntimeHooksV4): void {
    this.#hooks = hooks;
  }

  phase(): RuntimePhaseV4 {
    return this.#phase;
  }

  start(): OutcomeV4<RuntimeId> {
    if (this.#phase === 'running') return okV4(this.id);
    if (this.#phase === 'failed' || this.#phase === 'stopped') return failV4(createRuntimeErrorV4('RUNTIME_START_BLOCKED', `Runtime is ${this.#phase}`, false));
    this.#setPhase('running');
    this.#running = true;
    this.#stopping = false;
    this.#lastTime = this.#now();
    return okV4(this.id);
  }

  pause(): boolean {
    if (this.#phase !== 'running') return false;
    this.#setPhase('paused');
    return true;
  }

  resume(): boolean {
    if (this.#phase !== 'paused') return false;
    this.#setPhase('running');
    this.#lastTime = this.#now();
    return true;
  }

  stop(): boolean {
    if (this.#phase === 'stopped' || this.#phase === 'stopping') return false;
    this.#stopping = true;
    this.#running = false;
    this.#setPhase('stopping');
    this.assets.abortAll();
    this.commandBus.flushRejected('Runtime stopped');
    this.#setPhase('stopped');
    this.#stopping = false;
    return true;
  }

  async frame(view: RenderViewV4 = createDefaultViewV4(), usage?: Partial<BudgetUsageV4>): Promise<OutcomeV4<RuntimeFrameResultV4>> {
    if (!this.#running || this.#phase !== 'running') return failV4(createRuntimeErrorV4('RUNTIME_NOT_RUNNING', 'Runtime is not running', true));
    if (this.#frameInFlight) return failV4(createRuntimeErrorV4('RUNTIME_FRAME_BUSY', 'A frame is already executing', true));
    this.#frameInFlight = true;
    try {
      const now = this.#now();
      const delta = Math.max(0, Math.min(250, now - this.#lastTime));
      this.#lastTime = now;
      const beforeTick = this.#tick;
      const executions = await this.scheduler.advance(
        (context) => context,
        delta,
      );
      this.#tick = Number(this.scheduler.tick);
      this.#frame += 1;
      const simulationSteps = Math.max(0, this.#tick - beforeTick);
      await this.commandBus.drain(128);
      const budgets: BudgetUsageV4 = {
        frameMs: delta,
        cpuMs: this.scheduler.metrics().averageTickMs,
        gpuMs: 0,
        networkBytes: this.network.metrics().bytesEstimated,
        assetBytes: this.assets.metrics().bytesLoaded,
        drawCalls: executions.filter((entry) => entry.lane === 'render' && !entry.skipped).length,
        triangles: 0,
        activeEntities: this.spatial.metrics().items,
        visibleEntities: 0,
        queuedAssets: this.assets.metrics().queued,
      };
      const packet = this.render.build(view, budgets);
      const health = this.health();
      const stats: RuntimeStatsV4 = {
        frame: this.#frame,
        tick: tickId(this.#tick),
        deltaMs: delta,
        cpuMs: budgets.cpuMs,
        gpuMs: budgets.gpuMs,
        entityCount: budgets.activeEntities,
        visibleCount: packet.items.length,
        queuedCommands: this.commandBus.size,
        queuedAssets: budgets.queuedAssets,
      };
      this.render.evaluate({ frameMs: delta, cpuMs: budgets.cpuMs, gpuMs: 0, drawCalls: packet.items.length, triangles: 0, visibleEntities: packet.items.length, memoryPressure: 0, thermalPressure: 0 });
      const result: RuntimeFrameResultV4 = Object.freeze({ frame: this.#frame, tick: tickId(this.#tick), simulationSteps, render: packet, stats, health });
      this.#hooks.onFrame?.(result);
      return okV4(result);
    } catch (cause) {
      this.#errors += 1;
      const error = cause instanceof Error ? cause : new Error('Runtime frame failed');
      this.#hooks.onError?.(error);
      return failV4(createRuntimeErrorV4('RUNTIME_FRAME_FAILED', error.message.slice(0, 300), true));
    } finally {
      this.#frameInFlight = false;
    }
  }

  dispatchInput(tick: number): number {
    const commands = this.input.consume(128);
    let accepted = 0;
    for (const command of commands) {
      void this.commandBus.dispatch('input.intent', command, 'ui', tickId(Math.max(0, Math.trunc(tick))), this.#trace());
      accepted += 1;
    }
    return accepted;
  }

  health(): RuntimeHealthV4 {
    const scheduler = this.scheduler.metrics();
    const render = this.render.metrics();
    const network = this.network.metrics();
    const pressure = render.pressure;
    const stalled = this.#phase === 'running' && scheduler.maxTickMs > 100;
    const score = Math.max(0, Math.min(100, 100 - this.#errors * 5 - pressure * 25 - (stalled ? 20 : 0)));
    return Object.freeze({ phase: this.#phase, score, errors: this.#errors, warnings: render.dropped + network.staleRejected, stalled, memoryPressure: 0, networkPressure: network.peers > 0 ? Math.min(1, network.bytesEstimated / 5_000_000) : 0, renderPressure: pressure, simulationDrift: Math.max(0, scheduler.averageTickMs / this.fixedStepMs - 1) });
  }

  snapshot(): RuntimeSnapshotV4<RuntimeSnapshotStateV4> {
    const state: RuntimeSnapshotStateV4 = Object.freeze({ version: 4, phase: this.#phase, inputMode: this.input.mode(), quality: this.render.quality(), tick: this.#tick, frame: this.#frame, entities: this.spatial.metrics().items, assets: this.assets.metrics().registered, peers: this.network.metrics().peers });
    const headerBase = { version: 4, runtime: this.id, tick: tickId(this.#tick), createdAt: this.#now() };
    const header = Object.freeze({ ...headerBase, checksum: checksum({ ...headerBase, state }) });
    const snapshot: RuntimeSnapshotV4<RuntimeSnapshotStateV4> = Object.freeze({ header, state });
    this.#lastSnapshot = snapshot;
    this.#snapshots += 1;
    this.#hooks.onSnapshot?.(snapshot);
    return snapshot;
  }

  restore(snapshot: RuntimeSnapshotV4<RuntimeSnapshotStateV4>): OutcomeV4<boolean> {
    const expected = checksum({ version: snapshot.header.version, runtime: snapshot.header.runtime, tick: snapshot.header.tick, createdAt: snapshot.header.createdAt, state: snapshot.state });
    if (expected !== snapshot.header.checksum) return failV4(createRuntimeErrorV4('RUNTIME_SNAPSHOT_CHECKSUM', 'Snapshot checksum mismatch', false));
    if (snapshot.header.runtime !== this.id) return failV4(createRuntimeErrorV4('RUNTIME_SNAPSHOT_RUNTIME', 'Snapshot belongs to another runtime', false));
    this.#tick = Math.max(0, Math.trunc(snapshot.state.tick));
    this.#frame = Math.max(0, Math.trunc(snapshot.state.frame));
    this.render.setQuality(snapshot.state.quality, 'snapshot-restore');
    this.input.setMode(snapshot.state.inputMode);
    if (snapshot.state.phase === 'paused') this.#setPhase('paused');
    else if (snapshot.state.phase === 'running') this.#setPhase('running');
    this.#lastSnapshot = snapshot;
    return okV4(true);
  }

  recover(reason = 'manual'): boolean {
    if (this.#phase === 'stopped') return false;
    this.#recoveries += 1;
    this.#setPhase('recovering');
    this.commandBus.flushRejected(`Recovery: ${reason}`);
    this.input.clear();
    this.assets.abortAll();
    this.#lastTime = this.#now();
    this.#setPhase('running');
    return true;
  }

  metrics(): RuntimeMetricsV4 {
    const scheduler = this.scheduler.metrics();
    return Object.freeze({ frames: this.#frame, ticks: scheduler.ticks, errors: this.#errors, snapshots: this.#snapshots, recoveries: this.#recoveries, commands: this.commandBus.metrics().applied, entityQueries: this.spatial.metrics().queries });
  }

  lastSnapshot(): RuntimeSnapshotV4<RuntimeSnapshotStateV4> | null {
    return this.#lastSnapshot;
  }

  setQuality(tier: QualityTierV4): boolean {
    return this.render.setQuality(tier, 'runtime');
  }

  setInputMode(mode: InputModeV4): void {
    this.input.setMode(mode);
  }

  #trace(): ReturnType<typeof import('./runtimeContractsV4').traceId> {
    return import('./runtimeContractsV4').traceId(`${String(this.id)}:${this.#frame}:${this.#tick}`);
  }

  #setPhase(phase: RuntimePhaseV4): void {
    this.#phase = phase;
    this.#hooks.onPhase?.(phase);
  }

  #installCoreCommands(): void {
    this.commandBus.register({ type: 'input.intent', handle: (command) => command.payload });
    this.commandBus.register({ type: 'runtime.pause', handle: () => this.pause() });
    this.commandBus.register({ type: 'runtime.resume', handle: () => this.resume() });
    this.commandBus.register({ type: 'runtime.snapshot', handle: () => this.snapshot() });
    this.commandBus.register({ type: 'runtime.recover', handle: (command) => this.recover(String(command.payload ?? 'command')) });
    this.commandBus.register({ type: 'runtime.quality', handle: (command) => this.setQuality(command.payload as QualityTierV4) });
  }

  #installCoreTasks(): void {
    this.scheduler.register({ id: 'runtime.input', lane: 'input', priority: 100, intervalTicks: 1, maxRuntimeMs: 1, run: () => { this.dispatchInput(this.#tick); } });
    this.scheduler.register({ id: 'runtime.network', lane: 'network', priority: 75, intervalTicks: 1, maxRuntimeMs: 1.5, run: () => { void this.network.metrics(); } });
    this.scheduler.register({ id: 'runtime.assets', lane: 'assets', priority: 55, intervalTicks: 2, maxRuntimeMs: 2, run: () => { void this.assets.pump(); } });
    this.scheduler.register({ id: 'runtime.world', lane: 'world', priority: 80, intervalTicks: 1, maxRuntimeMs: 2, run: () => { void this.spatial.metrics(); } });
    this.scheduler.register({ id: 'runtime.audio', lane: 'audio', priority: 60, intervalTicks: 1, maxRuntimeMs: 1, run: () => undefined });
    this.scheduler.register({ id: 'runtime.render', lane: 'render', priority: 50, intervalTicks: 1, maxRuntimeMs: 2, run: () => undefined });
    this.scheduler.register({ id: 'runtime.telemetry', lane: 'telemetry', priority: 10, intervalTicks: 30, maxRuntimeMs: 0.5, run: () => { void this.health(); } });
  }
}

export function runtimeOrchestratorDefaultsV4(): { readonly budgets: ReturnType<typeof defaultBudgetV4>; readonly view: RenderViewV4 } {
  return Object.freeze({ budgets: defaultBudgetV4('high'), view: createDefaultViewV4(1280, 720) });
}

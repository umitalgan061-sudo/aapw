import { DeterministicInputBuffer, RawInputState, neutralInput } from './input.ts';
import { TypedCommandBus } from './commandBus.ts';
import { DeterministicScheduler, createSystem } from './scheduler.ts';
import { EntityComponentWorld } from './ecs.ts';
import { FixedStepClock } from './fixedStep.ts';
import { SnapshotHistory, diffSnapshots, applyDelta } from './network.ts';
import { BudgetedResourceCache, ResourceLoader } from './resourceCache.ts';
import {
  DEFAULT_SIMULATION_CONFIG,
  EntityId,
  InputFrame,
  LifecycleState,
  RuntimeFault,
  RuntimeFrame,
  RuntimeHealth,
  RuntimeMetrics,
  SimulationConfig,
  SystemContext,
  SystemDefinition,
  Tick,
  WorldSnapshot,
  hashString,
  stableChecksum,
  tickValue,
} from './types.ts';

export interface RuntimeKernelOptions<TResource = unknown> {
  simulation?: Partial<SimulationConfig>;
  resources: ResourceLoader<TResource>;
  resourceConfig?: ConstructorParameters<typeof BudgetedResourceCache<TResource>>[1];
  initialSystems?: readonly SystemDefinition[];
  commandSource?: string;
}

export interface KernelHooks {
  onLifecycle?: (state: LifecycleState) => void;
  onFault?: (fault: RuntimeFault) => void;
  onFrame?: (frame: RuntimeFrame) => void;
}

export interface KernelState {
  lifecycle: LifecycleState;
  tick: Tick;
  revision: number;
  metrics: RuntimeMetrics;
}

export class NextGenRuntimeKernel<TResource = unknown> {
  readonly config: SimulationConfig;
  readonly world = new EntityComponentWorld();
  readonly commands: TypedCommandBus;
  readonly input: DeterministicInputBuffer;
  readonly snapshots = new SnapshotHistory(180);
  readonly resources: BudgetedResourceCache<TResource>;
  readonly clock: FixedStepClock;
  readonly scheduler: DeterministicScheduler;
  readonly #hooks: KernelHooks;
  readonly #registeredSystems = new Set<string>();
  #lifecycle: LifecycleState = { phase: 'cold' };
  #revision = 0;
  #frameTimeMs = 0;
  #simulationTimeMs = 0;
  #networkTimeMs = 0;
  #renderTimeMs = 0;
  #snapshotBytes = 0;
  #lastSnapshot: WorldSnapshot | undefined;
  #lastFault: RuntimeFault | undefined;

  constructor(options: RuntimeKernelOptions<TResource>, hooks: KernelHooks = {}) {
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...(options.simulation ?? {}) };
    this.#hooks = hooks;
    this.commands = new TypedCommandBus({ sourceId: options.commandSource ?? 'nextgen' });
    this.input = new DeterministicInputBuffer();
    this.resources = new BudgetedResourceCache(options.resources, options.resourceConfig);
    this.clock = new FixedStepClock(this.config);
    this.scheduler = new DeterministicScheduler({ systems: [] });
    for (const system of options.initialSystems ?? []) this.registerSystem(system);
    this.#installCoreSystems();
  }

  get lifecycle(): LifecycleState { return { ...this.#lifecycle }; }
  get lastFault(): RuntimeFault | undefined { return this.#lastFault ? { ...this.#lastFault } : undefined; }

  boot(): void {
    if (this.#lifecycle.phase !== 'cold' && this.#lifecycle.phase !== 'stopped') return;
    this.#transition({ phase: 'booting' });
    this.#revision += 1;
    this.#transition({ phase: 'ready' });
  }

  start(): void {
    if (this.#lifecycle.phase === 'cold') this.boot();
    if (this.#lifecycle.phase !== 'ready' && this.#lifecycle.phase !== 'paused') throw new Error(`Cannot start runtime from ${this.#lifecycle.phase}`);
    this.#transition({ phase: 'running' });
  }

  pause(reason = 'manual'): void {
    if (this.#lifecycle.phase !== 'running') return;
    this.#transition({ phase: 'paused', reason });
  }

  stop(): void {
    if (this.#lifecycle.phase === 'stopped') return;
    this.#transition({ phase: 'stopping' });
    this.resources.clear();
    this.commands.clear();
    this.input.clear();
    this.snapshots.clearThrough(tickValue(Number.MAX_SAFE_INTEGER));
    this._resetWorld();
    this.#transition({ phase: 'stopped' });
  }

  registerSystem(system: SystemDefinition): void {
    this.scheduler.register(system);
    this.#registeredSystems.add(system.id);
  }

  unregisterSystem(id: string): boolean {
    this.#registeredSystems.delete(id);
    return this.scheduler.unregister(id);
  }

  captureInput(raw: RawInputState): InputFrame {
    const nextTick = tickValue(Number(this.clock.tick) + 1);
    return this.input.capture(nextTick, raw);
  }

  frame(deltaSeconds: number): RuntimeFrame {
    if (this.#lifecycle.phase !== 'running') return {
      tick: this.clock.tick,
      deltaSeconds: Math.max(0, deltaSeconds),
      alpha: 0,
      simulatedTicks: 0,
      droppedSeconds: 0,
    };
    const started = performance.now();
    try {
      const result = this.clock.pushFrameDelta(deltaSeconds, {
        onTick: (tick, step) => this.#tick(tick, step),
        onDrop: (seconds) => this.commands.publish('simulation.time-dropped', { seconds }, this.clock.tick, 'kernel'),
      });
      this.#frameTimeMs = performance.now() - started;
      this.#hooks.onFrame?.(result);
      return result;
    } catch (error) {
      this.#fault('FRAME_FAILURE', error, true);
      return {
        tick: this.clock.tick,
        deltaSeconds,
        alpha: 0,
        simulatedTicks: 0,
        droppedSeconds: this.clock.droppedSeconds,
      };
    }
  }

  snapshot(): WorldSnapshot {
    const entities = this.world.snapshot().map((entity) => ({
      id: entity.id,
      mask: entity.mask,
      components: entity.components,
    }));
    const snapshot: WorldSnapshot = {
      tick: this.clock.tick,
      revision: this.#revision as WorldSnapshot['revision'],
      entities,
      checksum: stableChecksum(entities),
    };
    this.snapshots.put(snapshot);
    this.#snapshotBytes = JSON.stringify(snapshot).length;
    return snapshot;
  }

  applyAuthoritativeDelta(delta: Parameters<typeof applyDelta>[1]): void {
    if (!this.#lastSnapshot) throw new Error('Cannot apply delta before baseline snapshot');
    const next = applyDelta(this.#lastSnapshot, delta);
    this.#lastSnapshot = next;
  }

  replicateSnapshot(): { tick: Tick; baseTick: Tick; upserts: number; removes: number; checksum: number } {
    const current = this.snapshot();
    const delta = diffSnapshots(this.#lastSnapshot, current);
    this.#lastSnapshot = current;
    return {
      tick: delta.tick,
      baseTick: delta.baseTick,
      upserts: delta.upserts.length,
      removes: delta.removes.length,
      checksum: delta.checksum,
    };
  }

  health(): RuntimeHealth {
    const metrics = this.metrics();
    const reasons: string[] = [];
    let score = 100;
    if (metrics.frameTimeMs > 33) { score -= 30; reasons.push('frame_budget_exceeded'); }
    else if (metrics.frameTimeMs > 20) { score -= 10; reasons.push('frame_budget_pressure'); }
    if (metrics.simulationTimeMs > 8) { score -= 25; reasons.push('simulation_budget_exceeded'); }
    if (metrics.pendingCommands > 256) { score -= 15; reasons.push('command_backlog'); }
    if (metrics.pendingResources > 64) { score -= 10; reasons.push('resource_backlog'); }
    if (this.#lastFault) { score -= 35; reasons.push(this.#lastFault.code.toLowerCase()); }
    score = Math.max(0, Math.min(100, score));
    return {
      score,
      status: score >= 80 ? 'healthy' : score >= 55 ? 'degraded' : 'critical',
      reasons,
      metrics,
    };
  }

  metrics(): RuntimeMetrics {
    const scheduler = this.scheduler.metrics();
    return {
      frameTimeMs: this.#frameTimeMs,
      simulationTimeMs: this.#simulationTimeMs,
      renderTimeMs: this.#renderTimeMs,
      networkTimeMs: this.#networkTimeMs,
      entityCount: this.world.entityCount,
      activeSystems: scheduler.activeSystems,
      pendingCommands: this.commands.commandDepth,
      pendingResources: this.resources.metrics().loading + this.resources.metrics().failed,
      snapshotBytes: this.#snapshotBytes,
    };
  }

  state(): KernelState {
    return { lifecycle: this.lifecycle, tick: this.clock.tick, revision: this.#revision, metrics: this.metrics() };
  }

  digest(): number {
    return hashString(JSON.stringify({ state: this.state(), world: this.world.snapshot(), scheduler: this.scheduler.snapshot() }));
  }

  resetSimulation(tick = tickValue(0)): void {
    this.clock.reset(tick);
    this.input.clear();
    this.commands.clear();
    this.world.clear();
    this.#lastSnapshot = undefined;
    this.#revision += 1;
  }

  #tick(tick: Tick, deltaSeconds: number): void {
    const started = performance.now();
    this.resources.advanceTick(tick);
    this.commands.processCommands();
    this.scheduler.runTick(tick, deltaSeconds);
    this.commands.publish('simulation.tick', { tick, deltaSeconds }, tick, 'kernel');
    this.#revision += 1;
    this.#simulationTimeMs = performance.now() - started;
  }

  #installCoreSystems(): void {
    if (this.#registeredSystems.has('nextgen.input')) return;
    this.registerSystem(createSystem('nextgen.input', 'input', (context) => {
      const frame = this.input.sample(context.tick);
      this.commands.dispatch('input.capture', frame);
    }, { priority: 100, budgetMs: 0.5 }));
    this.registerSystem(createSystem('nextgen.events', 'network', (context) => {
      this.commands.publish('runtime.tick', { tick: context.tick }, context.tick, 'kernel');
    }, { priority: -100, budgetMs: 0.5 }));
  }

  #transition(next: LifecycleState): void {
    this.#lifecycle = next;
    this.#hooks.onLifecycle?.({ ...next });
    this.commands.publish('runtime.lifecycle', next, this.clock.tick, 'kernel');
  }

  #fault(code: string, error: unknown, recoverable: boolean): void {
    const fault: RuntimeFault = {
      code,
      message: error instanceof Error ? error.message : String(error),
      tick: this.clock.tick,
      recoverable,
      source: 'nextgen-kernel',
    };
    this.#lastFault = fault;
    this.#transition({ phase: 'faulted', reason: fault.code });
    this.#hooks.onFault?.(fault);
  }

  _resetWorld(): void {
    this.world.clear();
    this.clock.reset();
    this.#revision = 0;
    this.#snapshotBytes = 0;
    this.#lastSnapshot = undefined;
    this.#lastFault = undefined;
  }
}

export function createNextGenKernel<TResource = unknown>(
  resources: ResourceLoader<TResource>,
  options: Omit<RuntimeKernelOptions<TResource>, 'resources'> = {},
  hooks: KernelHooks = {},
): NextGenRuntimeKernel<TResource> {
  return new NextGenRuntimeKernel({ ...options, resources }, hooks);
}

export function createNullResourceLoader(): ResourceLoader<null> {
  return {
    async load() { return null; },
    dispose() {},
  };
}

export function captureNeutralFrame(kernel: NextGenRuntimeKernel): InputFrame {
  return neutralInput(tickValue(Number(kernel.clock.tick) + 1));
}

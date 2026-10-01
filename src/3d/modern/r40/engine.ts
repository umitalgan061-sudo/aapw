import type { EntityId, RuntimeCommand, RuntimePhase, RuntimeTask, Tick, TaskBudgetReport, Vec3 } from './types';
import { commandId, tick } from './types';
import { FixedClock, hashJson } from './deterministic';
import { DeterministicTaskScheduler } from './scheduler';
import { SpatialEntityWorld, WorldSimulationBudget } from './world';
import { FrameGraph, RenderQualityGovernor } from './render';
import { AssetStreamingController } from './streaming';
import { R40Protocol } from './protocol';
import { RuntimeStateGraph } from './runtimeGraph';
import { RecoveryCoordinator } from './recovery';
import { SecurityGate } from './security';
import { MetricRegistry, HealthMonitor } from './observability';

export interface EngineStep {
  readonly tick: Tick;
  readonly alpha: number;
  readonly budget: TaskBudgetReport;
  readonly commands: readonly RuntimeCommand[];
  readonly worldChanges: number;
  readonly digest: string;
}
export interface EngineOptions {
  readonly fixedHz?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxTasksPerFrame?: number;
  readonly maxEntities?: number;
}
export type PhaseHandler = (tick: Tick, deltaSeconds: number) => void;

const PHASE_ORDER: readonly RuntimePhase[] = ['input', 'simulation', 'navigation', 'ai', 'audio', 'streaming', 'network', 'save', 'render', 'telemetry'];

export class R40Engine {
  readonly clock: FixedClock;
  readonly scheduler: DeterministicTaskScheduler;
  readonly world: SpatialEntityWorld;
  readonly worldBudget: WorldSimulationBudget;
  readonly render: FrameGraph;
  readonly assets: AssetStreamingController;
  readonly protocol: R40Protocol;
  readonly state: RuntimeStateGraph;
  readonly recovery: RecoveryCoordinator;
  readonly security: SecurityGate;
  readonly metrics: MetricRegistry;
  readonly health: HealthMonitor;
  readonly quality: RenderQualityGovernor;
  readonly maxCatchUpSteps: number;
  #handlers = new Map<RuntimePhase, PhaseHandler[]>();
  #commandQueue: RuntimeCommand[] = [];
  #running = false;
  #sequence = 0;

  constructor(options: EngineOptions = {}) {
    this.clock = new FixedClock(options.fixedHz ?? 60);
    this.maxCatchUpSteps = Math.max(1, Math.trunc(options.maxCatchUpSteps ?? 4));
    this.scheduler = new DeterministicTaskScheduler({ maxTasksPerFrame: options.maxTasksPerFrame ?? 256 });
    this.world = new SpatialEntityWorld({ maxEntities: options.maxEntities ?? 100000 });
    this.worldBudget = new WorldSimulationBudget();
    this.render = new FrameGraph();
    this.assets = new AssetStreamingController();
    this.protocol = new R40Protocol();
    this.state = new RuntimeStateGraph();
    this.recovery = new RecoveryCoordinator();
    this.security = new SecurityGate();
    this.metrics = new MetricRegistry();
    this.health = new HealthMonitor();
    this.quality = new RenderQualityGovernor({ frameMs: 16.67, cpuMs: 9, gpuMs: 14, drawCalls: 12000, triangles: 8000000, memoryBytes: 536870912 });
    for (const phase of PHASE_ORDER) this.#handlers.set(phase, []);
  }

  on(phase: RuntimePhase, handler: PhaseHandler): () => void {
    const list = this.#handlers.get(phase);
    if (!list) throw new RangeError('unsupported runtime phase');
    list.push(handler);
    return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
  }

  enqueue(type: string, payload: Readonly<Record<string, unknown>>, actor: EntityId | null = null, targetTick = this.clock.tick): RuntimeCommand | null {
    const typeCheck = this.security.checkCommandType(type);
    if (!typeCheck.accepted || !this.security.validatePayload(payload).accepted) return null;
    const next: RuntimeCommand = Object.freeze({
      id: commandId('r40-' + String(++this.#sequence)),
      tick: targetTick,
      actor,
      type,
      payload: Object.freeze({ ...payload }),
      sequence: this.#sequence,
      predictionKey: null,
    });
    if (this.#commandQueue.length >= 4096) this.#commandQueue.shift();
    this.#commandQueue.push(next);
    return next;
  }

  attachTask(task: RuntimeTask): boolean { return this.scheduler.enqueue(task); }

  step(deltaMs: number): EngineStep {
    const clockResult = this.clock.push(deltaMs, this.maxCatchUpSteps);
    let budget = this.scheduler.runFrame(this.clock.tick);
    let worldChanges = 0;
    const commands: RuntimeCommand[] = [];
    for (const currentTick of clockResult.ticks) {
      const due = this.#commandQueue.filter((command) => Number(command.tick) <= Number(currentTick)).sort((a, b) => a.sequence - b.sequence);
      this.#commandQueue = this.#commandQueue.filter((command) => Number(command.tick) > Number(currentTick));
      commands.push(...due);
      for (const command of due) this.state.applyCommand(command, currentTick, command.actor ? 'engine' : 'system');
      for (const phase of PHASE_ORDER) {
        const start = performance.now();
        for (const handler of [...this.#handlers.get(phase)!]) handler(currentTick, 1 / this.clock.hz);
        const elapsed = performance.now() - start;
        this.metrics.record({ name: 'r40.phase.' + phase, value: elapsed, unit: 'ms', tick: currentTick, phase, tags: {} });
      }
      budget = this.scheduler.runFrame(currentTick);
      worldChanges += this.world.activeCount();
    }
    const digest = hashJson({ tick: Number(this.clock.tick), budget, commands, worldChanges });
    return Object.freeze({ tick: tick(this.clock.tick), alpha: clockResult.alpha, budget, commands: Object.freeze(commands), worldChanges, digest });
  }

  start(stepper: (step: EngineStep) => void, requestFrame: (callback: FrameRequestCallback) => number): void {
    if (this.#running) return;
    this.#running = true;
    let last = performance.now();
    const loop = () => {
      if (!this.#running) return;
      const now = performance.now();
      const step = this.step(Math.min(100, Math.max(0, now - last)));
      last = now;
      stepper(step);
      requestFrame(loop);
    };
    requestFrame(loop);
  }

  stop(): void { this.#running = false; }
  running(): boolean { return this.#running; }
  reset(): void {
    this.stop();
    this.clock.reset();
    this.scheduler.clear();
    this.world.clear();
    this.render.clearTransient();
    this.state.clear();
    this.#commandQueue.length = 0;
    this.#sequence = 0;
    this.health.clear();
    this.metrics.clear();
    this.recovery.reset();
  }
  cameraInterest(position: Vec3, radius = 250): number { return this.world.updateInterest({ id: 'camera', position, radius, weight: 1 }); }
}

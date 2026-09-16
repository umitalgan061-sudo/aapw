import type { Budget, FixedStepConfig, SchedulerTask, SystemContext, SystemDefinition, TimeSample, TickId, FrameId, Disposable } from './types.js';
import { FRAME_ID, TICK_ID } from './types.js';
import { clamp, positiveOr, stableSort } from './deterministic.js';

interface RuntimeTask extends SchedulerTask { remainingRuns: number; cancelled: boolean; }
export interface SchedulerPhase { readonly id: string; readonly order: number; readonly budgetShare: number; }
export interface SchedulerStats { readonly frame: FrameId; readonly tick: TickId; readonly accumulator: number; readonly alpha: number; readonly droppedDeltaSeconds: number; readonly executedTicks: number; readonly executedSystems: number; readonly failedSystems: number; readonly queuedTasks: number; }

const DEFAULT_BUDGET: Budget = Object.freeze({ cpuMilliseconds: 16.6, gpuMilliseconds: 16.6, memoryBytes: 512 * 1024 * 1024, entities: 200000, events: 4096, commands: 4096 });
const DEFAULT_PHASES: readonly SchedulerPhase[] = Object.freeze([
  { id: 'input', order: 10, budgetShare: 0.08 },
  { id: 'simulation', order: 20, budgetShare: 0.42 },
  { id: 'ai', order: 30, budgetShare: 0.18 },
  { id: 'animation', order: 40, budgetShare: 0.12 },
  { id: 'presentation', order: 50, budgetShare: 0.10 },
  { id: 'cleanup', order: 60, budgetShare: 0.10 },
]);

export class FixedStepScheduler implements Disposable {
  private readonly config: FixedStepConfig;
  private readonly phases = new Map<string, SchedulerPhase>();
  private readonly systems: SystemDefinition[] = [];
  private readonly tasks = new Map<string, RuntimeTask>();
  private readonly budget: Budget;
  private accumulator = 0;
  private elapsed = 0;
  private droppedDeltaSeconds = 0;
  private frame = 0 as FrameId;
  private tick = 0 as TickId;
  private executedTicks = 0;
  private executedSystems = 0;
  private failedSystems = 0;
  private _disposed = false;
  private readonly abort = new AbortController();

  public constructor(config: Partial<FixedStepConfig> = {}, budget: Partial<Budget> = {}) {
    this.config = Object.freeze({
      stepSeconds: positiveOr(config.stepSeconds, 1 / 60),
      maxSubSteps: Math.max(1, Math.trunc(config.maxSubSteps ?? 5)),
      maxFrameDeltaSeconds: positiveOr(config.maxFrameDeltaSeconds, 0.25),
      timeScale: finiteTimeScale(config.timeScale ?? 1),
    }) as FixedStepConfig;
    this.budget = Object.freeze({ ...DEFAULT_BUDGET, ...budget });
    for (const phase of DEFAULT_PHASES) this.phases.set(phase.id, phase);
  }

  public get disposed(): boolean { return this._disposed; }
  public get currentTick(): TickId { return this.tick; }
  public get currentFrame(): FrameId { return this.frame; }
  public get currentTime(): number { return this.elapsed; }

  public registerPhase(phase: SchedulerPhase): boolean {
    if (this._disposed || !phase.id || !Number.isFinite(phase.order)) return false;
    this.phases.set(phase.id, Object.freeze({ ...phase, budgetShare: clamp(phase.budgetShare, 0, 1) }));
    return true;
  }

  public addSystem(system: SystemDefinition): boolean {
    if (this._disposed || this.systems.some(item => item.id === system.id)) return false;
    if (!this.phases.has(system.phase)) this.registerPhase({ id: system.phase, order: 100 + this.phases.size, budgetShare: 0.1 });
    this.systems.push(Object.freeze({ ...system }));
    return true;
  }

  public removeSystem(id: SystemDefinition['id']): boolean {
    const index = this.systems.findIndex(system => system.id === id);
    if (index < 0) return false;
    this.systems.splice(index, 1);
    return true;
  }

  public schedule(task: SchedulerTask): boolean {
    if (this._disposed || !task.id || this.tasks.has(task.id)) return false;
    const runAtTick = Math.max(Number(this.tick), Math.trunc(task.runAtTick)) as TickId;
    const intervalTicks = Math.max(0, Math.trunc(task.intervalTicks));
    this.tasks.set(task.id, { ...task, runAtTick, intervalTicks, remainingRuns: task.maxRuns === undefined ? -1 : Math.max(0, Math.trunc(task.maxRuns)), cancelled: false });
    return true;
  }

  public cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.cancelled = true;
    return true;
  }

  public advance(frameDeltaSeconds: number): SchedulerStats {
    if (this._disposed) return this.stats;
    const raw = Math.max(0, Number.isFinite(frameDeltaSeconds) ? frameDeltaSeconds : 0);
    const capped = Math.min(raw, this.config.maxFrameDeltaSeconds);
    this.droppedDeltaSeconds += Math.max(0, raw - capped);
    this.accumulator += capped * this.config.timeScale;
    let steps = 0;
    while (this.accumulator >= this.config.stepSeconds && steps < this.config.maxSubSteps) {
      this.accumulator -= this.config.stepSeconds;
      this.runTick();
      steps += 1;
    }
    if (steps === this.config.maxSubSteps && this.accumulator >= this.config.stepSeconds) {
      this.droppedDeltaSeconds += this.accumulator;
      this.accumulator = 0;
    }
    this.frame = FRAME_ID((this.frame as number) + 1);
    return this.stats;
  }

  public get stats(): SchedulerStats {
    return Object.freeze({
      frame: this.frame,
      tick: this.tick,
      accumulator: this.accumulator,
      alpha: clamp(this.accumulator / this.config.stepSeconds, 0, 1),
      droppedDeltaSeconds: this.droppedDeltaSeconds,
      executedTicks: this.executedTicks,
      executedSystems: this.executedSystems,
      failedSystems: this.failedSystems,
      queuedTasks: [...this.tasks.values()].filter(task => !task.cancelled).length,
    });
  }

  public reset(): void {
    if (this._disposed) return;
    this.accumulator = 0;
    this.elapsed = 0;
    this.droppedDeltaSeconds = 0;
    this.frame = FRAME_ID(0);
    this.tick = TICK_ID(0);
    this.executedTicks = 0;
    this.executedSystems = 0;
    this.failedSystems = 0;
    for (const task of this.tasks.values()) task.cancelled = false;
  }

  public dispose(): void {
    if (this._disposed) return;
    this.abort.abort();
    this.tasks.clear();
    this.systems.length = 0;
    this.phases.clear();
    this._disposed = true;
  }

  private runTick(): void {
    this.tick = TICK_ID((this.tick as number) + 1);
    this.elapsed += this.config.stepSeconds;
    this.executedTicks += 1;
    const contextBase = { signal: this.abort.signal };
    const phases = stableSort([...this.phases.values()], (a, b) => a.order - b.order);
    const orderedSystems = stableSort(this.systems, (a, b) => {
      const phaseA = this.phases.get(a.phase)?.order ?? 999;
      const phaseB = this.phases.get(b.phase)?.order ?? 999;
      return phaseA - phaseB || b.priority - a.priority || String(a.id).localeCompare(String(b.id));
    });
    for (const phase of phases) {
      const phaseSystems = orderedSystems.filter(system => system.phase === phase.id);
      const seen = new Set<string>();
      for (const system of phaseSystems) {
        if (seen.has(String(system.id))) continue;
        seen.add(String(system.id));
        const time: TimeSample = Object.freeze({ deltaSeconds: this.config.stepSeconds, elapsedSeconds: this.elapsed, frame: this.frame, tick: this.tick, alpha: 0 });
        const budget = makeBudgetUsage(this.budget, phase.budgetShare);
        const context: SystemContext = Object.freeze({ ...contextBase, time, budget });
        if (system.enabled && !safeEnabled(system, context)) continue;
        try {
          system.update(context);
          this.executedSystems += 1;
        } catch {
          this.failedSystems += 1;
        }
      }
    }
    this.runTasks();
  }

  private runTasks(): void {
    const ready = [...this.tasks.values()].filter(task => !task.cancelled && Number(this.tick) >= Number(task.runAtTick));
    ready.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const task of ready) {
      try { task.callback(this.tick); } catch { /* task isolation */ }
      if (task.remainingRuns > 0) task.remainingRuns -= 1;
      if (task.remainingRuns === 0) { task.cancelled = true; continue; }
      if (task.intervalTicks <= 0) task.cancelled = true;
      else task.runAtTick = TICK_ID(Number(task.runAtTick) + task.intervalTicks);
    }
    for (const [id, task] of this.tasks) if (task.cancelled) this.tasks.delete(id);
  }
}

const finiteTimeScale = (value: number): number => clamp(Number.isFinite(value) ? value : 1, 0, 4);
const safeEnabled = (system: SystemDefinition, context: SystemContext): boolean => {
  try { return system.enabled?.(context) ?? true; } catch { return false; }
};

const makeBudgetUsage = (budget: Budget, share: number) => {
  const factor = clamp(share * 2, 0.05, 1);
  const cpu = budget.cpuMilliseconds * factor;
  const gpu = budget.gpuMilliseconds * factor;
  const memory = budget.memoryBytes * factor;
  return Object.freeze({
    ...budget,
    cpuMilliseconds: cpu,
    gpuMilliseconds: gpu,
    memoryBytes: memory,
    cpuRatio: cpu / Math.max(0.001, budget.cpuMilliseconds),
    gpuRatio: gpu / Math.max(0.001, budget.gpuMilliseconds),
    memoryRatio: memory / Math.max(1, budget.memoryBytes),
    entityRatio: factor,
    eventRatio: factor,
    commandRatio: factor,
  });
};

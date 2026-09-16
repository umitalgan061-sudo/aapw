import { asTick, clamp, integer, stableSort, type BudgetSlice, type Disposable, type Tick, type V7Result } from './primitives.js';

export type RuntimePhase = 'input' | 'simulation' | 'ai' | 'streaming' | 'render' | 'network' | 'persistence' | 'telemetry';
export interface PhaseBudget { readonly phase: RuntimePhase; readonly cpuMs: number; readonly weight: number; readonly maxTasks: number; }
export interface ScheduledTask { readonly id: string; readonly phase: RuntimePhase; readonly priority: number; readonly estimatedMs: number; readonly run: (context: TaskContext) => void; }
export interface TaskContext { readonly tick: Tick; readonly phase: RuntimePhase; readonly budget: number; readonly consumedMs: number; readonly yieldRequested: boolean; }
export interface PhaseReport { readonly phase: RuntimePhase; readonly scheduled: number; readonly executed: number; readonly skipped: number; readonly consumedMs: number; readonly remainingMs: number; readonly overBudget: boolean; }
export interface SchedulerReport { readonly tick: Tick; readonly elapsedMs: number; readonly droppedTasks: number; readonly phases: readonly PhaseReport[]; readonly digest: string; }

const DEFAULT_PHASES: readonly PhaseBudget[] = Object.freeze([
  { phase: 'input', cpuMs: 1.2, weight: 1.2, maxTasks: 32 },
  { phase: 'simulation', cpuMs: 4.4, weight: 4.4, maxTasks: 256 },
  { phase: 'ai', cpuMs: 2.2, weight: 2.2, maxTasks: 128 },
  { phase: 'streaming', cpuMs: 1.8, weight: 1.8, maxTasks: 64 },
  { phase: 'render', cpuMs: 3.5, weight: 3.5, maxTasks: 128 },
  { phase: 'network', cpuMs: 1.5, weight: 1.5, maxTasks: 64 },
  { phase: 'persistence', cpuMs: 0.8, weight: 0.8, maxTasks: 32 },
  { phase: 'telemetry', cpuMs: 0.6, weight: 0.6, maxTasks: 32 },
]);

export class FixedStepClock implements Disposable {
  readonly stepMs: number;
  readonly maxCatchUp: number;
  #accumulator = 0;
  #tick = 0;
  #dropped = 0;
  #disposed = false;
  constructor(stepMs = 1000 / 60, maxCatchUp = 5) {
    this.stepMs = clamp(stepMs, 1, 250);
    this.maxCatchUp = clamp(integer(maxCatchUp, 5), 1, 16);
  }
  ingest(frameMs: number): number {
    if (this.#disposed) return 0;
    this.#accumulator += clamp(frameMs, 0, 1000);
    const available = Math.min(Math.floor(this.#accumulator / this.stepMs), this.maxCatchUp);
    this.#accumulator -= available * this.stepMs;
    const possible = Math.floor(this.#accumulator / this.stepMs);
    if (possible > this.maxCatchUp) { this.#dropped += possible - this.maxCatchUp; this.#accumulator = this.#accumulator % this.stepMs; }
    this.#tick += available;
    return available;
  }
  tick(): Tick { return asTick(this.#tick); }
  interpolation(): number { return clamp(this.#accumulator / this.stepMs, 0, 0.999999); }
  droppedSteps(): number { return this.#dropped; }
  reset(): void { this.#accumulator = 0; this.#tick = 0; this.#dropped = 0; }
  dispose(): void { this.#disposed = true; this.reset(); }
}

export class RuntimeScheduler implements Disposable {
  #phases = new Map<RuntimePhase, PhaseBudget>(DEFAULT_PHASES.map((entry) => [entry.phase, entry]));
  #queues = new Map<RuntimePhase, ScheduledTask[]>();
  #disposed = false;
  #lastReport: SchedulerReport | null = null;

  configure(budgets: Partial<Record<RuntimePhase, Partial<PhaseBudget>>>): void {
    for (const [phase, patch] of Object.entries(budgets) as Array<[RuntimePhase, Partial<PhaseBudget>]>) {
      const current = this.#phases.get(phase); if (!current) continue;
      this.#phases.set(phase, Object.freeze({ ...current, ...patch, cpuMs: Math.max(0, Number(patch.cpuMs ?? current.cpuMs)), weight: Math.max(0.1, Number(patch.weight ?? current.weight)), maxTasks: clamp(integer(patch.maxTasks ?? current.maxTasks), 1, 4096) }));
    }
  }

  enqueue(task: ScheduledTask): V7Result<void> {
    if (this.#disposed) return { ok: false, code: 'SCHEDULER_DISPOSED', message: 'Scheduler is disposed', retryable: false };
    const phase = this.#phases.get(task.phase);
    if (!phase) return { ok: false, code: 'PHASE_UNKNOWN', message: `Unknown phase ${task.phase}`, retryable: false };
    if (!task.id || !Number.isFinite(task.estimatedMs) || task.estimatedMs < 0) return { ok: false, code: 'TASK_INVALID', message: 'Invalid task contract', retryable: false };
    const queue = this.#queues.get(task.phase) ?? [];
    if (queue.length >= phase.maxTasks * 8) return { ok: false, code: 'QUEUE_SATURATED', message: 'Phase queue is full', retryable: true };
    queue.push(Object.freeze({ ...task, priority: clamp(integer(task.priority), -1000, 1000), estimatedMs: clamp(task.estimatedMs, 0, phase.cpuMs) }));
    this.#queues.set(task.phase, queue);
    return { ok: true, value: undefined };
  }

  run(tick: Tick, externalBudget?: Partial<BudgetSlice>): SchedulerReport {
    if (this.#disposed) return Object.freeze({ tick, elapsedMs: 0, droppedTasks: 0, phases: [], digest: 'disposed' });
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const scale = clamp(Number(externalBudget?.cpuMs ?? 15.5) / 15.5, 0.35, 1.5);
    const reports: PhaseReport[] = [];
    let droppedTasks = 0;
    for (const phase of this.#orderedPhases()) {
      const queue = this.#queues.get(phase.phase) ?? [];
      const ordered = stableSort(queue, (a, b) => b.priority - a.priority || a.estimatedMs - b.estimatedMs || a.id.localeCompare(b.id));
      queue.length = 0;
      const budget = phase.cpuMs * scale;
      let consumed = 0; let executed = 0; let skipped = 0;
      for (const task of ordered) {
        if (executed >= phase.maxTasks || consumed + task.estimatedMs > budget) { skipped += 1; droppedTasks += 1; continue; }
        const context: TaskContext = Object.freeze({ tick, phase: phase.phase, budget, consumedMs: consumed, yieldRequested: consumed + task.estimatedMs > budget * 0.88 });
        const before = typeof performance !== 'undefined' ? performance.now() : Date.now();
        try { task.run(context); } catch { skipped += 1; droppedTasks += 1; continue; }
        const actual = typeof performance !== 'undefined' ? performance.now() - before : task.estimatedMs;
        consumed += clamp(actual, 0, task.estimatedMs * 2 + 0.25);
        executed += 1;
      }
      reports.push(Object.freeze({ phase: phase.phase, scheduled: ordered.length, executed, skipped, consumedMs: consumed, remainingMs: Math.max(0, budget - consumed), overBudget: consumed > budget }));
    }
    const elapsedMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    const digest = `${tick}:${reports.map((r) => `${r.phase}:${r.executed}:${r.skipped}`).join('|')}`;
    this.#lastReport = Object.freeze({ tick, elapsedMs, droppedTasks, phases: Object.freeze(reports), digest });
    return this.#lastReport;
  }

  report(): SchedulerReport | null { return this.#lastReport; }
  queues(): Readonly<Record<RuntimePhase, number>> {
    return Object.freeze(Object.fromEntries([...this.#queues.entries()].map(([phase, queue]) => [phase, queue.length])) as Record<RuntimePhase, number>);
  }
  dispose(): void { this.#disposed = true; this.#queues.clear(); this.#lastReport = null; }
  #orderedPhases(): readonly PhaseBudget[] { return stableSort([...this.#phases.values()], (a, b) => b.weight - a.weight || a.phase.localeCompare(b.phase)); }
}

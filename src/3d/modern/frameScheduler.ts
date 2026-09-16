import type { Disposable, FrameId, ScheduledTask, SchedulerPriority, SchedulerStats, TaskContext } from './types';
import { asFrameId } from './types';

const PRIORITY_WEIGHT: Record<SchedulerPriority, number> = { critical: 5, high: 4, normal: 3, low: 2, background: 1 };
export interface FrameSchedulerOptions { readonly budgetMs?: number; readonly maxTasksPerFrame?: number; readonly now?: () => number; }
interface QueueEntry<T = unknown> { readonly sequence: number; readonly task: ScheduledTask<T>; readonly enqueuedAt: number; age: number; }

/** Deterministic, budget-aware scheduler for simulation, streaming, AI and housekeeping. */
export class FrameScheduler implements Disposable {
  private readonly budgetMs: number;
  private readonly maxTasksPerFrame: number;
  private readonly now: () => number;
  private readonly queues = new Map<SchedulerPriority, QueueEntry<unknown>[]>();
  private sequence = 0;
  private frameId: FrameId = asFrameId(0);
  private frameStart = 0;
  private completed = 0;
  private cancelled = 0;
  private deferred = 0;
  private disposed = false;
  private running = false;
  public constructor(options: FrameSchedulerOptions = {}) { this.budgetMs = Math.max(0.5, options.budgetMs ?? 4); this.maxTasksPerFrame = Math.max(1, Math.floor(options.maxTasksPerFrame ?? 128)); this.now = options.now ?? (() => performance.now()); for (const priority of Object.keys(PRIORITY_WEIGHT) as SchedulerPriority[]) this.queues.set(priority, []); }
  public beginFrame(timestamp = this.now()): void { this.ensureActive(); this.frameId = asFrameId(Number(this.frameId) + 1); this.frameStart = timestamp; this.running = true; for (const queue of this.queues.values()) for (const entry of queue) entry.age = Math.min(30, entry.age + 1); }
  public enqueue<T>(task: ScheduledTask<T>): string { this.ensureActive(); const entry: QueueEntry<T> = { sequence: ++this.sequence, task, enqueuedAt: this.now(), age: 0 }; this.queues.get(task.priority)!.push(entry as QueueEntry<unknown>); return task.id; }
  public cancel(id: string): boolean { for (const queue of this.queues.values()) { const index = queue.findIndex((entry) => entry.task.id === id); if (index < 0) continue; queue.splice(index, 1); this.cancelled += 1; return true; } return false; }
  public async runFrame(): Promise<SchedulerStats> {
    this.ensureActive(); if (!this.running) this.beginFrame(); const deadline = this.frameStart + this.budgetMs; let processed = 0;
    while (processed < this.maxTasksPerFrame) {
      const entry = this.takeNext(); if (!entry) break;
      if (entry.task.signal?.aborted) { this.cancelled += 1; processed += 1; continue; }
      const context: TaskContext = { frameId: this.frameId, elapsedMs: Math.max(0, this.now() - this.frameStart), remainingBudgetMs: Math.max(0, deadline - this.now()), shouldYield: () => this.now() >= deadline, yieldToBrowser: () => new Promise<void>((resolve) => { const host = globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }; if (host.scheduler?.yield) void host.scheduler.yield().catch(() => undefined).then(resolve); else setTimeout(resolve, 0); }) };
      try { await entry.task.run(context); this.completed += 1; } catch { this.deferred += 1; }
      processed += 1; if (this.now() >= deadline && !this.hasHigherPriorityWork('background')) break;
    }
    if (this.totalQueued() > 0) this.deferred += this.totalQueued(); this.running = false; return this.stats();
  }
  public async runUntilIdle(maxFrames = 8): Promise<SchedulerStats> { for (let frame = 0; frame < Math.max(1, maxFrames) && this.totalQueued() > 0; frame += 1) { this.beginFrame(); await this.runFrame(); } return this.stats(); }
  public drainPriority(priority: SchedulerPriority): readonly ScheduledTask[] { const queue = this.queues.get(priority)!; const tasks = queue.map((entry) => entry.task); queue.length = 0; this.cancelled += tasks.length; return tasks; }
  public peek(limit = 16): readonly ScheduledTask[] { return this.allEntries().sort((a, b) => this.score(b) - this.score(a) || a.sequence - b.sequence).slice(0, Math.max(0, limit)).map((entry) => entry.task); }
  public stats(): SchedulerStats { return { queued: this.totalQueued(), completed: this.completed, cancelled: this.cancelled, deferred: this.deferred, lastFrameBudgetMs: this.budgetMs }; }
  private takeNext(): QueueEntry<unknown> | undefined { const winner = this.allEntries().sort((a, b) => this.score(b) - this.score(a) || a.sequence - b.sequence)[0]; if (!winner) return undefined; const queue = this.queues.get(winner.task.priority)!; queue.splice(queue.indexOf(winner), 1); return winner; }
  private allEntries(): QueueEntry<unknown>[] { const result: QueueEntry<unknown>[] = []; for (const queue of this.queues.values()) result.push(...queue); return result; }
  private score(entry: QueueEntry<unknown>): number { return PRIORITY_WEIGHT[entry.task.priority] * 100 + Math.min(4, entry.age * 0.1) + 1 / Math.max(0.25, entry.task.budgetMs); }
  private hasHigherPriorityWork(priority: SchedulerPriority): boolean { const threshold = PRIORITY_WEIGHT[priority]; for (const [name, queue] of this.queues) if (queue.length && PRIORITY_WEIGHT[name] > threshold) return true; return false; }
  private totalQueued(): number { let total = 0; for (const queue of this.queues.values()) total += queue.length; return total; }
  private ensureActive(): void { if (this.disposed) throw new Error('SCHEDULER_DISPOSED'); }
  public dispose(): void { if (this.disposed) return; for (const queue of this.queues.values()) queue.length = 0; this.disposed = true; }
}

export interface FixedStepClockOptions { readonly stepSeconds?: number; readonly maxCatchUpSteps?: number; }
export interface FixedStepResult { readonly steps: number; readonly alpha: number; readonly droppedSeconds: number; }
export class FixedStepClock {
  public readonly stepSeconds: number; public readonly maxCatchUpSteps: number; private accumulator = 0; private previousTimestamp: number | null = null; private totalDropped = 0;
  public constructor(options: FixedStepClockOptions = {}) { this.stepSeconds = Math.max(1 / 240, options.stepSeconds ?? 1 / 60); this.maxCatchUpSteps = Math.max(1, Math.floor(options.maxCatchUpSteps ?? 5)); }
  public consume(timestampMs: number, step: (stepSeconds: number) => void): FixedStepResult { if (!Number.isFinite(timestampMs)) throw new RangeError('INVALID_TIMESTAMP'); if (this.previousTimestamp === null) { this.previousTimestamp = timestampMs; return { steps: 0, alpha: 0, droppedSeconds: 0 }; } this.accumulator += Math.min(0.25, Math.max(0, (timestampMs - this.previousTimestamp) / 1000)); this.previousTimestamp = timestampMs; let steps = 0; while (this.accumulator >= this.stepSeconds && steps < this.maxCatchUpSteps) { step(this.stepSeconds); this.accumulator -= this.stepSeconds; steps += 1; } let droppedSeconds = 0; if (this.accumulator >= this.stepSeconds) { droppedSeconds = this.accumulator - (this.accumulator % this.stepSeconds); this.accumulator -= droppedSeconds; this.totalDropped += droppedSeconds; } return { steps, alpha: this.accumulator / this.stepSeconds, droppedSeconds }; }
  public reset(): void { this.accumulator = 0; this.previousTimestamp = null; }
  public droppedSeconds(): number { return this.totalDropped; }
}

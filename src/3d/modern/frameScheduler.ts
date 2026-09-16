import type { Disposable, FrameId, ScheduledTask, SchedulerPriority, SchedulerStats, TaskContext, TimestampMs } from './types';
import { asFrameId, asTimestampMs } from './types';

const PRIORITY_WEIGHT: Record<SchedulerPriority, number> = {
  critical: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

export interface FrameSchedulerOptions {
  readonly budgetMs?: number;
  readonly maxTasksPerFrame?: number;
  readonly now?: () => number;
}

interface QueueEntry<T> {
  readonly sequence: number;
  readonly task: ScheduledTask<T>;
  enqueuedAt: number;
  age: number;
}

/**
 * Budget-aware frame scheduler for simulation, streaming, AI and housekeeping.
 *
 * It never relies on wall-clock ordering between equal-priority tasks. Queue
 * sequence is the stable tie-breaker, keeping replays deterministic while the
 * wall clock only decides whether a task should yield to rendering.
 */
export class FrameScheduler implements Disposable {
  private readonly budgetMs: number;
  private readonly maxTasksPerFrame: number;
  private readonly now: () => number;
  private readonly queues = new Map<SchedulerPriority, QueueEntry<any>[]>();
  private sequence = 0;
  private frameId: FrameId = asFrameId(0);
  private frameStart = 0;
  private completed = 0;
  private cancelled = 0;
  private deferred = 0;
  private disposed = false;
  private running = false;

  public constructor(options: FrameSchedulerOptions = {}) {
    this.budgetMs = Math.max(0.5, options.budgetMs ?? 4.0);
    this.maxTasksPerFrame = Math.max(1, options.maxTasksPerFrame ?? 128);
    this.now = options.now ?? (() => performance.now());
    for (const priority of Object.keys(PRIORITY_WEIGHT) as SchedulerPriority[]) this.queues.set(priority, []);
  }

  public beginFrame(timestamp = this.now()): void {
    if (this.disposed) throw new Error('SCHEDULER_DISPOSED');
    this.frameId = asFrameId(this.frameId + 1);
    this.frameStart = timestamp;
    this.running = true;
    for (const queue of this.queues.values()) {
      for (const entry of queue) entry.age += 1;
      queue.sort((a, b) => this.score(b) - this.score(a) || a.sequence - b.sequence);
    }
  }

  public enqueue<T>(task: ScheduledTask<T>): string {
    if (this.disposed) throw new Error('SCHEDULER_DISPOSED');
    const priority = task.priority;
    const entry: QueueEntry<T> = {
      task,
      sequence: ++this.sequence,
      enqueuedAt: this.now(),
      age: 0,
    };
    this.queues.get(priority)?.push(entry);
    return task.id;
  }

  public cancel(id: string): boolean {
    let removed = false;
    for (const [priority, queue] of this.queues) {
      const index = queue.findIndex((entry) => entry.task.id === id);
      if (index < 0) continue;
      const [entry] = queue.splice(index, 1);
      if (entry?.task.signal?.aborted) continue;
      removed = true;
      this.cancelled += 1;
      this.queues.set(priority, queue);
      break;
    }
    return removed;
  }

  public async runFrame(): Promise<SchedulerStats> {
    if (!this.running) this.beginFrame();
    const deadline = this.frameStart + this.budgetMs;
    let processed = 0;
    while (processed < this.maxTasksPerFrame) {
      const entry = this.takeNext();
      if (!entry) break;
      const { task } = entry;
      if (task.signal?.aborted) {
        this.cancelled += 1;
        processed += 1;
        continue;
      }
      const remaining = Math.max(0, deadline - this.now());
      const context: TaskContext = {
        frameId: this.frameId,
        elapsedMs: Math.max(0, this.now() - this.frameStart),
        remainingBudgetMs: remaining,
        shouldYield: () => this.now() >= deadline,
        yieldToBrowser: () => new Promise<void>((resolve) => {
          if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
            void scheduler.yield().then(resolve).catch(resolve);
          } else {
            setTimeout(resolve, 0);
          }
        }),
      };
      try {
        await task.run(context);
        this.completed += 1;
      } catch {
        // A task owns its error policy; a failed optional task should not block
        // unrelated simulation or rendering work on the following frame.
        this.deferred += 1;
      }
      processed += 1;
      if (this.now() >= deadline && this.hasQueuedHigherThan('background')) break;
    }
    if (this.totalQueued() > 0) {
      this.deferred += this.totalQueued();
      this.promoteAged();
    }
    this.running = false;
    return this.stats();
  }

  public async runUntilIdle(maxFrames = 8): Promise<SchedulerStats> {
    let frames = 0;
    while (this.totalQueued() > 0 && frames < Math.max(1, maxFrames)) {
      this.beginFrame();
      await this.runFrame();
      frames += 1;
    }
    return this.stats();
  }

  public drainPriority(priority: SchedulerPriority): ScheduledTask[] {
    const queue = this.queues.get(priority) ?? [];
    const tasks = queue.splice(0).map((entry) => entry.task);
    this.cancelled += tasks.length;
    return tasks;
  }

  public peek(limit = 16): readonly ScheduledTask[] {
    return this.allEntries()
      .sort((a, b) => this.score(b) - this.score(a) || a.sequence - b.sequence)
      .slice(0, Math.max(0, limit))
      .map((entry) => entry.task);
  }

  public stats(): SchedulerStats {
    return {
      queued: this.totalQueued(),
      completed: this.completed,
      cancelled: this.cancelled,
      deferred: this.deferred,
      lastFrameBudgetMs: this.budgetMs,
    };
  }

  private takeNext(): QueueEntry | undefined {
    const entries = this.allEntries().sort((a, b) => this.score(b) - this.score(a) || a.sequence - b.sequence);
    const winner = entries[0];
    if (!winner) return undefined;
    const queue = this.queues.get(winner.task.priority);
    const index = queue?.indexOf(winner) ?? -1;
    if (queue && index >= 0) queue.splice(index, 1);
    return winner;
  }

  private allEntries(): QueueEntry[] {
    const entries: QueueEntry[] = [];
    for (const queue of this.queues.values()) entries.push(...queue);
    return entries;
  }

  private score(entry: QueueEntry): number {
    const priority = PRIORITY_WEIGHT[entry.task.priority];
    const ageBoost = Math.min(4, entry.age * 0.1);
    const budgetBoost = 1 / Math.max(0.25, entry.task.budgetMs);
    return priority * 100 + ageBoost + budgetBoost;
  }

  private promoteAged(): void {
    for (const queue of this.queues.values()) {
      for (const entry of queue) {
        if (entry.age > 30) entry.age = 30;
      }
    }
  }

  private hasQueuedHigherThan(priority: SchedulerPriority): boolean {
    const threshold = PRIORITY_WEIGHT[priority];
    for (const [name, queue] of this.queues) {
      if (queue.length > 0 && PRIORITY_WEIGHT[name] > threshold) return true;
    }
    return false;
  }

  private totalQueued(): number {
    let total = 0;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }

  public dispose(): void {
    if (this.disposed) return;
    for (const queue of this.queues.values()) queue.splice(0);
    this.disposed = true;
  }
}

export interface FixedStepClockOptions {
  readonly stepSeconds?: number;
  readonly maxCatchUpSteps?: number;
}

export interface FixedStepResult {
  readonly steps: number;
  readonly alpha: number;
  readonly droppedSeconds: number;
}

/** Stable simulation clock, independent from display refresh rate. */
export class FixedStepClock {
  public readonly stepSeconds: number;
  public readonly maxCatchUpSteps: number;
  private accumulator = 0;
  private previousTimestamp: number | null = null;
  private totalDropped = 0;

  public constructor(options: FixedStepClockOptions = {}) {
    this.stepSeconds = Math.max(1 / 240, options.stepSeconds ?? 1 / 60);
    this.maxCatchUpSteps = Math.max(1, Math.floor(options.maxCatchUpSteps ?? 5));
  }

  public consume(timestampMs: number, step: (stepSeconds: number) => void): FixedStepResult {
    if (!Number.isFinite(timestampMs)) throw new RangeError('INVALID_TIMESTAMP');
    if (this.previousTimestamp === null) {
      this.previousTimestamp = timestampMs;
      return { steps: 0, alpha: 0, droppedSeconds: 0 };
    }
    const elapsed = Math.min(0.25, Math.max(0, (timestampMs - this.previousTimestamp) / 1000));
    this.previousTimestamp = timestampMs;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < this.maxCatchUpSteps) {
      step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps += 1;
    }
    let droppedSeconds = 0;
    if (this.accumulator >= this.stepSeconds) {
      droppedSeconds = this.accumulator - (this.accumulator % this.stepSeconds);
      this.accumulator -= droppedSeconds;
      this.totalDropped += droppedSeconds;
    }
    return { steps, alpha: this.accumulator / this.stepSeconds, droppedSeconds };
  }

  public reset(): void {
    this.accumulator = 0;
    this.previousTimestamp = null;
  }

  public droppedSeconds(): number {
    return this.totalDropped;
  }
}

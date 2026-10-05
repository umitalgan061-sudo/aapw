/**
 * Deterministic budget scheduler for R42.
 * Production TypeScript owner.
 */
import type { BudgetRule, Priority, WorkClass, WorkerResult, WorkerTask } from './types.ts';
import { clamp, finite, deepFreeze } from './types.ts';

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

export interface SchedulerReport {
  readonly tick: number;
  readonly queued: number;
  readonly completed: number;
  readonly deferred: number;
  readonly failed: number;
  readonly byClass: Readonly<Record<WorkClass, number>>;
}

const DEFAULT_BUDGETS: readonly BudgetRule[] = Object.freeze([
  { class: 'simulation', budgetMs: 4, maxItems: 256, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'gameplay', budgetMs: 3, maxItems: 256, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'streaming', budgetMs: 2, maxItems: 64, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'network', budgetMs: 1.5, maxItems: 128, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'render', budgetMs: 2, maxItems: 128, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'assets', budgetMs: 2, maxItems: 64, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'persistence', budgetMs: 1, maxItems: 32, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'telemetry', budgetMs: 0.75, maxItems: 32, warningRatio: 0.8, criticalRatio: 1 },
  { class: 'background', budgetMs: 0.5, maxItems: 16, warningRatio: 0.8, criticalRatio: 1 },
]);

export class BudgetSchedulerR42 {
  readonly budgets: ReadonlyMap<WorkClass, BudgetRule>;
  #queues = new Map<WorkClass, WorkerTask[]>();
  #completed = 0;
  #deferred = 0;
  #failed = 0;

  constructor(budgets: readonly BudgetRule[] = DEFAULT_BUDGETS) {
    this.budgets = new Map(
      budgets.map(rule => [rule.class, Object.freeze({
        ...rule,
        budgetMs: Math.max(0.1, finite(rule.budgetMs, 1)),
        maxItems: Math.max(1, Math.trunc(finite(rule.maxItems, 32))),
        warningRatio: clamp(finite(rule.warningRatio, 0.8), 0.1, 1.5),
        criticalRatio: Math.max(0.1, finite(rule.criticalRatio, 1)),
      })]),
    );
  }

  enqueue<T>(task: WorkerTask<T>): boolean {
    const rule = this.budgets.get(task.class);
    if (!rule) return false;
    const queue = this.#queues.get(task.class) ?? [];
    if (queue.length >= rule.maxItems) {
      if (task.priority !== 'critical') return false;
      const candidate = queue.findIndex(value => PRIORITY_ORDER[value.priority] > PRIORITY_ORDER.critical);
      if (candidate < 0) return false;
      queue.splice(candidate, 1);
    }
    queue.push(Object.freeze({ ...task }));
    queue.sort(compareTasks);
    this.#queues.set(task.class, queue);
    return true;
  }

  async run(tick: number, now: () => number = performance.now.bind(performance)): Promise<SchedulerReport> {
    const byClass = createCounter();
    let queued = 0;

    for (const [workClass, queue] of this.#queues) {
      const rule = this.budgets.get(workClass);
      if (!rule) continue;
      const start = now();
      let executed = 0;
      while (queue.length > 0 && executed < rule.maxItems) {
        const elapsed = now() - start;
        if (executed > 0 && elapsed >= rule.budgetMs && workClass !== 'simulation' && workClass !== 'gameplay') {
          this.#deferred += queue.length;
          queued += queue.length;
          byClass[workClass] += queue.length;
          break;
        }
        const task = queue.shift();
        if (!task) break;
        queued += 1;
        try {
          await task.execute(task.payload);
          this.#completed += 1;
          byClass[workClass] += 1;
        } catch {
          this.#failed += 1;
        }
        executed += 1;
      }
    }

    return deepFreeze({
      tick,
      queued,
      completed: this.#completed,
      deferred: this.#deferred,
      failed: this.#failed,
      byClass,
    });
  }

  size(): number {
    let total = 0;
    for (const queue of this.#queues.values()) total += queue.length;
    return total;
  }

  clear(): void {
    for (const queue of this.#queues.values()) queue.length = 0;
    this.#completed = 0;
    this.#deferred = 0;
    this.#failed = 0;
  }

  snapshot(): Readonly<Record<WorkClass, number>> {
    const result = createCounter();
    for (const [workClass, queue] of this.#queues) result[workClass] = queue.length;
    return deepFreeze(result);
  }
}

export function createR42Budgets(): readonly BudgetRule[] {
  return DEFAULT_BUDGETS;
}

function compareTasks(a: WorkerTask, b: WorkerTask): number {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || finite(a.estimatedMs) - finite(b.estimatedMs)
    || a.id.localeCompare(b.id);
}

function createCounter(): Record<WorkClass, number> {
  return {
    simulation: 0,
    gameplay: 0,
    streaming: 0,
    network: 0,
    render: 0,
    assets: 0,
    persistence: 0,
    telemetry: 0,
    background: 0,
  };
}

export function normalizeWorkerResult(
  id: string,
  started: boolean,
  completed: boolean,
  deferred: boolean,
  failed: boolean,
  elapsedMs: number,
  reason: string | null,
): WorkerResult {
  return deepFreeze({
    id,
    started,
    completed,
    deferred,
    failed,
    elapsedMs: Math.max(0, finite(elapsedMs)),
    reason,
  });
}

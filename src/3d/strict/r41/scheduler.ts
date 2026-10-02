
import type { FrameBudget, Priority, SchedulerSnapshot, WorkClass, WorkItem, WorkResult } from './types.ts';
import { finite } from './types.ts';

const PRIORITY: Readonly<Record<Priority, number>> = Object.freeze({
  critical: 100,
  high: 80,
  normal: 60,
  low: 40,
  background: 20,
});

const CLASSES: readonly WorkClass[] = Object.freeze([
  'simulation', 'gameplay', 'streaming', 'network', 'render', 'persistence', 'telemetry', 'background',
]);

export class WorkSchedulerR41 {
  readonly budgets: ReadonlyMap<WorkClass, FrameBudget>;
  #queue: WorkItem[] = [];
  #running = 0;
  #completed = 0;
  #deferred = 0;
  #failed = 0;
  #lastResults: WorkResult[] = [];
  #deferredByClass = new Map<WorkClass, number>();

  constructor(budgets: readonly FrameBudget[]) {
    this.budgets = new Map(budgets.map(budget => [budget.class, Object.freeze({ ...budget })]));
  }

  enqueue<T>(item: WorkItem<T>): boolean {
    if (!item.id || !item.class || !Number.isFinite(item.estimatedMs) || item.estimatedMs < 0) return false;
    const existingIndex = item.coalescingKey
      ? this.#queue.findIndex(entry => entry.class === item.class && entry.coalescingKey === item.coalescingKey)
      : -1;
    if (existingIndex >= 0) this.#queue[existingIndex] = item as WorkItem;
    else this.#queue.push(item as WorkItem);
    return true;
  }

  enqueueMany(items: readonly WorkItem[]): number {
    return items.reduce((count, item) => count + (this.enqueue(item) ? 1 : 0), 0);
  }

  cancel(id: string): boolean {
    const index = this.#queue.findIndex(item => item.id === id);
    if (index < 0) return false;
    this.#queue.splice(index, 1);
    return true;
  }

  clear(): void {
    this.#queue = [];
    this.#lastResults = [];
  }

  async runTick(tick: number, now: () => number = defaultNow): Promise<readonly WorkResult[]> {
    const usage = new Map<WorkClass, { used: number; count: number }>();
    for (const className of CLASSES) usage.set(className, { used: 0, count: 0 });

    const selected = this.select(tick);
    this.#queue = this.#queue.filter(item => !selected.has(item));

    const results: WorkResult[] = [];
    for (const item of selected) {
      const budget = this.budgets.get(item.class);
      const current = usage.get(item.class) ?? { used: 0, count: 0 };
      const countAllowed = !budget || current.count < budget.maxItems;
      const timeAllowed = !budget || current.used + item.estimatedMs <= budget.budgetMs || current.count === 0;
      if (!countAllowed || !timeAllowed) {
        this.defer(item, 'budget');
        results.push(Object.freeze({
          id: item.id,
          class: item.class,
          started: false,
          completed: false,
          deferred: true,
          failed: false,
          reason: 'budget',
          elapsedMs: 0,
        }));
        continue;
      }

      this.#running += 1;
      const started = now();
      try {
        await item.execute(item.payload);
        const elapsedMs = Math.max(0, now() - started);
        current.used += Math.max(item.estimatedMs, elapsedMs);
        current.count += 1;
        this.#completed += 1;
        results.push(Object.freeze({
          id: item.id,
          class: item.class,
          started: true,
          completed: true,
          deferred: false,
          failed: false,
          reason: null,
          elapsedMs,
        }));
      } catch (error) {
        const elapsedMs = Math.max(0, now() - started);
        current.used += elapsedMs;
        current.count += 1;
        this.#failed += 1;
        results.push(Object.freeze({
          id: item.id,
          class: item.class,
          started: true,
          completed: false,
          deferred: false,
          failed: true,
          reason: stringifyError(error),
          elapsedMs,
        }));
      } finally {
        this.#running -= 1;
      }
    }

    this.#lastResults = results;
    return Object.freeze(results);
  }

  pending(): readonly WorkItem[] {
    return Object.freeze(this.#queue.slice());
  }

  lastResults(): readonly WorkResult[] {
    return Object.freeze([...this.#lastResults]);
  }

  snapshot(tick: number): SchedulerSnapshot {
    const deferredByClass = emptyClassRecord();
    for (const className of CLASSES) deferredByClass[className] = this.#deferredByClass.get(className) ?? 0;
    return Object.freeze({
      tick: Math.trunc(tick),
      queued: this.#queue.length,
      running: this.#running,
      completed: this.#completed,
      deferred: this.#deferred,
      failed: this.#failed,
      deferredByClass: Object.freeze(deferredByClass),
    });
  }

  utilizationByClass(): Readonly<Record<WorkClass, number>> {
    const result = emptyClassRecord();
    for (const item of this.#lastResults) {
      if (item.completed) result[item.class] = Math.max(result[item.class], item.elapsedMs);
    }
    return Object.freeze(result);
  }

  private select(tick: number): Set<WorkItem> {
    const candidates = this.#queue.slice().sort((a, b) => {
      const p = PRIORITY[b.priority] - PRIORITY[a.priority];
      if (p !== 0) return p;
      const deadlineA = a.deadlineTick ?? Number.MAX_SAFE_INTEGER;
      const deadlineB = b.deadlineTick ?? Number.MAX_SAFE_INTEGER;
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      if (a.estimatedMs !== b.estimatedMs) return a.estimatedMs - b.estimatedMs;
      return a.id.localeCompare(b.id);
    });

    const selected = new Set<WorkItem>();
    const perClass = emptyClassRecord();
    for (const item of candidates) {
      if (item.deadlineTick !== null && item.deadlineTick < tick) {
        selected.add(item);
        continue;
      }
      const budget = this.budgets.get(item.class);
      if (budget && perClass[item.class] >= budget.maxItems) continue;
      selected.add(item);
      perClass[item.class] += 1;
    }
    return selected;
  }

  private defer(item: WorkItem, reason: string): void {
    this.#queue.push(item);
    this.#deferred += 1;
    this.#deferredByClass.set(item.class, (this.#deferredByClass.get(item.class) ?? 0) + 1);
    if (!reason) this.#deferred += 0;
  }
}

export function createDefaultBudgetsR41(): readonly FrameBudget[] {
  return Object.freeze([
    Object.freeze({ class: 'simulation', budgetMs: 5, maxItems: 64, warningRatio: 0.85, criticalRatio: 1.15 }),
    Object.freeze({ class: 'gameplay', budgetMs: 2.5, maxItems: 48, warningRatio: 0.85, criticalRatio: 1.15 }),
    Object.freeze({ class: 'streaming', budgetMs: 2.5, maxItems: 32, warningRatio: 0.85, criticalRatio: 1.2 }),
    Object.freeze({ class: 'network', budgetMs: 1.5, maxItems: 32, warningRatio: 0.8, criticalRatio: 1.2 }),
    Object.freeze({ class: 'render', budgetMs: 6, maxItems: 32, warningRatio: 0.85, criticalRatio: 1.15 }),
    Object.freeze({ class: 'persistence', budgetMs: 1.5, maxItems: 12, warningRatio: 0.85, criticalRatio: 1.3 }),
    Object.freeze({ class: 'telemetry', budgetMs: 0.75, maxItems: 8, warningRatio: 0.9, criticalRatio: 1.4 }),
    Object.freeze({ class: 'background', budgetMs: 1, maxItems: 8, warningRatio: 0.9, criticalRatio: 1.5 }),
  ]);
}

function emptyClassRecord(): Record<WorkClass, number> {
  return {
    simulation: 0,
    gameplay: 0,
    streaming: 0,
    network: 0,
    render: 0,
    persistence: 0,
    telemetry: 0,
    background: 0,
  };
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

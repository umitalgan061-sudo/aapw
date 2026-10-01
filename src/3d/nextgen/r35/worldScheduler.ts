import type {
  PriorityBand,
  R35FrameBudget,
  R35WorkItem,
  R35WorkResult,
  RuntimePhase,
} from './contracts';
import { clamp } from './contracts';

const PRIORITY_SCORE: Record<PriorityBand, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 5,
};

export interface SchedulerReport {
  readonly tick: number;
  readonly phase: RuntimePhase;
  readonly budgetMs: number;
  readonly spentMs: number;
  readonly remainingMs: number;
  readonly processed: number;
  readonly deferred: number;
  readonly utilization: number;
  readonly criticalOverrun: boolean;
}

export interface SchedulerTickReport {
  readonly tick: number;
  readonly phases: readonly SchedulerReport[];
  readonly completed: readonly R35WorkResult[];
  readonly totalSpentMs: number;
}

export class R35WorkScheduler {
  #budgets = new Map<RuntimePhase, R35FrameBudget>();
  #queues = new Map<RuntimePhase, R35WorkItem[]>();
  #sequence = 0;
  #deferredCount = 0;

  constructor(budgets: readonly R35FrameBudget[]) {
    for (const budget of budgets) {
      this.#budgets.set(budget.phase, { ...budget });
      this.#queues.set(budget.phase, []);
    }
  }

  enqueue<T>(item: R35WorkItem<T>): string {
    const queue = this.#queues.get(item.phase);
    if (!queue) throw new Error('unknown scheduler phase: ' + item.phase);
    const id = item.id || item.phase + '-' + (++this.#sequence);
    const work: R35WorkItem = { ...item, id };
    if (work.coalescingKey) {
      const index = queue.findIndex((entry) => entry.coalescingKey === work.coalescingKey);
      if (index >= 0) queue[index] = work;
      else queue.push(work);
    } else {
      queue.push(work);
    }
    return id;
  }

  cancel(id: string): boolean {
    let removed = false;
    for (const queue of this.#queues.values()) {
      const index = queue.findIndex((item) => item.id === id);
      if (index >= 0) {
        queue.splice(index, 1);
        removed = true;
        break;
      }
    }
    return removed;
  }

  clear(phase?: RuntimePhase): void {
    if (phase) this.#queues.get(phase)?.splice(0);
    else for (const queue of this.#queues.values()) queue.splice(0);
  }

  pending(phase?: RuntimePhase): number {
    if (phase) return this.#queues.get(phase)?.length ?? 0;
    let total = 0;
    for (const queue of this.#queues.values()) total += queue.length;
    return total;
  }

  async runTick(tick: number, actualCostMs: (item: R35WorkItem) => number = (item) => item.estimatedMs): Promise<SchedulerTickReport> {
    const completed: R35WorkResult[] = [];
    const phaseReports: SchedulerReport[] = [];
    let totalSpentMs = 0;

    for (const phase of this.#budgets.keys()) {
      const report = await this.runPhase(phase, tick, actualCostMs, completed);
      phaseReports.push(report);
      totalSpentMs += report.spentMs;
    }

    return Object.freeze({
      tick,
      phases: Object.freeze(phaseReports),
      completed: Object.freeze(completed),
      totalSpentMs,
    });
  }

  async runPhase(
    phase: RuntimePhase,
    tick: number,
    actualCostMs: (item: R35WorkItem) => number = (item) => item.estimatedMs,
    sink: R35WorkResult[] = [],
  ): Promise<SchedulerReport> {
    const queue = this.#queues.get(phase);
    const budget = this.#budgets.get(phase);
    if (!queue || !budget) throw new Error('unknown scheduler phase: ' + phase);

    queue.sort((a, b) => {
      const priority = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority];
      if (priority !== 0) return priority;
      const deadlineA = a.deadlineTick === null ? Number.POSITIVE_INFINITY : a.deadlineTick;
      const deadlineB = b.deadlineTick === null ? Number.POSITIVE_INFINITY : b.deadlineTick;
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      return a.id.localeCompare(b.id);
    });

    let spentMs = 0;
    let processed = 0;
    let deferred = 0;
    const nextQueue: R35WorkItem[] = [];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const cost = clamp(actualCostMs(item), 0, Math.max(item.estimatedMs, budget.budgetMs * 4));
      const expired = item.deadlineTick !== null && tick > item.deadlineTick;
      const budgetExceeded = spentMs + cost > budget.budgetMs && item.priority !== 'critical';
      const itemLimitExceeded = processed >= budget.maxWorkItems && item.priority !== 'critical';

      if (expired) {
        sink.push({ id: item.id, phase, started: false, completed: false, deferred: false, reason: 'deadline-expired' });
        continue;
      }

      if (budgetExceeded || itemLimitExceeded) {
        nextQueue.push(item);
        deferred += 1;
        this.#deferredCount += 1;
        sink.push({
          id: item.id,
          phase,
          started: false,
          completed: false,
          deferred: true,
          reason: budgetExceeded ? 'budget' : 'work-item-limit',
        });
        continue;
      }

      try {
        await item.execute(item.payload);
        spentMs += cost;
        processed += 1;
        sink.push({ id: item.id, phase, started: true, completed: true, deferred: false, reason: null });
      } catch (error) {
        spentMs += cost;
        processed += 1;
        sink.push({
          id: item.id,
          phase,
          started: true,
          completed: false,
          deferred: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    queue.push(...nextQueue);
    const utilization = budget.budgetMs <= 0 ? 0 : spentMs / budget.budgetMs;
    return Object.freeze({
      tick,
      phase,
      budgetMs: budget.budgetMs,
      spentMs,
      remainingMs: Math.max(0, budget.budgetMs - spentMs),
      processed,
      deferred,
      utilization,
      criticalOverrun: utilization > budget.criticalRatio,
    });
  }

  get deferredCount(): number {
    return this.#deferredCount;
  }
}

export function createDefaultR35Budgets(): readonly R35FrameBudget[] {
  return Object.freeze([
    { phase: 'input', budgetMs: 0.75, warningRatio: 0.85, criticalRatio: 1, maxWorkItems: 64 },
    { phase: 'simulation', budgetMs: 4.5, warningRatio: 0.82, criticalRatio: 1, maxWorkItems: 128 },
    { phase: 'ai', budgetMs: 1.6, warningRatio: 0.82, criticalRatio: 1, maxWorkItems: 64 },
    { phase: 'navigation', budgetMs: 1.2, warningRatio: 0.82, criticalRatio: 1, maxWorkItems: 64 },
    { phase: 'streaming', budgetMs: 2.0, warningRatio: 0.8, criticalRatio: 1, maxWorkItems: 48 },
    { phase: 'network', budgetMs: 1.1, warningRatio: 0.8, criticalRatio: 1, maxWorkItems: 64 },
    { phase: 'persistence', budgetMs: 0.8, warningRatio: 0.8, criticalRatio: 1, maxWorkItems: 32 },
    { phase: 'render', budgetMs: 8.0, warningRatio: 0.86, criticalRatio: 1, maxWorkItems: 256 },
    { phase: 'telemetry', budgetMs: 0.4, warningRatio: 0.8, criticalRatio: 1, maxWorkItems: 64 },
  ]);
}

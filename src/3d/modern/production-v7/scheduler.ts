import { SchedulerLaneV7, SchedulerReportV7, TaskContextV7, TaskResultV7, TaskSpecV7, TickV7, tickV7 } from './types.ts';
import { DeterministicRngV7 } from './deterministic.ts';

interface InternalTask<T> extends TaskSpecV7<T> {
  readonly enqueuedAtTick: TickV7;
  deferred: number;
  sequence: number;
}

const LANE_ORDER: readonly SchedulerLaneV7[] = ['critical', 'simulation', 'streaming', 'render', 'telemetry', 'background'];
const BASE_WEIGHT: Readonly<Record<SchedulerLaneV7, number>> = Object.freeze({
  critical: 1000, simulation: 800, streaming: 500, render: 500, telemetry: 200, background: 50,
});

export class BudgetSchedulerV7 {
  readonly #queues = new Map<SchedulerLaneV7, InternalTask<unknown>[]>();
  readonly #rng: DeterministicRngV7;
  #sequence = 0;
  #tick: TickV7 = tickV7(0);

  constructor(seed = 0x7a11ce, lanes: readonly SchedulerLaneV7[] = LANE_ORDER) {
    this.#rng = new DeterministicRngV7(seed);
    for (const lane of lanes) this.#queues.set(lane, []);
  }

  get tick(): TickV7 { return this.#tick; }

  enqueue<T>(task: TaskSpecV7<T>): boolean {
    if (!task.id || !this.#queues.has(task.lane)) return false;
    const queue = this.#queues.get(task.lane)!;
    const exists = queue.some((candidate) => candidate.id === task.id);
    if (exists) return false;
    queue.push({ ...task, enqueuedAtTick: this.#tick, deferred: 0, sequence: ++this.#sequence });
    return true;
  }

  cancel(id: string): boolean {
    for (const queue of this.#queues.values()) {
      const index = queue.findIndex((task) => task.id === id);
      if (index >= 0) { queue.splice(index, 1); return true; }
    }
    return false;
  }

  queuedCount(): number { let total = 0; for (const queue of this.#queues.values()) total += queue.length; return total; }

  runTick(tick: TickV7, budgetMs: number): SchedulerReportV7 {
    this.#tick = tick;
    const spent = { value: 0 };
    const counts = new Map<SchedulerLaneV7, { executed: number; deferred: number; spentMs: number }>();
    for (const lane of LANE_ORDER) counts.set(lane, { executed: 0, deferred: 0, spentMs: 0 });
    const candidates = this.#collectCandidates(tick);
    let deferred = 0, failed = 0, expired = 0, executed = 0;

    while (candidates.length > 0) {
      const index = this.#selectCandidate(candidates, spent.value, budgetMs);
      if (index < 0) break;
      const [task] = candidates.splice(index, 1);
      if (!task) continue;
      const laneCounts = counts.get(task.lane)!;
      if (task.expiresAtTick !== undefined && Number(task.expiresAtTick) < Number(tick)) {
        this.#removeTask(task.id); expired += 1; continue;
      }
      const available = Math.max(0, budgetMs - spent.value);
      const predicted = Math.max(0, task.costEstimateMs);
      if (task.budgetClass === 'must-run' || predicted <= available) {
        const context: TaskContextV7 = Object.freeze({ tick, budgetRemainingMs: available, deterministicSeed: this.#rng.fork(task.sequence).digest(), lane: task.lane });
        let result: TaskResultV7;
        try { result = task.run(task.payload, context); } catch (error) {
          failed += 1; this.#removeTask(task.id); laneCounts.executed += 1;
          laneCounts.spentMs += predicted;
          spent.value += predicted;
          continue;
        }
        executed += 1; laneCounts.executed += 1; laneCounts.spentMs += Math.max(0, result.costMs); spent.value += Math.max(0, result.costMs);
        if (result.outcome === 'failed') failed += 1;
        this.#removeTask(task.id);
      } else {
        task.deferred += 1; deferred += 1; laneCounts.deferred += 1;
        if (task.deferred > task.maxDeferrals || task.budgetClass === 'opportunistic') this.#removeTask(task.id);
        else if (!candidates.some((candidate) => candidate.id === task.id)) candidates.push(task);
      }
    }

    const byLane = {} as SchedulerReportV7['byLane'];
    for (const lane of LANE_ORDER) {
      const stats = counts.get(lane)!;
      byLane[lane] = Object.freeze({ ...stats });
    }
    return Object.freeze({ tick, budgetMs, spentMs: spent.value, executed, deferred, failed, expired, byLane });
  }

  #collectCandidates(tick: TickV7): InternalTask<unknown>[] {
    const result: InternalTask<unknown>[] = [];
    for (const queue of this.#queues.values()) for (const task of queue) {
      if (task.expiresAtTick !== undefined && Number(task.expiresAtTick) < Number(tick)) result.push(task);
      else result.push(task);
    }
    return result;
  }

  #selectCandidate(candidates: readonly InternalTask<unknown>[], spent: number, budget: number): number {
    let bestIndex = -1; let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      const task = candidates[index]!;
      const age = Math.max(0, Number(this.#tick) - Number(task.enqueuedAtTick));
      const lane = BASE_WEIGHT[task.lane] ?? 0;
      const affordability = task.costEstimateMs <= Math.max(0, budget - spent) ? 100 : task.budgetClass === 'must-run' ? 50 : -100;
      const score = lane + task.priority * 10 + age * 2 + affordability + task.deferred * 30 - task.costEstimateMs;
      if (score > bestScore || (score === bestScore && task.sequence < candidates[bestIndex]?.sequence)) { bestScore = score; bestIndex = index; }
    }
    return bestIndex;
  }

  #removeTask(id: string): void {
    for (const queue of this.#queues.values()) {
      const index = queue.findIndex((task) => task.id === id);
      if (index >= 0) { queue.splice(index, 1); return; }
    }
  }
}

export const schedulerLanesV7 = Object.freeze([...LANE_ORDER]);

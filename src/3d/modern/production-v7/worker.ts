import { SchedulerLaneV7, TaskContextV7, TaskOutcomeV7, TaskSpecV7, TickV7, tickV7 } from './types.ts';
import { BudgetSchedulerV7 } from './scheduler.ts';

export interface WorkerJobV7<TPayload, TResult> {
  readonly id: string;
  readonly lane: SchedulerLaneV7;
  readonly priority: number;
  readonly payload: TPayload;
  readonly execute: (payload: TPayload, context: WorkerJobContextV7) => TResult;
  readonly estimatedMs?: number;
  readonly ttlTicks?: number;
}

export interface WorkerJobContextV7 {
  readonly tick: TickV7;
  readonly workerId: number;
  readonly deterministicSeed: number;
}

export interface WorkerResultV7<TResult> {
  readonly id: string;
  readonly workerId: number;
  readonly outcome: TaskOutcomeV7;
  readonly result?: TResult;
  readonly costMs: number;
  readonly error?: string;
}

interface JobEnvelope<TPayload, TResult> {
  readonly job: WorkerJobV7<TPayload, TResult>;
  readonly submittedTick: TickV7;
  readonly taskId: string;
}

export interface WorkerPoolStatsV7 {
  readonly workers: number;
  readonly active: number;
  readonly queued: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

export class DeterministicWorkerPoolV7 {
  readonly #scheduler: BudgetSchedulerV7;
  readonly #workerCount: number;
  readonly #active = new Set<string>();
  readonly #results: WorkerResultV7<unknown>[] = [];
  #completed = 0;
  #failed = 0;
  #cancelled = 0;
  #serial = 0;

  constructor(workerCount: number, seed = 0x77a11) {
    this.#workerCount = Math.max(1, Math.min(16, Math.trunc(workerCount)));
    this.#scheduler = new BudgetSchedulerV7(seed);
  }

  submit<TPayload, TResult>(job: WorkerJobV7<TPayload, TResult>, currentTick: TickV7): boolean {
    if (!job.id || this.#active.has(job.id)) return false;
    const taskId = `worker:${job.id}`;
    const envelope: JobEnvelope<TPayload, TResult> = Object.freeze({ job, submittedTick: currentTick, taskId });
    const spec: TaskSpecV7<JobEnvelope<TPayload, TResult>> = {
      id: taskId,
      lane: job.lane,
      priority: job.priority,
      costEstimateMs: Math.max(0, job.estimatedMs ?? 0.1),
      budgetClass: job.lane === 'critical' || job.lane === 'simulation' ? 'preferred' : 'opportunistic',
      maxDeferrals: 8,
      expiresAtTick: job.ttlTicks === undefined ? undefined : tickV7(Number(currentTick) + Math.max(0, Math.trunc(job.ttlTicks))),
      payload: envelope,
      run: (value, context) => {
        const workerId = this.#chooseWorker(job.id);
        this.#active.add(job.id);
        try {
          const result = value.job.execute(value.job.payload, { tick: context.tick, workerId, deterministicSeed: context.deterministicSeed });
          this.#results.push(Object.freeze({ id: value.job.id, workerId, outcome: 'executed', result, costMs: Math.max(0, context.budgetRemainingMs - (context.budgetRemainingMs - value.job.estimatedMs!)) }));
          this.#completed += 1;
          return { outcome: 'executed', costMs: Math.max(0, value.job.estimatedMs ?? 0.1) };
        } catch (error) {
          this.#results.push(Object.freeze({ id: value.job.id, workerId, outcome: 'failed', costMs: Math.max(0, value.job.estimatedMs ?? 0.1), error: error instanceof Error ? error.message : String(error) }));
          this.#failed += 1;
          return { outcome: 'failed', costMs: Math.max(0, value.job.estimatedMs ?? 0.1) };
        } finally {
          this.#active.delete(job.id);
        }
      },
    };
    const accepted = this.#scheduler.enqueue(spec);
    if (!accepted) return false;
    this.#active.add(job.id);
    return true;
  }

  cancel(id: string): boolean {
    const cancelled = this.#scheduler.cancel(`worker:${id}`);
    if (cancelled) { this.#active.delete(id); this.#cancelled += 1; }
    return cancelled;
  }

  run(tick: TickV7, budgetMs = 2.5): ReturnType<BudgetSchedulerV7['runTick']> {
    return this.#scheduler.runTick(tick, budgetMs);
  }

  drainResults(): readonly WorkerResultV7<unknown>[] {
    const values = [...this.#results];
    this.#results.length = 0;
    return Object.freeze(values);
  }

  stats(): WorkerPoolStatsV7 {
    return Object.freeze({
      workers: this.#workerCount,
      active: this.#active.size,
      queued: this.#scheduler.queuedCount(),
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
    });
  }

  #chooseWorker(id: string): number {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index += 1) { hash ^= id.charCodeAt(index); hash = Math.imul(hash, 16777619) >>> 0; }
    return hash % this.#workerCount;
  }
}

import type { Result } from './platform.js';
import { err, ok } from './platform.js';

export type TaskId = string;
export type TaskPhase = 'input' | 'simulation' | 'streaming' | 'animation' | 'render-prep' | 'render' | 'post-render' | 'telemetry';
export type TaskStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'blocked';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface TaskContext {
  readonly frameId: number;
  readonly tick: number;
  readonly signal: AbortSignal;
  readonly budgetMs: number;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface TaskResult<T> {
  readonly value: T;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
}

export interface TaskDefinition<T = unknown> {
  readonly id: TaskId;
  readonly phase: TaskPhase;
  readonly priority: TaskPriority;
  readonly dependencies: readonly TaskId[];
  readonly estimatedCostMs: number;
  readonly optional: boolean;
  readonly run: (context: TaskContext) => Promise<T> | T;
}

export interface TaskRecord<T = unknown> {
  readonly definition: TaskDefinition<T>;
  readonly status: TaskStatus;
  readonly result?: TaskResult<T>;
  readonly error?: unknown;
  readonly attempts: number;
}

export interface TaskExecutionSummary {
  readonly frameId: number;
  readonly completed: readonly TaskId[];
  readonly failed: readonly TaskId[];
  readonly skipped: readonly TaskId[];
  readonly elapsedMs: number;
  readonly consumedBudgetMs: number;
}

const priorityWeight: Record<TaskPriority, number> = {
  critical: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

const phaseWeight: Record<TaskPhase, number> = {
  input: 0,
  simulation: 1,
  streaming: 2,
  animation: 3,
  'render-prep': 4,
  render: 5,
  'post-render': 6,
  telemetry: 7,
};

export class DeterministicTaskGraph {
  readonly #tasks = new Map<TaskId, TaskRecord>();

  add<T>(definition: TaskDefinition<T>): Result<void, Error> {
    if (!definition.id.trim()) return err(new Error('Task id must not be empty'));
    if (this.#tasks.has(definition.id)) return err(new Error(`Task already exists: ${definition.id}`));
    if (!Number.isFinite(definition.estimatedCostMs) || definition.estimatedCostMs < 0) return err(new Error('Task cost must be finite and non-negative'));
    this.#tasks.set(definition.id, { definition, status: 'pending', attempts: 0 });
    return ok(undefined);
  }

  remove(id: TaskId): boolean {
    const task = this.#tasks.get(id);
    if (!task || task.status === 'running') return false;
    this.#tasks.delete(id);
    return true;
  }

  clear(): void {
    this.#tasks.clear();
  }

  has(id: TaskId): boolean {
    return this.#tasks.has(id);
  }

  get(id: TaskId): TaskRecord | undefined {
    return this.#tasks.get(id);
  }

  list(): readonly TaskRecord[] {
    return [...this.#tasks.values()];
  }

  #dependenciesSatisfied(record: TaskRecord): boolean {
    return record.definition.dependencies.every((dependency) => this.#tasks.get(dependency)?.status === 'succeeded');
  }

  #dependencyFailed(record: TaskRecord): boolean {
    return record.definition.dependencies.some((dependency) => {
      const status = this.#tasks.get(dependency)?.status;
      return status === 'failed' || status === 'cancelled' || status === undefined;
    });
  }

  #orderedReady(): TaskRecord[] {
    const ready = [...this.#tasks.values()].filter((record) => record.status === 'pending' && this.#dependenciesSatisfied(record));
    return ready.sort((a, b) => phaseWeight[a.definition.phase] - phaseWeight[b.definition.phase]
      || priorityWeight[b.definition.priority] - priorityWeight[a.definition.priority]
      || a.definition.estimatedCostMs - b.definition.estimatedCostMs
      || a.definition.id.localeCompare(b.definition.id));
  }

  #blockImpossible(): void {
    for (const record of this.#tasks.values()) {
      if (record.status !== 'pending') continue;
      if (this.#dependencyFailed(record)) {
        this.#tasks.set(record.definition.id, { ...record, status: 'blocked' });
      }
    }
  }

  async execute(context: TaskContext): Promise<TaskExecutionSummary> {
    const startedAt = performance.now();
    const completed: TaskId[] = [];
    const failed: TaskId[] = [];
    const skipped: TaskId[] = [];
    let consumedBudgetMs = 0;

    while (true) {
      this.#blockImpossible();
      const next = this.#orderedReady()[0];
      if (!next) break;
      if (context.signal.aborted) {
        skipped.push(next.definition.id);
        this.#tasks.set(next.definition.id, { ...next, status: 'cancelled' });
        continue;
      }
      const remaining = context.budgetMs - consumedBudgetMs;
      if (next.definition.optional && next.definition.estimatedCostMs > remaining) {
        skipped.push(next.definition.id);
        this.#tasks.set(next.definition.id, { ...next, status: 'cancelled' });
        continue;
      }
      const running: TaskRecord = { ...next, status: 'running', attempts: next.attempts + 1 };
      this.#tasks.set(next.definition.id, running);
      const taskStarted = performance.now();
      try {
        const value = await next.definition.run(context);
        const finishedAt = performance.now();
        const durationMs = Math.max(0, finishedAt - taskStarted);
        consumedBudgetMs += durationMs;
        this.#tasks.set(next.definition.id, {
          ...running,
          status: 'succeeded',
          result: { value, startedAt: taskStarted, finishedAt, durationMs },
        });
        completed.push(next.definition.id);
      } catch (error) {
        const finishedAt = performance.now();
        consumedBudgetMs += Math.max(0, finishedAt - taskStarted);
        this.#tasks.set(next.definition.id, { ...running, status: 'failed', error });
        failed.push(next.definition.id);
      }
    }

    return {
      frameId: context.frameId,
      completed,
      failed,
      skipped,
      elapsedMs: Math.max(0, performance.now() - startedAt),
      consumedBudgetMs,
    };
  }
}

export function assertAcyclic(graph: DeterministicTaskGraph): void {
  const visiting = new Set<TaskId>();
  const visited = new Set<TaskId>();
  const visit = (id: TaskId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Task dependency cycle detected at ${id}`);
    const record = graph.get(id);
    if (!record) throw new Error(`Unknown task dependency: ${id}`);
    visiting.add(id);
    for (const dependency of record.definition.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const record of graph.list()) visit(record.definition.id);
}

export function estimateGraphCost(graph: DeterministicTaskGraph): number {
  return graph.list().reduce((sum, record) => sum + record.definition.estimatedCostMs, 0);
}

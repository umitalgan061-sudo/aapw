import type {
  RuntimeBudgetR31,
  RuntimeFrameR31,
  RuntimePhase,
  RuntimePriority,
  RuntimeTaskR31,
  RuntimeTaskResultR31,
} from './applicationTypesR31.ts';

const PRIORITY_WEIGHT: Record<RuntimePriority, number> = {
  critical: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

interface RegisteredTask {
  task: RuntimeTaskR31;
  order: number;
}

export interface SchedulerDiagnosticsR31 {
  readonly updates: number;
  readonly skipped: number;
  readonly budgetViolations: number;
  readonly lastFrameWorkMs: number;
  readonly byPhase: Readonly<Record<RuntimePhase, number>>;
}

export class SchedulerR31 {
  readonly #tasks = new Map<string, RegisteredTask>();
  readonly #budget: RuntimeBudgetR31;
  #order = 0;
  #updates = 0;
  #skipped = 0;
  #budgetViolations = 0;
  #lastFrameWorkMs = 0;
  readonly #byPhase: Record<RuntimePhase, number> = {
    bootstrap: 0, input: 0, simulation: 0, world: 0, gameplay: 0, render: 0,
    audio: 0, network: 0, persistence: 0, diagnostics: 0, teardown: 0,
  };

  constructor(budget: RuntimeBudgetR31) {
    this.#budget = Object.freeze({ ...budget });
  }

  register(task: RuntimeTaskR31): () => void {
    if (!task.id.trim()) throw new Error('Task id cannot be empty');
    if (this.#tasks.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    this.#tasks.set(task.id, { task, order: ++this.#order });
    return () => this.#tasks.delete(task.id);
  }

  enable(id: string, enabled: boolean): boolean {
    const record = this.#tasks.get(id);
    if (!record) return false;
    record.task = { ...record.task, enabled };
    return true;
  }

  runFrame(frame: RuntimeFrameR31, maxTasks = 10_000): readonly RuntimeTaskResultR31[] {
    const selected = [...this.#tasks.values()]
      .filter((entry) => entry.task.enabled)
      .sort((a, b) =>
        PRIORITY_WEIGHT[b.task.priority] - PRIORITY_WEIGHT[a.task.priority]
        || a.order - b.order,
      )
      .slice(0, Math.max(0, maxTasks));

    const results: RuntimeTaskResultR31[] = [];
    const start = performance.now();
    for (const entry of selected) {
      const taskStart = performance.now();
      try {
        entry.task.update(frame);
        const durationMs = performance.now() - taskStart;
        this.#updates++;
        this.#byPhase[entry.task.phase] += 1;
        const budgetExceeded = durationMs > entry.task.maxWorkMs;
        if (budgetExceeded) this.#budgetViolations++;
        results.push(Object.freeze({ id: entry.task.id, durationMs, budgetExceeded }));
      } catch {
        this.#updates++;
        this.#budgetViolations++;
        results.push(Object.freeze({ id: entry.task.id, durationMs: performance.now() - taskStart, budgetExceeded: true }));
      }
      if (performance.now() - start >= this.#budget.frameMs) {
        this.#skipped += Math.max(0, selected.length - results.length);
        break;
      }
    }
    this.#lastFrameWorkMs = performance.now() - start;
    return Object.freeze(results);
  }

  list(phase?: RuntimePhase): readonly RuntimeTaskR31[] {
    const tasks = [...this.#tasks.values()]
      .map((entry) => entry.task)
      .filter((task) => phase === undefined || task.phase === phase);
    return Object.freeze(tasks);
  }

  diagnostics(): SchedulerDiagnosticsR31 {
    return Object.freeze({
      updates: this.#updates,
      skipped: this.#skipped,
      budgetViolations: this.#budgetViolations,
      lastFrameWorkMs: this.#lastFrameWorkMs,
      byPhase: Object.freeze({ ...this.#byPhase }),
    });
  }

  dispose(): void {
    this.#tasks.clear();
  }
}

/** V15 deterministic execution graph: explicit dependencies, priorities and budget accounting. */
export type ExecutionPhaseV15 = 'input' | 'simulation' | 'world' | 'streaming' | 'network' | 'render' | 'telemetry';
export type ExecutionStatusV15 = 'completed' | 'skipped' | 'failed' | 'blocked' | 'cancelled';
export type ExecutionPriorityV15 = 0 | 1 | 2 | 3 | 4 | 5;

export interface ExecutionTaskV15<T = unknown> {
  readonly id: string;
  readonly phase: ExecutionPhaseV15;
  readonly priority: ExecutionPriorityV15;
  readonly budgetMs: number;
  readonly dependsOn?: readonly string[];
  readonly critical?: boolean;
  readonly enabled?: () => boolean;
  readonly run: (input: T, context: ExecutionContextV15) => T | Promise<T>;
}

export interface ExecutionContextV15 {
  readonly frame: number;
  readonly tick: number;
  readonly deltaMs: number;
  readonly phase: ExecutionPhaseV15;
  readonly signal: AbortSignal;
  readonly remainingBudgetMs: number;
  readonly consumeBudget: (ms: number) => boolean;
}

export interface ExecutionResultV15 {
  readonly id: string;
  readonly phase: ExecutionPhaseV15;
  readonly status: ExecutionStatusV15;
  readonly durationMs: number;
  readonly budgetMs: number;
  readonly remainingBudgetMs: number;
  readonly error?: string;
}

export interface ExecutionReportV15 {
  readonly frame: number;
  readonly tick: number;
  readonly totalDurationMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  readonly results: readonly ExecutionResultV15[];
  readonly completed: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly string[];
  readonly blocked: readonly string[];
}

const phases: readonly ExecutionPhaseV15[] = ['input','simulation','world','streaming','network','render','telemetry'];
const phaseOrder = new Map(phases.map((phase, index) => [phase, index]));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, finite(value, min)));

interface InternalTask<T> extends ExecutionTaskV15<T> { readonly order: number; }

export class ExecutionGraphV15<T = unknown> {
  readonly #tasks = new Map<string, InternalTask<T>>();
  readonly #order: string[] = [];
  #sequence = 0;

  add(task: ExecutionTaskV15<T>): () => void {
    const id = task.id.trim();
    if (!id) throw new Error('Execution task id cannot be empty.');
    if (this.#tasks.has(id)) throw new Error('Execution task already exists: ' + id);
    if (!phaseOrder.has(task.phase)) throw new Error('Unknown execution phase: ' + task.phase);
    const normalized: InternalTask<T> = Object.freeze({
      ...task,
      id,
      priority: Math.max(0, Math.min(5, Math.trunc(task.priority))) as ExecutionPriorityV15,
      budgetMs: clamp(task.budgetMs, 0.01, 1000),
      dependsOn: Object.freeze([...(task.dependsOn ?? [])]),
      order: this.#sequence++,
    });
    this.#tasks.set(id, normalized);
    this.#order.push(id);
    return () => { if (this.#tasks.get(id) === normalized) { this.#tasks.delete(id); const index = this.#order.indexOf(id); if (index >= 0) this.#order.splice(index, 1); } };
  }

  remove(id: string): boolean { const removed = this.#tasks.delete(id); if (removed) { const index=this.#order.indexOf(id); if(index>=0)this.#order.splice(index,1); } return removed; }
  has(id: string): boolean { return this.#tasks.has(id); }
  get(id: string): ExecutionTaskV15<T> | undefined { const task=this.#tasks.get(id); return task ? { ...task, dependsOn:[...(task.dependsOn??[])] } : undefined; }
  size(): number { return this.#tasks.size; }
  clear(): void { this.#tasks.clear(); this.#order.length=0; }

  validate(): readonly string[] {
    const errors: string[] = [];
    for (const task of this.#tasks.values()) {
      for (const dependency of task.dependsOn ?? []) {
        if (!this.#tasks.has(dependency)) errors.push(task.id + ' depends on missing task ' + dependency);
      }
    }
    try { this.order(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    return Object.freeze([...new Set(errors)]);
  }

  order(): readonly ExecutionTaskV15<T>[] {
    const pending = new Map(this.#tasks);
    const result: InternalTask<T>[] = [];
    while (pending.size) {
      const ready = [...pending.values()]
        .filter((task) => (task.dependsOn ?? []).every((id) => result.some((done) => done.id === id)))
        .sort((a, b) => phaseOrder.get(a.phase)! - phaseOrder.get(b.phase)! || b.priority - a.priority || a.order - b.order || a.id.localeCompare(b.id));
      if (!ready.length) throw new Error('Execution graph contains a dependency cycle.');
      for (const task of ready) { result.push(task); pending.delete(task.id); }
    }
    return Object.freeze(result);
  }

  async runFrame(input: T, options: Readonly<{ frame: number; tick: number; deltaMs: number; budgetMs: number; signal?: AbortSignal }> ): Promise<{ readonly output: T; readonly report: ExecutionReportV15 }> {
    const budgetMs = Math.max(0.01, finite(options.budgetMs, 0.01));
    const controller = options.signal ? undefined : new AbortController();
    const signal = options.signal ?? controller!.signal;
    let remaining = budgetMs;
    let output = input;
    const results: ExecutionResultV15[] = [];
    const completed: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    const blocked: string[] = [];
    const frameStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const order = this.order();
    const statusById = new Map<string, ExecutionStatusV15>();

    for (const task of order) {
      if (signal.aborted) { statusById.set(task.id, 'cancelled'); results.push(Object.freeze({ id:task.id, phase:task.phase, status:'cancelled', durationMs:0, budgetMs:task.budgetMs, remainingBudgetMs:remaining })); continue; }
      if (task.enabled && !task.enabled()) { statusById.set(task.id, 'skipped'); skipped.push(task.id); results.push(Object.freeze({ id:task.id, phase:task.phase, status:'skipped', durationMs:0, budgetMs:task.budgetMs, remainingBudgetMs:remaining })); continue; }
      if ((task.dependsOn ?? []).some((id) => ['failed','blocked','cancelled'].includes(statusById.get(id) ?? ''))) { statusById.set(task.id,'blocked'); blocked.push(task.id); results.push(Object.freeze({ id:task.id, phase:task.phase, status:'blocked', durationMs:0, budgetMs:task.budgetMs, remainingBudgetMs:remaining })); continue; }
      if (remaining < task.budgetMs && !task.critical) { statusById.set(task.id,'skipped'); skipped.push(task.id); results.push(Object.freeze({ id:task.id, phase:task.phase, status:'skipped', durationMs:0, budgetMs:task.budgetMs, remainingBudgetMs:remaining })); continue; }
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let spent = 0;
      try {
        const context: ExecutionContextV15 = Object.freeze({ frame: Math.max(0, Math.trunc(options.frame)), tick: Math.max(0, Math.trunc(options.tick)), deltaMs: Math.max(0, finite(options.deltaMs)), phase: task.phase, signal, remainingBudgetMs: remaining, consumeBudget: (ms) => { const cost=Math.max(0, finite(ms)); spent += cost; remaining = Math.max(0, remaining-cost); return remaining >= 0; } });
        output = await task.run(output, context);
        const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const duration = Math.max(0, ended - started);
        remaining = Math.max(0, remaining - Math.max(spent, duration));
        const overBudget = duration > task.budgetMs;
        if (overBudget && task.critical) failed.push(task.id);
        else completed.push(task.id);
        statusById.set(task.id, overBudget && task.critical ? 'failed' : 'completed');
        results.push(Object.freeze({ id:task.id, phase:task.phase, status:overBudget && task.critical ? 'failed' : 'completed', durationMs:duration, budgetMs:task.budgetMs, remainingBudgetMs:remaining }));
      } catch (error) {
        const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const duration = Math.max(0, ended - started);
        remaining = Math.max(0, remaining - duration);
        statusById.set(task.id, 'failed'); failed.push(task.id);
        results.push(Object.freeze({ id:task.id, phase:task.phase, status:'failed', durationMs:duration, budgetMs:task.budgetMs, remainingBudgetMs:remaining, error:error instanceof Error ? error.message : String(error) }));
        if (task.critical) break;
      }
    }
    const totalDurationMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - frameStarted);
    const report: ExecutionReportV15 = Object.freeze({ frame:Math.max(0,Math.trunc(options.frame)), tick:Math.max(0,Math.trunc(options.tick)), totalDurationMs, budgetMs, overBudget: totalDurationMs>budgetMs, results:Object.freeze(results), completed:Object.freeze(completed), skipped:Object.freeze(skipped), failed:Object.freeze(failed), blocked:Object.freeze(blocked) });
    return Object.freeze({ output, report });
  }

  phaseTasks(phase: ExecutionPhaseV15): readonly string[] { return Object.freeze(this.order().filter((task)=>task.phase===phase).map((task)=>task.id)); }
  criticalTasks(): readonly string[] { return Object.freeze(this.order().filter((task)=>task.critical).map((task)=>task.id)); }
  describe(): readonly Readonly<Record<string, unknown>>[] { return Object.freeze(this.order().map((task)=>Object.freeze({ id:task.id, phase:task.phase, priority:task.priority, budgetMs:task.budgetMs, dependsOn:[...(task.dependsOn??[])], critical:task.critical??false }))); }
}

export const phaseV15Order = (): readonly ExecutionPhaseV15[] => phases;

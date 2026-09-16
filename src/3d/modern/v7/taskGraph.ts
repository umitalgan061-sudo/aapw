import { clamp, integer, stableSort, type Disposable, type TaskId, asTaskId, type V7Result } from './primitives.js';

export type TaskState = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface RuntimeTask { readonly id: TaskId; readonly deps: readonly TaskId[]; readonly priority: number; readonly costMs: number; readonly run: () => void | Promise<void>; }
export interface TaskRecord extends RuntimeTask { readonly state: TaskState; readonly attempts: number; readonly queuedAt: number; readonly completedAt: number | null; readonly error: string | null; }
export interface TaskGraphReport { readonly completed: readonly TaskId[]; readonly failed: readonly TaskId[]; readonly cancelled: readonly TaskId[]; readonly blocked: readonly TaskId[]; readonly cycles: readonly TaskId[]; }

export class RuntimeTaskGraph implements Disposable {
  #tasks = new Map<TaskId, TaskRecord>();
  #disposed = false;
  #serial = 0;

  register(task: Omit<RuntimeTask, 'id'> & { id: string }): V7Result<TaskId> {
    if (this.#disposed) return { ok: false, code: 'TASKGRAPH_DISPOSED', message: 'Task graph is disposed', retryable: false };
    const id = asTaskId(task.id.trim());
    if (!id || this.#tasks.has(id) || id.length > 128) return { ok: false, code: 'TASK_DUPLICATE', message: 'Task id is invalid or already registered', retryable: false };
    if (task.deps.some((dep) => dep === id)) return { ok: false, code: 'TASK_SELF_DEPENDENCY', message: 'Task cannot depend on itself', retryable: false };
    const record: TaskRecord = Object.freeze({ ...task, id, deps: Object.freeze([...new Set(task.deps)]), priority: clamp(integer(task.priority), -1000, 1000), costMs: clamp(task.costMs, 0, 1000), state: 'idle', attempts: 0, queuedAt: 0, completedAt: null, error: null });
    this.#tasks.set(id, record); return { ok: true, value: id };
  }

  enqueue(id: TaskId, queuedAt = ++this.#serial): boolean {
    const task = this.#tasks.get(id); if (!task || task.state !== 'idle') return false;
    this.#tasks.set(id, Object.freeze({ ...task, state: 'queued', queuedAt })); return true;
  }

  cancel(id: TaskId): boolean {
    const task = this.#tasks.get(id); if (!task || ['completed', 'failed', 'cancelled'].includes(task.state)) return false;
    this.#tasks.set(id, Object.freeze({ ...task, state: 'cancelled', completedAt: this.#serial })); return true;
  }

  async run(maxTasks = 64): Promise<TaskGraphReport> {
    if (this.#disposed) return Object.freeze({ completed: [], failed: [], cancelled: [], blocked: [], cycles: [] });
    const completed: TaskId[] = []; const failed: TaskId[] = []; const cancelled: TaskId[] = []; const blocked: TaskId[] = [];
    for (let count = 0; count < clamp(integer(maxTasks), 1, 1024); count += 1) {
      const ready = stableSort([...this.#tasks.values()].filter((task) => task.state === 'queued' && task.deps.every((dep) => this.#tasks.get(dep)?.state === 'completed')), (a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt || String(a.id).localeCompare(String(b.id)));
      const candidate = ready[0]; if (!candidate) break;
      const running = Object.freeze({ ...candidate, state: 'running' as const, attempts: candidate.attempts + 1 }); this.#tasks.set(candidate.id, running);
      try { await candidate.run(); this.#tasks.set(candidate.id, Object.freeze({ ...running, state: 'completed' as const, completedAt: ++this.#serial })); completed.push(candidate.id); }
      catch (error) { this.#tasks.set(candidate.id, Object.freeze({ ...running, state: 'failed' as const, completedAt: ++this.#serial, error: error instanceof Error ? error.message : String(error) })); failed.push(candidate.id); }
    }
    for (const task of this.#tasks.values()) {
      if (task.state === 'queued' && task.deps.some((dep) => ['failed', 'cancelled'].includes(this.#tasks.get(dep)?.state ?? 'failed'))) blocked.push(task.id);
      if (task.state === 'cancelled') cancelled.push(task.id);
    }
    const cycles = this.#findCycles();
    for (const id of cycles) if (this.#tasks.get(id)?.state === 'queued') blocked.push(id);
    return Object.freeze({ completed: Object.freeze(completed), failed: Object.freeze(failed), cancelled: Object.freeze(cancelled), blocked: Object.freeze([...new Set(blocked)]), cycles: Object.freeze(cycles) });
  }

  records(): readonly TaskRecord[] { return Object.freeze(stableSort([...this.#tasks.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): Readonly<Record<TaskState, number>> {
    const result: Record<TaskState, number> = { idle: 0, queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const task of this.#tasks.values()) result[task.state] += 1; return Object.freeze(result);
  }
  dispose(): void { this.#disposed = true; this.#tasks.clear(); }

  #findCycles(): readonly TaskId[] {
    const visiting = new Set<TaskId>(); const visited = new Set<TaskId>(); const cycles = new Set<TaskId>();
    const visit = (id: TaskId): void => {
      if (visiting.has(id)) { cycles.add(id); return; } if (visited.has(id)) return;
      visiting.add(id); const task = this.#tasks.get(id);
      for (const dep of task?.deps ?? []) if (this.#tasks.has(dep)) visit(dep);
      visiting.delete(id); visited.add(id);
    };
    for (const id of this.#tasks.keys()) visit(id); return [...cycles].sort((a, b) => String(a).localeCompare(String(b)));
  }
}

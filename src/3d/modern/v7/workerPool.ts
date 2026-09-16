import { clamp, integer, stableSort, type Disposable, type TaskId, asTaskId, type V7Result } from './primitives.js';

export type WorkPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export interface WorkItem<T = unknown> { readonly id: TaskId; readonly priority: WorkPriority; readonly costMs: number; readonly deadlineTick: number | null; readonly run: () => T | Promise<T>; }
export interface WorkResult<T = unknown> { readonly id: TaskId; readonly ok: boolean; readonly value?: T; readonly error?: string; readonly startedTick: number; readonly finishedTick: number; readonly attempts: number; }
export interface WorkerPoolStats { readonly capacity: number; readonly queued: number; readonly running: number; readonly completed: number; readonly failed: number; readonly cancelled: number; readonly rejected: number; }

const priorityScore: Record<WorkPriority, number> = { critical: 500, high: 300, normal: 200, low: 100, background: 0 };

export class BoundedWorkerPool implements Disposable {
  readonly capacity: number; readonly maxQueue: number; #queue: WorkItem[] = []; #running = new Set<TaskId>(); #results: WorkResult[] = []; #cancelled = new Set<TaskId>(); #completed = 0; #failed = 0; #rejected = 0; #tick = 0; #disposed = false;
  constructor(capacity = 4, maxQueue = 256) { this.capacity = clamp(integer(capacity), 1, 32); this.maxQueue = clamp(integer(maxQueue), 16, 4096); }
  enqueue<T>(work: Omit<WorkItem<T>, 'id'> & { id: string }): V7Result<TaskId> {
    if (this.#disposed) return { ok: false, code: 'WORKERS_DISPOSED', message: 'Worker pool is disposed', retryable: false };
    const id = asTaskId(work.id); if (!id || this.#queue.some((item) => item.id === id) || this.#running.has(id)) return { ok: false, code: 'WORK_DUPLICATE', message: 'Work id is invalid or already active', retryable: false };
    if (this.#queue.length >= this.maxQueue) { this.#rejected += 1; return { ok: false, code: 'WORK_QUEUE_FULL', message: 'Worker queue is full', retryable: true }; }
    this.#queue.push(Object.freeze({ ...work, id, costMs: clamp(work.costMs, 0, 1000) })); this.#resort(); return { ok: true, value: id };
  }
  cancel(id: TaskId): boolean { if (this.#disposed) return false; const before = this.#queue.length; this.#queue = this.#queue.filter((item) => item.id !== id); if (before !== this.#queue.length) { this.#cancelled.add(id); return true; } if (this.#running.has(id)) { this.#cancelled.add(id); return true; } return false; }
  async pump(tick: number, maxDispatch = this.capacity): Promise<readonly WorkResult[]> {
    if (this.#disposed) return []; this.#tick = Math.max(this.#tick, integer(tick)); const dispatch = clamp(integer(maxDispatch), 1, this.capacity);
    const started: Array<Promise<void>> = [];
    while (this.#running.size < dispatch && this.#queue.length) {
      const work = this.#queue.shift()!; if (this.#cancelled.has(work.id)) continue; if (work.deadlineTick !== null && this.#tick > work.deadlineTick) { this.#failed += 1; this.#results.push(Object.freeze({ id: work.id, ok: false, error: 'deadline-expired', startedTick: this.#tick, finishedTick: this.#tick, attempts: 0 })); continue; }
      this.#running.add(work.id); started.push(this.#execute(work));
    }
    await Promise.all(started); return Object.freeze([...this.#results]);
  }
  results(): readonly WorkResult[] { return Object.freeze(stableSort([...this.#results], (a, b) => a.finishedTick - b.finishedTick || String(a.id).localeCompare(String(b.id)))); }
  stats(): WorkerPoolStats { return Object.freeze({ capacity: this.capacity, queued: this.#queue.length, running: this.#running.size, completed: this.#completed, failed: this.#failed, cancelled: this.#cancelled.size, rejected: this.#rejected }); }
  resetResults(): void { this.#results.length = 0; }
  dispose(): void { this.#disposed = true; this.#queue.length = 0; this.#running.clear(); this.#cancelled.clear(); this.#results.length = 0; }
  async #execute(work: WorkItem): Promise<void> { const startedTick = this.#tick; let attempts = 0; try { attempts = 1; const value = await work.run(); const finishedTick = this.#tick; if (this.#cancelled.has(work.id)) { this.#results.push(Object.freeze({ id: work.id, ok: false, error: 'cancelled', startedTick, finishedTick, attempts })); return; } this.#completed += 1; this.#results.push(Object.freeze({ id: work.id, ok: true, value, startedTick, finishedTick, attempts })); } catch (error) { this.#failed += 1; this.#results.push(Object.freeze({ id: work.id, ok: false, error: error instanceof Error ? error.message : String(error), startedTick, finishedTick: this.#tick, attempts })); } finally { this.#running.delete(work.id); } }
  #resort(): void { this.#queue = [...stableSort(this.#queue, (a, b) => priorityScore[b.priority] - priorityScore[a.priority] || Number(a.deadlineTick ?? Number.MAX_SAFE_INTEGER) - Number(b.deadlineTick ?? Number.MAX_SAFE_INTEGER) || a.costMs - b.costMs || String(a.id).localeCompare(String(b.id)))]; }
}

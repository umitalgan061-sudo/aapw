export type WorkerStateV5 = 'idle' | 'busy' | 'failed' | 'stopped';
export interface WorkerTaskV5<T = unknown> { readonly id: string; readonly priority: number; readonly payload: T; readonly timeoutMs: number; readonly run: (payload: T, signal: AbortSignal) => Promise<unknown> | unknown; }
export interface WorkerLeaseV5 { readonly workerId: string; readonly taskId: string; readonly startedAt: number; readonly deadline: number; }
export interface WorkerSnapshotV5 { readonly id: string; readonly state: WorkerStateV5; readonly tasks: number; readonly failures: number; readonly lastDurationMs: number; }
export interface WorkerPoolOptionsV5 { readonly size?: number; readonly maxQueue?: number; readonly now?: () => number; readonly taskTimeoutMs?: number; }

interface WorkerRecordV5 { readonly id: string; state: WorkerStateV5; tasks: number; failures: number; lastDurationMs: number; controller: AbortController | null; }

export class WorkerPoolV5 {
  readonly size: number; readonly maxQueue: number; readonly taskTimeoutMs: number;
  #now: () => number; #workers: WorkerRecordV5[] = []; #queue: WorkerTaskV5[] = []; #leases = new Map<string, WorkerLeaseV5>(); #waiters: Array<() => void> = [];
  constructor(options: WorkerPoolOptionsV5 = {}) { this.size = Math.max(1, Math.min(64, Math.floor(options.size ?? 4))); this.maxQueue = Math.max(8, Math.min(10_000, Math.floor(options.maxQueue ?? 1024))); this.taskTimeoutMs = Math.max(10, Math.min(120_000, Math.floor(options.taskTimeoutMs ?? 5000))); this.#now = options.now ?? (() => Date.now()); for (let i = 0; i < this.size; i += 1) this.#workers.push({ id: `worker-${i + 1}`, state: 'idle', tasks: 0, failures: 0, lastDurationMs: 0, controller: null }); }
  enqueue<T>(task: WorkerTaskV5<T>): boolean { if (this.#queue.length >= this.maxQueue) return false; this.#queue.push(Object.freeze({ ...task, priority: Math.floor(task.priority), timeoutMs: Math.max(1, Math.min(120_000, task.timeoutMs || this.taskTimeoutMs)) })); this.#queue.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)); this.#drain(); return true; }
  async run<T>(task: WorkerTaskV5<T>): Promise<unknown> { return new Promise((resolve, reject) => { const queued: WorkerTaskV5<T> = Object.freeze({ ...task, run: async (payload, signal) => { try { const result = await task.run(payload, signal); resolve(result); return result; } catch (error) { reject(error); throw error; } } }); if (!this.enqueue(queued)) reject(new Error('worker queue full')); }); }
  cancel(taskId: string): boolean { const before = this.#queue.length; this.#queue = this.#queue.filter((task) => task.id !== taskId); for (const [workerId, lease] of this.#leases) { if (lease.taskId === taskId) { this.#workers.find((worker) => worker.id === workerId)?.controller?.abort(); return true; } } return before !== this.#queue.length; }
  stop(): void { for (const worker of this.#workers) { worker.controller?.abort(); worker.controller = null; worker.state = 'stopped'; } this.#queue.length = 0; this.#leases.clear(); }
  restart(): void { for (const worker of this.#workers) { worker.controller = null; worker.state = 'idle'; } this.#drain(); }
  workers(): readonly WorkerSnapshotV5[] { return Object.freeze(this.#workers.map((worker) => Object.freeze({ id: worker.id, state: worker.state, tasks: worker.tasks, failures: worker.failures, lastDurationMs: worker.lastDurationMs }))); }
  queued(): number { return this.#queue.length; }
  active(): number { return this.#leases.size; }
  #drain(): void { for (const worker of this.#workers) { if (worker.state !== 'idle' || !this.#queue.length) continue; const task = this.#queue.shift()!; void this.#execute(worker, task); } }
  async #execute(worker: WorkerRecordV5, task: WorkerTaskV5): Promise<void> { worker.state = 'busy'; worker.tasks += 1; const controller = new AbortController(); worker.controller = controller; const startedAt = this.#now(); this.#leases.set(worker.id, Object.freeze({ workerId: worker.id, taskId: task.id, startedAt, deadline: startedAt + task.timeoutMs })); const timeout = setTimeout(() => controller.abort(), task.timeoutMs); try { await task.run(task.payload, controller.signal); } catch { worker.failures += 1; worker.state = 'failed'; } finally { clearTimeout(timeout); worker.lastDurationMs = Math.max(0, this.#now() - startedAt); this.#leases.delete(worker.id); worker.controller = null; if (worker.state !== 'stopped') worker.state = 'idle'; this.#notify(); this.#drain(); } }
  #notify(): void { const callbacks = this.#waiters.splice(0); for (const callback of callbacks) callback(); }
}

export function waitForWorkersV5(pool: WorkerPoolV5): Promise<void> { if (pool.active() === 0 && pool.queued() === 0) return Promise.resolve(); return new Promise((resolve) => { const interval = setInterval(() => { if (pool.active() === 0 && pool.queued() === 0) { clearInterval(interval); resolve(); } }, 5); }); }

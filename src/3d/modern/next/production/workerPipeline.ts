import { checksumP, integerP, nonNegativeP, nowP, type EventSinkP } from './contracts.ts';

export type WorkerPriorityP = 'critical' | 'near' | 'normal' | 'background';
export type WorkerTaskStateP = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkerTaskP<TInput = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly priority: WorkerPriorityP;
  readonly input: TInput;
  readonly estimatedMs: number;
  readonly deadlineTick?: number;
  readonly createdTick: number;
}

export interface WorkerTaskResultP<TOutput = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly state: Exclude<WorkerTaskStateP, 'queued' | 'running'>;
  readonly output?: TOutput;
  readonly error?: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
  readonly attempts: number;
}

export interface WorkerContextP {
  readonly task: WorkerTaskP;
  readonly signal: AbortSignal;
  readonly nowMs: number;
  readonly checkpoint: (progress: number) => void;
}

export type WorkerHandlerP<TInput = unknown, TOutput = unknown> = (input: TInput, context: WorkerContextP) => Promise<TOutput> | TOutput;

export interface WorkerPipelineConfigP {
  readonly maxConcurrent: number;
  readonly maxQueue: number;
  readonly maxResults: number;
  readonly maxAttempts: number;
  readonly maxTaskMs: number;
}

export interface WorkerPipelineStatsP {
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly peakQueue: number;
  readonly totalMs: number;
  readonly checksum: number;
}

interface InternalTask extends WorkerTaskP { sequence: number; attempts: number; state: WorkerTaskStateP; controller?: AbortController; progress: number; }
const PRIORITY_SCORE: Record<WorkerPriorityP, number> = { critical: 1000, near: 700, normal: 400, background: 100 };
const DEFAULTS: WorkerPipelineConfigP = Object.freeze({ maxConcurrent: 4, maxQueue: 512, maxResults: 512, maxAttempts: 2, maxTaskMs: 30_000 });

export class ProductionWorkerPipeline {
  readonly config: WorkerPipelineConfigP;
  readonly #handlers = new Map<string, WorkerHandlerP>();
  readonly #tasks = new Map<string, InternalTask>();
  readonly #results: WorkerTaskResultP[] = [];
  readonly #events?: EventSinkP;
  #sequence = 0;
  #running = 0;
  #peakQueue = 0;
  #totalMs = 0;

  constructor(config: Partial<WorkerPipelineConfigP> = {}, events?: EventSinkP) {
    this.config = Object.freeze({ maxConcurrent: Math.max(1, integerP(config.maxConcurrent ?? DEFAULTS.maxConcurrent)), maxQueue: Math.max(8, integerP(config.maxQueue ?? DEFAULTS.maxQueue)), maxResults: Math.max(8, integerP(config.maxResults ?? DEFAULTS.maxResults)), maxAttempts: Math.max(1, integerP(config.maxAttempts ?? DEFAULTS.maxAttempts)), maxTaskMs: Math.max(100, nonNegativeP(config.maxTaskMs ?? DEFAULTS.maxTaskMs)) });
    this.#events = events;
  }

  register<TInput, TOutput>(kind: string, handler: WorkerHandlerP<TInput, TOutput>): void {
    const normalized = normalizeKind(kind);
    if (this.#handlers.has(normalized)) throw new Error(`worker handler already registered: ${normalized}`);
    this.#handlers.set(normalized, handler as WorkerHandlerP);
  }

  replace<TInput, TOutput>(kind: string, handler: WorkerHandlerP<TInput, TOutput>): void { this.#handlers.set(normalizeKind(kind), handler as WorkerHandlerP); }
  has(kind: string): boolean { return this.#handlers.has(normalizeKind(kind)); }

  enqueue<TInput>(task: Omit<WorkerTaskP<TInput>, 'createdTick'> & { createdTick?: number }): boolean {
    const id = normalizeId(task.id);
    if (this.#tasks.has(id)) return false;
    if (!this.#handlers.has(normalizeKind(task.kind))) throw new Error(`worker handler missing: ${task.kind}`);
    if (this.queuedCount() >= this.config.maxQueue) this.#dropLowestPriority();
    if (this.queuedCount() >= this.config.maxQueue) return false;
    const record: InternalTask = { ...task, id, kind: normalizeKind(task.kind), priority: task.priority, estimatedMs: Math.min(this.config.maxTaskMs, Math.max(0, nonNegativeP(task.estimatedMs))), createdTick: Math.max(0, integerP(task.createdTick ?? 0)), sequence: ++this.#sequence, attempts: 0, state: 'queued', progress: 0 };
    this.#tasks.set(id, record); this.#peakQueue = Math.max(this.#peakQueue, this.queuedCount()); return true;
  }

  pump(now = nowP(), tick = 0): number {
    let started = 0;
    while (this.#running < this.config.maxConcurrent) {
      const task = this.#nextQueued(tick);
      if (!task) break;
      task.state = 'running'; task.attempts += 1; task.controller = new AbortController(); this.#running += 1; started += 1;
      void this.#execute(task, now);
    }
    return started;
  }

  cancel(idValue: string): boolean {
    const id = normalizeId(idValue); const task = this.#tasks.get(id); if (!task) return false;
    if (task.state === 'queued') { task.state = 'cancelled'; this.#recordResult(task, 'cancelled', undefined, 'cancelled before start', nowP(), nowP()); return true; }
    if (task.state === 'running') { task.controller?.abort('cancelled'); return true; }
    return false;
  }

  cancelKind(kind: string): number { const normalized = normalizeKind(kind); let count = 0; for (const task of this.#tasks.values()) if (task.kind === normalized && (task.state === 'queued' || task.state === 'running')) if (this.cancel(task.id)) count += 1; return count; }

  queuedCount(): number { return [...this.#tasks.values()].filter(task => task.state === 'queued').length; }
  runningCount(): number { return this.#running; }
  result(idValue: string): WorkerTaskResultP | undefined { return this.#results.find(result => result.id === normalizeId(idValue)); }
  drainResults(max = 64): readonly WorkerTaskResultP[] { return Object.freeze(this.#results.splice(0, Math.max(0, Math.min(this.#results.length, integerP(max, 64))))); }

  progress(idValue: string): number { return this.#tasks.get(normalizeId(idValue))?.progress ?? 0; }
  stats(): WorkerPipelineStatsP { const completed = this.#results.filter(result => result.state === 'completed').length; const failed = this.#results.filter(result => result.state === 'failed').length; const cancelled = this.#results.filter(result => result.state === 'cancelled').length; return Object.freeze({ queued: this.queuedCount(), running: this.#running, completed, failed, cancelled, peakQueue: this.#peakQueue, totalMs: this.#totalMs, checksum: checksumP({ tasks: [...this.#tasks.values()].map(task => ({ id: task.id, kind: task.kind, state: task.state, attempts: task.attempts, progress: task.progress })), results: this.#results.map(result => ({ id: result.id, state: result.state, durationMs: result.durationMs })) }) }); }
  digest(): number { return this.stats().checksum; }

  dispose(): void { for (const task of this.#tasks.values()) task.controller?.abort('disposed'); this.#tasks.clear(); this.#results.length = 0; this.#running = 0; }

  async #execute(task: InternalTask, startedAtMs: number): Promise<void> {
    const handler = this.#handlers.get(task.kind)!; const started = nowP();
    const context: WorkerContextP = Object.freeze({ task: freezeTask(task), signal: task.controller!, nowMs: started, checkpoint: progress => { task.progress = Math.max(0, Math.min(1, finite(progress))); } });
    try {
      const output = await withTimeout(Promise.resolve(handler(task.input, context)), this.config.maxTaskMs, task.controller!.signal);
      if (task.controller?.signal.aborted || task.state === 'cancelled') { task.state = 'cancelled'; this.#recordResult(task, 'cancelled', undefined, 'cancelled', started, nowP()); return; }
      task.state = 'completed'; task.progress = 1; this.#recordResult(task, 'completed', output, undefined, started, nowP());
    } catch (error) {
      if (task.controller?.signal.aborted || task.state === 'cancelled') { task.state = 'cancelled'; this.#recordResult(task, 'cancelled', undefined, normalizeError(error), started, nowP()); }
      else if (task.attempts < this.config.maxAttempts) { task.state = 'queued'; task.progress = 0; this.#running = Math.max(0, this.#running - 1); this.#peakQueue = Math.max(this.#peakQueue, this.queuedCount()); return; }
      else { task.state = 'failed'; this.#recordResult(task, 'failed', undefined, normalizeError(error), started, nowP()); }
    } finally {
      if (task.state !== 'queued') this.#running = Math.max(0, this.#running - 1);
      task.controller = undefined;
    }
    void startedAtMs;
  }

  #nextQueued(tick: number): InternalTask | undefined { return [...this.#tasks.values()].filter(task => task.state === 'queued' && (task.deadlineTick === undefined || task.deadlineTick >= tick)).sort((a, b) => PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority] || a.createdTick - b.createdTick || a.sequence - b.sequence)[0]; }
  #dropLowestPriority(): void { const candidate = [...this.#tasks.values()].filter(task => task.state === 'queued').sort((a, b) => PRIORITY_SCORE[a.priority] - PRIORITY_SCORE[b.priority] || b.estimatedMs - a.estimatedMs || b.sequence - a.sequence)[0]; if (candidate) { candidate.state = 'cancelled'; this.#recordResult(candidate, 'cancelled', undefined, 'queue budget exceeded', nowP(), nowP()); } }
  #recordResult(task: InternalTask, state: 'completed' | 'failed' | 'cancelled', output: unknown, error: string | undefined, startedAtMs: number, endedAtMs: number): void { const durationMs = Math.max(0, endedAtMs - startedAtMs); this.#totalMs += durationMs; const result = Object.freeze({ id: task.id, kind: task.kind, state, ...(output !== undefined ? { output } : {}), ...(error ? { error: error.slice(0, 200) } : {}), startedAtMs, endedAtMs, durationMs, attempts: task.attempts }); this.#results.push(result); while (this.#results.length > this.config.maxResults) this.#results.shift(); this.#events?.emit('telemetry:health', Object.freeze({ state: state === 'failed' ? 'degraded' : 'healthy', score: state === 'failed' ? 85 : 100, frameMs: durationMs, memoryMb: 0, networkRttMs: 0, assetQueue: 0, workerQueue: this.queuedCount(), recommendations: state === 'failed' ? Object.freeze(['inspect worker failure and defer non-critical work']) : Object.freeze([]) })); }
}

function normalizeId(value: string): string { const id = String(value).trim().slice(0, 96); if (!/^[a-zA-Z0-9:_-]+$/.test(id)) throw new Error(`invalid worker task id: ${id}`); return id; }
function normalizeKind(value: string): string { const kind = String(value).trim().slice(0, 80); if (!/^[a-zA-Z0-9._:-]+$/.test(kind)) throw new Error(`invalid worker task kind: ${kind}`); return kind; }
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function normalizeError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function freezeTask(task: InternalTask): WorkerTaskP { return Object.freeze({ id: task.id, kind: task.kind, priority: task.priority, input: task.input, estimatedMs: task.estimatedMs, ...(task.deadlineTick !== undefined ? { deadlineTick: task.deadlineTick } : {}), createdTick: task.createdTick }); }
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('worker task timeout')), timeoutMs); }); try { if (signal.aborted) throw new Error('worker task aborted'); return await Promise.race([promise, timeout]); } finally { if (timer) clearTimeout(timer); } }

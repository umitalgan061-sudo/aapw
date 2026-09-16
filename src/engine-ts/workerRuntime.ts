import type { Disposable, Result } from './coreTypes.ts';
import { err, ok } from './coreTypes.ts';

export type WorkerJobKind = 'visibility' | 'lod' | 'path' | 'navigation' | 'asset-priority' | 'serialization' | 'generic';
export type WorkerJobPriority = 0 | 1 | 2 | 3 | 4;
export type WorkerJobState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface WorkerJobPayload {
  readonly jobId: string;
  readonly kind: WorkerJobKind;
  readonly priority: WorkerJobPriority;
  readonly submittedAtTick: number;
  readonly seed: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface WorkerJobResult {
  readonly jobId: string;
  readonly kind: WorkerJobKind;
  readonly state: Exclude<WorkerJobState, 'queued' | 'running'>;
  readonly startedAtTick: number;
  readonly completedAtTick: number;
  readonly durationMs: number;
  readonly output: unknown;
  readonly error?: string;
}

export interface WorkerBudget {
  readonly maxJobsPerFrame: number;
  readonly maxMillisecondsPerFrame: number;
  readonly maxQueueLength: number;
}

export interface WorkerRuntimeClock {
  readonly nowTick: number;
  readonly nowMs: number;
}

const clampInt = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

const hashSeed = (text: string): number => {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

export const deterministicJobSeed = (jobId: string, baseSeed: string | number): number => hashSeed(`${String(baseSeed)}::${jobId}`);

export interface WorkerJobHandler<TPayload = unknown, TResult = unknown> {
  readonly kind: WorkerJobKind;
  execute(payload: TPayload, context: { readonly tick: number; readonly seed: number }): TResult | Promise<TResult>;
}

interface QueueEntry {
  readonly sequence: number;
  readonly payload: WorkerJobPayload;
  state: WorkerJobState;
  cancelRequested: boolean;
}

export class DeterministicWorkerQueue implements Disposable {
  private readonly handlers = new Map<WorkerJobKind, WorkerJobHandler>();
  private readonly queue: QueueEntry[] = [];
  private readonly results = new Map<string, WorkerJobResult>();
  private sequence = 0;
  private disposed = false;
  private readonly baseSeed: string | number;
  private readonly budget: WorkerBudget;

  constructor(baseSeed: string | number = 'aapw-worker-r1', budget: Partial<WorkerBudget> = {}) {
    this.baseSeed = baseSeed;
    this.budget = Object.freeze({
      maxJobsPerFrame: clampInt(budget.maxJobsPerFrame ?? 8, 1, 64),
      maxMillisecondsPerFrame: Math.max(0.5, finite(budget.maxMillisecondsPerFrame, 3)),
      maxQueueLength: clampInt(budget.maxQueueLength ?? 2048, 16, 8192),
    });
  }

  registerHandler<TPayload, TResult>(handler: WorkerJobHandler<TPayload, TResult>): void {
    this.ensureLive();
    this.handlers.set(handler.kind, handler as WorkerJobHandler);
  }

  unregisterHandler(kind: WorkerJobKind): void {
    this.ensureLive();
    this.handlers.delete(kind);
  }

  enqueue(payload: Omit<WorkerJobPayload, 'seed'> & Partial<Pick<WorkerJobPayload, 'seed'>>): Result<string, string> {
    this.ensureLive();
    if (this.queue.length >= this.budget.maxQueueLength) return err('worker queue capacity reached');
    if (!payload.jobId || this.results.has(payload.jobId) || this.queue.some(entry => entry.payload.jobId === payload.jobId)) return err('duplicate worker job id');
    if (!this.handlers.has(payload.kind)) return err(`no worker handler registered for ${payload.kind}`);
    const seed = payload.seed ?? deterministicJobSeed(payload.jobId, this.baseSeed);
    this.queue.push({ sequence: this.sequence++, payload: Object.freeze({ ...payload, seed }), state: 'queued', cancelRequested: false });
    this.queue.sort((left, right) => right.payload.priority - left.payload.priority || left.sequence - right.sequence || left.payload.jobId.localeCompare(right.payload.jobId));
    return ok(payload.jobId);
  }

  cancel(jobId: string): boolean {
    this.ensureLive();
    const entry = this.queue.find(candidate => candidate.payload.jobId === jobId);
    if (!entry || entry.state !== 'queued') return false;
    entry.cancelRequested = true;
    entry.state = 'cancelled';
    this.results.set(jobId, Object.freeze({ jobId, kind: entry.payload.kind, state: 'cancelled', startedAtTick: 0, completedAtTick: 0, durationMs: 0, output: null }));
    return true;
  }

  async runFrame(clock: WorkerRuntimeClock): Promise<readonly WorkerJobResult[]> {
    this.ensureLive();
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const completed: WorkerJobResult[] = [];
    let processed = 0;
    while (this.queue.length > 0 && processed < this.budget.maxJobsPerFrame) {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      if (elapsed >= this.budget.maxMillisecondsPerFrame) break;
      const entryIndex = this.queue.findIndex(entry => entry.state === 'queued');
      if (entryIndex < 0) break;
      const [entry] = this.queue.splice(entryIndex, 1);
      if (!entry || entry.cancelRequested) continue;
      const handler = this.handlers.get(entry.payload.kind);
      if (!handler) {
        const failed = this.fail(entry, clock.nowTick, 0, 'worker handler disappeared before execution');
        completed.push(failed);
        continue;
      }
      entry.state = 'running';
      const jobStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        const output = await handler.execute(entry.payload.data, { tick: clock.nowTick, seed: entry.payload.seed });
        const durationMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - jobStart);
        entry.state = 'completed';
        const result = Object.freeze({ jobId: entry.payload.jobId, kind: entry.payload.kind, state: 'completed' as const, startedAtTick: clock.nowTick, completedAtTick: clock.nowTick, durationMs, output });
        this.results.set(entry.payload.jobId, result);
        completed.push(result);
      } catch (cause) {
        const durationMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - jobStart);
        const failed = this.fail(entry, clock.nowTick, durationMs, cause instanceof Error ? cause.message : 'worker job failed');
        completed.push(failed);
      }
      processed += 1;
    }
    return Object.freeze(completed);
  }

  result(jobId: string): WorkerJobResult | null { return this.results.get(jobId) ?? null; }
  queuedCount(): number { return this.queue.filter(entry => entry.state === 'queued').length; }
  resultCount(): number { return this.results.size; }
  budgetSnapshot(): WorkerBudget { return this.budget; }

  reset(): void {
    this.ensureLive();
    this.queue.length = 0;
    this.results.clear();
    this.sequence = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    this.results.clear();
    this.handlers.clear();
  }

  private fail(entry: QueueEntry, tick: number, durationMs: number, message: string): WorkerJobResult {
    entry.state = 'failed';
    const result = Object.freeze({ jobId: entry.payload.jobId, kind: entry.payload.kind, state: 'failed' as const, startedAtTick: tick, completedAtTick: tick, durationMs: Math.max(0, durationMs), output: null, error: message });
    this.results.set(entry.payload.jobId, result);
    return result;
  }

  private ensureLive(): void { if (this.disposed) throw new Error('worker queue disposed'); }
}

export type WorkerMessage =
  | { readonly type: 'hello'; readonly protocol: 1; readonly runtime: string }
  | { readonly type: 'enqueue'; readonly payload: WorkerJobPayload }
  | { readonly type: 'cancel'; readonly jobId: string }
  | { readonly type: 'tick'; readonly tick: number; readonly nowMs: number }
  | { readonly type: 'result'; readonly result: WorkerJobResult }
  | { readonly type: 'error'; readonly message: string; readonly jobId?: string };

export const isWorkerMessage = (value: unknown): value is WorkerMessage => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== 'string') return false;
  if (candidate.type === 'hello') return candidate.protocol === 1 && typeof candidate.runtime === 'string';
  if (candidate.type === 'enqueue') {
    const payload = candidate.payload;
    if (!payload || typeof payload !== 'object') return false;
    const entry = payload as Record<string, unknown>;
    return typeof entry.jobId === 'string' && typeof entry.kind === 'string' && typeof entry.priority === 'number' && typeof entry.seed === 'number' && typeof entry.submittedAtTick === 'number';
  }
  if (candidate.type === 'cancel') return typeof candidate.jobId === 'string';
  if (candidate.type === 'tick') return typeof candidate.tick === 'number' && typeof candidate.nowMs === 'number';
  if (candidate.type === 'result') return !!candidate.result && typeof candidate.result === 'object';
  if (candidate.type === 'error') return typeof candidate.message === 'string';
  return false;
};

export class WorkerRuntimeHost implements Disposable {
  readonly queue: DeterministicWorkerQueue;
  private disposed = false;
  private readonly post: (message: WorkerMessage) => void;
  private readonly runtimeName: string;

  constructor(post: (message: WorkerMessage) => void, options: { readonly seed?: string | number; readonly runtimeName?: string; readonly budget?: Partial<WorkerBudget> } = {}) {
    this.post = post;
    this.runtimeName = options.runtimeName ?? 'aapw-worker-r1';
    this.queue = new DeterministicWorkerQueue(options.seed ?? 'aapw-worker-r1', options.budget);
    this.post({ type: 'hello', protocol: 1, runtime: this.runtimeName });
  }

  registerHandler<TPayload, TResult>(handler: WorkerJobHandler<TPayload, TResult>): void { this.ensureLive(); this.queue.registerHandler(handler); }
  async handle(message: unknown): Promise<void> {
    this.ensureLive();
    if (!isWorkerMessage(message)) { this.post({ type: 'error', message: 'invalid worker message' }); return; }
    if (message.type === 'enqueue') {
      const result = this.queue.enqueue(message.payload);
      if (!result.ok) this.post({ type: 'error', jobId: message.payload.jobId, message: result.error });
      return;
    }
    if (message.type === 'cancel') { this.queue.cancel(message.jobId); return; }
    if (message.type === 'tick') {
      const results = await this.queue.runFrame({ nowTick: message.tick, nowMs: message.nowMs });
      for (const result of results) this.post({ type: 'result', result });
    }
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.queue.dispose(); }
  private ensureLive(): void { if (this.disposed) throw new Error('worker host disposed'); }
}

export interface VisibilityJobInput { readonly objects: readonly { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly radius: number; readonly importance?: number }[]; readonly camera: { readonly x: number; readonly y: number; readonly z: number }; readonly maxDistance: number; }

export interface VisibilityJobOutput { readonly visibleIds: readonly string[]; readonly rejectedIds: readonly string[]; }

export const runDeterministicVisibilityJob = (input: VisibilityJobInput): VisibilityJobOutput => {
  const limit = Math.max(1, input.maxDistance);
  const limitSquared = limit * limit;
  const ranked = input.objects.map(object => {
    const dx = finite(object.x) - finite(input.camera.x);
    const dy = finite(object.y) - finite(input.camera.y);
    const dz = finite(object.z) - finite(input.camera.z);
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    const distance = Math.sqrt(distanceSquared);
    const importance = finite(object.importance, 0);
    return { object, distanceSquared, distance, score: importance / Math.max(1, distance) };
  });
  ranked.sort((left, right) => right.score - left.score || left.distanceSquared - right.distanceSquared || left.object.id.localeCompare(right.object.id));
  const visibleIds: string[] = [];
  const rejectedIds: string[] = [];
  for (const item of ranked) (item.distanceSquared <= limitSquared + item.object.radius * item.object.radius ? visibleIds : rejectedIds).push(item.object.id);
  return Object.freeze({ visibleIds: Object.freeze(visibleIds), rejectedIds: Object.freeze(rejectedIds) });
};

export interface LodJobInput { readonly objects: readonly { readonly id: string; readonly screenRadius: number; readonly importance?: number }[]; readonly thresholds: readonly number[]; }
export interface LodJobOutput { readonly levels: Readonly<Record<string, number>>; }

export const runDeterministicLodJob = (input: LodJobInput): LodJobOutput => {
  const thresholds = [...input.thresholds].map(value => Math.max(0, finite(value))).sort((a, b) => b - a);
  const levels: Record<string, number> = {};
  const sorted = [...input.objects].sort((a, b) => finite(b.importance, 0) - finite(a.importance, 0) || a.id.localeCompare(b.id));
  for (const object of sorted) {
    const radius = Math.max(0, finite(object.screenRadius));
    let level = thresholds.length;
    for (let index = 0; index < thresholds.length; index += 1) if (radius >= (thresholds[index] ?? 0)) { level = index; break; }
    levels[object.id] = level;
  }
  return Object.freeze({ levels: Object.freeze(levels) });
};

export const createDefaultWorkerHandlers = (): readonly WorkerJobHandler[] => Object.freeze([
  { kind: 'visibility', execute: payload => runDeterministicVisibilityJob(payload as VisibilityJobInput) },
  { kind: 'lod', execute: payload => runDeterministicLodJob(payload as LodJobInput) },
  { kind: 'serialization', execute: payload => JSON.stringify(payload) },
]);

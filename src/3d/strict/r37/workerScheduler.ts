export interface WorkerTask<T> {
  readonly id: string;
  readonly priority: number;
  readonly run: () => Promise<T> | T;
}

export interface WorkerSchedulerConfig {
  readonly concurrency: number;
  readonly historyCapacity: number;
}

export interface WorkerTaskResult<T> {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string;
  readonly durationMs: number;
}

const DEFAULT_CONFIG: WorkerSchedulerConfig = Object.freeze({ concurrency: 4, historyCapacity: 128 });

export class WorkerSchedulerR37 {
  readonly config: WorkerSchedulerConfig;
  #queue: WorkerTask<unknown>[] = [];
  #running = 0;
  #cancelled = false;
  #history: WorkerTaskResult<unknown>[] = [];

  constructor(config: Partial<WorkerSchedulerConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      concurrency: Math.max(1, Math.trunc(Number(config.concurrency ?? DEFAULT_CONFIG.concurrency))),
      historyCapacity: Math.max(8, Math.trunc(Number(config.historyCapacity ?? DEFAULT_CONFIG.historyCapacity))),
    });
  }

  enqueue<T>(task: WorkerTask<T>): boolean {
    if (this.#cancelled || !task.id || this.#queue.length >= this.config.historyCapacity) return false;
    this.#queue.push(task as WorkerTask<unknown>);
    this.#queue.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return true;
  }

  async drain(): Promise<readonly WorkerTaskResult<unknown>[]> {
    await Promise.all(Array.from({ length: this.config.concurrency }, () => this.#worker()));
    return Object.freeze([...this.#history]);
  }

  cancel(): void {
    this.#cancelled = true;
    this.#queue = [];
  }

  pending(): readonly WorkerTask<unknown>[] { return Object.freeze([...this.#queue]); }
  activeCount(): number { return this.#running; }
  history(): readonly WorkerTaskResult<unknown>[] { return Object.freeze([...this.#history]); }

  reset(): void {
    this.#cancelled = false;
    this.#queue = [];
    this.#running = 0;
    this.#history = [];
  }

  async #worker(): Promise<void> {
    while (!this.#cancelled) {
      const task = this.#queue.shift();
      if (!task) return;
      this.#running += 1;
      const started = nowMs();
      try {
        const value = await task.run();
        this.#record(Object.freeze({ id: task.id, ok: true, value, durationMs: Math.max(0, nowMs() - started) }));
      } catch (error) {
        this.#record(Object.freeze({
          id: task.id,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
          durationMs: Math.max(0, nowMs() - started),
        }));
      } finally {
        this.#running -= 1;
      }
    }
  }

  #record(result: WorkerTaskResult<unknown>): void {
    this.#history.push(result);
    if (this.#history.length > this.config.historyCapacity) {
      this.#history.splice(0, this.#history.length - this.config.historyCapacity);
    }
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

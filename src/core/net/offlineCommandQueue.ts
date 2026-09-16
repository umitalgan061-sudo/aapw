import { deterministicDigest } from '../runtime/deterministicClock.ts';
import { freeze, type Result, err, ok } from '../domain/contracts.ts';

export interface OfflineCommand<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: T;
  readonly createdAt: number;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly idempotencyKey: string;
}

export interface QueuePolicy {
  readonly capacity: number;
  readonly maxAttempts: number;
  readonly maxPayloadBytes: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

export interface QueueMetrics {
  readonly queued: number;
  readonly pending: number;
  readonly deadLetter: number;
  readonly enqueued: number;
  readonly acknowledged: number;
  readonly retried: number;
  readonly dropped: number;
}

export class OfflineCommandQueue<T = unknown> {
  readonly #policy: QueuePolicy;
  readonly #items: OfflineCommand<T>[] = [];
  readonly #dead = new OfflineCommandStore<T>();
  #sequence = 0;
  #enqueued = 0;
  #acknowledged = 0;
  #retried = 0;
  #dropped = 0;

  constructor(policy: Partial<QueuePolicy> = {}) {
    this.#policy = freeze({
      capacity: Math.max(16, Math.floor(policy.capacity ?? 2048)),
      maxAttempts: Math.max(1, Math.floor(policy.maxAttempts ?? 6)),
      maxPayloadBytes: Math.max(1024, Math.floor(policy.maxPayloadBytes ?? 256 * 1024)),
      retryBaseMs: Math.max(50, Math.floor(policy.retryBaseMs ?? 400)),
      retryMaxMs: Math.max(500, Math.floor(policy.retryMaxMs ?? 30_000)),
    });
  }

  enqueue(type: string, payload: T, now = Date.now(), idempotencyKey = ''): Result<OfflineCommand<T>> {
    const encoded = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(encoded).byteLength;
    if (bytes > this.#policy.maxPayloadBytes) return err({ code: 'QUEUE_PAYLOAD_TOO_LARGE', message: `Payload exceeds ${this.#policy.maxPayloadBytes} bytes.` });
    if (this.#items.length >= this.#policy.capacity) {
      const dropped = this.#evictLowestPriority();
      if (!dropped) { this.#dropped += 1; return err({ code: 'QUEUE_FULL', message: 'Offline command queue is full.' }); }
    }
    const cleanType = type.trim().slice(0, 96);
    if (!cleanType) return err({ code: 'QUEUE_TYPE_MISSING', message: 'Command type is required.' });
    const key = idempotencyKey.trim().slice(0, 160) || deterministicDigest({ cleanType, payload });
    if (this.#items.some((item) => item.idempotencyKey === key) || this.#dead.has(key)) return err({ code: 'QUEUE_DUPLICATE', message: `Idempotency key ${key} already exists.` });
    const item = freeze({ id: `cmd_${(++this.#sequence).toString(36)}`, type: cleanType, payload, createdAt: now, attempts: 0, nextAttemptAt: now, idempotencyKey: key });
    this.#items.push(item);
    this.#enqueued += 1;
    return ok(item);
  }

  due(now = Date.now(), limit = 16): readonly OfflineCommand<T>[] {
    return this.#items.filter((item) => item.nextAttemptAt <= now).slice(0, Math.max(1, Math.floor(limit)));
  }

  markAttempt(id: string, success: boolean, now = Date.now()): Result<OfflineCommand<T>> {
    const index = this.#items.findIndex((item) => item.id === id);
    if (index < 0) return err({ code: 'QUEUE_UNKNOWN_COMMAND', message: `Unknown command ${id}.` });
    const current = this.#items[index];
    if (!current) return err({ code: 'QUEUE_UNKNOWN_COMMAND', message: `Unknown command ${id}.` });
    if (success) {
      this.#items.splice(index, 1);
      this.#acknowledged += 1;
      return ok(current);
    }
    const attempts = current.attempts + 1;
    if (attempts >= this.#policy.maxAttempts) {
      this.#items.splice(index, 1);
      this.#dead.add({ ...current, attempts, nextAttemptAt: Number.POSITIVE_INFINITY });
      return err({ code: 'QUEUE_DEAD_LETTER', message: `Command ${id} exceeded retry limit.` });
    }
    const delay = Math.min(this.#policy.retryMaxMs, this.#policy.retryBaseMs * 2 ** Math.min(8, attempts - 1));
    const next = freeze({ ...current, attempts, nextAttemptAt: now + delay });
    this.#items[index] = next;
    this.#retried += 1;
    return ok(next);
  }

  remove(id: string): boolean {
    const index = this.#items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.#items.splice(index, 1);
    return true;
  }

  clear(): void { this.#items.length = 0; }

  snapshot(): readonly OfflineCommand<T>[] { return [...this.#items]; }
  deadLetters(): readonly OfflineCommand<T>[] { return this.#dead.values(); }

  metrics(): QueueMetrics {
    return freeze({ queued: this.#items.length, pending: this.#items.filter((item) => item.attempts === 0).length, deadLetter: this.#dead.size(), enqueued: this.#enqueued, acknowledged: this.#acknowledged, retried: this.#retried, dropped: this.#dropped });
  }

  export(): string { return JSON.stringify({ version: 1, items: this.#items, deadLetters: this.#dead.values() }); }

  import(serialized: string): Result<number> {
    try {
      const parsed = JSON.parse(serialized) as { version?: unknown; items?: unknown[]; deadLetters?: unknown[] };
      if (parsed.version !== 1 || !Array.isArray(parsed.items)) return err({ code: 'QUEUE_IMPORT_INVALID', message: 'Unsupported queue snapshot.' });
      this.#items.length = 0;
      for (const candidate of parsed.items.slice(0, this.#policy.capacity)) if (candidate && typeof candidate === 'object') this.#items.push(candidate as OfflineCommand<T>);
      if (Array.isArray(parsed.deadLetters)) for (const candidate of parsed.deadLetters.slice(0, this.#policy.capacity)) if (candidate && typeof candidate === 'object') this.#dead.add(candidate as OfflineCommand<T>);
      return ok(this.#items.length);
    } catch (error) {
      return err({ code: 'QUEUE_IMPORT_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  }

  #evictLowestPriority(): boolean {
    const index = this.#items.findIndex((item) => item.attempts === 0);
    if (index < 0) return false;
    this.#items.splice(index, 1);
    this.#dropped += 1;
    return true;
  }
}

class OfflineCommandStore<T> {
  readonly #items = new Map<string, OfflineCommand<T>>();
  add(item: OfflineCommand<T>): void { this.#items.set(item.idempotencyKey, freeze(item)); }
  has(key: string): boolean { return this.#items.has(key); }
  size(): number { return this.#items.size; }
  values(): readonly OfflineCommand<T>[] { return [...this.#items.values()]; }
}

import type { AssetResult, AssetTicket } from './types.ts';
import { clamp, finite } from './math.ts';

export interface AssetSessionConfig {
  readonly concurrency: number;
  readonly maxPending: number;
  readonly maxAssetBytes: number;
  readonly timeoutMs: number;
}

const DEFAULT_CONFIG: AssetSessionConfig = Object.freeze({
  concurrency: 4,
  maxPending: 128,
  maxAssetBytes: 64 * 1024 * 1024,
  timeoutMs: 20_000,
});

export type AssetLoader = (ticket: AssetTicket, signal: AbortSignal) => Promise<number>;

export class AssetSessionR37 {
  readonly config: AssetSessionConfig;
  #queue: AssetTicket[] = [];
  #active = 0;
  #cancelled = false;
  #controller = new AbortController();
  #results: AssetResult[] = [];
  #listeners = new Set<(result: AssetResult) => void>();

  constructor(config: Partial<AssetSessionConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      concurrency: Math.max(1, Math.trunc(finite(config.concurrency, DEFAULT_CONFIG.concurrency))),
      maxPending: Math.max(1, Math.trunc(finite(config.maxPending, DEFAULT_CONFIG.maxPending))),
      maxAssetBytes: Math.max(1024, finite(config.maxAssetBytes, DEFAULT_CONFIG.maxAssetBytes)),
      timeoutMs: Math.max(250, finite(config.timeoutMs, DEFAULT_CONFIG.timeoutMs)),
    });
  }

  onResult(listener: (result: AssetResult) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  enqueue(ticket: AssetTicket): boolean {
    if (this.#cancelled || this.#queue.length >= this.config.maxPending) return false;
    if (!isSafeAssetUrl(ticket.url) || ticket.estimatedBytes > this.config.maxAssetBytes) return false;
    this.#queue.push(Object.freeze({
      ...ticket,
      id: String(ticket.id).slice(0, 96),
      priority: clamp(finite(ticket.priority), -1000, 1000),
      estimatedBytes: Math.max(0, finite(ticket.estimatedBytes)),
      url: ticket.url.slice(0, 2048),
    }));
    this.#queue.sort((a, b) => Number(b.critical) - Number(a.critical) || b.priority - a.priority || a.id.localeCompare(b.id));
    return true;
  }

  async drain(loader: AssetLoader): Promise<readonly AssetResult[]> {
    if (this.#cancelled) return Object.freeze([]);
    const workers = Array.from({ length: this.config.concurrency }, () => this.#worker(loader));
    await Promise.all(workers);
    return Object.freeze([...this.#results]);
  }

  cancel(): void {
    this.#cancelled = true;
    this.#queue = [];
    this.#controller.abort();
  }

  results(): readonly AssetResult[] {
    return Object.freeze([...this.#results]);
  }

  pending(): readonly AssetTicket[] {
    return Object.freeze([...this.#queue]);
  }

  #next(): AssetTicket | undefined {
    if (this.#cancelled) return undefined;
    return this.#queue.shift();
  }

  async #worker(loader: AssetLoader): Promise<void> {
    while (!this.#cancelled) {
      const ticket = this.#next();
      if (!ticket) return;
      this.#active += 1;
      const started = nowMs();
      let result: AssetResult;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const merged = new AbortController();
        const relay = () => merged.abort();
        this.#controller.signal.addEventListener('abort', relay, { once: true });
        try {
          const bytes = await loader(ticket, merged.signal);
          result = Object.freeze({
            ticketId: ticket.id,
            ok: Number.isFinite(bytes) && bytes <= this.config.maxAssetBytes,
            bytes: Math.max(0, finite(bytes)),
            durationMs: Math.max(0, nowMs() - started),
          });
        } finally {
          clearTimeout(timeout);
          this.#controller.signal.removeEventListener('abort', relay);
        }
      } catch (error) {
        result = Object.freeze({
          ticketId: ticket.id,
          ok: false,
          bytes: 0,
          durationMs: Math.max(0, nowMs() - started),
          error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        });
      }
      this.#active -= 1;
      this.#results.push(result);
      for (const listener of this.#listeners) listener(result);
    }
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

function isSafeAssetUrl(value: string): boolean {
  try {
    const url = new URL(value, 'https://local.invalid');
    return ['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

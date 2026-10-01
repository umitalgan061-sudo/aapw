import type { RuntimeCommand, SnapshotEnvelope, Tick } from './types';
import { hashJson } from './deterministic';

export type WorkerMessage =
  | { readonly kind: 'command'; readonly command: RuntimeCommand }
  | { readonly kind: 'snapshot'; readonly snapshot: SnapshotEnvelope<unknown> }
  | { readonly kind: 'ping'; readonly tick: Tick; readonly nonce: string };

export interface WorkerBridgeLimits { readonly maxMessages: number; readonly maxBytes: number; }
export interface WorkerBridgeStats { readonly queued: number; readonly accepted: number; readonly rejected: number; readonly dropped: number; }

export class RuntimeWorkerBridge {
  readonly limits: WorkerBridgeLimits;
  #queue: WorkerMessage[] = [];
  #accepted = 0;
  #rejected = 0;
  #dropped = 0;
  constructor(limits: Partial<WorkerBridgeLimits> = {}) { this.limits = Object.freeze({ maxMessages: 1024, maxBytes: 524288, ...limits }); }

  post(message: WorkerMessage): boolean {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
      if (bytes > this.limits.maxBytes || this.#queue.length >= this.limits.maxMessages) { this.#rejected += 1; return false; }
      this.#queue.push(structuredClone(message)); this.#accepted += 1; return true;
    } catch { this.#rejected += 1; return false; }
  }

  receive(limit = this.limits.maxMessages): readonly WorkerMessage[] {
    const take = Math.max(0, Math.trunc(limit));
    const result = this.#queue.splice(0, take);
    return Object.freeze(result);
  }

  drain(handler: (message: WorkerMessage) => void, limit = this.limits.maxMessages): number {
    let count = 0;
    for (const message of this.receive(limit)) {
      try { handler(message); count += 1; } catch { this.#dropped += 1; }
    }
    return count;
  }

  ping(tick: Tick): WorkerMessage {
    return Object.freeze({ kind: 'ping', tick, nonce: hashJson({ tick, sequence: this.#accepted }) });
  }

  stats(): WorkerBridgeStats {
    return Object.freeze({ queued: this.#queue.length, accepted: this.#accepted, rejected: this.#rejected, dropped: this.#dropped });
  }

  clear(): void { this.#queue.length = 0; }
}

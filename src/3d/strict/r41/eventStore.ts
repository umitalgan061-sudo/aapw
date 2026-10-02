
import type { RuntimeEvent } from './types.ts';
import { stableHash } from './types.ts';

export interface EventQuery {
  readonly fromTick?: number;
  readonly toTick?: number;
  readonly type?: RuntimeEvent['type'];
  readonly limit?: number;
}

export interface EventCheckpoint {
  readonly id: string;
  readonly tick: number;
  readonly sequence: number;
  readonly eventCount: number;
  readonly digest: number;
}

export interface EventStoreSnapshot {
  readonly capacity: number;
  readonly size: number;
  readonly sequence: number;
  readonly oldestTick: number | null;
  readonly newestTick: number | null;
  readonly digest: number;
}

export class EventStoreR41 {
  readonly capacity: number;
  #events: RuntimeEvent[] = [];
  #checkpoints: EventCheckpoint[] = [];
  #sequence = 0;

  constructor(capacity = 8192) {
    this.capacity = Math.max(128, Math.trunc(capacity));
  }

  nextSequence(): number {
    this.#sequence += 1;
    return this.#sequence;
  }

  append(event: Omit<RuntimeEvent, 'sequence'>): RuntimeEvent {
    const normalized = Object.freeze({ ...event, sequence: this.nextSequence() }) as RuntimeEvent;
    this.#events.push(normalized);
    if (this.#events.length > this.capacity) this.#events.splice(0, this.#events.length - this.capacity);
    return normalized;
  }

  appendMany(events: readonly Omit<RuntimeEvent, 'sequence'>[]): readonly RuntimeEvent[] {
    return Object.freeze(events.map(event => this.append(event)));
  }

  all(): readonly RuntimeEvent[] {
    return Object.freeze([...this.#events]);
  }

  query(query: EventQuery = {}): readonly RuntimeEvent[] {
    const fromTick = Math.trunc(query.fromTick ?? Number.MIN_SAFE_INTEGER);
    const toTick = Math.trunc(query.toTick ?? Number.MAX_SAFE_INTEGER);
    const limit = Math.max(1, Math.trunc(query.limit ?? this.capacity));
    const result: RuntimeEvent[] = [];
    for (let index = this.#events.length - 1; index >= 0 && result.length < limit; index -= 1) {
      const event = this.#events[index];
      if (!event || event.tick < fromTick || event.tick > toTick) continue;
      if (query.type && event.type !== query.type) continue;
      result.push(event);
    }
    result.reverse();
    return Object.freeze(result);
  }

  byTick(tick: number): readonly RuntimeEvent[] {
    return this.query({ fromTick: tick, toTick: tick, limit: this.capacity });
  }

  sinceSequence(sequence: number, limit = this.capacity): readonly RuntimeEvent[] {
    const target = Math.trunc(sequence);
    return Object.freeze(this.#events.filter(event => event.sequence > target).slice(-Math.max(1, Math.trunc(limit))));
  }

  checkpoint(id: string, tick: number): EventCheckpoint {
    const checkpoint = Object.freeze({
      id: sanitizeId(id),
      tick: Math.trunc(tick),
      sequence: this.#sequence,
      eventCount: this.#events.length,
      digest: this.digest(),
    });
    this.#checkpoints.push(checkpoint);
    if (this.#checkpoints.length > 256) this.#checkpoints.shift();
    return checkpoint;
  }

  checkpointById(id: string): EventCheckpoint | null {
    return this.#checkpoints.find(value => value.id === sanitizeId(id)) ?? null;
  }

  checkpoints(): readonly EventCheckpoint[] {
    return Object.freeze([...this.#checkpoints]);
  }

  truncateThroughSequence(sequence: number): number {
    const target = Math.trunc(sequence);
    const before = this.#events.length;
    this.#events = this.#events.filter(event => event.sequence > target);
    return before - this.#events.length;
  }

  pruneBeforeTick(tick: number): number {
    const target = Math.trunc(tick);
    const before = this.#events.length;
    this.#events = this.#events.filter(event => event.tick >= target);
    return before - this.#events.length;
  }

  digest(): number {
    return stableHash(this.#events.map(event => [event.sequence, event.tick, event.type, event]));
  }

  snapshot(): EventStoreSnapshot {
    return Object.freeze({
      capacity: this.capacity,
      size: this.#events.length,
      sequence: this.#sequence,
      oldestTick: this.#events[0]?.tick ?? null,
      newestTick: this.#events[this.#events.length - 1]?.tick ?? null,
      digest: this.digest(),
    });
  }

  restore(events: readonly RuntimeEvent[], sequence = 0): void {
    this.#events = [...events].slice(-this.capacity);
    this.#sequence = Math.max(
      Math.trunc(sequence),
      ...this.#events.map(event => event.sequence),
    );
  }

  clear(): void {
    this.#events = [];
    this.#checkpoints = [];
    this.#sequence = 0;
  }
}

function sanitizeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128);
}

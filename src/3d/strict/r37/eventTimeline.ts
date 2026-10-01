import type { RuntimeEvent } from './types.ts';
import { clamp, finite, stableJson } from './math.ts';

export interface TimelineEntry {
  readonly sequence: number;
  readonly event: RuntimeEvent;
  readonly hash: string;
}

export interface TimelineWindow {
  readonly startTick: number;
  readonly endTick: number;
  readonly entries: readonly TimelineEntry[];
}

export class EventTimelineR37 {
  #entries: TimelineEntry[] = [];
  #sequence = 0;
  readonly capacity: number;

  constructor(capacity = 1024) {
    this.capacity = Math.max(32, Math.trunc(finite(capacity, 1024)));
  }

  append(event: RuntimeEvent): TimelineEntry {
    const entry = Object.freeze({
      sequence: ++this.#sequence,
      event: Object.freeze(event),
      hash: stableJson({
        tick: event.tick,
        type: event.type,
        source: event.source,
        payload: event.payload,
      }),
    });
    this.#entries.push(entry);
    if (this.#entries.length > this.capacity) this.#entries.splice(0, this.#entries.length - this.capacity);
    return entry;
  }

  appendMany(events: readonly RuntimeEvent[]): readonly TimelineEntry[] {
    return Object.freeze(events.map((event) => this.append(event)));
  }

  atTick(tick: number): readonly TimelineEntry[] {
    const normalized = Math.max(0, Math.trunc(finite(tick)));
    return Object.freeze(this.#entries.filter((entry) => entry.event.tick === normalized));
  }

  between(startTick: number, endTick: number): TimelineWindow {
    const start = Math.min(startTick, endTick);
    const end = Math.max(startTick, endTick);
    return Object.freeze({
      startTick: start,
      endTick: end,
      entries: Object.freeze(this.#entries.filter((entry) => entry.event.tick >= start && entry.event.tick <= end)),
    });
  }

  latest(limit = 32): readonly TimelineEntry[] {
    return Object.freeze(this.#entries.slice(-clamp(Math.trunc(limit), 0, this.#entries.length)));
  }

  sequence(): number { return this.#sequence; }
  size(): number { return this.#entries.length; }

  verifyContinuity(): boolean {
    if (this.#entries.length < 2) return true;
    for (let i = 1; i < this.#entries.length; i += 1) {
      if (this.#entries[i]!.sequence !== this.#entries[i - 1]!.sequence + 1) return false;
      if (this.#entries[i]!.event.tick < this.#entries[i - 1]!.event.tick) return false;
    }
    return true;
  }

  digest(): string {
    return stableJson(this.#entries.map((entry) => ({ sequence: entry.sequence, hash: entry.hash })));
  }

  clear(): void {
    this.#entries = [];
    this.#sequence = 0;
  }

  trimBefore(tick: number): void {
    const cutoff = Math.max(0, Math.trunc(finite(tick)));
    this.#entries = this.#entries.filter((entry) => entry.event.tick >= cutoff);
  }
}

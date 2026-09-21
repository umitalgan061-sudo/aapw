import { Tick, hashString, mixHash, stableChecksum, stableStringify, tickValue } from './types.ts';

export type WorldEventKind = 'spawn' | 'despawn' | 'damage' | 'quest' | 'dialogue' | 'inventory' | 'weather' | 'settlement' | 'custom';
export interface WorldEvent<T = unknown> { id: string; tick: Tick; sequence: number; kind: WorldEventKind; source: string; entity?: number; payload: T; checksum: number; }
export interface JournalCheckpoint { id: string; tick: Tick; sequence: number; digest: number; eventCount: number; }
export interface JournalConfig { maxEvents: number; checkpointInterval: number; maxPayloadBytes: number; }
export interface JournalStats { eventCount: number; oldestTick: Tick; newestTick: Tick; checkpoints: number; bytes: number; digest: number; }
const DEFAULT_CONFIG: JournalConfig = { maxEvents: 12000, checkpointInterval: 120, maxPayloadBytes: 16 * 1024 };

function estimateBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function eventBody<T>(event: Omit<WorldEvent<T>, 'checksum'>): Omit<WorldEvent<T>, 'checksum'> { return event; }
function digestEvents<T>(events: readonly WorldEvent<T>[]): number { let digest = 0; for (const event of events) digest = mixHash(digest, event.checksum); return digest >>> 0; }

export class WorldEventJournalV2<T = unknown> {
  readonly #config: JournalConfig;
  readonly #events: WorldEvent<T>[] = [];
  readonly #checkpoints: JournalCheckpoint[] = [];
  #sequence = 0;
  #lastCheckpointTick = -1;
  #digest = 0;

  constructor(config: Partial<JournalConfig> = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (this.#config.maxEvents <= 0 || this.#config.checkpointInterval <= 0 || this.#config.maxPayloadBytes <= 0) throw new RangeError('Invalid journal configuration');
  }

  append(input: { tick: Tick; kind: WorldEventKind; source: string; entity?: number; payload: T }): WorldEvent<T> {
    if (estimateBytes(input.payload) > this.#config.maxPayloadBytes) throw new RangeError('World event payload exceeds configured limit');
    if (!input.source.trim()) throw new RangeError('World event source must not be empty');
    const sequence = ++this.#sequence;
    const eventWithoutChecksum = { id: `${Number(input.tick)}-${sequence}-${input.kind}`, tick: input.tick, sequence, kind: input.kind, source: input.source, entity: input.entity, payload: input.payload } satisfies Omit<WorldEvent<T>, 'checksum'>;
    const event = { ...eventWithoutChecksum, checksum: stableChecksum(eventBody(eventWithoutChecksum)) };
    this.#events.push(event);
    this.#digest = mixHash(this.#digest, event.checksum);
    this.#trim();
    if (Number(input.tick) - this.#lastCheckpointTick >= this.#config.checkpointInterval) this.checkpoint(input.tick);
    return { ...event };
  }

  appendMany(events: readonly { tick: Tick; kind: WorldEventKind; source: string; entity?: number; payload: T }[]): WorldEvent<T>[] { return events.map((event) => this.append(event)); }
  query(fromTick: Tick, toTick: Tick = fromTick, kind?: WorldEventKind): WorldEvent<T>[] { const min = Math.min(Number(fromTick), Number(toTick)); const max = Math.max(Number(fromTick), Number(toTick)); return this.#events.filter((event) => Number(event.tick) >= min && Number(event.tick) <= max && (!kind || event.kind === kind)).map((event) => ({ ...event })); }
  atOrBefore(tick: Tick): WorldEvent<T>[] { return this.#events.filter((event) => Number(event.tick) <= Number(tick)).map((event) => ({ ...event })); }
  latest(): WorldEvent<T> | undefined { const event = this.#events.at(-1); return event ? { ...event } : undefined; }

  checkpoint(tick: Tick): JournalCheckpoint {
    const checkpoint: JournalCheckpoint = { id: `cp-${Number(tick)}-${this.#sequence}`, tick, sequence: this.#sequence, digest: this.#digest, eventCount: this.#events.length };
    this.#checkpoints.push(checkpoint);
    this.#lastCheckpointTick = Number(tick);
    if (this.#checkpoints.length > 256) this.#checkpoints.splice(0, this.#checkpoints.length - 256);
    return { ...checkpoint };
  }

  checkpoints(): JournalCheckpoint[] { return this.#checkpoints.map((checkpoint) => ({ ...checkpoint })); }

  truncateAfter(tick: Tick): number {
    const index = this.#events.findIndex((event) => Number(event.tick) > Number(tick));
    if (index < 0) return 0;
    const removed = this.#events.splice(index);
    this.#recalculateDigest();
    const checkpointIndex = this.#checkpoints.findIndex((checkpoint) => Number(checkpoint.tick) > Number(tick));
    if (checkpointIndex >= 0) this.#checkpoints.splice(checkpointIndex);
    this.#lastCheckpointTick = this.#checkpoints.at(-1) ? Number(this.#checkpoints.at(-1)!.tick) : -1;
    return removed.length;
  }

  replay(fromTick: Tick, toTick: Tick, apply: (event: WorldEvent<T>) => void): number {
    const events = this.query(fromTick, toTick).sort((a, b) => a.sequence - b.sequence);
    for (const event of events) { if (stableChecksum(eventBody(event)) !== event.checksum) throw new Error(`Journal checksum mismatch for ${event.id}`); apply(event); }
    return events.length;
  }

  stats(): JournalStats { return { eventCount: this.#events.length, oldestTick: this.#events[0]?.tick ?? tickValue(0), newestTick: this.#events.at(-1)?.tick ?? tickValue(0), checkpoints: this.#checkpoints.length, bytes: estimateBytes(this.#events), digest: this.#digest }; }
  events(): WorldEvent<T>[] { return this.#events.map((event) => ({ ...event })); }
  clear(): void { this.#events.length = 0; this.#checkpoints.length = 0; this.#sequence = 0; this.#lastCheckpointTick = -1; this.#digest = 0; }
  snapshot(): { events: readonly WorldEvent<T>[]; checkpoints: readonly JournalCheckpoint[]; sequence: number; digest: number } { return { events: this.events(), checkpoints: this.checkpoints(), sequence: this.#sequence, digest: this.#digest }; }

  restore(snapshot: { events: readonly WorldEvent<T>[]; checkpoints: readonly JournalCheckpoint[]; sequence: number; digest: number }): void {
    if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0) throw new RangeError('Invalid journal sequence');
    for (const event of snapshot.events) if (stableChecksum(eventBody(event)) !== event.checksum) throw new Error(`Invalid event ${event.id}`);
    const calculatedDigest = digestEvents(snapshot.events);
    if (calculatedDigest !== snapshot.digest) throw new Error('Journal digest mismatch');
    for (const checkpoint of snapshot.checkpoints) {
      if (!Number.isInteger(checkpoint.sequence) || checkpoint.sequence < 0 || !Number.isInteger(checkpoint.eventCount) || checkpoint.eventCount < 0 || checkpoint.eventCount > snapshot.events.length) throw new Error(`Invalid checkpoint ${checkpoint.id}`);
      const prefix = snapshot.events.slice(0, checkpoint.eventCount);
      if (digestEvents(prefix) !== checkpoint.digest) throw new Error(`Invalid checkpoint digest ${checkpoint.id}`);
    }
    this.#events.length = 0;
    this.#events.push(...snapshot.events.map((event) => ({ ...event })));
    this.#checkpoints.length = 0;
    this.#checkpoints.push(...snapshot.checkpoints.map((checkpoint) => ({ ...checkpoint })));
    this.#sequence = snapshot.sequence;
    this.#digest = snapshot.digest;
    this.#lastCheckpointTick = this.#checkpoints.at(-1) ? Number(this.#checkpoints.at(-1)!.tick) : -1;
    this.#trim();
  }

  hash(): number { return hashString(stableStringify({ sequence: this.#sequence, digest: this.#digest, events: this.#events.map((event) => ({ id: event.id, tick: event.tick, checksum: event.checksum })) })); }

  #trim(): void { if (this.#events.length <= this.#config.maxEvents) return; const removedCount = this.#events.length - this.#config.maxEvents; this.#events.splice(0, removedCount); this.#recalculateDigest(); for (const checkpoint of this.#checkpoints) checkpoint.eventCount = Math.max(0, checkpoint.eventCount - removedCount); for (let index = this.#checkpoints.length - 1; index >= 0; index -= 1) if (this.#checkpoints[index]!.eventCount === 0 && Number(this.#checkpoints[index]!.tick) < Number(this.#events[0]?.tick ?? 0)) this.#checkpoints.splice(index, 1); }
  #recalculateDigest(): void { this.#digest = digestEvents(this.#events); }
}

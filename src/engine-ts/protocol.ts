import type { EngineResult, FrameCommand, SerializedEnvelope, Sequence, TickId } from './types.js';
import { SEQUENCE } from './types.js';
import { hashString, toHex32 } from './deterministic.js';

export const PROTOCOL_VERSION = 1 as const;
export type MessageKind = 'hello' | 'ready' | 'command' | 'snapshot' | 'event' | 'ack' | 'error' | 'shutdown';

export interface EngineMessage<T = unknown> {
  readonly kind: 'engine.message';
  readonly version: typeof PROTOCOL_VERSION;
  readonly message: MessageKind;
  readonly sequence: Sequence;
  readonly tick: TickId;
  readonly payload: Readonly<T>;
  readonly checksum: string;
}

export interface HelloPayload { readonly client: string; readonly protocol: number; readonly capabilities: readonly string[]; }
export interface ReadyPayload { readonly server: string; readonly protocol: number; readonly acceptedCapabilities: readonly string[]; }
export interface AckPayload { readonly accepted: boolean; readonly sequence: Sequence; readonly code: string; }
export interface ErrorPayload { readonly code: string; readonly message: string; readonly recoverable: boolean; }

export class ProtocolCodec {
  public encode<T>(message: EngineMessage<T>): string {
    return JSON.stringify(message);
  }

  public decode<T = unknown>(input: string): EngineResult<EngineMessage<T>> {
    try {
      const value: unknown = JSON.parse(input);
      if (!isRecord(value) || value.kind !== 'engine.message' || value.version !== PROTOCOL_VERSION) return invalid('PROTOCOL_VERSION');
      if (typeof value.message !== 'string' || typeof value.sequence !== 'number' || typeof value.tick !== 'number' || typeof value.checksum !== 'string') return invalid('PROTOCOL_SHAPE');
      const expected = checksumFor(value.message, value.sequence, value.tick, value.payload);
      if (expected !== value.checksum) return invalid('PROTOCOL_CHECKSUM');
      return { ok: true, value: value as EngineMessage<T>, meta: { status: 'ok', code: 'DECODED' } };
    } catch (error) {
      return invalid('PROTOCOL_PARSE', error instanceof Error ? error.message : 'Unknown parse failure');
    }
  }

  public message<T>(message: MessageKind, sequence: number, tick: number, payload: T): EngineMessage<T> {
    const safeSequence = Math.max(0, Math.trunc(sequence));
    const safeTick = Math.max(0, Math.trunc(tick));
    return Object.freeze({ kind: 'engine.message', version: PROTOCOL_VERSION, message, sequence: SEQUENCE(safeSequence), tick: safeTick as TickId, payload: freeze(payload), checksum: checksumFor(message, safeSequence, safeTick, payload) });
  }

  public command(sequence: number, tick: number, command: FrameCommand): EngineMessage<FrameCommand> { return this.message('command', sequence, tick, command); }
  public snapshot(sequence: number, tick: number, snapshot: unknown): EngineMessage { return this.message('snapshot', sequence, tick, snapshot); }
  public event(sequence: number, tick: number, event: unknown): EngineMessage { return this.message('event', sequence, tick, event); }
  public ack(sequence: number, tick: number, accepted: boolean, code: string): EngineMessage<AckPayload> { return this.message('ack', sequence, tick, { accepted, sequence: SEQUENCE(sequence), code }); }
  public error(sequence: number, tick: number, code: string, message: string, recoverable = false): EngineMessage<ErrorPayload> { return this.message('error', sequence, tick, { code, message, recoverable }); }
}

export const serializeState = (schema: string, version: number, data: unknown): SerializedEnvelope => {
  const json = JSON.stringify(data, stableReplacer);
  const checksum = toHex32(hashString(`${schema}:${version}:${json}`));
  return Object.freeze({ schema, version: Math.max(1, Math.trunc(version)), checksum, data: json });
};

export const deserializeState = <T>(envelope: SerializedEnvelope): EngineResult<T> => {
  if (!envelope || typeof envelope.schema !== 'string' || typeof envelope.version !== 'number') return invalid('STATE_SHAPE');
  const expected = toHex32(hashString(`${envelope.schema}:${envelope.version}:${envelope.data}`));
  if (expected !== envelope.checksum) return invalid('STATE_CHECKSUM');
  try {
    return { ok: true, value: JSON.parse(envelope.data) as T, meta: { status: 'ok', code: 'STATE_DECODED' } };
  } catch { return invalid('STATE_PARSE'); }
};

export class SequenceWindow {
  private readonly width: number;
  private nextExpected = 1;
  private readonly seen = new Set<number>();
  public constructor(width = 256) { this.width = Math.max(1, Math.trunc(width)); }
  public accept(sequence: number): boolean {
    const value = Math.trunc(sequence);
    if (value < this.nextExpected - this.width || this.seen.has(value)) return false;
    if (value > this.nextExpected + this.width) return false;
    this.seen.add(value);
    while (this.seen.has(this.nextExpected)) { this.seen.delete(this.nextExpected); this.nextExpected += 1; }
    return true;
  }
  public reset(start = 1): void { this.nextExpected = Math.max(0, Math.trunc(start)); this.seen.clear(); }
  public get expected(): number { return this.nextExpected; }
}

export class AbortableTaskQueue {
  private readonly tasks: Array<{ id: string; run: () => Promise<void> | void; priority: number }> = [];
  private running = false;
  private stopped = false;
  public enqueue(id: string, run: () => Promise<void> | void, priority = 0): boolean {
    if (this.stopped || this.tasks.some(task => task.id === id)) return false;
    this.tasks.push({ id, run, priority });
    this.tasks.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return true;
  }
  public cancel(id: string): boolean {
    const index = this.tasks.findIndex(task => task.id === id);
    if (index < 0) return false;
    this.tasks.splice(index, 1);
    return true;
  }
  public async drain(): Promise<number> {
    if (this.stopped || this.running) return 0;
    this.running = true;
    let count = 0;
    try {
      while (!this.stopped && this.tasks.length > 0) {
        const task = this.tasks.shift()!;
        try { await task.run(); } catch { /* isolate task */ }
        count += 1;
      }
      return count;
    } finally { this.running = false; }
  }
  public stop(): void { this.stopped = true; this.tasks.length = 0; }
}

const checksumFor = (message: string, sequence: number, tick: number, payload: unknown): string => toHex32(hashString(JSON.stringify([message, sequence, tick, payload], stableReplacer)));
const invalid = <T>(code: string, message?: string): EngineResult<T> => ({ ok: false, meta: { status: 'invalid', code, ...(message ? { message } : {}) } });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const freeze = <T>(value: T, depth = 0): T => {
  if (value === null || typeof value !== 'object' || depth > 5 || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) for (const item of value) freeze(item, depth + 1);
  else for (const item of Object.values(value as Record<string, unknown>)) freeze(item, depth + 1);
  return Object.freeze(value);
};
const stableReplacer = (_key: string, value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) sorted[key] = (value as Record<string, unknown>)[key];
  return sorted;
};

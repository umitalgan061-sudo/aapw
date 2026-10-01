import type { ReplayFrame, RuntimeCommand, SaveEnvelope, SaveJournalEntry, Tick } from './types';
import { hashJson, stableSerialize } from './deterministic';

export interface SaveSchema<T> {
  readonly id: string;
  readonly version: number;
  readonly validate: (value: unknown) => value is T;
  readonly migrate?: (value: unknown, fromVersion: number) => T;
}
export interface SaveStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface MemorySaveOptions { readonly maxBytes: number; readonly maxEntries: number; }

export class MemorySaveStore implements SaveStore {
  readonly options: MemorySaveOptions;
  #entries = new Map<string, string>();
  constructor(options: Partial<MemorySaveOptions> = {}) { this.options = Object.freeze({ maxBytes: options.maxBytes ?? 4 * 1024 * 1024, maxEntries: options.maxEntries ?? 64 }); }
  async read(key: string): Promise<string | null> { return this.#entries.get(key) ?? null; }
  async write(key: string, value: string): Promise<void> {
    if (new TextEncoder().encode(value).byteLength > this.options.maxBytes) throw new RangeError('save exceeds memory budget');
    if (!this.#entries.has(key) && this.#entries.size >= this.options.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (typeof oldest === 'string') this.#entries.delete(oldest);
    }
    this.#entries.set(key, value);
  }
  async remove(key: string): Promise<void> { this.#entries.delete(key); }
  clear(): void { this.#entries.clear(); }
}

export class SaveTransaction<T> {
  readonly id: string;
  readonly tick: Tick;
  readonly schema: SaveSchema<T>;
  #state: T | null = null;
  #journal: SaveJournalEntry[] = [];
  #committed = false;
  constructor(id: string, tick: Tick, schema: SaveSchema<T>) { this.id = id; this.tick = tick; this.schema = schema; this.record('begin', '', 0); }
  setState(value: T): void {
    if (this.#committed) throw new Error('transaction already committed');
    if (!this.schema.validate(value)) throw new TypeError('state does not satisfy save schema');
    this.#state = value; this.record('write', hashJson(value), stableSerialize(value).length);
  }
  record(operation: SaveJournalEntry['operation'], digest: string, bytes: number): void {
    this.#journal.push(Object.freeze({ transactionId: this.id, tick: this.tick, operation, digest, bytes }));
  }
  commit(): SaveEnvelope<T> {
    if (this.#committed || this.#state === null) throw new Error('cannot commit incomplete transaction');
    const state = this.#state; const digest = hashJson({ schema: this.schema.id, version: this.schema.version, state });
    this.record('commit', digest, stableSerialize(state).length); this.#committed = true;
    return Object.freeze({ schema: this.schema.id + '@' + String(this.schema.version), createdAt: Date.now() as never, tick: this.tick, digest, state });
  }
  abort(): readonly SaveJournalEntry[] { if (!this.#committed) this.record('abort', '', 0); return Object.freeze([...this.#journal]); }
  journal(): readonly SaveJournalEntry[] { return Object.freeze([...this.#journal]); }
}

export class ReplayRecorder {
  readonly maxFrames: number;
  #frames: ReplayFrame[] = [];
  constructor(maxFrames = 100000) { this.maxFrames = Math.max(1, Math.trunc(maxFrames)); }
  append(tick: Tick, commands: readonly RuntimeCommand[]): void {
    const frozenCommands = Object.freeze(commands.map((command) => Object.freeze({ ...command, payload: Object.freeze({ ...command.payload }) })));
    this.#frames.push(Object.freeze({ tick, commands: frozenCommands, digest: hashJson({ tick, commands: frozenCommands }) }));
    if (this.#frames.length > this.maxFrames) this.#frames.shift();
  }
  frames(fromTick: Tick = 0 as Tick): readonly ReplayFrame[] { return Object.freeze(this.#frames.filter((frame) => Number(frame.tick) >= Number(fromTick))); }
  digest(): string { return hashJson(this.#frames); }
  clear(): void { this.#frames.length = 0; }
}

export function replayCommands(frames: readonly ReplayFrame[], start: Tick, end: Tick): readonly RuntimeCommand[] {
  return Object.freeze(frames.filter((frame) => Number(frame.tick) >= Number(start) && Number(frame.tick) <= Number(end))
    .flatMap((frame) => frame.commands)
    .sort((a, b) => a.sequence - b.sequence || Number(a.tick) - Number(b.tick)));
}

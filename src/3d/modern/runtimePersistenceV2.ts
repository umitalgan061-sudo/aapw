import { decodeSnapshot, encodeSnapshot, type WorldSnapshotV2 } from './networkRuntimeV2.ts';
import type { PlayerState } from './playerAuthority.ts';

export interface RuntimeSaveEnvelope {
  readonly schema: 2;
  readonly kind: 'runtime-save';
  readonly createdAt: number;
  readonly worldId: string;
  readonly snapshot: WorldSnapshotV2;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly checksum: string;
}

export interface SaveAdapter {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export interface SaveResult {
  readonly ok: boolean;
  readonly bytes: number;
  readonly slot: string;
  readonly checksum?: string;
  readonly error?: string;
}

const bytesOf = (value: string): number => new TextEncoder().encode(value).byteLength;
const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export class RuntimeSaveStore {
  readonly #adapter: SaveAdapter;
  readonly #prefix: string;
  readonly #maxBytes: number;
  readonly #now: () => number;

  constructor(adapter: SaveAdapter, prefix = 'aapw.runtime.v2', maxBytes = 8 * 1024 * 1024, now = () => Date.now()) {
    this.#adapter = adapter;
    this.#prefix = prefix;
    this.#maxBytes = Math.max(64 * 1024, Math.floor(maxBytes));
    this.#now = now;
  }

  save(slot: string, worldId: string, player: PlayerState, entities: WorldSnapshotV2['entities'], settings: Readonly<Record<string, unknown>> = {}): SaveResult {
    const safeSlot = this.#safeSlot(slot);
    const snapshot = encodeSnapshot({ protocol: 2, sessionId: worldId, tick: player.revision, ack: player.revision, createdAt: this.#now(), entities, player });
    const body = { schema: 2 as const, kind: 'runtime-save' as const, createdAt: this.#now(), worldId, snapshot, settings };
    const envelope: RuntimeSaveEnvelope = Object.freeze({ ...body, checksum: digest(body) });
    const encoded = JSON.stringify(envelope);
    const bytes = bytesOf(encoded);
    if (bytes > this.#maxBytes) return { ok: false, bytes, slot: safeSlot, error: `Save exceeds ${this.#maxBytes} bytes.` };
    try { this.#adapter.write(this.#key(safeSlot), encoded); return { ok: true, bytes, slot: safeSlot, checksum: envelope.checksum }; }
    catch (error) { return { ok: false, bytes, slot: safeSlot, error: error instanceof Error ? error.message : String(error) }; }
  }

  load(slot: string): { readonly ok: true; readonly envelope: RuntimeSaveEnvelope } | { readonly ok: false; readonly error: string } {
    const raw = this.#adapter.read(this.#key(this.#safeSlot(slot)));
    if (!raw) return { ok: false, error: 'Save slot not found.' };
    try {
      const value = JSON.parse(raw) as RuntimeSaveEnvelope;
      if (value.schema !== 2 || value.kind !== 'runtime-save' || !value.snapshot) return { ok: false, error: 'Unsupported save schema.' };
      const { checksum, ...body } = value;
      if (checksum !== digest(body)) return { ok: false, error: 'Save checksum mismatch.' };
      const snapshot = decodeSnapshot(value.snapshot);
      return { ok: true, envelope: Object.freeze({ ...value, snapshot }) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  remove(slot: string): void { this.#adapter.remove(this.#key(this.#safeSlot(slot))); }

  list(): readonly string[] {
    const prefix = `${this.#prefix}:`;
    const result: string[] = [];
    if (typeof localStorage !== 'undefined' && this.#adapter === localStorage) {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) result.push(key.slice(prefix.length));
      }
    }
    return result.sort();
  }

  #safeSlot(slot: string): string { return slot.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default'; }
  #key(slot: string): string { return `${this.#prefix}:${slot}`; }
}

export const browserSaveAdapter = (): SaveAdapter => {
  if (typeof localStorage === 'undefined') {
    const values = new Map<string, string>();
    return { read: (key) => values.get(key) ?? null, write: (key, value) => { values.set(key, value); }, remove: (key) => { values.delete(key); } };
  }
  return localStorage;
};

export interface AutosavePolicyOptions { readonly intervalMs?: number; readonly minRevisionDelta?: number; readonly maxDirtyMs?: number; }
export class AutosavePolicy {
  readonly #intervalMs: number;
  readonly #minRevisionDelta: number;
  readonly #maxDirtyMs: number;
  #lastSaveAt = 0;
  #lastSavedRevision = 0;
  #dirtySince = 0;

  constructor(options: AutosavePolicyOptions = {}) {
    this.#intervalMs = Math.max(1000, Math.floor(options.intervalMs ?? 30_000));
    this.#minRevisionDelta = Math.max(1, Math.floor(options.minRevisionDelta ?? 5));
    this.#maxDirtyMs = Math.max(this.#intervalMs, Math.floor(options.maxDirtyMs ?? 180_000));
  }

  markDirty(revision: number, now: number): void { if (revision !== this.#lastSavedRevision && this.#dirtySince === 0) this.#dirtySince = now; }
  shouldSave(revision: number, now: number): boolean {
    if (revision - this.#lastSavedRevision < this.#minRevisionDelta) return false;
    if (this.#dirtySince === 0) return false;
    return now - this.#lastSaveAt >= this.#intervalMs || now - this.#dirtySince >= this.#maxDirtyMs;
  }
  markSaved(revision: number, now: number): void { this.#lastSavedRevision = revision; this.#lastSaveAt = now; this.#dirtySince = 0; }
  lastSavedRevision(): number { return this.#lastSavedRevision; }
}

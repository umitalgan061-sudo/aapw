import { RuntimeSaveStore, browserSaveAdapter, type RuntimeSaveEnvelope, type SaveAdapter } from '../runtimePersistenceV2.ts';
import type { WorldSnapshotV2 } from '../networkRuntimeV2.ts';
import type { PlayerState } from '../playerAuthority.ts';

export interface SaveSlotSummary { readonly slot: string; readonly worldId: string; readonly createdAt: number; readonly bytes: number; readonly checksum: string; readonly schema: number; }
export interface SaveSlotResult { readonly ok: boolean; readonly slot: string; readonly summary?: SaveSlotSummary; readonly error?: string; }
export interface SaveSlotManagerOptions { readonly adapter?: SaveAdapter; readonly prefix?: string; readonly maxBytes?: number; readonly maxSlots?: number; readonly now?: () => number; }

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const slotId = (slot: string): string => slot.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';

export class SaveSlotManager {
  readonly #store: RuntimeSaveStore;
  readonly #adapter: SaveAdapter;
  readonly #prefix: string;
  readonly #maxSlots: number;
  readonly #now: () => number;

  constructor(options: SaveSlotManagerOptions = {}) {
    this.#adapter = options.adapter ?? browserSaveAdapter();
    this.#prefix = options.prefix ?? 'aapw.runtime.v3';
    this.#maxSlots = Math.max(1, Math.floor(options.maxSlots ?? 12));
    this.#now = options.now ?? (() => Date.now());
    this.#store = new RuntimeSaveStore(this.#adapter, this.#prefix, options.maxBytes ?? 16 * 1024 * 1024, this.#now);
  }

  save(slot: string, worldId: string, player: PlayerState, entities: WorldSnapshotV2['entities'], settings: Readonly<Record<string, unknown>> = {}): SaveSlotResult {
    const safe = slotId(slot);
    const existing = this.list();
    if (!existing.includes(safe) && existing.length >= this.#maxSlots) {
      const oldest = this.#oldest(existing);
      if (oldest) this.delete(oldest);
    }
    const result = this.#store.save(safe, worldId, player, entities, settings);
    if (!result.ok) return Object.freeze({ ok: false, slot: safe, error: result.error ?? 'Save failed.' });
    return Object.freeze({ ok: true, slot: safe, summary: Object.freeze({ slot: safe, worldId, createdAt: this.#now(), bytes: result.bytes, checksum: result.checksum ?? '', schema: 2 }) });
  }

  load(slot: string): { readonly ok: true; readonly envelope: RuntimeSaveEnvelope } | { readonly ok: false; readonly error: string } {
    return this.#store.load(slotId(slot));
  }

  delete(slot: string): SaveSlotResult {
    const safe = slotId(slot);
    try { this.#store.remove(safe); return Object.freeze({ ok: true, slot: safe }); }
    catch (error) { return Object.freeze({ ok: false, slot: safe, error: error instanceof Error ? error.message : String(error) }); }
  }

  list(): readonly string[] { return Object.freeze(this.#readKeys().map((key) => key.slice((this.#prefix + ':').length)).sort()); }

  inspect(slot: string): SaveSlotSummary | undefined {
    const safe = slotId(slot);
    const raw = this.#adapter.read(this.#key(safe));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as RuntimeSaveEnvelope;
      return Object.freeze({ slot: safe, worldId: value.worldId, createdAt: value.createdAt, bytes: bytes(raw), checksum: value.checksum, schema: value.schema });
    } catch { return undefined; }
  }

  summaries(): readonly SaveSlotSummary[] { return Object.freeze(this.list().map((slot) => this.inspect(slot)).filter((value): value is SaveSlotSummary => Boolean(value))); }

  #readKeys(): string[] {
    const prefix = this.#prefix + ':';
    const adapter = this.#adapter as SaveAdapter & { length?: number; key?: (index: number) => string | null };
    if (typeof adapter.length !== 'number' || typeof adapter.key !== 'function') return [];
    const result: string[] = [];
    for (let index = 0; index < adapter.length; index += 1) { const key = adapter.key(index); if (key?.startsWith(prefix)) result.push(key); }
    return result;
  }
  #key(slot: string): string { return this.#prefix + ':' + slot; }
  #oldest(slots: readonly string[]): string | undefined { return slots.map((slot) => this.inspect(slot)).filter((value): value is SaveSlotSummary => Boolean(value)).sort((a, b) => a.createdAt - b.createdAt)[0]?.slot; }
}

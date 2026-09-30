import { stableObjectDigestR29, type R29Incident, type R29RuntimeSnapshot } from './contracts.ts';

export interface R29SaveEnvelope<T> {
  readonly schema: string;
  readonly version: number;
  readonly createdTick: number;
  readonly updatedTick: number;
  readonly payload: T;
  readonly checksum: string;
}

export interface R29SaveRecord<T> extends R29SaveEnvelope<T> {
  readonly slot: string;
  readonly bytes: number;
}

export interface R29SaveLedgerOptions {
  readonly maxSlots?: number;
  readonly maxBytes?: number;
  readonly schema?: string;
}

export interface R29SaveValidation {
  readonly ok: boolean;
  readonly reason: string;
  readonly schema: string;
  readonly version: number;
}

export class R29SaveLedger<T> {
  readonly maxSlots: number;
  readonly maxBytes: number;
  readonly schema: string;

  #records = new Map<string, R29SaveRecord<T>>();
  #version = 1;

  constructor(options: R29SaveLedgerOptions = {}) {
    this.maxSlots = Math.max(1, Math.floor(options.maxSlots ?? 12));
    this.maxBytes = Math.max(1024, Math.floor(options.maxBytes ?? 16 * 1024 * 1024));
    this.schema = options.schema?.trim() || 'aapw.r29.runtime';
  }

  write(slot: string, payload: T, tick: number): R29SaveRecord<T> {
    const normalizedSlot = this.normalizeSlot(slot);
    const previous = this.#records.get(normalizedSlot);
    const createdTick = previous?.createdTick ?? Math.max(0, Math.floor(tick));
    const updatedTick = Math.max(createdTick, Math.floor(tick));
    const checksum = stableObjectDigestR29({
      schema: this.schema,
      version: this.#version,
      createdTick,
      updatedTick,
      payload,
    });
    const bytes = JSON.stringify(payload).length;
    if (bytes > this.maxBytes) throw new Error('R29_SAVE_PAYLOAD_TOO_LARGE');
    const record: R29SaveRecord<T> = Object.freeze({
      slot: normalizedSlot,
      schema: this.schema,
      version: this.#version,
      createdTick,
      updatedTick,
      payload,
      checksum,
      bytes,
    });
    this.#records.set(normalizedSlot, record);
    this.#enforceBounds();
    return record;
  }

  read(slot: string): R29SaveRecord<T> | null {
    return this.#records.get(this.normalizeSlot(slot)) ?? null;
  }

  validate(record: R29SaveEnvelope<T>): R29SaveValidation {
    if (record.schema !== this.schema) {
      return Object.freeze({ ok: false, reason: 'schema', schema: record.schema, version: record.version });
    }
    const expected = stableObjectDigestR29({
      schema: record.schema,
      version: record.version,
      createdTick: record.createdTick,
      updatedTick: record.updatedTick,
      payload: record.payload,
    });
    if (expected !== record.checksum) {
      return Object.freeze({ ok: false, reason: 'checksum', schema: record.schema, version: record.version });
    }
    if (!Number.isInteger(record.version) || record.version < 1) {
      return Object.freeze({ ok: false, reason: 'version', schema: record.schema, version: record.version });
    }
    return Object.freeze({ ok: true, reason: 'valid', schema: record.schema, version: record.version });
  }

  export(slot?: string): string {
    const records = slot
      ? [this.read(slot)].filter((record): record is R29SaveRecord<T> => record !== null)
      : [...this.#records.values()];
    return JSON.stringify({
      schema: this.schema,
      version: this.#version,
      records: records.map((record) => ({
        slot: record.slot,
        schema: record.schema,
        version: record.version,
        createdTick: record.createdTick,
        updatedTick: record.updatedTick,
        payload: record.payload,
        checksum: record.checksum,
      })),
    });
  }

  import(serialized: string): readonly string[] {
    let source: unknown;
    try {
      source = JSON.parse(serialized);
    } catch {
      return Object.freeze([]);
    }
    if (!source || typeof source !== 'object') return Object.freeze([]);
    const root = source as { readonly schema?: unknown; readonly records?: unknown };
    if (root.schema !== this.schema || !Array.isArray(root.records)) return Object.freeze([]);

    const imported: string[] = [];
    for (const value of root.records) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as Partial<R29SaveRecord<T>>;
      if (typeof candidate.slot !== 'string' || candidate.schema !== this.schema) continue;
      if (candidate.payload === undefined || typeof candidate.checksum !== 'string') continue;
      const validation = this.validate(candidate as R29SaveEnvelope<T>);
      if (!validation.ok) continue;
      const existing = this.#records.get(candidate.slot);
      if (existing && existing.updatedTick > (candidate.updatedTick ?? 0)) continue;
      this.#records.set(candidate.slot, Object.freeze({
        slot: this.normalizeSlot(candidate.slot),
        schema: this.schema,
        version: candidate.version ?? 1,
        createdTick: candidate.createdTick ?? 0,
        updatedTick: candidate.updatedTick ?? 0,
        payload: candidate.payload as T,
        checksum: candidate.checksum,
        bytes: JSON.stringify(candidate.payload).length,
      }));
      imported.push(this.normalizeSlot(candidate.slot));
    }
    this.#enforceBounds();
    return Object.freeze(imported.sort());
  }

  remove(slot: string): boolean {
    return this.#records.delete(this.normalizeSlot(slot));
  }

  clear(): void {
    this.#records.clear();
  }

  slots(): readonly string[] {
    return Object.freeze([...this.#records.keys()].sort());
  }

  bytes(): number {
    return [...this.#records.values()].reduce((sum, record) => sum + record.bytes, 0);
  }

  snapshot(): readonly R29SaveRecord<T>[] {
    return Object.freeze(
      [...this.#records.values()]
        .sort((a, b) => a.slot.localeCompare(b.slot))
        .map((record) => ({ ...record })),
    );
  }

  normalizeSlot(slot: string): string {
    const normalized = slot.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized.slice(0, 64) || 'default';
  }

  #enforceBounds(): void {
    const ordered = [...this.#records.values()].sort((a, b) =>
      a.updatedTick - b.updatedTick || a.slot.localeCompare(b.slot),
    );
    while (this.#records.size > this.maxSlots || this.bytes() > this.maxBytes) {
      const victim = ordered.shift();
      if (!victim) break;
      this.#records.delete(victim.slot);
    }
  }
}

export interface R29RuntimeSavePayload {
  readonly snapshot: R29RuntimeSnapshot;
  readonly incidents: readonly R29Incident[];
}

export function captureR29RuntimeSave(
  snapshot: R29RuntimeSnapshot,
  incidents: readonly R29Incident[],
): R29RuntimeSavePayload {
  return Object.freeze({
    snapshot,
    incidents: Object.freeze(incidents.map((incident) => ({ ...incident, context: { ...incident.context } }))),
  });
}

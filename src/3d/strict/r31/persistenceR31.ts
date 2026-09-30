import type { PersistencePortR31, RuntimeSnapshotEnvelopeR31 } from './applicationTypesR31.ts';
import { SnapshotCodecRuntimeR31, canonicalDigestR31 } from './snapshotR31.ts';

export interface SaveSlotR31 {
  readonly key: string;
  readonly tick: number;
  readonly digest: string;
  readonly byteLength: number;
  readonly writtenAtMs: number;
}

export interface PersistenceDiagnosticsR31 {
  readonly writes: number;
  readonly reads: number;
  readonly failures: number;
  readonly bytesWritten: number;
  readonly bytesRead: number;
  readonly slots: number;
}

export class PersistenceRuntimeR31<T extends object> {
  readonly #port: PersistencePortR31;
  readonly #codec: SnapshotCodecRuntimeR31<T>;
  readonly #slots = new Map<string, SaveSlotR31>();
  #writes = 0;
  #reads = 0;
  #failures = 0;
  #bytesWritten = 0;
  #bytesRead = 0;

  constructor(port: PersistencePortR31, codec: SnapshotCodecRuntimeR31<T>) {
    this.#port = port;
    this.#codec = codec;
  }

  async save(key: string, state: T, tick: number, nowMs: number): Promise<SaveSlotR31> {
    const normalizedKey = this.#normalizeKey(key);
    try {
      const envelope = this.#codec.encode(state, tick, nowMs);
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      await this.#port.write(normalizedKey, bytes);
      const slot = Object.freeze({
        key: normalizedKey,
        tick: envelope.tick,
        digest: envelope.digest,
        byteLength: bytes.byteLength,
        writtenAtMs: envelope.createdAt,
      });
      this.#slots.set(normalizedKey, slot);
      this.#writes++;
      this.#bytesWritten += bytes.byteLength;
      return slot;
    } catch (error) {
      this.#failures++;
      throw error;
    }
  }

  async load(key: string): Promise<{ readonly envelope: RuntimeSnapshotEnvelopeR31<T>; readonly slot: SaveSlotR31 } | null> {
    const normalizedKey = this.#normalizeKey(key);
    try {
      const bytes = await this.#port.read(normalizedKey);
      this.#reads++;
      if (!bytes) return null;
      const input = JSON.parse(new TextDecoder().decode(bytes));
      const decoded = this.#codec.decode(input);
      if (!decoded.ok || !decoded.meta || !decoded.state) {
        this.#failures++;
        return null;
      }
      this.#bytesRead += bytes.byteLength;
      const envelope = input as RuntimeSnapshotEnvelopeR31<T>;
      const slot = Object.freeze({
        key: normalizedKey,
        tick: decoded.meta.tick,
        digest: decoded.meta.digest,
        byteLength: decoded.meta.byteLength,
        writtenAtMs: envelope.createdAt,
      });
      this.#slots.set(normalizedKey, slot);
      return Object.freeze({ envelope, slot });
    } catch {
      this.#failures++;
      return null;
    }
  }

  async remove(key: string): Promise<boolean> {
    const normalizedKey = this.#normalizeKey(key);
    try {
      await this.#port.remove(normalizedKey);
      this.#slots.delete(normalizedKey);
      return true;
    } catch {
      this.#failures++;
      return false;
    }
  }

  listSlots(): readonly SaveSlotR31[] {
    return Object.freeze([...this.#slots.values()].sort((a, b) => a.key.localeCompare(b.key)));
  }

  diagnostics(): PersistenceDiagnosticsR31 {
    return Object.freeze({
      writes: this.#writes,
      reads: this.#reads,
      failures: this.#failures,
      bytesWritten: this.#bytesWritten,
      bytesRead: this.#bytesRead,
      slots: this.#slots.size,
    });
  }

  #normalizeKey(key: string): string {
    const normalized = key.trim();
    if (!/^[a-zA-Z0-9._:-]{1,96}$/u.test(normalized)) throw new Error('Invalid persistence key');
    return normalized;
  }
}

export function digestPersistedStateR31(value: unknown): string {
  return canonicalDigestR31(value);
}

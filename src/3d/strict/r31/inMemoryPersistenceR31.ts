import type { PersistencePortR31 } from './applicationTypesR31.ts';

export class InMemoryPersistencePortR31 implements PersistencePortR31 {
  readonly #records = new Map<string, Uint8Array>();
  #writes = 0;
  #reads = 0;
  #deletes = 0;
  #bytes = 0;

  async write(key: string, value: Uint8Array): Promise<void> {
    const copy = value.slice();
    const previous = this.#records.get(key);
    if (previous) this.#bytes -= previous.byteLength;
    this.#records.set(key, copy);
    this.#bytes += copy.byteLength;
    this.#writes++;
  }

  async read(key: string): Promise<Uint8Array | null> {
    this.#reads++;
    const value = this.#records.get(key);
    return value ? value.slice() : null;
  }

  async remove(key: string): Promise<void> {
    const value = this.#records.get(key);
    if (!value) return;
    this.#records.delete(key);
    this.#bytes -= value.byteLength;
    this.#deletes++;
  }

  has(key: string): boolean { return this.#records.has(key); }

  keys(): readonly string[] {
    return Object.freeze([...this.#records.keys()].sort());
  }

  diagnostics(): Readonly<{
    records: number;
    writes: number;
    reads: number;
    deletes: number;
    bytes: number;
  }> {
    return Object.freeze({
      records: this.#records.size,
      writes: this.#writes,
      reads: this.#reads,
      deletes: this.#deletes,
      bytes: this.#bytes,
    });
  }

  clear(): void {
    this.#records.clear();
    this.#bytes = 0;
  }
}

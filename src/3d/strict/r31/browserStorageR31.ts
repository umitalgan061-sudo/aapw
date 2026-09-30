import type { PersistencePortR31 } from './applicationTypesR31.ts';

export class BrowserStoragePortR31 implements PersistencePortR31 {
  readonly #prefix: string;
  #writes = 0;
  #reads = 0;
  #removes = 0;

  constructor(prefix = 'aapw:r31:') {
    const normalized = prefix.trim();
    if (!normalized) throw new Error('Storage prefix cannot be empty');
    this.#prefix = normalized;
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    if (typeof localStorage === 'undefined') throw new Error('localStorage-unavailable');
    localStorage.setItem(this.#prefix + key, this.#toBase64(value));
    this.#writes++;
  }

  async read(key: string): Promise<Uint8Array | null> {
    if (typeof localStorage === 'undefined') throw new Error('localStorage-unavailable');
    const value = localStorage.getItem(this.#prefix + key);
    this.#reads++;
    return value === null ? null : this.#fromBase64(value);
  }

  async remove(key: string): Promise<void> {
    if (typeof localStorage === 'undefined') throw new Error('localStorage-unavailable');
    localStorage.removeItem(this.#prefix + key);
    this.#removes++;
  }

  diagnostics(): Readonly<{ writes: number; reads: number; removes: number }> {
    return Object.freeze({ writes: this.#writes, reads: this.#reads, removes: this.#removes });
  }

  #toBase64(value: Uint8Array): string {
    let binary = '';
    for (let index = 0; index < value.length; index += 0x8000) {
      binary += String.fromCharCode(...value.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  #fromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const result = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index);
    return result;
  }
}

import type { RuntimeResourceDescriptorR31, RuntimeResourceR31 } from './applicationTypesR31.ts';

interface Entry<T> {
  descriptor: RuntimeResourceDescriptorR31;
  value: T;
  release: () => void;
  released: boolean;
}

export interface ResourceScopeDiagnosticsR31 {
  readonly resources: number;
  readonly critical: number;
  readonly estimatedBytes: number;
  readonly released: number;
}

export class ResourceScopeR31 {
  readonly #entries = new Map<string, Entry<unknown>>();
  #disposed = false;
  #released = 0;

  acquire<T>(descriptor: RuntimeResourceDescriptorR31, value: T, release: () => void): RuntimeResourceR31<T> {
    if (this.#disposed) throw new Error('ResourceScopeR31 is disposed');
    if (this.#entries.has(descriptor.id)) throw new Error(`Duplicate resource id: ${descriptor.id}`);
    if (descriptor.weight < 0 || !Number.isFinite(descriptor.weight)) throw new Error('Invalid resource weight');
    if (descriptor.estimatedBytes < 0 || !Number.isFinite(descriptor.estimatedBytes)) throw new Error('Invalid estimatedBytes');
    const entry: Entry<T> = { descriptor, value, release, released: false };
    this.#entries.set(descriptor.id, entry);
    return Object.freeze({
      descriptor,
      value,
      release: () => this.#release(descriptor.id),
    });
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  get<T>(id: string): T | null {
    const entry = this.#entries.get(id);
    return entry ? entry.value as T : null;
  }

  release(id: string): boolean {
    return this.#release(id);
  }

  releaseByTag(tag: string): number {
    const ids = [...this.#entries.values()]
      .filter((entry) => entry.descriptor.tags.includes(tag))
      .map((entry) => entry.descriptor.id);
    let count = 0;
    for (const id of ids) count += this.#release(id) ? 1 : 0;
    return count;
  }

  diagnostics(): ResourceScopeDiagnosticsR31 {
    let estimatedBytes = 0;
    let critical = 0;
    for (const entry of this.#entries.values()) {
      if (entry.released) continue;
      estimatedBytes += entry.descriptor.estimatedBytes;
      if (entry.descriptor.critical) critical++;
    }
    return Object.freeze({
      resources: this.#entries.size,
      critical,
      estimatedBytes,
      released: this.#released,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    const ids = [...this.#entries.keys()].reverse();
    for (const id of ids) this.#release(id);
    this.#entries.clear();
    this.#disposed = true;
  }

  #release(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry || entry.released) return false;
    entry.released = true;
    try {
      entry.release();
    } finally {
      this.#released++;
      this.#entries.delete(id);
    }
    return true;
  }
}

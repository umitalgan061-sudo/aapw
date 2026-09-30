export interface DisposableResource {
  readonly id: string;
  readonly kind: 'geometry' | 'material' | 'texture' | 'audio' | 'buffer' | 'custom';
  readonly bytes: number;
  readonly dispose: () => void;
}

export interface ResourceStats {
  readonly count: number;
  readonly bytes: number;
  readonly byKind: Readonly<Record<string, number>>;
}

export class RuntimeResourceRegistry {
  #resources = new Map<string, DisposableResource>();
  #disposed = false;

  register(resource: DisposableResource): void {
    if (this.#disposed) throw new Error('Resource registry is disposed');
    if (!resource.id || resource.bytes < 0) throw new RangeError('Invalid resource');
    const existing = this.#resources.get(resource.id);
    if (existing) existing.dispose();
    this.#resources.set(resource.id, resource);
  }

  release(id: string): boolean {
    const resource = this.#resources.get(id);
    if (!resource) return false;
    this.#resources.delete(id);
    resource.dispose();
    return true;
  }

  disposeKind(kind: DisposableResource['kind']): number {
    const items = [...this.#resources.values()].filter((resource) => resource.kind === kind);
    for (const resource of items) {
      this.#resources.delete(resource.id);
      resource.dispose();
    }
    return items.length;
  }

  stats(): ResourceStats {
    const byKind = new Map<string, number>();
    let bytes = 0;
    for (const resource of this.#resources.values()) {
      bytes += resource.bytes;
      byKind.set(resource.kind, (byKind.get(resource.kind) ?? 0) + 1);
    }
    return {
      count: this.#resources.size,
      bytes,
      byKind: Object.fromEntries([...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
  }

  list(): readonly DisposableResource[] {
    return [...this.#resources.values()]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const resource of [...this.#resources.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      resource.dispose();
    }
    this.#resources.clear();
    this.#disposed = true;
  }
}

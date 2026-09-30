export interface AssetManifestEntryR31 {
  readonly id: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256?: string;
  readonly dependencies: readonly string[];
  readonly critical: boolean;
}

export interface AssetGateReportR31 {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly orderedIds: readonly string[];
  readonly totalBytes: number;
}

export class AssetGateR31 {
  readonly #entries = new Map<string, AssetManifestEntryR31>();

  register(entry: AssetManifestEntryR31): void {
    if (!entry.id.trim()) throw new Error('asset-id-empty');
    if (!/^https?:\/\//u.test(entry.url)) throw new Error(`asset-url-invalid:${entry.id}`);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) throw new Error(`asset-bytes-invalid:${entry.id}`);
    if (this.#entries.has(entry.id)) throw new Error(`asset-duplicate:${entry.id}`);
    this.#entries.set(entry.id, Object.freeze({
      ...entry,
      dependencies: Object.freeze([...new Set(entry.dependencies)].sort()),
    }));
  }

  validate(maxBytes = 256 * 1024 * 1024): AssetGateReportR31 {
    const errors: string[] = [];
    let totalBytes = 0;
    for (const entry of this.#entries.values()) {
      totalBytes += entry.bytes;
      for (const dependency of entry.dependencies) {
        if (!this.#entries.has(dependency)) errors.push(`missing-dependency:${entry.id}:${dependency}`);
      }
    }
    if (totalBytes > maxBytes) errors.push('manifest-too-large');

    const orderedIds = this.#topologicalOrder(errors);
    if (orderedIds.length !== this.#entries.size) errors.push('dependency-cycle');
    return Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze([...new Set(errors)]),
      orderedIds: Object.freeze(orderedIds),
      totalBytes,
    });
  }

  criticalEntries(): readonly AssetManifestEntryR31[] {
    return Object.freeze([...this.#entries.values()].filter((entry) => entry.critical).sort((a, b) => a.id.localeCompare(b.id)));
  }

  #topologicalOrder(errors: string[]): string[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        errors.push(`cycle-at:${id}`);
        return;
      }
      const entry = this.#entries.get(id);
      if (!entry) return;
      visiting.add(id);
      for (const dependency of entry.dependencies) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of [...this.#entries.keys()].sort()) visit(id);
    return order;
  }
}

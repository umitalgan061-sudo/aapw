export type ContentKind = 'character' | 'animation' | 'structure' | 'vegetation' | 'fx' | 'audio' | 'ui' | 'world';

export interface ContentEntry {
  readonly id: string;
  readonly kind: ContentKind;
  readonly url: string;
  readonly version: number;
  readonly bytes: number;
  readonly checksum?: string;
  readonly tags: readonly string[];
}

export interface ContentCatalogSnapshot {
  readonly version: 37;
  readonly entries: readonly ContentEntry[];
}

export class ContentCatalogR37 {
  #entries = new Map<string, ContentEntry>();

  register(entry: ContentEntry): boolean {
    const id = String(entry.id).trim().slice(0, 96);
    if (!id || this.#entries.has(id)) return false;
    try {
      const url = new URL(entry.url, 'https://local.invalid');
      if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) return false;
    } catch {
      return false;
    }
    this.#entries.set(id, Object.freeze({
      id,
      kind: entry.kind,
      url: entry.url.slice(0, 2048),
      version: Math.max(1, Math.trunc(entry.version)),
      bytes: Math.max(0, Math.trunc(entry.bytes)),
      ...(entry.checksum ? { checksum: String(entry.checksum).slice(0, 128) } : {}),
      tags: Object.freeze(entry.tags.slice(0, 16).map((tag) => String(tag).slice(0, 64))),
    }));
    return true;
  }

  upsert(entry: ContentEntry): void {
    this.#entries.delete(entry.id);
    this.register(entry);
  }

  get(id: string): ContentEntry | undefined { return this.#entries.get(String(id)); }
  byKind(kind: ContentKind): readonly ContentEntry[] { return Object.freeze([...this.#entries.values()].filter((entry) => entry.kind === kind)); }
  byTag(tag: string): readonly ContentEntry[] { return Object.freeze([...this.#entries.values()].filter((entry) => entry.tags.includes(String(tag)))); }
  remove(id: string): boolean { return this.#entries.delete(String(id)); }
  size(): number { return this.#entries.size; }

  snapshot(): ContentCatalogSnapshot {
    return Object.freeze({ version: 37, entries: Object.freeze([...this.#entries.values()].sort((a, b) => a.id.localeCompare(b.id))) });
  }

  restore(snapshot: ContentCatalogSnapshot): void {
    if (snapshot.version !== 37) throw new RangeError('unsupported content catalog version');
    this.#entries.clear();
    for (const entry of snapshot.entries) this.register(entry);
  }
}

import { hashJson, stableSort } from './deterministic';
import type { AssetManifestEntry } from './types';

export interface RuntimeManifest { readonly schema: string; readonly generatedAt: string; readonly modules: readonly string[]; readonly assets: readonly AssetManifestEntry[]; readonly digest: string; }
export class R40ManifestBuilder {
  #modules = new Set<string>();
  #assets = new Map<string, AssetManifestEntry>();
  module(path: string): void { if (/^[A-Za-z0-9_./:-]{1,256}$/.test(path)) this.#modules.add(path); }
  asset(entry: AssetManifestEntry): void { if (entry.id && entry.bytes >= 0) this.#assets.set(String(entry.id), Object.freeze({ ...entry })); }
  build(): RuntimeManifest {
    const modules = Object.freeze([...this.#modules].sort());
    const assets = Object.freeze(stableSort([...this.#assets.values()], (a, b) => String(a.id).localeCompare(String(b.id))));
    return Object.freeze({ schema: 'aapw-r40@1', generatedAt: new Date(0).toISOString(), modules, assets, digest: hashJson({ schema: 'aapw-r40@1', modules, assets }) });
  }
  clear(): void { this.#modules.clear(); this.#assets.clear(); }
}

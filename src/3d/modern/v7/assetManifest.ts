import { digest, stableSort, type Disposable, type ResourceId, type V7Result } from './primitives.js';

export interface ManifestAsset { readonly id: ResourceId; readonly url: string; readonly kind: 'model' | 'texture' | 'audio' | 'shader' | 'data'; readonly bytes: number; readonly digest: string; readonly critical: boolean; readonly tags: readonly string[]; readonly dependencies: readonly ResourceId[]; }
export interface AssetManifest { readonly version: number; readonly build: string; readonly assets: readonly ManifestAsset[]; readonly digest: string; }
export interface ManifestStats { readonly assets: number; readonly critical: number; readonly bytes: number; readonly dependencyEdges: number; readonly malformed: number; }

export class AssetManifestRegistry implements Disposable {
  #assets = new Map<ResourceId, ManifestAsset>();
  #disposed = false;
  #malformed = 0;
  register(asset: ManifestAsset): V7Result<ManifestAsset> {
    if (this.#disposed) return { ok: false, code: 'MANIFEST_DISPOSED', message: 'Asset manifest is disposed', retryable: false };
    if (!asset.id || this.#assets.has(asset.id) || asset.bytes < 0 || asset.bytes > 2 * 1024 * 1024 * 1024 || !asset.url || !asset.digest) { this.#malformed += 1; return { ok: false, code: 'ASSET_MANIFEST_INVALID', message: 'Asset manifest entry is invalid', retryable: false }; }
    const normalized = Object.freeze({ ...asset, bytes: Math.trunc(asset.bytes), tags: Object.freeze([...new Set(asset.tags)]), dependencies: Object.freeze([...new Set(asset.dependencies)]) });
    this.#assets.set(asset.id, normalized);
    return { ok: true, value: normalized };
  }
  resolve(id: ResourceId): ManifestAsset | undefined { return this.#assets.get(id); }
  dependencyClosure(id: ResourceId, limit = 512): readonly ResourceId[] {
    const seen = new Set<ResourceId>();
    const visit = (current: ResourceId): void => {
      if (seen.size >= Math.max(1, Math.min(4096, Math.trunc(limit))) || seen.has(current)) return;
      seen.add(current);
      for (const dependency of this.#assets.get(current)?.dependencies ?? []) visit(dependency);
    };
    visit(id);
    return Object.freeze([...seen].sort((a, b) => String(a).localeCompare(String(b))));
  }
  manifest(version = 1, build = 'v7'): AssetManifest { const assets = stableSort([...this.#assets.values()], (a, b) => String(a.id).localeCompare(String(b.id))); return Object.freeze({ version, build, assets: Object.freeze(assets), digest: digest(version, build, assets) }); }
  stats(): ManifestStats { const assets = [...this.#assets.values()]; return Object.freeze({ assets: assets.length, critical: assets.filter((asset) => asset.critical).length, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), dependencyEdges: assets.reduce((sum, asset) => sum + asset.dependencies.length, 0), malformed: this.#malformed }); }
  all(): readonly ManifestAsset[] { return Object.freeze(stableSort([...this.#assets.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  clear(): void { this.#assets.clear(); this.#malformed = 0; }
  dispose(): void { this.#disposed = true; this.clear(); }
}

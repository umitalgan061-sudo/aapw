import type { Disposable } from './coreTypes.js';

export interface RuntimeModuleManifest { readonly id: string; readonly version: string; readonly entry: string; readonly capabilities: readonly string[]; readonly dependencies: readonly string[]; readonly hash: string; readonly enabled: boolean; }
export interface RuntimeManifest { readonly schema: number; readonly buildId: string; readonly generatedAt: number; readonly modules: readonly RuntimeModuleManifest[]; readonly digest: string; }
export interface ManifestStats { readonly modules: number; readonly enabled: number; readonly dependencies: number; readonly collisions: number; }

function hash(value: unknown): string { const text = JSON.stringify(value); let result = 2166136261; for (let i = 0; i < text.length; i += 1) { result ^= text.charCodeAt(i); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, '0'); }
function normalize(value: RuntimeModuleManifest): RuntimeModuleManifest { return Object.freeze({ id: value.id.trim(), version: value.version.trim(), entry: value.entry.trim(), capabilities: Object.freeze([...new Set(value.capabilities.map(String).filter(Boolean))].sort()), dependencies: Object.freeze([...new Set(value.dependencies.map(String).filter(Boolean))].sort()), hash: value.hash.trim(), enabled: value.enabled }); }

export class RuntimeManifestRegistry implements Disposable {
  #modules = new Map<string, RuntimeModuleManifest>();
  #collisions = 0;
  #disposed = false;

  register(module: RuntimeModuleManifest): boolean {
    if (this.#disposed || !module.id || !module.version || !module.entry) return false;
    if (this.#modules.has(module.id)) { this.#collisions += 1; return false; }
    const normalized = normalize(module);
    if (normalized.dependencies.includes(normalized.id)) return false;
    this.#modules.set(normalized.id, normalized);
    return true;
  }

  unregister(id: string): boolean { return this.#modules.delete(id); }
  module(id: string): RuntimeModuleManifest | undefined { return this.#modules.get(id); }
  modules(): readonly RuntimeModuleManifest[] { return Object.freeze([...this.#modules.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  hasCapability(capability: string): boolean { return this.modules().some(module => module.enabled && module.capabilities.includes(capability)); }
  dependencyOrder(): readonly RuntimeModuleManifest[] {
    const output: RuntimeModuleManifest[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => { if (visited.has(id)) return; if (visiting.has(id)) throw new Error('MANIFEST_DEPENDENCY_CYCLE'); visiting.add(id); const module = this.#modules.get(id); if (module) for (const dependency of module.dependencies) if (this.#modules.has(dependency)) visit(dependency); visiting.delete(id); visited.add(id); if (module) output.push(module); };
    for (const id of [...this.#modules.keys()].sort()) visit(id);
    return Object.freeze(output);
  }

  build(buildId: string, generatedAt: number): RuntimeManifest { const modules = this.dependencyOrder(); return Object.freeze({ schema: 1, buildId: buildId.trim() || 'unknown', generatedAt, modules, digest: hash(modules) }); }
  verify(manifest: RuntimeManifest): boolean { return manifest.schema === 1 && hash(manifest.modules) === manifest.digest && manifest.modules.every(module => module.enabled === true || module.enabled === false); }
  stats(): ManifestStats { return Object.freeze({ modules: this.#modules.size, enabled: this.modules().filter(module => module.enabled).length, dependencies: this.modules().reduce((sum, module) => sum + module.dependencies.length, 0), collisions: this.#collisions }); }
  clear(): void { this.#modules.clear(); this.#collisions = 0; }
  dispose(): void { this.#disposed = true; this.clear(); }
}

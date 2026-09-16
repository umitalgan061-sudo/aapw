import {
  type AssetIdV4,
  type OutcomeV4,
  type AssetDescriptorV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
} from './runtimeContractsV4';

export type AssetNodeKindV5 = 'scene' | 'model' | 'texture' | 'audio' | 'shader' | 'data' | 'font' | 'binary';
export type AssetNodeStatusV5 = 'declared' | 'queued' | 'loading' | 'ready' | 'failed' | 'invalidated';

export interface AssetNodeV5 {
  readonly id: AssetIdV4;
  readonly kind: AssetNodeKindV5;
  readonly bytes: number;
  readonly priority: number;
  readonly optional: boolean;
  readonly dependencies: readonly AssetIdV4[];
  readonly dependents: readonly AssetIdV4[];
  readonly digest: string;
  status: AssetNodeStatusV5;
  generation: number;
  errorCount: number;
}

export interface AssetPlanV5 {
  readonly order: readonly AssetIdV4[];
  readonly critical: readonly AssetIdV4[];
  readonly optional: readonly AssetIdV4[];
  readonly bytes: number;
  readonly cycles: readonly (readonly AssetIdV4[])[];
}

export interface AssetGraphMetricsV5 {
  readonly nodes: number;
  readonly edges: number;
  readonly ready: number;
  readonly loading: number;
  readonly failed: number;
  readonly invalidated: number;
  readonly cycles: number;
  readonly invalidations: number;
  readonly blocked: number;
}

export interface AssetGraphOptionsV5 {
  readonly maxNodes?: number;
  readonly maxDependencies?: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class AssetGraphV5 {
  readonly maxNodes: number;
  readonly maxDependencies: number;
  #nodes = new Map<AssetIdV4, AssetNodeV5>();
  #invalidations = 0;
  #blocked = 0;

  constructor(options: AssetGraphOptionsV5 = {}) {
    this.maxNodes = Math.max(16, Math.trunc(options.maxNodes ?? 50_000));
    this.maxDependencies = Math.max(1, Math.trunc(options.maxDependencies ?? 256));
  }

  declare(descriptor: AssetDescriptorV4, dependencies: readonly AssetIdV4[] = []): OutcomeV4<AssetNodeV5> {
    if (!descriptor.id || !descriptor.digest) return failV4(createRuntimeErrorV4('ASSET_GRAPH_DESCRIPTOR', 'Asset descriptor is incomplete', false));
    if (!this.#nodes.has(descriptor.id) && this.#nodes.size >= this.maxNodes) return failV4(createRuntimeErrorV4('ASSET_GRAPH_CAP', 'Asset graph capacity reached', true));
    const deps = Object.freeze([...new Set(dependencies.map(String))].slice(0, this.maxDependencies)) as readonly AssetIdV4[];
    const previous = this.#nodes.get(descriptor.id);
    const node: AssetNodeV5 = {
      id: descriptor.id,
      kind: descriptor.kind as AssetNodeKindV5,
      bytes: Math.max(0, Math.trunc(finite(descriptor.bytes))),
      priority: Math.trunc(finite(descriptor.priority)),
      optional: Boolean(descriptor.optional),
      dependencies: deps,
      dependents: previous?.dependents ?? Object.freeze([]),
      digest: descriptor.digest,
      status: previous?.status ?? 'declared',
      generation: previous?.generation ?? 1,
      errorCount: previous?.errorCount ?? 0,
    };
    this.#nodes.set(node.id, node);
    this.#rebuildDependents();
    return okV4(this.#nodes.get(node.id)!);
  }

  descriptor(id: AssetIdV4): AssetNodeV5 | undefined { return this.#nodes.get(id); }

  setStatus(id: AssetIdV4, status: AssetNodeStatusV5, error?: unknown): OutcomeV4<AssetNodeV5> {
    const node = this.#nodes.get(id);
    if (!node) return failV4(createRuntimeErrorV4('ASSET_GRAPH_UNKNOWN', 'Asset node is unknown', false));
    const next: AssetNodeV5 = { ...node, status, errorCount: error ? node.errorCount + 1 : node.errorCount };
    this.#nodes.set(id, next);
    return okV4(next);
  }

  invalidate(id: AssetIdV4, cascade = true): readonly AssetIdV4[] {
    const visited = new Set<AssetIdV4>();
    const visit = (current: AssetIdV4): void => {
      if (visited.has(current)) return;
      visited.add(current);
      const node = this.#nodes.get(current);
      if (!node) return;
      node.status = 'invalidated';
      node.generation += 1;
      this.#invalidations += 1;
      if (cascade) for (const dependent of node.dependents) visit(dependent);
    };
    visit(id);
    return Object.freeze([...visited].sort((a, b) => String(a).localeCompare(String(b))));
  }

  ready(id: AssetIdV4): boolean {
    const node = this.#nodes.get(id);
    if (!node || node.status === 'invalidated' || node.status === 'failed') return false;
    return node.dependencies.every((dependency) => {
      const dep = this.#nodes.get(dependency);
      return dep?.status === 'ready';
    });
  }

  canQueue(id: AssetIdV4): boolean {
    const node = this.#nodes.get(id);
    if (!node || node.status === 'ready' || node.status === 'loading') return false;
    if (node.status === 'failed' && node.errorCount >= 3) return false;
    const dependenciesReady = node.dependencies.every((dependency) => this.ready(dependency) || this.#nodes.get(dependency)?.optional);
    if (!dependenciesReady) { this.#blocked += 1; return false; }
    return true;
  }

  plan(required: readonly AssetIdV4[] = []): AssetPlanV5 {
    const roots = required.length ? [...required] : [...this.#nodes.values()].filter((node) => !node.optional).map((node) => node.id);
    const included = new Set<AssetIdV4>();
    const include = (id: AssetIdV4): void => {
      if (included.has(id)) return;
      const node = this.#nodes.get(id);
      if (!node) return;
      included.add(id);
      for (const dependency of node.dependencies) include(dependency);
    };
    roots.forEach(include);
    const cycles: AssetIdV4[][] = [];
    const state = new Map<AssetIdV4, 0 | 1 | 2>();
    const stack: AssetIdV4[] = [];
    const order: AssetIdV4[] = [];
    const visit = (id: AssetIdV4): void => {
      const marker = state.get(id) ?? 0;
      if (marker === 2) return;
      if (marker === 1) {
        const index = stack.indexOf(id);
        cycles.push(stack.slice(Math.max(0, index)));
        return;
      }
      state.set(id, 1);
      stack.push(id);
      const node = this.#nodes.get(id);
      const dependencies = node?.dependencies.slice().sort((a, b) => String(a).localeCompare(String(b))) ?? [];
      for (const dependency of dependencies) if (included.has(dependency)) visit(dependency);
      stack.pop();
      state.set(id, 2);
      order.push(id);
    };
    for (const id of [...included].sort((a, b) => String(a).localeCompare(String(b)))) visit(id);
    const critical = order.filter((id) => !this.#nodes.get(id)?.optional);
    const optional = order.filter((id) => this.#nodes.get(id)?.optional);
    const bytes = order.reduce((sum, id) => sum + (this.#nodes.get(id)?.bytes ?? 0), 0);
    return Object.freeze({ order: Object.freeze(order), critical: Object.freeze(critical), optional: Object.freeze(optional), bytes, cycles: Object.freeze(cycles.map((cycle) => Object.freeze(cycle))) });
  }

  topologicalReady(limit = 64): readonly AssetNodeV5[] {
    const plan = this.plan();
    const ready: AssetNodeV5[] = [];
    for (const id of plan.order) {
      if (ready.length >= limit) break;
      if (this.canQueue(id)) ready.push(this.#nodes.get(id)!);
    }
    ready.sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)));
    return Object.freeze(ready);
  }

  metrics(): AssetGraphMetricsV5 {
    let edges = 0, ready = 0, loading = 0, failed = 0, invalidated = 0;
    for (const node of this.#nodes.values()) { edges += node.dependencies.length; if (node.status === 'ready') ready += 1; if (node.status === 'loading') loading += 1; if (node.status === 'failed') failed += 1; if (node.status === 'invalidated') invalidated += 1; }
    const cycles = this.plan().cycles.length;
    return Object.freeze({ nodes: this.#nodes.size, edges, ready, loading, failed, invalidated, cycles, invalidations: this.#invalidations, blocked: this.#blocked });
  }

  nodes(): readonly AssetNodeV5[] { return Object.freeze([...this.#nodes.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))); }

  remove(id: AssetIdV4): boolean {
    if (!this.#nodes.delete(id)) return false;
    this.#rebuildDependents();
    return true;
  }

  clear(): void { this.#nodes.clear(); this.#invalidations = 0; this.#blocked = 0; }

  #rebuildDependents(): void {
    const dependents = new Map<AssetIdV4, AssetIdV4[]>();
    for (const node of this.#nodes.values()) for (const dependency of node.dependencies) { const list = dependents.get(dependency) ?? []; list.push(node.id); dependents.set(dependency, list); }
    for (const node of this.#nodes.values()) node.dependents = Object.freeze([...(dependents.get(node.id) ?? [])].sort((a, b) => String(a).localeCompare(String(b))));
  }
}

export function assetGraphNodeFromDescriptorV5(descriptor: AssetDescriptorV4): AssetNodeV5 {
  return { id: descriptor.id, kind: descriptor.kind as AssetNodeKindV5, bytes: Math.max(0, Math.trunc(descriptor.bytes)), priority: Math.trunc(descriptor.priority), optional: descriptor.optional, dependencies: Object.freeze([]), dependents: Object.freeze([]), digest: descriptor.digest, status: 'declared', generation: 1, errorCount: 0 };
}

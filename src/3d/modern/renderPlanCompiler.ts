import type { Disposable, EntityId, RendererBackend, RenderBudget } from './types';

export type RenderPlanPass = 'depth' | 'shadow' | 'opaque' | 'alpha' | 'water' | 'foliage' | 'effects' | 'transparent' | 'post' | 'ui';

export interface RenderPlanNode {
  readonly id: string;
  readonly pass: RenderPlanPass;
  readonly estimatedGpuMs: number;
  readonly estimatedDrawCalls: number;
  readonly optional: boolean;
  readonly requires: readonly string[];
  readonly execute: () => void | Promise<void>;
}

export interface CompiledRenderPlan {
  readonly nodes: readonly RenderPlanNode[];
  readonly enabledIds: readonly string[];
  readonly skippedIds: readonly string[];
  readonly estimatedGpuMs: number;
  readonly estimatedDrawCalls: number;
  readonly backend: RendererBackend;
  readonly signature: string;
}

export interface RenderPlanCompilerOptions {
  readonly backend: RendererBackend;
  readonly budget: RenderBudget;
}

/**
 * Dependency-aware render graph compiler.
 * Required passes always survive optional-pass shedding; missing dependencies
 * invalidate only the dependent optional node instead of poisoning the frame.
 */
export class RenderPlanCompiler implements Disposable {
  private readonly backend: RendererBackend;
  private budget: RenderBudget;
  private nodes = new Map<string, RenderPlanNode>();
  private disposed = false;

  public constructor(options: RenderPlanCompilerOptions) {
    this.backend = options.backend;
    this.budget = options.budget;
  }

  public setBudget(budget: RenderBudget): void { this.ensureActive(); this.budget = budget; }

  public register(node: RenderPlanNode): Disposable {
    this.ensureActive();
    if (!node.id || this.nodes.has(node.id)) throw new Error(`RENDER_NODE_REDEFINED:${node.id}`);
    this.nodes.set(node.id, { ...node, requires: [...node.requires] });
    return { dispose: () => this.nodes.delete(node.id) && undefined };
  }

  public compile(): CompiledRenderPlan {
    this.ensureActive();
    const ordered = this.topologicalOrder();
    const enabled = new Set<string>();
    const skipped = new Set<string>();
    let estimatedGpuMs = 0;
    let estimatedDrawCalls = 0;

    for (const node of ordered) {
      const dependencyReady = node.requires.every((dependency) => enabled.has(dependency));
      const withinBudget = estimatedGpuMs + Math.max(0, node.estimatedGpuMs) <= this.budget.gpuMs
        && estimatedDrawCalls + Math.max(0, node.estimatedDrawCalls) <= this.budget.drawCalls;
      if (dependencyReady && (!node.optional || withinBudget)) {
        enabled.add(node.id);
        estimatedGpuMs += Math.max(0, node.estimatedGpuMs);
        estimatedDrawCalls += Math.max(0, node.estimatedDrawCalls);
      } else {
        skipped.add(node.id);
      }
    }

    const signature = stableSignature(this.backend, this.budget, ordered, enabled);
    return {
      nodes: ordered,
      enabledIds: [...enabled],
      skippedIds: [...skipped],
      estimatedGpuMs,
      estimatedDrawCalls,
      backend: this.backend,
      signature,
    };
  }

  public async execute(plan = this.compile()): Promise<void> {
    this.ensureActive();
    for (const node of plan.nodes) {
      if (!plan.enabledIds.includes(node.id)) continue;
      await node.execute();
    }
  }

  public clear(): void { this.ensureActive(); this.nodes.clear(); }
  public size(): number { return this.nodes.size; }

  private topologicalOrder(): RenderPlanNode[] {
    const state = new Map<string, 0 | 1 | 2>();
    const result: RenderPlanNode[] = [];
    const visit = (id: string, stack: string[]): void => {
      const status = state.get(id) ?? 0;
      if (status === 2) return;
      if (status === 1) throw new Error(`RENDER_GRAPH_CYCLE:${[...stack, id].join('>')}`);
      const node = this.nodes.get(id);
      if (!node) throw new Error(`RENDER_DEPENDENCY_MISSING:${id}`);
      state.set(id, 1);
      for (const dependency of node.requires) visit(dependency, [...stack, id]);
      state.set(id, 2);
      result.push(node);
    };
    for (const node of this.nodes.values()) visit(node.id, []);
    return result;
  }

  private ensureActive(): void { if (this.disposed) throw new Error('RENDER_PLAN_COMPILER_DISPOSED'); }
  public dispose(): void { if (this.disposed) return; this.nodes.clear(); this.disposed = true; }
}

export interface MaterialVariantKey {
  readonly backend: RendererBackend;
  readonly features: readonly string[];
  readonly tier: string;
  readonly skinned: boolean;
  readonly instanced: boolean;
}

export interface MaterialVariant<T = unknown> {
  readonly key: MaterialVariantKey;
  readonly material: T;
  readonly estimatedBytes: number;
}

/** Small deterministic material-variant cache shared by WebGPU/WebGL2 adapters. */
export class MaterialVariantCache<T = unknown> implements Disposable {
  private readonly values = new Map<string, MaterialVariant<T>>();
  private disposed = false;
  private readonly maxEntries: number;

  public constructor(maxEntries = 256) { this.maxEntries = Math.max(8, Math.floor(maxEntries)); }
  public get(key: MaterialVariantKey): MaterialVariant<T> | undefined { this.ensureActive(); return this.values.get(keyFor(key)); }
  public set(variant: MaterialVariant<T>): void {
    this.ensureActive();
    const key = keyFor(variant.key);
    this.values.delete(key);
    this.values.set(key, variant);
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) this.values.delete(oldest);
      else break;
    }
  }
  public invalidate(predicate: (variant: MaterialVariant<T>) => boolean): number {
    let removed = 0;
    for (const [key, value] of this.values) if (predicate(value)) { this.values.delete(key); removed += 1; }
    return removed;
  }
  public size(): number { return this.values.size; }
  public clear(): void { this.values.clear(); }
  private ensureActive(): void { if (this.disposed) throw new Error('MATERIAL_CACHE_DISPOSED'); }
  public dispose(): void { if (this.disposed) return; this.clear(); this.disposed = true; }
}

const keyFor = (key: MaterialVariantKey): string => JSON.stringify({ ...key, features: [...key.features].sort() });
const stableSignature = (backend: RendererBackend, budget: RenderBudget, nodes: readonly RenderPlanNode[], enabled: Set<string>): string => {
  const input = JSON.stringify({ backend, budget, nodes: nodes.map((n) => ({ id: n.id, requires: [...n.requires].sort(), optional: n.optional })), enabled: [...enabled].sort() });
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export interface VisibilityCandidate { readonly id: EntityId; readonly distance: number; readonly radius: number; readonly importance: number; readonly castsShadow: boolean; readonly animated: boolean; }
export interface VisibilityPlan { readonly visible: readonly EntityId[]; readonly shadows: readonly EntityId[]; readonly animated: readonly EntityId[]; }

/** Unified visibility cap planner for foliage/fauna/props before GPU submission. */
export const planVisibility = (candidates: readonly VisibilityCandidate[], limits: { maxVisible: number; maxShadows: number; maxAnimated: number }): VisibilityPlan => {
  const sorted = [...candidates].sort((a, b) => (a.distance - b.distance) || (b.importance - a.importance) || a.id.localeCompare(b.id));
  const visible = sorted.slice(0, Math.max(0, limits.maxVisible)).map((entry) => entry.id);
  const shadowCandidates = sorted.filter((entry) => entry.castsShadow).slice(0, Math.max(0, limits.maxShadows)).map((entry) => entry.id);
  const animated = sorted.filter((entry) => entry.animated).slice(0, Math.max(0, limits.maxAnimated)).map((entry) => entry.id);
  return { visible, shadows: shadowCandidates, animated };
};

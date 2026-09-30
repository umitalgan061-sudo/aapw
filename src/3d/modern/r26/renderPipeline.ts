export type RenderPassKindR26 =
  | 'depth'
  | 'shadow'
  | 'opaque'
  | 'transparent'
  | 'post'
  | 'ui'
  | 'debug';

export type RenderPassStateR26 = 'declared' | 'ready' | 'disabled' | 'failed';

export interface RenderResourceR26 {
  readonly id: string;
  readonly kind: 'texture' | 'buffer' | 'target';
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly transient: boolean;
}

export interface RenderPassR26 {
  readonly id: string;
  readonly kind: RenderPassKindR26;
  readonly priority: number;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly dependsOn: readonly string[];
  readonly estimatedGpuMs: number;
  readonly estimatedCpuMs: number;
  readonly state: RenderPassStateR26;
  readonly allowReadWriteAlias?: boolean;
  readonly execute: (context: RenderPassContextR26) => void;
}

export interface RenderPassContextR26 {
  readonly frame: number;
  readonly backend: 'webgpu' | 'webgl2' | 'webgl' | 'none';
  readonly resources: ReadonlyMap<string, RenderResourceR26>;
  readonly debug: boolean;
}

export interface RenderPlanR26 {
  readonly frame: number;
  readonly passes: readonly RenderPassR26[];
  readonly resources: readonly RenderResourceR26[];
  readonly gpuEstimateMs: number;
  readonly cpuEstimateMs: number;
  readonly memoryBytes: number;
  readonly hazards: readonly string[];
  readonly digest: string;
}

export interface RenderBudgetR26 {
  readonly maxGpuMs: number;
  readonly maxCpuMs: number;
  readonly maxMemoryBytes: number;
  readonly maxPasses: number;
}

const clean = (value: string): string => value.trim().slice(0, 128);
const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

export class RenderPipelineR26 {
  readonly #passes = new Map<string, RenderPassR26>();
  readonly #resources = new Map<string, RenderResourceR26>();
  readonly #budget: RenderBudgetR26;
  #disposed = false;
  #lastPlan: RenderPlanR26 | null = null;

  constructor(budget: Partial<RenderBudgetR26> = {}) {
    this.#budget = Object.freeze({
      maxGpuMs: Math.max(1, finite(budget.maxGpuMs, 16)),
      maxCpuMs: Math.max(1, finite(budget.maxCpuMs, 8)),
      maxMemoryBytes: Math.max(1024 * 1024, Math.floor(finite(budget.maxMemoryBytes, 512 * 1024 * 1024))),
      maxPasses: Math.max(1, Math.floor(finite(budget.maxPasses, 128))),
    });
  }

  defineResource(resource: RenderResourceR26): void {
    this.#assertLive();
    const id = clean(resource.id);
    if (!id) throw new Error('R26_RENDER_RESOURCE_EMPTY');
    if (this.#resources.has(id)) throw new Error(`R26_RENDER_RESOURCE_DUPLICATE:${id}`);
    const normalized = Object.freeze({
      ...resource,
      id,
      width: Math.max(1, Math.floor(resource.width)),
      height: Math.max(1, Math.floor(resource.height)),
      bytes: Math.max(0, Math.floor(resource.bytes)),
      transient: resource.transient === true,
    });
    this.#resources.set(id, normalized);
    this.#lastPlan = null;
  }

  definePass(pass: RenderPassR26): void {
    this.#assertLive();
    const id = clean(pass.id);
    if (!id) throw new Error('R26_RENDER_PASS_EMPTY');
    if (this.#passes.has(id)) throw new Error(`R26_RENDER_PASS_DUPLICATE:${id}`);
    const normalized = Object.freeze({
      ...pass,
      id,
      priority: Math.floor(finite(pass.priority)),
      reads: Object.freeze([...new Set(pass.reads.map(clean).filter(Boolean))].sort()),
      writes: Object.freeze([...new Set(pass.writes.map(clean).filter(Boolean))].sort()),
      dependsOn: Object.freeze([...new Set(pass.dependsOn.map(clean).filter(Boolean))].sort()),
      estimatedGpuMs: Math.max(0, finite(pass.estimatedGpuMs)),
      estimatedCpuMs: Math.max(0, finite(pass.estimatedCpuMs)),
      state: pass.state ?? 'declared',
      allowReadWriteAlias: pass.allowReadWriteAlias === true,
    });
    this.#passes.set(id, normalized);
    this.#lastPlan = null;
  }

  setPassState(id: string, state: RenderPassStateR26): boolean {
    const current = this.#passes.get(clean(id));
    if (!current) return false;
    this.#passes.set(current.id, Object.freeze({ ...current, state }));
    this.#lastPlan = null;
    return true;
  }

  compile(frame = 0): RenderPlanR26 {
    this.#assertLive();
    const hazards: string[] = [];
    const resources = [...this.#resources.values()].sort((a, b) => a.id.localeCompare(b.id));
    const resourceIds = new Set(resources.map((resource) => resource.id));

    for (const pass of this.#passes.values()) {
      for (const read of pass.reads) {
        if (!resourceIds.has(read)) hazards.push(`${pass.id}:missing-read:${read}`);
      }
      for (const write of pass.writes) {
        if (!resourceIds.has(write)) hazards.push(`${pass.id}:missing-write:${write}`);
      }
      for (const dependency of pass.dependsOn) {
        if (!this.#passes.has(dependency)) hazards.push(`${pass.id}:missing-dependency:${dependency}`);
      }
      const overlap = pass.reads.filter((id) => pass.writes.includes(id));
      if (overlap.length) hazards.push(`${pass.id}:read-write-alias:${overlap.join(',')}`);
    }

    hazards.push(...this.#detectCycles());
    hazards.push(...this.#detectWriteConflicts());

    const passes = this.#topologicalPasses().filter((pass) => pass.state === 'ready' || pass.state === 'declared');
    if (passes.length > this.#budget.maxPasses) hazards.push('pass-count-budget');

    const gpuEstimateMs = passes.reduce((sum, pass) => sum + pass.estimatedGpuMs, 0);
    const cpuEstimateMs = passes.reduce((sum, pass) => sum + pass.estimatedCpuMs, 0);
    const memoryBytes = resources.reduce((sum, resource) => sum + resource.bytes, 0);

    if (gpuEstimateMs > this.#budget.maxGpuMs) hazards.push('gpu-budget');
    if (cpuEstimateMs > this.#budget.maxCpuMs) hazards.push('cpu-budget');
    if (memoryBytes > this.#budget.maxMemoryBytes) hazards.push('memory-budget');

    const normalizedHazards = Object.freeze([...new Set(hazards)].sort());
    const payload = {
      frame,
      passes,
      resources,
      gpuEstimateMs,
      cpuEstimateMs,
      memoryBytes,
      hazards: normalizedHazards,
    };
    this.#lastPlan = Object.freeze({
      ...payload,
      digest: this.#digest(payload),
    });
    return this.#lastPlan;
  }

  execute(options: {
    frame: number;
    backend: RenderPassContextR26['backend'];
    debug?: boolean;
    onError?: (pass: RenderPassR26, error: unknown) => void;
  }): readonly RenderPassR26[] {
    const plan = this.compile(options.frame);
    const resourceMap = new Map(this.#resources.entries());
    const executed: RenderPassR26[] = [];
    for (const pass of plan.passes) {
      if (pass.state === 'disabled') continue;
      try {
        pass.execute({
          frame: options.frame,
          backend: options.backend,
          resources: resourceMap,
          debug: options.debug === true,
        });
        executed.push(pass);
      } catch (error) {
        this.setPassState(pass.id, 'failed');
        options.onError?.(pass, error);
      }
    }
    return Object.freeze(executed);
  }

  lastPlan(): RenderPlanR26 | null {
    return this.#lastPlan;
  }

  pass(id: string): RenderPassR26 | undefined {
    return this.#passes.get(clean(id));
  }

  resource(id: string): RenderResourceR26 | undefined {
    return this.#resources.get(clean(id));
  }

  stats(): Readonly<{
    passes: number;
    resources: number;
    lastGpuEstimateMs: number;
    lastCpuEstimateMs: number;
    memoryBytes: number;
    hazards: number;
  }> {
    return Object.freeze({
      passes: this.#passes.size,
      resources: this.#resources.size,
      lastGpuEstimateMs: this.#lastPlan?.gpuEstimateMs ?? 0,
      lastCpuEstimateMs: this.#lastPlan?.cpuEstimateMs ?? 0,
      memoryBytes: this.#lastPlan?.memoryBytes ?? 0,
      hazards: this.#lastPlan?.hazards.length ?? 0,
    });
  }

  reset(): void {
    this.#passes.clear();
    this.#resources.clear();
    this.#lastPlan = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.reset();
  }

  #topologicalPasses(): readonly RenderPassR26[] {
    const remaining = new Map(this.#passes);
    const result: RenderPassR26[] = [];
    const completed = new Set<string>();

    while (remaining.size) {
      const ready = [...remaining.values()]
        .filter((pass) => pass.dependsOn.every((id) => completed.has(id)))
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

      if (!ready.length) break;
      for (const pass of ready) {
        remaining.delete(pass.id);
        completed.add(pass.id);
        result.push(pass);
      }
    }

    return Object.freeze(result);
  }

  #detectCycles(): readonly string[] {
    const failures: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (id: string): void => {
      if (visiting.has(id)) {
        failures.push(`cycle:${id}`);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      const pass = this.#passes.get(id);
      for (const dependency of pass?.dependsOn ?? []) {
        if (this.#passes.has(dependency)) visit(dependency);
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const id of this.#passes.keys()) visit(id);
    return Object.freeze([...new Set(failures)]);
  }

  #detectWriteConflicts(): readonly string[] {
    const owners = new Map<string, string>();
    const conflicts: string[] = [];
    for (const pass of [...this.#passes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const resource of pass.writes) {
        const owner = owners.get(resource);
        if (owner && !pass.dependsOn.includes(owner) && !this.#passes.get(owner)?.dependsOn.includes(pass.id)) {
          conflicts.push(`write-conflict:${resource}:${owner}:${pass.id}`);
        } else {
          owners.set(resource, pass.id);
        }
      }
    }
    return Object.freeze(conflicts);
  }

  #digest(payload: unknown): string {
    let hash = 2166136261;
    const text = JSON.stringify(payload);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R26_RENDER_DISPOSED');
  }
}

export const createStandardR26RenderPipeline = (): RenderPipelineR26 => {
  const pipeline = new RenderPipelineR26({
    maxGpuMs: 16.67,
    maxCpuMs: 8,
    maxMemoryBytes: 768 * 1024 * 1024,
    maxPasses: 32,
  });

  pipeline.defineResource({
    id: 'depth',
    kind: 'texture',
    width: 1920,
    height: 1080,
    bytes: 1920 * 1080 * 4,
    transient: true,
  });

  pipeline.defineResource({
    id: 'shadow',
    kind: 'target',
    width: 2048,
    height: 2048,
    bytes: 2048 * 2048 * 4,
    transient: true,
  });

  pipeline.defineResource({
    id: 'color',
    kind: 'target',
    width: 1920,
    height: 1080,
    bytes: 1920 * 1080 * 8,
    transient: false,
  });

  pipeline.definePass({
    id: 'depth-prepass',
    kind: 'depth',
    priority: 100,
    reads: [],
    writes: ['depth'],
    dependsOn: [],
    estimatedGpuMs: 1.2,
    estimatedCpuMs: 0.4,
    state: 'ready',
    execute: () => undefined,
  });

  pipeline.definePass({
    id: 'shadow-pass',
    kind: 'shadow',
    priority: 90,
    reads: ['depth'],
    writes: ['shadow'],
    dependsOn: ['depth-prepass'],
    estimatedGpuMs: 2.2,
    estimatedCpuMs: 0.5,
    state: 'ready',
    execute: () => undefined,
  });

  pipeline.definePass({
    id: 'opaque-pass',
    kind: 'opaque',
    priority: 80,
    reads: ['depth', 'shadow'],
    writes: ['color'],
    dependsOn: ['depth-prepass', 'shadow-pass'],
    estimatedGpuMs: 5.2,
    estimatedCpuMs: 1.6,
    state: 'ready',
    execute: () => undefined,
  });

  pipeline.definePass({
    id: 'transparent-pass',
    kind: 'transparent',
    priority: 70,
    reads: ['depth', 'color'],
    writes: ['color'],
    dependsOn: ['opaque-pass'],
    estimatedGpuMs: 1.8,
    estimatedCpuMs: 0.8,
    state: 'ready',
    allowReadWriteAlias: true,
    execute: () => undefined,
  });

  pipeline.definePass({
    id: 'post-pass',
    kind: 'post',
    priority: 60,
    reads: ['color'],
    writes: ['color'],
    dependsOn: ['transparent-pass'],
    estimatedGpuMs: 1.6,
    estimatedCpuMs: 0.7,
    state: 'ready',
    allowReadWriteAlias: true,
    execute: () => undefined,
  });

  pipeline.definePass({
    id: 'ui-pass',
    kind: 'ui',
    priority: 20,
    reads: ['color'],
    writes: ['color'],
    dependsOn: ['post-pass'],
    estimatedGpuMs: 0.8,
    estimatedCpuMs: 0.6,
    state: 'ready',
    allowReadWriteAlias: true,
    execute: () => undefined,
  });

  return pipeline;
};

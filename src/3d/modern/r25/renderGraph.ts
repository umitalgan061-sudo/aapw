import type {
  BackendKind,
  PassId,
  RenderGraphPlan,
  RenderPassDescriptor,
  RenderPassExecutionContext,
  RenderResourceDescriptor,
  ResourceId,
} from './contracts.ts';

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function identifier<T extends string>(value: T): T {
  const normalized = value.trim();
  if (!normalized) throw new Error('R25_GRAPH_EMPTY_ID');
  return normalized as T;
}

export class RenderGraphR25 {
  readonly #resources = new Map<ResourceId, RenderResourceDescriptor>();
  readonly #passes = new Map<PassId, RenderPassDescriptor>();
  #compiled: RenderGraphPlan | null = null;
  #generation = 0;

  public get generation(): number {
    return this.#generation;
  }

  public addResource(resource: RenderResourceDescriptor): void {
    const id = identifier(resource.id);
    if (this.#resources.has(id)) throw new Error(`R25_DUPLICATE_RESOURCE:${id}`);
    if (resource.width < 1 || resource.height < 1) throw new Error(`R25_RESOURCE_SIZE:${id}`);
    if (resource.bytesPerPixel < 1) throw new Error(`R25_RESOURCE_BPP:${id}`);
    if (resource.samples < 1) throw new Error(`R25_RESOURCE_SAMPLES:${id}`);
    this.#resources.set(id, freeze({ ...resource, id }));
    this.#invalidate();
  }

  public addPass(pass: RenderPassDescriptor): void {
    const id = identifier(pass.id);
    if (this.#passes.has(id)) throw new Error(`R25_DUPLICATE_PASS:${id}`);

    const normalized = freeze({
      ...pass,
      id,
      name: pass.name.trim() || id,
      reads: freeze([...new Set(pass.reads.map(identifier))]),
      writes: freeze([...new Set(pass.writes.map(identifier))]),
      estimatedGpuMs: Math.max(0, finite(pass.estimatedGpuMs)),
      enabled: pass.enabled !== false,
    });

    this.#validatePass(normalized);
    this.#passes.set(id, normalized);
    this.#invalidate();
  }

  public updatePass(id: PassId, patch: Partial<Omit<RenderPassDescriptor, 'id'>>): boolean {
    const current = this.#passes.get(id);
    if (!current) return false;

    const updated = freeze({
      ...current,
      ...patch,
      id,
      reads: freeze([...(patch.reads ?? current.reads)].map(identifier)),
      writes: freeze([...(patch.writes ?? current.writes)].map(identifier)),
      enabled: patch.enabled ?? current.enabled ?? true,
      estimatedGpuMs: Math.max(0, finite(patch.estimatedGpuMs ?? current.estimatedGpuMs)),
    });

    this.#validatePass(updated);
    this.#passes.set(id, updated);
    this.#invalidate();
    return true;
  }

  public removePass(id: PassId): boolean {
    const removed = this.#passes.delete(id);
    if (removed) this.#invalidate();
    return removed;
  }

  public removeResource(id: ResourceId): boolean {
    const removed = this.#resources.delete(id);
    if (!removed) return false;

    for (const [passId, pass] of this.#passes) {
      if (pass.reads.includes(id) || pass.writes.includes(id)) {
        this.#passes.set(passId, freeze({
          ...pass,
          reads: freeze(pass.reads.filter((resource) => resource !== id)),
          writes: freeze(pass.writes.filter((resource) => resource !== id)),
        }));
      }
    }
    this.#invalidate();
    return true;
  }

  public compile(): RenderGraphPlan {
    if (this.#compiled) return this.#compiled;

    const active = [...this.#passes.values()]
      .filter((pass) => pass.enabled !== false)
      .sort((a, b) => a.id.localeCompare(b.id));

    const hazards: string[] = [];
    const dependencies = new Map<PassId, Set<PassId>>();

    for (const pass of active) {
      dependencies.set(pass.id, new Set());

      for (const id of pass.reads) {
        if (!this.#resources.has(id)) hazards.push(`missing-read-resource:${pass.id}:${id}`);
      }

      for (const id of pass.writes) {
        if (!this.#resources.has(id)) hazards.push(`missing-write-resource:${pass.id}:${id}`);
      }

      const duplicates = pass.writes.filter((id) => pass.reads.includes(id));
      for (const id of duplicates) {
        const resource = this.#resources.get(id);
        if (resource?.kind === 'depth') {
          hazards.push(`depth-read-write:${pass.id}:${id}`);
        }
      }
    }

    for (let i = 0; i < active.length; i += 1) {
      const first = active[i]!;
      for (let j = i + 1; j < active.length; j += 1) {
        const second = active[j]!;
        const overlap = this.#overlap(first, second);
        if (overlap.size === 0) continue;

        const firstWrites = [...overlap].some((id) => first.writes.includes(id));
        const secondWrites = [...overlap].some((id) => second.writes.includes(id));

        if (!firstWrites && !secondWrites) continue;

        if (firstWrites && secondWrites) {
          dependencies.get(second.id)?.add(first.id);
        } else if (firstWrites) {
          dependencies.get(second.id)?.add(first.id);
        } else {
          dependencies.get(first.id)?.add(second.id);
        }
      }
    }

    const ordered = this.#order(active, dependencies, hazards);
    const resources = [...this.#resources.values()].sort((a, b) => a.id.localeCompare(b.id));
    const transient = resources.filter((resource) => resource.transient).map((resource) => resource.id);
    const gpuEstimateMs = ordered.reduce((sum, pass) => sum + Math.max(0, pass.estimatedGpuMs), 0);

    this.#compiled = freeze({
      passes: freeze(ordered),
      resources: freeze(resources),
      transientResources: freeze(transient),
      gpuEstimateMs: Number(gpuEstimateMs.toFixed(4)),
      dependencies: freeze(Object.fromEntries(
        [...dependencies.entries()].map(([id, deps]) => [id, freeze([...deps].sort())]),
      )) as Readonly<Record<PassId, readonly PassId[]>>,
      hazards: freeze([...new Set(hazards)].sort()),
    });

    return this.#compiled;
  }

  public execute(options: {
    readonly frame: number;
    readonly backend: BackendKind;
    readonly debug?: boolean;
    readonly onError?: (pass: RenderPassDescriptor, error: unknown) => void;
  }): readonly PassId[] {
    const plan = this.compile();
    const executed: PassId[] = [];

    for (const pass of plan.passes) {
      const context: RenderPassExecutionContext = freeze({
        frame: Math.max(0, Math.trunc(options.frame)),
        backend: options.backend,
        getResource: (id) => this.#resources.get(id),
        debug: options.debug === true,
      });

      try {
        pass.execute(context);
        executed.push(pass.id);
      } catch (error) {
        options.onError?.(pass, error);
        if (options.debug) throw error;
      }
    }

    return freeze(executed);
  }

  public resourceBytes(): number {
    return [...this.#resources.values()].reduce(
      (sum, resource) => sum + resource.width * resource.height * resource.bytesPerPixel * resource.samples,
      0,
    );
  }

  public explain(): string {
    const plan = this.compile();
    const lines = [
      'AAPW Runtime R25 RenderGraph',
      `generation=${this.#generation}`,
      `passes=${plan.passes.length}`,
      `resources=${plan.resources.length}`,
      `transient=${plan.transientResources.length}`,
      `gpuEstimateMs=${plan.gpuEstimateMs.toFixed(3)}`,
    ];

    for (const pass of plan.passes) {
      const dependencies = plan.dependencies[pass.id] ?? [];
      lines.push(
        `${pass.id} | read:${pass.reads.join(',')} | write:${pass.writes.join(',')} | deps:${dependencies.join(',')}`,
      );
    }

    if (plan.hazards.length > 0) {
      lines.push('hazards=' + plan.hazards.join('|'));
    }

    return lines.join('\n');
  }

  public reset(): void {
    this.#invalidate();
  }

  #invalidate(): void {
    this.#generation += 1;
    this.#compiled = null;
  }

  #validatePass(pass: RenderPassDescriptor): void {
    if (typeof pass.execute !== 'function') {
      throw new Error(`R25_PASS_EXECUTOR_MISSING:${pass.id}`);
    }

    for (const id of [...pass.reads, ...pass.writes]) {
      identifier(id);
    }

    if (pass.estimatedGpuMs < 0 || !Number.isFinite(pass.estimatedGpuMs)) {
      throw new Error(`R25_PASS_ESTIMATE_INVALID:${pass.id}`);
    }
  }

  #overlap(
    first: RenderPassDescriptor,
    second: RenderPassDescriptor,
  ): Set<ResourceId> {
    const overlap = new Set<ResourceId>();
    for (const id of [...first.reads, ...first.writes]) {
      if (second.reads.includes(id) || second.writes.includes(id)) overlap.add(id);
    }
    return overlap;
  }

  #order(
    passes: readonly RenderPassDescriptor[],
    dependencies: ReadonlyMap<PassId, ReadonlySet<PassId>>,
    hazards: string[],
  ): RenderPassDescriptor[] {
    const pending = new Map<PassId, Set<PassId>>();
    const byId = new Map<PassId, RenderPassDescriptor>();

    for (const pass of passes) {
      pending.set(pass.id, new Set(dependencies.get(pass.id) ?? []));
      byId.set(pass.id, pass);
    }

    const result: RenderPassDescriptor[] = [];

    while (pending.size > 0) {
      const ready = [...pending.entries()]
        .filter(([, deps]) => deps.size === 0)
        .map(([id]) => id)
        .sort();

      if (ready.length === 0) {
        hazards.push('render-graph-cycle');
        return [...passes];
      }

      for (const id of ready) {
        const pass = byId.get(id);
        if (!pass) continue;
        result.push(pass);
        pending.delete(id);
        for (const deps of pending.values()) deps.delete(id);
      }
    }

    return result;
  }
}

export function textureResource(
  id: string,
  options: {
    readonly width: number;
    readonly height: number;
    readonly format?: string;
    readonly bytesPerPixel?: number;
    readonly transient?: boolean;
    readonly samples?: number;
  },
): RenderResourceDescriptor {
  return freeze({
    id: identifier(id) as ResourceId,
    kind: 'texture',
    width: Math.max(1, Math.trunc(options.width)),
    height: Math.max(1, Math.trunc(options.height)),
    format: options.format ?? 'rgba16float',
    bytesPerPixel: Math.max(1, Math.trunc(options.bytesPerPixel ?? 8)),
    transient: options.transient ?? true,
    samples: Math.max(1, Math.trunc(options.samples ?? 1)),
  });
}

export function depthResource(
  id: string,
  options: { readonly width: number; readonly height: number; readonly transient?: boolean; readonly samples?: number } ,
): RenderResourceDescriptor {
  return freeze({
    id: identifier(id) as ResourceId,
    kind: 'depth',
    width: Math.max(1, Math.trunc(options.width)),
    height: Math.max(1, Math.trunc(options.height)),
    format: 'depth24plus',
    bytesPerPixel: 4,
    transient: options.transient ?? true,
    samples: Math.max(1, Math.trunc(options.samples ?? 1)),
  });
}

export function historyResource(
  id: string,
  options: { readonly width: number; readonly height: number; readonly format?: string },
): RenderResourceDescriptor {
  return freeze({
    id: identifier(id) as ResourceId,
    kind: 'history',
    width: Math.max(1, Math.trunc(options.width)),
    height: Math.max(1, Math.trunc(options.height)),
    format: options.format ?? 'rgba16float',
    bytesPerPixel: 8,
    transient: false,
    samples: 1,
  });
}

export function bufferResource(
  id: string,
  bytes: number,
  options: { readonly transient?: boolean; readonly format?: string } = {},
): RenderResourceDescriptor {
  return freeze({
    id: identifier(id) as ResourceId,
    kind: 'buffer',
    width: Math.max(1, Math.trunc(bytes)),
    height: 1,
    format: options.format ?? 'storage',
    bytesPerPixel: 1,
    transient: options.transient ?? true,
    samples: 1,
  });
}

export function renderPass(
  id: string,
  input: Omit<RenderPassDescriptor, 'id'>,
): RenderPassDescriptor {
  return freeze({
    ...input,
    id: identifier(id) as PassId,
    name: input.name.trim() || id,
    reads: freeze([...new Set(input.reads.map(identifier))]),
    writes: freeze([...new Set(input.writes.map(identifier))]),
    estimatedGpuMs: Math.max(0, finite(input.estimatedGpuMs)),
    enabled: input.enabled !== false,
  });
}

export function buildStandardR25Graph(
  width: number,
  height: number,
  options: { readonly enableTemporalHistory?: boolean; readonly shadowScale?: number } = {},
): RenderGraphR25 {
  const graph = new RenderGraphR25();
  const w = Math.max(1, Math.trunc(width));
  const h = Math.max(1, Math.trunc(height));
  const shadowScale = Math.max(0.25, Math.min(1, finite(options.shadowScale, 1)));

  graph.addResource(textureResource('r25.gbuffer.albedo', { width: w, height: h, format: 'rgba8unorm', bytesPerPixel: 4 }));
  graph.addResource(textureResource('r25.gbuffer.normal', { width: w, height: h, format: 'rgba16float', bytesPerPixel: 8 }));
  graph.addResource(depthResource('r25.depth', { width: w, height: h }));
  graph.addResource(textureResource('r25.lighting', { width: w, height: h, format: 'rgba16float', bytesPerPixel: 8 }));
  graph.addResource(textureResource('r25.output', { width: w, height: h, format: 'rgba8unorm', bytesPerPixel: 4, transient: false }));
  graph.addResource(textureResource('r25.shadow', { width: Math.max(256, Math.trunc(4096 * shadowScale)), height: Math.max(256, Math.trunc(4096 * shadowScale)), format: 'depth24plus', bytesPerPixel: 4 }));
  if (options.enableTemporalHistory) {
    graph.addResource(historyResource('r25.history', { width: w, height: h }));
  }

  graph.addPass(renderPass('r25.shadow', {
    name: 'shadow',
    reads: [],
    writes: ['r25.shadow'],
    estimatedGpuMs: 1.5,
    execute: () => undefined,
  }));

  graph.addPass(renderPass('r25.geometry', {
    name: 'geometry',
    reads: ['r25.shadow'],
    writes: ['r25.gbuffer.albedo', 'r25.gbuffer.normal', 'r25.depth'],
    estimatedGpuMs: 4.2,
    execute: () => undefined,
  }));

  graph.addPass(renderPass('r25.lighting', {
    name: 'lighting',
    reads: ['r25.gbuffer.albedo', 'r25.gbuffer.normal', 'r25.depth', 'r25.shadow'],
    writes: ['r25.lighting'],
    estimatedGpuMs: 2.8,
    execute: () => undefined,
  }));

  if (options.enableTemporalHistory) {
    graph.addPass(renderPass('r25.temporal', {
      name: 'temporal',
      reads: ['r25.lighting', 'r25.history'],
      writes: ['r25.history'],
      estimatedGpuMs: 0.9,
      execute: () => undefined,
    }));
    graph.addPass(renderPass('r25.tonemap', {
      name: 'tonemap',
      reads: ['r25.history'],
      writes: ['r25.output'],
      estimatedGpuMs: 0.8,
      execute: () => undefined,
    }));
  } else {
    graph.addPass(renderPass('r25.tonemap', {
      name: 'tonemap',
      reads: ['r25.lighting'],
      writes: ['r25.output'],
      estimatedGpuMs: 0.8,
      execute: () => undefined,
    }));
  }

  return graph;
}

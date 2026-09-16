import type { RenderPassKind, Result } from './types';

export interface FrameResource {
  readonly id: string;
  readonly transient: boolean;
  readonly bytes: number;
  readonly format: string;
  readonly samples: 1 | 2 | 4 | 8;
}

export interface FramePass {
  readonly id: string;
  readonly kind: RenderPassKind;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly estimatedGpuMs: number;
  readonly optional?: boolean;
}

export interface CompiledPass {
  readonly index: number;
  readonly pass: FramePass;
  readonly dependencies: readonly string[];
  readonly barriers: readonly string[];
}

export interface FrameGraphPlan {
  readonly passes: readonly CompiledPass[];
  readonly resources: readonly FrameResource[];
  readonly peakTransientBytes: number;
  readonly estimatedGpuMs: number;
}

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }

/** Declarative frame graph compiler with dependency ordering and transient lifetime analysis. */
export class FrameGraphBuilder {
  #resources = new Map<string, FrameResource>();
  #passes = new Map<string, FramePass>();

  resource(resource: FrameResource): this {
    if (!resource.id || resource.bytes < 0) throw new TypeError('Invalid frame resource');
    this.#resources.set(resource.id, { ...resource });
    return this;
  }

  pass(pass: FramePass): this {
    if (!pass.id || this.#passes.has(pass.id)) throw new TypeError(`Invalid or duplicate frame pass ${pass.id}`);
    if (!Number.isFinite(pass.estimatedGpuMs) || pass.estimatedGpuMs < 0) throw new TypeError('Invalid pass GPU estimate');
    this.#passes.set(pass.id, { ...pass, reads: [...pass.reads], writes: [...pass.writes] });
    return this;
  }

  compile(): Result<FrameGraphPlan> {
    const passes = [...this.#passes.values()];
    const resourceIds = new Set(this.#resources.keys());
    for (const pass of passes) {
      for (const id of [...pass.reads, ...pass.writes]) {
        if (!resourceIds.has(id)) return { ok: false, error: { code: 'FRAME_RESOURCE_UNKNOWN', message: `${pass.id} references ${id}`, retryable: false } };
      }
    }

    const producedBy = new Map<string, string>();
    for (const pass of passes) for (const id of pass.writes) producedBy.set(id, pass.id);
    const dependencies = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();
    for (const pass of passes) {
      dependencies.set(pass.id, new Set());
      dependents.set(pass.id, new Set());
    }
    for (const pass of passes) {
      for (const resource of pass.reads) {
        const producer = producedBy.get(resource);
        if (producer && producer !== pass.id) {
          dependencies.get(pass.id)!.add(producer);
          dependents.get(producer)!.add(pass.id);
        }
      }
      for (const resource of pass.writes) {
        const prior = producedBy.get(resource);
        if (prior && prior !== pass.id) {
          dependencies.get(pass.id)!.add(prior);
          dependents.get(prior)!.add(pass.id);
        }
      }
    }

    const ready = passes.filter((pass) => dependencies.get(pass.id)!.size === 0).map((pass) => pass.id);
    const ordered: string[] = [];
    while (ready.length) {
      ready.sort((a, b) => a.localeCompare(b));
      const id = ready.shift()!;
      ordered.push(id);
      for (const child of dependents.get(id)!) {
        const deps = dependencies.get(child)!;
        deps.delete(id);
        if (deps.size === 0) ready.push(child);
      }
    }
    if (ordered.length !== passes.length) {
      return { ok: false, error: { code: 'FRAME_GRAPH_CYCLE', message: 'Render pass dependency cycle detected', retryable: false } };
    }

    const byId = new Map(passes.map((pass) => [pass.id, pass]));
    const compiled = ordered.map((id, index) => ({
      index,
      pass: byId.get(id)!,
      dependencies: unique([...this.#dependencyList(id, passes)]).sort(),
      barriers: unique([
        ...byId.get(id)!.reads.map((resource) => `read:${resource}`),
        ...byId.get(id)!.writes.map((resource) => `write:${resource}`),
      ]).sort(),
    }));

    return { ok: true, value: {
      passes: compiled,
      resources: [...this.#resources.values()].sort((a, b) => a.id.localeCompare(b.id)),
      peakTransientBytes: this.#peakTransientBytes(ordered, byId),
      estimatedGpuMs: compiled.reduce((sum, item) => sum + item.pass.estimatedGpuMs, 0),
    } };
  }

  #dependencyList(id: string, passes: readonly FramePass[]): string[] {
    const pass = passes.find((candidate) => candidate.id === id)!;
    const dependencies: string[] = [];
    for (const other of passes) {
      if (other.id === id) continue;
      const overlap = other.writes.some((resource) => pass.reads.includes(resource) || pass.writes.includes(resource));
      if (overlap) dependencies.push(other.id);
    }
    return dependencies;
  }

  #peakTransientBytes(ordered: readonly string[], byId: ReadonlyMap<string, FramePass>): number {
    const life = new Map<string, { first: number; last: number }>();
    for (let index = 0; index < ordered.length; index += 1) {
      const pass = byId.get(ordered[index]!)!;
      for (const resourceId of [...pass.reads, ...pass.writes]) {
        const resource = this.#resources.get(resourceId)!;
        if (!resource.transient) continue;
        const existing = life.get(resourceId);
        if (!existing) life.set(resourceId, { first: index, last: index });
        else existing.last = index;
      }
    }
    let peak = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      let live = 0;
      for (const [resourceId, range] of life) {
        if (index < range.first || index > range.last) continue;
        live += this.#resources.get(resourceId)?.bytes ?? 0;
      }
      peak = Math.max(peak, live);
    }
    return peak;
  }
}

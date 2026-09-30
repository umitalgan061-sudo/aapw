import { clampR29, type R29Backend, type R29QualityDecision, type R29RenderObservation, type R29RenderPass, type R29RenderPlan, type R29QualityTier } from './contracts.ts';

export interface R29RenderBackendAdapter {
  readonly backend: R29Backend;
  readonly available: boolean;
  readonly initialize?: () => void | Promise<void>;
  readonly dispose?: () => void;
}

export interface R29RenderCoordinatorOptions {
  readonly preferredBackend?: R29Backend;
  readonly adapters?: readonly R29RenderBackendAdapter[];
  readonly tier?: R29QualityTier;
  readonly passes?: readonly R29RenderPass[];
}

const DEFAULT_PASSES: readonly R29RenderPass[] = Object.freeze([
  { id: 'depth-prepass', phase: 'render', costMs: 0.7, gpuCostMs: 0.8, priority: 100, optional: false, dependencies: [] },
  { id: 'terrain', phase: 'render', costMs: 1.9, gpuCostMs: 2.2, priority: 95, optional: false, dependencies: ['depth-prepass'] },
  { id: 'world-opaque', phase: 'render', costMs: 1.4, gpuCostMs: 1.7, priority: 90, optional: false, dependencies: ['terrain'] },
  { id: 'vegetation', phase: 'render', costMs: 1.1, gpuCostMs: 1.3, priority: 70, optional: true, dependencies: ['world-opaque'] },
  { id: 'characters', phase: 'render', costMs: 1.25, gpuCostMs: 1.4, priority: 88, optional: false, dependencies: ['world-opaque'] },
  { id: 'transparent', phase: 'render', costMs: 0.9, gpuCostMs: 1.1, priority: 55, optional: true, dependencies: ['characters'] },
  { id: 'post-processing', phase: 'render', costMs: 1.2, gpuCostMs: 1.5, priority: 40, optional: true, dependencies: ['transparent'] },
  { id: 'ui', phase: 'render', costMs: 0.35, gpuCostMs: 0.25, priority: 110, optional: false, dependencies: [] },
]);

export class R29RenderCoordinator {
  #adapters: readonly R29RenderBackendAdapter[];
  #backend: R29Backend = 'headless';
  #tier: R29QualityTier;
  #passes: readonly R29RenderPass[];
  #plan: R29RenderPlan;
  #initialized = false;

  constructor(options: R29RenderCoordinatorOptions = {}) {
    this.#adapters = Object.freeze([...(options.adapters ?? [])]);
    this.#tier = options.tier ?? 'high';
    this.#passes = Object.freeze([...(options.passes ?? DEFAULT_PASSES)]);
    this.#backend = this.#selectBackend(options.preferredBackend);
    this.#plan = this.#compilePlan({ includeOptional: true });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    const adapter = this.#adapters.find((candidate) => candidate.backend === this.#backend && candidate.available);
    await adapter?.initialize?.();
    this.#initialized = true;
    this.#plan = this.#compilePlan({ includeOptional: true });
  }

  setTier(tier: R29QualityTier): R29RenderPlan {
    this.#tier = tier;
    this.#plan = this.#compilePlan({ includeOptional: tier !== 'safe' });
    return this.#plan;
  }

  selectBackend(preferred?: R29Backend): R29Backend {
    const next = this.#selectBackend(preferred);
    if (next !== this.#backend) {
      const previous = this.#backend;
      this.#adapters.find((adapter) => adapter.backend === previous)?.dispose?.();
      this.#backend = next;
    }
    this.#plan = this.#compilePlan({ includeOptional: this.#tier !== 'safe' });
    return this.#backend;
  }

  observe(observation: R29RenderObservation): R29RenderPlan {
    const framePressure = observation.frameMs / 16.67;
    const gpuPressure = observation.gpuMs / 8;
    const memoryPressure = (observation.textureBytes + observation.geometryBytes) / (768 * 1024 * 1024);
    const includeOptional = framePressure < 1.05 && gpuPressure < 1.05 && memoryPressure < 0.9 && this.#tier !== 'safe';
    this.#plan = this.#compilePlan({ includeOptional });
    return this.#plan;
  }

  plan(): R29RenderPlan {
    return this.#plan;
  }

  dispose(): void {
    this.#adapters.find((adapter) => adapter.backend === this.#backend)?.dispose?.();
    this.#initialized = false;
    this.#backend = 'headless';
    this.#plan = this.#compilePlan({ includeOptional: false });
  }

  #selectBackend(preferred?: R29Backend): R29Backend {
    const candidates = [
      preferred,
      'webgpu',
      'webgl2',
      'webgl1',
      'headless',
    ].filter((value): value is R29Backend => value !== undefined);
    for (const backend of candidates) {
      const adapter = this.#adapters.find((candidate) => candidate.backend === backend);
      if (adapter?.available) return backend;
      if (backend === 'headless' && !adapter) return 'headless';
    }
    return 'headless';
  }

  #compilePlan(options: { readonly includeOptional: boolean }): R29RenderPlan {
    const active = this.#passes
      .filter((pass) => options.includeOptional || !pass.optional)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const included = new Set(active.map((pass) => pass.id));
    const hazards: string[] = [];
    const skippedPasses = this.#passes.filter((pass) => !included.has(pass.id)).map((pass) => pass.id);

    for (const pass of active) {
      for (const dependency of pass.dependencies) {
        if (!included.has(dependency) && !pass.optional) hazards.push(`${pass.id}->${dependency}`);
      }
    }

    const estimatedCpuMs = active.reduce((sum, pass) => sum + pass.costMs, 0);
    const estimatedGpuMs = active.reduce((sum, pass) => sum + pass.gpuCostMs, 0);
    const safeMultiplier = this.#tier === 'safe' ? 0.65 : this.#tier === 'low' ? 0.82 : this.#tier === 'medium' ? 0.94 : this.#tier === 'ultra' ? 1.1 : 1;

    return Object.freeze({
      backend: this.#backend,
      tier: this.#tier,
      passes: Object.freeze(active.map((pass) => ({ ...pass }))),
      skippedPasses: Object.freeze(skippedPasses),
      hazards: Object.freeze([...new Set(hazards)]),
      estimatedCpuMs: clampR29(estimatedCpuMs * safeMultiplier, 0, 1000),
      estimatedGpuMs: clampR29(estimatedGpuMs * safeMultiplier, 0, 1000),
    });
  }
}

export function createHeadlessR29Backend(): R29RenderBackendAdapter {
  return Object.freeze({ backend: 'headless', available: true });
}

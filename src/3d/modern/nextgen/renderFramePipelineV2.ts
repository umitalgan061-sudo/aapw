export type RenderPassKind = 'shadow' | 'depth' | 'opaque' | 'alpha' | 'water' | 'vegetation' | 'particles' | 'post' | 'ui';
export type RenderQuality = 'cinematic' | 'high' | 'medium' | 'low' | 'emergency';

export interface RenderPassDefinition {
  id: string;
  kind: RenderPassKind;
  priority: number;
  enabled: boolean;
  budgetMs: number;
  scale: number;
  dependencies: readonly string[];
  execute: (context: RenderPassContext) => void;
}
export interface RenderPassContext { frame: number; deltaSeconds: number; quality: RenderQuality; resolutionScale: number; frameBudgetMs: number; }
export interface RenderFrameInput { frame: number; deltaSeconds: number; gpuTimeMs: number; cpuTimeMs: number; memoryMB: number; drawCalls: number; triangles: number; visibleObjects: number; devicePixelRatio: number; isMobile: boolean; }
export interface RenderBudget { frameMs: number; gpuMs: number; drawCalls: number; triangles: number; memoryMB: number; }
export interface RenderDecision { quality: RenderQuality; resolutionScale: number; enabledPasses: string[]; disabledPasses: string[]; reason: string; }
export interface RenderFrameResult { frame: number; quality: RenderQuality; resolutionScale: number; elapsedMs: number; passTimes: Readonly<Record<string, number>>; overruns: readonly string[]; }

const QUALITY_ORDER: readonly RenderQuality[] = ['emergency', 'low', 'medium', 'high', 'cinematic'];
const QUALITY_PROFILE: Record<RenderQuality, { scale: number; shadow: boolean; water: boolean; vegetation: boolean; particles: boolean; post: boolean }> = {
  cinematic: { scale: 1, shadow: true, water: true, vegetation: true, particles: true, post: true },
  high: { scale: 0.9, shadow: true, water: true, vegetation: true, particles: true, post: true },
  medium: { scale: 0.78, shadow: true, water: true, vegetation: true, particles: false, post: true },
  low: { scale: 0.64, shadow: false, water: true, vegetation: true, particles: false, post: false },
  emergency: { scale: 0.5, shadow: false, water: false, vegetation: false, particles: false, post: false },
};
function qualityIndex(quality: RenderQuality): number { return QUALITY_ORDER.indexOf(quality); }
function nextLowerQuality(quality: RenderQuality): RenderQuality { return QUALITY_ORDER[Math.max(0, qualityIndex(quality) - 1)]; }
function nextHigherQuality(quality: RenderQuality): RenderQuality { return QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, qualityIndex(quality) + 1)]; }

export class AdaptiveRenderPipelineV2 {
  readonly #passes = new Map<string, RenderPassDefinition>();
  readonly #history: RenderFrameInput[] = [];
  readonly #passTimes = new Map<string, number>();
  readonly #budget: RenderBudget;
  #quality: RenderQuality = 'high';
  #resolutionScale = 0.9;
  #stableFrames = 0;

  constructor(budget: Partial<RenderBudget> = {}) {
    this.#budget = { frameMs: budget.frameMs ?? 16.6, gpuMs: budget.gpuMs ?? 14, drawCalls: budget.drawCalls ?? 2500, triangles: budget.triangles ?? 2_500_000, memoryMB: budget.memoryMB ?? 1024 };
  }

  register(pass: RenderPassDefinition): void {
    if (!pass.id.trim()) throw new RangeError('Render pass id cannot be empty');
    if (this.#passes.has(pass.id)) throw new Error(`Render pass ${pass.id} already exists`);
    if (!Number.isFinite(pass.budgetMs) || pass.budgetMs < 0) throw new RangeError('Render pass budget must be non-negative');
    if (!Number.isFinite(pass.scale) || pass.scale <= 0 || pass.scale > 1) throw new RangeError('Render pass scale must be in (0,1]');
    this.#passes.set(pass.id, { ...pass, dependencies: [...pass.dependencies] });
  }

  registerStandardPasses(): void {
    const noop = (): void => undefined;
    const defaults: RenderPassDefinition[] = [
      { id: 'shadow', kind: 'shadow', priority: 100, enabled: true, budgetMs: 2.5, scale: 0.75, dependencies: [], execute: noop },
      { id: 'depth', kind: 'depth', priority: 90, enabled: true, budgetMs: 1.2, scale: 1, dependencies: [], execute: noop },
      { id: 'opaque', kind: 'opaque', priority: 80, enabled: true, budgetMs: 4.5, scale: 1, dependencies: ['depth'], execute: noop },
      { id: 'alpha', kind: 'alpha', priority: 70, enabled: true, budgetMs: 1.8, scale: 1, dependencies: ['opaque'], execute: noop },
      { id: 'water', kind: 'water', priority: 65, enabled: true, budgetMs: 2.2, scale: 0.8, dependencies: ['opaque'], execute: noop },
      { id: 'vegetation', kind: 'vegetation', priority: 60, enabled: true, budgetMs: 2.2, scale: 0.7, dependencies: ['depth'], execute: noop },
      { id: 'particles', kind: 'particles', priority: 50, enabled: true, budgetMs: 1.4, scale: 0.65, dependencies: ['opaque'], execute: noop },
      { id: 'post', kind: 'post', priority: 40, enabled: true, budgetMs: 1.6, scale: 1, dependencies: ['alpha', 'water'], execute: noop },
      { id: 'ui', kind: 'ui', priority: 30, enabled: true, budgetMs: 0.8, scale: 1, dependencies: ['post'], execute: noop },
    ];
    for (const pass of defaults) if (!this.#passes.has(pass.id)) this.register(pass);
  }
  get quality(): RenderQuality { return this.#quality; }
  get resolutionScale(): number { return this.#resolutionScale; }
  setQuality(quality: RenderQuality): void { this.#quality = quality; this.#resolutionScale = QUALITY_PROFILE[quality].scale; this.#applyProfile(); }

  decide(input: RenderFrameInput): RenderDecision {
    this.#history.push({ ...input });
    while (this.#history.length > 120) this.#history.shift();
    const pressure = Math.max(input.gpuTimeMs / this.#budget.gpuMs, input.cpuTimeMs / this.#budget.frameMs, input.drawCalls / this.#budget.drawCalls, input.triangles / this.#budget.triangles, input.memoryMB / this.#budget.memoryMB);
    const adjusted = pressure + (input.isMobile ? 0.12 : 0);
    let reason = 'stable';
    if (adjusted > 1.2) {
      const previous = this.#quality;
      this.#quality = nextLowerQuality(this.#quality);
      this.#stableFrames = 0;
      reason = `pressure:${adjusted.toFixed(2)}`;
      if (previous !== this.#quality) this.#resolutionScale = Math.max(0.5, this.#resolutionScale - 0.06);
    } else if (adjusted < 0.72) {
      this.#stableFrames += 1;
      if (this.#stableFrames >= 45) {
        this.#quality = nextHigherQuality(this.#quality);
        this.#stableFrames = 0;
        reason = 'sustained_headroom';
        this.#resolutionScale = Math.min(QUALITY_PROFILE[this.#quality].scale, this.#resolutionScale + 0.04);
      } else reason = `headroom:${adjusted.toFixed(2)}`;
    } else {
      this.#stableFrames = 0;
      reason = `balanced:${adjusted.toFixed(2)}`;
    }
    this.#applyProfile();
    const enabledPasses = [...this.#passes.values()].filter((pass) => pass.enabled).sort((a, b) => b.priority - a.priority).map((pass) => pass.id);
    const disabledPasses = [...this.#passes.values()].filter((pass) => !pass.enabled).sort((a, b) => a.id.localeCompare(b.id)).map((pass) => pass.id);
    return { quality: this.#quality, resolutionScale: this.#resolutionScale, enabledPasses, disabledPasses, reason };
  }

  execute(context: RenderPassContext): RenderFrameResult {
    const started = performance.now();
    this.#passTimes.clear();
    const overruns: string[] = [];
    for (const pass of this.#topologicalOrder().filter((entry) => entry.enabled)) {
      const passStart = performance.now();
      pass.execute({ ...context, quality: this.#quality, resolutionScale: this.#resolutionScale });
      const elapsed = performance.now() - passStart;
      this.#passTimes.set(pass.id, elapsed);
      if (elapsed > pass.budgetMs && pass.budgetMs > 0) overruns.push(pass.id);
    }
    return { frame: context.frame, quality: this.#quality, resolutionScale: this.#resolutionScale, elapsedMs: performance.now() - started, passTimes: Object.fromEntries(this.#passTimes), overruns };
  }

  pass(id: string): RenderPassDefinition | undefined { const pass = this.#passes.get(id); return pass ? { ...pass, dependencies: [...pass.dependencies] } : undefined; }
  passes(): RenderPassDefinition[] { return [...this.#passes.values()].sort((a, b) => b.priority - a.priority).map((pass) => ({ ...pass, dependencies: [...pass.dependencies] })); }
  history(): RenderFrameInput[] { return this.#history.map((entry) => ({ ...entry })); }
  passTimes(): Record<string, number> { return Object.fromEntries(this.#passTimes); }
  averageFrameTime(): number { return this.#history.length ? this.#history.reduce((sum, entry) => sum + entry.cpuTimeMs, 0) / this.#history.length : 0; }

  #topologicalOrder(): RenderPassDefinition[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: RenderPassDefinition[] = [];
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Render dependency cycle at ${id}`);
      const pass = this.#passes.get(id);
      if (!pass) throw new Error(`Unknown render dependency ${id}`);
      visiting.add(id);
      for (const dependency of pass.dependencies) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      order.push(pass);
    };
    for (const pass of [...this.#passes.values()].sort((a, b) => b.priority - a.priority)) visit(pass.id);
    return order;
  }

  #applyProfile(): void {
    const profile = QUALITY_PROFILE[this.#quality];
    for (const pass of this.#passes.values()) {
      switch (pass.kind) {
        case 'shadow': pass.enabled = profile.shadow; break;
        case 'water': pass.enabled = profile.water; break;
        case 'vegetation': pass.enabled = profile.vegetation; break;
        case 'particles': pass.enabled = profile.particles; break;
        case 'post': pass.enabled = profile.post; break;
        default: pass.enabled = true;
      }
    }
  }
}

export function renderQualityFromPressure(pressure: number): RenderQuality {
  if (pressure > 1.25) return 'emergency';
  if (pressure > 1.05) return 'low';
  if (pressure > 0.85) return 'medium';
  if (pressure > 0.65) return 'high';
  return 'cinematic';
}

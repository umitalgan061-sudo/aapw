import { clamp, clamp01, type Aabb, type QualityDecision, type QualityTier, type WorkPriority } from './contracts.ts';

export interface RenderPass {
  readonly id: string;
  readonly phase: 'opaque' | 'transparent' | 'post' | 'ui';
  readonly priority: WorkPriority;
  readonly dependencies?: readonly string[];
  readonly enabled?: () => boolean;
  readonly execute: (context: RenderPassContext) => void;
}

export interface RenderPassContext {
  readonly frame: number;
  readonly quality: QualityDecision;
  readonly visibleBounds?: Aabb;
  readonly submit: (command: string, payload?: unknown) => void;
}

export interface RenderReport {
  readonly executed: readonly string[];
  readonly skipped: readonly string[];
  readonly estimatedCostMs: number;
  readonly overBudget: boolean;
}

const PASS_ORDER: Record<RenderPass['phase'], number> = {
  opaque: 0,
  transparent: 1,
  post: 2,
  ui: 3,
};

const TIER_SCALE: Record<QualityTier, number> = {
  ultra: 1,
  high: 0.9,
  medium: 0.78,
  low: 0.65,
  safe: 0.5,
};

export class RenderGraph {
  #passes = new Map<string, RenderPass>();

  add(pass: RenderPass): void {
    if (this.#passes.has(pass.id)) throw new Error('Render pass already registered: ' + pass.id);
    this.#passes.set(pass.id, pass);
  }

  remove(id: string): boolean {
    return this.#passes.delete(id);
  }

  order(): readonly RenderPass[] {
    const passes = [...this.#passes.values()];
    const indegree = new Map(passes.map((pass) => [pass.id, 0]));
    const edges = new Map<string, string[]>();
    for (const pass of passes) {
      for (const dependency of pass.dependencies ?? []) {
        if (!this.#passes.has(dependency)) throw new Error('Missing render dependency: ' + dependency);
        indegree.set(pass.id, (indegree.get(pass.id) ?? 0) + 1);
        const list = edges.get(dependency) ?? [];
        list.push(pass.id);
        edges.set(dependency, list);
      }
    }
    const ready = passes.filter((pass) => indegree.get(pass.id) === 0).sort(this.#compare);
    const result: RenderPass[] = [];
    while (ready.length > 0) {
      const pass = ready.shift();
      if (!pass) break;
      result.push(pass);
      for (const childId of edges.get(pass.id) ?? []) {
        const next = (indegree.get(childId) ?? 0) - 1;
        indegree.set(childId, next);
        if (next === 0) {
          const child = this.#passes.get(childId);
          if (child) {
            ready.push(child);
            ready.sort(this.#compare);
          }
        }
      }
    }
    if (result.length !== passes.length) throw new Error('Render graph dependency cycle detected');
    return Object.freeze(result);
  }

  execute(context: RenderPassContext, budgetMs: number): RenderReport {
    const executed: string[] = [];
    const skipped: string[] = [];
    const safeBudget = Math.max(0.1, budgetMs);
    let estimatedCostMs = 0;
    for (const pass of this.order()) {
      if (pass.enabled && !pass.enabled()) {
        skipped.push(pass.id);
        continue;
      }
      const estimatedPassMs = this.estimateCost(pass, context.quality);
      const allowed = estimatedCostMs + estimatedPassMs <= safeBudget || pass.priority === 'critical';
      if (!allowed) {
        skipped.push(pass.id);
        continue;
      }
      pass.execute(context);
      executed.push(pass.id);
      estimatedCostMs += estimatedPassMs;
    }
    return Object.freeze({
      executed: Object.freeze(executed),
      skipped: Object.freeze(skipped),
      estimatedCostMs,
      overBudget: estimatedCostMs > safeBudget,
    });
  }

  #estimateCost(pass: RenderPass, quality: QualityDecision): number {
    const base = pass.priority === 'critical' ? 0.4 : pass.priority === 'high' ? 0.9 : pass.priority === 'normal' ? 1.5 : pass.priority === 'low' ? 2.2 : 3;
    const phaseMultiplier = pass.phase === 'post' ? 1.2 : pass.phase === 'ui' ? 0.7 : 1;
    return Number((base * phaseMultiplier * TIER_SCALE[quality.tier]).toFixed(4));
  }

  #compare = (a: RenderPass, b: RenderPass): number => {
    const phase = PASS_ORDER[a.phase] - PASS_ORDER[b.phase];
    if (phase !== 0) return phase;
    const pa = a.priority.localeCompare(b.priority);
    return pa !== 0 ? pa : a.id.localeCompare(b.id);
  };
}

export class RenderBudgetGovernor {
  #tier: QualityTier;
  #scale: number;
  #pressure = 0;
  #cooldown = 0;
  readonly minScale: number;
  readonly maxScale: number;

  constructor(initialTier: QualityTier = 'high', minScale = 0.5, maxScale = 1) {
    this.#tier = initialTier;
    this.#scale = clamp(maxScale, minScale, maxScale);
    this.minScale = clamp(minScale, 0.25, 1);
    this.maxScale = clamp(maxScale, this.minScale, 1.5);
    this.#scale = clamp(this.#scale, this.minScale, this.maxScale);
  }

  observe(frameMs: number, targetMs: number, dtSeconds = 1 / 60): QualityDecision {
    const safeTarget = Math.max(1, Number.isFinite(targetMs) ? targetMs : 16.67);
    const pressure = clamp01((frameMs - safeTarget) / safeTarget);
    this.#pressure = this.#pressure * 0.85 + pressure * 0.15;
    this.#cooldown = Math.max(0, this.#cooldown - dtSeconds);
    if (this.#cooldown <= 0) {
      if (this.#pressure > 0.22) {
        this.#scale = clamp(this.#scale - 0.05, this.minScale, this.maxScale);
        this.#cooldown = 0.5;
      } else if (this.#pressure < 0.05) {
        this.#scale = clamp(this.#scale + 0.025, this.minScale, this.maxScale);
        this.#cooldown = 0.75;
      }
      if (this.#pressure > 0.35) this.#tier = lowerTier(this.#tier);
      else if (this.#pressure < 0.03) this.#tier = higherTier(this.#tier);
    }
    const particleScale = clamp01(this.#scale / this.maxScale);
    const shadowScale = clamp01(this.#scale / this.maxScale);
    return Object.freeze({
      tier: this.#tier,
      renderScale: Number(this.#scale.toFixed(3)),
      particleScale: Number(particleScale.toFixed(3)),
      shadowScale: Number(shadowScale.toFixed(3)),
      reason: this.#pressure > 0.2 ? 'frame-pressure' : this.#pressure < 0.04 ? 'headroom-recovery' : 'stable',
    });
  }

  force(tier: QualityTier, scale?: number): void {
    this.#tier = tier;
    if (scale !== undefined) this.#scale = clamp(scale, this.minScale, this.maxScale);
  }

  tier(): QualityTier {
    return this.#tier;
  }

  scale(): number {
    return this.#scale;
  }

  pressure(): number {
    return this.#pressure;
  }
}

function lowerTier(tier: QualityTier): QualityTier {
  if (tier === 'ultra') return 'high';
  if (tier === 'high') return 'medium';
  if (tier === 'medium') return 'low';
  if (tier === 'low') return 'safe';
  return 'safe';
}

function higherTier(tier: QualityTier): QualityTier {
  if (tier === 'safe') return 'low';
  if (tier === 'low') return 'medium';
  if (tier === 'medium') return 'high';
  if (tier === 'high') return 'ultra';
  return 'ultra';
}

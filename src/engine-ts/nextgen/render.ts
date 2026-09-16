import { EntityId, RenderItem, RenderPassKind, RenderPlan, clamp, stableNumber } from './contracts.ts';

export interface RenderBudget {
  readonly maxItems: number;
  readonly maxDrawCalls: number;
  readonly targetGpuMs: number;
  readonly passWeights: Readonly<Record<RenderPassKind, number>>;
}

export interface RenderCandidate extends RenderItem {
  readonly triangles?: number;
  readonly materialVariants?: number;
  readonly critical?: boolean;
}

export interface RenderStats {
  readonly frame: number;
  readonly submitted: number;
  readonly culled: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly estimatedGpuMs: number;
  readonly passCounts: Readonly<Record<RenderPassKind, number>>;
}

const PASSES: readonly RenderPassKind[] = ['depth', 'shadow', 'opaque', 'transparent', 'post', 'ui', 'debug'];
const emptyPassCounts = (): Record<RenderPassKind, number> => ({ depth: 0, shadow: 0, opaque: 0, transparent: 0, post: 0, ui: 0, debug: 0 });

export const DEFAULT_RENDER_BUDGET: RenderBudget = Object.freeze({
  maxItems: 10_000,
  maxDrawCalls: 2_000,
  targetGpuMs: 7.5,
  passWeights: Object.freeze({ depth: 0.6, shadow: 1.2, opaque: 1, transparent: 1.5, post: 2, ui: 0.5, debug: 0.25 }),
});

export class RenderGraph {
  readonly #budget: RenderBudget;
  readonly #candidates: RenderCandidate[] = [];
  readonly #passes = new Map<RenderPassKind, RenderCandidate[]>();
  #frame = 0;

  constructor(budget: RenderBudget = DEFAULT_RENDER_BUDGET) {
    this.#budget = Object.freeze({ ...budget, maxItems: Math.max(1, Math.floor(budget.maxItems)), maxDrawCalls: Math.max(1, Math.floor(budget.maxDrawCalls)), targetGpuMs: Math.max(0.1, budget.targetGpuMs) });
    for (const pass of PASSES) this.#passes.set(pass, []);
  }

  beginFrame(frame = this.#frame + 1): void {
    this.#frame = frame;
    this.#candidates.length = 0;
    for (const items of this.#passes.values()) items.length = 0;
  }

  submit(candidate: RenderCandidate): boolean {
    if (!candidate.visible || this.#candidates.length >= this.#budget.maxItems) return false;
    if (!this.#passes.has(candidate.pass)) throw new Error(`unsupported render pass: ${candidate.pass}`);
    this.#candidates.push(candidate);
    this.#passes.get(candidate.pass)!.push(candidate);
    return true;
  }

  cull(maxDistance: number, distanceByEntity: ReadonlyMap<EntityId, number>): number {
    let removed = 0;
    for (let index = this.#candidates.length - 1; index >= 0; index -= 1) {
      const candidate = this.#candidates[index]!;
      const distance = distanceByEntity.get(candidate.entity) ?? candidate.distance;
      if (distance > maxDistance && !candidate.critical) {
        this.#candidates.splice(index, 1);
        const list = this.#passes.get(candidate.pass)!;
        const passIndex = list.indexOf(candidate);
        if (passIndex >= 0) list.splice(passIndex, 1);
        removed += 1;
      }
    }
    return removed;
  }

  plan(): RenderPlan {
    const passes = new Map<RenderPassKind, readonly RenderItem[]>();
    let drawCalls = 0;
    let estimatedGpuMs = 0;
    const chosenMaterial = new Set<string>();
    const maxDrawCalls = this.#budget.maxDrawCalls;
    for (const pass of PASSES) {
      const list = this.#passes.get(pass)!
        .slice()
        .sort((a, b) => Number(Boolean(b.critical)) - Number(Boolean(a.critical)) || a.sortKey - b.sortKey || a.distance - b.distance || Number(a.entity) - Number(b.entity));
      const selected: RenderCandidate[] = [];
      for (const item of list) {
        const variantCost = Math.max(1, item.materialVariants ?? 1);
        const additionalDraws = chosenMaterial.has(item.materialKey) ? 0 : variantCost;
        if (drawCalls + additionalDraws > maxDrawCalls && !item.critical) continue;
        selected.push(item);
        if (!chosenMaterial.has(item.materialKey)) chosenMaterial.add(item.materialKey);
        drawCalls += additionalDraws;
        estimatedGpuMs += this.#estimate(item, additionalDraws);
      }
      passes.set(pass, Object.freeze(selected));
    }
    const kept = [...passes.values()].reduce((count, items) => count + items.length, 0);
    const culled = Math.max(0, this.#candidates.length - kept);
    return Object.freeze({ frame: this.#frame, passes: passes as ReadonlyMap<RenderPassKind, readonly RenderItem[]>, culled, drawCalls, estimatedGpuMs: stableNumber(estimatedGpuMs) });
  }

  private #estimate(item: RenderCandidate, drawCalls: number): number {
    const triangles = Math.max(1, item.triangles ?? 500);
    const weight = this.#budget.passWeights[item.pass] ?? 1;
    return weight * (0.03 + triangles / 500_000 + drawCalls * 0.015);
  }

  stats(plan = this.plan()): RenderStats {
    const passCounts = emptyPassCounts();
    let submitted = 0;
    let triangles = 0;
    for (const pass of PASSES) {
      const items = plan.passes.get(pass) ?? [];
      passCounts[pass] = items.length;
      submitted += items.length;
      triangles += items.reduce((sum, item) => sum + Math.max(0, (item as RenderCandidate).triangles ?? 500), 0);
    }
    return Object.freeze({ frame: plan.frame, submitted, culled: plan.culled, drawCalls: plan.drawCalls, triangles, estimatedGpuMs: plan.estimatedGpuMs, passCounts: Object.freeze(passCounts) });
  }
}

export interface LodPolicy {
  readonly distances: readonly number[];
  readonly hysteresis: number;
}

export interface LodDecision { readonly level: number; readonly changed: boolean; readonly distance: number }

export class LodController {
  readonly #policy: LodPolicy;
  readonly #levels = new Map<EntityId, number>();
  constructor(policy: LodPolicy) { this.#policy = Object.freeze({ distances: Object.freeze([...policy.distances].map((v) => Math.max(0, v)).sort((a, b) => a - b)), hysteresis: Math.max(0, policy.hysteresis) }); }
  update(entity: EntityId, distance: number): LodDecision {
    const previous = this.#levels.get(entity) ?? 0;
    let next = this.#policy.distances.length;
    for (let index = 0; index < this.#policy.distances.length; index += 1) if (distance < this.#policy.distances[index]!) { next = index; break; }
    if (Math.abs(next - previous) === 1 && distance < this.#policy.distances[Math.max(0, Math.min(previous, this.#policy.distances.length - 1))] + this.#policy.hysteresis) next = previous;
    this.#levels.set(entity, next);
    return Object.freeze({ level: next, changed: next !== previous, distance });
  }
  get(entity: EntityId): number { return this.#levels.get(entity) ?? 0; }
  clear(entity?: EntityId): void { if (entity === undefined) this.#levels.clear(); else this.#levels.delete(entity); }
}

export const makeRenderItem = (entity: EntityId, pass: RenderPassKind, materialKey: string, distance: number, sortKey = 0): RenderCandidate => Object.freeze({ entity, pass, materialKey, distance: Math.max(0, distance), sortKey, visible: true, castShadow: pass === 'opaque' || pass === 'shadow' });

export const renderPressure = (plan: RenderPlan, budget: RenderBudget = DEFAULT_RENDER_BUDGET): number => clamp(Math.max(plan.drawCalls / budget.maxDrawCalls, plan.estimatedGpuMs / budget.targetGpuMs), 0, 4);

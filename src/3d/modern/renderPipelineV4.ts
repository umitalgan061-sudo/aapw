import {
  type BudgetV4,
  type BudgetDecisionV4,
  type BudgetUsageV4,
  type EntityIdV4,
  type QualityTierV4,
  type RenderItemV4,
  type RenderPacketV4,
  type RenderViewV4,
  type TransformV4,
  defaultBudgetV4,
  qualityRankV4,
  tierFromRankV4,
  clampV4,
  distanceV4,
  transformV4,
  vec3V4,
  quaternionV4,
} from './runtimeContractsV4';

export interface RenderSourceV4 {
  readonly entity: EntityIdV4;
  readonly transform: TransformV4;
  readonly materialKey: string;
  readonly geometryKey: string;
  readonly priority?: number;
  readonly transparent?: boolean;
  readonly radius?: number;
}

export interface RenderPipelineOptionsV4 {
  readonly maxItems?: number;
  readonly initialQuality?: QualityTierV4;
  readonly now?: () => number;
}

export interface RenderMetricsV4 {
  readonly frames: number;
  readonly culled: number;
  readonly submitted: number;
  readonly dropped: number;
  readonly qualityChanges: number;
  readonly pressure: number;
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
}

export interface RenderQualitySampleV4 {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleEntities: number;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
}

export interface RenderDecisionRecordV4 {
  readonly frame: number;
  readonly previous: QualityTierV4;
  readonly next: QualityTierV4;
  readonly pressure: number;
  readonly reason: string;
}

const qualityScale = (tier: QualityTierV4): number => ({ minimal: 0.5, low: 0.67, medium: 0.8, high: 1, ultra: 1.15 }[tier]);
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class RenderPipelineV4 {
  readonly maxItems: number;
  #now: () => number;
  #quality: QualityTierV4;
  #frame = 0;
  #sources = new Map<EntityIdV4, RenderSourceV4>();
  #frameTimes: number[] = [];
  #decisions: RenderDecisionRecordV4[] = [];
  #metrics = { frames: 0, culled: 0, submitted: 0, dropped: 0, qualityChanges: 0, pressure: 0, totalFrameMs: 0 };
  #budget: BudgetV4;
  #cooldown = 0;

  constructor(options: RenderPipelineOptionsV4 = {}) {
    this.maxItems = Math.max(64, Math.trunc(options.maxItems ?? 2500));
    this.#quality = options.initialQuality ?? 'high';
    this.#budget = defaultBudgetV4(this.#quality);
    this.#now = options.now ?? (() => performance.now());
  }

  register(source: RenderSourceV4): void {
    this.#sources.set(source.entity, {
      ...source,
      priority: finite(source.priority ?? 0),
      transparent: Boolean(source.transparent),
      radius: Math.max(0, finite(source.radius ?? 0.5, 0.5)),
    });
  }

  unregister(entity: EntityIdV4): boolean {
    return this.#sources.delete(entity);
  }

  clear(): void {
    this.#sources.clear();
  }

  setQuality(tier: QualityTierV4, reason = 'manual'): boolean {
    if (tier === this.#quality) return false;
    const previous = this.#quality;
    this.#quality = tier;
    this.#budget = defaultBudgetV4(tier);
    this.#metrics.qualityChanges += 1;
    this.#decisions.push(Object.freeze({ frame: this.#frame, previous, next: tier, pressure: this.#metrics.pressure, reason }));
    while (this.#decisions.length > 128) this.#decisions.shift();
    return true;
  }

  quality(): QualityTierV4 {
    return this.#quality;
  }

  budget(): BudgetV4 {
    return Object.freeze({ ...this.#budget });
  }

  evaluate(sample: RenderQualitySampleV4): BudgetDecisionV4 {
    const pressure = clampV4(this.#pressure(sample), 0, 2);
    this.#metrics.pressure = pressure;
    const rank = qualityRankV4(this.#quality);
    let targetRank = rank;
    if (pressure >= 1.15) targetRank = rank - 2;
    else if (pressure >= 0.9) targetRank = rank - 1;
    else if (pressure <= 0.25) targetRank = rank + 1;
    const target = tierFromRankV4(targetRank);
    const changed = target !== this.#quality && this.#cooldown <= 0;
    if (changed) {
      const direction = qualityRankV4(target) < rank ? 'downgrade' : 'upgrade';
      this.setQuality(target, `${direction}: pressure=${pressure.toFixed(2)}`);
      this.#cooldown = 30;
    } else {
      this.#cooldown = Math.max(0, this.#cooldown - 1);
    }
    return Object.freeze({ accepted: pressure < 2, pressure, scale: qualityScale(this.#quality), reason: changed ? 'quality-adjusted' : 'quality-stable', budget: this.#budget });
  }

  build(view: RenderViewV4, usage: BudgetUsageV4, sources?: readonly RenderSourceV4[]): RenderPacketV4 {
    const started = this.#now();
    this.#frame += 1;
    this.#metrics.frames += 1;
    const candidates = sources ? sources : [...this.#sources.values()];
    const maxDistance = Math.max(view.far, view.near);
    const items: RenderItemV4[] = [];
    let culled = 0;
    for (const source of candidates) {
      const distance = distanceV4(view.position, source.transform.position);
      if (distance + (source.radius ?? 0.5) < view.near || distance - (source.radius ?? 0.5) > maxDistance) {
        culled += 1;
        continue;
      }
      items.push({ entity: source.entity, transform: source.transform, materialKey: source.materialKey, geometryKey: source.geometryKey, distance, priority: source.priority ?? 0, transparent: Boolean(source.transparent) });
    }
    items.sort((a, b) => b.priority - a.priority || a.distance - b.distance || a.entity - b.entity);
    const budgetCount = Math.max(1, Math.min(this.maxItems, Math.trunc(this.#budget.drawCalls)));
    const selected = items.slice(0, budgetCount);
    this.#metrics.culled += culled;
    this.#metrics.submitted += selected.length;
    this.#metrics.dropped += Math.max(0, items.length - selected.length);
    const packet: RenderPacketV4 = Object.freeze({ frame: this.#frame, view, items: Object.freeze(selected), quality: this.#quality, budgets: usage });
    const duration = Math.max(0, this.#now() - started);
    this.#recordFrame(duration);
    return packet;
  }

  cullAndBuild(view: RenderViewV4, usage: BudgetUsageV4): RenderPacketV4 {
    return this.build(view, usage);
  }

  decisions(): readonly RenderDecisionRecordV4[] {
    return Object.freeze(this.#decisions.slice());
  }

  metrics(): RenderMetricsV4 {
    const sorted = [...this.#frameTimes].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
    return Object.freeze({ frames: this.#metrics.frames, culled: this.#metrics.culled, submitted: this.#metrics.submitted, dropped: this.#metrics.dropped, qualityChanges: this.#metrics.qualityChanges, pressure: this.#metrics.pressure, averageFrameMs: this.#metrics.frames ? this.#metrics.totalFrameMs / this.#metrics.frames : 0, p95FrameMs: p95 });
  }

  inspect(entity: EntityIdV4): RenderSourceV4 | undefined {
    const source = this.#sources.get(entity);
    return source ? { ...source, transform: transformV4(source.transform.position, source.transform.rotation, source.transform.scale) } : undefined;
  }

  #pressure(sample: RenderQualitySampleV4): number {
    const budget = this.#budget;
    const values = [
      finite(sample.frameMs) / 16.67,
      finite(sample.cpuMs) / Math.max(0.1, budget.cpuMs),
      finite(sample.gpuMs) / Math.max(0.1, budget.gpuMs),
      finite(sample.drawCalls) / Math.max(1, budget.drawCalls),
      finite(sample.triangles) / Math.max(1, budget.triangles),
      clampV4(finite(sample.memoryPressure), 0, 2),
      clampV4(finite(sample.thermalPressure), 0, 2),
    ];
    return Math.max(...values);
  }

  #recordFrame(duration: number): void {
    this.#frameTimes.push(duration);
    while (this.#frameTimes.length > 120) this.#frameTimes.shift();
    this.#metrics.totalFrameMs += duration;
  }
}

export function createDefaultViewV4(width = 1280, height = 720): RenderViewV4 {
  return Object.freeze({ width: Math.max(1, Math.trunc(width)), height: Math.max(1, Math.trunc(height)), pixelRatio: 1, near: 0.05, far: 2500, position: vec3V4(0, 0, 0), forward: vec3V4(0, 0, -1) });
}

export function identityTransformV4(): TransformV4 {
  return transformV4(vec3V4(), quaternionV4(), vec3V4(1, 1, 1));
}

import { clampV5, type BudgetV5, type BudgetUsageV5, type QualityV5, defaultBudgetV5 } from './runtimeContractV5';

export interface PerformanceSampleV5 { readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly memoryBytes: number; readonly networkBytes: number; readonly assetBytes: number; readonly timestamp: number; }
export interface PerformanceDecisionV5 { readonly quality: QualityV5; readonly scale: number; readonly shadows: boolean; readonly effects: boolean; readonly reason: readonly string[]; readonly pressure: number; }
export interface PerformanceOptionsV5 { readonly budget?: Partial<BudgetV5>; readonly sampleWindow?: number; readonly downgradeThreshold?: number; readonly upgradeThreshold?: number; readonly minScale?: number; readonly maxScale?: number; readonly now?: () => number; }

const tiers: readonly QualityV5[] = ['minimal', 'balanced', 'high', 'ultra'];
const tierIndex = (tier: QualityV5): number => tiers.indexOf(tier);
const safe = (value: number, fallback = 0): number => Number.isFinite(value) ? Math.max(0, value) : fallback;
const ratio = (value: number, limit: number): number => limit > 0 ? safe(value) / limit : 0;

export class PerformanceControllerV5 {
  readonly budget: BudgetV5;
  readonly sampleWindow: number;
  readonly downgradeThreshold: number;
  readonly upgradeThreshold: number;
  readonly minScale: number;
  readonly maxScale: number;
  #now: () => number;
  #samples: PerformanceSampleV5[] = [];
  #quality: QualityV5 = 'balanced';
  #scale = 1;
  #lastDecision: PerformanceDecisionV5;
  #stableFrames = 0;
  #panicFrames = 0;

  constructor(options: PerformanceOptionsV5 = {}) {
    const base = defaultBudgetV5();
    this.budget = Object.freeze({ ...base, ...options.budget });
    this.sampleWindow = Math.max(4, Math.min(240, Math.floor(options.sampleWindow ?? 60)));
    this.downgradeThreshold = clampV5(options.downgradeThreshold ?? 0.92, 0.5, 1.5);
    this.upgradeThreshold = clampV5(options.upgradeThreshold ?? 0.65, 0.25, 0.95);
    this.minScale = clampV5(options.minScale ?? 0.55, 0.35, 1);
    this.maxScale = clampV5(options.maxScale ?? 1, 0.5, 1.5);
    this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.#lastDecision = Object.freeze({ quality: this.#quality, scale: this.#scale, shadows: true, effects: true, reason: Object.freeze(['initial']), pressure: 0 });
  }

  sample(sample: Omit<PerformanceSampleV5, 'timestamp'> & Partial<Pick<PerformanceSampleV5, 'timestamp'>>): PerformanceDecisionV5 {
    const normalized: PerformanceSampleV5 = Object.freeze({
      frameMs: safe(sample.frameMs), cpuMs: safe(sample.cpuMs), gpuMs: safe(sample.gpuMs), drawCalls: safe(sample.drawCalls), triangles: safe(sample.triangles), memoryBytes: safe(sample.memoryBytes), networkBytes: safe(sample.networkBytes), assetBytes: safe(sample.assetBytes), timestamp: sample.timestamp ?? this.#now(),
    });
    this.#samples.push(normalized);
    while (this.#samples.length > this.sampleWindow) this.#samples.shift();
    return this.#decide();
  }

  current(): PerformanceDecisionV5 { return this.#lastDecision; }
  quality(): QualityV5 { return this.#quality; }
  scale(): number { return this.#scale; }
  samples(): readonly PerformanceSampleV5[] { return Object.freeze(this.#samples.slice()); }

  usage(): BudgetUsageV5 {
    const average = this.#average();
    const ratios = [ratio(average.frameMs, this.budget.frameMs), ratio(average.cpuMs, this.budget.cpuMs), ratio(average.gpuMs, this.budget.gpuMs), ratio(average.drawCalls, this.budget.drawCalls), ratio(average.triangles, this.budget.triangles), ratio(average.memoryBytes, this.budget.memoryBytes), ratio(average.networkBytes, this.budget.networkBytes), ratio(average.assetBytes, this.budget.assetBytes)];
    const pressure = Math.max(...ratios);
    return Object.freeze({ ...average, frameRatio: ratios[0]!, cpuRatio: ratios[1]!, gpuRatio: ratios[2]!, drawRatio: ratios[3]!, triangleRatio: ratios[4]!, memoryRatio: ratios[5]!, networkRatio: ratios[6]!, assetRatio: ratios[7]!, pressure });
  }

  forceQuality(quality: QualityV5, reason = 'manual'): PerformanceDecisionV5 { this.#quality = quality; this.#stableFrames = 0; this.#lastDecision = Object.freeze({ quality, scale: this.#scale, shadows: quality !== 'minimal', effects: quality === 'high' || quality === 'ultra', reason: Object.freeze([reason]), pressure: this.usage().pressure }); return this.#lastDecision; }
  reset(): void { this.#samples.length = 0; this.#quality = 'balanced'; this.#scale = 1; this.#stableFrames = 0; this.#panicFrames = 0; }

  #decide(): PerformanceDecisionV5 {
    const usage = this.usage(); const reasons: string[] = [];
    if (usage.pressure >= 1.25) { this.#panicFrames += 1; this.#stableFrames = 0; } else if (usage.pressure >= this.downgradeThreshold) { this.#stableFrames = 0; this.#panicFrames = Math.max(0, this.#panicFrames - 1); } else if (usage.pressure <= this.upgradeThreshold) { this.#stableFrames += 1; this.#panicFrames = 0; } else { this.#stableFrames = Math.max(0, this.#stableFrames - 1); this.#panicFrames = Math.max(0, this.#panicFrames - 1); }
    if (this.#panicFrames >= 2) { this.#downgrade(2); reasons.push('panic-pressure'); this.#panicFrames = 0; }
    else if (usage.pressure >= this.downgradeThreshold && this.#stableFrames === 0) { this.#downgrade(1); reasons.push('budget-pressure'); }
    else if (this.#stableFrames >= this.sampleWindow && usage.pressure <= this.upgradeThreshold) { this.#upgrade(); reasons.push('sustained-headroom'); this.#stableFrames = 0; }
    if (usage.frameRatio > 1) { this.#scale = clampV5(this.#scale * 0.97, this.minScale, this.maxScale); reasons.push('frame-time'); }
    else if (usage.frameRatio < this.upgradeThreshold && usage.pressure < this.upgradeThreshold) { this.#scale = clampV5(this.#scale * 1.01, this.minScale, this.maxScale); }
    if (usage.memoryRatio > 0.95) reasons.push('memory-pressure');
    if (usage.networkRatio > 0.95) reasons.push('network-pressure');
    if (reasons.length === 0) reasons.push('stable');
    this.#lastDecision = Object.freeze({ quality: this.#quality, scale: this.#scale, shadows: this.#quality !== 'minimal' && usage.pressure < 1.05, effects: (this.#quality === 'high' || this.#quality === 'ultra') && usage.pressure < 0.98, reason: Object.freeze([...new Set(reasons)]), pressure: usage.pressure });
    return this.#lastDecision;
  }

  #downgrade(steps: number): void { this.#quality = tiers[Math.max(0, tierIndex(this.#quality) - Math.max(1, steps))]!; }
  #upgrade(): void { this.#quality = tiers[Math.min(tiers.length - 1, tierIndex(this.#quality) + 1)]!; }
  #average(): Omit<PerformanceSampleV5, 'timestamp'> {
    if (!this.#samples.length) return { frameMs: 0, cpuMs: 0, gpuMs: 0, drawCalls: 0, triangles: 0, memoryBytes: 0, networkBytes: 0, assetBytes: 0 };
    const total = this.#samples.reduce((acc, sample) => ({ frameMs: acc.frameMs + sample.frameMs, cpuMs: acc.cpuMs + sample.cpuMs, gpuMs: acc.gpuMs + sample.gpuMs, drawCalls: acc.drawCalls + sample.drawCalls, triangles: acc.triangles + sample.triangles, memoryBytes: acc.memoryBytes + sample.memoryBytes, networkBytes: acc.networkBytes + sample.networkBytes, assetBytes: acc.assetBytes + sample.assetBytes }), { frameMs: 0, cpuMs: 0, gpuMs: 0, drawCalls: 0, triangles: 0, memoryBytes: 0, networkBytes: 0, assetBytes: 0 });
    const count = this.#samples.length;
    return Object.freeze({ frameMs: total.frameMs / count, cpuMs: total.cpuMs / count, gpuMs: total.gpuMs / count, drawCalls: total.drawCalls / count, triangles: total.triangles / count, memoryBytes: total.memoryBytes / count, networkBytes: total.networkBytes / count, assetBytes: total.assetBytes / count });
  }
}

export function qualityScaleV5(quality: QualityV5): number { return ({ minimal: 0.65, balanced: 0.82, high: 1, ultra: 1.08 })[quality]; }
export function budgetUsageFromSampleV5(sample: PerformanceSampleV5, budget: BudgetV5 = defaultBudgetV5()): BudgetUsageV5 { const ratios = [ratio(sample.frameMs, budget.frameMs), ratio(sample.cpuMs, budget.cpuMs), ratio(sample.gpuMs, budget.gpuMs), ratio(sample.drawCalls, budget.drawCalls), ratio(sample.triangles, budget.triangles), ratio(sample.memoryBytes, budget.memoryBytes), ratio(sample.networkBytes, budget.networkBytes), ratio(sample.assetBytes, budget.assetBytes)]; return Object.freeze({ ...sample, frameRatio: ratios[0]!, cpuRatio: ratios[1]!, gpuRatio: ratios[2]!, drawRatio: ratios[3]!, triangleRatio: ratios[4]!, memoryRatio: ratios[5]!, networkRatio: ratios[6]!, assetRatio: ratios[7]!, pressure: Math.max(...ratios) }); }

import type { Disposable } from './coreTypes.js';
import { clamp } from './coreTypes.js';

export type PerformanceTier = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';
export interface PerformanceBudget { readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly memoryBytes: number; }
export interface PerformanceSample { readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly memoryBytes: number; }
export interface PerformanceDecision { readonly tier: PerformanceTier; readonly pressure: number; readonly downgraded: boolean; readonly upgraded: boolean; readonly reason: string; }
export interface PerformanceStats { readonly samples: number; readonly tier: PerformanceTier; readonly downgrades: number; readonly upgrades: number; readonly averageFrameMs: number; readonly p95FrameMs: number; }

const RANK: Record<PerformanceTier, number> = { minimal: 0, low: 1, medium: 2, high: 3, ultra: 4 };
const TIERS = ['minimal', 'low', 'medium', 'high', 'ultra'] as const;
const MULTIPLIER: Record<PerformanceTier, number> = { minimal: 0.45, low: 0.65, medium: 0.8, high: 1, ultra: 1.3 };
function budgetFor(tier: PerformanceTier, base: PerformanceBudget): PerformanceBudget { const m = MULTIPLIER[tier]; return Object.freeze({ cpuMs: base.cpuMs * m, gpuMs: base.gpuMs * m, drawCalls: Math.max(50, Math.floor(base.drawCalls * m)), triangles: Math.max(10000, Math.floor(base.triangles * m)), memoryBytes: base.memoryBytes * (0.65 + m * 0.35) }); }
function ratio(value: number, limit: number): number { return clamp((Number.isFinite(value) ? value : 0) / Math.max(1, limit), 0, 2); }
function p95(values: readonly number[]): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!; }

export class PerformanceRuntime implements Disposable {
  readonly base: PerformanceBudget;
  #tier: PerformanceTier;
  #downgradeAfter: number;
  #upgradeAfter: number;
  #bad = 0;
  #good = 0;
  #downgrades = 0;
  #upgrades = 0;
  #frames: number[] = [];
  #disposed = false;

  constructor(base: Partial<PerformanceBudget> = {}, initialTier: PerformanceTier = 'high') { this.base = Object.freeze({ cpuMs: 12, gpuMs: 12, drawCalls: 800, triangles: 900000, memoryBytes: 512 * 1024 * 1024, ...base }); this.#tier = initialTier; this.#downgradeAfter = 3; this.#upgradeAfter = 180; }
  get tier(): PerformanceTier { return this.#tier; }
  budget(): PerformanceBudget { return budgetFor(this.#tier, this.base); }
  sample(input: PerformanceSample): PerformanceDecision {
    if (this.#disposed) return Object.freeze({ tier: this.#tier, pressure: 0, downgraded: false, upgraded: false, reason: 'disposed' });
    this.#frames.push(Math.max(0, input.frameMs)); if (this.#frames.length > 256) this.#frames.shift();
    const budget = this.budget(); const pressure = Math.max(ratio(input.cpuMs, budget.cpuMs), ratio(input.gpuMs, budget.gpuMs), ratio(input.drawCalls, budget.drawCalls), ratio(input.triangles, budget.triangles), ratio(input.memoryBytes, budget.memoryBytes));
    const bad = pressure > 1; const good = pressure < 0.55; this.#bad = bad ? this.#bad + 1 : 0; this.#good = good ? this.#good + 1 : 0;
    if (this.#bad >= this.#downgradeAfter && RANK[this.#tier] > 0) { this.#tier = TIERS[RANK[this.#tier] - 1]!; this.#bad = 0; this.#good = 0; this.#downgrades += 1; return Object.freeze({ tier: this.#tier, pressure, downgraded: true, upgraded: false, reason: 'sustained-pressure' }); }
    if (this.#good >= this.#upgradeAfter && RANK[this.#tier] < 4) { this.#tier = TIERS[RANK[this.#tier] + 1]!; this.#good = 0; this.#bad = 0; this.#upgrades += 1; return Object.freeze({ tier: this.#tier, pressure, downgraded: false, upgraded: true, reason: 'sustained-headroom' }); }
    return Object.freeze({ tier: this.#tier, pressure, downgraded: false, upgraded: false, reason: 'stable' });
  }
  force(tier: PerformanceTier): void { this.#tier = tier; this.#bad = 0; this.#good = 0; }
  stats(): PerformanceStats { const average = this.#frames.length ? this.#frames.reduce((a, b) => a + b, 0) / this.#frames.length : 0; return Object.freeze({ samples: this.#frames.length, tier: this.#tier, downgrades: this.#downgrades, upgrades: this.#upgrades, averageFrameMs: average, p95FrameMs: p95(this.#frames) }); }
  dispose(): void { this.#disposed = true; this.#frames.length = 0; }
}

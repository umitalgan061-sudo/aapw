import type { FrameId, QualityTier } from './types';

export type BudgetDecision = 'hold' | 'upgrade' | 'downgrade' | 'panic';

export interface RenderBudgetProfile {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly renderScale: number;
  readonly shadowMap: number;
  readonly vegetationLod: number;
  readonly reflectionQuality: number;
}

export interface BudgetObservation {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs?: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly memoryBytes: number;
  readonly pressure: number;
}

export interface BudgetDecisionRecord {
  readonly frame: FrameId;
  readonly previous: QualityTier;
  readonly next: QualityTier;
  readonly decision: BudgetDecision;
  readonly pressure: number;
  readonly reason: string;
}

const PROFILES: Readonly<Record<QualityTier, RenderBudgetProfile>> = Object.freeze({
  minimal: Object.freeze({ frameMs: 33.3, cpuMs: 14, gpuMs: 18, drawCalls: 650, triangles: 700_000, renderScale: 0.65, shadowMap: 512, vegetationLod: 0, reflectionQuality: 0 }),
  medium: Object.freeze({ frameMs: 22.2, cpuMs: 9, gpuMs: 13, drawCalls: 1100, triangles: 1_200_000, renderScale: 0.8, shadowMap: 1024, vegetationLod: 1, reflectionQuality: 1 }),
  high: Object.freeze({ frameMs: 16.7, cpuMs: 7, gpuMs: 10, drawCalls: 1800, triangles: 2_000_000, renderScale: 1, shadowMap: 2048, vegetationLod: 2, reflectionQuality: 2 }),
  ultra: Object.freeze({ frameMs: 13.3, cpuMs: 6, gpuMs: 8, drawCalls: 2600, triangles: 3_500_000, renderScale: 1.1, shadowMap: 4096, vegetationLod: 3, reflectionQuality: 3 }),
});

const ORDER: readonly QualityTier[] = Object.freeze(['minimal', 'medium', 'high', 'ultra']);

function clamp01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function ratio(actual: number, budget: number): number { return budget <= 0 ? 0 : Math.max(0, actual) / budget; }

/** Frame-budget controller with hysteresis, cooldown and emergency panic mode. */
export class RenderBudgetOrchestrator {
  #tier: QualityTier;
  #cooldown = 0;
  #stableFrames = 0;
  #history: BudgetDecisionRecord[] = [];
  #lastPressure = 0;
  readonly upgradeWindow: number;
  readonly downgradeWindow: number;
  readonly cooldownFrames: number;
  readonly maxHistory: number;

  constructor(initial: QualityTier = 'high', options: { upgradeWindow?: number; downgradeWindow?: number; cooldownFrames?: number; maxHistory?: number } = {}) {
    this.#tier = initial;
    this.upgradeWindow = clamp01(options.upgradeWindow ?? 0.68);
    this.downgradeWindow = Math.max(0.75, Math.min(1.5, options.downgradeWindow ?? 0.94));
    this.cooldownFrames = Math.max(1, Math.trunc(options.cooldownFrames ?? 30));
    this.maxHistory = Math.max(20, Math.trunc(options.maxHistory ?? 600));
  }

  get tier(): QualityTier { return this.#tier; }
  get profile(): RenderBudgetProfile { return PROFILES[this.#tier]; }

  observe(frame: FrameId, sample: BudgetObservation): BudgetDecisionRecord {
    const profile = this.profile;
    const frameRatio = ratio(sample.frameMs, profile.frameMs);
    const cpuRatio = ratio(sample.cpuMs, profile.cpuMs);
    const gpuRatio = ratio(sample.gpuMs ?? sample.frameMs * 0.6, profile.gpuMs);
    const drawRatio = ratio(sample.drawCalls, profile.drawCalls);
    const triangleRatio = ratio(sample.triangles, profile.triangles);
    const memoryPressure = clamp01(sample.memoryBytes > 0 ? Math.max(0, sample.memoryBytes / (512 * 1024 * 1024) - 0.5) / 0.5 : 0);
    const combined = Math.max(clamp01(sample.pressure), Math.min(2, frameRatio * 0.34 + cpuRatio * 0.18 + gpuRatio * 0.22 + drawRatio * 0.08 + triangleRatio * 0.08 + memoryPressure * 0.1));
    this.#lastPressure = combined;
    if (this.#cooldown > 0) this.#cooldown -= 1;
    let decision: BudgetDecision = 'hold';
    let next = this.#tier;
    let reason = 'budget-stable';
    const index = ORDER.indexOf(this.#tier);
    if (combined >= 1.25 || sample.pressure >= 0.98) {
      decision = 'panic';
      next = ORDER[Math.max(0, index - 2)]!;
      reason = 'severe-frame-pressure';
      this.#stableFrames = 0;
    } else if (combined >= this.downgradeWindow) {
      this.#stableFrames = 0;
      if (index > 0 && this.#cooldown === 0) { decision = 'downgrade'; next = ORDER[index - 1]!; reason = `pressure=${combined.toFixed(2)}`; this.#cooldown = this.cooldownFrames; }
      else reason = `pressure=${combined.toFixed(2)}`;
    } else if (combined <= this.upgradeWindow) {
      this.#stableFrames += 1;
      if (index < ORDER.length - 1 && this.#stableFrames >= this.cooldownFrames * 2 && this.#cooldown === 0) { decision = 'upgrade'; next = ORDER[index + 1]!; reason = `headroom=${combined.toFixed(2)}`; this.#stableFrames = 0; this.#cooldown = this.cooldownFrames; }
    } else {
      this.#stableFrames = 0;
    }
    if (next !== this.#tier) this.#tier = next;
    const record = Object.freeze({ frame, previous: ORDER[index]!, next, decision, pressure: combined, reason });
    this.#history.push(record);
    if (this.#history.length > this.maxHistory) this.#history.shift();
    return record;
  }

  force(tier: QualityTier, frame: FrameId = 0, reason = 'manual'): BudgetDecisionRecord | null {
    if (tier === this.#tier) return null;
    const previous = this.#tier;
    this.#tier = tier;
    this.#cooldown = this.cooldownFrames;
    const record = Object.freeze({ frame, previous, next: tier, decision: ORDER.indexOf(tier) > ORDER.indexOf(previous) ? 'upgrade' : 'downgrade', pressure: this.#lastPressure, reason });
    this.#history.push(record);
    return record;
  }

  history(): readonly BudgetDecisionRecord[] { return Object.freeze([...this.#history]); }

  summary(): Readonly<Record<string, number | string>> {
    const upgrades = this.#history.filter((item) => item.decision === 'upgrade').length;
    const downgrades = this.#history.filter((item) => item.decision === 'downgrade' || item.decision === 'panic').length;
    return Object.freeze({ tier: this.#tier, pressure: this.#lastPressure, upgrades, downgrades, stableFrames: this.#stableFrames, cooldown: this.#cooldown });
  }
}

export function renderBudgetProfile(tier: QualityTier): RenderBudgetProfile { return PROFILES[tier]; }
export function renderQualityOrder(): readonly QualityTier[] { return ORDER; }

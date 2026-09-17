import { clampP, finiteP, type FrameBudgetP, type QualityTier, type RenderCapabilitiesP, type RenderPlanP } from './contracts.ts';

export interface RenderBudgetConfigP {
  readonly targetMs60: number;
  readonly targetMs30: number;
  readonly degradeThreshold: number;
  readonly promoteThreshold: number;
  readonly degradeFrames: number;
  readonly promoteFrames: number;
  readonly cooldownFrames: number;
}

export interface RenderBudgetObservationP {
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly pressure: number;
  readonly tier: QualityTier;
  readonly changed: boolean;
}

const DEFAULTS: RenderBudgetConfigP = Object.freeze({ targetMs60: 16.6, targetMs30: 33.3, degradeThreshold: 1.16, promoteThreshold: 0.74, degradeFrames: 12, promoteFrames: 45, cooldownFrames: 30 });
const tiers: readonly QualityTier[] = ['ultra', 'high', 'medium', 'low', 'safe'];

export class ProductionRenderBudget {
  readonly config: RenderBudgetConfigP;
  readonly capabilities: RenderCapabilitiesP;
  #tier: QualityTier;
  #samples: number[] = [];
  #stable = 0;
  #cooldown = 0;
  #changed = false;

  constructor(capabilities: RenderCapabilitiesP, initialTier?: QualityTier, config: Partial<RenderBudgetConfigP> = {}) {
    this.capabilities = Object.freeze({ ...capabilities, maxTextureSize: Math.max(256, capabilities.maxTextureSize), deviceMemoryGb: Math.max(0.25, capabilities.deviceMemoryGb), hardwareConcurrency: Math.max(1, Math.trunc(capabilities.hardwareConcurrency)) });
    this.config = Object.freeze({ ...DEFAULTS, ...config });
    this.#tier = initialTier ?? chooseInitial(capabilities);
    if (!capabilities.webgl2) this.#tier = 'safe';
  }

  get tier(): QualityTier { return this.#tier; }
  get plan(): RenderPlanP { return planFor(this.#tier, this.capabilities); }

  observe(frame: FrameBudgetP): RenderBudgetObservationP {
    const total = Math.max(0, finiteP(frame.totalMs, sumBudget(frame)));
    if (this.#samples.length >= 120) this.#samples.shift();
    this.#samples.push(total);
    this.#cooldown = Math.max(0, this.#cooldown - 1);
    this.#changed = false;
    const averageMs = this.averageMs();
    const p95Ms = this.p95Ms();
    const target = this.capabilities.deviceMemoryGb <= 2 || this.capabilities.hardwareConcurrency <= 2 ? this.config.targetMs30 : this.config.targetMs60;
    const pressure = target > 0 ? averageMs / target : 1;
    if (this.#cooldown === 0) {
      if (pressure > this.config.degradeThreshold || p95Ms > target * 1.4) {
        this.#stable += 1;
        if (this.#stable >= this.config.degradeFrames) this.#shift(1);
      } else if (pressure < this.config.promoteThreshold) {
        this.#stable += 1;
        if (this.#stable >= this.config.promoteFrames) this.#shift(-1);
      } else this.#stable = Math.max(0, this.#stable - 1);
    }
    return Object.freeze({ averageMs, p95Ms, pressure, tier: this.#tier, changed: this.#changed });
  }

  averageMs(): number { return this.#samples.length ? this.#samples.reduce((sum, value) => sum + value, 0) / this.#samples.length : 0; }
  p95Ms(): number { if (!this.#samples.length) return 0; const sorted = [...this.#samples].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0; }
  reset(): void { this.#samples.length = 0; this.#stable = 0; this.#cooldown = 0; }

  #shift(direction: 1 | -1): void {
    const index = tiers.indexOf(this.#tier);
    const next = Math.max(0, Math.min(tiers.length - 1, index + direction));
    if (next === index) { this.#stable = 0; return; }
    this.#tier = tiers[next]!; this.#stable = 0; this.#cooldown = this.#tier === 'safe' ? this.config.cooldownFrames * 2 : this.config.cooldownFrames; this.#changed = true;
  }
}

function chooseInitial(c: RenderCapabilitiesP): QualityTier {
  if (!c.webgl2) return 'safe';
  if (c.deviceMemoryGb <= 2 || c.hardwareConcurrency <= 2) return 'low';
  if (c.maxTextureSize >= 8192 && c.deviceMemoryGb >= 8 && c.hardwareConcurrency >= 8) return 'ultra';
  if (c.maxTextureSize >= 4096 && c.deviceMemoryGb >= 6 && c.hardwareConcurrency >= 6) return 'high';
  return 'medium';
}

function planFor(tier: QualityTier, capabilities: RenderCapabilitiesP): RenderPlanP {
  const base = (() => {
    switch (tier) {
      case 'ultra': return { pixelRatio: 2, shadowMapSize: 4096, visibleDistance: 1, vegetationDensity: 1, effectsDensity: 1, passes: ['depth', 'opaque', 'alpha', 'vegetation', 'water', 'particles', 'post', 'ui'] };
      case 'high': return { pixelRatio: 1.75, shadowMapSize: 3072, visibleDistance: 0.92, vegetationDensity: 0.82, effectsDensity: 0.88, passes: ['depth', 'opaque', 'alpha', 'vegetation', 'water', 'particles', 'post', 'ui'] };
      case 'medium': return { pixelRatio: 1.5, shadowMapSize: 2048, visibleDistance: 0.76, vegetationDensity: 0.65, effectsDensity: 0.7, passes: ['depth', 'opaque', 'alpha', 'vegetation', 'water', 'post', 'ui'] };
      case 'low': return { pixelRatio: 1.15, shadowMapSize: 1024, visibleDistance: 0.56, vegetationDensity: 0.42, effectsDensity: 0.45, passes: ['depth', 'opaque', 'vegetation', 'water', 'ui'] };
      case 'safe': return { pixelRatio: 1, shadowMapSize: 512, visibleDistance: 0.4, vegetationDensity: 0.22, effectsDensity: 0.2, passes: ['depth', 'opaque', 'ui'] };
    }
  })();
  const maxTextureScale = Math.min(1, capabilities.maxTextureSize / base.shadowMapSize);
  return Object.freeze({ tier, ...base, pixelRatio: Math.min(base.pixelRatio, capabilities.instancing ? 2 : 1.35), shadowMapSize: Math.max(512, Math.floor(base.shadowMapSize * maxTextureScale)) });
}

function sumBudget(frame: FrameBudgetP): number { return Math.max(0, finiteP(frame.inputMs)) + Math.max(0, finiteP(frame.simulationMs)) + Math.max(0, finiteP(frame.worldMs)) + Math.max(0, finiteP(frame.networkMs)) + Math.max(0, finiteP(frame.assetMs)) + Math.max(0, finiteP(frame.renderMs)) + Math.max(0, finiteP(frame.telemetryMs)); }

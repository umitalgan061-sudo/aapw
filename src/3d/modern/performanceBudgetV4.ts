import {
  type BudgetDecisionV4,
  type BudgetUsageV4,
  type QualityTierV4,
  type BudgetV4,
  defaultBudgetV4,
  qualityRankV4,
  tierFromRankV4,
  clampV4,
} from './runtimeContractsV4';

export interface PerformanceSampleV4 {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly memoryMb: number;
  readonly networkKbps: number;
  readonly activeEntities: number;
}

export interface PerformanceBudgetConfigV4 {
  readonly targetFrameMs?: number;
  readonly maxMemoryMb?: number;
  readonly maxNetworkKbps?: number;
  readonly hysteresisFrames?: number;
  readonly minimumQuality?: QualityTierV4;
}

export interface PerformanceBudgetStateV4 {
  readonly quality: QualityTierV4;
  readonly pressure: number;
  readonly stableFrames: number;
  readonly overloadFrames: number;
  readonly upgrades: number;
  readonly downgrades: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class PerformanceBudgetV4 {
  readonly targetFrameMs: number;
  readonly maxMemoryMb: number;
  readonly maxNetworkKbps: number;
  readonly hysteresisFrames: number;
  readonly minimumQuality: QualityTierV4;
  #state: PerformanceBudgetStateV4;
  #budget: BudgetV4;

  constructor(config: PerformanceBudgetConfigV4 = {}) {
    this.targetFrameMs = Math.max(4, finite(config.targetFrameMs ?? 16.67, 16.67));
    this.maxMemoryMb = Math.max(64, finite(config.maxMemoryMb ?? 1024, 1024));
    this.maxNetworkKbps = Math.max(32, finite(config.maxNetworkKbps ?? 4096, 4096));
    this.hysteresisFrames = Math.max(1, Math.trunc(config.hysteresisFrames ?? 20));
    this.minimumQuality = config.minimumQuality ?? 'low';
    this.#state = Object.freeze({ quality: 'high', pressure: 0, stableFrames: 0, overloadFrames: 0, upgrades: 0, downgrades: 0 });
    this.#budget = defaultBudgetV4('high');
  }

  update(sample: PerformanceSampleV4): BudgetDecisionV4 {
    const pressure = this.#pressure(sample);
    let stable = this.#state.stableFrames;
    let overload = this.#state.overloadFrames;
    let quality = this.#state.quality;
    let upgrades = this.#state.upgrades;
    let downgrades = this.#state.downgrades;
    if (pressure > 1) {
      overload += 1;
      stable = 0;
    } else if (pressure < 0.55) {
      stable += 1;
      overload = 0;
    } else {
      stable = 0;
      overload = Math.max(0, overload - 1);
    }
    const rank = qualityRankV4(quality);
    const minRank = qualityRankV4(this.minimumQuality);
    if (overload >= this.hysteresisFrames && rank > minRank) {
      quality = tierFromRankV4(rank - 1);
      overload = 0;
      downgrades += 1;
    } else if (stable >= this.hysteresisFrames * 2 && pressure < 0.35 && rank < 4) {
      quality = tierFromRankV4(rank + 1);
      stable = 0;
      upgrades += 1;
    }
    this.#state = Object.freeze({ quality, pressure, stableFrames: stable, overloadFrames: overload, upgrades, downgrades });
    this.#budget = defaultBudgetV4(quality);
    return Object.freeze({ accepted: pressure < 2, pressure, scale: quality === 'ultra' ? 1.15 : quality === 'high' ? 1 : quality === 'medium' ? 0.8 : quality === 'low' ? 0.67 : 0.5, reason: quality !== this.#state.quality ? 'quality-adjusted' : 'budget-observed', budget: this.#budget });
  }

  usage(sample: PerformanceSampleV4): BudgetUsageV4 {
    return Object.freeze({ frameMs: finite(sample.frameMs), cpuMs: finite(sample.cpuMs), gpuMs: finite(sample.gpuMs), networkBytes: finite(sample.networkKbps) * 125, assetBytes: 0, drawCalls: Math.max(0, Math.trunc(sample.drawCalls)), triangles: Math.max(0, Math.trunc(sample.triangles)), activeEntities: Math.max(0, Math.trunc(sample.activeEntities)), visibleEntities: Math.max(0, Math.trunc(sample.activeEntities)), queuedAssets: 0 });
  }

  state(): PerformanceBudgetStateV4 {
    return this.#state;
  }

  budget(): BudgetV4 {
    return Object.freeze({ ...this.#budget });
  }

  reset(quality: QualityTierV4 = 'high'): void {
    this.#state = Object.freeze({ quality, pressure: 0, stableFrames: 0, overloadFrames: 0, upgrades: 0, downgrades: 0 });
    this.#budget = defaultBudgetV4(quality);
  }

  #pressure(sample: PerformanceSampleV4): number {
    const values = [
      finite(sample.frameMs) / this.targetFrameMs,
      finite(sample.cpuMs) / Math.max(0.1, this.#budget.cpuMs),
      finite(sample.gpuMs) / Math.max(0.1, this.#budget.gpuMs),
      finite(sample.drawCalls) / Math.max(1, this.#budget.drawCalls),
      finite(sample.triangles) / Math.max(1, this.#budget.triangles),
      finite(sample.memoryMb) / this.maxMemoryMb,
      finite(sample.networkKbps) / this.maxNetworkKbps,
    ];
    return clampV4(Math.max(...values), 0, 4);
  }
}

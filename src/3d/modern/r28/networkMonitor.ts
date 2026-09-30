export type NetworkHealth = 'excellent' | 'good' | 'degraded' | 'poor';

export interface NetworkSample {
  readonly tick: number;
  readonly rttMs: number;
  readonly lossRatio: number;
  readonly inboundBytes: number;
  readonly outboundBytes: number;
}

export interface NetworkHealthReport {
  readonly health: NetworkHealth;
  readonly score: number;
  readonly averageRttMs: number;
  readonly lossRatio: number;
  readonly inboundBytesPerSample: number;
  readonly outboundBytesPerSample: number;
  readonly recommendedInterpolationTicks: number;
  readonly recommendedInputRedundancy: number;
}

export class RuntimeNetworkMonitor {
  readonly maxSamples: number;
  #samples: NetworkSample[] = [];

  constructor(maxSamples = 60) {
    this.maxSamples = Math.max(4, Math.floor(maxSamples));
  }

  record(sample: NetworkSample): void {
    if (!Number.isFinite(sample.rttMs) || !Number.isFinite(sample.lossRatio)) return;
    this.#samples.push({
      ...sample,
      rttMs: Math.max(0, sample.rttMs),
      lossRatio: Math.max(0, Math.min(1, sample.lossRatio)),
      inboundBytes: Math.max(0, sample.inboundBytes),
      outboundBytes: Math.max(0, sample.outboundBytes),
    });
    while (this.#samples.length > this.maxSamples) this.#samples.shift();
  }

  report(): NetworkHealthReport {
    if (this.#samples.length === 0) {
      return {
        health: 'good',
        score: 75,
        averageRttMs: 0,
        lossRatio: 0,
        inboundBytesPerSample: 0,
        outboundBytesPerSample: 0,
        recommendedInterpolationTicks: 2,
        recommendedInputRedundancy: 1,
      };
    }

    const count = this.#samples.length;
    const averageRttMs = this.#samples.reduce((sum, item) => sum + item.rttMs, 0) / count;
    const lossRatio = this.#samples.reduce((sum, item) => sum + item.lossRatio, 0) / count;
    const inboundBytesPerSample = this.#samples.reduce((sum, item) => sum + item.inboundBytes, 0) / count;
    const outboundBytesPerSample = this.#samples.reduce((sum, item) => sum + item.outboundBytes, 0) / count;

    const rttPenalty = Math.max(0, Math.min(60, averageRttMs / 2));
    const lossPenalty = Math.max(0, Math.min(50, lossRatio * 100));
    const score = Math.max(0, Math.min(100, 100 - rttPenalty - lossPenalty));
    const health: NetworkHealth =
      score >= 85 ? 'excellent' :
      score >= 70 ? 'good' :
      score >= 50 ? 'degraded' : 'poor';

    const recommendedInterpolationTicks =
      health === 'excellent' ? 1 :
      health === 'good' ? 2 :
      health === 'degraded' ? 3 : 4;

    const recommendedInputRedundancy =
      health === 'excellent' ? 1 :
      health === 'good' ? 1 :
      health === 'degraded' ? 2 : 3;

    return {
      health,
      score,
      averageRttMs,
      lossRatio,
      inboundBytesPerSample,
      outboundBytesPerSample,
      recommendedInterpolationTicks,
      recommendedInputRedundancy,
    };
  }

  sampleCount(): number {
    return this.#samples.length;
  }

  clear(): void {
    this.#samples = [];
  }
}

export function classifyNetworkSample(rttMs: number, lossRatio: number): NetworkHealth {
  const safeRtt = Math.max(0, rttMs);
  const safeLoss = Math.max(0, Math.min(1, lossRatio));
  const score = Math.max(0, Math.min(100, 100 - Math.min(60, safeRtt / 2) - Math.min(50, safeLoss * 100)));
  return score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'degraded' : 'poor';
}

export interface HealthSample {
  readonly frameTimeMs: number;
  readonly gpuTimeMs: number | null;
  readonly droppedFrames: number;
  readonly residentBytes: number;
  readonly memoryBudgetBytes: number;
  readonly networkRttMs: number | null;
  readonly networkLoss01: number;
  readonly activeEntities: number;
  readonly entityBudget: number;
}

export interface HealthScore {
  readonly score: number;
  readonly grade: 'excellent' | 'good' | 'degraded' | 'critical';
  readonly frameScore: number;
  readonly memoryScore: number;
  readonly networkScore: number;
  readonly simulationScore: number;
  readonly recommendations: readonly string[];
}

const bounded = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const ratio = (value: number, limit: number): number => bounded(1 - Math.max(0, value) / Math.max(1, limit));

export const scoreRuntimeHealth = (sample: HealthSample): HealthScore => {
  const frameScore = bounded((33.3 - Math.max(0, sample.frameTimeMs)) / 22.2);
  const gpuScore = sample.gpuTimeMs === null ? 1 : bounded((33.3 - Math.max(0, sample.gpuTimeMs)) / 22.2);
  const memoryScore = ratio(sample.residentBytes, Math.max(1, sample.memoryBudgetBytes));
  const rttScore = sample.networkRttMs === null ? 1 : bounded(1 - Math.max(0, sample.networkRttMs - 50) / 300);
  const lossScore = bounded(1 - Math.max(0, sample.networkLoss01));
  const networkScore = rttScore * 0.7 + lossScore * 0.3;
  const entityScore = ratio(sample.activeEntities, Math.max(1, sample.entityBudget));
  const dropScore = bounded(1 - Math.max(0, sample.droppedFrames) / 30);
  const simulationScore = entityScore * 0.65 + dropScore * 0.35;
  const score = Math.round((frameScore * 0.4 + gpuScore * 0.1 + memoryScore * 0.2 + networkScore * 0.15 + simulationScore * 0.15) * 100);
  const recommendations: string[] = [];
  if (frameScore < 0.55 || gpuScore < 0.55) recommendations.push('reduce render resolution or post-processing');
  if (memoryScore < 0.5) recommendations.push('evict non-critical assets and reduce streaming radius');
  if (networkScore < 0.6) recommendations.push('reduce snapshot frequency and prioritize critical commands');
  if (simulationScore < 0.6) recommendations.push('lower background AI cadence and entity budgets');
  const grade = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 55 ? 'degraded' : 'critical';
  return Object.freeze({ score, grade, frameScore, memoryScore, networkScore, simulationScore, recommendations: Object.freeze(recommendations) });
};

export interface HealthWindow {
  readonly capacity: number;
  readonly samples: readonly HealthSample[];
}

export class HealthWindowV2 {
  readonly #capacity: number;
  readonly #samples: HealthSample[] = [];
  constructor(capacity = 120) { this.#capacity = Math.max(4, Math.floor(capacity)); }
  push(sample: HealthSample): void {
    this.#samples.push(Object.freeze({ ...sample }));
    while (this.#samples.length > this.#capacity) this.#samples.shift();
  }
  latest(): HealthSample | undefined { return this.#samples.at(-1); }
  average(): HealthScore | null {
    if (!this.#samples.length) return null;
    const total = this.#samples.reduce((sum, sample) => ({
      frameTimeMs: sum.frameTimeMs + sample.frameTimeMs,
      gpuTimeMs: (sum.gpuTimeMs ?? 0) + (sample.gpuTimeMs ?? 0),
      droppedFrames: sum.droppedFrames + sample.droppedFrames,
      residentBytes: sum.residentBytes + sample.residentBytes,
      memoryBudgetBytes: sum.memoryBudgetBytes + sample.memoryBudgetBytes,
      networkRttMs: (sum.networkRttMs ?? 0) + (sample.networkRttMs ?? 0),
      networkLoss01: sum.networkLoss01 + sample.networkLoss01,
      activeEntities: sum.activeEntities + sample.activeEntities,
      entityBudget: sum.entityBudget + sample.entityBudget,
    }), {
      frameTimeMs: 0,
      gpuTimeMs: 0,
      droppedFrames: 0,
      residentBytes: 0,
      memoryBudgetBytes: 0,
      networkRttMs: 0,
      networkLoss01: 0,
      activeEntities: 0,
      entityBudget: 0,
    });
    const count = this.#samples.length;
    return scoreRuntimeHealth({
      frameTimeMs: total.frameTimeMs / count,
      gpuTimeMs: total.gpuTimeMs === null ? null : total.gpuTimeMs / count,
      droppedFrames: total.droppedFrames / count,
      residentBytes: total.residentBytes / count,
      memoryBudgetBytes: total.memoryBudgetBytes / count,
      networkRttMs: total.networkRttMs === null ? null : total.networkRttMs / count,
      networkLoss01: total.networkLoss01 / count,
      activeEntities: total.activeEntities / count,
      entityBudget: total.entityBudget / count,
    });
  }
  snapshot(): HealthWindow { return Object.freeze({ capacity: this.#capacity, samples: [...this.#samples] }); }
  clear(): void { this.#samples.length = 0; }
}

export interface FrameBudget {
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly aiMs: number;
  readonly totalMs: number;
}

export interface PerformanceSample {
  readonly tick: number;
  readonly cpuMs: number;
  readonly frameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly networkBytes: number;
  readonly memoryMb: number;
  readonly gpuMs?: number;
}

export interface QualityDecision {
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly reason: 'stable' | 'over-budget' | 'under-utilized' | 'memory-pressure';
  readonly changed: boolean;
}

export interface PerformanceConfig {
  readonly windowSize: number;
  readonly downshiftFrames: number;
  readonly upshiftFrames: number;
  readonly minLevel: 0 | 1 | 2 | 3 | 4;
  readonly maxLevel: 0 | 1 | 2 | 3 | 4;
}

export class RollingPerformance {
  readonly config: PerformanceConfig;
  #samples: PerformanceSample[] = [];

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = Object.freeze({
      windowSize: Math.max(4, Math.floor(config.windowSize ?? 60)),
      downshiftFrames: Math.max(2, Math.floor(config.downshiftFrames ?? 12)),
      upshiftFrames: Math.max(4, Math.floor(config.upshiftFrames ?? 30)),
      minLevel: config.minLevel ?? 0,
      maxLevel: config.maxLevel ?? 4,
    });
  }

  push(sample: PerformanceSample): void {
    this.#samples.push(sample);
    while (this.#samples.length > this.config.windowSize) this.#samples.shift();
  }

  latest(): PerformanceSample | undefined {
    return this.#samples.at(-1);
  }

  average(): PerformanceSample | undefined {
    if (this.#samples.length === 0) return undefined;
    const count = this.#samples.length;
    const sum = this.#samples.reduce(
      (acc, sample) => ({
        tick: sample.tick,
        cpuMs: acc.cpuMs + sample.cpuMs,
        frameMs: acc.frameMs + sample.frameMs,
        drawCalls: acc.drawCalls + sample.drawCalls,
        triangles: acc.triangles + sample.triangles,
        networkBytes: acc.networkBytes + sample.networkBytes,
        memoryMb: acc.memoryMb + sample.memoryMb,
        gpuMs: (acc.gpuMs ?? 0) + (sample.gpuMs ?? 0),
      }),
      { tick: 0, cpuMs: 0, frameMs: 0, drawCalls: 0, triangles: 0, networkBytes: 0, memoryMb: 0, gpuMs: 0 },
    );
    return {
      tick: sum.tick,
      cpuMs: sum.cpuMs / count,
      frameMs: sum.frameMs / count,
      drawCalls: sum.drawCalls / count,
      triangles: sum.triangles / count,
      networkBytes: sum.networkBytes / count,
      memoryMb: sum.memoryMb / count,
      gpuMs: sum.gpuMs === undefined ? undefined : sum.gpuMs / count,
    };
  }

  clear(): void {
    this.#samples = [];
  }
}

export class AdaptiveQualityController {
  #level: 0 | 1 | 2 | 3 | 4;
  #overBudgetStreak = 0;
  #underBudgetStreak = 0;
  readonly frameTargetMs: number;
  readonly memoryLimitMb: number;
  readonly config: PerformanceConfig;

  constructor(initialLevel: 0 | 1 | 2 | 3 | 4 = 2, frameTargetMs = 16.67, memoryLimitMb = 1024, config: Partial<PerformanceConfig> = {}) {
    this.#level = initialLevel;
    this.frameTargetMs = Math.max(1, frameTargetMs);
    this.memoryLimitMb = Math.max(64, memoryLimitMb);
    this.config = Object.freeze({
      windowSize: Math.max(4, Math.floor(config.windowSize ?? 60)),
      downshiftFrames: Math.max(2, Math.floor(config.downshiftFrames ?? 12)),
      upshiftFrames: Math.max(4, Math.floor(config.upshiftFrames ?? 30)),
      minLevel: config.minLevel ?? 0,
      maxLevel: config.maxLevel ?? 4,
    });
  }

  get level(): 0 | 1 | 2 | 3 | 4 {
    return this.#level;
  }

  update(sample: PerformanceSample): QualityDecision {
    const overBudget = sample.frameMs > this.frameTargetMs * 1.1;
    const memoryPressure = sample.memoryMb > this.memoryLimitMb * 0.9;
    const underBudget = sample.frameMs < this.frameTargetMs * 0.75 && !memoryPressure;

    if (overBudget || memoryPressure) {
      this.#overBudgetStreak++;
      this.#underBudgetStreak = 0;
    } else if (underBudget) {
      this.#underBudgetStreak++;
      this.#overBudgetStreak = 0;
    } else {
      this.#overBudgetStreak = 0;
      this.#underBudgetStreak = 0;
    }

    if (this.#overBudgetStreak >= this.config.downshiftFrames && this.#level > this.config.minLevel) {
      this.#level = (this.#level - 1) as QualityDecision["level"];
      this.#overBudgetStreak = 0;
      return { level: this.#level, reason: memoryPressure ? 'memory-pressure' : 'over-budget', changed: true };
    }

    if (this.#underBudgetStreak >= this.config.upshiftFrames && this.#level < this.config.maxLevel) {
      this.#level = (this.#level + 1) as typeof this.#level;
      this.#underBudgetStreak = 0;
      return { level: this.#level, reason: 'under-utilized', changed: true };
    }

    return { level: this.#level, reason: 'stable', changed: false };
  }
}

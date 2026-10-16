import { BoundedRing, RuntimeFault, clamp } from "./contracts";

export type QualityLevel = "minimal" | "low" | "balanced" | "high" | "ultra";

export interface RuntimePressureSample {
  readonly tick: number;
  readonly frameMs: number;
  readonly inputLatencyMs?: number;
  readonly memoryBytes?: number;
  readonly networkRttMs?: number | null;
  readonly taskQueueDepth?: number;
  readonly assetQueueDepth?: number;
  readonly droppedFrames?: number;
  readonly frameBudgetMs?: number;
}

export interface QualityProfile {
  readonly level: QualityLevel;
  readonly renderScale: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly effects: "reduced" | "standard" | "full";
  readonly vegetationDistance: number;
  readonly particleBudget: number;
  readonly simulationTaskBudget: number;
  readonly assetConcurrency: number;
  readonly streamingRadius: number;
}

export interface QualityDecision {
  readonly tick: number;
  readonly previous: QualityLevel;
  readonly current: QualityLevel;
  readonly pressureScore: number;
  readonly reasons: readonly string[];
  readonly profile: QualityProfile;
}

export interface QualityDirectorOptions {
  readonly sampleCapacity?: number;
  readonly pressureWindow?: number;
  readonly downshiftFrames?: number;
  readonly upshiftFrames?: number;
  readonly minTicksBetweenChanges?: number;
  readonly memoryHardLimitBytes?: number;
  readonly initialLevel?: QualityLevel;
}

const ORDER: readonly QualityLevel[] = ["minimal", "low", "balanced", "high", "ultra"];

const PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = Object.freeze({
  minimal: Object.freeze({
    level: "minimal", renderScale: 0.5, shadows: false, shadowMapSize: 0, effects: "reduced",
    vegetationDistance: 120, particleBudget: 40, simulationTaskBudget: 8, assetConcurrency: 1, streamingRadius: 1,
  }),
  low: Object.freeze({
    level: "low", renderScale: 0.65, shadows: false, shadowMapSize: 0, effects: "reduced",
    vegetationDistance: 250, particleBudget: 100, simulationTaskBudget: 16, assetConcurrency: 2, streamingRadius: 2,
  }),
  balanced: Object.freeze({
    level: "balanced", renderScale: 0.8, shadows: true, shadowMapSize: 1024, effects: "standard",
    vegetationDistance: 500, particleBudget: 240, simulationTaskBudget: 32, assetConcurrency: 3, streamingRadius: 3,
  }),
  high: Object.freeze({
    level: "high", renderScale: 0.92, shadows: true, shadowMapSize: 2048, effects: "standard",
    vegetationDistance: 900, particleBudget: 500, simulationTaskBudget: 48, assetConcurrency: 4, streamingRadius: 4,
  }),
  ultra: Object.freeze({
    level: "ultra", renderScale: 1, shadows: true, shadowMapSize: 4096, effects: "full",
    vegetationDistance: 1600, particleBudget: 900, simulationTaskBudget: 64, assetConcurrency: 6, streamingRadius: 5,
  }),
});

export class AdaptiveQualityDirector {
  readonly sampleCapacity: number;
  readonly pressureWindow: number;
  readonly downshiftFrames: number;
  readonly upshiftFrames: number;
  readonly minTicksBetweenChanges: number;
  readonly memoryHardLimitBytes: number;
  #level: QualityLevel;
  #samples: RuntimePressureSample[] = [];
  #decisions = new BoundedRing<QualityDecision>(128);
  #lastChangeTick = 0;
  #badStreak = 0;
  #goodStreak = 0;
  #lastTick = -1;
  #forcedUntilTick = -1;
  #forcedLevel: QualityLevel | null = null;

  constructor(options: QualityDirectorOptions = {}) {
    this.sampleCapacity = options.sampleCapacity ?? 120;
    this.pressureWindow = options.pressureWindow ?? 30;
    this.downshiftFrames = options.downshiftFrames ?? 3;
    this.upshiftFrames = options.upshiftFrames ?? 45;
    this.minTicksBetweenChanges = options.minTicksBetweenChanges ?? 30;
    this.memoryHardLimitBytes = options.memoryHardLimitBytes ?? 1_500_000_000;
    this.#level = options.initialLevel ?? "balanced";
    for (const [name, value, min, max] of [
      ["sampleCapacity", this.sampleCapacity, 8, 100_000],
      ["pressureWindow", this.pressureWindow, 3, this.sampleCapacity],
      ["downshiftFrames", this.downshiftFrames, 1, 10_000],
      ["upshiftFrames", this.upshiftFrames, 1, 100_000],
      ["minTicksBetweenChanges", this.minTicksBetweenChanges, 0, 1_000_000],
      ["memoryHardLimitBytes", this.memoryHardLimitBytes, 1_000_000, Number.MAX_SAFE_INTEGER],
    ] as const) {
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
        throw new RuntimeFault("INVALID_INPUT", "Quality configuration is invalid", "quality.constructor", {
          details: { name, value },
        });
      }
    }
  }

  get level(): QualityLevel {
    return this.#level;
  }

  get profile(): QualityProfile {
    return PROFILES[this.#level];
  }

  forceLevel(level: QualityLevel, untilTick: number): void {
    if (!ORDER.includes(level) || !Number.isSafeInteger(untilTick) || untilTick < this.#lastTick) {
      throw new RuntimeFault("INVALID_INPUT", "Quality override is invalid", "quality.forceLevel");
    }
    this.#forcedLevel = level;
    this.#forcedUntilTick = untilTick;
  }

  observe(sample: RuntimePressureSample): QualityDecision | null {
    if (!Number.isSafeInteger(sample.tick) || sample.tick < 0 || sample.tick <= this.#lastTick) {
      throw new RuntimeFault("INVALID_INPUT", "Quality samples require increasing ticks", "quality.observe");
    }
    this.#lastTick = sample.tick;
    const normalized = this.#normalizeSample(sample);
    this.#samples.push(normalized);
    if (this.#samples.length > this.sampleCapacity) this.#samples.shift();

    if (this.#forcedLevel && sample.tick <= this.#forcedUntilTick) {
      return this.#applyForced(sample.tick);
    }
    if (this.#forcedLevel && sample.tick > this.#forcedUntilTick) {
      this.#forcedLevel = null;
      this.#forcedUntilTick = -1;
    }

    const score = this.#score(this.#samples.slice(-this.pressureWindow));
    const reasons: string[] = [];
    if (score >= 70) {
      this.#badStreak += 1;
      this.#goodStreak = 0;
      reasons.push("sustained-frame-pressure");
    } else if (score <= 25) {
      this.#goodStreak += 1;
      this.#badStreak = 0;
      reasons.push("sustained-headroom");
    } else {
      this.#badStreak = Math.max(0, this.#badStreak - 1);
      this.#goodStreak = Math.max(0, this.#goodStreak - 1);
      reasons.push("mixed-pressure");
    }

    if (normalized.memoryBytes !== undefined && normalized.memoryBytes >= this.memoryHardLimitBytes) {
      reasons.push("memory-hard-limit");
      this.#badStreak = this.downshiftFrames;
    }
    const ticksSinceChange = sample.tick - this.#lastChangeTick;
    let nextIndex = ORDER.indexOf(this.#level);
    if (this.#badStreak >= this.downshiftFrames && ticksSinceChange >= Math.min(5, this.minTicksBetweenChanges)) {
      nextIndex = Math.max(0, nextIndex - 1);
      if (normalized.memoryBytes !== undefined && normalized.memoryBytes >= this.memoryHardLimitBytes) {
        nextIndex = Math.max(0, nextIndex - 1);
      }
    } else if (
      this.#goodStreak >= this.upshiftFrames &&
      ticksSinceChange >= this.minTicksBetweenChanges &&
      this.#samples.length >= this.pressureWindow
    ) {
      nextIndex = Math.min(ORDER.length - 1, nextIndex + 1);
    }
    if (nextIndex === ORDER.indexOf(this.#level)) return null;
    const previous = this.#level;
    this.#level = ORDER[nextIndex]!;
    this.#lastChangeTick = sample.tick;
    this.#badStreak = 0;
    this.#goodStreak = 0;
    if (nextIndex < ORDER.indexOf(previous)) reasons.push("quality-downshift");
    else reasons.push("quality-upshift");
    const decision = Object.freeze({
      tick: sample.tick,
      previous,
      current: this.#level,
      pressureScore: score,
      reasons: Object.freeze(reasons),
      profile: this.profile,
    });
    this.#decisions.push(decision);
    return decision;
  }

  pressureScore(): number {
    return this.#score(this.#samples.slice(-this.pressureWindow));
  }

  decisions(): readonly QualityDecision[] {
    return this.#decisions.snapshot().values;
  }

  snapshot(): Readonly<{
    level: QualityLevel;
    profile: QualityProfile;
    sampleCount: number;
    pressureScore: number;
    badStreak: number;
    goodStreak: number;
    lastChangeTick: number;
    forced: boolean;
  }> {
    return Object.freeze({
      level: this.#level,
      profile: this.profile,
      sampleCount: this.#samples.length,
      pressureScore: this.pressureScore(),
      badStreak: this.#badStreak,
      goodStreak: this.#goodStreak,
      lastChangeTick: this.#lastChangeTick,
      forced: this.#forcedLevel !== null && this.#lastTick <= this.#forcedUntilTick,
    });
  }

  #applyForced(tick: number): QualityDecision | null {
    if (!this.#forcedLevel || this.#forcedLevel === this.#level) return null;
    const previous = this.#level;
    this.#level = this.#forcedLevel;
    this.#lastChangeTick = tick;
    const decision = Object.freeze({
      tick, previous, current: this.#level, pressureScore: this.pressureScore(),
      reasons: Object.freeze(["operator-override"]), profile: this.profile,
    });
    this.#decisions.push(decision);
    return decision;
  }

  #normalizeSample(sample: RuntimePressureSample): RuntimePressureSample {
    if (!Number.isFinite(sample.frameMs) || sample.frameMs < 0 || sample.frameMs > 60_000) {
      throw new RuntimeFault("INVALID_INPUT", "Frame duration is invalid", "quality.normalizeSample");
    }
    const optionalNumber = (value: number | undefined, max: number, name: string): number | undefined => {
      if (value === undefined) return undefined;
      if (!Number.isFinite(value) || value < 0 || value > max) {
        throw new RuntimeFault("INVALID_INPUT", "Runtime metric is outside the accepted range", "quality.normalizeSample", {
          details: { name, value },
        });
      }
      return value;
    };
    let networkRttMs: number | null | undefined = sample.networkRttMs;
    if (networkRttMs !== undefined && networkRttMs !== null) {
      networkRttMs = optionalNumber(networkRttMs, 120_000, "networkRttMs");
    }
    const queueDepth = (value: number | undefined, name: string): number | undefined => {
      if (value === undefined) return undefined;
      if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
        throw new RuntimeFault("INVALID_INPUT", "Queue depth is invalid", "quality.normalizeSample", { details: { name } });
      }
      return value;
    };
    const inputLatencyMs = optionalNumber(sample.inputLatencyMs, 120_000, "inputLatencyMs");
    const memoryBytes = optionalNumber(sample.memoryBytes, Number.MAX_SAFE_INTEGER, "memoryBytes");
    const taskQueueDepth = queueDepth(sample.taskQueueDepth, "taskQueueDepth");
    const assetQueueDepth = queueDepth(sample.assetQueueDepth, "assetQueueDepth");
    const droppedFrames = queueDepth(sample.droppedFrames, "droppedFrames");
    const frameBudgetMs = optionalNumber(sample.frameBudgetMs, 1000, "frameBudgetMs");
    return Object.freeze({
      tick: sample.tick,
      frameMs: sample.frameMs,
      ...(inputLatencyMs === undefined ? {} : { inputLatencyMs }),
      ...(memoryBytes === undefined ? {} : { memoryBytes }),
      ...(networkRttMs === undefined ? {} : { networkRttMs }),
      ...(taskQueueDepth === undefined ? {} : { taskQueueDepth }),
      ...(assetQueueDepth === undefined ? {} : { assetQueueDepth }),
      ...(droppedFrames === undefined ? {} : { droppedFrames }),
      ...(frameBudgetMs === undefined ? {} : { frameBudgetMs }),
    });
  }

  #score(samples: readonly RuntimePressureSample[]): number {
    if (samples.length === 0) return 0;
    const frameValues = samples.map((sample) => sample.frameMs).sort((a, b) => a - b);
    const p90 = frameValues[Math.min(frameValues.length - 1, Math.floor(frameValues.length * 0.9))] ?? 0;
    const frameBudget = samples[samples.length - 1]?.frameBudgetMs ?? 16.67;
    const framePressure = clamp((p90 / Math.max(1, frameBudget) - 0.65) * 70, 0, 100);
    const last = samples[samples.length - 1]!;
    const memoryPressure = last.memoryBytes === undefined ? 0 : clamp(last.memoryBytes / this.memoryHardLimitBytes * 80, 0, 100);
    const latencyPressure = last.inputLatencyMs === undefined ? 0 : clamp(last.inputLatencyMs / 150 * 100, 0, 100);
    const networkPressure = last.networkRttMs === undefined || last.networkRttMs === null
      ? 0 : clamp(last.networkRttMs / 500 * 100, 0, 100);
    const queuePressure = clamp(((last.taskQueueDepth ?? 0) + (last.assetQueueDepth ?? 0)) / 150 * 100, 0, 100);
    const dropPressure = clamp((last.droppedFrames ?? 0) * 5, 0, 100);
    return Math.round(
      framePressure * 0.42 +
      memoryPressure * 0.22 +
      latencyPressure * 0.12 +
      networkPressure * 0.08 +
      queuePressure * 0.1 +
      dropPressure * 0.06,
    );
  }
}

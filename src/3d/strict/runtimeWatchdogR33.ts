/** Strict production runtime watchdog for frame health, pressure spikes and recovery hysteresis. */

export type RuntimeWatchdogState = 'nominal' | 'degraded' | 'critical' | 'recovering' | 'disposed';

export interface RuntimeWatchdogPolicy {
  readonly frameBudgetMs: number;
  readonly criticalFrameBudgetMs: number;
  readonly consecutiveBadFrames: number;
  readonly criticalConsecutiveBadFrames: number;
  readonly recoveryFrames: number;
  readonly historyCapacity: number;
  readonly maxDeltaSeconds: number;
}

export interface RuntimeWatchdogSample {
  readonly frame: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly pressure: number;
  readonly hardeningState: string;
}

export interface RuntimeWatchdogSnapshot {
  readonly version: 33;
  readonly state: RuntimeWatchdogState;
  readonly score: number;
  readonly consecutiveBadFrames: number;
  readonly consecutiveGoodFrames: number;
  readonly last?: RuntimeWatchdogSample;
  readonly history: readonly RuntimeWatchdogSample[];
}

const DEFAULT_POLICY: RuntimeWatchdogPolicy = Object.freeze({
  frameBudgetMs: 16.67,
  criticalFrameBudgetMs: 33.34,
  consecutiveBadFrames: 4,
  criticalConsecutiveBadFrames: 8,
  recoveryFrames: 12,
  historyCapacity: 120,
  maxDeltaSeconds: 0.25,
});

const finite = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export class RuntimeWatchdogR33 {
  #policy: RuntimeWatchdogPolicy;
  #state: RuntimeWatchdogState = 'nominal';
  #badFrames = 0;
  #goodFrames = 0;
  #score = 0;
  #history: RuntimeWatchdogSample[] = [];

  constructor(policy: Partial<RuntimeWatchdogPolicy> = {}) {
    const merged = { ...DEFAULT_POLICY, ...policy };
    if (!(merged.frameBudgetMs > 0)) throw new RangeError('frameBudgetMs must be > 0');
    if (!(merged.criticalFrameBudgetMs >= merged.frameBudgetMs)) throw new RangeError('criticalFrameBudgetMs must be >= frameBudgetMs');
    if (!(merged.consecutiveBadFrames >= 1)) throw new RangeError('consecutiveBadFrames must be >= 1');
    if (!(merged.criticalConsecutiveBadFrames >= merged.consecutiveBadFrames)) throw new RangeError('criticalConsecutiveBadFrames must be >= consecutiveBadFrames');
    if (!(merged.recoveryFrames >= 1)) throw new RangeError('recoveryFrames must be >= 1');
    if (!(merged.historyCapacity >= 1)) throw new RangeError('historyCapacity must be >= 1');
    this.#policy = Object.freeze(merged);
  }

  observe(input: Omit<RuntimeWatchdogSample, 'frame'> & { readonly frame?: number }): RuntimeWatchdogSnapshot {
    if (this.#state === 'disposed') return this.snapshot();

    const sample: RuntimeWatchdogSample = Object.freeze({
      frame: Math.max(0, Math.trunc(finite(input.frame, 0))),
      frameMs: Math.max(0, finite(input.frameMs, 0)),
      cpuMs: Math.max(0, finite(input.cpuMs, 0)),
      gpuMs: Math.max(0, finite(input.gpuMs, 0)),
      pressure: clamp01(finite(input.pressure, 0)),
      hardeningState: String(input.hardeningState || 'nominal'),
    });

    this.#history.push(sample);
    if (this.#history.length > this.#policy.historyCapacity) this.#history.splice(0, this.#history.length - this.#policy.historyCapacity);

    const normalizedFramePressure = sample.frameMs <= this.#policy.frameBudgetMs
      ? 0
      : clamp01((sample.frameMs - this.#policy.frameBudgetMs) / Math.max(0.001, this.#policy.criticalFrameBudgetMs - this.#policy.frameBudgetMs));
    const hardeningPressure = sample.hardeningState === 'critical' ? 1 : sample.hardeningState === 'throttled' ? 0.6 : 0;
    const instantScore = clamp01(Math.max(sample.pressure, normalizedFramePressure, hardeningPressure));
    this.#score = this.#score * 0.82 + instantScore * 0.18;

    const bad = sample.frameMs > this.#policy.frameBudgetMs || sample.pressure >= 0.72 || hardeningPressure > 0;
    const critical = sample.frameMs > this.#policy.criticalFrameBudgetMs || sample.pressure >= 0.92 || sample.hardeningState === 'critical';

    if (critical) {
      this.#badFrames += 1;
      this.#goodFrames = 0;
      if (this.#badFrames >= this.#policy.criticalConsecutiveBadFrames) this.#state = 'critical';
      else if (this.#state === 'nominal' || this.#state === 'recovering') this.#state = 'degraded';
    } else if (bad) {
      this.#badFrames += 1;
      this.#goodFrames = 0;
      if (this.#badFrames >= this.#policy.consecutiveBadFrames && this.#state === 'nominal') this.#state = 'degraded';
      if (this.#state === 'recovering') this.#state = 'degraded';
    } else {
      this.#badFrames = 0;
      this.#goodFrames += 1;
      if ((this.#state === 'critical' || this.#state === 'degraded') && this.#goodFrames >= this.#policy.recoveryFrames) this.#state = 'recovering';
      if (this.#state === 'recovering' && this.#goodFrames >= this.#policy.recoveryFrames * 2) this.#state = 'nominal';
    }

    return this.snapshot();
  }

  snapshot(): RuntimeWatchdogSnapshot {
    return Object.freeze({
      version: 33,
      state: this.#state,
      score: Number(this.#score.toFixed(4)),
      consecutiveBadFrames: this.#badFrames,
      consecutiveGoodFrames: this.#goodFrames,
      last: this.#history.at(-1),
      history: Object.freeze([...this.#history]),
    });
  }

  dispose(): void {
    this.#history = [];
    this.#state = 'disposed';
    this.#badFrames = 0;
    this.#goodFrames = 0;
    this.#score = 0;
  }
}

export { DEFAULT_POLICY as RUNTIME_WATCHDOG_DEFAULT_POLICY_R33 };

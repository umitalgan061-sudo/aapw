import { clamp, freeze } from '../domain/contracts.ts';

export type QualityLevel = 0 | 1 | 2 | 3 | 4;
export type PressureKind = 'cpu' | 'gpu' | 'memory' | 'thermal' | 'network';

export interface PressureSample {
  readonly cpu: number;
  readonly gpu: number;
  readonly memory: number;
  readonly thermal: number;
  readonly network: number;
  readonly frameTimeMs: number;
  readonly timestamp: number;
}

export interface QualityPolicy {
  readonly level: QualityLevel;
  readonly resolutionScale: number;
  readonly shadowMapScale: number;
  readonly postFx: boolean;
  readonly bloom: boolean;
  readonly volumetrics: boolean;
  readonly foliageDensity: number;
  readonly textureLodBias: number;
  readonly maxLights: number;
  readonly particleBudget: number;
  readonly audioVoices: number;
  readonly workerBudget: number;
}

export interface AdaptiveQualityOptions {
  readonly targetFrameMs?: number;
  readonly minFrameMs?: number;
  readonly hysteresis?: number;
  readonly dwellMs?: number;
  readonly now?: () => number;
}

const policies: Readonly<Record<QualityLevel, QualityPolicy>> = Object.freeze({
  4: freeze({ level: 4, resolutionScale: 1, shadowMapScale: 1, postFx: true, bloom: true, volumetrics: true, foliageDensity: 1, textureLodBias: 0, maxLights: 8, particleBudget: 2500, audioVoices: 96, workerBudget: 6 }),
  3: freeze({ level: 3, resolutionScale: 0.9, shadowMapScale: 0.85, postFx: true, bloom: true, volumetrics: true, foliageDensity: 0.85, textureLodBias: 0.25, maxLights: 6, particleBudget: 1800, audioVoices: 72, workerBudget: 5 }),
  2: freeze({ level: 2, resolutionScale: 0.78, shadowMapScale: 0.68, postFx: true, bloom: false, volumetrics: false, foliageDensity: 0.68, textureLodBias: 0.55, maxLights: 4, particleBudget: 1200, audioVoices: 56, workerBudget: 4 }),
  1: freeze({ level: 1, resolutionScale: 0.64, shadowMapScale: 0.5, postFx: false, bloom: false, volumetrics: false, foliageDensity: 0.48, textureLodBias: 0.9, maxLights: 3, particleBudget: 800, audioVoices: 40, workerBudget: 3 }),
  0: freeze({ level: 0, resolutionScale: 0.5, shadowMapScale: 0.25, postFx: false, bloom: false, volumetrics: false, foliageDensity: 0.3, textureLodBias: 1.25, maxLights: 2, particleBudget: 450, audioVoices: 28, workerBudget: 2 }),
});

const pressure = (sample: PressureSample): number => clamp(Math.max(
  sample.cpu, sample.gpu, sample.memory, sample.thermal, sample.network,
  clamp((sample.frameTimeMs - 11.1) / 22, 0, 1),
), 0, 1);

export class AdaptiveQualityController {
  readonly #targetFrameMs: number;
  readonly #hysteresis: number;
  readonly #dwellMs: number;
  readonly #now: () => number;
  #level: QualityLevel = 4;
  #pending: QualityLevel = 4;
  #pendingSince = 0;
  #lastChange = 0;
  #sampleCount = 0;
  #pressureEma = 0;
  #frameTimeEma = 16.67;

  constructor(options: AdaptiveQualityOptions = {}) {
    this.#targetFrameMs = Math.max(8, options.targetFrameMs ?? 16.67);
    this.#hysteresis = clamp(options.hysteresis ?? 0.08, 0.01, 0.3);
    this.#dwellMs = Math.max(100, options.dwellMs ?? 1500);
    this.#now = options.now ?? (() => performance.now());
    this.#lastChange = this.#now();
  }

  get level(): QualityLevel { return this.#level; }
  get policy(): QualityPolicy { return policies[this.#level]; }

  update(sample: PressureSample): QualityPolicy {
    const instantPressure = pressure(sample);
    this.#sampleCount += 1;
    const alpha = this.#sampleCount < 10 ? 0.18 : 0.08;
    this.#pressureEma += (instantPressure - this.#pressureEma) * alpha;
    this.#frameTimeEma += (Math.max(0, sample.frameTimeMs) - this.#frameTimeEma) * 0.1;

    const overload = this.#pressureEma > 0.74 || this.#frameTimeEma > this.#targetFrameMs * 1.18;
    const recovery = this.#pressureEma < 0.34 && this.#frameTimeEma < this.#targetFrameMs * 0.82;
    let candidate = this.#level;
    if (overload) candidate = Math.max(0, this.#level - 1) as QualityLevel;
    else if (recovery) candidate = Math.min(4, this.#level + 1) as QualityLevel;
    return this.#commitCandidate(candidate);
  }

  force(level: QualityLevel, reason = 'manual'): QualityPolicy {
    this.#level = level;
    this.#pending = level;
    this.#lastChange = this.#now();
    this.#pendingSince = this.#lastChange;
    return policies[level];
  }

  metrics(): Readonly<{ level: QualityLevel; pressure: number; frameTimeMs: number; sampleCount: number; sinceChangeMs: number; }> {
    return freeze({ level: this.#level, pressure: Number(this.#pressureEma.toFixed(4)), frameTimeMs: Number(this.#frameTimeEma.toFixed(3)), sampleCount: this.#sampleCount, sinceChangeMs: Math.max(0, this.#now() - this.#lastChange) });
  }

  #commitCandidate(candidate: QualityLevel): QualityPolicy {
    if (candidate === this.#level) {
      this.#pending = candidate;
      this.#pendingSince = this.#now();
      return policies[this.#level];
    }
    const now = this.#now();
    if (this.#pending !== candidate) {
      this.#pending = candidate;
      this.#pendingSince = now;
      return policies[this.#level];
    }
    const enoughDwell = now - this.#pendingSince >= this.#dwellMs;
    const changeAllowed = now - this.#lastChange >= this.#dwellMs;
    const enoughHysteresis = candidate < this.#level
      ? this.#pressureEma >= 0.74 + this.#hysteresis
      : this.#pressureEma <= 0.34 - this.#hysteresis;
    if (enoughDwell && changeAllowed && enoughHysteresis) {
      this.#level = candidate;
      this.#lastChange = now;
    }
    return policies[this.#level];
  }
}

export interface ResolutionState {
  readonly scale: number;
  readonly target: number;
  readonly velocity: number;
}

export const adaptResolution = (
  current: ResolutionState,
  frameTimeMs: number,
  targetMs: number,
  options: { readonly min?: number; readonly max?: number; readonly rate?: number } = {},
): ResolutionState => {
  const min = clamp(options.min ?? 0.5, 0.25, 1);
  const max = clamp(options.max ?? 1, min, 1);
  const rate = clamp(options.rate ?? 0.04, 0.005, 0.15);
  const error = (targetMs - frameTimeMs) / Math.max(1, targetMs);
  const desired = clamp(current.scale + error * rate, min, max);
  const target = current.target + (desired - current.target) * 0.2;
  const nextScale = current.scale + (target - current.scale) * 0.12;
  return freeze({ scale: clamp(nextScale, min, max), target: clamp(target, min, max), velocity: nextScale - current.scale });
};

export const getQualityPolicy = (level: QualityLevel): QualityPolicy => policies[level];

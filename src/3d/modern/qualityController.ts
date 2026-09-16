import type { QualityTier } from './types';
import { clamp01 } from './deterministic';
import { qualityDecision } from './capabilities';
import { degradeQuality, recoverQuality } from './telemetry';

export interface AdaptiveQualityOptions {
  readonly initial: QualityTier;
  readonly min: QualityTier;
  readonly max: QualityTier;
  readonly downThreshold?: number;
  readonly upThreshold?: number;
  readonly dwellFrames?: number;
  readonly smoothing?: number;
}

const ORDER: readonly QualityTier[] = ['minimal', 'balanced', 'high', 'ultra'];

/** Hysteretic quality controller preventing one-frame oscillation between quality levels. */
export class AdaptiveQualityController {
  #tier: QualityTier;
  #min: QualityTier;
  #max: QualityTier;
  #down: number;
  #up: number;
  #dwell: number;
  #cooldown = 0;
  #smoothing: number;
  #pressure = 0;
  #decision;

  constructor(options: AdaptiveQualityOptions) {
    this.#tier = options.initial;
    this.#min = options.min;
    this.#max = options.max;
    this.#down = clamp01(options.downThreshold ?? 0.62);
    this.#up = clamp01(options.upThreshold ?? 0.18);
    this.#dwell = Math.max(1, Math.floor(options.dwellFrames ?? 45));
    this.#smoothing = Math.min(1, Math.max(0.01, options.smoothing ?? 0.12));
    this.#decision = qualityDecision(this.#tier, 0);
    this.#validate();
  }

  observe(rawPressure: number): QualityTier {
    const pressure = clamp01(rawPressure);
    this.#pressure += (pressure - this.#pressure) * this.#smoothing;
    if (this.#cooldown > 0) this.#cooldown -= 1;
    if (this.#cooldown === 0) {
      const nextDown = this.#bounded(degradeQuality(this.#tier, this.#pressure));
      const nextUp = this.#bounded(recoverQuality(this.#tier, this.#pressure));
      if (nextDown !== this.#tier && this.#pressure >= this.#down) {
        this.#setTier(nextDown);
      } else if (nextUp !== this.#tier && this.#pressure <= this.#up) {
        this.#setTier(nextUp);
      }
    }
    this.#decision = qualityDecision(this.#tier, this.#pressure);
    return this.#tier;
  }

  get tier(): QualityTier { return this.#tier; }
  get pressure(): number { return this.#pressure; }
  get cooldownFrames(): number { return this.#cooldown; }
  get decision() { return this.#decision; }

  force(tier: QualityTier): void {
    this.#tier = this.#bounded(tier);
    this.#cooldown = this.#dwell;
    this.#decision = qualityDecision(this.#tier, this.#pressure);
  }

  #setTier(tier: QualityTier): void {
    this.#tier = tier;
    this.#cooldown = this.#dwell;
  }

  #bounded(tier: QualityTier): QualityTier {
    const index = ORDER.indexOf(tier);
    const min = ORDER.indexOf(this.#min);
    const max = ORDER.indexOf(this.#max);
    return ORDER[Math.min(max, Math.max(min, index))] ?? this.#tier;
  }

  #validate(): void {
    const min = ORDER.indexOf(this.#min);
    const max = ORDER.indexOf(this.#max);
    const initial = ORDER.indexOf(this.#tier);
    if (min < 0 || max < min || initial < min || initial > max) throw new RangeError('Invalid quality bounds');
    if (this.#up >= this.#down) throw new RangeError('upThreshold must be below downThreshold');
  }
}

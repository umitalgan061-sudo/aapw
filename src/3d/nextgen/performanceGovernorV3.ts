/** Adaptive governor that keeps frame work inside explicit runtime budgets. */

import { clamp } from './deterministicMath';
import type { QualityPreset } from './runtimeConfigV3';

export interface GovernorInput { frameMs: number; simulationMs: number; renderMs: number; memoryBytes: number; entityCount: number; targetFrameMs?: number }
export interface GovernorState { quality: QualityPreset; scale: number; framePressure: number; memoryPressure: number; downgradeCount: number; upgradeCount: number }

const ORDER: readonly QualityPreset[] = ['battery', 'performance', 'balanced', 'high', 'cinematic'];

export class PerformanceGovernorV3 {
  #state: GovernorState;
  #stableTicks = 0;
  #hotTicks = 0;

  constructor(initial: QualityPreset = 'balanced') { this.#state = { quality: initial, scale: 1, framePressure: 0, memoryPressure: 0, downgradeCount: 0, upgradeCount: 0 }; }
  get state(): GovernorState { return { ...this.#state }; }

  sample(input: GovernorInput): GovernorState {
    const target = input.targetFrameMs ?? 16.67;
    const framePressure = clamp(input.frameMs / target, 0, 2);
    const memoryPressure = clamp(input.memoryBytes / (512 * 1024 * 1024), 0, 2);
    this.#state.framePressure = framePressure;
    this.#state.memoryPressure = memoryPressure;
    if (framePressure >= 1.1 || memoryPressure >= 0.95 || input.simulationMs > target * 0.55) {
      this.#hotTicks += 1; this.#stableTicks = 0;
    } else if (framePressure <= 0.72 && memoryPressure <= 0.7 && input.entityCount > 0) {
      this.#stableTicks += 1; this.#hotTicks = 0;
    } else {
      this.#hotTicks = Math.max(0, this.#hotTicks - 1); this.#stableTicks = Math.max(0, this.#stableTicks - 1);
    }
    if (this.#hotTicks >= 8) this.downgrade();
    if (this.#stableTicks >= 60) this.upgrade();
    return this.state;
  }

  forceQuality(quality: QualityPreset): GovernorState { this.#state.quality = quality; this.#state.scale = this.scaleFor(quality); this.#hotTicks = 0; this.#stableTicks = 0; return this.state; }

  private downgrade(): void { const index = ORDER.indexOf(this.#state.quality); if (index > 0) { this.#state.quality = ORDER[index - 1]!; this.#state.scale = this.scaleFor(this.#state.quality); this.#state.downgradeCount += 1; } this.#hotTicks = 0; }
  private upgrade(): void { const index = ORDER.indexOf(this.#state.quality); if (index >= 0 && index < ORDER.length - 1) { this.#state.quality = ORDER[index + 1]!; this.#state.scale = this.scaleFor(this.#state.quality); this.#state.upgradeCount += 1; } this.#stableTicks = 0; }
  private scaleFor(quality: QualityPreset): number { return { battery: 0.62, performance: 0.75, balanced: 0.88, high: 1, cinematic: 1.12 }[quality]; }
}

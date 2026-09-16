import type { Disposable, FrameId, TickId } from './types.js';
import { FRAME_ID, TICK_ID } from './types.js';
import { clamp, expSmoothingAlpha } from './deterministic.js';

export interface ClockSnapshot { readonly frame: FrameId; readonly tick: TickId; readonly elapsedSeconds: number; readonly deltaSeconds: number; readonly scaledDeltaSeconds: number; readonly alpha: number; readonly timeScale: number; readonly paused: boolean; }
export interface FrameBudgetPolicy { readonly targetFps: number; readonly minQuality: number; readonly maxQuality: number; readonly smoothing: number; readonly hysteresis: number; readonly dwellFrames: number; }
export interface FrameBudgetSnapshot { readonly quality: number; readonly movingAverageMs: number; readonly p95EstimateMs: number; readonly targetMs: number; readonly overBudget: boolean; readonly underBudget: boolean; readonly dwellFrames: number; }

export class SimulationClock implements Disposable {
  private accumulator = 0;
  private elapsed = 0;
  private delta = 0;
  private frame = 0 as FrameId;
  private tick = 0 as TickId;
  private timeScale = 1;
  private paused = false;
  private _disposed = false;
  private readonly step: number;
  private readonly maxSubSteps: number;

  public constructor(stepSeconds = 1 / 60, maxSubSteps = 5) {
    this.step = Math.max(1e-6, Number.isFinite(stepSeconds) ? stepSeconds : 1 / 60);
    this.maxSubSteps = Math.max(1, Math.trunc(maxSubSteps));
  }
  public get disposed(): boolean { return this._disposed; }
  public get snapshot(): ClockSnapshot { return Object.freeze({ frame: this.frame, tick: this.tick, elapsedSeconds: this.elapsed, deltaSeconds: this.delta, scaledDeltaSeconds: this.delta * this.timeScale, alpha: clamp(this.accumulator / this.step, 0, 1), timeScale: this.timeScale, paused: this.paused }); }
  public setTimeScale(value: number): void { if (!this._disposed) this.timeScale = clamp(Number.isFinite(value) ? value : 1, 0, 4); }
  public pause(): void { if (!this._disposed) this.paused = true; }
  public resume(): void { if (!this._disposed) this.paused = false; }
  public reset(): void { this.accumulator = 0; this.elapsed = 0; this.delta = 0; this.frame = FRAME_ID(0); this.tick = TICK_ID(0); }
  public advance(deltaSeconds: number, step: (tick: TickId, deltaSeconds: number) => void): ClockSnapshot {
    if (this._disposed) return this.snapshot;
    const raw = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.25);
    this.frame = FRAME_ID(Number(this.frame) + 1);
    if (this.paused) { this.delta = 0; return this.snapshot; }
    this.delta = raw;
    this.accumulator += raw * this.timeScale;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSubSteps) {
      this.accumulator -= this.step;
      this.elapsed += this.step;
      this.tick = TICK_ID(Number(this.tick) + 1);
      step(this.tick, this.step);
      steps += 1;
    }
    if (steps === this.maxSubSteps && this.accumulator >= this.step) this.accumulator = 0;
    return this.snapshot;
  }
  public dispose(): void { this._disposed = true; this.reset(); }
}

export class FrameBudgetController {
  private readonly policy: FrameBudgetPolicy;
  private quality: number;
  private movingAverageMs = 0;
  private readonly recent: number[] = [];
  private readonly maxRecent = 120;
  private dwellFrames = 0;

  public constructor(policy: Partial<FrameBudgetPolicy> = {}) {
    this.policy = Object.freeze({ targetFps: clamp(policy.targetFps ?? 60, 20, 240), minQuality: clamp(policy.minQuality ?? 0.5, 0.1, 1), maxQuality: clamp(policy.maxQuality ?? 1, 0.1, 2), smoothing: clamp(policy.smoothing ?? 4, 0.1, 30), hysteresis: clamp(policy.hysteresis ?? 0.08, 0, 0.5), dwellFrames: Math.max(1, Math.trunc(policy.dwellFrames ?? 30)) });
    this.quality = this.policy.maxQuality;
  }
  public get targetMs(): number { return 1000 / this.policy.targetFps; }
  public get snapshot(): FrameBudgetSnapshot {
    const sorted = [...this.recent].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    const p95 = sorted.length ? sorted[index] ?? 0 : 0;
    return Object.freeze({ quality: this.quality, movingAverageMs: this.movingAverageMs, p95EstimateMs: p95, targetMs: this.targetMs, overBudget: p95 > this.targetMs * (1 + this.policy.hysteresis), underBudget: p95 > 0 && p95 < this.targetMs * (1 - this.policy.hysteresis), dwellFrames: this.dwellFrames });
  }
  public observe(frameMs: number): FrameBudgetSnapshot {
    if (!Number.isFinite(frameMs)) return this.snapshot;
    const value = clamp(frameMs, 0, 1000);
    this.recent.push(value);
    if (this.recent.length > this.maxRecent) this.recent.shift();
    const alpha = expSmoothingAlpha(this.policy.smoothing, 1 / this.policy.targetFps);
    this.movingAverageMs = this.movingAverageMs === 0 ? value : this.movingAverageMs + (value - this.movingAverageMs) * alpha;
    const current = this.snapshot;
    if (this.dwellFrames > 0) this.dwellFrames -= 1;
    if (this.dwellFrames === 0) {
      if (current.overBudget) { this.quality = Math.max(this.policy.minQuality, this.quality * 0.93); this.dwellFrames = this.policy.dwellFrames; }
      else if (current.underBudget) { this.quality = Math.min(this.policy.maxQuality, this.quality * 1.035); this.dwellFrames = this.policy.dwellFrames; }
    }
    return this.snapshot;
  }
  public reset(): void { this.quality = this.policy.maxQuality; this.movingAverageMs = 0; this.recent.length = 0; this.dwellFrames = 0; }
}

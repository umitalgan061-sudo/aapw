import type { SchedulerBudget } from './types';
import { clamp01 } from './deterministic';

export interface BudgetInput {
  readonly frameMsTarget?: number;
  readonly measuredFrameMs?: number;
  readonly pressure?: number;
  readonly visibleObjects?: number;
  readonly pendingStreaming?: number;
  readonly pendingAnimations?: number;
}

export interface BudgetPlan extends SchedulerBudget {
  readonly renderBudgetMs: number;
  readonly simulationBudgetMs: number;
  readonly streamingBudgetMs: number;
  readonly animationBudgetMs: number;
  readonly maxVisibleObjects: number;
  readonly maxTextureUploads: number;
}

/** Converts measured frame pressure into explicit subsystem budgets rather than implicit overload. */
export function planFrameBudget(input: BudgetInput = {}): BudgetPlan {
  const target = Math.max(8, input.frameMsTarget ?? 16.6667);
  const measured = Math.max(0, input.measuredFrameMs ?? target);
  const pressure = clamp01(input.pressure ?? Math.max(0, measured / target - 0.8));
  const headroom = Math.max(0.2, Math.min(1.2, 1 - pressure * 0.65));
  const cpuMs = target * 0.72 * headroom;
  const gpuMs = target * 0.78 * headroom;
  const maxTasks = Math.max(8, Math.floor(48 * headroom));
  const renderBudgetMs = cpuMs * 0.32;
  const simulationBudgetMs = cpuMs * 0.28;
  const streamingBudgetMs = cpuMs * 0.18;
  const animationBudgetMs = cpuMs * 0.12;
  const requestedVisible = Math.max(64, input.visibleObjects ?? 1024);
  const maxVisibleObjects = Math.max(64, Math.floor(requestedVisible * (1 - pressure * 0.55)));
  const maxTextureUploads = Math.max(1, Math.floor(8 * headroom));
  return { cpuMs, gpuMs, maxTasks, renderBudgetMs, simulationBudgetMs, streamingBudgetMs, animationBudgetMs, maxVisibleObjects, maxTextureUploads };
}

export class FramePacer {
  #targetMs: number;
  #emaMs: number;
  #alpha: number;
  #overBudgetFrames = 0;
  #underBudgetFrames = 0;

  constructor(targetMs = 16.6667, smoothing = 0.1) {
    this.#targetMs = Math.max(1, targetMs);
    this.#emaMs = this.#targetMs;
    this.#alpha = Math.min(1, Math.max(0.01, smoothing));
  }

  observe(frameMs: number): { readonly pressure: number; readonly overBudget: boolean; readonly consecutiveOver: number; readonly consecutiveUnder: number } {
    const measured = Math.max(0, frameMs);
    this.#emaMs += (measured - this.#emaMs) * this.#alpha;
    const pressure = clamp01(this.#emaMs / this.#targetMs - 0.75);
    if (this.#emaMs > this.#targetMs * 1.05) {
      this.#overBudgetFrames += 1;
      this.#underBudgetFrames = 0;
    } else if (this.#emaMs < this.#targetMs * 0.82) {
      this.#underBudgetFrames += 1;
      this.#overBudgetFrames = 0;
    } else {
      this.#overBudgetFrames = 0;
      this.#underBudgetFrames = 0;
    }
    return { pressure, overBudget: this.#overBudgetFrames > 0, consecutiveOver: this.#overBudgetFrames, consecutiveUnder: this.#underBudgetFrames };
  }

  setTarget(targetMs: number): void { this.#targetMs = Math.max(1, targetMs); }
  get emaMs(): number { return this.#emaMs; }
  get targetMs(): number { return this.#targetMs; }
  reset(): void { this.#emaMs = this.#targetMs; this.#overBudgetFrames = 0; this.#underBudgetFrames = 0; }
}

import type { RenderViewV4 } from './runtimeContractsV4';
import { type RuntimeHealthV4, type TickId, type QualityTierV4, tickId } from './runtimeContractsV4';
import type { CameraStateV6, FrameId, RenderBudgetV6, SceneFrameV6, PlayerStateV6, SceneChunkV6, SceneObjectId } from './typedSceneContractsV6';
import { frameId } from './typedSceneContractsV6';

export interface RenderLoopClockV6 { readonly now: () => number; }
export interface RenderLoopHooksV6 {
  readonly beforeFrame?: (frame: FrameContextV6) => void | Promise<void>;
  readonly afterFrame?: (frame: FrameContextV6, result: RenderResultV6) => void | Promise<void>;
  readonly onError?: (error: Error, frame: FrameContextV6) => void;
}
export interface FrameContextV6 {
  readonly frame: FrameId;
  readonly tick: TickId;
  readonly nowMs: number;
  readonly deltaMs: number;
  readonly alpha: number;
  readonly budget: RenderBudgetV6;
}
export interface RenderResultV6 {
  readonly frame: FrameId;
  readonly submitted: boolean;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visible: number;
  readonly culled: number;
  readonly cpuMs: number;
  readonly budgetMs: number;
  readonly quality: QualityTierV4;
}
export interface RenderLoopConfigV6 {
  readonly fixedStepMs?: number;
  readonly maxDeltaMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly targetFrameMs?: number;
  readonly initialQuality?: QualityTierV4;
  readonly minQuality?: QualityTierV4;
  readonly maxFramesWithoutProgress?: number;
}
export interface RenderLoopMetricsV6 {
  readonly frames: number;
  readonly ticks: number;
  readonly droppedFrames: number;
  readonly clampedDeltas: number;
  readonly simulationSteps: number;
  readonly renderCalls: number;
  readonly renderErrors: number;
  readonly qualityChanges: number;
  readonly totalCpuMs: number;
  readonly maxCpuMs: number;
}

const QUALITY: readonly QualityTierV4[] = ['minimal','low','medium','high','ultra'];
const rank = (value: QualityTierV4): number => QUALITY.indexOf(value);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const qualityAt = (value: number): QualityTierV4 => QUALITY[clamp(Math.trunc(value),0,QUALITY.length-1)]!;

export class TypedRenderLoopV6 {
  readonly fixedStepMs: number;
  readonly maxDeltaMs: number;
  readonly maxCatchUpSteps: number;
  readonly targetFrameMs: number;
  readonly minQuality: QualityTierV4;
  readonly maxFramesWithoutProgress: number;
  #clock: RenderLoopClockV6;
  #hooks: RenderLoopHooksV6;
  #frame = 0;
  #tick = 0;
  #accumulator = 0;
  #lastNow = 0;
  #running = false;
  #quality: QualityTierV4;
  #stableFrames = 0;
  #overloadFrames = 0;
  #metrics: RenderLoopMetricsV6 = Object.freeze({ frames:0,ticks:0,droppedFrames:0,clampedDeltas:0,simulationSteps:0,renderCalls:0,renderErrors:0,qualityChanges:0,totalCpuMs:0,maxCpuMs:0 });

  constructor(clock: RenderLoopClockV6 = { now: () => performance.now() }, config: RenderLoopConfigV6 = {}, hooks: RenderLoopHooksV6 = {}) {
    this.#clock = clock; this.#hooks = hooks;
    this.fixedStepMs = Math.max(1, finite(config.fixedStepMs, 1000/60));
    this.maxDeltaMs = Math.max(this.fixedStepMs, finite(config.maxDeltaMs, 250));
    this.maxCatchUpSteps = Math.max(1, Math.min(16, Math.trunc(finite(config.maxCatchUpSteps, 4))));
    this.targetFrameMs = Math.max(4, finite(config.targetFrameMs, 16.67));
    this.#quality = config.initialQuality ?? 'high';
    this.minQuality = config.minQuality ?? 'low';
    this.maxFramesWithoutProgress = Math.max(30, Math.trunc(finite(config.maxFramesWithoutProgress, 120)));
    this.#lastNow = this.#clock.now();
  }

  start(nowMs = this.#clock.now()): void { this.#running = true; this.#lastNow = finite(nowMs,this.#clock.now()); this.#accumulator = 0; }
  pause(): void { this.#running = false; }
  resume(nowMs = this.#clock.now()): void { this.start(nowMs); }
  running(): boolean { return this.#running; }
  frame(): FrameId { return frameId(this.#frame); }
  tick(): TickId { return tickId(this.#tick); }
  quality(): QualityTierV4 { return this.#quality; }
  metrics(): RenderLoopMetricsV6 { return this.#metrics; }

  async step(render: (context: FrameContextV6) => Promise<RenderResultV6> | RenderResultV6, simulate: (tick: TickId, deltaMs: number) => void | Promise<void>, nowMs = this.#clock.now()): Promise<RenderResultV6 | null> {
    if (!this.#running) return null;
    const rawDelta = finite(nowMs,this.#lastNow) - this.#lastNow; this.#lastNow = finite(nowMs,this.#lastNow);
    const delta = clamp(rawDelta,0,this.maxDeltaMs);
    if (delta !== rawDelta) this.#metrics = Object.freeze({ ...this.#metrics, clampedDeltas:this.#metrics.clampedDeltas+1 });
    this.#accumulator += delta;
    let steps = 0;
    while (this.#accumulator >= this.fixedStepMs && steps < this.maxCatchUpSteps) {
      const tick = tickId(this.#tick + 1); await simulate(tick,this.fixedStepMs); this.#tick += 1; this.#accumulator -= this.fixedStepMs; steps += 1;
    }
    if (this.#accumulator >= this.fixedStepMs) { this.#accumulator = 0; this.#metrics = Object.freeze({ ...this.#metrics, droppedFrames:this.#metrics.droppedFrames+1 }); }
    this.#frame += 1;
    const budget = this.budget();
    const context: FrameContextV6 = Object.freeze({ frame:frameId(this.#frame), tick:tickId(this.#tick), nowMs:this.#lastNow, deltaMs:delta, alpha:clamp(this.#accumulator/this.fixedStepMs,0,1), budget });
    const started = this.#clock.now();
    try {
      this.#hooks.beforeFrame && await this.#hooks.beforeFrame(context);
      const result = Object.freeze(await render(context));
      const cpuMs = Math.max(0,this.#clock.now()-started);
      this.#metrics = Object.freeze({ ...this.#metrics, frames:this.#frame, ticks:this.#tick, simulationSteps:this.#metrics.simulationSteps+steps, renderCalls:this.#metrics.renderCalls+(result.submitted?1:0), totalCpuMs:this.#metrics.totalCpuMs+cpuMs, maxCpuMs:Math.max(this.#metrics.maxCpuMs,cpuMs) });
      this.#adaptQuality(cpuMs);
      this.#hooks.afterFrame && await this.#hooks.afterFrame(context,result);
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('render loop frame failed');
      this.#metrics = Object.freeze({ ...this.#metrics, frames:this.#frame, ticks:this.#tick, renderErrors:this.#metrics.renderErrors+1 });
      this.#hooks.onError?.(error,context);
      return Object.freeze({ frame:context.frame, submitted:false, drawCalls:0, triangles:0, visible:0, culled:0, cpuMs:Math.max(0,this.#clock.now()-started), budgetMs:context.budget.targetMs, quality:this.#quality });
    }
  }

  budget(): RenderBudgetV6 {
    const factor = this.#quality === 'ultra' ? 1.15 : this.#quality === 'high' ? 1 : this.#quality === 'medium' ? 0.82 : this.#quality === 'low' ? 0.66 : 0.48;
    return Object.freeze({ targetMs:this.targetFrameMs, cpuMs:this.targetFrameMs*0.42, gpuMs:this.targetFrameMs*0.72, drawCalls:Math.max(30,Math.round(950*factor)), triangles:Math.max(5000,Math.round(1_200_000*factor)), maxVisibleObjects:Math.max(100,Math.round(1600*factor)), maxShadowCasters:Math.max(30,Math.round(300*factor)), renderScale:factor });
  }

  createSceneFrame(runtime: string, camera: CameraStateV6, player: PlayerStateV6 | null, chunks: readonly SceneChunkV6[], visibleObjects: readonly SceneObjectId[], health: RuntimeHealthV4): SceneFrameV6 {
    return Object.freeze({ runtime:runtime as never, phase: health.phase, tick:tickId(this.#tick), frame:frameId(this.#frame), deltaMs:this.fixedStepMs, camera, player, chunks:Object.freeze(chunks.slice()), visibleObjects:Object.freeze(visibleObjects.slice()), renderBudget:this.budget(), health });
  }

  reset(): void { this.#frame=0; this.#tick=0; this.#accumulator=0; this.#stableFrames=0; this.#overloadFrames=0; this.#running=false; this.#metrics = Object.freeze({ frames:0,ticks:0,droppedFrames:0,clampedDeltas:0,simulationSteps:0,renderCalls:0,renderErrors:0,qualityChanges:0,totalCpuMs:0,maxCpuMs:0 }); }

  private #adaptQuality(cpuMs: number): void {
    if (cpuMs > this.targetFrameMs * 1.12) { this.#overloadFrames += 1; this.#stableFrames = 0; }
    else if (cpuMs < this.targetFrameMs * 0.72) { this.#stableFrames += 1; this.#overloadFrames = 0; }
    else { this.#stableFrames=Math.max(0,this.#stableFrames-1); this.#overloadFrames=Math.max(0,this.#overloadFrames-1); }
    if (this.#overloadFrames >= 10 && rank(this.#quality)>rank(this.minQuality)) { this.#quality=qualityAt(rank(this.#quality)-1); this.#overloadFrames=0; this.#metrics=Object.freeze({ ...this.#metrics, qualityChanges:this.#metrics.qualityChanges+1 }); }
    else if (this.#stableFrames >= 50 && rank(this.#quality)<rank('ultra')) { this.#quality=qualityAt(rank(this.#quality)+1); this.#stableFrames=0; this.#metrics=Object.freeze({ ...this.#metrics, qualityChanges:this.#metrics.qualityChanges+1 }); }
  }
}

export function makeHeadlessRenderResultV6(frame: FrameContextV6): RenderResultV6 { return Object.freeze({ frame:frame.frame, submitted:true, drawCalls:0, triangles:0, visible:0, culled:0, cpuMs:0, budgetMs:frame.budget.targetMs, quality:'safe' }); }

export function calculateVisibilityBudgetV6(quality: QualityTierV4, objectCount: number): number { const multiplier = quality === 'ultra' ? 1 : quality === 'high' ? 0.8 : quality === 'medium' ? 0.6 : quality === 'low' ? 0.4 : 0.2; return Math.max(0, Math.min(Math.trunc(objectCount), Math.round(objectCount*multiplier))); }

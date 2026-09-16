import type { Disposable, FrameContext, Result, Tick } from './coreTypes.ts';
import { err, ok } from './coreTypes.ts';
import { ModernEngine, type EngineFrameReport, type ModernEngineOptions } from './modernEngine.ts';
import { RenderTelemetry, type RenderFrameStats } from './renderBridge.ts';

export type LegacyRuntimePhase = 'boot' | 'loading' | 'ready' | 'running' | 'paused' | 'error' | 'disposed';
export type RuntimeBackendPreference = 'auto' | 'webgpu' | 'webgl2';
export type RuntimeQuality = 'safe' | 'low' | 'medium' | 'high' | 'ultra';

export interface LegacySceneLike {
  readonly scene: unknown;
  readonly camera: unknown;
  readonly renderer: {
    readonly render?: (scene: unknown, camera: unknown) => void;
    readonly info?: { readonly render?: { readonly calls?: number; readonly triangles?: number } };
    dispose?: () => void;
  };
  readonly chunkManager?: { readonly loadedCount?: number };
  readonly renderQuality?: string;
}

export interface TypedRuntimeOptions {
  readonly seed?: string | number;
  readonly preference?: RuntimeBackendPreference;
  readonly quality?: RuntimeQuality;
  readonly gpuBudgetMs?: number;
  readonly saveStorage?: StorageLike;
  readonly strictDeterminism?: boolean;
  readonly telemetryCapacity?: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RuntimeFrameInput {
  readonly nowMs: number;
  readonly deltaSeconds: number;
  readonly scene?: LegacySceneLike | null;
  readonly phase?: LegacyRuntimePhase;
  readonly paused?: boolean;
}

export interface RuntimeFrameReport extends EngineFrameReport {
  readonly phase: LegacyRuntimePhase;
  readonly paused: boolean;
  readonly legacyDrawCalls: number;
  readonly legacyTriangles: number;
  readonly loadedChunks: number;
  readonly cpuFrameMs: number;
}

export interface RuntimeSnapshot {
  readonly schemaVersion: 2;
  readonly phase: LegacyRuntimePhase;
  readonly paused: boolean;
  readonly frameId: number;
  readonly tick: Tick;
  readonly backend: string;
  readonly quality: RuntimeQuality;
  readonly worldEntities: number;
  readonly loadedChunks: number;
  readonly telemetry: ReturnType<RenderTelemetry['summary']>;
}

interface RuntimeState {
  phase: LegacyRuntimePhase;
  paused: boolean;
  frameStartMs: number;
  lastNowMs: number;
  frameCount: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const positive = (value: number, fallback = 0): number => Math.max(0, finite(value, fallback));

export class TypedRuntimeComposition implements Disposable {
  readonly engine: ModernEngine;
  readonly telemetry: RenderTelemetry;
  private state: RuntimeState = { phase: 'boot', paused: false, frameStartMs: 0, lastNowMs: 0, frameCount: 0 };
  private disposed = false;
  private attachedScene: LegacySceneLike | null = null;

  constructor(options: TypedRuntimeOptions = {}) {
    const modernOptions: ModernEngineOptions = {
      seed: options.seed ?? 'aapw-typed-runtime-r1',
      render: {
        preference: options.preference ?? 'auto',
        quality: options.quality ?? 'high',
        gpuBudgetMs: options.gpuBudgetMs ?? 12,
      },
      saveStorage: options.saveStorage,
      strictDeterminism: options.strictDeterminism ?? false,
    };
    this.engine = new ModernEngine(modernOptions);
    this.telemetry = new RenderTelemetry(options.telemetryCapacity ?? 240);
    this.state = { ...this.state, phase: 'loading' };
  }

  get phase(): LegacyRuntimePhase { return this.state.phase; }
  get paused(): boolean { return this.state.paused; }
  get disposed(): boolean { return this.disposed; }

  attachScene(scene: LegacySceneLike): void {
    this.ensureLive();
    this.attachedScene = scene;
    if (scene.renderQuality && this.state.phase === 'loading') this.state.phase = 'ready';
  }

  markReady(): void {
    this.ensureLive();
    if (this.state.phase === 'disposed' || this.state.phase === 'error') return;
    this.state.phase = 'ready';
    this.engine.initialize(this.state.lastNowMs);
  }

  setPaused(paused: boolean): void {
    this.ensureLive();
    this.state.paused = Boolean(paused);
    this.state.phase = this.state.paused ? 'paused' : (this.state.phase === 'paused' ? 'running' : this.state.phase);
  }

  frame(input: RuntimeFrameInput): Result<RuntimeFrameReport, string> {
    if (this.disposed) return err('typed runtime disposed');
    const nowMs = finite(input.nowMs, this.state.lastNowMs);
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (input.scene) this.attachedScene = input.scene;
    if (input.phase) this.state.phase = input.phase;
    if (typeof input.paused === 'boolean') this.setPaused(input.paused);
    const paused = this.state.paused;
    const scene = input.scene ?? this.attachedScene;
    if (this.state.phase === 'boot' || this.state.phase === 'loading') this.markReady();
    this.engine.initialize(nowMs);
    const engineNow = paused && this.state.lastNowMs > 0 ? this.state.lastNowMs : nowMs;
    const report = this.engine.step(engineNow);
    const elapsed = positive((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    const drawCalls = positive(scene?.renderer.info?.render?.calls ?? 0);
    const triangles = positive(scene?.renderer.info?.render?.triangles ?? 0);
    this.telemetry.push(Object.freeze({
      cpuMs: elapsed,
      gpuMs: report.scheduler.spentMs,
      drawCalls,
      triangles,
      visibleObjects: report.renderPolicy.maxVisibleObjects,
      shadowObjects: report.renderPolicy.maxShadowCasters,
      resolutionScale: report.renderPolicy.renderScale,
    } satisfies RenderFrameStats));
    this.state.lastNowMs = nowMs;
    this.state.frameCount += 1;
    this.state.phase = paused ? 'paused' : 'running';
    return ok(Object.freeze({
      ...report,
      phase: this.state.phase,
      paused,
      legacyDrawCalls: drawCalls,
      legacyTriangles: triangles,
      loadedChunks: scene?.chunkManager?.loadedCount ?? 0,
      cpuFrameMs: elapsed,
    }));
  }

  diagnostics(): RuntimeSnapshot {
    this.ensureLive();
    const report = this.engine.exportDiagnostics();
    const scene = this.attachedScene;
    return Object.freeze({
      schemaVersion: 2,
      phase: this.state.phase,
      paused: this.state.paused,
      frameId: this.state.frameCount,
      tick: report.tick as Tick,
      backend: this.engine.renderPolicy.backend,
      quality: this.engine.renderPolicy.quality,
      worldEntities: this.engine.world.entities.length,
      loadedChunks: scene?.chunkManager?.loadedCount ?? 0,
      telemetry: this.telemetry.summary(),
    });
  }

  resetForMigration(nowMs = 0): void {
    this.ensureLive();
    this.engine.clock.reset(nowMs);
    this.state = { phase: 'ready', paused: false, frameStartMs: nowMs, lastNowMs: nowMs, frameCount: 0 };
    this.telemetry.dispose();
    this.attachedScene = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state.phase = 'disposed';
    this.engine.dispose();
    this.telemetry.dispose();
    this.attachedScene = null;
  }

  private ensureLive(): void {
    if (this.disposed) throw new Error('typed runtime disposed');
  }
}

export interface TypedRuntimeSession {
  readonly runtime: TypedRuntimeComposition;
  readonly attach: (scene: LegacySceneLike) => void;
  readonly frame: (input: RuntimeFrameInput) => Result<RuntimeFrameReport, string>;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly diagnostics: () => RuntimeSnapshot;
  readonly dispose: () => void;
}

export const createTypedRuntimeSession = (options: TypedRuntimeOptions = {}): Result<TypedRuntimeSession, string> => {
  try {
    const runtime = new TypedRuntimeComposition(options);
    return ok(Object.freeze({
      runtime,
      attach: (scene: LegacySceneLike) => runtime.attachScene(scene),
      frame: (input: RuntimeFrameInput) => runtime.frame(input),
      pause: () => runtime.setPaused(true),
      resume: () => runtime.setPaused(false),
      diagnostics: () => runtime.diagnostics(),
      dispose: () => runtime.dispose(),
    }));
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : 'typed runtime creation failed');
  }
};

export interface MigrationBoundaryStats {
  readonly typedFrames: number;
  readonly legacyFrames: number;
  readonly typedErrors: number;
  readonly legacyErrors: number;
  readonly handoffCount: number;
  readonly lastHandoffTick: Tick;
}

export class MigrationBoundaryTracker {
  private value: MigrationBoundaryStats = Object.freeze({ typedFrames: 0, legacyFrames: 0, typedErrors: 0, legacyErrors: 0, handoffCount: 0, lastHandoffTick: 0 as Tick });

  noteTypedFrame(tick: Tick): void { this.value = Object.freeze({ ...this.value, typedFrames: this.value.typedFrames + 1, lastHandoffTick: tick }); }
  noteLegacyFrame(): void { this.value = Object.freeze({ ...this.value, legacyFrames: this.value.legacyFrames + 1 }); }
  noteTypedError(): void { this.value = Object.freeze({ ...this.value, typedErrors: this.value.typedErrors + 1 }); }
  noteLegacyError(): void { this.value = Object.freeze({ ...this.value, legacyErrors: this.value.legacyErrors + 1 }); }
  noteHandoff(tick: Tick): void { this.value = Object.freeze({ ...this.value, handoffCount: this.value.handoffCount + 1, lastHandoffTick: tick }); }
  snapshot(): MigrationBoundaryStats { return this.value; }
  reset(): void { this.value = Object.freeze({ typedFrames: 0, legacyFrames: 0, typedErrors: 0, legacyErrors: 0, handoffCount: 0, lastHandoffTick: 0 as Tick }); }
  assertHealthy(maxTypedErrors = 0): void {
    if (this.value.typedErrors > maxTypedErrors) throw new Error(`typed runtime errors exceeded gate: ${this.value.typedErrors}`);
    if (this.value.typedFrames > 0 && this.value.handoffCount === 0) throw new Error('typed runtime ran without recording a migration handoff');
  }
}

export interface RuntimeBudget {
  readonly totalMs: number;
  readonly inputMs: number;
  readonly simulationMs: number;
  readonly aiMs: number;
  readonly streamingMs: number;
  readonly animationMs: number;
  readonly presentationMs: number;
  readonly renderMs: number;
  readonly postMs: number;
}

const BUDGET_RATIO = Object.freeze({ input: 0.06, simulation: 0.24, ai: 0.14, streaming: 0.1, animation: 0.1, presentation: 0.08, render: 0.22, post: 0.06 });

export const deriveRuntimeBudget = (targetFrameMs: number, pressure = 0): RuntimeBudget => {
  const totalMs = Math.max(4, Number.isFinite(targetFrameMs) ? targetFrameMs : 16.6);
  const normalizedPressure = Math.min(1, Math.max(0, pressure));
  const effective = totalMs * (1 - normalizedPressure * 0.2);
  return Object.freeze({
    totalMs: effective,
    inputMs: effective * BUDGET_RATIO.input,
    simulationMs: effective * BUDGET_RATIO.simulation,
    aiMs: effective * BUDGET_RATIO.ai,
    streamingMs: effective * BUDGET_RATIO.streaming,
    animationMs: effective * BUDGET_RATIO.animation,
    presentationMs: effective * BUDGET_RATIO.presentation,
    renderMs: effective * BUDGET_RATIO.render,
    postMs: effective * BUDGET_RATIO.post,
  });
};

export interface QualityHysteresisOptions { readonly downFrames?: number; readonly upFrames?: number; readonly cooldownFrames?: number; }
const QUALITY_ORDER: readonly RuntimeQuality[] = ['safe', 'low', 'medium', 'high', 'ultra'];

export class QualityHysteresisController {
  private value: RuntimeQuality;
  private overFrames = 0;
  private underFrames = 0;
  private cooldown = 0;
  private readonly downFrames: number;
  private readonly upFrames: number;
  private readonly cooldownFrames: number;

  constructor(initial: RuntimeQuality = 'high', options: QualityHysteresisOptions = {}) {
    this.value = initial;
    this.downFrames = Math.max(2, Math.trunc(options.downFrames ?? 12));
    this.upFrames = Math.max(4, Math.trunc(options.upFrames ?? 36));
    this.cooldownFrames = Math.max(0, Math.trunc(options.cooldownFrames ?? 18));
  }

  get quality(): RuntimeQuality { return this.value; }

  update(frameMs: number, targetMs: number): RuntimeQuality {
    if (this.cooldown > 0) this.cooldown -= 1;
    const over = frameMs > targetMs * 1.18;
    const under = frameMs < targetMs * 0.8;
    if (over) { this.overFrames += 1; this.underFrames = 0; }
    else if (under) { this.underFrames += 1; this.overFrames = 0; }
    else { this.overFrames = Math.max(0, this.overFrames - 1); this.underFrames = Math.max(0, this.underFrames - 1); }
    if (this.cooldown === 0 && this.overFrames >= this.downFrames) this.step(-1);
    else if (this.cooldown === 0 && this.underFrames >= this.upFrames) this.step(1);
    return this.value;
  }

  reset(value: RuntimeQuality = 'high'): void { this.value = value; this.overFrames = 0; this.underFrames = 0; this.cooldown = 0; }

  private step(direction: -1 | 1): void {
    const index = QUALITY_ORDER.indexOf(this.value);
    const next = QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, Math.max(0, index + direction))];
    if (next && next !== this.value) { this.value = next; this.cooldown = this.cooldownFrames; }
    this.overFrames = 0;
    this.underFrames = 0;
  }
}

export interface RuntimeFeatureFlags {
  readonly typedEngine: boolean;
  readonly typedPersistence: boolean;
  readonly typedInput: boolean;
  readonly typedAssets: boolean;
  readonly typedRenderPolicy: boolean;
  readonly workerPlanning: boolean;
  readonly strictDeterminism: boolean;
}

export const DEFAULT_RUNTIME_FEATURES: RuntimeFeatureFlags = Object.freeze({
  typedEngine: true,
  typedPersistence: true,
  typedInput: true,
  typedAssets: true,
  typedRenderPolicy: true,
  workerPlanning: true,
  strictDeterminism: false,
});

export const validateFeatureFlags = (flags: Partial<RuntimeFeatureFlags>): RuntimeFeatureFlags => Object.freeze({
  typedEngine: flags.typedEngine ?? DEFAULT_RUNTIME_FEATURES.typedEngine,
  typedPersistence: flags.typedPersistence ?? DEFAULT_RUNTIME_FEATURES.typedPersistence,
  typedInput: flags.typedInput ?? DEFAULT_RUNTIME_FEATURES.typedInput,
  typedAssets: flags.typedAssets ?? DEFAULT_RUNTIME_FEATURES.typedAssets,
  typedRenderPolicy: flags.typedRenderPolicy ?? DEFAULT_RUNTIME_FEATURES.typedRenderPolicy,
  workerPlanning: flags.workerPlanning ?? DEFAULT_RUNTIME_FEATURES.workerPlanning,
  strictDeterminism: flags.strictDeterminism ?? DEFAULT_RUNTIME_FEATURES.strictDeterminism,
});

export const assertTypedRuntimeContract = (runtime: TypedRuntimeComposition): void => {
  const diagnostics = runtime.diagnostics();
  if (diagnostics.schemaVersion !== 2) throw new Error('typed runtime snapshot schema mismatch');
  if (diagnostics.backend === 'unavailable') throw new Error('typed runtime has no usable backend');
  if (diagnostics.quality === 'ultra' && diagnostics.telemetry.avgCpuMs > 100) throw new Error('runtime quality is implausible under observed CPU pressure');
};

export const createRuntimeFrameContext = (tick: Tick, frameId: number, deltaSeconds: number, budgetMs = 16.6): FrameContext => Object.freeze({
  tick,
  simulationTimeMs: Math.max(0, tick * 16.6667),
  deltaSeconds: Math.max(0, deltaSeconds),
  interpolationAlpha: 0,
  frameId: Math.max(0, Math.trunc(frameId)),
  budgetMs: Math.max(1, budgetMs),
  deadlineMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) + Math.max(1, budgetMs),
});

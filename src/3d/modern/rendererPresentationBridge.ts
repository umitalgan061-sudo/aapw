import type { QualityTier, RuntimeSnapshot } from './types';
import { RendererGpuTimer } from './rendererGpuTimer';

export interface RendererInfoLike {
  readonly render?: { readonly calls?: number; readonly triangles?: number };
  readonly memory?: { readonly textures?: number; readonly geometries?: number };
}

export interface RendererPresentationLike {
  readonly info?: RendererInfoLike;
  readonly shadowMap?: { enabled?: boolean };
  setPixelRatio?: (value: number) => void;
  getPixelRatio?: () => number;
}

export interface LegacyRenderMetrics {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textureCount: number;
  readonly geometryCount: number;
}

export interface RendererPresentationBridgeOptions {
  readonly renderer?: RendererPresentationLike | null;
  readonly rendererProvider?: () => RendererPresentationLike | null;
  readonly devicePixelRatio?: () => number;
  readonly maxPixelRatio?: number;
  readonly minPixelRatio?: number;
  readonly minFramesBetweenChanges?: number;
}

export interface RendererPresentationDiagnostics {
  readonly initialized: boolean;
  readonly quality: QualityTier | null;
  readonly targetScale: number;
  readonly appliedScale: number;
  readonly baselinePixelRatio: number | null;
  readonly pixelRatio: number | null;
  readonly shadowBaseline: boolean;
  readonly shadowsActive: boolean | null;
  readonly changes: number;
  readonly gpuTimingSupported: boolean;
  readonly gpuSamples: number;
  readonly lastGpuMs: number | null;
}

export type PresentationPressure = number | RuntimeSnapshot['pressure'];
type RenderMethod = (...args: unknown[]) => unknown;
type InstrumentableRenderer = RendererPresentationLike & { render?: RenderMethod };

interface RendererInstrumentation {
  readonly timer: RendererGpuTimer;
  readonly originalRender: RenderMethod;
  references: number;
}

const RENDERER_INSTRUMENTATION = new WeakMap<object, RendererInstrumentation>();
const QUALITY_SCALE: Readonly<Record<QualityTier, number>> = Object.freeze({ minimal: 0.62, balanced: 0.78, high: 0.91, ultra: 1 });
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finiteNonNegativeInt = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
};

export function readLegacyRenderMetrics(state: unknown): LegacyRenderMetrics {
  const candidate = state as { renderer?: { info?: RendererInfoLike } } | null | undefined;
  const render = candidate?.renderer?.info?.render;
  const memory = candidate?.renderer?.info?.memory;
  return Object.freeze({
    drawCalls: finiteNonNegativeInt(render?.calls),
    triangles: finiteNonNegativeInt(render?.triangles),
    textureCount: finiteNonNegativeInt(memory?.textures),
    geometryCount: finiteNonNegativeInt(memory?.geometries),
  });
}

export class RendererPresentationBridge {
  #rendererProvider: () => RendererPresentationLike | null;
  #devicePixelRatio: () => number;
  #maxPixelRatio: number;
  #minPixelRatio: number;
  #minFramesBetweenChanges: number;
  #baseDevicePixelRatio: number;
  #baselinePixelRatio: number | null;
  #lastQuality: QualityTier | null = null;
  #targetScale = 1;
  #appliedScale = 1;
  #cooldown = 0;
  #changes = 0;
  #shadowBaseline = false;
  #instrumentation: RendererInstrumentation | null = null;

  constructor(options: RendererPresentationBridgeOptions = {}) {
    const fixedRenderer = options.renderer ?? null;
    this.#rendererProvider = options.rendererProvider ?? (() => fixedRenderer);
    this.#devicePixelRatio = options.devicePixelRatio ?? (() => typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    this.#maxPixelRatio = clamp(Number(options.maxPixelRatio ?? 2.5) || 2.5, 1, 4);
    this.#minPixelRatio = clamp(Number(options.minPixelRatio ?? 0.6) || 0.6, 0.5, this.#maxPixelRatio);
    this.#minFramesBetweenChanges = Math.max(4, Math.trunc(options.minFramesBetweenChanges ?? 18));
    this.#baseDevicePixelRatio = this.#readDevicePixelRatio();
    const renderer = this.#rendererProvider();
    this.#baselinePixelRatio = renderer?.getPixelRatio?.() ?? null;
    if (this.#baselinePixelRatio !== null) {
      this.#appliedScale = clamp(this.#baselinePixelRatio / this.#baseDevicePixelRatio, 0.5, this.#maxPixelRatio / this.#baseDevicePixelRatio);
      this.#targetScale = this.#appliedScale;
    }
    this.#shadowBaseline = Boolean(renderer?.shadowMap?.enabled);
    this.#instrumentation = acquireRendererInstrumentation(renderer);
  }

  refreshDevicePixelRatio(): void {
    this.#baseDevicePixelRatio = this.#readDevicePixelRatio();
    this.#applyPixelRatio(this.#appliedScale);
  }

  gpuMs(): number | undefined {
    const value = this.#instrumentation?.timer.lastGpuMs;
    return value === null || value === undefined ? undefined : value;
  }

  apply(snapshot: { readonly quality: QualityTier; readonly pressure: PresentationPressure }): void {
    const renderer = this.#rendererProvider();
    if (!renderer) return;
    if (this.#cooldown > 0) this.#cooldown -= 1;

    const pressure = this.#pressureValue(snapshot.pressure);
    const tierScale = QUALITY_SCALE[snapshot.quality];
    const pressurePenalty = pressure >= 0.86
      ? 0.16
      : pressure >= 0.72
        ? 0.10
        : pressure >= 0.58
          ? 0.05
          : pressure <= 0.12
            ? -0.035
            : 0;
    const targetScale = clamp(tierScale - pressurePenalty, 0.55, 1);
    this.#targetScale = targetScale;

    const qualityChanged = this.#lastQuality !== snapshot.quality;
    const meaningfulDelta = Math.abs(targetScale - this.#appliedScale) >= 0.025;
    if (this.#cooldown === 0 && (qualityChanged || meaningfulDelta)) {
      const nextScale = qualityChanged ? targetScale : this.#smoothStep(this.#appliedScale, targetScale, 0.35);
      if (Math.abs(nextScale - this.#appliedScale) >= 0.01) {
        this.#appliedScale = nextScale;
        this.#applyPixelRatio(nextScale);
        this.#applyShadowBudget(renderer, snapshot.quality, pressure);
        this.#cooldown = this.#minFramesBetweenChanges;
        this.#changes += 1;
      }
    } else if (qualityChanged) {
      this.#applyShadowBudget(renderer, snapshot.quality, pressure);
    }
    this.#lastQuality = snapshot.quality;
  }

  diagnostics(): RendererPresentationDiagnostics {
    const renderer = this.#rendererProvider();
    const timing = this.#instrumentation?.timer.diagnostics();
    return Object.freeze({
      initialized: Boolean(renderer),
      quality: this.#lastQuality,
      targetScale: this.#targetScale,
      appliedScale: this.#appliedScale,
      baselinePixelRatio: this.#baselinePixelRatio,
      pixelRatio: renderer?.getPixelRatio?.() ?? null,
      shadowBaseline: this.#shadowBaseline,
      shadowsActive: renderer?.shadowMap ? Boolean(renderer.shadowMap.enabled) : null,
      changes: this.#changes,
      gpuTimingSupported: timing?.supported ?? false,
      gpuSamples: timing?.samples ?? 0,
      lastGpuMs: timing?.lastGpuMs ?? null,
    });
  }

  dispose(): void {
    releaseRendererInstrumentation(this.#rendererProvider(), this.#instrumentation);
    this.#instrumentation = null;
    const renderer = this.#rendererProvider();
    if (renderer?.shadowMap) renderer.shadowMap.enabled = this.#shadowBaseline;
    if (renderer?.setPixelRatio && this.#baselinePixelRatio !== null) renderer.setPixelRatio(this.#baselinePixelRatio);
    this.#lastQuality = null;
    this.#cooldown = 0;
    this.#targetScale = 1;
    this.#appliedScale = 1;
  }

  #readDevicePixelRatio(): number {
    const value = Number(this.#devicePixelRatio());
    return clamp(Number.isFinite(value) ? value : 1, 1, this.#maxPixelRatio);
  }

  #applyPixelRatio(scale: number): void {
    const renderer = this.#rendererProvider();
    if (!renderer?.setPixelRatio) return;
    renderer.setPixelRatio(clamp(this.#baseDevicePixelRatio * scale, this.#minPixelRatio, this.#maxPixelRatio));
  }

  #applyShadowBudget(renderer: RendererPresentationLike, quality: QualityTier, pressure: number): void {
    if (!renderer.shadowMap) return;
    renderer.shadowMap.enabled = this.#shadowBaseline && quality !== 'minimal' && pressure < 0.90;
  }

  #pressureValue(value: PresentationPressure): number {
    if (typeof value === 'number') return clamp(value, 0, 1);
    return clamp(Number(value.combined) || 0, 0, 1);
  }

  #smoothStep(current: number, target: number, factor: number): number {
    const t = clamp(factor, 0.05, 1);
    return current + (target - current) * t;
  }
}

function acquireRendererInstrumentation(renderer: RendererPresentationLike | null): RendererInstrumentation | null {
  const target = renderer as InstrumentableRenderer | null;
  if (!target?.render || typeof target.render !== 'function') return null;
  const existing = RENDERER_INSTRUMENTATION.get(target);
  if (existing) {
    existing.references += 1;
    return existing;
  }
  const originalRender = target.render.bind(target) as RenderMethod;
  const timer = new RendererGpuTimer(target);
  if (!timer.supported) return null;
  const instrumentation: RendererInstrumentation = { timer, originalRender, references: 1 };
  target.render = (...args: unknown[]) => {
    timer.poll();
    timer.begin();
    try {
      return originalRender(...args);
    } finally {
      timer.end();
    }
  };
  RENDERER_INSTRUMENTATION.set(target, instrumentation);
  return instrumentation;
}

function releaseRendererInstrumentation(renderer: RendererPresentationLike | null, instrumentation: RendererInstrumentation | null): void {
  const target = renderer as InstrumentableRenderer | null;
  if (!target || !instrumentation) return;
  const current = RENDERER_INSTRUMENTATION.get(target);
  if (!current || current !== instrumentation) return;
  current.references -= 1;
  if (current.references > 0) return;
  target.render = current.originalRender;
  current.timer.dispose();
  RENDERER_INSTRUMENTATION.delete(target);
}

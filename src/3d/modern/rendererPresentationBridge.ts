import type { QualityTier, RuntimeSnapshot } from './types';

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
  readonly pixelRatio: number | null;
  readonly shadowBaseline: boolean;
  readonly shadowsActive: boolean | null;
  readonly changes: number;
}

export type PresentationPressure = number | RuntimeSnapshot['pressure'];

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
  #lastQuality: QualityTier | null = null;
  #targetScale = 1;
  #appliedScale = 1;
  #cooldown = 0;
  #changes = 0;
  #shadowBaseline = false;

  constructor(options: RendererPresentationBridgeOptions = {}) {
    const fixedRenderer = options.renderer ?? null;
    this.#rendererProvider = options.rendererProvider ?? (() => fixedRenderer);
    this.#devicePixelRatio = options.devicePixelRatio ?? (() => typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    this.#maxPixelRatio = clamp(Number(options.maxPixelRatio ?? 2.5) || 2.5, 1, 4);
    this.#minPixelRatio = clamp(Number(options.minPixelRatio ?? 0.6) || 0.6, 0.5, this.#maxPixelRatio);
    this.#minFramesBetweenChanges = Math.max(4, Math.trunc(options.minFramesBetweenChanges ?? 18));
    this.#baseDevicePixelRatio = this.#readDevicePixelRatio();
    const renderer = this.#rendererProvider();
    this.#shadowBaseline = Boolean(renderer?.shadowMap?.enabled);
  }

  refreshDevicePixelRatio(): void {
    this.#baseDevicePixelRatio = this.#readDevicePixelRatio();
    this.#applyPixelRatio(this.#appliedScale);
  }

  apply(snapshot: { readonly quality: QualityTier; readonly pressure: PresentationPressure }): void {
    const renderer = this.#rendererProvider();
    if (!renderer) return;
    if (this.#cooldown > 0) this.#cooldown -= 1;

    const pressure = this.#pressureValue(snapshot.pressure);
    const tierScale = QUALITY_SCALE[snapshot.quality];
    const pressurePenalty = pressure >= 0.86 ? 0.16 : pressure >= 0.72 ? 0.10 : pressure >= 0.58 ? 0.05 : pressure <= 0.12 ? -0.035 : 0;
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
    return Object.freeze({
      initialized: Boolean(renderer), quality: this.#lastQuality, targetScale: this.#targetScale, appliedScale: this.#appliedScale,
      pixelRatio: renderer?.getPixelRatio?.() ?? null, shadowBaseline: this.#shadowBaseline,
      shadowsActive: renderer?.shadowMap ? Boolean(renderer.shadowMap.enabled) : null, changes: this.#changes,
    });
  }

  dispose(): void {
    const renderer = this.#rendererProvider();
    if (renderer?.shadowMap && this.#shadowBaseline) renderer.shadowMap.enabled = true;
    this.#lastQuality = null;
    this.#cooldown = 0;
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
    if (!renderer.shadowMap || !this.#shadowBaseline) return;
    renderer.shadowMap.enabled = quality !== 'minimal' && pressure < 0.90;
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

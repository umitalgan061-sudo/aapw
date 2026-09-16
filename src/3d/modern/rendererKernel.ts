import type { AdaptiveQualityState, DeviceCapabilities, Disposable, FrameMetrics, QualityTier, RenderBudget, RendererBackend, RendererSelection, RuntimeError, TimestampMs } from './types';
import { DEFAULT_ADAPTIVE_QUALITY, DEFAULT_BUDGET, asTimestampMs } from './types';

export interface RendererAdapter {
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly initialized: boolean;
  init(): Promise<void>;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render?(timestampMs: number): void | Promise<void>;
  dispose(): void;
}

export interface RendererFactoryContext {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly backend: RendererBackend;
  readonly quality: QualityTier;
  readonly antialias: boolean;
}

export type RendererFactory = (context: RendererFactoryContext) => Promise<RendererAdapter>;

export interface RendererKernelOptions {
  readonly capabilities?: Partial<DeviceCapabilities>;
  readonly preferredBackend?: 'auto' | RendererBackend;
  readonly preferredQuality?: QualityTier;
  readonly budget?: Partial<RenderBudget>;
  readonly factory?: RendererFactory;
  readonly now?: () => TimestampMs;
}

export interface RenderCommand {
  readonly id: string;
  readonly pass: 'opaque' | 'alpha' | 'shadow' | 'water' | 'foliage' | 'effects' | 'post';
  readonly enabled: boolean;
  readonly estimatedMs: number;
  readonly optional: boolean;
  readonly execute: () => void | Promise<void>;
}

export interface RenderFrameReport {
  readonly timestamp: TimestampMs;
  readonly backend: RendererBackend;
  readonly executed: readonly string[];
  readonly skipped: readonly string[];
  readonly estimatedGpuMs: number;
  readonly budgetGpuMs: number;
  readonly quality: AdaptiveQualityState;
}

const TIER_RANK: Record<QualityTier, number> = {
  cinematic: 6,
  ultra: 5,
  high: 4,
  medium: 3,
  low: 2,
  safe: 1,
};

const TIER_BUDGET: Record<QualityTier, RenderBudget> = {
  cinematic: { gpuMs: 9.5, cpuMs: 7, drawCalls: 3000, triangles: 7_000_000, texturesBytes: 1024 * 1024 * 1024, instances: 12_000 },
  ultra: { gpuMs: 11, cpuMs: 8, drawCalls: 2400, triangles: 5_500_000, texturesBytes: 768 * 1024 * 1024, instances: 10_000 },
  high: DEFAULT_BUDGET,
  medium: { gpuMs: 15, cpuMs: 10, drawCalls: 1400, triangles: 2_000_000, texturesBytes: 384 * 1024 * 1024, instances: 6_000 },
  low: { gpuMs: 18, cpuMs: 12, drawCalls: 900, triangles: 1_200_000, texturesBytes: 256 * 1024 * 1024, instances: 4_000 },
  safe: { gpuMs: 22, cpuMs: 16, drawCalls: 550, triangles: 650_000, texturesBytes: 160 * 1024 * 1024, instances: 2_500 },
};

/** Universal renderer policy. WebGPU is selected when available; WebGL2 remains the safe fallback. */
export class RendererKernel implements Disposable {
  private readonly capabilities: DeviceCapabilities;
  private readonly preferredBackend: 'auto' | RendererBackend;
  private readonly factory?: RendererFactory;
  private readonly now: () => TimestampMs;
  private budget: RenderBudget;
  private adapter: RendererAdapter | null = null;
  private selection: RendererSelection | null = null;
  private quality: AdaptiveQualityState;
  private disposed = false;
  private lastReport: RenderFrameReport | null = null;

  public constructor(options: RendererKernelOptions = {}) {
    this.capabilities = {
      webgpu: options.capabilities?.webgpu ?? false,
      webgl2: options.capabilities?.webgl2 ?? true,
      offscreenCanvas: options.capabilities?.offscreenCanvas ?? false,
      sharedArrayBuffer: options.capabilities?.sharedArrayBuffer ?? false,
      crossOriginIsolated: options.capabilities?.crossOriginIsolated ?? false,
      deviceMemoryGb: options.capabilities?.deviceMemoryGb ?? null,
      hardwareConcurrency: options.capabilities?.hardwareConcurrency ?? 4,
      maxTextureSize: options.capabilities?.maxTextureSize ?? 4096,
      maxSamples: options.capabilities?.maxSamples ?? 4,
      powerPreference: options.capabilities?.powerPreference ?? 'default',
    };
    this.preferredBackend = options.preferredBackend ?? 'auto';
    this.factory = options.factory;
    this.now = options.now ?? (() => asTimestampMs(performance.now()));
    this.quality = this.initialQuality(options.preferredQuality);
    const tierBudget = TIER_BUDGET[this.quality.tier];
    this.budget = { ...tierBudget, ...options.budget };
  }

  public chooseBackend(): RendererSelection {
    if (this.selection) return this.selection;
    const backend = this.resolveBackend();
    const reason = this.preferredBackend === 'auto'
      ? (backend === 'webgpu' ? 'WebGPU available' : 'WebGPU unavailable; WebGL2 fallback')
      : `explicit backend preference: ${backend}`;
    this.selection = { backend, tier: this.quality.tier, reason, capabilities: this.capabilities };
    return this.selection;
  }

  public async initialize(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<RendererAdapter> {
    this.ensureActive();
    const selection = this.chooseBackend();
    if (!this.factory) {
      this.adapter = new NullRendererAdapter(canvas, selection.backend);
      await this.adapter.init();
      return this.adapter;
    }
    try {
      this.adapter = await this.factory({
        canvas,
        backend: selection.backend,
        quality: selection.tier,
        antialias: selection.tier !== 'safe',
      });
      await this.adapter.init();
      return this.adapter;
    } catch (cause) {
      if (selection.backend === 'webgpu' && this.capabilities.webgl2) {
        this.selection = { ...selection, backend: 'webgl2', reason: 'WebGPU initialization failed; deterministic WebGL2 fallback' };
        this.adapter = await this.factory({ canvas, backend: 'webgl2', quality: this.quality.tier, antialias: this.quality.tier !== 'safe' });
        await this.adapter.init();
        return this.adapter;
      }
      throw this.error('RENDERER_INIT_FAILED', 'renderer initialization failed', cause);
    }
  }

  public updateAdaptiveQuality(metrics: Pick<FrameMetrics, 'cpuMs' | 'gpuMs'>): AdaptiveQualityState {
    this.ensureActive();
    const gpu = metrics.gpuMs ?? metrics.cpuMs;
    const target = this.budget.gpuMs * 0.9;
    const pressure = gpu / Math.max(0.1, target);
    let tier = this.quality.tier;
    if (pressure > 1.2) tier = this.lowerTier(tier);
    else if (pressure < 0.7) tier = this.raiseTier(tier);
    if (tier !== this.quality.tier) {
      const budget = TIER_BUDGET[tier];
      this.quality = {
        tier,
        resolutionScale: clamp(this.quality.resolutionScale * (tier === this.lowerTier(this.quality.tier) ? 0.9 : 1.05), 0.55, 1),
        shadowDistance: scaleForTier(180, tier),
        foliageDensity: scaleForTier(1, tier),
        effectsLevel: scaleForTier(1, tier),
        reason: pressure > 1.2 ? `GPU pressure ${pressure.toFixed(2)}x` : `GPU headroom ${pressure.toFixed(2)}x`,
      };
      this.budget = { ...this.budget, ...budget };
      if (this.selection) this.selection = { ...this.selection, tier };
      this.applyQuality();
    }
    return this.quality;
  }

  public setQuality(tier: QualityTier, reason = 'manual'): AdaptiveQualityState {
    this.ensureActive();
    this.quality = {
      tier,
      resolutionScale: tier === 'safe' ? 0.65 : 1,
      shadowDistance: scaleForTier(180, tier),
      foliageDensity: scaleForTier(1, tier),
      effectsLevel: scaleForTier(1, tier),
      reason,
    };
    this.budget = { ...this.budget, ...TIER_BUDGET[tier] };
    if (this.selection) this.selection = { ...this.selection, tier };
    this.applyQuality();
    return this.quality;
  }

  public qualityState(): AdaptiveQualityState { return this.quality; }
  public budgetState(): RenderBudget { return this.budget; }
  public adapterState(): RendererAdapter | null { return this.adapter; }
  public selectionState(): RendererSelection | null { return this.selection; }
  public lastFrame(): RenderFrameReport | null { return this.lastReport; }

  public async execute(commands: readonly RenderCommand[], timestamp = this.now()): Promise<RenderFrameReport> {
    this.ensureActive();
    const optional = commands.filter((command) => command.enabled && command.optional)
      .sort((a, b) => a.estimatedMs - b.estimatedMs);
    const required = commands.filter((command) => command.enabled && !command.optional);
    const selected: RenderCommand[] = [...required];
    let estimate = selected.reduce((sum, command) => sum + Math.max(0, command.estimatedMs), 0);
    for (const command of optional) {
      if (estimate + command.estimatedMs <= this.budget.gpuMs) {
        selected.push(command);
        estimate += Math.max(0, command.estimatedMs);
      }
    }
    const selectedIds = new Set(selected.map((command) => command.id));
    const skipped = commands.filter((command) => command.enabled && !selectedIds.has(command.id)).map((command) => command.id);
    const executed: string[] = [];
    for (const command of selected) {
      await command.execute();
      executed.push(command.id);
    }
    const report: RenderFrameReport = {
      timestamp,
      backend: this.chooseBackend().backend,
      executed,
      skipped,
      estimatedGpuMs: estimate,
      budgetGpuMs: this.budget.gpuMs,
      quality: this.quality,
    };
    this.lastReport = report;
    return report;
  }

  private applyQuality(): void {
    if (!this.adapter) return;
    this.adapter.setPixelRatio(this.quality.resolutionScale * Math.min(2, globalThis.devicePixelRatio || 1));
  }

  private initialQuality(preferred?: QualityTier): AdaptiveQualityState {
    const tier = preferred ?? this.deriveTier();
    return { ...DEFAULT_ADAPTIVE_QUALITY, tier, shadowDistance: scaleForTier(180, tier), foliageDensity: scaleForTier(1, tier), effectsLevel: scaleForTier(1, tier) };
  }

  private deriveTier(): QualityTier {
    const ram = this.capabilities.deviceMemoryGb ?? 4;
    const cores = this.capabilities.hardwareConcurrency;
    if (this.capabilities.webgpu && ram >= 12 && cores >= 8) return 'ultra';
    if (this.capabilities.webgpu && ram >= 8 && cores >= 6) return 'high';
    if (ram >= 6 && cores >= 4) return 'medium';
    if (ram >= 3) return 'low';
    return 'safe';
  }

  private resolveBackend(): RendererBackend {
    if (this.preferredBackend === 'webgpu') {
      if (this.capabilities.webgpu) return 'webgpu';
      if (this.capabilities.webgl2) return 'webgl2';
      throw new Error('NO_SUPPORTED_RENDER_BACKEND');
    }
    if (this.preferredBackend === 'webgl2') {
      if (this.capabilities.webgl2) return 'webgl2';
      if (this.capabilities.webgpu) return 'webgpu';
      throw new Error('NO_SUPPORTED_RENDER_BACKEND');
    }
    if (this.capabilities.webgpu) return 'webgpu';
    if (this.capabilities.webgl2) return 'webgl2';
    throw new Error('NO_SUPPORTED_RENDER_BACKEND');
  }

  private lowerTier(tier: QualityTier): QualityTier {
    return (Object.keys(TIER_RANK) as QualityTier[]).find((candidate) => TIER_RANK[candidate] === TIER_RANK[tier] - 1) ?? 'safe';
  }

  private raiseTier(tier: QualityTier): QualityTier {
    return (Object.keys(TIER_RANK) as QualityTier[]).find((candidate) => TIER_RANK[candidate] === TIER_RANK[tier] + 1) ?? tier;
  }

  private error(code: string, message: string, cause?: unknown): RuntimeError { return { code, message, recoverable: false, cause }; }
  private ensureActive(): void { if (this.disposed) throw new Error('RENDERER_KERNEL_DISPOSED'); }

  public dispose(): void {
    if (this.disposed) return;
    this.adapter?.dispose();
    this.adapter = null;
    this.disposed = true;
  }
}

class NullRendererAdapter implements RendererAdapter {
  public initialized = false;
  public constructor(public readonly canvas: HTMLCanvasElement | OffscreenCanvas, public readonly backend: RendererBackend) {}
  public async init(): Promise<void> { this.initialized = true; }
  public setPixelRatio(_ratio: number): void {}
  public setSize(width: number, height: number): void { this.canvas.width = Math.max(1, Math.floor(width)); this.canvas.height = Math.max(1, Math.floor(height)); }
  public dispose(): void { this.initialized = false; }
}

const scaleForTier = (base: number, tier: QualityTier): number => {
  const factor: Record<QualityTier, number> = { cinematic: 1.15, ultra: 1.05, high: 1, medium: 0.75, low: 0.5, safe: 0.3 };
  return base * factor[tier];
};
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

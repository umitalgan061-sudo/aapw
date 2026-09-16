import { chooseBackend, createFramePacket, RenderOrchestrator, type RenderCapabilities, type RenderFramePacket, type RenderQuality, type RendererBackend, type RenderStats } from '../../core/render/renderContract.ts';
import type { RuntimeIntegrationMetrics } from './runtimeIntegrationV2.ts';
import { diagnoseRuntime, type RuntimeDiagnosticSnapshot } from './runtimeDiagnosticsV2.ts';

export interface RenderIntegrationOptions {
  readonly preferredBackend?: RendererBackend;
  readonly maxVisible?: number;
  readonly targetFrameMs?: number;
}

export interface RenderIntegrationState {
  readonly backend: RendererBackend;
  readonly packet: RenderFramePacket;
  readonly stats: RenderStats;
  readonly diagnostics: RuntimeDiagnosticSnapshot | null;
  readonly degraded: boolean;
}

const backendFromCaps = (caps?: Partial<RenderCapabilities>): RendererBackend => chooseBackend({
  backend: caps?.backend ?? 'dom',
  compute: caps?.compute,
  instancing: caps?.instancing,
});

export class RenderIntegrationV2 {
  readonly orchestrator: RenderOrchestrator;
  readonly #maxVisible: number;
  readonly #targetFrameMs: number;
  #quality: RenderQuality = Object.freeze({ resolutionScale: 1, shadows: true, shadowCascades: 3, postFx: true, bloom: true, volumetrics: true, foliageDensity: 1, geometryLodBias: 0, textureLodBias: 0, antialias: true });
  #backend: RendererBackend;
  #frame = 0;
  #last: RenderIntegrationState | null = null;

  constructor(capabilities: Partial<RenderCapabilities> = {}, options: RenderIntegrationOptions = {}) {
    this.#backend = options.preferredBackend ?? backendFromCaps(capabilities);
    this.#maxVisible = Math.max(100, Math.floor(options.maxVisible ?? 20_000));
    this.#targetFrameMs = Math.max(8, options.targetFrameMs ?? 16.67);
    this.orchestrator = new RenderOrchestrator(this.#backend);
  }

  setQuality(quality: Partial<RenderQuality>): void {
    this.#quality = Object.freeze({ ...this.#quality, ...quality, resolutionScale: clamp01(quality.resolutionScale ?? this.#quality.resolutionScale), foliageDensity: clamp01(quality.foliageDensity ?? this.#quality.foliageDensity) });
  }

  setBackend(backend: RendererBackend): void { this.#backend = backend; this.orchestrator.setBackend(backend); }

  render(input: { readonly revision: number; readonly dt: number; readonly visible: readonly string[]; readonly camera?: { readonly x: number; readonly y: number; readonly z: number; readonly tx?: number; readonly ty?: number; readonly tz?: number } }, metrics?: RuntimeIntegrationMetrics): RenderIntegrationState {
    this.#frame += 1;
    const camera = input.camera ?? { x: 0, y: 40, z: 60, tx: 0, ty: 0, tz: 0 };
    const packet = createFramePacket(this.#frame, input.revision, input.dt, {
      camera: { position: { x: camera.x, y: camera.y, z: camera.z }, target: { x: camera.tx ?? 0, y: camera.ty ?? 0, z: camera.tz ?? 0 }, fov: 60 },
      quality: this.#quality,
    }, input.visible.slice(0, this.#maxVisible));
    const stats = this.orchestrator.render(packet);
    let diagnostics: RuntimeDiagnosticSnapshot | null = null;
    if (metrics) diagnostics = diagnoseRuntime({ integration: metrics, chunks: { frame: this.#frame, declared: 0, active: 0, queued: 0, loading: 0, retiring: 0, failed: 0, residentBytes: 0, peakResidentBytes: 0, loadSuccesses: 0, loadFailures: 0, unloads: 0, evictions: 0 }, spatial: { items: input.visible.length, cells: 0, queries: 0, visitedCells: 0, returnedItems: 0, updates: 0, removals: 0 }, frameTimeMs: stats.cpuMs, targetFrameMs: this.#targetFrameMs });
    const state: RenderIntegrationState = Object.freeze({ backend: this.#backend, packet, stats, diagnostics, degraded: stats.cpuMs > this.#targetFrameMs });
    this.#last = state;
    return state;
  }

  latest(): RenderIntegrationState | null { return this.#last; }
  backend(): RendererBackend { return this.#backend; }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

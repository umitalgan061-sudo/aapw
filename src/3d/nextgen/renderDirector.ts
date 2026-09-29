import type { RenderBackend, QualityTier, RenderCandidate } from './kernelTypes.ts';
import { clamp, stableHash } from './kernelTypes.ts';

export interface RenderCapabilities {
  readonly secureContext: boolean;
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly hardwareConcurrency: number;
  readonly memoryGiB: number;
  readonly devicePixelRatio: number;
}

export interface RenderPolicy {
  readonly backend: RenderBackend;
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly pixelRatioCap: number;
  readonly shadows: boolean;
  readonly postProcessing: boolean;
  readonly temporalEffects: boolean;
  readonly triangleBudget: number;
  readonly drawCallBudget: number;
  readonly maxVisible: number;
}

export const chooseRenderPolicy = (
  capabilities: RenderCapabilities,
  preferred: 'auto' | RenderBackend = 'auto',
  requestedQuality: 'auto' | QualityTier = 'auto',
): RenderPolicy => {
  const backend: RenderBackend =
    preferred === 'headless' ? 'headless' :
    preferred === 'webgpu' && capabilities.secureContext && capabilities.webgpu ? 'webgpu' :
    preferred === 'webgl2' && capabilities.webgl2 ? 'webgl2' :
    capabilities.secureContext && capabilities.webgpu ? 'webgpu' :
    capabilities.webgl2 ? 'webgl2' : 'headless';

  const inferred: QualityTier = capabilities.memoryGiB >= 16 && capabilities.hardwareConcurrency >= 12 ? 'ultra'
    : capabilities.memoryGiB >= 8 && capabilities.hardwareConcurrency >= 8 ? 'high'
    : capabilities.memoryGiB >= 4 && capabilities.hardwareConcurrency >= 4 ? 'medium'
    : 'low';
  const quality = requestedQuality === 'auto' ? inferred : requestedQuality;
  const multiplier = quality === 'ultra' ? 1.35 : quality === 'high' ? 1.05 : quality === 'medium' ? 0.8 : quality === 'low' ? 0.55 : 0.35;

  return Object.freeze({
    backend,
    quality,
    renderScale: backend === 'headless' ? 1 : clamp(multiplier, 0.5, 1.35),
    pixelRatioCap: quality === 'ultra' ? 2.5 : quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1.25,
    shadows: backend !== 'headless' && quality !== 'minimal',
    postProcessing: backend !== 'headless' && quality === 'ultra' || quality === 'high',
    temporalEffects: backend === 'webgpu' && (quality === 'ultra' || quality === 'high'),
    triangleBudget: quality === 'ultra' ? 5_000_000 : quality === 'high' ? 3_000_000 : quality === 'medium' ? 1_500_000 : 700_000,
    drawCallBudget: quality === 'ultra' ? 1600 : quality === 'high' ? 1100 : quality === 'medium' ? 700 : 450,
    maxVisible: quality === 'ultra' ? 5000 : quality === 'high' ? 3500 : quality === 'medium' ? 2200 : 1200,
  });
};

export interface RenderFramePlan {
  readonly frame: number;
  readonly candidates: readonly RenderCandidate[];
  readonly visible: readonly RenderCandidate[];
  readonly omitted: readonly RenderCandidate[];
  readonly passes: readonly string[];
  readonly triangles: number;
  readonly drawCalls: number;
  readonly estimatedGpuMs: number;
  readonly digest: string;
}

export class RenderDirector {
  #policy: RenderPolicy;
  #frame = 0;
  #disposed = false;

  constructor(policy: RenderPolicy) { this.#policy = Object.freeze({ ...policy }); }

  policy(): RenderPolicy { return this.#policy; }

  updatePolicy(policy: RenderPolicy): void {
    this.#policy = Object.freeze({ ...policy });
  }

  plan(candidates: readonly RenderCandidate[], frame = this.#frame + 1): RenderFramePlan {
    if (this.#disposed) return Object.freeze({
      frame,
      candidates: [],
      visible: [],
      omitted: candidates,
      passes: [],
      triangles: 0,
      drawCalls: 0,
      estimatedGpuMs: 0,
      digest: stableHash({ disposed: true, frame }),
    });

    this.#frame = Math.max(this.#frame + 1, Math.floor(frame));
    const unique = new Map<string, RenderCandidate>();
    for (const candidate of candidates) {
      const previous = unique.get(String(candidate.entity));
      if (!previous || candidate.importance > previous.importance || candidate.distance < previous.distance) unique.set(String(candidate.entity), candidate);
    }
    const ordered = [...unique.values()].sort((a, b) =>
      b.importance - a.importance ||
      a.distance - b.distance ||
      String(a.entity).localeCompare(String(b.entity)),
    );
    const visible: RenderCandidate[] = [];
    let triangles = 0;
    let drawCalls = 0;
    for (const candidate of ordered) {
      const candidateTriangles = Math.max(0, Math.floor(candidate.triangles));
      const candidateDrawCalls = Math.max(1, Math.ceil(Math.max(1, candidate.instances) / 100));
      if (
        visible.length < this.#policy.maxVisible &&
        triangles + candidateTriangles <= this.#policy.triangleBudget &&
        drawCalls + candidateDrawCalls <= this.#policy.drawCallBudget
      ) {
        visible.push(candidate);
        triangles += candidateTriangles;
        drawCalls += candidateDrawCalls;
      }
    }
    const visibleIds = new Set(visible.map((item) => String(item.entity)));
    const omitted = ordered.filter((candidate) => !visibleIds.has(String(candidate.entity)));
    const passes = this.#passes();
    const estimatedGpuMs =
      visible.length * 0.008 +
      triangles / 1_000_000 * (this.#policy.backend === 'webgpu' ? 0.65 : 0.95) +
      drawCalls * 0.01 +
      (this.#policy.shadows ? visible.filter((item) => item.castsShadow && item.distance < 130).length * 0.02 : 0) +
      (this.#policy.postProcessing ? 1.15 / Math.max(0.5, this.#policy.renderScale) : 0);

    return Object.freeze({
      frame: this.#frame,
      candidates: Object.freeze(ordered),
      visible: Object.freeze(visible),
      omitted: Object.freeze(omitted),
      passes,
      triangles,
      drawCalls,
      estimatedGpuMs,
      digest: stableHash({
        frame: this.#frame,
        backend: this.#policy.backend,
        quality: this.#policy.quality,
        visible: visible.map((item) => String(item.entity)),
        triangles,
        drawCalls,
        passes,
      }),
    });
  }

  adapt(observedGpuMs: number, observedFrameMs: number): RenderPolicy {
    const overloaded = observedGpuMs > 14 || observedFrameMs > 19;
    const underloaded = observedGpuMs < 7 && observedFrameMs < 13;
    if (!overloaded && !underloaded) return this.#policy;
    const order: QualityTier[] = ['minimal', 'low', 'medium', 'high', 'ultra'];
    const index = order.indexOf(this.#policy.quality);
    const nextIndex = overloaded ? Math.max(0, index - 1) : Math.min(order.length - 1, index + 1);
    const nextQuality = order[nextIndex]!;
    const next = chooseRenderPolicy({
      secureContext: this.#policy.backend === 'webgpu',
      webgpu: this.#policy.backend === 'webgpu',
      webgl2: true,
      hardwareConcurrency: 8,
      memoryGiB: 8,
      devicePixelRatio: this.#policy.pixelRatioCap,
    }, this.#policy.backend, nextQuality);
    this.#policy = next;
    return next;
  }

  private #passes(): readonly string[] {
    if (this.#policy.backend === 'headless') return Object.freeze(['depth', 'opaque', 'ui']);
    const passes = ['depth', 'opaque', 'transparent'];
    if (this.#policy.shadows) passes.splice(1, 0, 'shadow');
    if (this.#policy.temporalEffects) passes.push('temporal');
    if (this.#policy.postProcessing) passes.push('post');
    passes.push('ui');
    return Object.freeze(passes);
  }

  dispose(): void { this.#disposed = true; }
}

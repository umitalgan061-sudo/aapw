import {
  clampNumber,
  type Aabb,
  type QualityTier,
  type RenderBackend,
  type RenderItem,
  type RenderPassPlan,
  type RenderPlan,
  type RenderView,
  type RenderableState,
  type Sphere,
  type Vec3,
} from './coreContracts';

export interface BackendCapabilities {
  readonly backend: RenderBackend;
  readonly webgpu: boolean;
  readonly compute: boolean;
  readonly timestampQueries: boolean;
  readonly float16Targets: boolean;
  readonly maxTextureDimension2D: number;
  readonly maxBindGroups: number;
  readonly maxColorAttachments: number;
}

export interface QualityProfile {
  readonly tier: QualityTier;
  readonly pixelRatioCap: number;
  readonly shadowMapSize: number;
  readonly maxVisibleObjects: number;
  readonly maxDrawCalls: number;
  readonly maxLights: number;
  readonly lodDistances: readonly [number, number, number, number];
  readonly postFx: boolean;
  readonly volumetrics: boolean;
  readonly terrainDetail: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  potato: {
    tier: 'potato',
    pixelRatioCap: 1,
    shadowMapSize: 512,
    maxVisibleObjects: 600,
    maxDrawCalls: 300,
    maxLights: 2,
    lodDistances: [20, 50, 100, 180],
    postFx: false,
    volumetrics: false,
    terrainDetail: 0.45,
  },
  low: {
    tier: 'low',
    pixelRatioCap: 1.15,
    shadowMapSize: 1024,
    maxVisibleObjects: 1000,
    maxDrawCalls: 500,
    maxLights: 4,
    lodDistances: [28, 70, 150, 260],
    postFx: false,
    volumetrics: false,
    terrainDetail: 0.65,
  },
  medium: {
    tier: 'medium',
    pixelRatioCap: 1.5,
    shadowMapSize: 2048,
    maxVisibleObjects: 1800,
    maxDrawCalls: 900,
    maxLights: 8,
    lodDistances: [35, 100, 220, 380],
    postFx: true,
    volumetrics: false,
    terrainDetail: 0.8,
  },
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    shadowMapSize: 4096,
    maxVisibleObjects: 3000,
    maxDrawCalls: 1500,
    maxLights: 16,
    lodDistances: [45, 140, 300, 520],
    postFx: true,
    volumetrics: true,
    terrainDetail: 1,
  },
  ultra: {
    tier: 'ultra',
    pixelRatioCap: 2.5,
    shadowMapSize: 8192,
    maxVisibleObjects: 5000,
    maxDrawCalls: 2500,
    maxLights: 32,
    lodDistances: [55, 180, 420, 720],
    postFx: true,
    volumetrics: true,
    terrainDetail: 1.2,
  },
};

export function detectBackend(preferWebGpu = true): RenderBackend {
  if (typeof navigator === 'undefined') return 'headless';
  if (preferWebGpu && 'gpu' in navigator) return 'webgpu';
  return 'webgl2';
}

export function inferCapabilities(backend: RenderBackend): BackendCapabilities {
  if (backend === 'webgpu') {
    return {
      backend,
      webgpu: true,
      compute: true,
      timestampQueries: true,
      float16Targets: true,
      maxTextureDimension2D: 16384,
      maxBindGroups: 8,
      maxColorAttachments: 8,
    };
  }
  if (backend === 'webgl2') {
    return {
      backend,
      webgpu: false,
      compute: false,
      timestampQueries: false,
      float16Targets: true,
      maxTextureDimension2D: 8192,
      maxBindGroups: 4,
      maxColorAttachments: 4,
    };
  }
  return {
    backend: 'headless',
    webgpu: false,
    compute: false,
    timestampQueries: false,
    float16Targets: false,
    maxTextureDimension2D: 4096,
    maxBindGroups: 1,
    maxColorAttachments: 1,
  };
}

function sphereRadius(bounds: Sphere | Aabb): number {
  if ('radius' in bounds) return Math.max(0.001, bounds.radius);
  const dx = bounds.max.x - bounds.min.x;
  const dy = bounds.max.y - bounds.min.y;
  const dz = bounds.max.z - bounds.min.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
}

function boundsCenter(bounds: Sphere | Aabb): Vec3 {
  if ('radius' in bounds) return bounds.center;
  return {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: (bounds.min.y + bounds.max.y) * 0.5,
    z: (bounds.min.z + bounds.max.z) * 0.5,
  };
}

export function distanceToView(renderable: RenderableState, view: RenderView): number {
  const center = boundsCenter(renderable.bounds);
  const dx = center.x - view.position.x;
  const dy = center.y - view.position.y;
  const dz = center.z - view.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function estimateScreenCoverage(renderable: RenderableState, view: RenderView): number {
  const distance = Math.max(0.1, distanceToView(renderable, view));
  const radius = sphereRadius(renderable.bounds);
  const projected = (radius / distance) / Math.max(0.05, Math.tan(view.fovRadians * 0.5));
  return clampNumber(projected, 0, 2);
}

export function chooseLod(
  distance: number,
  profile: QualityProfile,
  lodBias = 0,
): number {
  const [a, b, c, d] = profile.lodDistances;
  const shifted = distance * Math.pow(2, -lodBias);
  if (shifted <= a) return 0;
  if (shifted <= b) return 1;
  if (shifted <= c) return 2;
  if (shifted <= d) return 3;
  return 4;
}

export function isVisibleSphere(bounds: Sphere | Aabb, view: RenderView): boolean {
  const center = boundsCenter(bounds);
  const radius = sphereRadius(bounds);
  const dx = center.x - view.position.x;
  const dy = center.y - view.position.y;
  const dz = center.z - view.position.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance - radius > view.far) return false;
  if (distance + radius < view.near) return false;

  const forwardLength = Math.sqrt(
    view.forward.x * view.forward.x + view.forward.y * view.forward.y + view.forward.z * view.forward.z,
  );
  if (forwardLength < 0.00001) return true;
  const forward = {
    x: view.forward.x / forwardLength,
    y: view.forward.y / forwardLength,
    z: view.forward.z / forwardLength,
  };
  const toCenter = { x: dx / Math.max(distance, 0.00001), y: dy / Math.max(distance, 0.00001), z: dz / Math.max(distance, 0.00001) };
  const dot = forward.x * toCenter.x + forward.y * toCenter.y + forward.z * toCenter.z;
  const angularRadius = Math.min(1, radius / Math.max(distance, 0.00001));
  const halfFov = Math.max(0.05, view.fovRadians * 0.5);
  return dot >= Math.cos(halfFov + Math.asin(angularRadius));
}

export interface PipelineFrameState {
  readonly frame: number;
  readonly view: RenderView;
  readonly quality: QualityTier;
  readonly backend: RenderBackend;
  readonly renderables: readonly RenderableState[];
}

export class RenderPlannerV3 {
  #backend: RenderBackend;
  #quality: QualityTier;
  #frame = 0;
  #profiles: Readonly<Record<QualityTier, QualityProfile>>;

  constructor(options: {
    readonly backend?: RenderBackend;
    readonly quality?: QualityTier;
    readonly profiles?: Readonly<Record<QualityTier, QualityProfile>>;
  } = {}) {
    this.#backend = options.backend ?? detectBackend();
    this.#quality = options.quality ?? 'high';
    this.#profiles = options.profiles ?? QUALITY_PROFILES;
  }

  setBackend(backend: RenderBackend): void {
    this.#backend = backend;
  }

  setQuality(quality: QualityTier): void {
    this.#quality = quality;
  }

  getQuality(): QualityTier {
    return this.#quality;
  }

  plan(frame: Omit<PipelineFrameState, 'frame'> & { readonly frame?: number }): RenderPlan {
    this.#frame = frame.frame ?? this.#frame + 1;
    const profile = this.#profiles[frame.quality ?? this.#quality];
    const items: RenderItem[] = [];
    let culledCount = 0;

    const candidates = [...frame.renderables]
      .map((renderable) => ({
        renderable,
        distance: distanceToView(renderable, frame.view),
        coverage: estimateScreenCoverage(renderable, frame.view),
      }))
      .sort((a, b) => a.distance - b.distance || String(a.renderable.entity).localeCompare(String(b.renderable.entity)));

    for (const candidate of candidates) {
      const visible = isVisibleSphere(candidate.renderable.bounds, frame.view);
      if (!visible) {
        culledCount += 1;
        continue;
      }
      const lod = chooseLod(candidate.distance, profile, candidate.renderable.lodBias);
      if (lod >= 4 && candidate.coverage < 0.002) {
        culledCount += 1;
        continue;
      }
      items.push({
        entity: candidate.renderable.entity,
        distance: candidate.distance,
        lod,
        pipelineKey: `${candidate.renderable.materialKey}/${candidate.renderable.meshKey}/${lod}`,
        sortKey: (candidate.renderable.layer * 100000) + Math.round(candidate.distance * 10),
        visible: true,
      });
    }

    const limited = items
      .sort((a, b) => a.sortKey - b.sortKey || String(a.entity).localeCompare(String(b.entity)))
      .slice(0, profile.maxVisibleObjects);
    const drawLimited = limited.slice(0, profile.maxDrawCalls);
    const shadows = drawLimited.filter((item) => {
      const source = frame.renderables.find((renderable) => renderable.entity === item.entity);
      return source?.castShadow ?? false;
    });

    const passes: RenderPassPlan[] = [
      {
        id: 'shadow',
        kind: 'shadow',
        enabled: profile.shadowMapSize > 0,
        items: shadows,
        budgetMs: Math.max(0.5, profile.shadowMapSize / 2048),
      },
      {
        id: 'depth',
        kind: 'depth',
        enabled: true,
        items: drawLimited,
        budgetMs: 1.5,
      },
      {
        id: 'opaque',
        kind: 'opaque',
        enabled: true,
        items: drawLimited,
        budgetMs: 4,
      },
      {
        id: 'transparent',
        kind: 'transparent',
        enabled: true,
        items: drawLimited.filter((item) => item.lod <= 2),
        budgetMs: 1.5,
      },
      {
        id: 'post',
        kind: 'post',
        enabled: profile.postFx,
        items: [],
        budgetMs: profile.postFx ? 1.5 : 0,
      },
      {
        id: 'compute',
        kind: 'compute',
        enabled: this.#backend === 'webgpu' && profile.volumetrics,
        items: [],
        budgetMs: this.#backend === 'webgpu' && profile.volumetrics ? 1 : 0,
      },
      {
        id: 'ui',
        kind: 'ui',
        enabled: true,
        items: [],
        budgetMs: 0.5,
      },
    ];

    return {
      frame: this.#frame,
      backend: frame.backend ?? this.#backend,
      quality: frame.quality ?? this.#quality,
      passes,
      visibleCount: limited.length,
      culledCount: culledCount + Math.max(0, items.length - limited.length),
      drawCount: drawLimited.length,
    };
  }
}

export interface AdaptiveQualityInput {
  readonly frameTimeP95Ms: number;
  readonly targetFrameMs: number;
  readonly gpuPressure: number;
  readonly memoryPressure: number;
}

const QUALITY_ORDER: readonly QualityTier[] = ['potato', 'low', 'medium', 'high', 'ultra'];

export function chooseAdaptiveQuality(current: QualityTier, input: AdaptiveQualityInput): { tier: QualityTier; reason: string } {
  const index = QUALITY_ORDER.indexOf(current);
  const overloaded = input.frameTimeP95Ms > input.targetFrameMs * 1.12 || input.gpuPressure > 0.9 || input.memoryPressure > 0.92;
  const underloaded = input.frameTimeP95Ms < input.targetFrameMs * 0.78 && input.gpuPressure < 0.55 && input.memoryPressure < 0.7;
  if (overloaded && index > 0) {
    return { tier: QUALITY_ORDER[index - 1]!, reason: 'sustained frame/gpu/memory pressure' };
  }
  if (underloaded && index < QUALITY_ORDER.length - 1) {
    return { tier: QUALITY_ORDER[index + 1]!, reason: 'sustained frame headroom' };
  }
  return { tier: current, reason: 'quality hysteresis retained' };
}

export interface RenderBudgetDecision {
  readonly allowed: boolean;
  readonly remainingMs: number;
  readonly projectedMs: number;
  readonly droppedPasses: readonly string[];
}

export function enforceRenderBudget(plan: RenderPlan, budgetMs: number): RenderBudgetDecision {
  const enabledPasses = plan.passes.filter((pass) => pass.enabled);
  const projectedMs = enabledPasses.reduce((sum, pass) => sum + pass.budgetMs, 0);
  if (projectedMs <= budgetMs) {
    return { allowed: true, remainingMs: budgetMs - projectedMs, projectedMs, droppedPasses: [] };
  }

  const dropOrder = ['post', 'compute', 'transparent', 'shadow'];
  const active = new Set(enabledPasses.map((pass) => pass.id));
  const dropped: string[] = [];
  let remaining = projectedMs;
  for (const id of dropOrder) {
    if (remaining <= budgetMs) break;
    const pass = plan.passes.find((entry) => entry.id === id);
    if (!pass || !active.has(id)) continue;
    active.delete(id);
    remaining -= pass.budgetMs;
    dropped.push(id);
  }
  return { allowed: remaining <= budgetMs, remainingMs: Math.max(0, budgetMs - remaining), projectedMs: remaining, droppedPasses: dropped };
}

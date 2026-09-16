import { EntityId, FrameId, RenderPacket, Vec3, asFrameId, asTick, checksumObject } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';

export interface CameraState {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly fovDegrees: number;
  readonly nearPlane: number;
  readonly farPlane: number;
}

export interface DrawItem {
  readonly entity: EntityId;
  readonly assetId: string | null;
  readonly distanceSq: number;
  readonly lod: number;
  readonly transparent: boolean;
  readonly castShadow: boolean;
  readonly layer: number;
}

export interface RenderBudget {
  readonly maxVisibleEntities: number;
  readonly maxShadowCasters: number;
  readonly maxOpaqueDraws: number;
  readonly maxTransparentDraws: number;
}

export const DEFAULT_RENDER_BUDGET: RenderBudget = Object.freeze({ maxVisibleEntities: 6000, maxShadowCasters: 1200, maxOpaqueDraws: 2500, maxTransparentDraws: 500 });

export interface RenderPlan {
  readonly packet: RenderPacket;
  readonly opaque: readonly DrawItem[];
  readonly transparent: readonly DrawItem[];
  readonly checksum: string;
}

export class VisibilityResolverV5 {
  constructor(private readonly world: EcsWorldV5, private readonly budget: RenderBudget = DEFAULT_RENDER_BUDGET) {}

  collect(camera: CameraState): RenderPlan {
    const cameraEntityDistance = (entity: EntityId): number => {
      const transform = this.world.getComponent(entity, 'transform');
      if (!transform) return Number.POSITIVE_INFINITY;
      const dx = transform.position.x - camera.position.x;
      const dy = transform.position.y - camera.position.y;
      const dz = transform.position.z - camera.position.z;
      return dx * dx + dy * dy + dz * dz;
    };
    const candidates: DrawItem[] = [];
    for (const entity of this.world.query({ all: ['transform', 'render'] })) {
      const render = entity.components.get('render');
      const transform = entity.components.get('transform');
      if (render?.kind !== 'render' || transform?.kind !== 'transform' || !render.visible) continue;
      const distanceSq = cameraEntityDistance(entity.id);
      if (!Number.isFinite(distanceSq) || distanceSq > camera.farPlane * camera.farPlane) continue;
      candidates.push({ entity: entity.id, assetId: render.assetId, distanceSq, lod: render.lod, transparent: false, castShadow: render.layer < 2, layer: render.layer });
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq || Number(a.entity) - Number(b.entity));
    const visible = candidates.slice(0, this.budget.maxVisibleEntities);
    const opaque = visible.filter((item) => !item.transparent).slice(0, this.budget.maxOpaqueDraws);
    const transparent = visible.filter((item) => item.transparent).slice(0, this.budget.maxTransparentDraws);
    const shadowCasters = visible.filter((item) => item.castShadow).slice(0, this.budget.maxShadowCasters);
    const packet: RenderPacket = {
      frame: asFrameId((typeof performance === 'undefined' ? Date.now() : Math.trunc(performance.now()))),
      tick: asTick(Number(this.world.tick)),
      cameraPosition: { ...camera.position },
      visibleEntities: visible.map((item) => item.entity),
      opaqueDraws: opaque.length,
      transparentDraws: transparent.length,
      shadowCasters: shadowCasters.length,
    };
    return { packet, opaque, transparent, checksum: checksumObject({ packet, opaque, transparent }) };
  }
}

export interface RenderDevice {
  readonly kind: 'webgpu' | 'webgl2' | 'webgl1' | 'none';
  readonly maxTextureSize: number;
  readonly maxSamples: number;
}

export const detectRenderDevice = (context: WebGLRenderingContext | WebGL2RenderingContext | null): RenderDevice => {
  if (!context) return { kind: 'none', maxTextureSize: 0, maxSamples: 0 };
  const isWebgl2 = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
  return {
    kind: isWebgl2 ? 'webgl2' : 'webgl1',
    maxTextureSize: Number(context.getParameter(context.MAX_TEXTURE_SIZE) ?? 0),
    maxSamples: Number(isWebgl2 ? context.getParameter((context as WebGL2RenderingContext).MAX_SAMPLES) ?? 0 : 0),
  };
};

export const chooseRenderScale = (device: RenderDevice, pixelRatio: number, thermalPressure = 0): number => {
  const base = device.kind === 'webgpu' ? 1 : device.kind === 'webgl2' ? 0.95 : 0.8;
  const pressure = Math.min(0.35, Math.max(0, thermalPressure));
  return Math.max(0.5, Math.min(Math.max(1, pixelRatio), base) - pressure);
};

export interface RenderFrameRecord {
  readonly frame: FrameId;
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly visible: number;
  readonly draws: number;
}

export class RenderMetricsV5 {
  readonly #frames: RenderFrameRecord[] = [];

  push(record: RenderFrameRecord): void {
    if (!Number.isFinite(record.cpuMs) || record.cpuMs < 0) throw new RangeError('cpuMs must be finite and >= 0');
    this.#frames.push({ ...record });
    if (this.#frames.length > 240) this.#frames.shift();
  }

  recent(limit = 60): readonly RenderFrameRecord[] { return this.#frames.slice(-Math.max(1, limit)); }
  averageCpu(limit = 60): number {
    const values = this.recent(limit).map((record) => record.cpuMs);
    return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  p95Cpu(limit = 60): number {
    const values = this.recent(limit).map((record) => record.cpuMs).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    return values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!;
  }
}

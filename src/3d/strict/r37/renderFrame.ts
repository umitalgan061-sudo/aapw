import type { EntityRecord, RenderFrame, RenderItem, Vec3 } from './types.ts';
import { clamp, distanceXZ, finite, lerp, quantize, vec3 } from './math.ts';

export interface RenderFrameConfig {
  readonly maxItems: number;
  readonly cullDistanceMeters: number;
  readonly lodDistancesMeters: readonly number[];
}

const DEFAULT_CONFIG: RenderFrameConfig = Object.freeze({
  maxItems: 2048,
  cullDistanceMeters: 1600,
  lodDistancesMeters: Object.freeze([180, 450, 900, 1600]),
});

export interface RenderBuildContext {
  readonly frameId: number;
  readonly tick: number;
  readonly alpha: number;
  readonly cameraPosition: Vec3;
  readonly qualityScale: number;
}

export class RenderFrameBuilderR37 {
  readonly config: RenderFrameConfig;

  constructor(config: Partial<RenderFrameConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      maxItems: Math.max(1, Math.trunc(finite(config.maxItems, DEFAULT_CONFIG.maxItems))),
      cullDistanceMeters: Math.max(10, finite(config.cullDistanceMeters, DEFAULT_CONFIG.cullDistanceMeters)),
      lodDistancesMeters: Object.freeze([...(config.lodDistancesMeters ?? DEFAULT_CONFIG.lodDistancesMeters)].map((value) => Math.max(1, finite(value)))),
    });
  }

  build(entities: readonly EntityRecord[], context: RenderBuildContext): RenderFrame {
    const items: RenderItem[] = [];
    const qualityScale = clamp(finite(context.qualityScale, 1), 0.25, 1.25);
    for (const entity of entities) {
      if (!entity.active) continue;
      const distance = distanceXZ(entity.transform.position, context.cameraPosition);
      if (distance > this.config.cullDistanceMeters * qualityScale) continue;
      const lod = this.#resolveLod(distance / Math.max(0.25, qualityScale));
      const item: RenderItem = Object.freeze({
        entityId: entity.id,
        kind: entity.kind,
        transform: Object.freeze({
          position: quantizeVec(entity.transform.position),
          rotation: quantizeVec(entity.transform.rotation),
          scale: quantizeVec(entity.transform.scale),
        }),
        visible: true,
        lod,
        materialKey: typeof entity.data.materialKey === 'string' ? entity.data.materialKey.slice(0, 96) : 'default',
        layer: Math.max(0, Math.trunc(finite(entity.data.renderLayer, 0))),
      });
      items.push(item);
      if (items.length >= this.config.maxItems) break;
    }
    items.sort((a, b) => a.layer - b.layer || a.lod - b.lod || a.entityId.localeCompare(b.entityId));
    return Object.freeze({
      frameId: Math.max(0, Math.trunc(context.frameId)),
      tick: Math.max(0, Math.trunc(context.tick)),
      alpha: clamp(finite(context.alpha), 0, 1),
      items: Object.freeze(items),
      debug: Object.freeze({
        sourceEntities: entities.length,
        emittedItems: items.length,
        qualityScale,
        cullDistance: this.config.cullDistanceMeters * qualityScale,
      }),
    });
  }

  #resolveLod(distance: number): number {
    const distances = this.config.lodDistancesMeters;
    for (let i = 0; i < distances.length; i += 1) {
      if (distance <= distances[i]!) return i;
    }
    return distances.length;
  }
}

function quantizeVec(value: Vec3): Vec3 {
  return vec3(
    quantize(value.x, 0.001),
    quantize(value.y, 0.001),
    quantize(value.z, 0.001),
  );
}

export function interpolateTransform(previous: Vec3, current: Vec3, alpha: number): Vec3 {
  return Object.freeze({
    x: lerp(previous.x, current.x, alpha),
    y: lerp(previous.y, current.y, alpha),
    z: lerp(previous.z, current.z, alpha),
  });
}

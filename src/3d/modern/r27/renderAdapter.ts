import type { EntityId, LodTier, RuntimeSnapshot, Transform, Vec3, VisibilityDecision } from './contracts.ts';

export interface RenderProxy {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly rotation: readonly [number, number, number, number];
  readonly scale: Vec3;
  readonly lod: LodTier;
  readonly castShadow: boolean;
  readonly visible: boolean;
  readonly interaction: 'none' | 'near' | 'interactive';
}

export interface RenderFramePacket {
  readonly tick: number;
  readonly timeSeconds: number;
  readonly qualityLevel: number;
  readonly proxies: readonly RenderProxy[];
  readonly visibleCount: number;
  readonly shadowCount: number;
}

function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export class RuntimeRenderAdapter {
  #previous = new Map<EntityId, RenderProxy>();

  buildFrame(
    snapshot: RuntimeSnapshot,
    visibility: readonly VisibilityDecision[] = [],
  ): RenderFramePacket {
    const visibleById = new Map(visibility.map((decision) => [Number(decision.entity), decision]));
    const shadowIds = new Set(
      visibility
        .filter((decision) => decision.visible && decision.tier <= 2)
        .sort((a, b) => a.tier - b.tier || b.score - a.score || Number(a.entity) - Number(b.entity))
        .slice(0, Math.max(32, Math.floor(snapshot.entities.length / 3)))
        .map((decision) => Number(decision.entity)),
    );

    const proxies = snapshot.entities
      .map((entity) => {
        const transform = entity.transform ?? identityTransform();
        const decision = visibleById.get(Number(entity.id));
        const visible = decision?.visible ?? true;
        const lod = decision?.tier ?? 3;
        const interaction = lod === 0 ? 'interactive' : lod <= 1 ? 'near' : 'none';
        const proxy: RenderProxy = {
          entity: entity.id,
          position: transform.position,
          rotation: [transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w],
          scale: transform.scale,
          lod,
          castShadow: shadowIds.has(Number(entity.id)),
          visible,
          interaction,
        };
        return proxy;
      })
      .sort((a, b) => Number(a.entity) - Number(b.entity));

    this.#previous = new Map(proxies.map((proxy) => [proxy.entity, proxy]));
    return {
      tick: snapshot.tick,
      timeSeconds: snapshot.timeSeconds,
      qualityLevel: snapshot.qualityLevel,
      proxies,
      visibleCount: proxies.filter((proxy) => proxy.visible).length,
      shadowCount: proxies.filter((proxy) => proxy.castShadow).length,
    };
  }

  interpolate(packet: RenderFramePacket, alpha: number): RenderFramePacket {
    const t = Math.max(0, Math.min(1, alpha));
    const proxies = packet.proxies.map((proxy) => {
      const previous = this.#previous.get(proxy.entity);
      if (!previous) return proxy;
      return {
        ...proxy,
        position: {
          x: previous.position.x + (proxy.position.x - previous.position.x) * t,
          y: previous.position.y + (proxy.position.y - previous.position.y) * t,
          z: previous.position.z + (proxy.position.z - previous.position.z) * t,
        },
      };
    });
    return { ...packet, proxies };
  }

  pick(proxies: readonly RenderProxy[], predicate: (proxy: RenderProxy) => boolean): RenderProxy | undefined {
    return [...proxies]
      .filter((proxy) => proxy.visible && predicate(proxy))
      .sort((a, b) => a.lod - b.lod || Number(a.entity) - Number(b.entity))[0];
  }

  previous(entity: EntityId): RenderProxy | undefined {
    return this.#previous.get(entity);
  }
}

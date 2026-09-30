import {
  type Aabb,
  type CameraVolume,
  type EntityId,
  type LodTier,
  type Vec3,
  type VisibilityCandidate,
  type VisibilityDecision,
} from './contracts.ts';
import { distanceSquared, dot, normalize, sub } from './physics.ts';

interface Plane {
  readonly normal: Vec3;
  readonly distance: number;
}

function normalizePlane(normal: Vec3, distance: number): Plane {
  const magnitude = Math.hypot(normal.x, normal.y, normal.z);
  return magnitude <= 1e-9 ? { normal, distance } : {
    normal: { x: normal.x / magnitude, y: normal.y / magnitude, z: normal.z / magnitude },
    distance: distance / magnitude,
  };
}

function mul(a: Vec3, scalar: number): Vec3 {
  return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function cameraBasis(camera: CameraVolume): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = normalize(camera.forward, { x: 0, y: 0, z: -1 });
  const right = normalize({
    x: forward.y * camera.up.z - forward.z * camera.up.y,
    y: forward.z * camera.up.x - forward.x * camera.up.z,
    z: forward.x * camera.up.y - forward.y * camera.up.x,
  }, { x: 1, y: 0, z: 0 });
  const up = normalize({
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  }, { x: 0, y: 1, z: 0 });
  return { right, up, forward };
}

function frustumPlanes(camera: CameraVolume): readonly Plane[] {
  const { right, up, forward } = cameraBasis(camera);
  const tanHalfY = Math.tan(camera.fovYRadians / 2);
  const tanHalfX = tanHalfY * camera.aspect;

  const leftNormal = normalize(add(forward, mul(right, tanHalfX)));
  const rightNormal = normalize(add(forward, mul(right, -tanHalfX)));
  const topNormal = normalize(add(forward, mul(up, -tanHalfY)));
  const bottomNormal = normalize(add(forward, mul(up, tanHalfY)));

  return [
    normalizePlane(leftNormal, -dot(leftNormal, camera.position)),
    normalizePlane(rightNormal, -dot(rightNormal, camera.position)),
    normalizePlane(topNormal, -dot(topNormal, camera.position)),
    normalizePlane(bottomNormal, -dot(bottomNormal, camera.position)),
    normalizePlane(forward, -dot(forward, camera.position) - camera.near),
    normalizePlane(mul(forward, -1), dot(forward, camera.position) + camera.far),
  ];
}

function positiveVertex(bounds: Aabb, normal: Vec3): Vec3 {
  return {
    x: normal.x >= 0 ? bounds.max.x : bounds.min.x,
    y: normal.y >= 0 ? bounds.max.y : bounds.min.y,
    z: normal.z >= 0 ? bounds.max.z : bounds.min.z,
  };
}

function aabbInsidePlane(bounds: Aabb, plane: Plane): boolean {
  const vertex = positiveVertex(bounds, plane.normal);
  return dot(plane.normal, vertex) + plane.distance >= 0;
}

export function aabbInFrustum(bounds: Aabb, camera: CameraVolume): boolean {
  return frustumPlanes(camera).every((plane) => aabbInsidePlane(bounds, plane));
}

export function chooseLodTier(
  distance: number,
  radius: number,
  qualityLevel: number,
): LodTier {
  const normalized = Math.max(0, distance - radius * 2);
  const bias = Math.max(0, Math.min(1, qualityLevel / 4));
  if (normalized < 20 + bias * 20) return 0;
  if (normalized < 60 + bias * 45) return 1;
  if (normalized < 140 + bias * 90) return 2;
  if (normalized < 300 + bias * 220) return 3;
  return 4;
}

export interface VisibilityConfig {
  readonly maxVisible: number;
  readonly maxShadowCasters: number;
  readonly maxLod0: number;
  readonly nearDistance: number;
}

export class VisibilityOracle {
  readonly config: VisibilityConfig;

  constructor(config: Partial<VisibilityConfig> = {}) {
    this.config = Object.freeze({
      maxVisible: Math.max(1, Math.floor(config.maxVisible ?? 2048)),
      maxShadowCasters: Math.max(0, Math.floor(config.maxShadowCasters ?? 256)),
      maxLod0: Math.max(1, Math.floor(config.maxLod0 ?? 256)),
      nearDistance: Math.max(1, config.nearDistance ?? 80),
    });
  }

  evaluate(
    camera: CameraVolume,
    candidates: readonly VisibilityCandidate[],
    qualityLevel = 2,
  ): readonly VisibilityDecision[] {
    const visible = candidates
      .filter((candidate) => aabbInFrustum(candidate.bounds, camera))
      .map((candidate) => {
        const distance = Math.sqrt(distanceSquared(candidate.position, camera.position));
        const direction = normalize(sub(candidate.position, camera.position));
        const facing = Math.max(0, dot(direction, normalize(camera.forward, { x: 0, y: 0, z: -1 })));
        const score =
          candidate.importance * 4 +
          facing * 2 +
          Math.max(0, 1 - distance / Math.max(camera.far, 1)) * 3 +
          candidate.occlusionHint;
        return {
          entity: candidate.entity,
          visible: true,
          tier: chooseLodTier(distance, candidate.radius, qualityLevel),
          score,
        } satisfies VisibilityDecision;
      })
      .sort((a, b) => b.score - a.score || Number(a.entity) - Number(b.entity));

    const result = visible.slice(0, this.config.maxVisible);
    let lod0 = 0;
    return result.map((decision) => {
      if (decision.tier === 0 && lod0 >= this.config.maxLod0) {
        return { ...decision, tier: 1 };
      }
      if (decision.tier === 0) lod0++;
      return decision;
    });
  }

  pickShadowCasters(
    decisions: readonly VisibilityDecision[],
    limit = this.config.maxShadowCasters,
  ): readonly EntityId[] {
    return decisions
      .filter((decision) => decision.visible && decision.tier <= 2)
      .sort((a, b) => a.tier - b.tier || b.score - a.score || Number(a.entity) - Number(b.entity))
      .slice(0, Math.max(0, limit))
      .map((decision) => decision.entity);
  }
}

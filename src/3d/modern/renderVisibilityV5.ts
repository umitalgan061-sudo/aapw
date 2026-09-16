import { type EntityIdV5, type RenderCameraV5, type RenderObjectV5, type Vec3V5, distanceSqV5, clampV5 } from './runtimeContractV5';

export interface FrustumPlaneV5 { readonly normal: Vec3V5; readonly distance: number; }
export interface FrustumV5 { readonly planes: readonly FrustumPlaneV5[]; }
export interface VisibilityCandidateV5 extends RenderObjectV5 { readonly layer: number; readonly castShadow: boolean; readonly transparent: boolean; }
export interface VisibilityResultV5 { readonly visible: readonly VisibilityCandidateV5[]; readonly culled: number; readonly lodChanges: number; readonly sortCost: number; }
export interface VisibilityOptionsV5 {
  readonly maxVisible?: number;
  readonly maxDistance?: number;
  readonly shadowDistance?: number;
  readonly transparentLimit?: number;
  readonly farLodDistance?: number;
  readonly midLodDistance?: number;
}

function dot(a: Vec3V5, b: Vec3V5): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function add(a: Vec3V5, b: Vec3V5): Vec3V5 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(v: Vec3V5, s: number): Vec3V5 { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
function normalize(v: Vec3V5): Vec3V5 { const length = Math.hypot(v.x, v.y, v.z) || 1; return scale(v, 1 / length); }
function planeDistance(plane: FrustumPlaneV5, point: Vec3V5): number { return dot(plane.normal, point) + plane.distance; }
function sphereInside(frustum: FrustumV5, center: Vec3V5, radius: number): boolean { return frustum.planes.every((plane) => planeDistance(plane, center) >= -radius); }
function inferLod(distance: number, options: Required<VisibilityOptionsV5>): 0 | 1 | 2 | 3 {
  if (distance < options.midLodDistance * 0.5) return 0;
  if (distance < options.midLodDistance) return 1;
  if (distance < options.farLodDistance) return 2;
  return 3;
}

export class VisibilityPipelineV5 {
  readonly options: Required<VisibilityOptionsV5>;
  #lastVisible = new Set<EntityIdV5>();
  #occlusion = new Map<EntityIdV5, number>();

  constructor(options: VisibilityOptionsV5 = {}) {
    this.options = Object.freeze({
      maxVisible: Math.max(16, Math.min(100_000, Math.floor(options.maxVisible ?? 5000))),
      maxDistance: Math.max(1, options.maxDistance ?? 4000),
      shadowDistance: Math.max(1, options.shadowDistance ?? 350),
      transparentLimit: Math.max(1, Math.min(5000, Math.floor(options.transparentLimit ?? 700))),
      farLodDistance: Math.max(10, options.farLodDistance ?? 750),
      midLodDistance: Math.max(5, options.midLodDistance ?? 300),
    });
  }

  buildFrustum(camera: RenderCameraV5, aspect = 16 / 9): FrustumV5 {
    const forward = normalize(camera.forward);
    const worldUp = { x: 0, y: 1, z: 0 };
    const right = normalize({ x: forward.z, y: 0, z: -forward.x });
    const up = normalize({ x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x });
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const horizontal = tan * aspect;
    const leftNormal = normalize(add(right, scale(forward, horizontal)));
    const rightNormal = normalize(add(scale(right, -1), scale(forward, horizontal)));
    const topNormal = normalize(add(scale(up, -1), scale(forward, tan)));
    const bottomNormal = normalize(add(up, scale(forward, tan)));
    const nearCenter = add(camera.position, scale(forward, camera.near));
    const farCenter = add(camera.position, scale(forward, camera.far));
    return Object.freeze({ planes: Object.freeze([
      { normal: leftNormal, distance: -dot(leftNormal, camera.position) },
      { normal: rightNormal, distance: -dot(rightNormal, camera.position) },
      { normal: topNormal, distance: -dot(topNormal, camera.position) },
      { normal: bottomNormal, distance: -dot(bottomNormal, camera.position) },
      { normal: forward, distance: -dot(forward, nearCenter) },
      { normal: scale(forward, -1), distance: dot(forward, farCenter) },
      { normal: normalize(worldUp), distance: -camera.position.y - 10_000 },
    ]) });
  }

  evaluate(candidates: readonly VisibilityCandidateV5[], camera: RenderCameraV5, frustum = this.buildFrustum(camera)): VisibilityResultV5 {
    const ranked: Array<{ candidate: VisibilityCandidateV5; distance: number; lod: 0 | 1 | 2 | 3 }> = [];
    let culled = 0;
    let lodChanges = 0;
    for (const candidate of candidates) {
      const distance = Math.sqrt(distanceSqV5(candidate.transform.position, camera.position));
      if (!candidate.visible || distance > this.options.maxDistance || !sphereInside(frustum, candidate.transform.position, candidate.bounds.radius)) { culled += 1; continue; }
      const lod = inferLod(distance, this.options);
      if (candidate.lod !== lod) lodChanges += 1;
      ranked.push({ candidate: { ...candidate, lod }, distance, lod });
      this.#lastVisible.add(candidate.id);
      this.#occlusion.set(candidate.id, 0);
    }
    ranked.sort((a, b) => a.lod - b.lod || a.candidate.layer - b.candidate.layer || a.distance - b.distance || a.candidate.id - b.candidate.id);
    const limited = ranked.slice(0, this.options.maxVisible);
    const opaque = limited.filter((entry) => !entry.candidate.transparent);
    const transparent = limited.filter((entry) => entry.candidate.transparent).sort((a, b) => b.distance - a.distance).slice(0, this.options.transparentLimit);
    const visible = Object.freeze([...opaque, ...transparent].map((entry) => entry.candidate));
    return Object.freeze({ visible, culled: culled + Math.max(0, ranked.length - limited.length), lodChanges, sortCost: ranked.length * Math.log2(Math.max(2, ranked.length)) });
  }

  updateOcclusion(id: EntityIdV5, occluded: boolean): void {
    const frames = this.#occlusion.get(id) ?? 0;
    this.#occlusion.set(id, occluded ? Math.min(30, frames + 1) : 0);
  }

  shouldRender(id: EntityIdV5, hysteresisFrames = 2): boolean { return (this.#occlusion.get(id) ?? 0) < Math.max(1, hysteresisFrames); }
  visibleIds(): readonly EntityIdV5[] { return Object.freeze([...this.#lastVisible].sort((a, b) => a - b)); }
  reset(): void { this.#lastVisible.clear(); this.#occlusion.clear(); }
  distanceBand(distance: number): 'near' | 'mid' | 'far' | 'out' { const d = clampV5(distance, 0, Number.POSITIVE_INFINITY); if (d < this.options.midLodDistance) return 'near'; if (d < this.options.farLodDistance) return 'mid'; if (d <= this.options.maxDistance) return 'far'; return 'out'; }
}

export function createRenderCandidateV5(id: EntityIdV5, position: Vec3V5, radius = 1, layer = 0): VisibilityCandidateV5 {
  return Object.freeze({
    id,
    layer,
    castShadow: true,
    transparent: false,
    visible: true,
    material: 'default',
    distance: 0,
    lod: 0,
    bounds: Object.freeze({ min: { x: position.x - radius, y: position.y - radius, z: position.z - radius }, max: { x: position.x + radius, y: position.y + radius, z: position.z + radius }, radius }),
    transform: Object.freeze({ position, rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }), scale: Object.freeze({ x: 1, y: 1, z: 1 }) }),
  });
}

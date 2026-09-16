import { clamp, distance3, freeze, normalizeVec3, type Bounds3D, type Vec3 } from '../domain/contracts.ts';

export interface Plane { readonly normal: Vec3; readonly constant: number; }
export interface Frustum { readonly planes: readonly Plane[]; }
export interface CullCandidate { readonly id: string; readonly bounds: Bounds3D; readonly position: Vec3; readonly radius: number; readonly layer: number; readonly priority: number; }
export interface CullResult { readonly visible: readonly string[]; readonly tested: number; readonly rejected: number; readonly lod: Readonly<Record<string, number>>; }

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const planeDistance = (plane: Plane, point: Vec3): number => dot(plane.normal, point) + plane.constant;
const sphereVisible = (frustum: Frustum, center: Vec3, radius: number): boolean => frustum.planes.every((plane) => planeDistance(plane, center) >= -Math.max(0, radius));
const boxCenter = (bounds: Bounds3D): Vec3 => freeze({ x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 });
const boxRadius = (bounds: Bounds3D): number => distance3(bounds.min, bounds.max) / 2;

export const makeFrustum = (planes: readonly Partial<Plane>[]): Frustum => freeze({ planes: planes.slice(0, 12).map((plane) => freeze({ normal: normalizeVec3(plane.normal), constant: Number.isFinite(plane.constant) ? plane.constant : 0 })) });

export const frustumCull = (frustum: Frustum, candidates: readonly CullCandidate[], options: { readonly maxVisible?: number; readonly camera?: Vec3 } = {}): CullResult => {
  const maxVisible = Math.max(1, Math.floor(options.maxVisible ?? 20_000));
  const camera = normalizeVec3(options.camera);
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority || a.layer - b.layer || a.id.localeCompare(b.id));
  const visible: string[] = [];
  const lod: Record<string, number> = {};
  let rejected = 0;
  for (const candidate of sorted) {
    if (visible.length >= maxVisible) { rejected += 1; continue; }
    const center = candidate.position ?? boxCenter(candidate.bounds);
    const radius = Math.max(0.01, candidate.radius || boxRadius(candidate.bounds));
    if (!sphereVisible(frustum, center, radius)) { rejected += 1; continue; }
    const distance = distance3(camera, center);
    const normalized = clamp(distance / 2000, 0, 1);
    const level = normalized < 0.2 ? 0 : normalized < 0.45 ? 1 : normalized < 0.7 ? 2 : 3;
    lod[candidate.id] = level;
    visible.push(candidate.id);
  }
  return freeze({ visible, tested: candidates.length, rejected, lod: freeze(lod) });
};

export interface OcclusionHint { readonly id: string; readonly occluded: boolean; readonly confidence: number; readonly frame: number; }
export class OcclusionHintCache {
  readonly #capacity: number;
  readonly #ttlFrames: number;
  readonly #values = new Map<string, OcclusionHint>();
  constructor(options: { readonly capacity?: number; readonly ttlFrames?: number } = {}) { this.#capacity = Math.max(16, Math.floor(options.capacity ?? 4096)); this.#ttlFrames = Math.max(1, Math.floor(options.ttlFrames ?? 6)); }
  set(id: string, occluded: boolean, confidence: number, frame: number): void {
    this.#values.set(id, freeze({ id, occluded, confidence: clamp(confidence, 0, 1), frame: Math.max(0, Math.floor(frame)) }));
    while (this.#values.size > this.#capacity) this.#values.delete(this.#values.keys().next().value ?? '');
  }
  get(id: string, frame: number): OcclusionHint | undefined {
    const value = this.#values.get(id);
    if (!value || frame - value.frame > this.#ttlFrames) { this.#values.delete(id); return undefined; }
    return value;
  }
  clear(): void { this.#values.clear(); }
  size(): number { return this.#values.size; }
}

export interface LodBudget { readonly near: number; readonly mid: number; readonly far: number; readonly culled: number; }
export const allocateLodBudget = (distance: number, quality: number): number => {
  const normalized = clamp(distance / 2500, 0, 1);
  const q = clamp(quality, 0, 1);
  if (normalized < 0.12 * (0.7 + q * 0.3)) return 0;
  if (normalized < 0.38 * (0.8 + q * 0.2)) return 1;
  if (normalized < 0.72 * (0.9 + q * 0.1)) return 2;
  return 3;
};

export const partitionLod = (candidates: readonly CullCandidate[], camera: Vec3, quality = 1): Readonly<{ budgets: LodBudget; ids: readonly string[][] }> => {
  const ids: string[][] = [[], [], [], []];
  for (const candidate of candidates) ids[allocateLodBudget(distance3(camera, candidate.position), quality)]?.push(candidate.id);
  return freeze({ budgets: freeze({ near: ids[0]?.length ?? 0, mid: ids[1]?.length ?? 0, far: ids[2]?.length ?? 0, culled: ids[3]?.length ?? 0 }), ids });
};

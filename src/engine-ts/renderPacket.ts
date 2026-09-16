import type { Aabb3, Vec3 } from './types.js';
import { clamp, stableSort, hashTuple, toHex32 } from './deterministic.js';

export type RenderPass = 'depth' | 'shadow' | 'opaque' | 'alpha-test' | 'transparent' | 'water' | 'particles' | 'post';
export type RenderLayer = 'terrain' | 'structure' | 'character' | 'fauna' | 'vegetation' | 'prop' | 'vfx' | 'ui';
export type MaterialClass = 'opaque' | 'masked' | 'transparent' | 'additive' | 'water' | 'terrain';
export type CullMode = 'none' | 'frustum' | 'distance' | 'occlusion' | 'budget';

export interface CameraPacket {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly near: number;
  readonly far: number;
  readonly fovDegrees: number;
  readonly aspect: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pixelRatio: number;
}

export interface RenderBounds {
  readonly center: Vec3;
  readonly radius: number;
  readonly aabb?: Aabb3;
}

export interface MaterialPacket {
  readonly id: string;
  readonly class: MaterialClass;
  readonly variant: string;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
  readonly doubleSided: boolean;
  readonly textureSet?: string;
  readonly features?: readonly string[];
}

export interface DrawPacket {
  readonly id: string;
  readonly meshId: string;
  readonly materialId: string;
  readonly material: MaterialPacket;
  readonly layer: RenderLayer;
  readonly pass: RenderPass;
  readonly bounds: RenderBounds;
  readonly distance: number;
  readonly screenCoverage: number;
  readonly importance: number;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly animated: boolean;
  readonly instanceGroup?: string;
  readonly sortKey: string;
}

export interface RenderVisibilityStats {
  readonly submitted: number;
  readonly visible: number;
  readonly culledFrustum: number;
  readonly culledDistance: number;
  readonly culledBudget: number;
  readonly shadowCasters: number;
  readonly animated: number;
  readonly transparent: number;
}

export interface RenderFramePacket {
  readonly version: number;
  readonly frame: number;
  readonly tick: number;
  readonly camera: CameraPacket;
  readonly passes: Readonly<Record<RenderPass, readonly DrawPacket[]>>;
  readonly stats: RenderVisibilityStats;
  readonly checksum: string;
  readonly renderScale: number;
  readonly cullMode: CullMode;
}

export interface RenderPacketOptions {
  readonly maxDraws?: number;
  readonly maxShadows?: number;
  readonly maxAnimated?: number;
  readonly maxTransparent?: number;
  readonly maxDistance?: number;
  readonly renderScale?: number;
  readonly cullMode?: CullMode;
}

const PASS_ORDER: readonly RenderPass[] = Object.freeze(['depth', 'shadow', 'opaque', 'alpha-test', 'transparent', 'water', 'particles', 'post']);
const LAYER_WEIGHT: Readonly<Record<RenderLayer, number>> = Object.freeze({ terrain: 100, structure: 90, character: 80, fauna: 75, vegetation: 60, prop: 50, vfx: 40, ui: 10 });

export class RenderFrameBuilder {
  private readonly options: Required<RenderPacketOptions>;
  private draws: DrawPacket[] = [];
  private frame = 0;
  private tick = 0;

  public constructor(options: RenderPacketOptions = {}) {
    this.options = Object.freeze({ maxDraws: Math.max(64, Math.trunc(options.maxDraws ?? 20_000)), maxShadows: Math.max(0, Math.trunc(options.maxShadows ?? 1200)), maxAnimated: Math.max(0, Math.trunc(options.maxAnimated ?? 1200)), maxTransparent: Math.max(0, Math.trunc(options.maxTransparent ?? 2500)), maxDistance: Math.max(1, Number(options.maxDistance ?? 10_000)), renderScale: clamp(Number(options.renderScale ?? 1), 0.5, 1), cullMode: options.cullMode ?? 'frustum' });
  }

  public setFrame(frame: number, tick: number): this { this.frame = Math.max(0, Math.trunc(frame)); this.tick = Math.max(0, Math.trunc(tick)); return this; }
  public add(draw: DrawPacket): boolean { if (this.draws.length >= this.options.maxDraws || !draw.id || !draw.meshId || !draw.materialId) return false; this.draws.push(normalizeDraw(draw)); return true; }
  public addMany(draws: readonly DrawPacket[]): number { let accepted = 0; for (const draw of draws) if (this.add(draw)) accepted += 1; return accepted; }
  public clear(): void { this.draws.length = 0; }

  public build(camera: CameraPacket): RenderFramePacket {
    const sorted = stableSort(this.draws, compareDraw);
    const passes: Record<RenderPass, DrawPacket[]> = { depth: [], shadow: [], opaque: [], 'alpha-test': [], transparent: [], water: [], particles: [], post: [] };
    let frustum = 0; let distance = 0; let budget = 0; let shadow = 0; let animated = 0; let transparent = 0; let visible = 0;
    for (const draw of sorted) {
      const dist = distance3(draw.bounds.center, camera.position);
      if (this.options.cullMode !== 'none' && !frustumVisible(draw.bounds, camera)) { frustum += 1; continue; }
      if (dist > this.options.maxDistance || (this.options.cullMode === 'distance' && dist > camera.far)) { distance += 1; continue; }
      if (visible >= this.options.maxDraws) { budget += 1; continue; }
      const adjusted = Object.freeze({ ...draw, distance: dist, screenCoverage: estimateCoverage(draw.bounds, dist, camera) });
      passes[adjusted.pass].push(adjusted);
      visible += 1;
      if (adjusted.castShadow && shadow < this.options.maxShadows) { passes.shadow.push(adjusted); shadow += 1; }
      if (adjusted.animated && animated < this.options.maxAnimated) animated += 1;
      else if (adjusted.animated) passes[adjusted.pass].pop();
      if (adjusted.material.transparent) transparent += 1;
    }
    if (transparent > this.options.maxTransparent) {
      const candidates = stableSort(passes.transparent, (a, b) => a.importance - b.importance || b.distance - a.distance || a.id.localeCompare(b.id));
      const evict = candidates.slice(0, transparent - this.options.maxTransparent);
      const reject = new Set(evict.map(item => item.id));
      passes.transparent = passes.transparent.filter(item => !reject.has(item.id));
      transparent = this.options.maxTransparent;
      budget += reject.size;
    }
    const frozenPasses = {} as Record<RenderPass, readonly DrawPacket[]>;
    for (const pass of PASS_ORDER) frozenPasses[pass] = Object.freeze(stableSort(passes[pass], compareWithinPass));
    const stats: RenderVisibilityStats = Object.freeze({ submitted: this.draws.length, visible, culledFrustum: frustum, culledDistance: distance, culledBudget: budget, shadowCasters: shadow, animated, transparent });
    const canonical = JSON.stringify({ version: 2, frame: this.frame, tick: this.tick, camera, passes: frozenPasses, stats, renderScale: this.options.renderScale, cullMode: this.options.cullMode });
    return Object.freeze({ version: 2, frame: this.frame, tick: this.tick, camera: Object.freeze({ ...camera }), passes: Object.freeze(frozenPasses), stats, checksum: toHex32(hashTuple(this.frame, this.tick, canonical)), renderScale: this.options.renderScale, cullMode: this.options.cullMode });
  }
}

export const normalizeCameraPacket = (camera: CameraPacket): CameraPacket => Object.freeze({ ...camera, near: Math.max(0.001, camera.near), far: Math.max(camera.near + 1, camera.far), fovDegrees: clamp(camera.fovDegrees, 1, 179), aspect: Math.max(0.01, camera.aspect), viewportWidth: Math.max(1, Math.trunc(camera.viewportWidth)), viewportHeight: Math.max(1, Math.trunc(camera.viewportHeight)), pixelRatio: clamp(camera.pixelRatio, 0.25, 4) });

export const createDrawPacket = (input: Omit<DrawPacket, 'sortKey' | 'distance' | 'screenCoverage'> & Partial<Pick<DrawPacket, 'distance' | 'screenCoverage'>>): DrawPacket => Object.freeze({ ...input, distance: Math.max(0, Number(input.distance ?? 0)), screenCoverage: clamp(Number(input.screenCoverage ?? 0), 0, 1), importance: clamp(Number(input.importance ?? 0), -1000, 1000), bounds: normalizeBounds(input.bounds), material: Object.freeze({ ...input.material, transparent: input.material.transparent ?? materialTransparent(input.material.class), depthWrite: input.material.depthWrite ?? !materialTransparent(input.material.class), doubleSided: Boolean(input.material.doubleSided), ...(input.material.features ? { features: Object.freeze([...input.material.features]) } : {}) }), sortKey: buildSortKey(input) });

export const projectScreenCoverage = (bounds: RenderBounds, distance: number, camera: Pick<CameraPacket, 'viewportHeight' | 'fovDegrees'>): number => estimateCoverage(bounds, distance, camera as CameraPacket);
export const shouldRenderLod = (coverage: number, thresholds: readonly number[]): number => { const value = clamp(coverage, 0, 1); for (let index = 0; index < thresholds.length; index += 1) if (value >= Number(thresholds[index] ?? 0)) return index; return thresholds.length; };
export const chooseRenderPass = (material: MaterialPacket, layer: RenderLayer): RenderPass => layer === 'vfx' && material.class === 'additive' ? 'particles' : material.class === 'water' ? 'water' : material.class === 'masked' ? 'alpha-test' : material.transparent ? 'transparent' : 'opaque';
export const renderPassOrder = (): readonly RenderPass[] => PASS_ORDER;

const normalizeDraw = (draw: DrawPacket): DrawPacket => createDrawPacket(draw);
const normalizeBounds = (bounds: RenderBounds): RenderBounds => Object.freeze({ center: Object.freeze({ ...bounds.center }), radius: Math.max(0.001, Number(bounds.radius)), ...(bounds.aabb ? { aabb: Object.freeze({ min: Object.freeze({ ...bounds.aabb.min }), max: Object.freeze({ ...bounds.aabb.max }) }) } : {}) });
const materialTransparent = (material: MaterialClass): boolean => material === 'transparent' || material === 'additive' || material === 'water';
const buildSortKey = (draw: Partial<DrawPacket>): string => `${String(PASS_ORDER.indexOf(draw.pass ?? 'opaque')).padStart(2, '0')}:${String(1000 - Math.round((draw.importance ?? 0) * 10)).padStart(5, '0')}:${draw.materialId ?? ''}:${draw.meshId ?? ''}:${draw.id ?? ''}`;
const compareDraw = (a: DrawPacket, b: DrawPacket): number => { const pass = PASS_ORDER.indexOf(a.pass) - PASS_ORDER.indexOf(b.pass); if (pass !== 0) return pass; const layer = LAYER_WEIGHT[b.layer] - LAYER_WEIGHT[a.layer]; if (layer !== 0) return layer; if (a.instanceGroup !== b.instanceGroup) return String(a.instanceGroup ?? '').localeCompare(String(b.instanceGroup ?? '')); return a.sortKey.localeCompare(b.sortKey); };
const compareWithinPass = (a: DrawPacket, b: DrawPacket): number => a.materialId.localeCompare(b.materialId) || a.meshId.localeCompare(b.meshId) || b.importance - a.importance || a.id.localeCompare(b.id);
const distance3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const frustumVisible = (bounds: RenderBounds, camera: CameraPacket): boolean => { const distance = distance3(bounds.center, camera.position); if (distance - bounds.radius > camera.far || distance + bounds.radius < camera.near) return false; const forward = camera.forward; const dx = bounds.center.x - camera.position.x; const dy = bounds.center.y - camera.position.y; const dz = bounds.center.z - camera.position.z; const length = Math.max(0.001, Math.hypot(dx, dy, dz)); const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / length; const halfFov = Math.cos((camera.fovDegrees * Math.PI) / 360); return dot >= halfFov - Math.min(0.35, bounds.radius / Math.max(length, 1)); };
const estimateCoverage = (bounds: RenderBounds, distance: number, camera: Pick<CameraPacket, 'viewportHeight' | 'fovDegrees'>): number => { if (distance <= bounds.radius) return 1; const projection = bounds.radius / Math.tan((Math.max(1, camera.fovDegrees) * Math.PI) / 360) / Math.max(1, distance); return clamp(projection * Math.max(1, camera.viewportHeight) * 0.5, 0, 1); };

import type { Budget, Disposable, EntityId, Vec3 } from './coreTypes.js';
import { clamp, stableSort } from './coreTypes.js';

export type QualityTier = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';
export interface CameraView { readonly position: Vec3; readonly forward: Vec3; readonly near: number; readonly far: number; readonly width: number; readonly height: number; readonly pixelRatio: number; }
export interface RenderItem { readonly entity: EntityId; readonly position: Vec3; readonly radius: number; readonly material: string; readonly geometry: string; readonly priority: number; readonly transparent: boolean; readonly layer: number; }
export interface RenderPacket { readonly frame: number; readonly quality: QualityTier; readonly view: CameraView; readonly items: readonly RenderItem[]; readonly drawCalls: number; readonly triangles: number; readonly culled: number; }
export interface RenderMetrics { readonly frame: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly visible: number; readonly culled: number; readonly quality: QualityTier; readonly pressure: number; }
export interface RenderBudgetOptions { readonly budget?: Partial<Budget>; readonly initialQuality?: QualityTier; readonly downgradeFrames?: number; readonly upgradeFrames?: number; }

const RANK: Record<QualityTier, number> = { minimal: 0, low: 1, medium: 2, high: 3, ultra: 4 };
const TIERS = ['minimal', 'low', 'medium', 'high', 'ultra'] as const;
const budgetFor = (tier: QualityTier, base: Budget): Budget => {
  const factors: Record<QualityTier, number> = { minimal: 0.45, low: 0.65, medium: 0.8, high: 1, ultra: 1.35 };
  const f = factors[tier];
  return { cpuMs: base.cpuMs * f, gpuMs: base.gpuMs * f, networkBytes: base.networkBytes, assetBytes: base.assetBytes * f, drawCalls: Math.max(1, Math.floor(base.drawCalls * f)), triangles: Math.max(1, Math.floor(base.triangles * f)) };
};

function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normalize(v: Vec3): Vec3 { const m = Math.hypot(v.x, v.y, v.z) || 1; return Object.freeze({ x: v.x / m, y: v.y / m, z: v.z / m }); }
function pressure(metrics: Pick<RenderMetrics, 'cpuMs' | 'gpuMs' | 'drawCalls' | 'triangles'>, budget: Budget): number {
  return clamp(Math.max(metrics.cpuMs / Math.max(1, budget.cpuMs), metrics.gpuMs / Math.max(1, budget.gpuMs), metrics.drawCalls / Math.max(1, budget.drawCalls), metrics.triangles / Math.max(1, budget.triangles)), 0, 2);
}

export class RenderRuntime implements Disposable {
  #quality: QualityTier;
  #budget: Budget;
  #downgradeFrames: number;
  #upgradeFrames: number;
  #badFrames = 0;
  #goodFrames = 0;
  #disposed = false;
  #frame = 0;
  #lastMetrics: RenderMetrics = Object.freeze({ frame: 0, cpuMs: 0, gpuMs: 0, drawCalls: 0, triangles: 0, visible: 0, culled: 0, quality: 'high', pressure: 0 });

  constructor(options: RenderBudgetOptions = {}) {
    this.#quality = options.initialQuality ?? 'high';
    this.#budget = { cpuMs: 12, gpuMs: 12, networkBytes: 256000, assetBytes: 16000000, drawCalls: 800, triangles: 900000, ...options.budget };
    this.#downgradeFrames = Math.max(2, Math.trunc(options.downgradeFrames ?? 3));
    this.#upgradeFrames = Math.max(10, Math.trunc(options.upgradeFrames ?? 120));
  }

  get quality(): QualityTier { return this.#quality; }
  get metrics(): RenderMetrics { return this.#lastMetrics; }

  build(view: CameraView, items: readonly RenderItem[], timing: { cpuMs?: number; gpuMs?: number } = {}): RenderPacket {
    if (this.#disposed) return Object.freeze({ frame: this.#frame, quality: 'minimal', view, items: [], drawCalls: 0, triangles: 0, culled: items.length });
    this.#frame += 1;
    const activeBudget = budgetFor(this.#quality, this.#budget);
    const forward = normalize(view.forward);
    const scored = items.map(item => {
      const to = { x: item.position.x - view.position.x, y: item.position.y - view.position.y, z: item.position.z - view.position.z };
      const d = distance(item.position, view.position);
      const facing = dot(normalize(to), forward);
      return { item, distance: d, facing, score: item.priority * 100 + facing * 20 - d };
    }).filter(entry => entry.distance - entry.item.radius <= view.far && (entry.facing >= -0.2 || entry.distance < 4));
    const visibleCap = Math.min(activeBudget.drawCalls, Math.max(1, Math.floor(items.length * (RANK[this.#quality] + 1) / 5)));
    const visible = scored.sort((a, b) => b.score - a.score || String(a.item.entity).localeCompare(String(b.item.entity))).slice(0, visibleCap);
    const drawCalls = visible.length;
    const triangles = visible.reduce((sum, entry) => sum + (entry.item.transparent ? 180 : 900), 0);
    const metrics: RenderMetrics = Object.freeze({ frame: this.#frame, cpuMs: Math.max(0, timing.cpuMs ?? 0), gpuMs: Math.max(0, timing.gpuMs ?? 0), drawCalls, triangles, visible: visible.length, culled: items.length - visible.length, quality: this.#quality, pressure: pressure({ cpuMs: Math.max(0, timing.cpuMs ?? 0), gpuMs: Math.max(0, timing.gpuMs ?? 0), drawCalls, triangles }, activeBudget) });
    this.#adapt(metrics, activeBudget);
    this.#lastMetrics = metrics;
    return Object.freeze({ frame: this.#frame, quality: this.#quality, view, items: Object.freeze(visible.map(v => v.item)), drawCalls, triangles, culled: items.length - visible.length });
  }

  forceQuality(tier: QualityTier): void { this.#quality = tier; this.#badFrames = 0; this.#goodFrames = 0; }
  budget(tier = this.#quality): Budget { return Object.freeze({ ...budgetFor(tier, this.#budget) }); }
  dispose(): void { this.#disposed = true; }

  #adapt(metrics: RenderMetrics, budget: Budget): void {
    const over = metrics.pressure > 1;
    const under = metrics.pressure < 0.55;
    this.#badFrames = over ? this.#badFrames + 1 : 0;
    this.#goodFrames = under ? this.#goodFrames + 1 : 0;
    if (this.#badFrames >= this.#downgradeFrames && RANK[this.#quality] > 0) {
      this.#quality = TIERS[Math.max(0, RANK[this.#quality] - 1)]!;
      this.#badFrames = 0;
      this.#goodFrames = 0;
      return;
    }
    if (this.#goodFrames >= this.#upgradeFrames && RANK[this.#quality] < 4) {
      this.#quality = TIERS[Math.min(4, RANK[this.#quality] + 1)]!;
      this.#goodFrames = 0;
      this.#badFrames = 0;
      void budget;
    }
  }
}

export const defaultCameraView = (): CameraView => Object.freeze({ position: { x: 0, y: 2, z: 5 }, forward: { x: 0, y: 0, z: -1 }, near: 0.1, far: 250, width: 1280, height: 720, pixelRatio: 1 });

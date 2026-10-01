import type { BrowserCapabilities, FrameBudget, GraphicsBackend, QualityState, RenderDecision, RenderPass, RenderResource } from './types';
import { clamp, hashJson, stableSort } from './deterministic';

export interface RenderLimits { readonly maxResources: number; readonly maxPasses: number; readonly maxTransientBytes: number; readonly maxDrawCalls: number; readonly maxTriangles: number; readonly targetGpuMs: number; }
const DEFAULT_LIMITS: RenderLimits = Object.freeze({ maxResources: 512, maxPasses: 128, maxTransientBytes: 268435456, maxDrawCalls: 12000, maxTriangles: 8000000, targetGpuMs: 14 });

export interface RenderPlan { readonly passes: readonly RenderPass[]; readonly resources: readonly RenderResource[]; readonly estimatedGpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly digest: string; }

export class FrameGraph {
  readonly limits: RenderLimits; #resources = new Map<string, RenderResource>(); #passes = new Map<string, RenderPass>();
  constructor(limits: Partial<RenderLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }
  registerResource(resource: RenderResource): boolean {
    if (!resource.id || resource.bytes < 0) return false;
    if (!this.#resources.has(resource.id) && this.#resources.size >= this.limits.maxResources) return false;
    if (resource.transient && resource.bytes > this.limits.maxTransientBytes) return false;
    this.#resources.set(resource.id, Object.freeze({ ...resource })); return true;
  }
  registerPass(pass: RenderPass): boolean {
    if (!pass.id || pass.estimatedGpuMs < 0 || pass.drawCalls < 0 || pass.triangles < 0) return false;
    if (!this.#passes.has(pass.id) && this.#passes.size >= this.limits.maxPasses) return false;
    if ([...pass.reads, ...pass.writes].some((id) => !this.#resources.has(id))) return false;
    this.#passes.set(pass.id, Object.freeze({ ...pass, reads: Object.freeze([...pass.reads]), writes: Object.freeze([...pass.writes]) })); return true;
  }
  removePass(id: string): boolean { return this.#passes.delete(id); }
  removeResource(id: string): boolean {
    if ([...this.#passes.values()].some((p) => p.reads.includes(id) || p.writes.includes(id))) return false;
    return this.#resources.delete(id);
  }
  compile(gpuCap = this.limits.targetGpuMs * 1.65): RenderPlan {
    const selected: RenderPass[] = []; let gpu = 0; let draws = 0; let tris = 0;
    for (const pass of stableSort([...this.#passes.values()], (a, b) => a.id.localeCompare(b.id))) {
      const fits = gpu + pass.estimatedGpuMs <= gpuCap && draws + pass.drawCalls <= this.limits.maxDrawCalls && tris + pass.triangles <= this.limits.maxTriangles;
      if (fits || !pass.optional) { selected.push(pass); gpu += pass.estimatedGpuMs; draws += pass.drawCalls; tris += pass.triangles; }
    }
    const resources = stableSort([...this.#resources.values()], (a, b) => a.id.localeCompare(b.id));
    return Object.freeze({ passes: Object.freeze(selected), resources: Object.freeze(resources), estimatedGpuMs: gpu, drawCalls: draws, triangles: tris, digest: hashJson({ selected, resources }) });
  }
  clearTransient(): number {
    let count = 0; for (const [id, resource] of this.#resources) if (resource.transient) { this.#resources.delete(id); count += 1; } return count;
  }
  snapshot(): { readonly resources: readonly RenderResource[]; readonly passes: readonly RenderPass[] } {
    return Object.freeze({ resources: Object.freeze([...this.#resources.values()]), passes: Object.freeze([...this.#passes.values()]) });
  }
}

export function detectGraphicsBackend(capabilities: Partial<BrowserCapabilities>): GraphicsBackend {
  return capabilities.backend === 'webgpu' ? 'webgpu' : capabilities.backend === 'webgl2' ? 'webgl2' : 'headless';
}
export function qualityTier(tier: 0 | 1 | 2 | 3 | 4): QualityState {
  const table: Readonly<Record<number, QualityState>> = Object.freeze({
    0: Object.freeze({ tier: 0, renderScale: 0.55, shadows: false, foliageDensity: 0.2, postFx: 0, maxAudioVoices: 24 }),
    1: Object.freeze({ tier: 1, renderScale: 0.67, shadows: false, foliageDensity: 0.35, postFx: 0.25, maxAudioVoices: 32 }),
    2: Object.freeze({ tier: 2, renderScale: 0.78, shadows: true, foliageDensity: 0.5, postFx: 0.5, maxAudioVoices: 48 }),
    3: Object.freeze({ tier: 3, renderScale: 0.9, shadows: true, foliageDensity: 0.75, postFx: 0.8, maxAudioVoices: 64 }),
    4: Object.freeze({ tier: 4, renderScale: 1, shadows: true, foliageDensity: 1, postFx: 1, maxAudioVoices: 96 }),
  });
  const state = table[tier];
  if (!state) throw new RangeError('unsupported quality tier');
  return state;
}
export class RenderQualityGovernor {
  readonly budget: FrameBudget; #quality: QualityState; #good = 0; #bad = 0;
  constructor(budget: FrameBudget, tier: 0 | 1 | 2 | 3 | 4 = 3) { this.budget = Object.freeze({ ...budget }); this.#quality = qualityTier(tier); }
  evaluate(sample: Partial<FrameBudget>): RenderDecision {
    const budget = Object.freeze({ frameMs: Math.max(0, sample.frameMs ?? 0), cpuMs: Math.max(0, sample.cpuMs ?? 0), gpuMs: Math.max(0, sample.gpuMs ?? 0),
      drawCalls: Math.max(0, sample.drawCalls ?? 0), triangles: Math.max(0, sample.triangles ?? 0), memoryBytes: Math.max(0, sample.memoryBytes ?? 0) });
    const pressure = Math.max(budget.frameMs / Math.max(1, this.budget.frameMs), budget.cpuMs / Math.max(1, this.budget.cpuMs), budget.gpuMs / Math.max(1, this.budget.gpuMs),
      budget.drawCalls / Math.max(1, this.budget.drawCalls), budget.triangles / Math.max(1, this.budget.triangles), budget.memoryBytes / Math.max(1, this.budget.memoryBytes));
    if (pressure > 1.15) { this.#bad += 1; this.#good = 0; } else if (pressure < 0.72) { this.#good += 1; this.#bad = 0; } else { this.#good = 0; this.#bad = 0; }
    let tier = this.#quality.tier; let reason: RenderDecision['reason'] = 'steady';
    if (pressure > 2.5) { tier = Math.max(0, tier - 2) as 0 | 1 | 2 | 3 | 4; reason = 'panic'; }
    else if (this.#bad >= 8) { tier = Math.max(0, tier - 1) as 0 | 1 | 2 | 3 | 4; this.#bad = 0; reason = 'downgrade'; }
    else if (this.#good >= 60) { tier = Math.min(4, tier + 1) as 0 | 1 | 2 | 3 | 4; this.#good = 0; reason = 'upgrade'; }
    this.#quality = qualityTier(tier); return Object.freeze({ quality: this.#quality, budget, reason, pressure: clamp(pressure, 0, 4) });
  }
  current(): QualityState { return this.#quality; }
  force(tier: 0 | 1 | 2 | 3 | 4): void { this.#quality = qualityTier(tier); this.#good = 0; this.#bad = 0; }
}

export interface GpuResourceState { readonly id: string; readonly backend: GraphicsBackend; readonly bytes: number; readonly resident: boolean; readonly generation: number; }
export class GpuResourceLifecycle {
  readonly backend: GraphicsBackend; #resources = new Map<string, GpuResourceState>(); #generation = 0;
  constructor(backend: GraphicsBackend) { this.backend = backend; }
  acquire(id: string, bytes: number): GpuResourceState {
    const current = this.#resources.get(id); if (current?.resident) return current;
    const state = Object.freeze({ id, backend: this.backend, bytes: Math.max(0, Math.trunc(bytes)), resident: true, generation: ++this.#generation });
    this.#resources.set(id, state); return state;
  }
  release(id: string): boolean {
    const current = this.#resources.get(id); if (!current) return false;
    this.#resources.set(id, Object.freeze({ ...current, resident: false, generation: ++this.#generation })); return true;
  }
  evictToBudget(maxBytes: number): readonly string[] {
    let total = this.residentBytes(); const evicted: string[] = [];
    for (const item of stableSort([...this.#resources.values()].filter((v) => v.resident), (a, b) => a.generation - b.generation || a.id.localeCompare(b.id))) {
      if (total <= maxBytes) break; total -= item.bytes; this.release(item.id); evicted.push(item.id);
    }
    return Object.freeze(evicted);
  }
  residentBytes(): number { return [...this.#resources.values()].filter((v) => v.resident).reduce((sum, v) => sum + v.bytes, 0); }
  snapshot(): readonly GpuResourceState[] { return Object.freeze([...this.#resources.values()]); }
}
export function estimateTextureBytes(width: number, height: number, bpp = 4, mips = true): number {
  const base = Math.max(1, Math.trunc(width)) * Math.max(1, Math.trunc(height)) * Math.max(1, Math.trunc(bpp));
  return mips ? Math.ceil(base * 4 / 3) : base;
}
export function estimateBufferBytes(elements: number, stride: number): number { return Math.max(0, Math.trunc(elements)) * Math.max(1, Math.trunc(stride)); }

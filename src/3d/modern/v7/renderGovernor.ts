import { clamp, digest, stableSort, type Disposable } from './primitives.js';

export type GraphicsBackend = 'webgpu' | 'webgl2' | 'headless';
export type QualityTier = 'minimal' | 'balanced' | 'high' | 'ultra';
export interface RenderSignals { readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly memoryBytes: number; readonly thermal01: number; readonly networkPressure01: number; }
export interface RenderBudget { readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly memoryBytes: number; }
export interface QualityProfile { readonly tier: QualityTier; readonly renderScale: number; readonly shadowCascades: number; readonly textureScale: number; readonly maxLights: number; readonly particles: number; readonly postFx: number; readonly dynamicResolution: boolean; }
export interface RenderDecision { readonly backend: GraphicsBackend; readonly before: QualityTier; readonly after: QualityTier; readonly changed: boolean; readonly pressure01: number; readonly scale: number; readonly reason: string; readonly digest: string; }

const profiles: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  minimal: Object.freeze({ tier: 'minimal', renderScale: .6, shadowCascades: 1, textureScale: .5, maxLights: 2, particles: .25, postFx: .2, dynamicResolution: true }),
  balanced: Object.freeze({ tier: 'balanced', renderScale: .8, shadowCascades: 2, textureScale: .75, maxLights: 4, particles: .55, postFx: .5, dynamicResolution: true }),
  high: Object.freeze({ tier: 'high', renderScale: .95, shadowCascades: 3, textureScale: 1, maxLights: 8, particles: .8, postFx: .8, dynamicResolution: true }),
  ultra: Object.freeze({ tier: 'ultra', renderScale: 1, shadowCascades: 4, textureScale: 1.25, maxLights: 12, particles: 1, postFx: 1, dynamicResolution: false }),
});
const order: readonly QualityTier[] = ['minimal', 'balanced', 'high', 'ultra'];

export class RenderGovernor implements Disposable {
  #backend: GraphicsBackend = 'headless'; #tier: QualityTier = 'balanced'; #pressureHigh = 0; #pressureLow = 0; #disposed = false; #decisions = 0;
  readonly budgets: RenderBudget;
  constructor(budgets: Partial<RenderBudget> = {}) { this.budgets = Object.freeze({ frameMs: 16.7, cpuMs: 10, gpuMs: 10, drawCalls: 900, triangles: 1_200_000, memoryBytes: 512 * 1024 * 1024, ...budgets }); }
  setBackend(backend: GraphicsBackend): void { if (!this.#disposed) this.#backend = backend; }
  setTier(tier: QualityTier): void { if (!this.#disposed && profiles[tier]) this.#tier = tier; }
  profile(): QualityProfile { return profiles[this.#tier]; }
  evaluate(signals: RenderSignals): RenderDecision {
    if (this.#disposed) return Object.freeze({ backend: this.#backend, before: this.#tier, after: this.#tier, changed: false, pressure01: 0, scale: 1, reason: 'disposed', digest: 'disposed' });
    const ratios = [signals.frameMs / this.budgets.frameMs, signals.cpuMs / this.budgets.cpuMs, signals.gpuMs / this.budgets.gpuMs, signals.drawCalls / this.budgets.drawCalls, signals.triangles / this.budgets.triangles, signals.memoryBytes / this.budgets.memoryBytes, 1 + signals.thermal01 * .35, 1 + signals.networkPressure01 * .1];
    const pressure = clamp(Math.max(...ratios) - .75, 0, 1);
    if (pressure > .08) { this.#pressureHigh += 1; this.#pressureLow = 0; } else if (pressure < .02) { this.#pressureLow += 1; this.#pressureHigh = 0; } else { this.#pressureHigh = Math.max(0, this.#pressureHigh - 1); this.#pressureLow = Math.max(0, this.#pressureLow - 1); }
    const before = this.#tier; let after = before; let reason = 'stable'; const index = order.indexOf(before);
    if (this.#pressureHigh >= 3 && index > 0) { after = order[index - 1]!; this.#pressureHigh = 0; reason = 'sustained-pressure'; }
    else if (this.#pressureHigh >= 7 && index > 1) { after = order[Math.max(0, index - 2)]!; this.#pressureHigh = 0; reason = 'severe-pressure'; }
    else if (this.#pressureLow >= 12 && index < order.length - 1) { after = order[index + 1]!; this.#pressureLow = 0; reason = 'sustained-headroom'; }
    this.#tier = after; this.#decisions += Number(after !== before); const profile = profiles[after]; const scale = clamp(profile.renderScale * (signals.frameMs > this.budgets.frameMs ? this.budgets.frameMs / Math.max(this.budgets.frameMs, signals.frameMs) : 1), .5, 1.15);
    return Object.freeze({ backend: this.#backend, before, after, changed: after !== before, pressure01: pressure, scale, reason, digest: digest(this.#backend, before, after, pressure, signals.frameMs, signals.gpuMs) });
  }
  decisions(): number { return this.#decisions; }
  dispose(): void { this.#disposed = true; }
}

export function sortRenderCandidates<T extends { id: string; distance: number; priority: number }>(items: readonly T[], max = 1024): readonly T[] {
  return Object.freeze(stableSort(items, (a, b) => b.priority - a.priority || a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, clamp(max, 1, 8192)));
}

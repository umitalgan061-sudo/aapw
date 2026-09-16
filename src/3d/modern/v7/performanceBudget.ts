import { clamp, stableSort, type Disposable } from './primitives.js';

export type PressureDomain = 'cpu' | 'gpu' | 'draw' | 'triangle' | 'memory' | 'network' | 'simulation' | 'audio';
export interface BudgetThreshold { readonly domain: PressureDomain; readonly target: number; readonly warning: number; readonly critical: number; }
export interface PerformanceSample { readonly tick: number; readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly memoryBytes: number; readonly networkBytes: number; readonly simulationMs: number; readonly audioVoices: number; }
export interface PerformancePressure { readonly domain: PressureDomain; readonly ratio01: number; readonly state: 'normal' | 'warning' | 'critical'; }
export interface PerformanceSummary { readonly sampleCount: number; readonly frameP50: number; readonly frameP95: number; readonly frameP99: number; readonly worst: readonly PerformancePressure[]; readonly budgetHealthy: boolean; readonly digest: string; }

const defaults: Readonly<Record<PressureDomain, BudgetThreshold>> = Object.freeze({
  cpu: { domain: 'cpu', target: 10, warning: 12, critical: 16 }, gpu: { domain: 'gpu', target: 10, warning: 13, critical: 16 }, draw: { domain: 'draw', target: 900, warning: 1200, critical: 1800 }, triangle: { domain: 'triangle', target: 1_200_000, warning: 1_600_000, critical: 2_200_000 }, memory: { domain: 'memory', target: 512 * 1024 * 1024, warning: 700 * 1024 * 1024, critical: 900 * 1024 * 1024 }, network: { domain: 'network', target: 256_000, warning: 512_000, critical: 1_000_000 }, simulation: { domain: 'simulation', target: 7, warning: 10, critical: 14 }, audio: { domain: 'audio', target: 64, warning: 96, critical: 128 },
});

function pct(values: readonly number[], ratio: number): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0; }
function domainValue(sample: PerformanceSample, domain: PressureDomain): number { return ({ cpu: sample.cpuMs, gpu: sample.gpuMs, draw: sample.drawCalls, triangle: sample.triangles, memory: sample.memoryBytes, network: sample.networkBytes, simulation: sample.simulationMs, audio: sample.audioVoices })[domain]; }

export class PerformanceBudgetRuntime implements Disposable {
  readonly sampleLimit: number; #thresholds = new Map<PressureDomain, BudgetThreshold>(); #samples: PerformanceSample[] = []; #disposed = false;
  constructor(sampleLimit = 2048, overrides: Partial<Record<PressureDomain, Partial<BudgetThreshold>>> = {}) { this.sampleLimit = clamp(Math.trunc(sampleLimit), 32, 100_000); for (const domain of Object.keys(defaults) as PressureDomain[]) this.#thresholds.set(domain, Object.freeze({ ...defaults[domain], ...overrides[domain] })); }
  sample(input: PerformanceSample): void { if (this.#disposed) return; this.#samples.push(Object.freeze({ ...input, tick: Math.trunc(input.tick) })); if (this.#samples.length > this.sampleLimit) this.#samples.shift(); }
  pressures(sample = this.#samples.at(-1)): readonly PerformancePressure[] { if (!sample) return []; const result: PerformancePressure[] = []; for (const threshold of this.#thresholds.values()) { const ratio = threshold.target > 0 ? sampleValue(sample, threshold.domain) / threshold.target : 0; const state = sampleValue(sample, threshold.domain) >= threshold.critical ? 'critical' : sampleValue(sample, threshold.domain) >= threshold.warning ? 'warning' : 'normal'; result.push(Object.freeze({ domain: threshold.domain, ratio01: ratio, state })); } return Object.freeze(stableSort(result, (a, b) => b.ratio01 - a.ratio01 || a.domain.localeCompare(b.domain))); }
  summary(): PerformanceSummary { const frame = this.#samples.map((sample) => sample.frameMs); const worst = this.pressures(); return Object.freeze({ sampleCount: frame.length, frameP50: pct(frame, .5), frameP95: pct(frame, .95), frameP99: pct(frame, .99), worst, budgetHealthy: worst.every((pressure) => pressure.state !== 'critical'), digest: `${frame.length}:${pct(frame,.95).toFixed(3)}:${worst.map((item) => `${item.domain}:${item.state}`).join('|')}` }); }
  recent(limit = 120): readonly PerformanceSample[] { return Object.freeze(this.#samples.slice(-clamp(Math.trunc(limit), 1, this.sampleLimit))); }
  clear(): void { this.#samples.length = 0; }
  dispose(): void { this.#disposed = true; this.clear(); this.#thresholds.clear(); }
}
function sampleValue(sample: PerformanceSample, domain: PressureDomain): number { return Math.max(0, Number(domainValue(sample, domain) ?? 0)); }

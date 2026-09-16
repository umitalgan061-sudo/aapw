import type { Disposable } from './coreTypes.js';
import type { RuntimeHealth } from './types.js';

export interface HealthInput { readonly runtime: RuntimeHealth; readonly frameMs: number; readonly packetLoss: number; readonly memoryRatio: number; readonly pendingCommands: number; readonly droppedSteps: number; }
export interface HealthReport { readonly phase: RuntimeHealth['phase']; readonly score: number; readonly healthy: boolean; readonly faults: readonly string[]; readonly factors: Readonly<Record<string, number>>; }

function clamp01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1)); }
function penalty(value: number, limit: number): number { return clamp01(value / Math.max(0.0001, limit)); }

export class HealthRuntime implements Disposable {
  #last: HealthReport | null = null;
  #disposed = false;
  evaluate(input: HealthInput): HealthReport {
    if (this.#disposed) return Object.freeze({ phase: 'disposed', score: 0, healthy: false, faults: ['disposed'], factors: {} });
    const frame = penalty(input.frameMs, 24);
    const network = clamp01(input.packetLoss / 0.12);
    const memory = clamp01(input.memoryRatio);
    const queue = penalty(input.pendingCommands, 512);
    const simulation = clamp01(input.droppedSteps / 5);
    const faults: string[] = [];
    if (frame >= 1) faults.push('frame-budget');
    if (network >= 1) faults.push('network-loss');
    if (memory >= 1) faults.push('memory-budget');
    if (queue >= 1) faults.push('command-pressure');
    if (simulation >= 1) faults.push('simulation-drops');
    if (input.runtime.faults > 0) faults.push('runtime-faults');
    const score = clamp01(1 - (frame * 0.25 + network * 0.2 + memory * 0.2 + queue * 0.15 + simulation * 0.2));
    const report = Object.freeze({ phase: input.runtime.phase, score, healthy: score >= 0.75 && faults.length === 0, faults: Object.freeze([...new Set(faults)]), factors: Object.freeze({ frame, network, memory, queue, simulation }) });
    this.#last = report;
    return report;
  }
  latest(): HealthReport | null { return this.#last; }
  clear(): void { this.#last = null; }
  dispose(): void { this.#disposed = true; this.clear(); }
}

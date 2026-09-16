import type { RuntimeHealth, TaskLane } from './contracts.ts';
import { clamp, hashString, stableJson, stableNumber } from './contracts.ts';

export interface DiagnosticFrame {
  readonly frame: number;
  readonly tick: number;
  readonly cpuMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly memoryBytes: number;
  readonly entities: number;
}

export interface DiagnosticIssue {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error' | 'fatal';
  readonly lane?: TaskLane;
  readonly message: string;
  readonly value?: number;
}

export interface DiagnosticReport {
  readonly health: RuntimeHealth | null;
  readonly frameSamples: number;
  readonly averageCpuMs: number;
  readonly p95CpuMs: number;
  readonly peakMemoryBytes: number;
  readonly issues: readonly DiagnosticIssue[];
  readonly checksum: string;
}

export class DiagnosticsBuffer {
  readonly #capacity: number;
  readonly #frames: DiagnosticFrame[] = [];
  #peakMemoryBytes = 0;
  constructor(capacity = 240) { this.#capacity = Math.max(30, Math.floor(capacity)); }
  push(frame: DiagnosticFrame): void { const normalized = Object.freeze({ ...frame, cpuMs: Math.max(0, frame.cpuMs), simulationMs: Math.max(0, frame.simulationMs), renderMs: Math.max(0, frame.renderMs), streamingMs: Math.max(0, frame.streamingMs), networkMs: Math.max(0, frame.networkMs), memoryBytes: Math.max(0, Math.floor(frame.memoryBytes)), entities: Math.max(0, Math.floor(frame.entities)) }); this.#frames.push(normalized); this.#peakMemoryBytes = Math.max(this.#peakMemoryBytes, normalized.memoryBytes); if (this.#frames.length > this.#capacity) this.#frames.shift(); }
  clear(): void { this.#frames.length = 0; this.#peakMemoryBytes = 0; }
  values(): readonly DiagnosticFrame[] { return Object.freeze([...this.#frames]); }
  peakMemoryBytes(): number { return this.#peakMemoryBytes; }
}

const percentile = (values: readonly number[], ratio: number): number => { if (values.length === 0) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]!; };

export class DiagnosticsEngine {
  readonly #buffer: DiagnosticsBuffer;
  constructor(capacity = 240) { this.#buffer = new DiagnosticsBuffer(capacity); }
  record(frame: DiagnosticFrame): void { this.#buffer.push(frame); }
  report(health: RuntimeHealth | null, budgets: { readonly frameMs: number; readonly simulationMs: number; readonly renderMs: number; readonly streamingMs: number; readonly networkMs: number; }, limits: { readonly memoryBytes: number; readonly entities: number }): DiagnosticReport {
    const frames = this.#buffer.values();
    const cpu = frames.map((frame) => frame.cpuMs);
    const issues: DiagnosticIssue[] = [];
    const checks = [
      ['frame', budgets.frameMs, percentile(cpu, 0.95), 'frame'],
      ['simulation', budgets.simulationMs, percentile(frames.map((frame) => frame.simulationMs), 0.95), 'simulation'],
      ['render', budgets.renderMs, percentile(frames.map((frame) => frame.renderMs), 0.95), 'render'],
      ['streaming', budgets.streamingMs, percentile(frames.map((frame) => frame.streamingMs), 0.95), 'streaming'],
      ['network', budgets.networkMs, percentile(frames.map((frame) => frame.networkMs), 0.95), 'network'],
    ] as const;
    for (const [code, budget, value, lane] of checks) if (value > budget * 1.2) issues.push(Object.freeze({ code: `${code}-budget`, severity: 'error' as const, lane: lane as TaskLane, message: `${code} p95 exceeds budget`, value: stableNumber(value) })); else if (value > budget) issues.push(Object.freeze({ code: `${code}-pressure`, severity: 'warning' as const, lane: lane as TaskLane, message: `${code} p95 is above target`, value: stableNumber(value) }));
    const peakMemory = this.#buffer.peakMemoryBytes();
    if (peakMemory > limits.memoryBytes) issues.push(Object.freeze({ code: 'memory-cap', severity: 'fatal' as const, message: 'runtime memory exceeds configured cap', value: peakMemory }));
    else if (peakMemory > limits.memoryBytes * 0.9) issues.push(Object.freeze({ code: 'memory-pressure', severity: 'warning' as const, message: 'runtime memory is near configured cap', value: peakMemory }));
    const peakEntities = frames.reduce((max, frame) => Math.max(max, frame.entities), 0);
    if (peakEntities > limits.entities) issues.push(Object.freeze({ code: 'entity-cap', severity: 'error' as const, message: 'active entity count exceeds cap', value: peakEntities }));
    const averageCpuMs = cpu.length ? cpu.reduce((sum, value) => sum + value, 0) / cpu.length : 0;
    const payload = { health, frameSamples: frames.length, averageCpuMs: stableNumber(averageCpuMs), p95CpuMs: stableNumber(percentile(cpu, 0.95)), peakMemoryBytes: peakMemory, issues };
    return Object.freeze({ ...payload, checksum: hashString(stableJson(payload)) });
  }
}

export const classifySeverity = (score: number): DiagnosticIssue['severity'] => score >= 90 ? 'info' : score >= 75 ? 'warning' : score >= 50 ? 'error' : 'fatal';
export const pressureRatio = (value: number, budget: number): number => clamp(Math.max(0, value) / Math.max(0.001, budget), 0, 10);

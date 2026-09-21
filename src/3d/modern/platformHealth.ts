import type { PlatformError, RenderCapabilities, Result } from './types';
import { checksum, clamp01 } from './deterministic';
import { Diagnostics, type HealthReport } from './diagnostics';
import { RuntimeKernel } from './runtimeKernel';
import { RecoveryController } from './recoveryController';

export interface PlatformHealthSample {
  readonly timestampMs: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
  readonly entityCount: number;
  readonly streamCells: number;
  readonly residentBytes: number;
  readonly workerQueue: number;
}

export interface PlatformHealthThresholds {
  readonly warningFrameMs: number;
  readonly criticalFrameMs: number;
  readonly warningMemoryPressure: number;
  readonly criticalMemoryPressure: number;
  readonly warningQueue: number;
  readonly criticalQueue: number;
}

export interface PlatformHealthReport {
  readonly healthy: boolean;
  readonly score: number;
  readonly level: 'ok' | 'warning' | 'critical';
  readonly backend: RenderCapabilities['backend'];
  readonly runtime: HealthReport;
  readonly sample: PlatformHealthSample;
  readonly recoveryRisk: number;
  readonly digest: string;
  readonly recommendations: readonly string[];
}

const DEFAULT_THRESHOLDS: PlatformHealthThresholds = {
  warningFrameMs: 20,
  criticalFrameMs: 33.33,
  warningMemoryPressure: 0.7,
  criticalMemoryPressure: 0.92,
  warningQueue: 32,
  criticalQueue: 128,
};

function weightedPenalty(sample: PlatformHealthSample, thresholds: PlatformHealthThresholds): number {
  const framePenalty = clamp01((sample.frameMs - thresholds.warningFrameMs) / Math.max(1, thresholds.criticalFrameMs - thresholds.warningFrameMs));
  const memoryPenalty = clamp01((sample.memoryPressure - thresholds.warningMemoryPressure) / Math.max(0.01, thresholds.criticalMemoryPressure - thresholds.warningMemoryPressure));
  const thermalPenalty = clamp01(sample.thermalPressure);
  const queuePenalty = clamp01((sample.workerQueue - thresholds.warningQueue) / Math.max(1, thresholds.criticalQueue - thresholds.warningQueue));
  return clamp01(framePenalty * 0.4 + memoryPenalty * 0.25 + thermalPenalty * 0.2 + queuePenalty * 0.15);
}

/** Produces an operational health report from bounded runtime signals, never from opaque heuristics. */
export class PlatformHealthMonitor {
  readonly diagnostics: Diagnostics;
  readonly thresholds: PlatformHealthThresholds;
  #last: PlatformHealthSample | null = null;
  #history: PlatformHealthSample[] = [];
  #maxHistory: number;

  constructor(options: { readonly diagnostics?: Diagnostics; readonly thresholds?: Partial<PlatformHealthThresholds>; readonly maxHistory?: number } = {}) {
    this.diagnostics = options.diagnostics ?? new Diagnostics();
    this.thresholds = Object.freeze({ ...DEFAULT_THRESHOLDS, ...options.thresholds });
    this.#maxHistory = Math.max(16, Math.min(2048, Math.floor(options.maxHistory ?? 180)));
  }

  observe(sample: PlatformHealthSample): PlatformHealthReport {
    const normalized: PlatformHealthSample = Object.freeze({
      timestampMs: Math.max(0, sample.timestampMs),
      frameMs: Math.max(0, sample.frameMs),
      cpuMs: Math.max(0, sample.cpuMs),
      gpuMs: Math.max(0, sample.gpuMs),
      memoryPressure: clamp01(sample.memoryPressure),
      thermalPressure: clamp01(sample.thermalPressure),
      entityCount: Math.max(0, Math.trunc(sample.entityCount)),
      streamCells: Math.max(0, Math.trunc(sample.streamCells)),
      residentBytes: Math.max(0, Math.trunc(sample.residentBytes)),
      workerQueue: Math.max(0, Math.trunc(sample.workerQueue)),
    });
    this.#last = normalized;
    this.#history.push(normalized);
    if (this.#history.length > this.#maxHistory) this.#history.splice(0, this.#history.length - this.#maxHistory);

    const penalty = weightedPenalty(normalized, this.thresholds);
    const score = Math.max(0, Math.min(100, Math.round((1 - penalty) * 100)));
    const level = normalized.frameMs >= this.thresholds.criticalFrameMs
      || normalized.memoryPressure >= this.thresholds.criticalMemoryPressure
      || normalized.workerQueue >= this.thresholds.criticalQueue
      ? 'critical'
      : normalized.frameMs >= this.thresholds.warningFrameMs
        || normalized.memoryPressure >= this.thresholds.warningMemoryPressure
        || normalized.workerQueue >= this.thresholds.warningQueue
        || normalized.thermalPressure >= 0.7
        ? 'warning'
        : 'ok';

    const recommendations: string[] = [];
    if (normalized.frameMs >= this.thresholds.warningFrameMs) recommendations.push('render-scale azalt ve görünür nesne bütçesini sıkılaştır');
    if (normalized.memoryPressure >= this.thresholds.warningMemoryPressure) recommendations.push('kullanılmayan assetleri tahliye et ve texture residency bütçesini düşür');
    if (normalized.thermalPressure >= 0.7) recommendations.push('post-processing ve gölge kalitesini düşür');
    if (normalized.workerQueue >= this.thresholds.warningQueue) recommendations.push('worker kuyruğunu affinity/priority ile daralt');
    if (normalized.entityCount > 50_000) recommendations.push('uzak entity simülasyonunu LOD/uyku durumuna geçir');

    const runtime = this.diagnostics.health();
    const digest = checksum({ level, score, sample: normalized, runtimeDigest: runtime.digest });
    return Object.freeze({
      healthy: level === 'ok' && runtime.ok,
      score: Math.min(score, runtime.score),
      level,
      backend: 'headless',
      runtime,
      sample: normalized,
      recoveryRisk: penalty,
      digest,
      recommendations: Object.freeze(recommendations),
    });
  }

  history(): readonly PlatformHealthSample[] {
    return this.#history.map((sample) => ({ ...sample }));
  }

  last(): PlatformHealthSample | null {
    return this.#last ? { ...this.#last } : null;
  }
}

export interface RuntimeHealthBridge {
  readonly kernel: RuntimeKernel;
  readonly recovery: RecoveryController;
  readonly monitor: PlatformHealthMonitor;
}

export function createRuntimeHealthBridge(kernel: RuntimeKernel, recovery = new RecoveryController({ backend: kernel.profile.preferredBackend, diagnostics: kernel.diagnostics }), monitor = new PlatformHealthMonitor({ diagnostics: kernel.diagnostics })): RuntimeHealthBridge {
  return Object.freeze({ kernel, recovery, monitor });
}

export function validateHealthReport(report: PlatformHealthReport): Result<PlatformHealthReport> {
  if (!report.digest || report.digest.length !== 8) {
    const error: PlatformError = { code: 'HEALTH_DIGEST_INVALID', message: 'Health report digest is invalid', retryable: false };
    return { ok: false, error };
  }
  if (report.score < 0 || report.score > 100) {
    const error: PlatformError = { code: 'HEALTH_SCORE_INVALID', message: 'Health report score is outside [0,100]', retryable: false };
    return { ok: false, error };
  }
  return { ok: true, value: report };
}

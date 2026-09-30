import type {
  RuntimeHealthSnapshot,
  RuntimeState,
  SchedulerSnapshot,
} from './contracts.ts';
import { gradeFromScore, percentile } from './contracts.ts';

export interface HealthSampleR25 {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly memoryPressure: number;
  readonly assetPressure: number;
  readonly worldPressure: number;
  readonly schedulerPressure: number;
  readonly renderErrors: number;
  readonly assetErrors: number;
  readonly worldFailures: number;
}

export interface HealthOptionsR25 {
  readonly targetFrameMs?: number;
  readonly maxSamples?: number;
  readonly warningThreshold?: number;
  readonly criticalThreshold?: number;
}

export interface HealthIncidentR25 {
  readonly id: string;
  readonly code: string;
  readonly severity: 'info' | 'warn' | 'critical';
  readonly frame: number;
  readonly value: number;
  readonly threshold: number;
  readonly message: string;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

export class RuntimeHealthR25 {
  readonly #targetFrameMs: number;
  readonly #maxSamples: number;
  readonly #warningThreshold: number;
  readonly #criticalThreshold: number;
  readonly #frameSamples: number[] = [];
  readonly #incidents: HealthIncidentR25[] = [];
  #frame = 0;
  #state: RuntimeState = 'created';

  public constructor(options: HealthOptionsR25 = {}) {
    this.#targetFrameMs = Math.max(1, finite(options.targetFrameMs, 16.67));
    this.#maxSamples = Math.max(32, Math.trunc(finite(options.maxSamples, 512)));
    this.#warningThreshold = clamp01(finite(options.warningThreshold, 0.72));
    this.#criticalThreshold = clamp01(finite(options.criticalThreshold, 0.48));
  }

  public setState(state: RuntimeState): void {
    this.#state = state;
  }

  public observe(frame: number, sample: HealthSampleR25): readonly HealthIncidentR25[] {
    this.#frame = Math.max(this.#frame, Math.trunc(frame));
    this.#frameSamples.push(Math.max(0, finite(sample.frameMs, this.#targetFrameMs)));
    if (this.#frameSamples.length > this.#maxSamples) {
      this.#frameSamples.splice(0, this.#frameSamples.length - this.#maxSamples);
    }

    const incidents: HealthIncidentR25[] = [];
    const framePressure = Math.min(2, sample.frameMs / this.#targetFrameMs);
    const cpuPressure = Math.min(2, sample.cpuMs / (this.#targetFrameMs * 0.65));
    const gpuPressure = Math.min(2, sample.gpuMs / (this.#targetFrameMs * 0.78));
    const memoryPressure = clamp01(sample.memoryPressure);
    const assetPressure = clamp01(sample.assetPressure);
    const worldPressure = clamp01(sample.worldPressure);
    const schedulerPressure = clamp01(sample.schedulerPressure);
    const errorPressure = clamp01(
      Math.min(1, sample.renderErrors * 0.08 + sample.assetErrors * 0.06 + sample.worldFailures * 0.08),
    );

    const pressure = clamp01(
      framePressure / 1.6 * 0.35 +
      cpuPressure / 1.6 * 0.12 +
      gpuPressure / 1.6 * 0.18 +
      memoryPressure * 0.1 +
      assetPressure * 0.06 +
      worldPressure * 0.05 +
      schedulerPressure * 0.08 +
      errorPressure * 0.06,
    );

    if (pressure >= this.#criticalThreshold) {
      incidents.push(this.#incident(
        'HEALTH_CRITICAL_PRESSURE',
        'critical',
        pressure,
        this.#criticalThreshold,
        'runtime pressure exceeded the critical safety threshold',
      ));
    } else if (pressure >= this.#warningThreshold) {
      incidents.push(this.#incident(
        'HEALTH_WARNING_PRESSURE',
        'warn',
        pressure,
        this.#warningThreshold,
        'runtime pressure exceeded the warning threshold',
      ));
    }

    if (framePressure > 1.35) {
      incidents.push(this.#incident(
        'FRAME_LATENCY',
        'warn',
        framePressure,
        1.35,
        'frame latency is above the target envelope',
      ));
    }

    if (sample.memoryPressure > 0.88) {
      incidents.push(this.#incident(
        'MEMORY_PRESSURE',
        'warn',
        sample.memoryPressure,
        0.88,
        'memory pressure is high; cold resources should be evicted',
      ));
    }

    if (sample.renderErrors > 0) {
      incidents.push(this.#incident(
        'RENDER_ERRORS',
        'warn',
        sample.renderErrors,
        0,
        'render pass errors were observed',
      ));
    }

    if (sample.assetErrors > 0) {
      incidents.push(this.#incident(
        'ASSET_ERRORS',
        'warn',
        sample.assetErrors,
        0,
        'asset load failures were observed',
      ));
    }

    if (sample.worldFailures > 0) {
      incidents.push(this.#incident(
        'WORLD_FAILURES',
        'warn',
        sample.worldFailures,
        0,
        'world residency failures were observed',
      ));
    }

    this.#incidents.push(...incidents);
    if (this.#incidents.length > this.#maxSamples * 2) {
      this.#incidents.splice(0, this.#incidents.length - this.#maxSamples * 2);
    }

    return freeze(incidents);
  }

  public fromScheduler(
    scheduler: SchedulerSnapshot,
    memoryPressure: number,
    assetPressure: number,
    worldPressure: number,
    frameMs: number,
  ): readonly HealthIncidentR25[] {
    const failed = scheduler.failedTasks;
    const sample: HealthSampleR25 = freeze({
      frameMs,
      cpuMs: scheduler.phaseUtilization.input +
        scheduler.phaseUtilization.simulation +
        scheduler.phaseUtilization.streaming +
        scheduler.phaseUtilization.animation,
      gpuMs: scheduler.phaseUtilization.render,
      memoryPressure,
      assetPressure,
      worldPressure,
      schedulerPressure: scheduler.budgetUsedMs / Math.max(1, scheduler.budgetLimitMs),
      renderErrors: scheduler.records.filter((record) => record.phase === 'render' && Boolean(record.error)).length,
      assetErrors: failed,
      worldFailures: scheduler.records.filter((record) => record.phase === 'streaming' && Boolean(record.error)).length,
    });

    return this.observe(scheduler.frame, sample);
  }

  public snapshot(
    frame: number,
    pressureOverrides: Partial<{
      readonly memoryPressure: number;
      readonly renderPressure: number;
      readonly assetPressure: number;
      readonly worldPressure: number;
    }> = {},
  ): RuntimeHealthSnapshot {
    const p95 = percentile(this.#frameSamples, 0.95);
    const p99 = percentile(this.#frameSamples, 0.99);
    const framePressure = clamp01(p95 / Math.max(1, this.#targetFrameMs * 1.5));
    const memoryPressure = clamp01(finite(pressureOverrides.memoryPressure, 0));
    const renderPressure = clamp01(finite(pressureOverrides.renderPressure, 0));
    const assetPressure = clamp01(finite(pressureOverrides.assetPressure, 0));
    const worldPressure = clamp01(finite(pressureOverrides.worldPressure, 0));
    const recentErrors = this.#incidents
      .filter((incident) => incident.frame >= frame - 120)
      .reduce((sum, incident) => sum + (incident.severity === 'critical' ? 0.35 : 0.12), 0);

    const score = clamp01(
      1 -
      framePressure * 0.36 -
      memoryPressure * 0.18 -
      renderPressure * 0.18 -
      assetPressure * 0.12 -
      worldPressure * 0.1 -
      Math.min(0.2, recentErrors) * 0.06,
    );

    const recommendations: string[] = [];
    if (p95 > this.#targetFrameMs * 1.25) recommendations.push('lower-render-tier');
    if (p99 > this.#targetFrameMs * 1.6) recommendations.push('enable-safe-frame-pacer');
    if (memoryPressure > 0.8) recommendations.push('evict-cold-assets-and-zones');
    if (assetPressure > 0.84) recommendations.push('reduce-asset-concurrency');
    if (worldPressure > 0.84) recommendations.push('tighten-world-prefetch');
    if (renderPressure > 0.88) recommendations.push('reduce-post-fx-and-shadow-resolution');
    if (this.#state === 'failed') recommendations.push('restart-runtime-session');
    if (this.#state === 'paused') recommendations.push('resume-runtime-when-visible');

    return freeze({
      state: this.#state,
      frame: Math.max(0, Math.trunc(frame)),
      score,
      grade: gradeFromScore(score),
      frameP95Ms: p95,
      memoryPressure,
      renderPressure,
      assetPressure,
      worldPressure,
      recommendations: freeze([...new Set(recommendations)]),
    });
  }

  public incidents(
    sinceFrame = 0,
  ): readonly HealthIncidentR25[] {
    return freeze(
      this.#incidents
        .filter((incident) => incident.frame >= sinceFrame)
        .map((incident) => freeze({ ...incident })),
    );
  }

  public reset(): void {
    this.#frameSamples.length = 0;
    this.#incidents.length = 0;
    this.#frame = 0;
  }

  #incident(
    code: string,
    severity: 'info' | 'warn' | 'critical',
    value: number,
    threshold: number,
    message: string,
  ): HealthIncidentR25 {
    return freeze({
      id: `r25-health-${this.#frame.toString(36)}-${code.toLowerCase()}`,
      code,
      severity,
      frame: this.#frame,
      value: finite(value, 0),
      threshold: finite(threshold, 0),
      message,
    });
  }
}

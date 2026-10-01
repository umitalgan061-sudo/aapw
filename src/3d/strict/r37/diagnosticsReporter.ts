import type { RuntimeHealth, RuntimeMetrics } from './types.ts';
import { TelemetryRingR37 } from './telemetry.ts';
import { clamp, finite } from './math.ts';

export interface DiagnosticsReport {
  readonly generatedAtMs: number;
  readonly health: RuntimeHealth;
  readonly metrics: RuntimeMetrics;
  readonly trends: Readonly<Record<string, 'up' | 'down' | 'flat'>>;
  readonly alerts: readonly string[];
  readonly telemetry: readonly { readonly name: string; readonly count: number; readonly average: number }[];
}

export class DiagnosticsReporterR37 {
  readonly telemetry: TelemetryRingR37;

  constructor(telemetry = new TelemetryRingR37()) {
    this.telemetry = telemetry;
  }

  recordMetrics(metrics: RuntimeMetrics, atMs = nowMs()): void {
    for (const [name, value] of [
      ['frameMs', metrics.frameMs],
      ['simulationMs', metrics.simulationMs],
      ['renderMs', metrics.renderMs],
      ['networkMs', metrics.networkMs],
      ['assetMs', metrics.assetMs],
      ['memoryPressure', metrics.memoryPressure],
      ['entities', metrics.entities],
      ['commands', metrics.commands],
    ] as const) this.telemetry.record(name, value, {}, atMs);
  }

  report(health: RuntimeHealth, metrics: RuntimeMetrics): DiagnosticsReport {
    const alerts = [...health.issues];
    if (metrics.droppedTicks > 0) alerts.push('simulation-dropped-ticks');
    if (metrics.memoryPressure >= 0.9) alerts.push('memory-critical');
    if (metrics.commands >= 64) alerts.push('command-budget');
    const names = ['frameMs', 'simulationMs', 'renderMs', 'networkMs', 'assetMs', 'memoryPressure', 'entities', 'commands'];
    return Object.freeze({
      generatedAtMs: nowMs(),
      health,
      metrics,
      trends: Object.freeze(Object.fromEntries(['frameMs', 'simulationMs', 'renderMs', 'memoryPressure'].map((name) => [name, this.#trend(name)]))),
      alerts: Object.freeze([...new Set(alerts)]),
      telemetry: Object.freeze(names.map((name) => {
        const summary = this.telemetry.summarize(name);
        return { name, count: summary?.count ?? 0, average: Number((summary?.average ?? 0).toFixed(4)) };
      })),
    });
  }

  clear(): void { this.telemetry.clear(); }

  #trend(name: string): 'up' | 'down' | 'flat' {
    const samples = this.telemetry.samples().filter((sample) => sample.name === name).slice(-8);
    if (samples.length < 2) return 'flat';
    const first = samples[0]!.value;
    const last = samples.at(-1)!.value;
    const delta = finite(last - first);
    const threshold = Math.max(0.01, Math.abs(first) * 0.05);
    if (delta > threshold) return 'up';
    if (delta < -threshold) return 'down';
    return 'flat';
  }
}

export function normalizeHealthScore(score: number): number {
  return clamp(finite(score, 1), 0, 1);
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

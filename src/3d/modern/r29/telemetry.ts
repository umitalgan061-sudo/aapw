import { clampR29, type R29Incident, type R29Severity, type R29TelemetryPoint } from './contracts.ts';

export interface R29TelemetryOptions {
  readonly maxPoints?: number;
  readonly maxIncidents?: number;
  readonly sampleEveryTicks?: number;
}

export interface R29TelemetrySummary {
  readonly points: number;
  readonly incidents: number;
  readonly p50FrameMs: number;
  readonly p95FrameMs: number;
  readonly p99FrameMs: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
}

export class R29Telemetry {
  readonly maxPoints: number;
  readonly maxIncidents: number;
  readonly sampleEveryTicks: number;

  #points: R29TelemetryPoint[] = [];
  #incidents: R29Incident[] = [];
  #counters = new Map<string, number>();
  #gauges = new Map<string, number>();
  #incidentSequence = 0;

  constructor(options: R29TelemetryOptions = {}) {
    this.maxPoints = Math.max(64, Math.floor(options.maxPoints ?? 8192));
    this.maxIncidents = Math.max(16, Math.floor(options.maxIncidents ?? 512));
    this.sampleEveryTicks = Math.max(1, Math.floor(options.sampleEveryTicks ?? 4));
  }

  point(point: Omit<R29TelemetryPoint, 'tags'> & { readonly tags?: Readonly<Record<string, string>> }): void {
    const normalized: R29TelemetryPoint = Object.freeze({
      ...point,
      tick: Math.max(0, Math.floor(point.tick)),
      value: Number.isFinite(point.value) ? point.value : 0,
      tags: Object.freeze({ ...(point.tags ?? {}) }),
    });
    this.#points.push(normalized);
    while (this.#points.length > this.maxPoints) this.#points.shift();
  }

  counter(name: string, delta = 1, tick = 0): number {
    const next = (this.#counters.get(name) ?? 0) + (Number.isFinite(delta) ? delta : 0);
    this.#counters.set(name, next);
    this.point({ tick, name, value: next, unit: 'count', tags: { kind: 'counter' } });
    return next;
  }

  gauge(name: string, value: number, tick = 0, unit = 'value'): void {
    const safe = Number.isFinite(value) ? value : 0;
    this.#gauges.set(name, safe);
    this.point({ tick, name, value: safe, unit, tags: { kind: 'gauge' } });
  }

  recordFrame(tick: number, frameMs: number, simulationMs: number, renderMs: number, networkMs: number): void {
    if (tick % this.sampleEveryTicks !== 0) return;
    this.point({ tick, name: 'runtime.frame.ms', value: frameMs, unit: 'ms', tags: { phase: 'frame' } });
    this.point({ tick, name: 'runtime.simulation.ms', value: simulationMs, unit: 'ms', tags: { phase: 'simulation' } });
    this.point({ tick, name: 'runtime.render.ms', value: renderMs, unit: 'ms', tags: { phase: 'render' } });
    this.point({ tick, name: 'runtime.network.ms', value: networkMs, unit: 'ms', tags: { phase: 'network' } });
  }

  incident(input: Omit<R29Incident, 'id'> & { readonly id?: string }): R29Incident {
    const incident: R29Incident = Object.freeze({
      ...input,
      id: input.id ?? 'incident-' + (++this.#incidentSequence).toString(36),
      context: Object.freeze({ ...input.context }),
    });
    this.#incidents.push(incident);
    while (this.#incidents.length > this.maxIncidents) this.#incidents.shift();
    return incident;
  }

  incidentCount(severity?: R29Severity): number {
    return severity
      ? this.#incidents.filter((incident) => incident.severity === severity).length
      : this.#incidents.length;
  }

  points(name?: string): readonly R29TelemetryPoint[] {
    return Object.freeze(
      (name ? this.#points.filter((point) => point.name === name) : [...this.#points])
        .map((point) => ({ ...point, tags: { ...point.tags } })),
    );
  }

  incidents(): readonly R29Incident[] {
    return Object.freeze(this.#incidents.map((incident) => ({ ...incident, context: { ...incident.context } })));
  }

  summary(): R29TelemetrySummary {
    const frames = this.#points.filter((point) => point.name === 'runtime.frame.ms').map((point) => point.value);
    const sorted = [...frames].sort((a, b) => a - b);
    const percentile = (ratio: number): number =>
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
    return Object.freeze({
      points: this.#points.length,
      incidents: this.#incidents.length,
      p50FrameMs: percentile(0.5),
      p95FrameMs: percentile(0.95),
      p99FrameMs: percentile(0.99),
      counters: Object.fromEntries([...this.#counters.entries()].sort()),
      gauges: Object.fromEntries([...this.#gauges.entries()].sort()),
    });
  }

  clear(): void {
    this.#points.length = 0;
    this.#incidents.length = 0;
    this.#counters.clear();
    this.#gauges.clear();
  }
}

export function scoreR29Health(
  frameP95Ms: number,
  memoryPressure: number,
  renderPressure: number,
  networkScore: number,
  criticalIncidents: number,
): number {
  const framePenalty = clampR29(frameP95Ms / 16.67, 0, 3) * 26;
  const memoryPenalty = clampR29(memoryPressure, 0, 1.5) * 16;
  const renderPenalty = clampR29(renderPressure, 0, 1.5) * 18;
  const networkPenalty = (100 - clampR29(networkScore, 0, 100)) * 0.12;
  const incidentPenalty = Math.min(50, criticalIncidents * 25);
  return clampR29(100 - framePenalty - memoryPenalty - renderPenalty - networkPenalty - incidentPenalty, 0, 100);
}

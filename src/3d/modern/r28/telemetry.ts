export interface MetricPoint {
  readonly tick: number;
  readonly name: string;
  readonly value: number;
  readonly unit: 'ms' | 'count' | 'bytes' | 'ratio' | 'mb';
  readonly labels?: Readonly<Record<string, string>>;
}

export interface Histogram {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface Span {
  readonly id: number;
  readonly name: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly durationTicks: number;
  readonly outcome: 'ok' | 'error';
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface Incident {
  readonly tick: number;
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly detail: string;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[position] ?? 0;
}

export class RuntimeTelemetry {
  readonly maxPoints: number;
  readonly maxSpans: number;
  readonly maxIncidents: number;
  #points: MetricPoint[] = [];
  #spans: Span[] = [];
  #incidents: Incident[] = [];
  #nextSpanId = 1;

  constructor(maxPoints = 4096, maxSpans = 1024, maxIncidents = 512) {
    this.maxPoints = Math.max(16, Math.floor(maxPoints));
    this.maxSpans = Math.max(16, Math.floor(maxSpans));
    this.maxIncidents = Math.max(16, Math.floor(maxIncidents));
  }

  record(point: MetricPoint): void {
    if (!point.name.trim() || !Number.isFinite(point.value)) return;
    this.#points.push({
      ...point,
      name: point.name.slice(0, 64),
      value: point.value,
      ...(point.labels ? { labels: Object.fromEntries(Object.entries(point.labels).slice(0, 16)) } : {}),
    });
    while (this.#points.length > this.maxPoints) this.#points.shift();
  }

  startSpan(name: string, startTick: number, attributes: Readonly<Record<string, string | number | boolean>> = {}): number {
    const id = this.#nextSpanId++;
    this.#spans.push({
      id,
      name: name.slice(0, 64),
      startTick,
      endTick: startTick,
      durationTicks: 0,
      outcome: 'ok',
      attributes,
    });
    while (this.#spans.length > this.maxSpans) this.#spans.shift();
    return id;
  }

  endSpan(id: number, endTick: number, outcome: 'ok' | 'error' = 'ok'): Span | undefined {
    const index = this.#spans.findIndex((span) => span.id === id);
    if (index < 0) return undefined;
    const existing = this.#spans[index];
    if (!existing) return undefined;
    const next: Span = {
      ...existing,
      endTick: Math.max(existing.startTick, endTick),
      durationTicks: Math.max(0, endTick - existing.startTick),
      outcome,
    };
    this.#spans[index] = next;
    return next;
  }

  incident(incident: Incident): void {
    if (!incident.code.trim()) return;
    this.#incidents.push({
      ...incident,
      code: incident.code.slice(0, 64),
      detail: incident.detail.slice(0, 512),
    });
    while (this.#incidents.length > this.maxIncidents) this.#incidents.shift();
  }

  points(name?: string): readonly MetricPoint[] {
    return this.#points
      .filter((point) => !name || point.name === name)
      .map((point) => structuredClone(point));
  }

  histogram(name: string): Histogram {
    const values = this.#points
      .filter((point) => point.name === name)
      .map((point) => point.value);
    return {
      count: values.length,
      sum: values.reduce((sum, value) => sum + value, 0),
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
    };
  }

  spans(): readonly Span[] {
    return this.#spans.map((span) => structuredClone(span));
  }

  incidents(): readonly Incident[] {
    return this.#incidents.map((incident) => structuredClone(incident));
  }

  summary(): Readonly<Record<string, number>> {
    const values = new Map<string, number>();
    for (const point of this.#points) values.set(point.name, (values.get(point.name) ?? 0) + point.value);
    return Object.fromEntries([...values.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  clear(): void {
    this.#points = [];
    this.#spans = [];
    this.#incidents = [];
  }
}

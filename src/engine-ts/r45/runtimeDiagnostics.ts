import { BoundedRing, RuntimeFault, stableFingerprint } from "./contracts";

export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";

export interface DiagnosticIncidentInput {
  readonly tick: number;
  readonly component: string;
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly fingerprintData?: unknown;
}

export interface DiagnosticIncident {
  readonly sequence: number;
  readonly tick: number;
  readonly component: string;
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly fingerprint: string;
  readonly occurrences: number;
  readonly firstSeenTick: number;
  readonly lastSeenTick: number;
}

export interface DiagnosticSample {
  readonly tick: number;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
}

export interface DiagnosticSummary {
  readonly incidentCount: number;
  readonly uniqueIncidents: number;
  readonly samples: number;
  readonly criticalIncidents: number;
  readonly errors: number;
  readonly warnings: number;
  readonly droppedIncidents: number;
  readonly droppedSamples: number;
}

export interface DiagnosticLedgerOptions {
  readonly incidentCapacity?: number;
  readonly sampleCapacity?: number;
  readonly metricCapacity?: number;
  readonly dedupeWindowTicks?: number;
  readonly maxIncidentMessageLength?: number;
}

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export class RuntimeDiagnosticLedger {
  readonly dedupeWindowTicks: number;
  readonly maxIncidentMessageLength: number;
  readonly maxMetricNames: number;
  readonly maxActiveIncidents: number;
  #incidents: BoundedRing<DiagnosticIncident>;
  #samples: BoundedRing<DiagnosticSample>;
  #active = new Map<string, DiagnosticIncident>();
  #metricWindows = new Map<string, number[]>();
  #sequence = 0;
  #totalIncidents = 0;
  #totalOccurrences = 0;

  constructor(options: DiagnosticLedgerOptions = {}) {
    this.maxActiveIncidents = options.incidentCapacity ?? 512;
    this.#incidents = new BoundedRing(this.maxActiveIncidents);
    this.#samples = new BoundedRing(options.sampleCapacity ?? 2048);
    this.dedupeWindowTicks = options.dedupeWindowTicks ?? 120;
    this.maxIncidentMessageLength = options.maxIncidentMessageLength ?? 512;
    this.maxMetricNames = options.metricCapacity ?? 256;
    if (!Number.isInteger(this.maxMetricNames) || this.maxMetricNames < 1 || this.maxMetricNames > 100_000) {
      throw new RuntimeFault("INVALID_INPUT", "Metric name capacity is invalid", "diagnostics.constructor");
    }
    if (!Number.isInteger(this.dedupeWindowTicks) || this.dedupeWindowTicks < 0 || this.dedupeWindowTicks > 1_000_000) {
      throw new RuntimeFault("INVALID_INPUT", "Incident deduplication window is invalid", "diagnostics.constructor");
    }
    if (!Number.isInteger(this.maxIncidentMessageLength) || this.maxIncidentMessageLength < 32 || this.maxIncidentMessageLength > 4096) {
      throw new RuntimeFault("INVALID_INPUT", "Incident message limit is invalid", "diagnostics.constructor");
    }
  }

  recordIncident(input: DiagnosticIncidentInput): DiagnosticIncident {
    if (!Number.isSafeInteger(input.tick) || input.tick < 0) {
      throw new RuntimeFault("INVALID_INPUT", "Incident tick is invalid", "diagnostics.recordIncident");
    }
    const component = input.component.trim();
    const code = input.code.trim();
    const message = input.message.trim().slice(0, this.maxIncidentMessageLength);
    if (!component || !code || !message) {
      throw new RuntimeFault("INVALID_INPUT", "Incident fields cannot be empty", "diagnostics.recordIncident");
    }
    const fingerprint = stableFingerprint({
      component,
      code,
      detail: input.fingerprintData ?? message,
    });
    const activeKey = component + "|" + code + "|" + fingerprint;
    const existing = this.#active.get(activeKey);
    this.#totalIncidents += 1;
    this.#totalOccurrences += 1;
    if (existing && input.tick - existing.lastSeenTick <= this.dedupeWindowTicks) {
      const merged: DiagnosticIncident = Object.freeze({
        ...existing,
        severity: SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity] ? input.severity : existing.severity,
        occurrences: existing.occurrences + 1,
        lastSeenTick: input.tick,
        message,
      });
      this.#active.set(activeKey, merged);
      this.#incidents.push(merged);
      return merged;
    }
    if (this.#sequence >= Number.MAX_SAFE_INTEGER) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Diagnostic sequence exhausted", "diagnostics.recordIncident");
    }
    const incident: DiagnosticIncident = Object.freeze({
      sequence: ++this.#sequence,
      tick: input.tick,
      component,
      code,
      severity: input.severity,
      message,
      fingerprint,
      occurrences: 1,
      firstSeenTick: input.tick,
      lastSeenTick: input.tick,
    });
    if (this.#active.size >= this.maxActiveIncidents && !this.#active.has(activeKey)) {
      const candidates = [...this.#active.entries()].sort((left, right) =>
        left[1].lastSeenTick - right[1].lastSeenTick || left[1].sequence - right[1].sequence);
      const removable = candidates.find(([, value]) => value.severity !== "critical") ?? candidates[0];
      if (removable) this.#active.delete(removable[0]);
    }
    this.#active.set(activeKey, incident);
    this.#incidents.push(incident);
    return incident;
  }

  sample(tick: number, nameValue: string, value: number, unit = "count"): DiagnosticSample {
    if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isFinite(value)) {
      throw new RuntimeFault("INVALID_INPUT", "Diagnostic metric sample is invalid", "diagnostics.sample");
    }
    const name = nameValue.trim();
    if (!name || name.length > 128 || !unit || unit.length > 32) {
      throw new RuntimeFault("INVALID_INPUT", "Metric name or unit is invalid", "diagnostics.sample");
    }
    const sample: DiagnosticSample = Object.freeze({ tick, name, value, unit });
    this.#samples.push(sample);
    let values = this.#metricWindows.get(name);
    if (!values) {
      if (this.#metricWindows.size >= this.maxMetricNames) {
        const oldest = this.#metricWindows.keys().next().value;
        if (oldest !== undefined) this.#metricWindows.delete(oldest);
      }
      values = [];
    }
    values.push(value);
    if (values.length > 512) values.shift();
    this.#metricWindows.set(name, values);
    return sample;
  }

  metric(name: string): Readonly<{ count: number; latest: number | null; min: number | null; max: number | null; mean: number | null; p95: number | null }> {
    const values = this.#metricWindows.get(name) ?? [];
    if (values.length === 0) return Object.freeze({ count: 0, latest: null, min: null, max: null, mean: null, p95: null });
    const sorted = [...values].sort((a, b) => a - b);
    return Object.freeze({
      count: values.length,
      latest: values[values.length - 1] ?? null,
      min: sorted[0] ?? null,
      max: sorted[sorted.length - 1] ?? null,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null,
    });
  }

  incidents(afterSequence = 0, limit = 100): readonly DiagnosticIncident[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RuntimeFault("INVALID_INPUT", "Incident pagination is invalid", "diagnostics.incidents");
    }
    return Object.freeze(
      this.#incidents.snapshot().values
        .filter((incident) => incident.sequence > afterSequence)
        .slice(-limit),
    );
  }

  samples(afterTick = 0, limit = 500): readonly DiagnosticSample[] {
    if (!Number.isSafeInteger(afterTick) || afterTick < 0 || !Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RuntimeFault("INVALID_INPUT", "Sample pagination is invalid", "diagnostics.samples");
    }
    return Object.freeze(this.#samples.snapshot().values.filter((sample) => sample.tick >= afterTick).slice(0, limit));
  }

  acknowledgeThrough(tick: number): number {
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RuntimeFault("INVALID_INPUT", "Acknowledgement tick is invalid", "diagnostics.acknowledge");
    }
    let removed = 0;
    for (const [key, incident] of this.#active) {
      if (incident.lastSeenTick <= tick && incident.severity !== "critical") {
        this.#active.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  summary(): DiagnosticSummary {
    const incidents = this.#incidents.snapshot().values;
    return Object.freeze({
      incidentCount: this.#totalIncidents,
      uniqueIncidents: this.#active.size,
      samples: this.#samples.size,
      criticalIncidents: incidents.filter((incident) => incident.severity === "critical").length,
      errors: incidents.filter((incident) => incident.severity === "error").length,
      warnings: incidents.filter((incident) => incident.severity === "warning").length,
      droppedIncidents: this.#incidents.dropped,
      droppedSamples: this.#samples.dropped,
    });
  }
}

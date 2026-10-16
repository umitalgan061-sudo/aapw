import { RuntimeFault, stableFingerprint } from "./contracts";

export type TelemetrySeverity = "debug" | "info" | "warn" | "error" | "critical";
export type TelemetryScalar = string | number | boolean | null;

export interface TelemetryInput {
  readonly tick: number;
  readonly category: string;
  readonly severity: TelemetrySeverity;
  readonly event: string;
  readonly fields?: Readonly<Record<string, TelemetryScalar>>;
}

export interface TelemetryEvent {
  readonly sequence: number;
  readonly tick: number;
  readonly category: string;
  readonly severity: TelemetrySeverity;
  readonly event: string;
  readonly fields: Readonly<Record<string, TelemetryScalar>>;
  readonly fingerprint: string;
}

export interface TelemetryOptions {
  readonly capacity?: number;
  readonly maxFields?: number;
  readonly maxStringLength?: number;
  readonly sampleRate?: number;
  readonly deterministicSeed?: string;
  readonly allowedFields?: readonly string[];
  readonly exportPageLimit?: number;
}

export interface TelemetryEmitResult {
  readonly accepted: boolean;
  readonly reason?: "sampled" | "invalid" | "full" | "privacy-filtered";
  readonly sequence?: number;
}

export interface TelemetryPage {
  readonly events: readonly TelemetryEvent[];
  readonly requestedCursor: number;
  readonly nextCursor: number;
  readonly hasMore: boolean;
  readonly dropped: number;
  readonly filtered: number;
}

const SEVERITY_SCORE: Readonly<Record<TelemetrySeverity, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

const DEFAULT_FIELDS = [
  "component", "operation", "durationMs", "count", "status", "code", "reason", "profile",
  "queueDepth", "memoryBytes", "frameMs", "inputLatencyMs", "networkRttMs", "retryCount",
  "assetType", "service", "phase", "quality", "revision", "bytes", "dropped", "details",
];

const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|email|phone|address|location|ip|user.?name|credential)/iu;
const SENSITIVE_VALUE = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{1,3}(?:\.\d{1,3}){3}\b)/iu;

export class BoundedTelemetrySpool {
  readonly capacity: number;
  readonly maxFields: number;
  readonly maxStringLength: number;
  readonly sampleRate: number;
  readonly deterministicSeed: string;
  readonly exportPageLimit: number;
  readonly #allowedFields: ReadonlySet<string>;
  #events: TelemetryEvent[] = [];
  #sequence = 0;
  #dropped = 0;
  #filtered = 0;
  #sampled = 0;
  #acknowledgedThrough = 0;

  constructor(options: TelemetryOptions = {}) {
    this.capacity = options.capacity ?? 4096;
    this.maxFields = options.maxFields ?? 24;
    this.maxStringLength = options.maxStringLength ?? 160;
    this.sampleRate = options.sampleRate ?? 1;
    this.deterministicSeed = options.deterministicSeed ?? "aapw-r45";
    this.exportPageLimit = options.exportPageLimit ?? 500;
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || this.capacity > 1_000_000) {
      throw new RuntimeFault("INVALID_INPUT", "Telemetry capacity is invalid", "telemetry.constructor");
    }
    if (!Number.isInteger(this.maxFields) || this.maxFields < 1 || this.maxFields > 128) {
      throw new RuntimeFault("INVALID_INPUT", "Telemetry field limit is invalid", "telemetry.constructor");
    }
    if (!Number.isInteger(this.maxStringLength) || this.maxStringLength < 8 || this.maxStringLength > 4096) {
      throw new RuntimeFault("INVALID_INPUT", "Telemetry string limit is invalid", "telemetry.constructor");
    }
    if (!Number.isFinite(this.sampleRate) || this.sampleRate < 0 || this.sampleRate > 1) {
      throw new RuntimeFault("INVALID_INPUT", "Telemetry sample rate is invalid", "telemetry.constructor");
    }
    if (!Number.isInteger(this.exportPageLimit) || this.exportPageLimit < 1 || this.exportPageLimit > 10_000) {
      throw new RuntimeFault("INVALID_INPUT", "Telemetry export page limit is invalid", "telemetry.constructor");
    }
    this.#allowedFields = new Set(options.allowedFields ?? DEFAULT_FIELDS);
  }

  emit(input: TelemetryInput): TelemetryEmitResult {
    if (!Number.isSafeInteger(input.tick) || input.tick < 0 || !input.category.trim() || !input.event.trim()) {
      this.#filtered += 1;
      return Object.freeze({ accepted: false, reason: "invalid" });
    }
    const category = input.category.trim().slice(0, 96);
    const eventName = input.event.trim().slice(0, 96);
    const fieldsResult = this.#sanitizeFields(input.fields ?? {});
    if (fieldsResult.filtered > 0) this.#filtered += fieldsResult.filtered;
    if (fieldsResult.validCount === 0 && Object.keys(input.fields ?? {}).length > 0) {
      return Object.freeze({ accepted: false, reason: "privacy-filtered" });
    }
    const importance = SEVERITY_SCORE[input.severity] ?? -1;
    if (importance < 0) {
      this.#filtered += 1;
      return Object.freeze({ accepted: false, reason: "invalid" });
    }
    const samplingFingerprint = stableFingerprint({
      seed: this.deterministicSeed, tick: input.tick, category, event: eventName, fields: fieldsResult.fields,
    });
    const sampleValue = Number.parseInt(samplingFingerprint.slice(0, 8), 16) / 0xffffffff;
    if (importance < SEVERITY_SCORE.error && sampleValue > this.sampleRate) {
      this.#sampled += 1;
      return Object.freeze({ accepted: false, reason: "sampled" });
    }
    const eventBase = {
      sequence: this.#nextSequence(),
      tick: input.tick,
      category,
      severity: input.severity,
      event: eventName,
      fields: Object.freeze(fieldsResult.fields),
    };
    const event: TelemetryEvent = Object.freeze({
      ...eventBase,
      fingerprint: stableFingerprint(eventBase),
    });
    if (this.#events.length >= this.capacity) {
      const candidateIndex = this.#events.findIndex((entry) => SEVERITY_SCORE[entry.severity] < importance);
      if (candidateIndex >= 0) {
        this.#events.splice(candidateIndex, 1);
        this.#dropped += 1;
      } else {
        this.#dropped += 1;
        return Object.freeze({ accepted: false, reason: "full" });
      }
    }
    this.#events.push(event);
    return Object.freeze({ accepted: true, sequence: event.sequence });
  }

  page(afterSequence = 0, limit = this.exportPageLimit): TelemetryPage {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new RuntimeFault("INVALID_INPUT", "Telemetry cursor is invalid", "telemetry.page");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > this.exportPageLimit) {
      throw new RuntimeFault("INVALID_INPUT", "Telemetry page limit is invalid", "telemetry.page");
    }
    const available = this.#events.filter((event) => event.sequence > afterSequence);
    const events = available.slice(0, limit);
    const nextCursor = events.length > 0 ? events[events.length - 1]!.sequence : afterSequence;
    return Object.freeze({
      events: Object.freeze(events),
      requestedCursor: afterSequence,
      nextCursor,
      hasMore: available.length > events.length,
      dropped: this.#dropped,
      filtered: this.#filtered + this.#sampled,
    });
  }

  acknowledgeThrough(sequence: number): number {
    if (!Number.isSafeInteger(sequence) || sequence < this.#acknowledgedThrough) {
      throw new RuntimeFault("INVALID_INPUT", "Acknowledgement must be monotonic", "telemetry.acknowledge");
    }
    this.#acknowledgedThrough = sequence;
    const before = this.#events.length;
    this.#events = this.#events.filter((event) => event.sequence > sequence);
    return before - this.#events.length;
  }

  snapshot(): Readonly<{
    nextSequence: number;
    size: number;
    capacity: number;
    dropped: number;
    filtered: number;
    sampled: number;
    acknowledgedThrough: number;
  }> {
    return Object.freeze({
      nextSequence: this.#sequence + 1,
      size: this.#events.length,
      capacity: this.capacity,
      dropped: this.#dropped,
      filtered: this.#filtered,
      sampled: this.#sampled,
      acknowledgedThrough: this.#acknowledgedThrough,
    });
  }

  verify(event: TelemetryEvent): boolean {
    const base = {
      sequence: event.sequence,
      tick: event.tick,
      category: event.category,
      severity: event.severity,
      event: event.event,
      fields: event.fields,
    };
    return stableFingerprint(base) === event.fingerprint;
  }

  #sanitizeFields(input: Readonly<Record<string, TelemetryScalar>>): {
    fields: Record<string, TelemetryScalar>;
    validCount: number;
    filtered: number;
  } {
    const fields: Record<string, TelemetryScalar> = {};
    let validCount = 0;
    let filtered = 0;
    for (const key of Object.keys(input).sort()) {
      if (validCount >= this.maxFields) {
        filtered += 1;
        continue;
      }
      const value = input[key];
      if (!this.#allowedFields.has(key) || SENSITIVE_KEY.test(key) || value === undefined) {
        filtered += 1;
        continue;
      }
      let normalized: TelemetryScalar;
      if (typeof value === "string") {
        if (SENSITIVE_VALUE.test(value)) {
          filtered += 1;
          continue;
        }
        normalized = value.slice(0, this.maxStringLength);
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          filtered += 1;
          continue;
        }
        normalized = value;
      } else if (typeof value === "boolean" || value === null) {
        normalized = value;
      } else {
        filtered += 1;
        continue;
      }
      fields[key] = normalized;
      validCount += 1;
    }
    return { fields, validCount, filtered };
  }

  #nextSequence(): number {
    if (this.#sequence >= Number.MAX_SAFE_INTEGER) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Telemetry sequence exhausted", "telemetry.sequence");
    }
    this.#sequence += 1;
    return this.#sequence;
  }
}

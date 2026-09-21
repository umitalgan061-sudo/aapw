import type { FrameId, UnixMillis } from './types';
import { checksum } from './deterministic';
import { average, percentile, type SessionTelemetryPoint } from './runtimeContracts';

export type TelemetryKind = 'frame' | 'quality' | 'save' | 'stream' | 'error' | 'input' | 'lifecycle';

export interface TelemetryEvent {
  readonly id: string;
  readonly kind: TelemetryKind;
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
}

export interface TelemetryStoreOptions {
  readonly capacity?: number;
  readonly now?: () => UnixMillis;
  readonly sessionId?: string;
  readonly includeDeviceIdentifiers?: boolean;
}

export interface TelemetryWindow {
  readonly from: UnixMillis;
  readonly to: UnixMillis;
  readonly eventCount: number;
  readonly frameCount: number;
  readonly errorCount: number;
  readonly saveFailureCount: number;
  readonly p95FrameMs: number;
  readonly avgPressure: number;
}

function nowMs(): UnixMillis { return Date.now() as UnixMillis; }
function trimString(value: string, max = 120): string { return value.length > max ? value.slice(0, max) : value; }

/** In-memory telemetry store. No URLs, IPs, account ids or arbitrary payloads are accepted. */
export class TelemetryStore {
  readonly capacity: number;
  readonly sessionId: string;
  readonly includeDeviceIdentifiers: boolean;
  #now: () => UnixMillis;
  #events: TelemetryEvent[] = [];
  #sequence = 0;

  constructor(options: TelemetryStoreOptions = {}) {
    this.capacity = Math.max(64, Math.min(100_000, Math.trunc(options.capacity ?? 10_000)));
    this.sessionId = trimString(options.sessionId ?? `session-${Math.random().toString(36).slice(2, 10)}`);
    this.includeDeviceIdentifiers = Boolean(options.includeDeviceIdentifiers);
    this.#now = options.now ?? nowMs;
  }

  record(kind: TelemetryKind, frame: FrameId, fields: Readonly<Record<string, string | number | boolean>> = {}): TelemetryEvent {
    const sanitized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!/^[a-zA-Z0-9_.-]{1,48}$/.test(key)) continue;
      if (typeof value === 'string') sanitized[key] = trimString(value);
      else if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = Math.round(value * 1000) / 1000;
      else if (typeof value === 'boolean') sanitized[key] = value;
    }
    const event = Object.freeze({ id: `evt-${this.#sequence++}`, kind, frame, timestamp: this.#now(), fields: Object.freeze(sanitized) });
    this.#events.push(event);
    while (this.#events.length > this.capacity) this.#events.shift();
    return event;
  }

  recordFrame(point: SessionTelemetryPoint): void {
    this.record('frame', point.frame, {
      frameMs: point.frameMs,
      simulationMs: point.simulationMs,
      presentationMs: point.presentationMs,
      entities: point.entities,
      streamedCells: point.streamedCells,
      pressure: point.pressure,
    });
  }

  recordError(frame: FrameId, code: string): void { this.record('error', frame, { code: trimString(code, 64) }); }
  recordSave(frame: FrameId, success: boolean, durationMs: number): void { this.record('save', frame, { success, durationMs }); }
  recordStream(frame: FrameId, load: number, unload: number, retain: number): void { this.record('stream', frame, { load, unload, retain }); }
  recordQuality(frame: FrameId, previous: string, next: string): void { this.record('quality', frame, { previous: trimString(previous, 32), next: trimString(next, 32) }); }
  recordInput(frame: FrameId, action: string, source: string): void { this.record('input', frame, { action: trimString(action, 48), source: trimString(source, 32) }); }
  recordLifecycle(frame: FrameId, state: string): void { this.record('lifecycle', frame, { state: trimString(state, 32) }); }

  events(kind?: TelemetryKind): readonly TelemetryEvent[] {
    return Object.freeze(this.#events.filter((event) => kind ? event.kind === kind : true));
  }

  window(from: UnixMillis, to = this.#now()): TelemetryWindow {
    const events = this.#events.filter((event) => Number(event.timestamp) >= Number(from) && Number(event.timestamp) <= Number(to));
    const frames = events.filter((event) => event.kind === 'frame');
    const frameMs = frames.map((event) => Number(event.fields.frameMs ?? 0));
    const pressure = frames.map((event) => Number(event.fields.pressure ?? 0));
    return Object.freeze({
      from, to, eventCount: events.length, frameCount: frames.length,
      errorCount: events.filter((event) => event.kind === 'error').length,
      saveFailureCount: events.filter((event) => event.kind === 'save' && event.fields.success === false).length,
      p95FrameMs: percentile(frameMs, 0.95), avgPressure: average(pressure),
    });
  }

  summarize(): Readonly<Record<string, number>> {
    const frames = this.#events.filter((event) => event.kind === 'frame');
    const samples = frames.map((event) => Number(event.fields.frameMs ?? 0));
    return Object.freeze({
      events: this.#events.length,
      frames: frames.length,
      p50FrameMs: percentile(samples, 0.5),
      p95FrameMs: percentile(samples, 0.95),
      p99FrameMs: percentile(samples, 0.99),
      averageFrameMs: average(samples),
      errors: this.#events.filter((event) => event.kind === 'error').length,
      saves: this.#events.filter((event) => event.kind === 'save' && event.fields.success === true).length,
      saveFailures: this.#events.filter((event) => event.kind === 'save' && event.fields.success === false).length,
    });
  }

  exportJson(): string {
    const payload = {
      schema: 'aapw.telemetry.v1',
      sessionId: this.sessionId,
      events: this.#events,
      summary: this.summarize(),
    };
    return JSON.stringify({ ...payload, digest: checksum(payload) });
  }

  clear(): void { this.#events = []; }

  diagnostics(): Readonly<Record<string, unknown>> {
    return Object.freeze({ capacity: this.capacity, sessionId: this.sessionId, count: this.#events.length, summary: this.summarize() });
  }
}

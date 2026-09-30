import type { R29Incident, R29Severity } from './contracts.ts';

export type R29EventMap = {
  'runtime.started': { tick: number };
  'runtime.paused': { tick: number };
  'runtime.resumed': { tick: number };
  'runtime.stopped': { tick: number };
  'runtime.failed': { tick: number; message: string };
  'runtime.degraded': { tick: number; reason: string };
  'runtime.recovered': { tick: number };
  'frame.completed': { frame: number; tick: number; elapsedMs: number };
  'input.accepted': { sequence: number; tick: number };
  'input.rejected': { sequence: number; reason: string };
  'world.zone.loaded': { id: string; generation: number };
  'world.zone.unloaded': { id: string; generation: number };
  'world.zone.failed': { id: string; message: string };
  'asset.resident': { id: string; bytes: number };
  'asset.evicted': { id: string; bytes: number };
  'network.health': { score: number; health: string };
  'network.reconcile': { tick: number; acknowledgedInput: number; replayed: number };
  'render.backend.changed': { from: string; to: string; reason: string };
  'render.degraded': { tier: string; reason: string };
  'telemetry.incident': R29Incident;
};

export type R29EventName = keyof R29EventMap;
export type R29Listener<K extends R29EventName> = (payload: R29EventMap[K]) => void;

interface ListenerRecord {
  readonly id: number;
  readonly once: boolean;
  readonly handler: (payload: unknown) => void;
}

export class R29EventBus {
  #listeners = new Map<R29EventName, Map<number, ListenerRecord>>();
  #nextId = 1;
  #dispatchDepth = 0;
  #queued: Array<{ readonly name: R29EventName; readonly payload: unknown }> = [];

  on<K extends R29EventName>(name: K, handler: R29Listener<K>): () => void {
    const id = this.#nextId++;
    const bucket = this.#listeners.get(name) ?? new Map<number, ListenerRecord>();
    bucket.set(id, { id, once: false, handler: handler as (payload: unknown) => void });
    this.#listeners.set(name, bucket);
    return () => bucket.delete(id);
  }

  once<K extends R29EventName>(name: K, handler: R29Listener<K>): () => void {
    const id = this.#nextId++;
    const bucket = this.#listeners.get(name) ?? new Map<number, ListenerRecord>();
    bucket.set(id, { id, once: true, handler: handler as (payload: unknown) => void });
    this.#listeners.set(name, bucket);
    return () => bucket.delete(id);
  }

  emit<K extends R29EventName>(name: K, payload: R29EventMap[K]): void {
    if (this.#dispatchDepth > 0) {
      this.#queued.push({ name, payload });
      return;
    }
    this.#dispatch(name, payload);
  }

  emitSafe<K extends R29EventName>(name: K, payload: R29EventMap[K], report?: (error: unknown) => void): void {
    const bucket = this.#listeners.get(name);
    if (!bucket || bucket.size === 0) return;
    this.#dispatchDepth += 1;
    try {
      for (const record of [...bucket.values()]) {
        try {
          record.handler(payload);
        } catch (error) {
          report?.(error);
        }
        if (record.once) bucket.delete(record.id);
      }
    } finally {
      this.#dispatchDepth -= 1;
      if (this.#dispatchDepth === 0) this.#flushQueued(report);
    }
  }

  listenerCount(name?: R29EventName): number {
    if (name) return this.#listeners.get(name)?.size ?? 0;
    let total = 0;
    for (const bucket of this.#listeners.values()) total += bucket.size;
    return total;
  }

  clear(name?: R29EventName): void {
    if (name) this.#listeners.delete(name);
    else this.#listeners.clear();
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      [...this.#listeners.entries()]
        .map(([name, bucket]) => [name, bucket.size])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  #dispatch(name: R29EventName, payload: unknown): void {
    const bucket = this.#listeners.get(name);
    if (!bucket || bucket.size === 0) return;
    this.#dispatchDepth += 1;
    try {
      for (const record of [...bucket.values()]) {
        record.handler(payload);
        if (record.once) bucket.delete(record.id);
      }
    } finally {
      this.#dispatchDepth -= 1;
      if (this.#dispatchDepth === 0) this.#flushQueued();
    }
  }

  #flushQueued(report?: (error: unknown) => void): void {
    if (this.#queued.length === 0) return;
    const queue = this.#queued.splice(0);
    for (const item of queue) {
      try {
        this.#dispatch(item.name, item.payload);
      } catch (error) {
        report?.(error);
      }
    }
  }
}

export interface R29IncidentRecorderOptions {
  readonly maxIncidents?: number;
  readonly eventBus?: R29EventBus;
  readonly defaultSeverity?: R29Severity;
}

export class R29IncidentRecorder {
  readonly maxIncidents: number;
  readonly eventBus: R29EventBus;
  readonly defaultSeverity: R29Severity;
  #incidents: R29Incident[] = [];
  #sequence = 0;

  constructor(options: R29IncidentRecorderOptions = {}) {
    this.maxIncidents = Math.max(8, Math.floor(options.maxIncidents ?? 256));
    this.eventBus = options.eventBus ?? new R29EventBus();
    this.defaultSeverity = options.defaultSeverity ?? 'warning';
  }

  record(input: Omit<R29Incident, 'id'> & { readonly id?: string }): R29Incident {
    const incident = Object.freeze({
      ...input,
      id: input.id ?? 'r29-' + (++this.#sequence).toString(36),
    });
    this.#incidents.push(incident);
    while (this.#incidents.length > this.maxIncidents) this.#incidents.shift();
    this.eventBus.emitSafe('telemetry.incident', incident);
    return incident;
  }

  debug(tick: number, code: string, message: string, context: Readonly<Record<string, string | number | boolean>> = {}): R29Incident {
    return this.record({ tick, severity: 'debug', code, message, context });
  }

  info(tick: number, code: string, message: string, context: Readonly<Record<string, string | number | boolean>> = {}): R29Incident {
    return this.record({ tick, severity: 'info', code, message, context });
  }

  warning(tick: number, code: string, message: string, context: Readonly<Record<string, string | number | boolean>> = {}): R29Incident {
    return this.record({ tick, severity: 'warning', code, message, context });
  }

  error(tick: number, code: string, message: string, context: Readonly<Record<string, string | number | boolean>> = {}): R29Incident {
    return this.record({ tick, severity: 'error', code, message, context });
  }

  critical(tick: number, code: string, message: string, context: Readonly<Record<string, string | number | boolean>> = {}): R29Incident {
    return this.record({ tick, severity: 'critical', code, message, context });
  }

  all(): readonly R29Incident[] {
    return Object.freeze(this.#incidents.map((item) => ({ ...item, context: { ...item.context } })));
  }

  recent(limit = 20): readonly R29Incident[] {
    return Object.freeze(this.#incidents.slice(-Math.max(1, Math.floor(limit))).map((item) => ({ ...item })));
  }

  count(severity?: R29Severity): number {
    return severity ? this.#incidents.filter((item) => item.severity === severity).length : this.#incidents.length;
  }

  clear(): void {
    this.#incidents.length = 0;
  }
}

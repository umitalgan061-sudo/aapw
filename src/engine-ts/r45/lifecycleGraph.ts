import { BoundedRing, RuntimeFault, normalizeError, serviceId, type ServiceId } from "./contracts";

export type ServiceState = "registered" | "starting" | "ready" | "degraded" | "stopping" | "stopped" | "failed";

export interface ServiceContext {
  readonly generation: number;
  readonly signal?: AbortSignal;
  readonly services: ReadonlyMap<ServiceId, ServiceLifecycle>;
}

export interface ServiceHealth {
  readonly healthy: boolean;
  readonly detail?: string;
}

export interface ServiceLifecycle {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  start(context: ServiceContext): void | Promise<void>;
  stop?(context: ServiceContext): void | Promise<void>;
  health?(): ServiceHealth | Promise<ServiceHealth>;
}

export interface ServiceRecord {
  readonly id: ServiceId;
  readonly state: ServiceState;
  readonly generation: number;
  readonly changedAtTick: number;
  readonly lastError?: string;
  readonly startCount: number;
  readonly stopCount: number;
}

export interface LifecycleEvent {
  readonly sequence: number;
  readonly tick: number;
  readonly serviceId: ServiceId;
  readonly from: ServiceState;
  readonly to: ServiceState;
  readonly reason: string;
}

export interface LifecycleGraphOptions {
  readonly maxServices?: number;
  readonly eventCapacity?: number;
  readonly clock?: () => number;
}

const ALLOWED: Readonly<Record<ServiceState, readonly ServiceState[]>> = {
  registered: ["starting", "stopped", "failed"],
  starting: ["ready", "failed", "stopping"],
  ready: ["degraded", "stopping", "failed"],
  degraded: ["ready", "stopping", "failed"],
  stopping: ["stopped", "failed"],
  stopped: ["starting"],
  failed: ["starting", "stopping", "stopped"],
};

export class ServiceLifecycleGraph {
  readonly maxServices: number;
  readonly #clock: () => number;
  #definitions = new Map<ServiceId, ServiceLifecycle>();
  #records = new Map<ServiceId, ServiceRecord>();
  #events: BoundedRing<LifecycleEvent>;
  #generation = 0;
  #eventSequence = 0;
  #transitionMutex: Promise<void> = Promise.resolve();

  constructor(options: LifecycleGraphOptions = {}) {
    this.maxServices = options.maxServices ?? 128;
    if (!Number.isInteger(this.maxServices) || this.maxServices < 1 || this.maxServices > 4096) {
      throw new RuntimeFault("INVALID_INPUT", "maxServices is outside the supported range", "lifecycle.constructor");
    }
    this.#clock = options.clock ?? (() => 0);
    this.#events = new BoundedRing(options.eventCapacity ?? 1024);
  }

  register(service: ServiceLifecycle): ServiceId {
    const id = serviceId(service.id);
    if (this.#definitions.has(id)) {
      throw new RuntimeFault("CONFLICT", "Service is already registered", "lifecycle.register", {
        details: { id },
      });
    }
    if (this.#definitions.size >= this.maxServices) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Service registry is full", "lifecycle.register");
    }
    const dependencies = (service.dependsOn ?? []).map((entry) => serviceId(entry));
    if (dependencies.includes(id)) {
      throw new RuntimeFault("CONFLICT", "A service cannot depend on itself", "lifecycle.register", {
        details: { id },
      });
    }
    this.#definitions.set(id, Object.freeze({ ...service, id, dependsOn: Object.freeze(dependencies) }));
    this.#records.set(id, Object.freeze({
      id, state: "registered", generation: this.#generation, changedAtTick: this.#clock(), startCount: 0, stopCount: 0,
    }));
    return id;
  }

  get(idValue: string): ServiceRecord | undefined {
    return this.#records.get(serviceId(idValue));
  }

  records(): readonly ServiceRecord[] {
    return Object.freeze([...this.#records.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  events(): readonly LifecycleEvent[] {
    return this.#events.snapshot().values;
  }

  plan(): readonly ServiceId[] {
    const result: ServiceId[] = [];
    const marks = new Map<ServiceId, "visiting" | "visited">();
    const visit = (id: ServiceId, trail: ServiceId[]): void => {
      const mark = marks.get(id);
      if (mark === "visited") return;
      if (mark === "visiting") {
        throw new RuntimeFault("CONFLICT", "Service dependency cycle detected", "lifecycle.plan", {
          details: { cycle: [...trail, id].join(" -> ") },
        });
      }
      const definition = this.#definitions.get(id);
      if (!definition) {
        throw new RuntimeFault("NOT_FOUND", "A service dependency is not registered", "lifecycle.plan", {
          details: { id, owner: trail[trail.length - 1] ?? "root" },
        });
      }
      marks.set(id, "visiting");
      for (const dependency of definition.dependsOn ?? []) visit(dependency, [...trail, id]);
      marks.set(id, "visited");
      result.push(id);
    };
    for (const id of [...this.#definitions.keys()].sort()) visit(id, []);
    return Object.freeze(result);
  }

  async startAll(signal?: AbortSignal): Promise<void> {
    return this.#serialize(async () => {
      this.plan();
      this.#generation += 1;
      const started: ServiceId[] = [];
      for (const id of this.plan()) {
        if (signal?.aborted) {
          const fault = new RuntimeFault("CANCELLED", "Service startup was aborted", "lifecycle.startAll");
          await this.#rollback(started, signal);
          throw fault;
        }
        const record = this.#records.get(id);
        if (record?.state === "ready" || record?.state === "degraded") continue;
        const definition = this.#definitions.get(id);
        if (!definition) throw new RuntimeFault("NOT_FOUND", "Service disappeared during startup", "lifecycle.startAll");
        this.#transition(id, "starting", "startup");
        try {
          const context: ServiceContext = signal
            ? { generation: this.#generation, signal, services: this.#definitions }
            : { generation: this.#generation, services: this.#definitions };
          await definition.start(context);
          this.#transition(id, "ready", "startup-complete");
          started.push(id);
        } catch (error) {
          this.#transition(id, "failed", "startup-failed", normalizeError(error, "lifecycle.start"));
          await this.#rollback(started, signal);
          throw normalizeError(error, "lifecycle.start");
        }
      }
    });
  }

  async stopAll(signal?: AbortSignal): Promise<void> {
    return this.#serialize(async () => {
      const ordered = [...this.plan()].reverse();
      const errors: RuntimeFault[] = [];
      for (const id of ordered) {
        const record = this.#records.get(id);
        if (!record || record.state === "stopped" || record.state === "registered") continue;
        const definition = this.#definitions.get(id);
        if (!definition) continue;
        this.#transition(id, "stopping", "shutdown");
        try {
          const context: ServiceContext = signal
            ? { generation: this.#generation, signal, services: this.#definitions }
            : { generation: this.#generation, services: this.#definitions };
          await definition.stop?.(context);
          this.#transition(id, "stopped", "shutdown-complete");
        } catch (error) {
          const fault = normalizeError(error, "lifecycle.stop");
          errors.push(fault);
          this.#transition(id, "failed", "shutdown-failed", fault);
        }
      }
      if (errors.length > 0) {
        throw new RuntimeFault("UNAVAILABLE", "One or more services failed to stop cleanly", "lifecycle.stopAll", {
          retryable: true,
          details: { failedCount: errors.length, failedServices: errors.map((error) => error.operation).join(",") },
        });
      }
    });
  }

  async inspectHealth(): Promise<readonly ServiceRecord[]> {
    for (const [id, definition] of this.#definitions) {
      const current = this.#records.get(id);
      if (!current || (current.state !== "ready" && current.state !== "degraded") || !definition.health) continue;
      try {
        const health = await definition.health();
        if (health.healthy && current.state === "degraded") this.#transition(id, "ready", "health-recovered");
        if (!health.healthy && current.state === "ready") {
          this.#transition(id, "degraded", health.detail ?? "health-check-failed");
        }
      } catch (error) {
        this.#transition(id, "degraded", "health-check-threw", normalizeError(error, "lifecycle.health"));
      }
    }
    return this.records();
  }

  async restart(idValue: string, signal?: AbortSignal): Promise<void> {
    const id = serviceId(idValue);
    return this.#serialize(async () => {
      const definition = this.#definitions.get(id);
      if (!definition) throw new RuntimeFault("NOT_FOUND", "Service is not registered", "lifecycle.restart", { details: { id } });
      const dependents = this.#dependentsOf(id);
      const shutdownOrder = [id, ...dependents].reverse();
      for (const currentId of shutdownOrder) await this.#stopOne(currentId, signal);
      const startupOrder = this.plan().filter((entry) => entry === id || dependents.includes(entry));
      this.#generation += 1;
      for (const currentId of startupOrder) await this.#startOne(currentId, signal);
    });
  }

  snapshot(): Readonly<{ generation: number; services: readonly ServiceRecord[]; eventsDropped: number }> {
    return Object.freeze({
      generation: this.#generation,
      services: this.records(),
      eventsDropped: this.#events.dropped,
    });
  }

  async #rollback(started: readonly ServiceId[], signal?: AbortSignal): Promise<void> {
    for (const id of [...started].reverse()) {
      try {
        await this.#stopOne(id, signal);
      } catch {
        // The original startup failure is authoritative; rollback failures remain in the event log.
      }
    }
  }

  #dependentsOf(id: ServiceId): ServiceId[] {
    const result: ServiceId[] = [];
    let frontier = [id];
    while (frontier.length > 0) {
      const current = frontier.shift();
      if (!current) continue;
      for (const [candidateId, definition] of this.#definitions) {
        if (candidateId !== id && (definition.dependsOn ?? []).includes(current) && !result.includes(candidateId)) {
          result.push(candidateId);
          frontier.push(candidateId);
        }
      }
    }
    return result;
  }

  async #startOne(id: ServiceId, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new RuntimeFault("CANCELLED", "Lifecycle operation was aborted", "lifecycle.startOne");
    const definition = this.#definitions.get(id);
    if (!definition) throw new RuntimeFault("NOT_FOUND", "Service is not registered", "lifecycle.startOne");
    this.#transition(id, "starting", "restart");
    try {
      const context: ServiceContext = signal
        ? { generation: this.#generation, signal, services: this.#definitions }
        : { generation: this.#generation, services: this.#definitions };
      await definition.start(context);
      this.#transition(id, "ready", "restart-complete");
    } catch (error) {
      const fault = normalizeError(error, "lifecycle.restart.start");
      this.#transition(id, "failed", "restart-failed", fault);
      throw fault;
    }
  }

  async #stopOne(id: ServiceId, signal?: AbortSignal): Promise<void> {
    const record = this.#records.get(id);
    if (!record || record.state === "registered" || record.state === "stopped") return;
    const definition = this.#definitions.get(id);
    if (!definition) return;
    this.#transition(id, "stopping", "restart-stop");
    try {
      const context: ServiceContext = signal
        ? { generation: this.#generation, signal, services: this.#definitions }
        : { generation: this.#generation, services: this.#definitions };
      await definition.stop?.(context);
      this.#transition(id, "stopped", "restart-stop-complete");
    } catch (error) {
      const fault = normalizeError(error, "lifecycle.restart.stop");
      this.#transition(id, "failed", "restart-stop-failed", fault);
      throw fault;
    }
  }

  #transition(id: ServiceId, to: ServiceState, reason: string, error?: RuntimeFault): void {
    const current = this.#records.get(id);
    if (!current) throw new RuntimeFault("NOT_FOUND", "Service record is missing", "lifecycle.transition", { details: { id } });
    if (current.state !== to && !ALLOWED[current.state].includes(to)) {
      throw new RuntimeFault("CONFLICT", "Invalid lifecycle transition", "lifecycle.transition", {
        details: { id, from: current.state, to },
      });
    }
    const next: ServiceRecord = Object.freeze({
      id,
      state: to,
      generation: this.#generation,
      changedAtTick: this.#clock(),
      startCount: current.startCount + (to === "starting" ? 1 : 0),
      stopCount: current.stopCount + (to === "stopped" ? 1 : 0),
      ...(error ? { lastError: error.message } : current.lastError ? { lastError: current.lastError } : {}),
    });
    this.#records.set(id, next);
    this.#eventSequence += 1;
    this.#events.push(Object.freeze({
      sequence: this.#eventSequence,
      tick: this.#clock(),
      serviceId: id,
      from: current.state,
      to,
      reason,
    }));
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#transitionMutex.then(operation, operation);
    this.#transitionMutex = result.then(() => undefined, () => undefined);
    return result;
  }
}

import { compareStrings, err, ok, type LifecycleState, type Result } from "./contracts.ts";

export type ServiceStartContext = {
  readonly signal: AbortSignal;
  readonly serviceId: string;
  readonly dependencies: ReadonlyMap<string, unknown>;
};
export type ServiceStopContext = {
  readonly reason: "shutdown" | "startup-rollback" | "fault";
  readonly serviceId: string;
  readonly signal: AbortSignal;
};

export interface RuntimeService<T = unknown> {
  readonly id: string;
  readonly dependencies?: readonly string[];
  readonly critical?: boolean;
  readonly start?: (context: ServiceStartContext) => T | Promise<T>;
  readonly stop?: (value: T | undefined, context: ServiceStopContext) => void | Promise<void>;
  readonly health?: (value: T | undefined) => boolean;
}

export interface ServiceStatus {
  readonly id: string;
  readonly state: LifecycleState;
  readonly critical: boolean;
  readonly startOrder: number | null;
  readonly fault: string | null;
  readonly lastTransition: number;
}

export interface LifecycleReport {
  readonly success: boolean;
  readonly started: readonly string[];
  readonly stopped: readonly string[];
  readonly failures: readonly { readonly serviceId: string; readonly phase: "start" | "stop"; readonly message: string }[];
  readonly durationMs: number;
}

interface ServiceEntry {
  readonly definition: RuntimeService;
  state: LifecycleState;
  value: unknown;
  startOrder: number | null;
  fault: string | null;
  lastTransition: number;
}

export interface LifecycleClock {
  now(): number;
}

const clockDefault: LifecycleClock = { now: () => typeof performance !== "undefined" ? performance.now() : 0 };

/**
 * Transactional service lifecycle with dependency ordering and reverse rollback.
 * It is deliberately explicit: no hidden timers and no fire-and-forget startup.
 */
export class RuntimeLifecycle {
  readonly clock: LifecycleClock;
  #services = new Map<string, ServiceEntry>();
  #ordered: string[] = [];
  #state: "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed" = "idle";
  #controller: AbortController | null = null;
  #transitionSequence = 0;

  constructor(clock: LifecycleClock = clockDefault) {
    this.clock = clock;
  }

  get state(): string {
    return this.#state;
  }

  register<T>(service: RuntimeService<T>): Result<true> {
    if (this.#state !== "idle") return err("LIFECYCLE_IMMUTABLE", "Services can only be registered before startup.");
    const id = service.id.trim();
    if (!id) return err("LIFECYCLE_EMPTY_ID", "Service identifier must not be empty.");
    if (this.#services.has(id)) return err("LIFECYCLE_DUPLICATE_ID", "Service identifier is already registered.", false, { id });
    const dependencies = [...new Set((service.dependencies ?? []).map((item) => item.trim()).filter(Boolean))].sort(compareStrings);
    const definition: RuntimeService<unknown> = Object.freeze({
      id,
      dependencies: Object.freeze(dependencies),
      ...(service.critical === undefined ? {} : { critical: service.critical }),
      ...(service.start === undefined ? {} : { start: (context: ServiceStartContext) => service.start!(context) }),
      ...(service.stop === undefined ? {} : {
        stop: (value: unknown, context: ServiceStopContext) => service.stop!(value as T | undefined, context),
      }),
      ...(service.health === undefined ? {} : {
        health: (value: unknown) => service.health!(value as T | undefined),
      }),
    });
    this.#services.set(id, {
      definition,
      state: "registered",
      value: undefined,
      startOrder: null,
      fault: null,
      lastTransition: this.#transitionSequence++,
    });
    return ok(true);
  }

  plan(): readonly string[] {
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const [id, entry] of this.#services) {
      indegree.set(id, 0);
      for (const dependency of entry.definition.dependencies ?? []) {
        if (!this.#services.has(dependency)) throw new Error("Missing dependency " + dependency + " required by " + id);
        indegree.set(id, (indegree.get(id) ?? 0) + 1);
        const list = outgoing.get(dependency) ?? [];
        list.push(id);
        outgoing.set(dependency, list);
      }
    }
    const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort(compareStrings);
    const ordered: string[] = [];
    while (ready.length > 0) {
      const id = ready.shift();
      if (!id) break;
      ordered.push(id);
      for (const next of (outgoing.get(id) ?? []).sort(compareStrings)) {
        const degree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, degree);
        if (degree === 0) {
          ready.push(next);
          ready.sort(compareStrings);
        }
      }
    }
    if (ordered.length !== this.#services.size) throw new Error("Runtime service dependency cycle detected.");
    this.#ordered = ordered;
    return Object.freeze([...ordered]);
  }

  async start(): Promise<LifecycleReport> {
    const startedAt = this.clock.now();
    if (this.#state === "ready") {
      return this.#report(true, [], [], [], this.clock.now() - startedAt);
    }
    if (this.#state !== "idle") {
      return this.#report(false, [], [], [{ serviceId: "$lifecycle", phase: "start", message: "Cannot start from " + this.#state }], 0);
    }
    let order: readonly string[];
    try {
      order = this.plan();
    } catch (cause) {
      this.#state = "failed";
      return this.#report(false, [], [], [{ serviceId: "$lifecycle", phase: "start", message: errorMessage(cause) }], this.clock.now() - startedAt);
    }

    this.#state = "starting";
    this.#controller = new AbortController();
    const started: string[] = [];
    const failures: { serviceId: string; phase: "start" | "stop"; message: string }[] = [];

    for (const id of order) {
      const entry = this.#services.get(id);
      if (!entry) continue;
      entry.state = "starting";
      entry.lastTransition = this.#transitionSequence++;
      const dependencies = new Map<string, unknown>();
      let blockedBy: string | null = null;
      for (const dependency of entry.definition.dependencies ?? []) {
        const dependentEntry = this.#services.get(dependency);
        if (!dependentEntry || dependentEntry.state !== "ready") {
          blockedBy = dependency;
          break;
        }
        dependencies.set(dependency, dependentEntry.value);
      }
      if (blockedBy) {
        entry.state = "failed";
        entry.fault = "dependency not ready: " + blockedBy;
        entry.lastTransition = this.#transitionSequence++;
        failures.push({ serviceId: id, phase: "start", message: entry.fault });
        if (entry.definition.critical !== false) break;
        continue;
      }
      try {
        const value = await entry.definition.start?.({
          signal: this.#controller.signal,
          serviceId: id,
          dependencies,
        });
        entry.value = value;
        entry.state = "ready";
        entry.startOrder = started.length;
        entry.fault = null;
        entry.lastTransition = this.#transitionSequence++;
        started.push(id);
      } catch (cause) {
        entry.state = "failed";
        entry.fault = errorMessage(cause);
        entry.lastTransition = this.#transitionSequence++;
        failures.push({ serviceId: id, phase: "start", message: entry.fault });
        if (entry.definition.critical !== false) break;
      }
    }

    if (failures.some((failure) => this.#services.get(failure.serviceId)?.definition.critical !== false)) {
      this.#controller.abort("critical startup failure");
      const stopped = await this.#stopStarted("startup-rollback", started);
      this.#state = "failed";
      return this.#report(false, started, stopped, failures, this.clock.now() - startedAt);
    }
    this.#state = "ready";
    return this.#report(true, started, [], failures, this.clock.now() - startedAt);
  }

  async stop(reason: "shutdown" | "fault" = "shutdown"): Promise<LifecycleReport> {
    const startedAt = this.clock.now();
    if (this.#state === "stopped") return this.#report(true, [], [], [], 0);
    if (this.#state === "starting") this.#controller?.abort(reason);
    this.#state = "stopping";
    const started = [...this.#ordered].filter((id) => {
      const entry = this.#services.get(id);
      return entry?.state === "ready" || entry?.state === "degraded" || entry?.state === "failed";
    });
    const failures: { serviceId: string; phase: "start" | "stop"; message: string }[] = [];
    const stopped: string[] = [];
    for (const id of [...this.#ordered].reverse()) {
      const entry = this.#services.get(id);
      if (!entry || entry.state === "registered" || entry.state === "stopped") continue;
      entry.state = "stopping";
      entry.lastTransition = this.#transitionSequence++;
      try {
        await entry.definition.stop?.(entry.value, {
          reason,
          serviceId: id,
          signal: new AbortController().signal,
        });
        entry.value = undefined;
        entry.state = "stopped";
        entry.startOrder = null;
        entry.fault = null;
        entry.lastTransition = this.#transitionSequence++;
        stopped.push(id);
      } catch (cause) {
        entry.state = "failed";
        entry.fault = errorMessage(cause);
        entry.lastTransition = this.#transitionSequence++;
        failures.push({ serviceId: id, phase: "stop", message: entry.fault });
      }
    }
    this.#state = failures.length > 0 ? "failed" : "stopped";
    return this.#report(failures.length === 0, started, stopped, failures, this.clock.now() - startedAt);
  }

  healthCheck(): readonly { readonly serviceId: string; readonly healthy: boolean; readonly state: LifecycleState }[] {
    const results = [...this.#services.values()].map((entry) => {
      let healthy = entry.state === "ready";
      try {
        if (entry.definition.health) healthy = healthy && entry.definition.health(entry.value);
      } catch {
        healthy = false;
      }
      if (entry.state === "ready" && !healthy) {
        entry.state = "degraded";
        entry.lastTransition = this.#transitionSequence++;
      } else if (entry.state === "degraded" && healthy) {
        entry.state = "ready";
        entry.lastTransition = this.#transitionSequence++;
      }
      return Object.freeze({ serviceId: entry.definition.id, healthy, state: entry.state });
    });
    return Object.freeze(results.sort((a, b) => compareStrings(a.serviceId, b.serviceId)));
  }

  statuses(): readonly ServiceStatus[] {
    return Object.freeze([...this.#services.values()].map((entry) => Object.freeze({
      id: entry.definition.id,
      state: entry.state,
      critical: entry.definition.critical !== false,
      startOrder: entry.startOrder,
      fault: entry.fault,
      lastTransition: entry.lastTransition,
    })).sort((a, b) => compareStrings(a.id, b.id)));
  }

  #stopStarted(
    reason: "startup-rollback" | "fault",
    ids: readonly string[],
  ): Promise<string[]> {
    return (async () => {
      const stopped: string[] = [];
      for (const id of [...ids].reverse()) {
        const entry = this.#services.get(id);
        if (!entry) continue;
        try {
          await entry.definition.stop?.(entry.value, {
            reason,
            serviceId: id,
            signal: new AbortController().signal,
          });
          entry.value = undefined;
          entry.state = "stopped";
          entry.startOrder = null;
          entry.lastTransition = this.#transitionSequence++;
          stopped.push(id);
        } catch (cause) {
          entry.state = "failed";
          entry.fault = errorMessage(cause);
          entry.lastTransition = this.#transitionSequence++;
        }
      }
      return stopped;
    })();
  }

  #report(
    success: boolean,
    started: readonly string[],
    stopped: readonly string[],
    failures: readonly { readonly serviceId: string; readonly phase: "start" | "stop"; readonly message: string }[],
    durationMs: number,
  ): LifecycleReport {
    return Object.freeze({
      success,
      started: Object.freeze([...started]),
      stopped: Object.freeze([...stopped]),
      failures: Object.freeze(failures.map((failure) => Object.freeze({ ...failure }))),
      durationMs: Math.max(0, durationMs),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

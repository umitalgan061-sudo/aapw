import {
  RuntimeFault,
  normalizeError,
  stableFingerprint,
  type Outcome,
  fail,
  succeed,
} from "./contracts";
import { CommandGateway, type CommandDefinition, type CommandPrincipal, type CommandReceipt } from "./commandGateway";
import { DeterministicLogicalClock, type ClockAdvance, type LogicalClockConfig } from "./logicalClock";
import { ServiceLifecycleGraph, type LifecycleGraphOptions, type ServiceLifecycle } from "./lifecycleGraph";
import { PersistenceCoordinator, MemoryPersistenceAdapter, type PersistenceAdapter, type LoadReceipt, type SaveReceipt } from "./persistenceCoordinator";
import { BoundedTelemetrySpool, type TelemetryInput } from "./telemetrySpool";
import { AdaptiveQualityDirector, type QualityDirectorOptions, type QualityDecision, type RuntimePressureSample } from "./qualityDirector";
import { BoundedWorkScheduler, type SchedulerOptions, type WorkDefinition, type WorkReceipt, type OutcomeReceipt } from "./workScheduler";
import { RuntimeDiagnosticLedger, type DiagnosticLedgerOptions } from "./runtimeDiagnostics";

export type RuntimeOperationsState = "cold" | "starting" | "running" | "degraded" | "stopping" | "stopped" | "failed";

export interface RuntimeOperationsOptions {
  readonly clock?: LogicalClockConfig;
  readonly lifecycle?: LifecycleGraphOptions;
  readonly scheduler?: SchedulerOptions;
  readonly quality?: QualityDirectorOptions;
  readonly telemetry?: ConstructorParameters<typeof BoundedTelemetrySpool>[0];
  readonly diagnostics?: DiagnosticLedgerOptions;
  readonly persistenceAdapter?: PersistenceAdapter;
  readonly persistenceSchemaVersion?: number;
  readonly persistenceMaxPayloadBytes?: number;
  readonly telemetryCapacity?: number;
}

export interface RuntimeFrameMetrics {
  readonly frameMs?: number;
  readonly inputLatencyMs?: number;
  readonly memoryBytes?: number;
  readonly networkRttMs?: number | null;
  readonly taskQueueDepth?: number;
  readonly assetQueueDepth?: number;
  readonly droppedFrames?: number;
  readonly frameBudgetMs?: number;
}

export interface RuntimeFrameReport {
  readonly frameNumber: number;
  readonly clock: ClockAdvance;
  readonly work: readonly WorkReceipt[];
  readonly quality: QualityDecision | null;
  readonly state: RuntimeOperationsState;
}

export interface RuntimeSavePayload {
  readonly format: "aapw-runtime-r45";
  readonly runtimeTick: number;
  readonly frameNumber: number;
  readonly sections: Readonly<Record<string, unknown>>;
  readonly fingerprint: string;
}

export interface RuntimeStateSection<T> {
  readonly key: string;
  readonly capture: () => T;
  readonly validate: (value: unknown) => value is T;
  readonly restore: (value: T) => void | Promise<void>;
}

export interface RuntimeOperationsSnapshot {
  readonly state: RuntimeOperationsState;
  readonly tick: number;
  readonly frameNumber: number;
  readonly services: ReturnType<ServiceLifecycleGraph["snapshot"]>;
  readonly scheduler: ReturnType<BoundedWorkScheduler["stats"]>;
  readonly commands: ReturnType<CommandGateway["stats"]>;
  readonly telemetry: ReturnType<BoundedTelemetrySpool["snapshot"]>;
  readonly quality: ReturnType<AdaptiveQualityDirector["snapshot"]>;
  readonly diagnostics: ReturnType<RuntimeDiagnosticLedger["summary"]>;
}

function isRuntimeSavePayload(value: unknown): value is RuntimeSavePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload.format === "aapw-runtime-r45" &&
    Number.isSafeInteger(payload.runtimeTick) && (payload.runtimeTick as number) >= 0 &&
    Number.isSafeInteger(payload.frameNumber) && (payload.frameNumber as number) >= 0 &&
    typeof payload.sections === "object" && payload.sections !== null && !Array.isArray(payload.sections) &&
    typeof payload.fingerprint === "string";
}

export class RuntimeOperations {
  readonly clock: DeterministicLogicalClock;
  readonly services: ServiceLifecycleGraph;
  readonly scheduler: BoundedWorkScheduler;
  readonly commands: CommandGateway;
  readonly telemetry: BoundedTelemetrySpool;
  readonly quality: AdaptiveQualityDirector;
  readonly persistence: PersistenceCoordinator;
  readonly diagnostics: RuntimeDiagnosticLedger;

  #state: RuntimeOperationsState = "cold";
  #frameNumber = 0;
  #sections = new Map<string, RuntimeStateSection<unknown>>();
  #lastFrameTick = 0;
  readonly #maxStateSections = 256;

  constructor(options: RuntimeOperationsOptions = {}) {
    this.clock = new DeterministicLogicalClock(options.clock);
    this.services = new ServiceLifecycleGraph({
      ...options.lifecycle,
      clock: () => this.clock.tick,
    });
    this.scheduler = new BoundedWorkScheduler(options.scheduler);
    this.commands = new CommandGateway();
    this.telemetry = new BoundedTelemetrySpool({
      ...options.telemetry,
      ...(options.telemetryCapacity === undefined ? {} : { capacity: options.telemetryCapacity }),
    });
    this.quality = new AdaptiveQualityDirector(options.quality);
    this.diagnostics = new RuntimeDiagnosticLedger(options.diagnostics);
    const adapter = options.persistenceAdapter ?? new MemoryPersistenceAdapter();
    this.persistence = new PersistenceCoordinator(adapter, {
      schemaVersion: options.persistenceSchemaVersion ?? 1,
      maxPayloadBytes: options.persistenceMaxPayloadBytes ?? 1_000_000,
    });
  }

  get state(): RuntimeOperationsState {
    return this.#state;
  }

  registerService(service: ServiceLifecycle): string {
    this.#assertMutable("registerService");
    return this.services.register(service);
  }

  registerCommand<P, R>(definition: CommandDefinition<P, R>): string {
    this.#assertMutable("registerCommand");
    return this.commands.register(definition);
  }

  registerSection<T>(section: RuntimeStateSection<T>): void {
    this.#assertMutable("registerSection");
    if (!section.key.trim() || section.key.length > 128 || this.#sections.has(section.key)) {
      throw new RuntimeFault("CONFLICT", "Runtime persistence section key is invalid or duplicated", "runtimeOperations.registerSection");
    }
    if (this.#sections.size >= this.#maxStateSections) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Runtime persistence section capacity is full", "runtimeOperations.registerSection", {
        details: { maxStateSections: this.#maxStateSections },
      });
    }
    this.#sections.set(section.key, Object.freeze({ ...section }) as RuntimeStateSection<unknown>);
  }

  enqueueWork<T>(definition: WorkDefinition<T>): OutcomeReceipt<T> {
    this.#assertOperational("enqueueWork");
    return this.scheduler.enqueue(definition, this.clock.tick);
  }

  async start(signal?: AbortSignal): Promise<Outcome<RuntimeOperationsSnapshot>> {
    if (this.#state !== "cold" && this.#state !== "stopped" && this.#state !== "failed") {
      return fail(new RuntimeFault("CONFLICT", "Runtime cannot start from its current state", "runtimeOperations.start", {
        details: { state: this.#state },
      }));
    }
    if (this.#state === "stopped") this.clock.resume();
    this.#state = "starting";
    this.#emit("runtime", "info", "startup-begin", { component: "r45", operation: "start" });
    try {
      await this.services.startAll(signal);
      this.#state = "running";
      this.#emit("runtime", "info", "startup-complete", { component: "r45", operation: "start", count: this.services.records().length });
      return succeed(this.snapshot());
    } catch (error) {
      const fault = normalizeError(error, "runtimeOperations.start");
      this.#state = "failed";
      this.diagnostics.recordIncident({
        tick: this.clock.tick, component: "runtime", code: fault.code, severity: "critical", message: fault.message,
      });
      this.#emit("runtime", "critical", "startup-failed", { component: "r45", operation: "start", code: fault.code });
      return fail(fault);
    }
  }

  frame(realDeltaMs: number, metrics: RuntimeFrameMetrics = {}): RuntimeFrameReport {
    this.#assertOperational("frame");
    if (this.#state !== "running" && this.#state !== "degraded") {
      throw new RuntimeFault("UNAVAILABLE", "Runtime must be running before frames can advance", "runtimeOperations.frame", {
        details: { state: this.#state },
      });
    }
    const clock = this.clock.advance(realDeltaMs);
    this.#frameNumber += 1;
    const work: WorkReceipt[] = [];
    for (let offset = 1; offset <= clock.steps; offset += 1) {
      const tick = clock.tickBefore + offset;
      work.push(...this.scheduler.pump(tick, this.quality.profile.simulationTaskBudget));
    }
    const qualitySample: RuntimePressureSample = {
      tick: this.#frameNumber,
      frameMs: metrics.frameMs ?? realDeltaMs,
      ...(metrics.inputLatencyMs === undefined ? {} : { inputLatencyMs: metrics.inputLatencyMs }),
      ...(metrics.memoryBytes === undefined ? {} : { memoryBytes: metrics.memoryBytes }),
      ...(metrics.networkRttMs === undefined ? {} : { networkRttMs: metrics.networkRttMs }),
      ...(metrics.taskQueueDepth === undefined ? { taskQueueDepth: this.scheduler.stats().queued ?? 0 } : { taskQueueDepth: metrics.taskQueueDepth }),
      ...(metrics.assetQueueDepth === undefined ? {} : { assetQueueDepth: metrics.assetQueueDepth }),
      ...(metrics.droppedFrames === undefined ? {} : { droppedFrames: metrics.droppedFrames }),
      ...(metrics.frameBudgetMs === undefined ? {} : { frameBudgetMs: metrics.frameBudgetMs }),
    };
    let quality: QualityDecision | null = null;
    try {
      quality = this.quality.observe(qualitySample);
      if (quality) {
        this.#emit("quality", "warn", "quality-transition", {
          component: "r45", operation: "quality.observe", quality: quality.current, reason: quality.reasons.join(","),
        });
      }
    } catch (error) {
      const fault = normalizeError(error, "runtimeOperations.quality");
      this.diagnostics.recordIncident({
        tick: this.clock.tick, component: "quality", code: fault.code, severity: "error", message: fault.message,
      });
      this.#state = "degraded";
    }

    this.#lastFrameTick = this.clock.tick;
    if (clock.discardedSimulationMs > 0 || clock.discardedRealMs > 0) {
      this.diagnostics.recordIncident({
        tick: this.clock.tick, component: "clock", code: "TIME_BUDGET_EXCEEDED", severity: "warning",
        message: "Clock discarded excess time to protect bounded catch-up",
        fingerprintData: { discardedRealMs: clock.discardedRealMs, discardedSimulationMs: clock.discardedSimulationMs },
      });
    }
    if (clock.callbackFaults.length > 0) {
      for (const callbackFault of clock.callbackFaults) {
        this.diagnostics.recordIncident({
          tick: this.clock.tick, component: "clock", code: "TIMER_CALLBACK_FAILED", severity: "error",
          message: callbackFault.message, fingerprintData: callbackFault.timerId,
        });
      }
    }
    if (work.some((receipt) => receipt.status === "failed")) {
      this.#emit("scheduler", "error", "work-failed", { component: "r45", operation: "scheduler.pump", count: work.filter((receipt) => receipt.status === "failed").length });
    }
    return Object.freeze({ frameNumber: this.#frameNumber, clock, work: Object.freeze(work), quality, state: this.#state });
  }

  dispatch<R = unknown>(
    name: string,
    payload: unknown,
    principal: CommandPrincipal,
    requestId: string,
    idempotencyKey?: string,
  ): CommandReceipt<R> {
    this.#assertOperational("dispatch");
    if (this.#state !== "running" && this.#state !== "degraded") {
      throw new RuntimeFault("UNAVAILABLE", "Commands are unavailable while runtime is not running", "runtimeOperations.dispatch");
    }
    const receipt = this.commands.dispatch<R>(name, payload, principal, {
      tick: this.clock.tick,
      requestId,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    if (receipt.status === "rejected" || receipt.status === "failed") {
      this.diagnostics.recordIncident({
        tick: this.clock.tick,
        component: "command-gateway",
        code: receipt.fault?.code ?? "COMMAND_FAILED",
        severity: "warning",
        message: receipt.fault?.message ?? "Command was not accepted",
        fingerprintData: { command: receipt.command, principalId: receipt.principalId },
      });
    }
    this.#emit("command", receipt.status === "accepted" || receipt.status === "replayed" ? "info" : "warn", "command-result", {
      component: "r45", operation: "dispatch", status: receipt.status, code: receipt.command,
    });
    return receipt;
  }

  async save(key: string): Promise<Outcome<SaveReceipt>> {
    this.#assertOperational("save");
    const sections: Record<string, unknown> = {};
    try {
      for (const sectionKey of [...this.#sections.keys()].sort()) {
        const section = this.#sections.get(sectionKey);
        if (!section) continue;
        sections[sectionKey] = section.capture();
      }
      const body = {
        format: "aapw-runtime-r45" as const,
        runtimeTick: this.clock.tick,
        frameNumber: this.#frameNumber,
        sections,
      };
      const payload: RuntimeSavePayload = Object.freeze({ ...body, fingerprint: stableFingerprint(body) });
      const result = await this.persistence.save(key, payload, this.clock.tick);
      if (!result.ok) {
        this.#emit("persistence", "error", "save-failed", { component: "r45", operation: "save", code: result.error.code });
        return result;
      }
      this.#emit("persistence", "info", "save-complete", { component: "r45", operation: "save", revision: result.value.revision, bytes: result.value.bytes });
      return result;
    } catch (error) {
      const fault = normalizeError(error, "runtimeOperations.save");
      this.diagnostics.recordIncident({
        tick: this.clock.tick, component: "persistence", code: fault.code, severity: "error", message: fault.message,
      });
      return fail(fault);
    }
  }

  async load(key: string): Promise<Outcome<LoadReceipt<RuntimeSavePayload>>> {
    this.#assertOperational("load");
    const loaded = await this.persistence.load<RuntimeSavePayload>(key, isRuntimeSavePayload);
    if (!loaded.ok) return loaded;
    const payload = loaded.value.value;
    const body = {
      format: payload.format,
      runtimeTick: payload.runtimeTick,
      frameNumber: payload.frameNumber,
      sections: payload.sections,
    };
    if (stableFingerprint(body) !== payload.fingerprint) {
      return fail(new RuntimeFault("INTEGRITY_FAILURE", "Runtime save fingerprint is invalid", "runtimeOperations.load"));
    }
    const before = new Map<string, unknown>();
    const restored: string[] = [];
    try {
      for (const [sectionKey, section] of this.#sections) before.set(sectionKey, section.capture());
      for (const sectionKey of Object.keys(payload.sections).sort()) {
        const section = this.#sections.get(sectionKey);
        if (!section) continue;
        const value = payload.sections[sectionKey];
        if (!section.validate(value)) {
          throw new RuntimeFault("INTEGRITY_FAILURE", "Saved section failed its schema contract", "runtimeOperations.load", {
            details: { section: sectionKey },
          });
        }
        await section.restore(value);
        restored.push(sectionKey);
      }
      this.#emit("persistence", "info", "load-complete", { component: "r45", operation: "load", revision: loaded.value.revision });
      return loaded;
    } catch (error) {
      const fault = normalizeError(error, "runtimeOperations.load");
      for (const sectionKey of restored.reverse()) {
        const section = this.#sections.get(sectionKey);
        const oldValue = before.get(sectionKey);
        if (!section || oldValue === undefined) continue;
        try {
          if (section.validate(oldValue)) await section.restore(oldValue);
        } catch (rollbackError) {
          const rollbackFault = normalizeError(rollbackError, "runtimeOperations.load.rollback");
          this.diagnostics.recordIncident({
            tick: this.clock.tick, component: "persistence-rollback", code: rollbackFault.code, severity: "critical",
            message: rollbackFault.message, fingerprintData: sectionKey,
          });
          this.#state = "degraded";
        }
      }
      this.diagnostics.recordIncident({
        tick: this.clock.tick, component: "persistence", code: fault.code, severity: "error", message: fault.message,
      });
      return fail(fault);
    }
  }

  async shutdown(signal?: AbortSignal): Promise<Outcome<RuntimeOperationsSnapshot>> {
    if (this.#state === "stopped") return succeed(this.snapshot());
    if (this.#state !== "running" && this.#state !== "degraded" && this.#state !== "failed") {
      return fail(new RuntimeFault("CONFLICT", "Runtime cannot shut down from its current state", "runtimeOperations.shutdown", {
        details: { state: this.#state },
      }));
    }
    this.#state = "stopping";
    this.clock.pause();
    this.#emit("runtime", "info", "shutdown-begin", { component: "r45", operation: "shutdown" });
    try {
      await this.services.stopAll(signal);
      this.#state = "stopped";
      this.#emit("runtime", "info", "shutdown-complete", { component: "r45", operation: "shutdown" });
      return succeed(this.snapshot());
    } catch (error) {
      const fault = normalizeError(error, "runtimeOperations.shutdown");
      this.#state = "degraded";
      this.diagnostics.recordIncident({
        tick: this.clock.tick, component: "runtime", code: fault.code, severity: "error", message: fault.message,
      });
      return fail(fault);
    }
  }

  snapshot(): RuntimeOperationsSnapshot {
    return Object.freeze({
      state: this.#state,
      tick: this.clock.tick,
      frameNumber: this.#frameNumber,
      services: this.services.snapshot(),
      scheduler: this.scheduler.stats(),
      commands: this.commands.stats(),
      telemetry: this.telemetry.snapshot(),
      quality: this.quality.snapshot(),
      diagnostics: this.diagnostics.summary(),
    });
  }

  #assertMutable(operation: string): void {
    if (this.#state === "starting" || this.#state === "running" || this.#state === "degraded" || this.#state === "stopping") {
      throw new RuntimeFault("CONFLICT", "Runtime registrations are frozen after startup", "runtimeOperations." + operation);
    }
  }

  #assertOperational(operation: string): void {
    if (this.#state === "stopping" || this.#state === "stopped") {
      throw new RuntimeFault("UNAVAILABLE", "Runtime is no longer accepting work", "runtimeOperations." + operation);
    }
  }

  #emit(category: string, severity: TelemetryInput["severity"], event: string, fields: NonNullable<TelemetryInput["fields"]>): void {
    this.telemetry.emit({ tick: this.clock.tick, category, severity, event, fields });
  }
}

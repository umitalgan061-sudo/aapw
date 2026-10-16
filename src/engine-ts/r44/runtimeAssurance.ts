/**
 * R44 composition root: a small typed control plane for runtime health and lifecycle.
 *
 * It does not take over the renderer or simulation loop. The host calls the
 * explicit observation methods at chosen frame boundaries and uses the resulting
 * report to decide how much work to schedule and which optional features to gate.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44JsonValue,
  type R44PressureLevel,
  type R44RuntimePhase,
  r44FiniteInteger,
  r44NormalizeId,
} from "./contracts.js";
import { R44EventLedger } from "./eventLedger.js";
import { R44FeatureGateRegistry } from "./featureGates.js";
import { R44IncidentSupervisor, r44IncidentFromError } from "./incidentSupervisor.js";
import { R44PerformanceGovernor, type R44PerformanceGovernorOptions, type R44PerformanceReport, type R44PerformanceSample } from "./performanceGovernor.js";
import { R44ResourceLeaseRegistry, R44ResourceScope, type R44DisposeReport } from "./resourceScope.js";
import { R44TaskScheduler, type R44DrainReport, type R44TaskSpec } from "./taskScheduler.js";

export interface R44RuntimeAssuranceOptions {
  readonly id: string;
  readonly initialTick?: number;
  readonly ledgerCapacity?: number;
  readonly performance?: R44PerformanceGovernorOptions;
  readonly schedulerCapacity?: number;
  readonly leaseCapacity?: number;
  readonly leaseMemoryBytes?: number;
}

export interface R44RuntimeAssuranceReport {
  readonly id: string;
  readonly phase: R44RuntimePhase;
  readonly tick: number;
  readonly performance: R44PerformanceReport;
  readonly incidents: ReturnType<R44IncidentSupervisor["snapshot"]>;
  readonly scheduler: Readonly<Record<string, number>>;
  readonly resources: ReturnType<R44ResourceLeaseRegistry["diagnostics"]>;
  readonly ledger: Readonly<Record<string, R44JsonValue>>;
  readonly gates: Readonly<Record<string, R44JsonValue>>;
  readonly readiness: R44ReadinessReport;
}

export interface R44ReadinessCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly severity: "warning" | "error";
  readonly message: string;
}

export interface R44ReadinessReport {
  readonly ready: boolean;
  readonly checks: readonly R44ReadinessCheck[];
  readonly checkedAtTick: number;
}

export interface R44RuntimeHook {
  readonly id: string;
  readonly onPhase?: (phase: R44RuntimePhase, tick: number) => void;
  readonly onPressure?: (state: R44PressureLevel, tick: number) => void;
  readonly dispose?: () => void | Promise<void>;
}

const R44_PHASE_TRANSITIONS: Readonly<Record<R44RuntimePhase, readonly R44RuntimePhase[]>> = Object.freeze({
  created: ["starting", "failed", "stopped", "stopping"],
  starting: ["running", "degraded", "failed", "stopping"],
  running: ["degraded", "stopping", "failed"],
  degraded: ["running", "stopping", "failed"],
  stopping: ["stopped", "failed"],
  stopped: [],
  failed: ["stopping", "stopped"],
});

export class R44RuntimeAssurance {
  readonly id: string;
  readonly ledger: R44EventLedger;
  readonly performance: R44PerformanceGovernor;
  readonly incidents: R44IncidentSupervisor;
  readonly scheduler: R44TaskScheduler;
  readonly resources: R44ResourceLeaseRegistry;
  readonly rootScope: R44ResourceScope;
  readonly gates: R44FeatureGateRegistry;
  readonly #hooks = new Map<string, R44RuntimeHook>();
  #phase: R44RuntimePhase = "created";
  #tick: number;
  #lastPressure: R44PressureLevel = "nominal";
  #disposed = false;

  constructor(options: R44RuntimeAssuranceOptions) {
    this.id = r44NormalizeId(options.id, "runtime id", 128);
    this.#tick = r44FiniteInteger(options.initialTick ?? 0, "initialTick", 0);
    this.ledger = new R44EventLedger({ capacity: options.ledgerCapacity ?? 8192 });
    this.performance = new R44PerformanceGovernor(options.performance);
    this.incidents = new R44IncidentSupervisor();
    this.scheduler = new R44TaskScheduler({ capacity: options.schedulerCapacity ?? 10_000 });
    this.resources = new R44ResourceLeaseRegistry({
      maxLeases: options.leaseCapacity ?? 20_000,
      maxEstimatedBytes: options.leaseMemoryBytes ?? 2048 * 1024 * 1024,
    });
    this.rootScope = new R44ResourceScope(this.id + ":root", {
      tick: this.#tick,
      onFailure: (failure) => {
        this.incidents.report({
          subsystem: "resource",
          code: failure.code,
          message: failure.message,
          severity: "error",
          tick: this.#tick,
          recoverable: true,
        });
      },
    });
    this.gates = new R44FeatureGateRegistry();
    this.#record("assurance.created", { id: this.id, phase: this.#phase });
  }

  get phase(): R44RuntimePhase { return this.#phase; }
  get tick(): number { return this.#tick; }

  start(tickInput = this.#tick): void {
    if (this.#phase !== "created") throw new R44InvariantError("runtime-start-state", "Runtime can only be started once", { phase: this.#phase });
    const tick = r44FiniteInteger(tickInput, "tick", this.#tick);
    this.transition("starting", tick);
    this.transition("running", tick);
  }

  transition(next: R44RuntimePhase, tickInput: number): void {
    const tick = r44FiniteInteger(tickInput, "tick", this.#tick);
    const allowed = R44_PHASE_TRANSITIONS[this.#phase];
    if (!allowed.includes(next)) {
      throw new R44InvariantError("runtime-transition-invalid", "Invalid runtime phase transition", {
        from: this.#phase,
        to: next,
      });
    }
    const prior = this.#phase;
    this.#tick = tick;
    this.#phase = next;
    this.ledger.append({
      kind: "runtime.phase",
      source: this.id,
      tick,
      payload: { from: prior, to: next },
    });
    this.rootScope.advance(tick);
    this.resources.advance(tick);
    this.gates.advance(tick);
    for (const hook of this.#hooks.values()) {
      try { hook.onPhase?.(next, tick); } catch (error) {
        this.incidents.report(r44IncidentFromError("runtime-hook", error, tick, "warning"));
      }
    }
  }

  observePerformance(sample: R44PerformanceSample): R44PerformanceReport {
    this.#assertActive();
    if (sample.tick < this.#tick) throw new R44BoundaryError("runtime-tick-regression", "Performance tick precedes runtime tick");
    this.#tick = sample.tick;
    const report = this.performance.sample(sample);
    this.resources.advance(sample.tick);
    this.gates.advance(sample.tick);
    this.#record("performance.sample", {
      tick: sample.tick,
      score: report.score,
      state: report.state,
      health: report.health,
      exceededBudgets: [...report.exceededBudgets],
    });
    if (report.state !== "nominal" && report.state !== this.#lastPressure) {
      const severity = report.state === "emergency" ? "fatal" : report.state === "constrained" ? "error" : "warning";
      this.incidents.report({
        subsystem: "performance",
        code: "pressure-" + report.state,
        message: "Runtime performance pressure changed to " + report.state,
        severity,
        tick: sample.tick,
        recoverable: report.state !== "emergency",
        details: { score: report.score, exceeded: [...report.exceededBudgets] },
      });
    } else if (report.state === "nominal" && this.#lastPressure !== "nominal") {
      this.incidents.resolveBySubsystem("performance");
      this.#record("performance.recovered", { tick: sample.tick, score: report.score });
    }
    this.#lastPressure = report.state;
    if (report.state === "emergency" && this.#phase === "running") this.transition("degraded", sample.tick);
    if (report.state === "nominal" && this.#phase === "degraded") this.transition("running", sample.tick);
    for (const hook of this.#hooks.values()) {
      try { hook.onPressure?.(report.state, sample.tick); } catch (error) {
        this.incidents.report(r44IncidentFromError("runtime-hook", error, sample.tick, "warning"));
      }
    }
    return report;
  }

  submitTask<T>(spec: R44TaskSpec<T>): Readonly<{ id: string; deduplicated: boolean }> {
    this.#assertActive();
    if (spec.createdTick < this.#tick) throw new R44BoundaryError("task-tick-stale", "Cannot submit task from an earlier tick");
    const result = this.scheduler.submit(spec);
    this.#record("task.submitted", { id: result.id, key: spec.key, owner: spec.owner, lane: spec.lane });
    return result;
  }

  drainTasks(input: { tick?: number; budgetUnits?: number; maxTasks?: number } = {}): R44DrainReport {
    this.#assertActive();
    const tick = r44FiniteInteger(input.tick ?? this.#tick, "tick", this.#tick);
    this.#tick = tick;
    const report = this.scheduler.drain({ ...input, tick });
    this.#record("task.drain", report as unknown as R44JsonValue);
    if (report.failed > 0) {
      this.incidents.report({
        subsystem: "scheduler",
        code: "task-failures",
        message: "One or more scheduled tasks failed",
        severity: "warning",
        tick,
        details: { failed: report.failed, executed: report.executed },
      });
    }
    return report;
  }

  registerHook(hook: R44RuntimeHook): () => void {
    this.#assertActive();
    const id = r44NormalizeId(hook.id, "hook id", 128);
    if (this.#hooks.has(id)) throw new R44InvariantError("runtime-hook-duplicate", "Runtime hook already registered", { id });
    this.#hooks.set(id, hook);
    return () => this.#hooks.delete(id);
  }

  readiness(): R44ReadinessReport {
    const checks: R44ReadinessCheck[] = [];
    const ledger = this.ledger.verify();
    checks.push(Object.freeze({
      id: "ledger-integrity",
      passed: ledger.valid,
      severity: "error",
      message: ledger.valid ? "Event ledger integrity is valid" : "Ledger integrity check failed",
    }));
    const perf = this.performance.report();
    checks.push(Object.freeze({
      id: "performance-pressure",
      passed: perf.state !== "emergency",
      severity: "error",
      message: "Performance state is " + perf.state,
    }));
    const incidents = this.incidents.snapshot();
    const fatal = incidents.active.filter((incident) => incident.severity === "fatal").length;
    checks.push(Object.freeze({
      id: "fatal-incidents",
      passed: fatal === 0,
      severity: "error",
      message: fatal === 0 ? "No active fatal incidents" : fatal + " active fatal incidents",
    }));
    const resources = this.resources.diagnostics();
    checks.push(Object.freeze({
      id: "resource-capacity",
      passed: resources.activeLeases < resources.capacity && resources.estimatedBytes < resources.byteCapacity,
      severity: "warning",
      message: resources.activeLeases + " resource leases; " + resources.estimatedBytes + " estimated bytes",
    }));
    checks.push(Object.freeze({
      id: "phase",
      passed: this.#phase === "running" || this.#phase === "degraded",
      severity: "error",
      message: "Runtime phase is " + this.#phase,
    }));
    return Object.freeze({
      ready: checks.every((check) => check.passed || check.severity === "warning"),
      checks: Object.freeze(checks),
      checkedAtTick: this.#tick,
    });
  }

  report(): R44RuntimeAssuranceReport {
    return Object.freeze({
      id: this.id,
      phase: this.#phase,
      tick: this.#tick,
      performance: this.performance.report(),
      incidents: this.incidents.snapshot(),
      scheduler: this.scheduler.stats(),
      resources: this.resources.diagnostics(),
      ledger: this.ledger.snapshot() as unknown as Readonly<Record<string, R44JsonValue>>,
      gates: this.gates.snapshot(this.id),
      readiness: this.readiness(),
    });
  }

  verify(): Readonly<{ passed: boolean; failures: readonly string[] }> {
    const failures: string[] = [];
    if (!this.ledger.verify().valid) failures.push("ledger-integrity");
    if (this.phase === "failed") failures.push("runtime-failed");
    if (this.performance.state === "emergency") failures.push("performance-emergency");
    if (this.incidents.snapshot().active.some((incident) => incident.severity === "fatal")) failures.push("fatal-incident");
    return Object.freeze({ passed: failures.length === 0, failures: Object.freeze(failures) });
  }

  async shutdown(tickInput = this.#tick): Promise<R44DisposeReport> {
    if (this.#phase === "stopped" && !this.#disposed) {
      this.#disposed = true;
      return this.rootScope.disposeDetailed();
    }
    if (this.#disposed) {
      const report = this.rootScope.report;
      if (report !== null) return report;
    }
    const tick = r44FiniteInteger(tickInput, "tick", this.#tick);
    if (this.#phase !== "stopping" && this.#phase !== "stopped") this.transition("stopping", tick);
    this.#disposed = true;
    this.scheduler.cancelAll(tick);
    const hookDisposals = [...this.#hooks.values()].reverse();
    this.#hooks.clear();
    for (const hook of hookDisposals) {
      try { await hook.dispose?.(); } catch (error) {
        this.incidents.report(r44IncidentFromError("runtime-hook", error, tick, "warning"));
      }
    }
    const leaseFailures = await this.resources.disposeAll();
    for (const failure of leaseFailures) {
      this.incidents.report({
        subsystem: "resource",
        code: failure.code,
        message: failure.message,
        severity: "error",
        tick,
      });
    }
    const disposeReport = await this.rootScope.disposeDetailed();
    if (disposeReport.failures.length > 0 || leaseFailures.length > 0) this.transition("failed", tick);
    else this.transition("stopped", tick);
    this.#record("assurance.shutdown", { tick, phase: this.#phase, leaseFailures: leaseFailures.length });
    return disposeReport;
  }

  #record(kind: string, payload: R44JsonValue): void {
    this.ledger.append({ kind, source: this.id, tick: this.#tick, payload });
  }

  #assertActive(): void {
    if (this.#disposed || (this.#phase !== "running" && this.#phase !== "degraded")) {
      throw new R44InvariantError("runtime-not-active", "Runtime service is not active", { phase: this.#phase, disposed: this.#disposed });
    }
  }
}

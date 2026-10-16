import {
  clamp,
  err,
  ok,
  stableDigest,
  stableStringify,
  type Result,
  type Severity,
} from "./contracts.ts";
import { FrameBudgetArbiter, type BudgetDrainReport, type BudgetTask } from "./budget.ts";
import { RuntimeLifecycle, type LifecycleReport, type RuntimeService } from "./lifecycle.ts";
import { HashChainJournal, type JournalRecord } from "./journal.ts";
import {
  BoundaryValidator,
  CapabilityAuthority,
  ReplayGuard,
  SlidingWindowLimiter,
  type CapabilityDescriptor,
  type CapabilityToken,
  type DataSchema,
} from "./security.ts";
import { AssetPipeline, type AssetProvider, type AssetRequest, type AssetRecord, type AssetPolicy } from "./assets.ts";
import { TelemetryHub, MetricAnomalyDetector } from "./telemetry.ts";
import {
  CircuitBreaker,
  DiagnosticBuffer,
  RuntimeHealthGate,
  type DiagnosticEvent,
  type HealthDecision,
} from "./diagnostics.ts";
import { SessionTimeline, type SessionInput } from "./session.ts";

export interface CommandContext {
  readonly commandId: string;
  readonly name: string;
  readonly sequence: number;
  readonly scope: string;
  readonly frame: number;
  readonly signal: AbortSignal;
}

export interface CommandDefinition<T = unknown> {
  readonly name: string;
  readonly scope?: string;
  readonly permission: string;
  readonly schema: DataSchema;
  readonly lane?: string;
  readonly priority?: 0 | 1 | 2 | 3 | 4;
  readonly costMs?: number;
  readonly execute: (payload: T, context: CommandContext) => unknown;
}

export interface CommandRequest {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly sequence: number;
  readonly frame: number;
  readonly nowMs: number;
  readonly payload: unknown;
  readonly capability?: CapabilityToken;
}

export interface RuntimeFrameReport {
  readonly frame: number;
  readonly budget: BudgetDrainReport;
  readonly health: HealthDecision;
  readonly queueDepth: number;
  readonly journalSequence: number;
  readonly digest: string;
  readonly diagnostics: readonly DiagnosticEvent[];
}

export interface R44RuntimeOptions {
  readonly maxCommands?: number;
  readonly maxFrameBudgetMs?: number;
  readonly journalCapacity?: number;
  readonly telemetryCapacity?: number;
  readonly diagnosticCapacity?: number;
  readonly assetPolicy?: Partial<AssetPolicy>;
  readonly assetProvider?: AssetProvider<unknown>;
  readonly now?: () => number;
}

/**
 * Production governance facade for R43. It owns one admission boundary for
 * commands, a deterministic frame-work queue, subsystem lifecycle, audit
 * journal, scoped capabilities, session replay protection, and bounded metrics.
 */
export class R44Runtime {
  readonly budget: FrameBudgetArbiter;
  readonly lifecycle: RuntimeLifecycle;
  readonly journal: HashChainJournal<unknown, unknown>;
  readonly validator: BoundaryValidator;
  readonly capabilities = new CapabilityAuthority();
  readonly replayGuard = new ReplayGuard({ capacity: 16_384, ttlMs: 120_000 });
  readonly limiter = new SlidingWindowLimiter({ limit: 120, windowMs: 1000, maxKeys: 4096, maxEventsPerKey: 512 });
  readonly assets: AssetPipeline<unknown>;
  readonly telemetry: TelemetryHub;
  readonly diagnostics: DiagnosticBuffer;
  readonly healthGate = new RuntimeHealthGate();
  readonly commandBreaker: CircuitBreaker;
  readonly now: () => number;

  #commands = new Map<string, CommandDefinition<unknown>>();
  #sessions = new Map<string, SessionTimeline<unknown>>();
  #maxFrameBudgetMs: number;
  #maxCommands: number;
  #frame = -1;
  #started = false;
  #disposed = false;
  #frameAnomaly = new MetricAnomalyDetector({ minSamples: 20, warmupSamples: 20, sigmaThreshold: 4, cooldownFrames: 120 });

  constructor(options: R44RuntimeOptions = {}) {
    this.now = options.now ?? (() => typeof performance !== "undefined" ? performance.now() : 0);
    this.#maxFrameBudgetMs = Math.max(0.1, options.maxFrameBudgetMs ?? 16.67);
    this.#maxCommands = Math.max(1, Math.trunc(options.maxCommands ?? 4096));
    this.budget = new FrameBudgetArbiter({ maxPending: this.#maxCommands, clock: { now: this.now } });
    for (const lane of [
      { id: "critical", weight: 8, reserveMs: 0.5, maxQueue: 512 },
      { id: "simulation", weight: 6, reserveMs: 1.5, maxQueue: 1024 },
      { id: "network", weight: 4, reserveMs: 0.5, maxQueue: 512 },
      { id: "render", weight: 3, reserveMs: 1.5, maxQueue: 1024 },
      { id: "assets", weight: 2, reserveMs: 0, maxQueue: 1024 },
      { id: "background", weight: 1, reserveMs: 0, maxQueue: 1024 },
    ]) {
      const result = this.budget.registerLane(lane);
      if (!result.ok) throw new Error(result.error.message);
    }
    this.lifecycle = new RuntimeLifecycle({ now: this.now });
    this.journal = new HashChainJournal({ capacity: options.journalCapacity ?? 8192, checkpointCapacity: 64 });
    this.validator = new BoundaryValidator({ maxPayloadBytes: 256 * 1024, maxDepth: 40, maxNodes: 30_000 });
    this.assets = new AssetPipeline(
      options.assetProvider ?? (async () => { throw new Error("No asset provider was configured."); }),
      options.assetPolicy,
      { now: this.now },
    );
    this.telemetry = new TelemetryHub({ capacity: options.telemetryCapacity ?? 8192, maxMetricNames: 512 });
    this.diagnostics = new DiagnosticBuffer({ capacity: options.diagnosticCapacity ?? 2048 });
    this.commandBreaker = new CircuitBreaker("command-dispatch", { failureThreshold: 8, successThreshold: 2, openDurationMs: 2000 });
  }

  get frameNumber(): number {
    return this.#frame;
  }

  get started(): boolean {
    return this.#started;
  }

  registerService<T>(service: RuntimeService<T>): Result<true> {
    if (this.#disposed) return err("R44_DISPOSED", "Runtime has been disposed.");
    return this.lifecycle.register(service);
  }

  registerCommand<T>(definition: CommandDefinition<T>): Result<true> {
    if (this.#disposed) return err("R44_DISPOSED", "Runtime has been disposed.");
    const name = normalizeName(definition.name);
    if (!name) return err("R44_COMMAND_NAME", "Command name must not be empty.");
    if (this.#commands.has(name)) return err("R44_COMMAND_DUPLICATE", "Command name is already registered.", false, { name });
    if (!normalizeName(definition.permission)) return err("R44_PERMISSION_REQUIRED", "Every command requires an explicit permission.");
    const lane = definition.lane ?? "critical";
    const normalized: CommandDefinition<unknown> = Object.freeze({
      ...definition,
      name,
      permission: normalizeName(definition.permission),
      ...(definition.scope === undefined ? {} : { scope: normalizeName(definition.scope) }),
      lane,
      priority: (definition.priority ?? 1) as 0 | 1 | 2 | 3 | 4,
      costMs: Math.max(0.1, definition.costMs ?? 0.25),
      execute: (payload: unknown, context: CommandContext) => definition.execute(payload as T, context),
    });
    if (!this.budget.laneIds().includes(lane)) {
      return err("R44_COMMAND_LANE", "Command references an unknown budget lane.", false, { lane });
    }
    this.#commands.set(name, normalized);
    return ok(true);
  }

  issueCapability(descriptor: CapabilityDescriptor): CapabilityToken {
    return this.capabilities.issue(descriptor);
  }

  async start(): Promise<LifecycleReport> {
    if (this.#disposed) {
      return Object.freeze({
        success: false,
        started: Object.freeze([]),
        stopped: Object.freeze([]),
        failures: Object.freeze([{ serviceId: "$runtime", phase: "start" as const, message: "Runtime has been disposed." }]),
        durationMs: 0,
      });
    }
    if (this.#started) return Object.freeze({ success: true, started: Object.freeze([]), stopped: Object.freeze([]), failures: Object.freeze([]), durationMs: 0 });
    const report = await this.lifecycle.start();
    this.#started = report.success;
    this.#emit("runtime", report.success ? "R44_STARTED" : "R44_START_FAILED", report.success ? "info" : "error", report.success ? "Runtime started." : "Runtime startup failed.", !report.success, { started: report.started.length, failures: report.failures.length });
    this.journal.append({
      type: "runtime.lifecycle.start",
      tick: 0,
      payload: { success: report.success, started: report.started, failures: report.failures.map((failure) => ({ serviceId: failure.serviceId, message: failure.message })) },
      source: "r44",
    });
    return report;
  }

  async stop(reason: "shutdown" | "fault" = "shutdown"): Promise<LifecycleReport> {
    const report = await this.lifecycle.stop(reason);
    this.#started = false;
    this.assets.dispose("runtime stopped");
    this.budget.clear();
    this.journal.append({
      type: "runtime.lifecycle.stop",
      tick: Math.max(0, this.#frame),
      payload: { reason, success: report.success, stopped: report.stopped, failures: report.failures.map((failure) => ({ serviceId: failure.serviceId, message: failure.message })) },
      source: "r44",
    });
    this.#emit("runtime", report.success ? "R44_STOPPED" : "R44_STOP_FAILED", report.success ? "info" : "error", "Runtime shutdown completed.", !report.success, { stopped: report.stopped.length, failures: report.failures.length });
    return report;
  }

  submitCommand(request: CommandRequest): Result<string> {
    if (!this.#started) return err("R44_NOT_STARTED", "Commands are only accepted after runtime startup.");
    if (this.#disposed) return err("R44_DISPOSED", "Runtime has been disposed.");
    const id = normalizeName(request.id);
    const name = normalizeName(request.name);
    const scope = normalizeName(request.scope);
    if (!id || !name || !scope) return err("R44_COMMAND_FIELDS", "Command id, name, and scope are required.");
    if (!Number.isSafeInteger(request.sequence) || request.sequence < 1) return err("R44_COMMAND_SEQUENCE", "Command sequence must be a positive safe integer.");
    if (!Number.isSafeInteger(request.frame) || request.frame < this.#frame) return err("R44_COMMAND_FRAME", "Command frame is stale or invalid.");
    const definition = this.#commands.get(name);
    if (!definition) return err("R44_COMMAND_UNKNOWN", "Command is not registered.", false, { name });
    if (definition.scope && definition.scope !== scope) return err("R44_COMMAND_SCOPE", "Command scope is not allowed.");
    if (!this.capabilities.authorize(request.capability, scope, definition.permission, request.nowMs)) {
      this.#emit("security", "R44_CAPABILITY_DENIED", "warning", "Command capability was denied.", false, { name, scope });
      return err("R44_CAPABILITY_DENIED", "Capability does not grant this command.");
    }
    const limit = this.limiter.consume(scope + ":" + name, request.nowMs, 1);
    if (!limit.allowed) {
      this.#emit("security", "R44_RATE_LIMIT", "warning", "Command rate limit exceeded.", true, { name, retryAfterMs: limit.retryAfterMs });
      return err("R44_RATE_LIMIT", "Command rate limit exceeded.", true, { retryAfterMs: limit.retryAfterMs });
    }
    const nonce = "command:" + scope + ":" + name + ":" + request.sequence + ":" + id;
    const replay = this.replayGuard.accept(nonce, request.nowMs);
    if (!replay.ok) {
      this.#emit("security", "R44_REPLAY_REJECTED", "warning", "Duplicate command nonce was rejected.", false, { name, id });
      return replay;
    }
    const checked = this.validator.validate<unknown>(request.payload, definition.schema);
    if (!checked.ok || !checked.value) {
      this.#emit("security", "R44_PAYLOAD_REJECTED", "warning", "Command payload failed validation.", false, { name });
      return err("R44_PAYLOAD_REJECTED", "Command payload failed boundary validation.", false, { name });
    }
    const frame = Math.max(0, Math.trunc(request.frame));
    const task: BudgetTask = {
      id: "cmd:" + id,
      lane: definition.lane ?? "critical",
      priority: definition.priority ?? 1,
      costMs: definition.costMs ?? 0.25,
      deadlineFrame: frame + 120,
      run: () => {
        const now = Math.max(0, this.now());
        const breaker = this.commandBreaker.canExecute(now);
        if (!breaker.allowed) {
          this.#emit("command", "R44_BREAKER_OPEN", "warning", "Command handler circuit breaker is open.", true, { name, reason: breaker.reason });
          this.journal.append({ type: "command.skipped", tick: frame, id: "cmd:" + id, source: "r44", payload: { id, name, reason: breaker.reason } });
          return;
        }
        const context: CommandContext = Object.freeze({
          commandId: id,
          name,
          sequence: request.sequence,
          scope,
          frame,
          signal: new AbortController().signal,
        });
        try {
          const result = definition.execute(checked.value.value, context);
          if (result && typeof (result as { then?: unknown }).then === "function") {
            throw new Error("Command handlers must be synchronous; enqueue async work in the asset/worker pipeline.");
          }
          let resultDigest = "none";
          try {
            resultDigest = stableDigest(result === undefined ? null : result);
          } catch {
            resultDigest = "non-serializable-result";
          }
          const appended = this.journal.append({
            type: "command.executed",
            tick: frame,
            id: "execution:" + id,
            source: "r44",
            payload: { id, name, scope, sequence: request.sequence, resultDigest },
          });
          if (!appended.ok) this.#emit("journal", "R44_JOURNAL_APPEND_FAILED", "error", appended.error.message, false, { command: name });
          this.telemetry.increment("commands.executed", 1, frame, now);
          this.commandBreaker.recordSuccess();
        } catch (cause) {
          this.commandBreaker.recordFailure(now, cause instanceof Error ? cause.message : String(cause));
          this.journal.append({
            type: "command.failed",
            tick: frame,
            id: "failure:" + id,
            source: "r44",
            payload: { id, name, scope, sequence: request.sequence, reason: cause instanceof Error ? cause.message : String(cause) },
          });
          this.#emit("command", "R44_COMMAND_FAILED", "error", cause instanceof Error ? cause.message : String(cause), true, { name, id });
          this.telemetry.increment("commands.failed", 1, frame, now);
          throw cause;
        }
      },
      metadata: { command: name, scope, sequence: request.sequence },
    };
    const enqueued = this.budget.enqueue(task, frame);
    if (!enqueued.ok) {
      this.#emit("runtime", "R44_COMMAND_QUEUE_REJECTED", "warning", enqueued.error.message, true, { name, id });
      return err("R44_COMMAND_QUEUE_REJECTED", enqueued.error.message, enqueued.error.retryable, { name });
    }
    this.journal.append({
      type: "command.accepted",
      tick: frame,
      id: "accepted:" + id,
      source: "r44",
      payload: { id, name, scope, sequence: request.sequence, frame },
    });
    this.telemetry.increment("commands.accepted", 1, frame, Math.max(0, request.nowMs));
    return ok(enqueued.value);
  }

  enqueueWork(task: BudgetTask, frame: number): Result<string> {
    if (!this.#started) return err("R44_NOT_STARTED", "Work is only accepted after runtime startup.");
    return this.budget.enqueue(task, frame);
  }

  runFrame(frame: number, availableMs: number): Result<RuntimeFrameReport> {
    if (!this.#started) return err("R44_NOT_STARTED", "Runtime must be started before running frames.");
    if (!Number.isSafeInteger(frame) || frame <= this.#frame) return err("R44_FRAME_MONOTONIC", "Frame number must increase monotonically.");
    const budgetMs = clamp(Number.isFinite(availableMs) ? availableMs : 0, 0, this.#maxFrameBudgetMs);
    this.#frame = frame;
    const timeMs = Math.max(0, this.now());
    const drain = this.budget.drain(frame, budgetMs);
    this.telemetry.record("frame.budget_ms", budgetMs, frame, timeMs);
    this.telemetry.record("frame.spent_ms", drain.spentMs, frame, timeMs);
    this.telemetry.record("frame.queue_depth", drain.deferred, frame, timeMs);
    this.telemetry.record("frame.dropped_tasks", drain.dropped, frame, timeMs);
    this.telemetry.setGauge("runtime.pending_work", this.budget.pendingCount(), frame, timeMs);
    for (const task of drain.tasks) {
      if (task.state === "failed") this.#emit("budget", "R44_WORK_FAILED", "error", task.error ?? "Budget task failed.", true, { id: task.id, lane: task.lane });
      else if (task.state === "expired") this.#emit("budget", "R44_WORK_EXPIRED", "warning", "Budget task deadline expired.", true, { id: task.id, lane: task.lane });
    }
    const utilization = budgetMs > 0 ? drain.spentMs / budgetMs : drain.spentMs > 0 ? 1 : 0;
    const anomaly = this.#frameAnomaly.observe(drain.spentMs, frame);
    if (anomaly.anomalous) this.#emit("performance", "R44_FRAME_ANOMALY", anomaly.severity === "high" ? "error" : "warning", "Frame work time deviated from its baseline.", true, { zScore: anomaly.zScore, value: anomaly.value });
    const health = this.healthGate.evaluate([
      { key: "frame-budget", score: clamp(100 - utilization * 100, 0, 100), weight: 4, detail: "modeled frame budget consumption" },
      { key: "queue-pressure", score: clamp(100 - drain.deferred / Math.max(1, this.#maxCommands) * 100, 0, 100), weight: 2 },
      { key: "task-failures", score: clamp(100 - drain.tasks.filter((task) => task.state === "failed").length * 12, 0, 100), weight: 3 },
      { key: "task-expiry", score: clamp(100 - drain.dropped * 8, 0, 100), weight: 1 },
    ]);
    this.telemetry.record("health.score", health.score, frame, timeMs);
    const compactTasks = drain.tasks.map((task) => ({
      id: task.id,
      lane: task.lane,
      state: task.state,
      costMs: task.costMs,
      elapsedMs: task.elapsedMs,
      queueWaitFrames: task.queueWaitFrames,
    }));
    this.journal.append({
      type: "runtime.frame",
      tick: frame,
      id: "frame:" + frame,
      source: "r44",
      payload: { frame, budgetMs, spentMs: drain.spentMs, deferred: drain.deferred, dropped: drain.dropped, tasks: compactTasks, healthScore: health.score },
    });
    const diagnostics = this.diagnostics.recent(16, "warning");
    const body = {
      frame,
      budget: drain,
      health,
      queueDepth: this.budget.pendingCount(),
      journalSequence: this.journal.nextSequence - 1,
      diagnostics,
    };
    return ok(Object.freeze({ ...body, digest: stableDigest({
      frame,
      budget: { budgetMs: drain.budgetMs, spentMs: drain.spentMs, executed: drain.executed, deferred: drain.deferred, dropped: drain.dropped },
      health,
      queueDepth: body.queueDepth,
      journalSequence: body.journalSequence,
    }) }));
  }

  session<T>(sessionId: string): SessionTimeline<T> {
    const existing = this.#sessions.get(sessionId);
    if (existing) return existing as SessionTimeline<T>;
    const timeline = new SessionTimeline<T>(sessionId);
    this.#sessions.set(sessionId, timeline as SessionTimeline<unknown>);
    return timeline;
  }

  recordInput<T>(sessionId: string, input: SessionInput<T>, authoritativeTick: number): ReturnType<SessionTimeline<T>["accept"]> {
    return this.session<T>(sessionId).accept(input, authoritativeTick);
  }

  async loadAsset(request: AssetRequest): Promise<Result<AssetRecord<unknown>>> {
    const now = Math.max(0, this.now());
    const breaker = this.#assetBreaker.canExecute(now);
    if (!breaker.allowed) return err("R44_ASSET_BREAKER_OPEN", "Asset provider circuit breaker is open.", true, { retryAfterMs: breaker.retryAfterMs });
    const result = await this.assets.request(request);
    if (result.ok) {
      this.#assetBreaker.recordSuccess();
      this.telemetry.increment("assets.loaded", 1, Math.max(0, this.#frame), now);
    } else {
      this.#assetBreaker.recordFailure(now, result.error.message);
      this.telemetry.increment("assets.failed", 1, Math.max(0, this.#frame), now);
      this.#emit("assets", "R44_ASSET_LOAD_FAILED", "warning", result.error.message, result.error.retryable, { key: request.key });
    }
    return result;
  }

  get assetBreaker(): CircuitBreaker {
    return this.#assetBreaker;
  }

  snapshot(): Readonly<{
    frame: number;
    started: boolean;
    disposed: boolean;
    queuedWork: number;
    journalDigest: string;
    journalSize: number;
    telemetryDigest: string;
    diagnosticCount: number;
    sessions: number;
  }> {
    return Object.freeze({
      frame: this.#frame,
      started: this.#started,
      disposed: this.#disposed,
      queuedWork: this.budget.pendingCount(),
      journalDigest: this.journal.headDigest,
      journalSize: this.journal.size,
      telemetryDigest: this.telemetry.exportSnapshot().digest,
      diagnosticCount: this.diagnostics.recent(this.diagnostics.policy.capacity).length,
      sessions: this.#sessions.size,
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    if (this.#started) await this.stop("shutdown");
    this.#disposed = true;
    this.assets.dispose();
    this.budget.clear();
    this.#commands.clear();
    this.#sessions.clear();
    this.telemetry.increment("runtime.disposed", 1, Math.max(0, this.#frame), Math.max(0, this.now()));
  }

  #emit(
    subsystem: string,
    code: string,
    severity: Severity,
    message: string,
    recoverable: boolean,
    details: Readonly<Record<string, unknown>> = {},
  ): void {
    const timeMs = Math.max(0, this.now());
    this.diagnostics.emit({
      timeMs,
      frame: Math.max(0, this.#frame),
      subsystem,
      code,
      severity,
      message,
      recoverable,
      details,
    });
    this.telemetry.increment("diagnostics." + severity, 1, Math.max(0, this.#frame), timeMs);
  }

  #assetBreaker = new CircuitBreaker("asset-provider", { failureThreshold: 5, successThreshold: 2, openDurationMs: 3000 });
}

function normalizeName(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 128);
}

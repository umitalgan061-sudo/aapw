import {
  type RuntimePhaseV4,
  type RuntimeId,
  type TickId,
  type TraceId,
  type RuntimeErrorV4,
  runtimeId,
  tickId,
  traceId,
  createRuntimeErrorV4,
  clampV4,
  type OutcomeV4,
  okV4,
  failV4,
} from './runtimeContractsV4';

export type KernelPhaseV5 = RuntimePhaseV4 | 'degraded' | 'hibernating';
export type KernelPriorityV5 = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type KernelSubsystemV5 = 'input' | 'simulation' | 'ecs' | 'world' | 'network' | 'assets' | 'audio' | 'render' | 'save' | 'telemetry';

export interface KernelClockV5 {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface KernelBudgetV5 {
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly networkBytes: number;
  readonly assetBytes: number;
  readonly commands: number;
  readonly entities: number;
}

export interface KernelSubsystemV5<TContext = KernelContextV5> {
  readonly name: string;
  readonly subsystem: KernelSubsystemV5;
  readonly priority: KernelPriorityV5;
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly maxMs: number;
  readonly run: (context: TContext) => void | Promise<void>;
  readonly canRun?: (context: TContext) => boolean;
  readonly recover?: (error: RuntimeErrorV4, context: TContext) => void | Promise<void>;
}

export interface KernelContextV5 {
  readonly runtime: RuntimeId;
  readonly phase: KernelPhaseV5;
  readonly tick: TickId;
  readonly trace: TraceId;
  readonly frame: number;
  readonly deltaMs: number;
  readonly budget: KernelBudgetV5;
}

export interface KernelExecutionV5 {
  readonly subsystem: KernelSubsystemV5;
  readonly name: string;
  readonly tick: TickId;
  readonly durationMs: number;
  readonly skipped: boolean;
  readonly degraded: boolean;
  readonly error: RuntimeErrorV4 | null;
}

export interface KernelFrameReportV5 {
  readonly frame: number;
  readonly tick: TickId;
  readonly phase: KernelPhaseV5;
  readonly deltaMs: number;
  readonly droppedDeltaMs: number;
  readonly executions: readonly KernelExecutionV5[];
  readonly errors: number;
  readonly overruns: number;
}

export interface KernelSnapshotV5 {
  readonly version: 5;
  readonly runtime: RuntimeId;
  readonly phase: KernelPhaseV5;
  readonly frame: number;
  readonly tick: TickId;
  readonly createdAt: number;
  readonly checksum: string;
}

export interface KernelMetricsV5 {
  readonly frame: number;
  readonly tick: TickId;
  readonly phase: KernelPhaseV5;
  readonly totalFrames: number;
  readonly totalTicks: number;
  readonly totalErrors: number;
  readonly totalOverruns: number;
  readonly droppedDeltaMs: number;
  readonly averageFrameMs: number;
  readonly worstFrameMs: number;
  readonly degradedFrames: number;
}

export interface KernelOptionsV5 {
  readonly id?: string;
  readonly fixedStepMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaMs?: number;
  readonly defaultBudget?: Partial<KernelBudgetV5>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const priorityRank: Record<KernelPriorityV5, number> = { critical: 100, high: 80, normal: 50, low: 20, background: 0 };
const subsystemOrder: readonly KernelSubsystemV5[] = ['input', 'simulation', 'ecs', 'world', 'network', 'assets', 'audio', 'render', 'save', 'telemetry'];
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const safeMs = (value: number, fallback: number): number => Math.max(0, finite(value, fallback));
const hash = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export class RuntimeKernelV5 {
  readonly id: RuntimeId;
  readonly fixedStepMs: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDeltaMs: number;
  #clock: KernelClockV5;
  #budget: KernelBudgetV5;
  #phase: KernelPhaseV5 = 'boot';
  #subsystems = new Map<string, KernelSubsystemV5>();
  #ordered: KernelSubsystemV5[] = [];
  #frame = 0;
  #tick = 0;
  #accumulator = 0;
  #lastAt = 0;
  #errors = 0;
  #overruns = 0;
  #degradedFrames = 0;
  #droppedDeltaMs = 0;
  #frameDurations: number[] = [];
  #lastReport: KernelFrameReportV5 | null = null;
  #lastSnapshot: KernelSnapshotV5 | null = null;
  #running = false;
  #inFrame = false;

  constructor(options: KernelOptionsV5 = {}) {
    this.id = runtimeId(options.id ?? `runtime-v5-${Date.now()}`);
    this.fixedStepMs = Math.max(1, safeMs(options.fixedStepMs ?? 1000 / 60, 16.67));
    this.maxCatchUpSteps = Math.max(1, Math.trunc(options.maxCatchUpSteps ?? 4));
    this.maxFrameDeltaMs = Math.max(this.fixedStepMs, safeMs(options.maxFrameDeltaMs ?? 250, 250));
    const now = options.now ?? (() => performance.now());
    this.#clock = { now, sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))) };
    this.#budget = Object.freeze({ cpuMs: 12, gpuMs: 12, networkBytes: 256_000, assetBytes: 12_000_000, commands: 256, entities: 5_000, ...options.defaultBudget });
    this.#lastAt = this.#clock.now();
  }

  phase(): KernelPhaseV5 { return this.#phase; }
  frame(): number { return this.#frame; }
  tick(): TickId { return tickId(this.#tick); }
  budget(): KernelBudgetV5 { return this.#budget; }
  lastReport(): KernelFrameReportV5 | null { return this.#lastReport; }
  lastSnapshot(): KernelSnapshotV5 | null { return this.#lastSnapshot; }

  register<TContext = KernelContextV5>(subsystem: KernelSubsystemV5<TContext>): void {
    if (!subsystem.name.trim()) throw new Error('Subsystem name is required');
    if (this.#subsystems.has(subsystem.name)) throw new Error(`Subsystem already registered: ${subsystem.name}`);
    this.#subsystems.set(subsystem.name, Object.freeze({ ...subsystem, maxMs: safeMs(subsystem.maxMs, 0) }) as KernelSubsystemV5);
    this.#rebuildOrder();
  }

  replace<TContext = KernelContextV5>(subsystem: KernelSubsystemV5<TContext>): void {
    if (!subsystem.name.trim()) throw new Error('Subsystem name is required');
    this.#subsystems.set(subsystem.name, Object.freeze({ ...subsystem, maxMs: safeMs(subsystem.maxMs, 0) }) as KernelSubsystemV5);
    this.#rebuildOrder();
  }

  unregister(name: string): boolean {
    const removed = this.#subsystems.delete(name);
    if (removed) this.#rebuildOrder();
    return removed;
  }

  setBudget(patch: Partial<KernelBudgetV5>): void {
    this.#budget = Object.freeze({ ...this.#budget, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, Math.max(0, Math.trunc(finite(value as number)))])) }) as KernelBudgetV5;
  }

  start(): OutcomeV4<RuntimeId> {
    if (this.#phase === 'running') return okV4(this.id);
    if (this.#phase === 'stopped' || this.#phase === 'failed') return failV4(createRuntimeErrorV4('KERNEL_START_BLOCKED', `Kernel is ${this.#phase}`, false));
    this.#phase = 'running';
    this.#running = true;
    this.#lastAt = this.#clock.now();
    return okV4(this.id);
  }

  pause(): boolean {
    if (this.#phase !== 'running') return false;
    this.#phase = 'paused';
    return true;
  }

  resume(): boolean {
    if (this.#phase !== 'paused' && this.#phase !== 'hibernating') return false;
    this.#phase = 'running';
    this.#lastAt = this.#clock.now();
    return true;
  }

  hibernate(): boolean {
    if (this.#phase !== 'running' && this.#phase !== 'paused') return false;
    this.#phase = 'hibernating';
    return true;
  }

  stop(): boolean {
    if (this.#phase === 'stopped') return false;
    this.#running = false;
    this.#phase = 'stopping';
    this.#accumulator = 0;
    this.#phase = 'stopped';
    return true;
  }

  async frame(forceDeltaMs?: number): Promise<KernelFrameReportV5> {
    if (!this.#running || this.#phase !== 'running') throw new Error(`Kernel is ${this.#phase}`);
    if (this.#inFrame) throw new Error('Kernel frame already in flight');
    this.#inFrame = true;
    const started = this.#clock.now();
    try {
      const measured = Math.max(0, this.#clock.now() - this.#lastAt);
      const requested = forceDeltaMs === undefined ? measured : Math.max(0, forceDeltaMs);
      const delta = Math.min(this.maxFrameDeltaMs, requested);
      this.#droppedDeltaMs += Math.max(0, requested - delta);
      this.#accumulator += delta;
      this.#frame += 1;
      const executions: KernelExecutionV5[] = [];
      let steps = 0;
      while (this.#accumulator >= this.fixedStepMs && steps < this.maxCatchUpSteps) {
        this.#accumulator -= this.fixedStepMs;
        this.#tick += 1;
        const context = this.#context(delta);
        executions.push(...await this.#runTick(context));
        steps += 1;
      }
      if (steps === this.maxCatchUpSteps && this.#accumulator >= this.fixedStepMs) {
        this.#droppedDeltaMs += this.#accumulator;
        this.#accumulator = 0;
      }
      const frameDuration = Math.max(0, this.#clock.now() - started);
      this.#frameDurations.push(frameDuration);
      while (this.#frameDurations.length > 120) this.#frameDurations.shift();
      const degraded = executions.some((execution) => execution.degraded || execution.error !== null);
      if (degraded) { this.#degradedFrames += 1; if (this.#phase === 'running') this.#phase = 'degraded'; }
      else if (this.#phase === 'degraded') this.#phase = 'running';
      const report: KernelFrameReportV5 = Object.freeze({ frame: this.#frame, tick: tickId(this.#tick), phase: this.#phase, deltaMs: delta, droppedDeltaMs: this.#droppedDeltaMs, executions: Object.freeze(executions), errors: executions.filter((execution) => execution.error !== null).length, overruns: executions.filter((execution) => execution.degraded).length });
      this.#lastReport = report;
      return report;
    } finally {
      this.#lastAt = this.#clock.now();
      this.#inFrame = false;
    }
  }

  snapshot(): KernelSnapshotV5 {
    const base = { version: 5 as const, runtime: this.id, phase: this.#phase, frame: this.#frame, tick: tickId(this.#tick), createdAt: this.#clock.now() };
    const snapshot = Object.freeze({ ...base, checksum: hash(base) });
    this.#lastSnapshot = snapshot;
    return snapshot;
  }

  restore(snapshot: KernelSnapshotV5): OutcomeV4<boolean> {
    const expected = hash({ version: snapshot.version, runtime: snapshot.runtime, phase: snapshot.phase, frame: snapshot.frame, tick: snapshot.tick, createdAt: snapshot.createdAt });
    if (expected !== snapshot.checksum) return failV4(createRuntimeErrorV4('KERNEL_SNAPSHOT_CHECKSUM', 'Kernel snapshot checksum mismatch', false));
    if (snapshot.runtime !== this.id) return failV4(createRuntimeErrorV4('KERNEL_SNAPSHOT_RUNTIME', 'Snapshot runtime does not match', false));
    this.#frame = Math.max(0, Math.trunc(snapshot.frame));
    this.#tick = Math.max(0, Math.trunc(snapshot.tick));
    this.#phase = snapshot.phase;
    this.#running = this.#phase === 'running' || this.#phase === 'degraded';
    this.#lastSnapshot = snapshot;
    this.#lastAt = this.#clock.now();
    return okV4(true);
  }

  metrics(): KernelMetricsV5 {
    const total = this.#frameDurations.reduce((sum, value) => sum + value, 0);
    return Object.freeze({ frame: this.#frame, tick: tickId(this.#tick), phase: this.#phase, totalFrames: this.#frame, totalTicks: this.#tick, totalErrors: this.#errors, totalOverruns: this.#overruns, droppedDeltaMs: this.#droppedDeltaMs, averageFrameMs: this.#frameDurations.length ? total / this.#frameDurations.length : 0, worstFrameMs: Math.max(0, ...this.#frameDurations), degradedFrames: this.#degradedFrames });
  }

  async recover(reason: string, contextFactory?: (phase: KernelPhaseV5) => KernelContextV5): Promise<OutcomeV4<boolean>> {
    if (this.#phase === 'stopped') return failV4(createRuntimeErrorV4('KERNEL_RECOVERY_STOPPED', 'Cannot recover a stopped kernel', false));
    const previous = this.#phase;
    this.#phase = 'recovering';
    const context = contextFactory?.('recovering') ?? this.#context(0);
    const error = createRuntimeErrorV4('KERNEL_RECOVERY', reason.slice(0, 300), true, 'system', context.trace);
    for (const subsystem of this.#ordered) {
      try { await subsystem.recover?.(error, context); } catch { this.#errors += 1; }
    }
    this.#accumulator = 0;
    this.#lastAt = this.#clock.now();
    this.#phase = previous === 'paused' ? 'paused' : 'running';
    this.#running = this.#phase === 'running';
    return okV4(true);
  }

  subsystemNames(): readonly string[] { return Object.freeze(this.#ordered.map((subsystem) => subsystem.name)); }

  #context(deltaMs: number): KernelContextV5 {
    return Object.freeze({ runtime: this.id, phase: this.#phase, tick: tickId(this.#tick), trace: traceId(`${this.id}:${this.#frame}:${this.#tick}`), frame: this.#frame, deltaMs, budget: this.#budget });
  }

  async #runTick(context: KernelContextV5): Promise<KernelExecutionV5[]> {
    const results: KernelExecutionV5[] = [];
    const startedAt = this.#clock.now();
    for (const subsystem of this.#ordered) {
      if (subsystem.canRun && !subsystem.canRun(context)) {
        results.push(Object.freeze({ subsystem: subsystem.subsystem, name: subsystem.name, tick: context.tick, durationMs: 0, skipped: true, degraded: false, error: null }));
        continue;
      }
      const start = this.#clock.now();
      let error: RuntimeErrorV4 | null = null;
      try { await subsystem.run(context); }
      catch (cause) {
        this.#errors += 1;
        error = createRuntimeErrorV4('KERNEL_SUBSYSTEM_FAILED', cause instanceof Error ? cause.message.slice(0, 300) : 'Subsystem execution failed', true, 'system', context.trace);
        try { await subsystem.recover?.(error, context); } catch { this.#errors += 1; }
      }
      const durationMs = Math.max(0, this.#clock.now() - start);
      const degraded = subsystem.maxMs > 0 && durationMs > subsystem.maxMs;
      if (degraded) this.#overruns += 1;
      results.push(Object.freeze({ subsystem: subsystem.subsystem, name: subsystem.name, tick: context.tick, durationMs, skipped: false, degraded, error }));
      if (this.#clock.now() - startedAt > context.budget.cpuMs * 2 && subsystem.priority === 'background') break;
    }
    return results;
  }

  #rebuildOrder(): void {
    const nodes = [...this.#subsystems.values()];
    const remaining = new Map(nodes.map((node) => [node.name, node]));
    const ordered: KernelSubsystemV5[] = [];
    while (remaining.size) {
      const ready = [...remaining.values()].filter((node) => (node.after ?? []).every((dependency) => !remaining.has(dependency)) && (node.before ?? []).every((dependency) => !remaining.has(dependency) || dependency === node.name));
      if (!ready.length) {
        const fallback = [...remaining.values()].sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || subsystemOrder.indexOf(a.subsystem) - subsystemOrder.indexOf(b.subsystem) || a.name.localeCompare(b.name))[0]!;
        ordered.push(fallback);
        remaining.delete(fallback.name);
        continue;
      }
      ready.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || subsystemOrder.indexOf(a.subsystem) - subsystemOrder.indexOf(b.subsystem) || a.name.localeCompare(b.name));
      for (const node of ready) { ordered.push(node); remaining.delete(node.name); }
    }
    this.#ordered = ordered;
  }
}

export function createRuntimeKernelV5(options: KernelOptionsV5 = {}): RuntimeKernelV5 {
  return new RuntimeKernelV5(options);
}

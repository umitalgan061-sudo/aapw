import { DEFAULT_APP_FRAME_POLICY, finiteOr, monotonicMs, type AppBudget, type AppClock, type AppDiagnosticEvent, type AppFrameContext, type AppFramePolicy, type AppFrameReport, type AppService, type AppServiceContext, type AppSubsystemStats, type AppUpdateContext } from './appTypes.ts';

interface RuntimeState { invocations: number; skipped: number; overBudget: number; elapsedMs: number; lastError?: string; }
interface RegisteredService extends AppService { readonly order: number; }

export interface SchedulerOptions { readonly policy?: Partial<AppFramePolicy>; readonly now?: () => number; readonly budget?: AppBudget; readonly report?: (event: AppDiagnosticEvent) => void; }

export class FrameScheduler {
  readonly #policy: AppFramePolicy;
  readonly #now: () => number;
  readonly #externalReport?: (event: AppDiagnosticEvent) => void;
  readonly #services: RegisteredService[] = [];
  readonly #runtime = new Map<string, RuntimeState>();
  #started = false;
  #paused = false;
  #frame = 0;
  #tick = 0;
  #timeMs = 0;
  #debtMs = 0;
  #lastRealNow = 0;
  #lastReport: AppFrameReport = Object.freeze({ frame: 0, tick: 0, phase: 'created', elapsedMs: 0, subsystems: [], diagnostics: [], droppedCommands: 0, overBudget: false, simulationSteps: 0, simulationDebtMs: 0 });

  constructor(options: SchedulerOptions = {}) {
    this.#policy = Object.freeze({ ...DEFAULT_APP_FRAME_POLICY, ...options.policy });
    this.#now = options.now ?? monotonicMs;
    this.#externalReport = options.report;
  }

  register(service: AppService): void {
    if (this.#started) throw new Error('Cannot register a service after scheduler start.');
    if (this.#services.some((entry) => entry.id === service.id)) throw new Error('Duplicate service: ' + service.id);
    this.#services.push(Object.assign(service, { order: this.#services.length }));
    this.#runtime.set(service.id, { invocations: 0, skipped: 0, overBudget: 0, elapsedMs: 0 });
  }

  unregister(id: string): void {
    if (this.#started) throw new Error('Cannot unregister a service while running.');
    const index = this.#services.findIndex((entry) => entry.id === id);
    if (index >= 0) this.#services.splice(index, 1);
    this.#runtime.delete(id);
  }

  services(): readonly AppService[] { return Object.freeze([...this.#services]); }
  report(): AppFrameReport { return this.#lastReport; }
  get frame(): number { return this.#frame; }
  get tick(): number { return this.#tick; }
  get paused(): boolean { return this.#paused; }
  pause(): void { this.#paused = true; }
  resume(): void { this.#paused = false; }

  async start(seed: Omit<AppFrameContext, 'clock'>): Promise<void> {
    if (this.#started) return;
    const clock = this.#makeClock(0, 0);
    for (const service of this.#sortServices()) await service.start(this.#serviceContext(clock, seed.capabilities, seed.report));
    this.#started = true;
    this.#lastRealNow = this.#now();
  }

  step(seed: Omit<AppFrameContext, 'clock'>): AppFrameReport {
    const current = this.#now();
    const raw = this.#frame === 0 ? this.#policy.fixedStepMs : current - this.#lastRealNow;
    this.#lastRealNow = current;
    const realDeltaMs = Math.max(0, Math.min(this.#policy.maxDeltaMs * 4, finiteOr(raw, this.#policy.fixedStepMs)));
    const deltaMs = this.#paused ? 0 : Math.min(this.#policy.maxDeltaMs, realDeltaMs);
    this.#frame += 1;
    this.#timeMs += deltaMs;
    const diagnostics: AppDiagnosticEvent[] = [];
    this.#debtMs += deltaMs;
    let simulationSteps = 0;
    while (this.#debtMs >= this.#policy.fixedStepMs && simulationSteps < this.#policy.maxCatchUpSteps && !this.#paused) {
      this.#debtMs -= this.#policy.fixedStepMs;
      this.#tick += 1;
      simulationSteps += 1;
    }
    if (this.#debtMs > this.#policy.maxFrameDebtMs) {
      const dropped = this.#debtMs - this.#policy.maxFrameDebtMs;
      this.#debtMs = this.#policy.maxFrameDebtMs;
      const event: AppDiagnosticEvent = Object.freeze({ code: 'SIMULATION_DEBT_CLAMPED', subsystem: 'simulation', severity: 'warning', message: 'Simulation debt was clamped to the configured safety ceiling.', frame: this.#frame, tick: this.#tick, value: dropped, limit: this.#policy.maxFrameDebtMs });
      diagnostics.push(event);
      this.#externalReport?.(event);
    }
    const clock = this.#makeClock(deltaMs, realDeltaMs);
    const context = Object.freeze({ ...seed, clock, report: (event: AppDiagnosticEvent) => { diagnostics.push(event); this.#externalReport?.(event); } });
    const frameStarted = this.#now();
    const stats: AppSubsystemStats[] = [];
    let spentCpuMs = 0;

    for (const service of this.#sortServices()) {
      const runtime = this.#runtime.get(service.id);
      if (!runtime) continue;
      if (spentCpuMs > seed.budget.cpuMs && service.priority === 'background') { runtime.skipped += 1; stats.push(this.#stats(service, runtime)); continue; }
      runtime.invocations += 1;
      const start = this.#now();
      try {
        const updateContext: AppUpdateContext = Object.freeze({
          ...context,
          budget: seed.budget,
          consumeBudget: (cost) => { spentCpuMs += Math.max(0, finiteOr(cost, 0)); return spentCpuMs <= seed.budget.cpuMs; },
          commandBus: seed.commandBus,
        });
        service.update(updateContext);
      } catch (error) {
        runtime.lastError = error instanceof Error ? error.message : String(error);
        const event: AppDiagnosticEvent = Object.freeze({ code: 'SERVICE_UPDATE_FAILED', subsystem: service.subsystem, severity: service.priority === 'critical' ? 'critical' : 'warning', message: 'Application service update failed.', frame: this.#frame, tick: this.#tick, metadata: { service: service.id } });
        diagnostics.push(event);
        this.#externalReport?.(event);
      }
      const elapsed = Math.max(0, this.#now() - start);
      runtime.elapsedMs = runtime.elapsedMs * 0.9 + elapsed * 0.1;
      if (runtime.elapsedMs > this.#serviceBudget(service, seed.budget)) runtime.overBudget += 1;
      stats.push(this.#stats(service, runtime));
    }

    const elapsedMs = Math.max(0, this.#now() - frameStarted);
    const report: AppFrameReport = Object.freeze({
      frame: this.#frame,
      tick: this.#tick,
      phase: this.#paused ? 'paused' : 'running',
      elapsedMs,
      subsystems: Object.freeze(stats),
      diagnostics: Object.freeze(diagnostics),
      droppedCommands: 0,
      overBudget: elapsedMs > seed.budget.cpuMs || spentCpuMs > seed.budget.cpuMs,
      simulationSteps,
      simulationDebtMs: this.#debtMs,
    });
    this.#lastReport = report;
    return report;
  }

  async stop(seed: AppFrameContext): Promise<void> {
    if (!this.#started) return;
    const clock = seed.clock;
    for (const service of [...this.#sortServices()].reverse()) await service.stop(this.#serviceContext(clock, seed.capabilities, seed.report));
    this.#started = false;
  }

  reset(): void {
    this.#started = false;
    this.#paused = false;
    this.#frame = 0;
    this.#tick = 0;
    this.#timeMs = 0;
    this.#debtMs = 0;
    this.#lastRealNow = 0;
    for (const state of this.#runtime.values()) { state.invocations = 0; state.skipped = 0; state.overBudget = 0; state.elapsedMs = 0; delete state.lastError; }
  }

  #makeClock(deltaMs: number, realDeltaMs: number): AppClock { return Object.freeze({ nowMs: this.#timeMs, realNowMs: this.#lastRealNow, frame: this.#frame, simulationTick: this.#tick, deltaMs, realDeltaMs, paused: this.#paused }); }
  #serviceContext(clock: AppClock, capabilities: AppFrameContext['capabilities'], report: AppFrameContext['report']): AppServiceContext { return Object.freeze({ clock, capabilities, report }); }
  #stats(service: RegisteredService, state: RuntimeState): AppSubsystemStats { return Object.freeze({ id: service.id, subsystem: service.subsystem, elapsedMs: Number(state.elapsedMs.toFixed(3)), invocations: state.invocations, skipped: state.skipped, overBudget: state.overBudget, ...(state.lastError ? { lastError: state.lastError } : {}) }); }
  #serviceBudget(service: RegisteredService, budget: AppBudget): number {
    if (service.subsystem === 'render') return budget.renderMs;
    if (service.subsystem === 'streaming') return budget.streamingMs;
    if (service.subsystem === 'network') return budget.networkMs;
    return budget.cpuMs * (service.priority === 'critical' ? 0.45 : 0.25);
  }
  #sortServices(): readonly RegisteredService[] {
    const remaining = new Map(this.#services.map((service) => [service.id, service]));
    const ordered: RegisteredService[] = [];
    while (remaining.size) {
      let progressed = false;
      for (const [id, service] of remaining) {
        if (service.dependencies.every((dependency) => ordered.some((item) => item.id === dependency))) { ordered.push(service); remaining.delete(id); progressed = true; }
      }
      if (!progressed) throw new Error('Application service dependency cycle detected.');
    }
    return Object.freeze(ordered);
  }
}

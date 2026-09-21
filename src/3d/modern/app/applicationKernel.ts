import { RuntimeOrchestratorV2, type OrchestratorFrame } from '../runtimeOrchestratorV2.ts';
import type { PlayerInput } from '../playerAuthority.ts';
import { createApplicationRuntimeConfig, adaptBudget, scaleQuality, type ApplicationRuntimeConfig } from './appConfig.ts';
import { CommandBus, InputCommandSystem, createDefaultBindings, mapToPlayerInput, type InputSnapshot } from './inputCommandSystem.ts';
import { FrameScheduler } from './frameScheduler.ts';
import { PerformanceGovernor, type PerformanceSample } from './performanceGovernor.ts';
import { AssetCatalog } from './assetCatalog.ts';
import { SaveSlotManager, type SaveSlotResult } from './saveSlotManager.ts';
import { NetworkSessionTimeline } from './networkSession.ts';
import { TelemetryPipeline } from './telemetryPipeline.ts';
import { AccessibilityProfileStore, type AccessibilityProfile } from './accessibilityProfile.ts';
import { RuntimeErrorBoundary } from './errorBoundary.ts';
import { emptyInputState, type AppBudget, type AppCapabilities, type AppClock, type AppDiagnosticEvent, type AppFeatureConfig, type AppFrameReport, type AppInputState } from './appTypes.ts';

export interface ApplicationKernelOptions { readonly config?: Partial<Parameters<typeof createApplicationRuntimeConfig>[0]>; readonly now?: () => number; readonly saveAdapter?: ConstructorParameters<typeof SaveSlotManager>[0]['adapter']; }
export interface ApplicationFrame { readonly input: InputSnapshot; readonly playerInput: PlayerInput; readonly runtime: OrchestratorFrame; readonly report: AppFrameReport; readonly budget: AppBudget; readonly qualityTier: ApplicationRuntimeConfig['quality']['tier']; readonly diagnostics: readonly AppDiagnosticEvent[]; readonly telemetryDigest: string; }
export interface KernelSnapshot { readonly phase: string; readonly clock: AppClock; readonly lifecycleRevision: number; readonly quality: ApplicationRuntimeConfig['quality']; readonly diagnostics: readonly AppDiagnosticEvent[]; readonly assets: ReturnType<AssetCatalog['snapshot']>; readonly network: ReturnType<NetworkSessionTimeline['metrics']>; readonly telemetry: ReturnType<TelemetryPipeline['snapshot']>; readonly errors: ReturnType<RuntimeErrorBoundary['snapshot']>; readonly accessibility: AccessibilityProfile; }

export class ApplicationKernel {
  readonly config: ApplicationRuntimeConfig;
  readonly input: InputCommandSystem;
  readonly scheduler: FrameScheduler;
  readonly performance: PerformanceGovernor;
  readonly assets: AssetCatalog;
  readonly saves: SaveSlotManager;
  readonly network: NetworkSessionTimeline;
  readonly telemetry: TelemetryPipeline;
  readonly accessibility: AccessibilityProfileStore;
  readonly errors: RuntimeErrorBoundary;
  readonly orchestrator: RuntimeOrchestratorV2;
  readonly #now: () => number;
  #phase: 'created' | 'booting' | 'ready' | 'running' | 'paused' | 'stopping' | 'stopped' | 'failed' = 'created';
  #revision = 0;
  #bootAt = 0;
  #diagnostics: AppDiagnosticEvent[] = [];
  #lastFrame?: ApplicationFrame;

  constructor(options: ApplicationKernelOptions = {}) {
    this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.config = createApplicationRuntimeConfig(options.config ?? {});
    this.input = new InputCommandSystem();
    this.input.bindMany(createDefaultBindings());
    this.scheduler = new FrameScheduler({ policy: this.config.frame, now: this.#now, report: (event) => this.report(event) });
    this.performance = new PerformanceGovernor(this.config.frame);
    this.assets = new AssetCatalog({ maxEntries: 4096, maxBytes: this.config.quality.textureBudgetMb * 1024 * 1024 });
    this.saves = new SaveSlotManager({ ...(options.saveAdapter ? { adapter: options.saveAdapter } : {}), maxSlots: this.config.persistence.slotCount, maxBytes: this.config.security.maxSaveBytes, now: this.#now });
    this.network = new NetworkSessionTimeline({ id: 'aapw-' + this.config.worldSeed.toString(36), now: this.#now });
    this.telemetry = new TelemetryPipeline(this.config.security.maxTelemetryEvents);
    this.accessibility = new AccessibilityProfileStore({ reducedMotion: this.config.capabilities.reducedMotion });
    this.errors = new RuntimeErrorBoundary({ now: this.#now });
    this.orchestrator = new RuntimeOrchestratorV2({ worldSeed: this.config.worldSeed, ai: { maxThinkersPerFrame: 32, perceptionRadius: 72 }, now: this.#now });
    this.#bootAt = this.#now();
  }

  phase(): string { return this.#phase; }
  revision(): number { return this.#revision; }
  latest(): ApplicationFrame | undefined { return this.#lastFrame; }

  async boot(): Promise<void> {
    if (this.#phase === 'ready' || this.#phase === 'running') return;
    this.#transition('booting');
    try {
      await this.scheduler.start(this.#seedContext());
      this.#transition('ready');
      this.telemetry.event('application.boot.complete');
    } catch (error) {
      this.errors.capture(error, { phase: 'booting', subsystem: 'simulation', recoverable: false });
      this.#transition('failed');
      throw error;
    }
  }

  start(): void { if (this.#phase === 'ready' || this.#phase === 'paused') this.#transition('running'); }
  pause(): void { if (this.#phase === 'running') { this.scheduler.pause(); this.#transition('paused'); } }
  resume(): void { if (this.#phase === 'paused') { this.scheduler.resume(); this.#transition('running'); } }

  frame(deltaMs: number): ApplicationFrame {
    if (this.#phase === 'created') throw new Error('Application kernel must be booted before framing.');
    if (this.#phase === 'failed' || this.#phase === 'stopped') throw new Error('Application kernel is not runnable.');
    if (this.#phase === 'ready') this.start();
    const input = this.input.sample(this.#now());
    const playerInput = mapToPlayerInput(input);
    const normalizedDelta = Math.max(0, Math.min(this.config.frame.maxDeltaMs, Number.isFinite(deltaMs) ? deltaMs : this.config.frame.fixedStepMs));
    const budget = this.performance.recommendedBudget(this.config.initialBudget);
    let runtime: OrchestratorFrame;
    try {
      runtime = this.orchestrator.tick({ deltaMs: normalizedDelta, player: playerInput });
    } catch (error) {
      this.errors.capture(error, { phase: this.#phase, subsystem: 'simulation', recoverable: true });
      const recovery = this.errors.beginRecovery('runtime-restart', 'simulation tick failed');
      if (recovery) { this.orchestrator.integration.reset(); this.errors.completeRecovery(true); runtime = this.orchestrator.tick({ deltaMs: Math.min(normalizedDelta, this.config.frame.fixedStepMs), player: playerInput }); }
      else { this.#transition('failed'); throw error; }
    }
    const report = this.scheduler.step({ input, capabilities: this.config.capabilities, features: this.config.features, budget, commandBus: this.input.commandBus, report: (event) => this.report(event) });
    const frame: ApplicationFrame = Object.freeze({ input, playerInput, runtime, report, budget, qualityTier: this.config.quality.tier, diagnostics: Object.freeze([...this.#diagnostics]), telemetryDigest: this.telemetry.snapshot().digest });
    this.#lastFrame = frame;
    this.telemetry.gauge('application.frame.time', report.elapsedMs, report.frame, report.tick);
    this.telemetry.gauge('application.frame.diagnostics', report.diagnostics.length, report.frame, report.tick);
    return frame;
  }

  submitPerformance(sample: Omit<PerformanceSample, 'timestampMs'> & { timestampMs?: number }): void {
    const decision = this.performance.push({ ...sample, timestampMs: sample.timestampMs ?? this.#now() });
    for (const diagnostic of decision.diagnostics) this.report(diagnostic);
    this.telemetry.gauge('performance.pressure', decision.pressure);
    this.telemetry.gauge('performance.frameAverageMs', decision.frameAverageMs);
  }

  report(event: AppDiagnosticEvent): void { this.#diagnostics.push(Object.freeze(event)); if (this.#diagnostics.length > 128) this.#diagnostics.shift(); this.telemetry.reportDiagnostic(event); }

  save(slot: string, settings: Readonly<Record<string, unknown>> = {}): SaveSlotResult {
    const latest = this.#lastFrame?.runtime;
    if (!latest) return Object.freeze({ ok: false, slot, error: 'No runtime frame is available for saving.' });
    const result = this.saves.save(slot, 'world-' + this.config.worldSeed.toString(16), latest.simulation.player, latest.snapshot.entities, settings);
    this.telemetry.event('application.save', result.ok ? 1 : 0);
    return result;
  }

  load(slot: string): ReturnType<SaveSlotManager['load']> { const result = this.saves.load(slot); this.telemetry.event('application.load', result.ok ? 1 : 0); return result; }

  snapshot(): KernelSnapshot {
    const latest = this.#lastFrame?.runtime;
    const clock: AppClock = Object.freeze({ nowMs: this.#now() - this.#bootAt, realNowMs: this.#now(), frame: latest?.simulation.frame ?? 0, simulationTick: latest?.simulation.frame ?? 0, deltaMs: latest ? 0 : 0, realDeltaMs: 0, paused: this.#phase === 'paused' });
    return Object.freeze({ phase: this.#phase, clock, lifecycleRevision: this.#revision, quality: this.performance.recommendedQuality(this.config.quality), diagnostics: Object.freeze([...this.#diagnostics]), assets: this.assets.snapshot(), network: this.network.metrics(), telemetry: this.telemetry.snapshot(), errors: this.errors.snapshot(), accessibility: this.accessibility.current() });
  }

  async stop(): Promise<void> {
    if (this.#phase === 'stopping' || this.#phase === 'stopped') return;
    this.#transition('stopping');
    try { await this.scheduler.stop(this.#seedContext()); this.orchestrator.dispose(); this.#transition('stopped'); this.telemetry.event('application.stop.complete'); }
    catch (error) { this.errors.capture(error, { phase: 'stopping', subsystem: 'simulation', recoverable: false }); this.#transition('failed'); throw error; }
  }

  reset(): void { this.orchestrator.integration.reset(); this.input.reset(); this.performance.reset(); this.telemetry.clear(); this.errors.reset(); this.#diagnostics.length = 0; this.#lastFrame = undefined; this.scheduler.reset(); this.#revision += 1; this.#phase = 'created'; this.#bootAt = this.#now(); }

  #seedContext() { return Object.freeze({ input: emptyInputState(), capabilities: this.config.capabilities, features: this.config.features, budget: this.config.initialBudget, commandBus: this.input.commandBus, report: (event: AppDiagnosticEvent) => this.report(event) }); }
  #transition(next: 'created' | 'booting' | 'ready' | 'running' | 'paused' | 'stopping' | 'stopped' | 'failed'): void { this.#phase = next; this.#revision += 1; this.telemetry.event('application.phase.' + next, this.#revision); }
}

export const createApplicationKernel = (options?: ApplicationKernelOptions): ApplicationKernel => new ApplicationKernel(options);

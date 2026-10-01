import type {
  InputFrame,
  RuntimeCommand,
  RuntimeConfig,
  RuntimeHealth,
  RuntimeMetrics,
  Vec3,
} from './types.ts';
import { UnifiedRuntimeR37, type RuntimeStepResult } from './runtimeFacade.ts';
import { ResourceBudgetR37, budgetForQuality } from './resourceBudget.ts';
import { DiagnosticsReporterR37 } from './diagnosticsReporter.ts';
import { EventTimelineR37 } from './eventTimeline.ts';
import { InputReplayR37 } from './inputReplay.ts';
import { CommandReconcilerR37 } from './commandReconciliation.ts';
import { AssetIntegrityR37 } from './assetIntegrity.ts';
import { SecurityBoundaryR37 } from './securityBoundary.ts';
import { QualityPolicyR37 } from './qualityPolicy.ts';
import { WorkerSchedulerR37 } from './workerScheduler.ts';
import { ContentCatalogR37 } from './contentCatalog.ts';
import { SimulationPipelineR37 } from './simulationSystems.ts';
import { createMovementSystemR37, createStaminaSystemR37, createCombatSystemR37, createGravitySystemR37 } from './simulationSystems.ts';
import { clamp, finite } from './math.ts';

export interface RuntimeOrchestratorConfig extends RuntimeConfig {
  readonly budgetUnits?: number;
  readonly maxTelemetrySamples?: number;
  readonly maxReplayFrames?: number;
  readonly workerConcurrency?: number;
}

export interface RuntimeOrchestratorSnapshot {
  readonly version: 37;
  readonly health: RuntimeHealth;
  readonly metrics: RuntimeMetrics;
  readonly quality: ReturnType<QualityPolicyR37['resolve']>;
  readonly budget: ReturnType<ResourceBudgetR37['snapshot']>;
  readonly timelineDigest: string;
  readonly replayFrames: number;
  readonly contentEntries: number;
  readonly workersActive: number;
}

export interface OrchestratorFrameContext {
  readonly deltaSeconds: number;
  readonly cameraPosition: Vec3;
  readonly input?: Omit<InputFrame, 'sequence'>;
  readonly commands?: readonly Omit<RuntimeCommand, 'id' | 'sequence'>[];
}

export class RuntimeOrchestratorR37 {
  readonly config: RuntimeOrchestratorConfig;
  readonly runtime: UnifiedRuntimeR37;
  readonly budget: ResourceBudgetR37;
  readonly diagnostics: DiagnosticsReporterR37;
  readonly timeline: EventTimelineR37;
  readonly replay: InputReplayR37;
  readonly reconciler: CommandReconcilerR37;
  readonly assets: AssetIntegrityR37;
  readonly security: SecurityBoundaryR37;
  readonly qualityPolicy: QualityPolicyR37;
  readonly workers: WorkerSchedulerR37;
  readonly content: ContentCatalogR37;
  readonly systems: SimulationPipelineR37;

  #frame = 0;
  #disposed = false;
  #lastStep: RuntimeStepResult | null = null;

  constructor(config: Partial<RuntimeOrchestratorConfig> = {}) {
    this.config = Object.freeze({
      seed: Math.trunc(finite(config.seed, 37)),
      fixedStepSeconds: Math.max(1 / 240, finite(config.fixedStepSeconds, 1 / 60)),
      maxCatchUpSteps: Math.max(1, Math.trunc(finite(config.maxCatchUpSteps, 8))),
      networkRole: config.networkRole ?? 'offline',
      initialQuality: config.initialQuality ?? 'balanced',
      maxEntities: Math.max(1, Math.trunc(finite(config.maxEntities, 4096))),
      maxCommandsPerTick: Math.max(1, Math.trunc(finite(config.maxCommandsPerTick, 96))),
      commandHistoryCapacity: Math.max(32, Math.trunc(finite(config.commandHistoryCapacity, 512))),
      snapshotHistoryCapacity: Math.max(2, Math.trunc(finite(config.snapshotHistoryCapacity, 64))),
      budgetUnits: Math.max(1, finite(config.budgetUnits, 100)),
      maxTelemetrySamples: Math.max(32, Math.trunc(finite(config.maxTelemetrySamples, 512))),
      maxReplayFrames: Math.max(32, Math.trunc(finite(config.maxReplayFrames, 1024))),
      workerConcurrency: Math.max(1, Math.trunc(finite(config.workerConcurrency, 4))),
    });
    this.runtime = new UnifiedRuntimeR37(this.config);
    this.budget = new ResourceBudgetR37({ maxUnits: this.config.budgetUnits });
    this.diagnostics = new DiagnosticsReporterR37(undefined);
    this.timeline = new EventTimelineR37();
    this.replay = new InputReplayR37(this.config.maxReplayFrames);
    this.reconciler = new CommandReconcilerR37({
      maxPredictionTicks: this.config.maxCatchUpSteps * 32,
      maxCommandsPerTick: this.config.maxCommandsPerTick,
    });
    this.assets = new AssetIntegrityR37();
    this.security = new SecurityBoundaryR37();
    this.qualityPolicy = new QualityPolicyR37();
    this.workers = new WorkerSchedulerR37({ concurrency: this.config.workerConcurrency });
    this.content = new ContentCatalogR37();
    this.systems = new SimulationPipelineR37();
    this.systems.register(createMovementSystemR37());
    this.systems.register(createStaminaSystemR37());
    this.systems.register(createCombatSystemR37());
    this.systems.register(createGravitySystemR37());
  }

  get frame(): number {
    return this.#frame;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  registerEntity(input: Parameters<UnifiedRuntimeR37['registerEntity']>[0]): boolean {
    this.assertActive();
    return this.runtime.registerEntity(input);
  }

  updateEntity(id: string, patch: Parameters<UnifiedRuntimeR37['updateEntity']>[1]): boolean {
    this.assertActive();
    return this.runtime.updateEntity(id, patch);
  }

  pushInput(input: Omit<InputFrame, 'sequence'>): InputFrame {
    this.assertActive();
    const frame = this.runtime.pushInput(input);
    this.replay.append(frame);
    return frame;
  }

  dispatch(command: Omit<RuntimeCommand, 'id' | 'sequence'>): RuntimeCommand | null {
    this.assertActive();
    const safe = this.security.sanitize(command.payload);
    if (!safe.accepted) return null;
    const accepted = this.runtime.dispatchCommand({
      ...command,
      payload: safe.value as Readonly<Record<string, unknown>>,
    });
    if (accepted) this.reconciler.rollback.recordCommand(accepted);
    return accepted;
  }

  step(context: OrchestratorFrameContext): RuntimeOrchestratorSnapshot {
    this.assertActive();
    const started = nowMs();
    this.#frame += 1;
    if (context.input) this.pushInput(context.input);
    for (const command of context.commands ?? []) this.dispatch(command);

    this.budget.beginTick(this.runtime.clock.tick + 1);
    const budget = budgetForQuality(this.runtime.quality);
    this.budget.request({
      id: 'simulation',
      class: 'critical',
      cost: Math.max(1, budget.simulationMs),
      priority: 100,
    });
    this.budget.request({
      id: 'render',
      class: 'interactive',
      cost: Math.max(1, budget.renderMs),
      priority: 80,
    });
    this.budget.request({
      id: 'network',
      class: 'interactive',
      cost: Math.max(1, budget.networkMs),
      priority: 70,
    });

    const result = this.runtime.step(clamp(finite(context.deltaSeconds), 0, 0.25), context.cameraPosition);
    this.#lastStep = result;
    this.timeline.appendMany(result.events);
    this.diagnostics.recordMetrics(result.metrics);
    this.reconciler.recordState(this.runtime.world.snapshot(), this.runtime.commands.commandsForTick(this.runtime.clock.tick));

    return this.snapshot(result);
  }

  snapshot(result = this.#lastStep): RuntimeOrchestratorSnapshot {
    this.assertActive();
    const health = this.runtime.health();
    const metrics = result?.metrics ?? health.metrics;
    return Object.freeze({
      version: 37,
      health,
      metrics,
      quality: this.qualityPolicy.resolve(this.runtime.quality),
      budget: this.budget.snapshot(),
      timelineDigest: this.timeline.digest(),
      replayFrames: this.replay.size(),
      contentEntries: this.content.size(),
      workersActive: this.workers.activeCount(),
    });
  }

  diagnosticsReport(): ReturnType<DiagnosticsReporterR37['report']> {
    this.assertActive();
    const health = this.runtime.health();
    return this.diagnostics.report(health, health.metrics);
  }

  addContent(entry: Parameters<ContentCatalogR37['register']>[0]): boolean {
    this.assertActive();
    return this.content.register(entry);
  }

  validateAsset(manifest: Parameters<AssetIntegrityR37['validate']>[0]): ReturnType<AssetIntegrityR37['validate']> {
    this.assertActive();
    return this.assets.validate(manifest);
  }

  planReconciliation(authoritative: Parameters<CommandReconcilerR37['reconcile']>[0], local: Parameters<CommandReconcilerR37['reconcile']>[1]): ReturnType<CommandReconcilerR37['reconcile']> {
    this.assertActive();
    return this.reconciler.reconcile(authoritative, local, this.replay.frames().map((frame) => ({
      id: 'replay-' + frame.sequence,
      tick: frame.tick,
      kind: 'custom',
      source: 'input-replay',
      payload: {},
      sequence: frame.sequence,
    })));
  }

  async runBackgroundTask<T>(id: string, task: () => Promise<T> | T, priority = 0): Promise<boolean> {
    this.assertActive();
    if (!this.workers.enqueue({ id, priority, run: task })) return false;
    await this.workers.drain();
    return this.workers.history().some((result) => result.id === id && result.ok);
  }

  applySystemBudgetRequests(): readonly ReturnType<ResourceBudgetR37['request']>[] {
    this.assertActive();
    const quality = this.qualityPolicy.resolve(this.runtime.quality);
    const requests = [
      { id: 'animation', class: 'background' as const, cost: quality.maxAnimatedEntities / 12, priority: 50 },
      { id: 'audio', class: 'background' as const, cost: quality.maxAudioSources / 2, priority: 40 },
      { id: 'effects', class: 'deferred' as const, cost: Math.max(1, quality.effectsScale * 6), priority: 20 },
    ];
    return this.budget.batch(requests);
  }

  reset(): void {
    this.assertActive();
    this.runtime.world.reset();
    this.runtime.clock.reset();
    this.runtime.input.rewind(0);
    this.runtime.commands.clear();
    this.replay.clear();
    this.timeline.clear();
    this.reconciler.reset();
    this.diagnostics.clear();
    this.budget.beginTick(0);
    this.workers.reset();
    this.content.restore({ version: 37, entries: [] });
    this.#frame = 0;
    this.#lastStep = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.runtime.dispose();
    this.workers.cancel();
    this.#disposed = true;
    this.#lastStep = null;
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error('R37 orchestrator disposed');
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

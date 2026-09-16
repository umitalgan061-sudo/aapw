import { EntityId, InputIntent, RuntimeBudget, Tick, Vec3, asTick, checksumObject, nextTick } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';
import { CommandBusV5, command } from './commandBus.ts';
import { FrameSchedulerV5 } from './scheduler.ts';
import { AssetGraphV5 } from './assetGraph.ts';
import { NetworkStateV5, ReconciliationResult } from './network.ts';
import { SaveRuntimeV5 } from './persistence.ts';
import { TelemetryBufferV5, FrameHealthMonitorV5 } from './observability.ts';
import { RuntimeSecurityV5 } from './security.ts';
import { VisibilityResolverV5, CameraState } from './render.ts';

export interface RuntimeHooks {
  onTickStart?: (tick: Tick) => void | Promise<void>;
  onTickEnd?: (tick: Tick, budget: RuntimeBudget) => void | Promise<void>;
  onInput?: (intent: InputIntent) => void | Promise<void>;
}

export interface RuntimeRuntimeConfig {
  readonly tickRate: number;
  readonly maxCatchUpSteps: number;
  readonly saveIntervalTicks: number;
  readonly maxDeltaSeconds: number;
}

const DEFAULT_RUNTIME_RUNTIME_CONFIG: RuntimeRuntimeConfig = Object.freeze({ tickRate: 60, maxCatchUpSteps: 4, saveIntervalTicks: 600, maxDeltaSeconds: 0.25 });

export interface RuntimeStepResult {
  readonly ticksSimulated: number;
  readonly currentTick: Tick;
  readonly remainingSeconds: number;
  readonly healthScore: number;
  readonly degraded: boolean;
}

export class ModernRuntimeV5 {
  readonly world = new EcsWorldV5();
  readonly commands = new CommandBusV5();
  readonly scheduler = new FrameSchedulerV5();
  readonly assets = new AssetGraphV5();
  readonly network = new NetworkStateV5();
  readonly telemetry = new TelemetryBufferV5();
  readonly health = new FrameHealthMonitorV5(this.telemetry);
  readonly security = new RuntimeSecurityV5();
  readonly render = new VisibilityResolverV5(this.world);
  #tick = asTick(0);
  #accumulator = 0;
  #running = false;
  #lastSnapshotChecksum = '';
  readonly #config: RuntimeRuntimeConfig;
  readonly #save: SaveRuntimeV5;
  readonly #hooks: RuntimeHooks;

  constructor(config: Partial<RuntimeRuntimeConfig> = {}, save: SaveRuntimeV5 = new SaveRuntimeV5(), hooks: RuntimeHooks = {}) {
    this.#config = { ...DEFAULT_RUNTIME_RUNTIME_CONFIG, ...config };
    this.#save = save;
    this.#hooks = hooks;
  }

  get tick(): Tick { return this.#tick; }
  get running(): boolean { return this.#running; }
  get fixedDeltaSeconds(): number { return 1 / this.#config.tickRate; }
  get accumulatorSeconds(): number { return this.#accumulator; }

  start(): void { this.#running = true; this.telemetry.log('info', 'runtime', 'started', { tickRate: this.#config.tickRate }, this.#tick, null); }
  stop(): void { this.#running = false; this.telemetry.log('info', 'runtime', 'stopped', {}, this.#tick, null); }

  async submitIntent(intent: InputIntent): Promise<boolean> {
    if (!this.#running) return false;
    const envelope = command('input.intent', intent, Number(intent.tick), intent.entity);
    const violations = this.security.validateCommand(envelope);
    if (violations.length > 0) {
      this.telemetry.metric('input.rejected', 1);
      return false;
    }
    this.commands.enqueue(envelope);
    await this.#hooks.onInput?.(intent);
    return true;
  }

  async step(deltaSeconds: number, signal?: AbortSignal): Promise<RuntimeStepResult> {
    if (!this.#running) return { ticksSimulated: 0, currentTick: this.#tick, remainingSeconds: this.#accumulator, healthScore: 0, degraded: true };
    const clampedDelta = Math.min(Math.max(0, deltaSeconds), this.#config.maxDeltaSeconds);
    this.#accumulator += clampedDelta;
    const step = this.fixedDeltaSeconds;
    let ticks = 0;
    const startMs = typeof performance === 'undefined' ? Date.now() : performance.now();
    while (this.#accumulator >= step && ticks < this.#config.maxCatchUpSteps) {
      if (signal?.aborted) break;
      await this.#hooks.onTickStart?.(this.#tick);
      await this.commands.drain(this.#tick, signal);
      await this.scheduler.run(this.#tick, step, { signal });
      this.#tick = nextTick(this.#tick);
      this.world.advanceTick();
      this.#accumulator -= step;
      ticks += 1;
      await this.#hooks.onTickEnd?.(this.#tick, this.scheduler.getBudget());
      if (Number(this.#tick) % this.#config.saveIntervalTicks === 0 && this.#save.shouldSave(this.#tick)) {
        // Save scheduling is deliberately awaited at a tick boundary; state is deterministic before persistence begins.
        const entities = this.world.snapshot();
        const snapshot = { version: 5 as const, tick: this.#tick, digest: { tick: this.#tick, entityCount: entities.length, commandCount: 0, eventCount: 0, checksum: checksumObject(entities) }, entities, metadata: {} };
        await this.#save.save(snapshot);
        this.#lastSnapshotChecksum = snapshot.digest.checksum;
      }
    }
    const budget = this.scheduler.getBudget();
    const frameMs = (typeof performance === 'undefined' ? Date.now() : performance.now()) - startMs;
    const health = this.health.record(frameMs, budget, this.#tick);
    const report = this.telemetry.reportHealth();
    return { ticksSimulated: ticks, currentTick: this.#tick, remainingSeconds: this.#accumulator, healthScore: health && report.score, degraded: report.score < 70 || budget.totalMs > budget.maxTotalMs };
  }

  reconcile(snapshot: Parameters<ModernRuntimeV5['applySnapshot']>[0]): ReconciliationResult {
    const local = this.network.history.latest();
    if (!local) {
      this.applySnapshot(snapshot);
      return { fromTick: snapshot.tick, toTick: snapshot.tick, correctedEntities: snapshot.entities.length, replayedInputs: 0, accepted: true };
    }
    let corrected = 0;
    const result: ReconciliationResult = {
      fromTick: local.tick,
      toTick: snapshot.tick,
      correctedEntities: corrected,
      replayedInputs: this.network.predictions.after(snapshot.tick).length,
      accepted: snapshot.tick >= local.tick,
    };
    this.applySnapshot(snapshot);
    corrected = snapshot.entities.length;
    return { ...result, correctedEntities: corrected };
  }

  applySnapshot(snapshot: { readonly version?: number; readonly tick: Tick; readonly entities: readonly Parameters<EcsWorldV5['spawn']>[0]['components'] extends readonly (infer _T)[] ? never[] : never[] }): void {
    // This overload is intentionally kept strict in the public surface below; use applyNetworkSnapshot for network payloads.
    void snapshot;
  }

  applyNetworkSnapshot(snapshot: import('./domain.ts').NetworkSnapshot): void {
    this.world.restore(snapshot.entities, asTick(Number(snapshot.tick)));
    this.#tick = asTick(Number(snapshot.tick));
  }

  renderPlan(camera: CameraState) { return this.render.collect(camera); }

  digest(): string {
    return checksumObject({ tick: this.#tick, world: this.world.snapshot(), pending: this.commands.pendingCount(), assets: this.assets.stats() });
  }

  lastSnapshotChecksum(): string { return this.#lastSnapshotChecksum; }
}

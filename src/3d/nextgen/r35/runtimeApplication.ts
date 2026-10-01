import {
  createNextGenRuntime,
  type NextGenConfig,
  type RuntimeFrameResult,
} from '../runtimeFacadeV3';
import { CommandRateLimiterV3, validateRuntimeCommand } from '../runtimeSecurityV3';
import {
  createDefaultR35Budgets,
  R35WorkScheduler,
  type SchedulerTickReport,
} from './worldScheduler';
import { R35AssetOrchestrator } from './assetOrchestrator';
import { R35InputPipeline, type NormalizedInput, type RawInputSample } from './inputPipeline';
import { R35Observability, phaseBudgetMap } from './observability';
import { createRuntimeSnapshot, R35StateStore, createSelector } from './stateStore';
import {
  normalizeFeatureSet,
  validateConfig,
  type R35Command,
  type R35FeatureSet,
  type R35FrameBudget,
  type R35InputFrame,
  type R35RuntimeConfig,
  type R35RuntimeEvent,
  type R35RuntimeSnapshot,
  type RuntimeMode,
  type RuntimePhase,
} from './contracts';

export interface R35ApplicationOptions {
  readonly config?: Partial<R35RuntimeConfig>;
  readonly nextGen?: Partial<NextGenConfig>;
  readonly budgets?: readonly R35FrameBudget[];
}

export interface R35ApplicationFrame {
  readonly input: R35InputFrame;
  readonly normalizedInput: NormalizedInput;
  readonly runtimeFrame: RuntimeFrameResult;
  readonly scheduler: SchedulerTickReport;
  readonly health: ReturnType<R35Observability['health']>;
  readonly snapshot: R35RuntimeSnapshot;
}

const DEFAULT_CONFIG: R35RuntimeConfig = {
  seed: 35,
  fixedDeltaSeconds: 1 / 60,
  maxCatchUpSteps: 4,
  snapshotHistory: 120,
  inputBufferTicks: 12,
  maxAssetsBytes: 512 * 1024 * 1024,
  maxWorkers: 4,
  frameBudgets: createDefaultR35Budgets(),
  features: normalizeFeatureSet({}),
};

export class R35RuntimeApplication {
  readonly config: R35RuntimeConfig;
  readonly runtime;
  readonly input: R35InputPipeline;
  readonly assets: R35AssetOrchestrator;
  readonly scheduler: R35WorkScheduler;
  readonly observability: R35Observability;
  readonly limiter: CommandRateLimiterV3;
  readonly state: R35StateStore;
  readonly budgets: ReadonlyMap<RuntimePhase, number>;

  #mode: RuntimeMode = 'booting';
  #tick = 0;
  #eventSequence = 0;
  #playerId: number | null = null;
  #started = false;
  #lastFrameMs = 0;

  constructor(options: R35ApplicationOptions = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...options.config,
      features: normalizeFeatureSet(options.config?.features),
      frameBudgets: Object.freeze([...(options.budgets ?? options.config?.frameBudgets ?? DEFAULT_CONFIG.frameBudgets)]),
    };
    validateConfig(this.config);
    this.runtime = createNextGenRuntime({
      fixedDeltaSeconds: this.config.fixedDeltaSeconds,
      snapshotHistory: this.config.snapshotHistory,
      ...(options.nextGen ?? {}),
    });
    this.input = new R35InputPipeline({ bufferTicks: this.config.inputBufferTicks });
    this.assets = new R35AssetOrchestrator({ maxBytes: this.config.maxAssetsBytes, maxConcurrent: this.config.maxWorkers });
    this.scheduler = new R35WorkScheduler(this.config.frameBudgets);
    this.observability = new R35Observability();
    this.limiter = new CommandRateLimiterV3();
    this.state = new R35StateStore(createRuntimeSnapshot({
      world: { tick: 0, seed: this.config.seed, entityCount: 0, activeCount: 0, loadedChunks: 0, streamingQueue: 0, weatherKey: 'clear' },
      features: this.config.features,
    }));
    this.budgets = phaseBudgetMap(this.config.frameBudgets);
  }

  get mode(): RuntimeMode {
    return this.#mode;
  }

  get tick(): number {
    return this.#tick;
  }

  start(): void {
    if (this.#mode === 'running') return;
    const from = this.#mode;
    this.#mode = 'running';
    this.#started = true;
    this.emitEvent({ type: 'runtime.mode', from, to: 'running', reason: 'application-start' });
  }

  pause(reason = 'manual-pause'): void {
    if (this.#mode !== 'running') return;
    const from = this.#mode;
    this.#mode = 'paused';
    this.emitEvent({ type: 'runtime.mode', from, to: 'paused', reason });
  }

  resume(reason = 'manual-resume'): void {
    if (this.#mode !== 'paused') return;
    const from = this.#mode;
    this.#mode = 'running';
    this.emitEvent({ type: 'runtime.mode', from, to: 'running', reason });
  }

  stop(reason = 'application-stop'): void {
    if (this.#mode === 'stopped') return;
    const from = this.#mode;
    this.#mode = 'stopped';
    this.emitEvent({ type: 'runtime.mode', from, to: 'stopped', reason });
  }

  createPlayer(): number {
    const id = this.runtime.createPlayer();
    this.#playerId = id;
    this.syncSnapshot(0);
    return id;
  }

  enqueueInput(sample: RawInputSample): void {
    if (!this.config.features.accessibility && sample.device === 'touch') return;
    this.input.enqueue(sample);
  }

  queueCommand(command: R35Command): boolean {
    const result = validateRuntimeCommand(command, this.limiter);
    this.emitEvent({
      type: 'network.command',
      entityId: command.entityId,
      commandType: command.type,
      accepted: result.accepted,
    });
    if (!result.accepted) {
      this.observability.increment('rejected-commands');
      this.state.patch({
        label: 'network-command-rejected',
        apply: (snapshot) => ({
          ...snapshot,
          network: { ...snapshot.network, rejectedCommands: snapshot.network.rejectedCommands + 1 },
        }),
      });
    }
    return result.accepted;
  }

  declareAsset(
    key: string,
    uri: string,
    options: { byteSize?: number; priority?: R35AssetApplicationPriority; dependencies?: readonly string[]; tags?: readonly string[] } = {},
  ): void {
    this.assets.declare({
      key,
      uri,
      byteSize: options.byteSize,
      priority: options.priority ?? 'normal',
      dependencies: options.dependencies ?? [],
      tags: options.tags ?? [],
      tick: this.#tick,
    });
  }

  async frame(fetcher: typeof fetch = fetch): Promise<R35ApplicationFrame> {
    if (!this.#started) this.start();
    if (this.#mode !== 'running') throw new Error('runtime is not running');
    const frameStart = performance.now();
    this.#tick += 1;

    const inputStart = performance.now();
    const normalizedInput = this.input.normalize(this.#tick);
    const input = this.input.toRuntimeFrame(this.#tick, 'mixed');
    this.observability.sample('input', this.#tick, performance.now() - inputStart, this.budgets.get('input') ?? 0);

    if (this.#playerId !== null) this.runtime.queuePlayerInput(this.#playerId, {
      tick: this.#tick,
      moveX: normalizedInput.moveX,
      moveY: normalizedInput.moveY,
      yaw: normalizedInput.lookX,
      buttons: normalizedInput.buttons,
    });

    this.state.patch({
      label: 'input-frame',
      apply: (snapshot) => ({
        ...snapshot,
        tick: this.#tick,
        wallClockMs: performance.now(),
      }),
    });

    const scheduler = await this.scheduler.runTick(this.#tick);

    const runtimeStart = performance.now();
    const runtimeFrame = await this.runtime.frame(fetcher);
    this.observability.sample('simulation', this.#tick, performance.now() - runtimeStart, this.budgets.get('simulation') ?? 0);

    const health = this.observability.health(this.#mode, this.#tick, this.budgets);
    const frameMs = performance.now() - frameStart;
    this.#lastFrameMs = frameMs;

    this.syncSnapshot(frameMs);
    if (!health.ok) {
      this.emitEvent({
        type: 'health.warning',
        domain: 'telemetry',
        utilization: frameMs / 16.67,
      });
    }

    return {
      input,
      normalizedInput,
      runtimeFrame,
      scheduler,
      health,
      snapshot: this.state.state,
    };
  }

  checkpoint(): ReturnType<R35StateStore['checkpoint']> {
    return this.state.checkpoint();
  }

  restore(checkpoint: ReturnType<R35StateStore['checkpoint']>): void {
    this.state.restore(checkpoint, 'runtime-restore');
    this.#tick = this.state.state.tick;
  }

  snapshot(): R35RuntimeSnapshot {
    return structuredClone(this.state.state);
  }

  health() {
    return this.observability.health(this.#mode, this.#tick, this.budgets);
  }

  lastFrameMs(): number {
    return this.#lastFrameMs;
  }

  features(): R35FeatureSet {
    return { ...this.config.features };
  }

  private syncSnapshot(frameMs: number): void {
    const summary = this.runtime.summary();
    const player = this.#playerId === null ? null : this.runtime.getPlayerState(this.#playerId);
    const next = createRuntimeSnapshot({
      ...this.state.state,
      tick: this.#tick,
      wallClockMs: frameMs,
      mode: this.#mode,
      player: player
        ? {
            id: this.#playerId!,
            transform: {
              position: { ...player.position },
              rotation: { x: 0, y: player.yaw, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
            velocity: { ...player.velocity },
            stamina: player.stamina,
            health: player.health,
            grounded: player.grounded,
            sprinting: player.sprinting,
            crouching: player.crouching,
            dodging: player.dodging,
            yaw: player.yaw,
            inputSequence: player.tick,
          }
        : null,
      world: {
        ...this.state.state.world,
        tick: this.#tick,
        seed: this.config.seed,
        entityCount: summary.entities,
        activeCount: summary.entities,
      },
      telemetry: {
        ...this.state.state.telemetry,
        frameMs,
        simulationMs: summary.telemetry.frameP95Ms,
        entityCount: summary.entities,
      },
    });
    this.state.replace(next, 'sync-runtime-snapshot');
  }

  private emitEvent(event: Omit<R35RuntimeEvent, 'tick' | 'sequence' | 'timestampMs'>): void {
    const enriched = Object.freeze({
      ...event,
      tick: this.#tick,
      sequence: ++this.#eventSequence,
      timestampMs: performance.now(),
    }) as R35RuntimeEvent;
    this.observability.emit(enriched);
    this.state.appendEvent(enriched);
  }
}

export type R35AssetApplicationPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export function createR35Application(options?: R35ApplicationOptions): R35RuntimeApplication {
  return new R35RuntimeApplication(options);
}

export function defaultR35Config(): R35RuntimeConfig {
  return {
    ...DEFAULT_CONFIG,
    frameBudgets: Object.freeze([...DEFAULT_CONFIG.frameBudgets]),
    features: normalizeFeatureSet(DEFAULT_CONFIG.features),
  };
}

export const R35Selectors = Object.freeze({
  mode: createSelector('mode', (snapshot) => snapshot.mode),
  tick: createSelector('tick', (snapshot) => snapshot.tick),
  player: createSelector('player', (snapshot) => snapshot.player),
  healthScore: createSelector('health-score', (snapshot) => snapshot.telemetry.frameMs),
});

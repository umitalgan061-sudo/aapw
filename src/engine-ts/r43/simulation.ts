import { stableDigest, type EntityId, type RuntimeFrame, type RuntimeSnapshot, type SystemContext, type RuntimeCommand } from './contracts.ts';
import { EcsWorld } from './ecs.ts';
import { FixedStepClock, type ClockAdvance } from './clock.ts';
import { DeterministicScheduler } from './scheduler.ts';
import { SpatialGrid } from './spatial.ts';

export interface SimulationHooks {
  readonly beforeStep?: (frame: RuntimeFrame) => void;
  readonly afterStep?: (frame: RuntimeFrame) => void;
  readonly onCommand?: (command: RuntimeCommand, frame: RuntimeFrame) => void;
}

export interface SimulationAdvance {
  readonly clock: ClockAdvance;
  readonly reports: readonly ReturnType<DeterministicScheduler['run']>[];
  readonly snapshot: RuntimeSnapshot;
}

export class SimulationKernel {
  readonly world: EcsWorld;
  readonly clock: FixedStepClock;
  readonly scheduler: DeterministicScheduler;
  readonly spatial: SpatialGrid;

  #commands: RuntimeCommand[] = [];
  #events: { type: string; frame: number; tick: number; payload?: unknown }[] = [];
  #hooks: SimulationHooks;
  #lastAdvance: SimulationAdvance | null = null;

  constructor(options: {
    readonly clock?: FixedStepClock;
    readonly scheduler?: DeterministicScheduler;
    readonly spatialCellSize?: number;
    readonly hooks?: SimulationHooks;
  } = {}) {
    this.world = new EcsWorld();
    this.clock = options.clock ?? new FixedStepClock({ hz: 60, maxSubSteps: 5, maxDeltaSeconds: 0.25 });
    this.scheduler = options.scheduler ?? new DeterministicScheduler();
    this.spatial = new SpatialGrid(options.spatialCellSize ?? 32);
    this.#hooks = options.hooks ?? {};
  }

  enqueue(command: RuntimeCommand): void {
    this.#commands.push(command);
  }

  emit(type: string, payload?: unknown): void {
    if (this.#events.length >= 4096) return;
    this.#events.push({
      type,
      frame: this.clock.frame(),
      tick: this.clock.tick(),
      payload,
    });
  }

  eventsSince(frame: number): readonly { type: string; frame: number; tick: number; payload?: unknown }[] {
    return Object.freeze(this.#events.filter((event) => event.frame >= frame));
  }

  advance(deltaSeconds: number): SimulationAdvance {
    const clock = this.clock.advance(deltaSeconds);
    const reports: ReturnType<DeterministicScheduler['run']>[] = [];
    for (let step = 0; step < clock.steps; step += 1) {
      const frame: RuntimeFrame = Object.freeze({
        frame: clock.frame,
        tick: clock.tick - (clock.steps - step - 1),
        simTimeSeconds: clock.simTimeSeconds - (clock.steps - step - 1) * clock.stepDeltaSeconds,
        deltaSeconds: clock.stepDeltaSeconds,
        interpolationAlpha: clock.interpolationAlpha,
        droppedSteps: clock.droppedSteps,
        cpuBudgetMs: 16.67,
      });
      this.#hooks.beforeStep?.(frame);
      const commands = Object.freeze(this.#commands.splice(0));
      for (const command of commands) this.#hooks.onCommand?.(command, frame);
      const stepReports = this.scheduler.run((phase) => this.#context(frame, phase, commands));
      reports.push(stepReports);
      this.#hooks.afterStep?.(frame);
    }
    const snapshot = this.snapshot();
    this.#lastAdvance = Object.freeze({ clock, reports: Object.freeze(reports), snapshot });
    return this.#lastAdvance;
  }

  snapshot(): RuntimeSnapshot {
    const entities = this.world.aliveEntities().map((id) => {
      const components: Record<string, unknown> = {};
      for (const store of this.world.snapshot()) {
        const entry = store.entries.find(([entity]) => entity === id);
        if (entry) components[store.key] = entry[1];
      }
      return Object.freeze({ id, components });
    });
    const value = {
      version: 1,
      frame: this.clock.frame(),
      tick: this.clock.tick(),
      simTimeSeconds: this.clock.simTimeSeconds(),
      entities,
    };
    return Object.freeze({
      ...value,
      digest: stableDigest(value),
    });
  }

  restore(snapshot: RuntimeSnapshot): void {
    this.clock.reset(snapshot.frame, snapshot.tick, snapshot.simTimeSeconds);
    const stores = new Map<string, Map<number, unknown>>();
    for (const entity of snapshot.entities) {
      for (const [key, value] of Object.entries(entity.components)) {
        const store = stores.get(key) ?? new Map<number, unknown>();
        store.set(entity.id, value);
        stores.set(key, store);
      }
    }
    this.world.restore({
      entities: snapshot.entities.map((entity) => entity.id),
      stores: [...stores.entries()].map(([key, map]) => ({
        key,
        entries: [...map.entries()].sort(([a], [b]) => a - b),
      })),
    });
  }

  lastAdvance(): SimulationAdvance | null {
    return this.#lastAdvance;
  }

  #context(frame: RuntimeFrame, phase: Parameters<DeterministicScheduler['run']>[0], commands: readonly RuntimeCommand[]): SystemContext {
    return Object.freeze({
      frame,
      budget: Object.freeze({
        targetFrameMs: frame.cpuBudgetMs,
        simulationMs: 4,
        renderMs: 8,
        streamingMs: 2,
        networkMs: 1,
        scriptingMs: 1.67,
      }),
      phase,
      commands,
      emit: (event) => this.emit(event.type, event.payload),
    });
  }
}

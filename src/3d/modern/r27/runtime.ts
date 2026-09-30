import {
  type InputFrame,
  type RuntimeBudget,
  type RuntimeEvent,
  type RuntimeSnapshot,
  type RuntimeTick,
  type SnapshotEntity,
  identityTransform,
  zeroInputFrame,
} from './contracts.ts';
import { DeterministicAiDirector } from './ai.ts';
import { EntityWorld } from './ecs.ts';
import { FixedStepAccumulator, DeterministicSystemScheduler } from './deterministicScheduler.ts';
import { DialogueRuntime } from './dialogue.ts';
import { AdaptiveQualityController, RollingPerformance, type PerformanceSample } from './performance.ts';
import { SnapshotBuffer } from './network.ts';

export interface R27RuntimeConfig {
  readonly tickRate: number;
  readonly maxStepsPerFrame: number;
  readonly budget: Partial<RuntimeBudget>;
  readonly qualityLevel: 0 | 1 | 2 | 3 | 4;
}

export interface R27FrameResult {
  readonly accumulator: {
    readonly steps: number;
    readonly alpha: number;
    readonly droppedSeconds: number;
    readonly simulationTimeSeconds: number;
  };
  readonly events: readonly RuntimeEvent[];
  readonly snapshot: RuntimeSnapshot;
  readonly qualityLevel: 0 | 1 | 2 | 3 | 4;
}

function stableSnapshotChecksum(snapshot: Omit<RuntimeSnapshot, 'checksum'>): string {
  let hash = 2166136261 >>> 0;
  const source = JSON.stringify(snapshot);
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export class R27Runtime {
  readonly config: R27RuntimeConfig;
  readonly world = new EntityWorld();
  readonly scheduler: DeterministicSystemScheduler;
  readonly ai = new DeterministicAiDirector();
  readonly performance = new RollingPerformance();
  readonly quality: AdaptiveQualityController;
  readonly snapshots = new SnapshotBuffer();

  #accumulator: FixedStepAccumulator;
  #tickIndex = 0;
  #simulationTime = 0;
  #input: InputFrame = zeroInputFrame(0);
  #events: RuntimeEvent[] = [];
  #dialogues = new Map<string, DialogueRuntime>();

  constructor(config: Partial<R27RuntimeConfig> = {}) {
    const tickRate = Math.max(1, config.tickRate ?? 60);
    this.config = Object.freeze({
      tickRate,
      maxStepsPerFrame: Math.max(1, Math.floor(config.maxStepsPerFrame ?? 5)),
      budget: config.budget ?? {},
      qualityLevel: config.qualityLevel ?? 2,
    });
    this.scheduler = new DeterministicSystemScheduler(this.config.budget);
    this.quality = new AdaptiveQualityController(this.config.qualityLevel);
    this.#accumulator = new FixedStepAccumulator(1 / tickRate, this.config.maxStepsPerFrame);
  }

  setInput(input: InputFrame): void {
    if (input.tick < this.#tickIndex) return;
    this.#input = {
      ...input,
      tick: Math.max(input.tick, this.#tickIndex),
      move: {
        x: Math.max(-1, Math.min(1, Number.isFinite(input.move.x) ? input.move.x : 0)),
        y: Math.max(-1, Math.min(1, Number.isFinite(input.move.y) ? input.move.y : 0)),
      },
      look: {
        x: Math.max(-1, Math.min(1, Number.isFinite(input.look.x) ? input.look.x : 0)),
        y: Math.max(-1, Math.min(1, Number.isFinite(input.look.y) ? input.look.y : 0)),
      },
      buttons: [...new Set(input.buttons.map((button) => button.slice(0, 32)))].sort(),
      analog: Object.fromEntries(
        Object.entries(input.analog)
          .filter(([key, value]) => key.length <= 32 && Number.isFinite(value))
          .map(([key, value]) => [key, Math.max(-1, Math.min(1, value))]),
      ),
    };
  }

  registerDialogue(id: string, dialogue: DialogueRuntime): void {
    this.#dialogues.set(id, dialogue);
  }

  addEvent(event: RuntimeEvent): void {
    this.#events.push(event);
  }

  runFrame(deltaSeconds: number): R27FrameResult {
    const accumulator = this.#accumulator.advance(deltaSeconds);
    const frameEvents: RuntimeEvent[] = [...this.#events];
    this.#events = [];

    for (let step = 0; step < accumulator.steps; step++) {
      const tick: RuntimeTick = {
        index: this.#tickIndex,
        dtSeconds: 1 / this.config.tickRate,
        simulationTimeSeconds: this.#simulationTime,
      };
      const result = this.scheduler.run(tick, this.#input, (event) => frameEvents.push(event));
      frameEvents.push(...result.events);
      const commandEvents = this.world.flushCommands(this.scheduler.budget.maxCommands);
      frameEvents.push(...commandEvents);
      this.#tickIndex++;
      this.#simulationTime += tick.dtSeconds;
    }

    const snapshot = this.createSnapshot();
    if (accumulator.droppedSeconds > 0) {
      frameEvents.push({
        type: 'incident',
        code: 'R27_SPIRAL_GUARD',
        severity: 'warning',
        detail: `Dropped ${accumulator.droppedSeconds.toFixed(4)} simulation seconds`,
      });
    }
    return {
      accumulator,
      events: frameEvents,
      snapshot,
      qualityLevel: this.quality.level,
    };
  }

  samplePerformance(sample: PerformanceSample): { readonly changed: boolean; readonly level: 0 | 1 | 2 | 3 | 4 } {
    this.performance.push(sample);
    const decision = this.quality.update(sample);
    return { changed: decision.changed, level: decision.level };
  }

  createSnapshot(): RuntimeSnapshot {
    const entities: SnapshotEntity[] = this.world.aliveEntities().map((id) => ({
      id,
      transform: identityTransform(),
      tags: [],
    }));
    const draft = {
      schema: 1 as const,
      tick: this.#tickIndex,
      timeSeconds: this.#simulationTime,
      entities,
      qualityLevel: this.quality.level,
    };
    return { ...draft, checksum: stableSnapshotChecksum(draft) };
  }

  currentTick(): number {
    return this.#tickIndex;
  }

  simulationTimeSeconds(): number {
    return this.#simulationTime;
  }
}

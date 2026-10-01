import type {
  EntityKind,
  InputFrame,
  RenderFrame,
  RuntimeCommand,
  RuntimeConfig,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeMetrics,
  SaveEnvelope,
  Vec3,
} from './types.ts';
import { DeterministicClockR37 } from './deterministicClock.ts';
import { CommandBusR37 } from './commandBus.ts';
import { InputModelR37, mergeInputFrames } from './inputModel.ts';
import { WorldStateR37 } from './worldState.ts';
import { SpatialIndexR37 } from './spatialIndex.ts';
import { RenderFrameBuilderR37 } from './renderFrame.ts';
import { NetworkStateR37 } from './networkState.ts';
import { SaveStateR37 } from './saveState.ts';
import { BudgetControllerR37, defaultRuntimeBudget } from './budgetController.ts';
import { RuntimeGuardR37 } from './runtimeGuard.ts';
import { clamp, finite, vec3 } from './math.ts';

export interface RuntimeStepResult {
  readonly steppedTicks: number;
  readonly frame: RenderFrame;
  readonly health: RuntimeHealth;
  readonly metrics: RuntimeMetrics;
  readonly events: readonly RuntimeEvent[];
}

export interface RuntimeHooks {
  readonly onSimulationTick?: (tick: number, deltaSeconds: number, commands: readonly RuntimeCommand[]) => void;
  readonly onRenderFrame?: (frame: RenderFrame) => void;
  readonly onQualityChange?: (quality: RuntimeConfig['initialQuality']) => void;
}

export class UnifiedRuntimeR37 {
  readonly config: RuntimeConfig;
  readonly clock: DeterministicClockR37;
  readonly commands: CommandBusR37;
  readonly input: InputModelR37;
  readonly world: WorldStateR37;
  readonly spatial: SpatialIndexR37;
  readonly renderer: RenderFrameBuilderR37;
  readonly network: NetworkStateR37;
  readonly saves: SaveStateR37;
  readonly budget: BudgetControllerR37;
  readonly guard: RuntimeGuardR37;
  #frameId = 0;
  #lastFrameMs = 0;
  #lastEvents: RuntimeEvent[] = [];
  #hooks: RuntimeHooks;

  constructor(config: Partial<RuntimeConfig> = {}, hooks: RuntimeHooks = {}) {
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
    });
    this.clock = new DeterministicClockR37({
      fixedStepSeconds: this.config.fixedStepSeconds,
      maxCatchUpSteps: this.config.maxCatchUpSteps,
    });
    this.commands = new CommandBusR37({
      historyCapacity: this.config.commandHistoryCapacity,
      maxCommandsPerTick: this.config.maxCommandsPerTick,
    });
    this.input = new InputModelR37();
    this.world = new WorldStateR37({ seed: this.config.seed, entityCapacity: this.config.maxEntities });
    this.spatial = new SpatialIndexR37();
    this.renderer = new RenderFrameBuilderR37();
    this.network = new NetworkStateR37({ role: this.config.networkRole, snapshotCapacity: this.config.snapshotHistoryCapacity });
    this.saves = new SaveStateR37();
    this.budget = new BudgetControllerR37(this.config.initialQuality);
    this.guard = new RuntimeGuardR37();
    this.#hooks = hooks;
    this.world.setMode('running');
    this.guard.setMode('running');
  }

  get frameId(): number {
    return this.#frameId;
  }

  get quality(): RuntimeConfig['initialQuality'] {
    return this.budget.quality;
  }

  registerEntity(input: {
    readonly id: string;
    readonly kind: EntityKind;
    readonly position?: Vec3;
    readonly rotation?: Vec3;
    readonly scale?: Vec3;
    readonly tags?: readonly string[];
    readonly data?: Readonly<Record<string, unknown>>;
  }): boolean {
    const entity = this.world.entities.create(input);
    if (!entity) return false;
    this.spatial.upsert(entity.id, entity.transform.position);
    return true;
  }

  updateEntity(id: string, patch: Parameters<WorldStateR37['entities']['patch']>[1]): boolean {
    const entity = this.world.entities.patch(id, patch);
    if (!entity) return false;
    this.spatial.upsert(entity.id, entity.transform.position);
    return true;
  }

  removeEntity(id: string): boolean {
    const removed = this.world.entities.remove(id);
    if (removed) this.spatial.remove(id);
    return removed;
  }

  pushInput(raw: Omit<InputFrame, 'sequence'>): InputFrame {
    return this.input.push(raw);
  }

  dispatchCommand(input: Omit<RuntimeCommand, 'id' | 'sequence'>): RuntimeCommand | null {
    const receipt = this.commands.dispatch(input);
    return receipt.accepted ? receipt.command : null;
  }

  step(frameDeltaSeconds: number, cameraPosition: Vec3): RuntimeStepResult {
    const started = nowMs();
    this.#lastEvents = [];
    const events: RuntimeEvent[] = [];
    const off = this.commands.onEvent((event) => events.push(event));
    const steppedTicks = this.clock.pushFrameDelta(frameDeltaSeconds, (step) => this.#simulate(step.tick, step.deltaSeconds));
    off();
    this.#frameId += 1;
    const renderStart = nowMs();
    const frame = this.renderer.build(this.world.entities.activeValues(), {
      frameId: this.#frameId,
      tick: this.clock.tick,
      alpha: this.clock.alpha,
      cameraPosition,
      qualityScale: qualityScaleFor(this.budget.quality),
    });
    const renderMs = Math.max(0, nowMs() - renderStart);
    const totalMs = Math.max(0, nowMs() - started);
    const metrics: RuntimeMetrics = Object.freeze({
      frameMs: totalMs,
      simulationMs: Math.max(0, totalMs - renderMs),
      renderMs,
      networkMs: 0,
      assetMs: 0,
      entities: this.world.entities.count(),
      commands: this.commands.commandsForTick(this.clock.tick).length,
      droppedTicks: this.clock.snapshot().droppedSteps,
      memoryPressure: memoryPressureEstimate(this.world.entities.count(), this.config.maxEntities),
      quality: this.budget.quality,
    });
    const decision = this.budget.observe(metrics, defaultRuntimeBudget(this.budget.quality));
    if (decision.changed) this.#hooks.onQualityChange?.(decision.quality);
    const health = this.guard.observe(metrics);
    this.#hooks.onRenderFrame?.(frame);
    this.#lastEvents = events;
    return Object.freeze({ steppedTicks, frame, health, metrics, events: Object.freeze(events) });
  }

  save(slot = 'autosave'): SaveEnvelope {
    const envelope = this.saves.createEnvelope(this.world, this.input.sequence(), { quality: this.budget.quality, slot });
    if (!this.saves.write(slot, envelope)) throw new Error('failed to persist runtime save');
    return envelope;
  }

  load(slot = 'autosave'): boolean {
    const envelope = this.saves.read(slot);
    if (!envelope) return false;
    this.saves.restore(this.world, envelope);
    this.spatial.clear();
    for (const entity of this.world.entities.values()) this.spatial.upsert(entity.id, entity.transform.position);
    return true;
  }

  eventLog(): readonly RuntimeEvent[] {
    return Object.freeze([...this.#lastEvents]);
  }

  health(): RuntimeHealth {
    return this.guard.snapshot();
  }

  dispose(): void {
    this.world.setMode('disposed');
    this.guard.dispose();
    this.spatial.clear();
    this.commands.clearBefore(Number.MAX_SAFE_INTEGER);
  }

  #simulate(tick: number, deltaSeconds: number): void {
    this.world.advance(tick);
    const frames = this.input.consumeThrough(tick);
    const merged = mergeInputFrames(frames);
    const move = merged.move;
    const player = this.world.entities.byKind('player')[0];
    if (player && (move.x !== 0 || move.y !== 0)) {
      const speed = merged.sprint ? 8 : 4;
      this.updateEntity(player.id, {
        transform: {
          position: vec3(
            player.transform.position.x + move.x * speed * deltaSeconds,
            player.transform.position.y,
            player.transform.position.z + move.y * speed * deltaSeconds,
          ),
        },
      });
    }
    const commands = this.commands.commandsForTick(tick);
    this.#hooks.onSimulationTick?.(tick, deltaSeconds, commands);
    for (const command of commands) {
      this.#lastEvents.push(this.commands.emit(tick, `command:${command.kind}`, command.source, command.payload));
    }
  }
}

function qualityScaleFor(quality: RuntimeConfig['initialQuality']): number {
  switch (quality) {
    case 'minimal': return 0.55;
    case 'low': return 0.7;
    case 'balanced': return 0.9;
    case 'high': return 1;
    case 'ultra': return 1.15;
  }
}

function memoryPressureEstimate(entities: number, maxEntities: number): number {
  return clamp(maxEntities > 0 ? entities / maxEntities : 0, 0, 1);
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

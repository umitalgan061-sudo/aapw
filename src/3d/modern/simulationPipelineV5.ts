import { type TickId, type Vec3V4, tickId, vec3V4, clampV4 } from './runtimeContractsV4';
import { EcsWorldV5, type EntityHandleV5, type MovementCommandV5 } from './ecsWorldV5';

export interface SimulationConfigV5 {
  readonly fixedStepMs?: number;
  readonly maxStepsPerFrame?: number;
  readonly maxFrameDeltaMs?: number;
  readonly timeScale?: number;
}

export interface SimulationFrameV5 {
  readonly frame: number;
  readonly tick: TickId;
  readonly steps: number;
  readonly alpha: number;
  readonly simulatedMs: number;
  readonly droppedMs: number;
}

export interface SimulationEntityStateV5 {
  readonly entity: EntityHandleV5;
  readonly position: Vec3V4;
  readonly velocity: Vec3V4;
  readonly grounded: boolean;
  readonly health: number;
  readonly stamina: number;
}

export interface SimulationMetricsV5 {
  readonly frames: number;
  readonly ticks: number;
  readonly totalSimulatedMs: number;
  readonly droppedMs: number;
  readonly catchUpFrames: number;
  readonly maxStepsObserved: number;
  readonly timeScale: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class SimulationPipelineV5 {
  readonly fixedStepMs: number;
  readonly maxStepsPerFrame: number;
  readonly maxFrameDeltaMs: number;
  #timeScale: number;
  #accumulator = 0;
  #tick = 0;
  #frame = 0;
  #lastAt = 0;
  #droppedMs = 0;
  #frames = 0;
  #totalSimulatedMs = 0;
  #catchUpFrames = 0;
  #maxStepsObserved = 0;
  #commands = new Map<EntityHandleV5, MovementCommandV5>();

  constructor(public readonly world: EcsWorldV5, options: SimulationConfigV5 = {}, now = () => performance.now()) {
    this.fixedStepMs = Math.max(1, finite(options.fixedStepMs ?? 1000 / 60, 16.67));
    this.maxStepsPerFrame = Math.max(1, Math.trunc(options.maxStepsPerFrame ?? 5));
    this.maxFrameDeltaMs = Math.max(this.fixedStepMs, finite(options.maxFrameDeltaMs ?? 250, 250));
    this.#timeScale = clampV4(finite(options.timeScale ?? 1, 1), 0, 4);
    this.#lastAt = now();
    this.#now = now;
  }
  #now: () => number;

  setTimeScale(scale: number): void { this.#timeScale = clampV4(finite(scale, 1), 0, 4); }
  timeScale(): number { return this.#timeScale; }
  tick(): TickId { return tickId(this.#tick); }
  frame(): number { return this.#frame; }

  setCommand(entity: EntityHandleV5, command: MovementCommandV5): void { this.#commands.set(entity, Object.freeze({ ...command, direction: vec3V4(command.direction.x, command.direction.y, command.direction.z) })); }
  clearCommands(): void { this.#commands.clear(); }

  advance(deltaMs?: number): SimulationFrameV5 {
    const now = this.#now();
    const measured = Math.max(0, now - this.#lastAt);
    this.#lastAt = now;
    const sourceDelta = Math.max(0, finite(deltaMs ?? measured));
    const scaled = sourceDelta * this.#timeScale;
    const delta = Math.min(this.maxFrameDeltaMs, scaled);
    this.#droppedMs += Math.max(0, scaled - delta);
    this.#accumulator += delta;
    this.#frame += 1;
    this.#frames += 1;
    let steps = 0;
    while (this.#accumulator >= this.fixedStepMs && steps < this.maxStepsPerFrame) {
      this.#accumulator -= this.fixedStepMs;
      this.#step();
      steps += 1;
    }
    if (steps === this.maxStepsPerFrame && this.#accumulator >= this.fixedStepMs) {
      this.#droppedMs += this.#accumulator;
      this.#accumulator = 0;
      this.#catchUpFrames += 1;
    }
    this.#maxStepsObserved = Math.max(this.#maxStepsObserved, steps);
    return Object.freeze({ frame: this.#frame, tick: tickId(this.#tick), steps, alpha: clampV4(this.#accumulator / this.fixedStepMs, 0, 1), simulatedMs: steps * this.fixedStepMs, droppedMs: this.#droppedMs });
  }

  simulateEntity(entity: EntityHandleV5, command: MovementCommandV5, steps = 1): number {
    let applied = 0;
    for (let index = 0; index < Math.max(0, Math.trunc(steps)); index += 1) if (this.world.move(entity, command, this.fixedStepMs / 1000, tickId(this.#tick + 1))) applied += 1;
    return applied;
  }

  state(entity: EntityHandleV5): SimulationEntityStateV5 | null {
    const value = this.world.resolve(entity);
    if (!value) return null;
    return Object.freeze({ entity, position: value.transform.transform.position, velocity: value.velocity.velocity, grounded: value.controller.grounded, health: value.health.current, stamina: value.stamina.current });
  }

  snapshotEntities(): readonly SimulationEntityStateV5[] {
    const states: SimulationEntityStateV5[] = [];
    this.world.forEach((entity) => states.push(Object.freeze({ entity: entity.handle, position: entity.transform.transform.position, velocity: entity.velocity.velocity, grounded: entity.controller.grounded, health: entity.health.current, stamina: entity.stamina.current })));
    states.sort((a, b) => Number(a.entity.id) - Number(b.entity.id));
    return Object.freeze(states);
  }

  metrics(): SimulationMetricsV5 { return Object.freeze({ frames: this.#frames, ticks: this.#tick, totalSimulatedMs: this.#totalSimulatedMs, droppedMs: this.#droppedMs, catchUpFrames: this.#catchUpFrames, maxStepsObserved: this.#maxStepsObserved, timeScale: this.#timeScale }); }

  reset(): void { this.#accumulator = 0; this.#tick = 0; this.#frame = 0; this.#lastAt = this.#now(); this.#droppedMs = 0; this.#frames = 0; this.#totalSimulatedMs = 0; this.#catchUpFrames = 0; this.#maxStepsObserved = 0; this.#commands.clear(); }

  #step(): void {
    this.#tick += 1;
    const entities = [...this.#commands.entries()].sort((a, b) => Number(a[0].id) - Number(b[0].id));
    for (const [entity, command] of entities) {
      const moved = this.world.move(entity, command, this.fixedStepMs / 1000, tickId(this.#tick));
      this.world.tickStamina(entity, command.sprint, this.fixedStepMs / 1000);
      if (moved) this.#totalSimulatedMs += this.fixedStepMs;
    }
  }
}

export function createSimulationPipelineV5(world: EcsWorldV5, options: SimulationConfigV5 = {}, now?: () => number): SimulationPipelineV5 { return new SimulationPipelineV5(world, options, now); }

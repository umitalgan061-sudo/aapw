import {
  clampNumber,
  type EntityId,
  type InputFrame,
  type RuntimeBudget,
  type SimulationContext,
  type SystemContext,
  type SystemMetrics,
  type Tick,
  type Vec3,
} from './coreContracts';
import { FixedStepClock, tickDigest } from './deterministicKernel';
import { EntityRegistryV3, V3_HEALTH, V3_POSITION, V3_VELOCITY } from './ecsV3';

export interface SimulationSystem {
  readonly id: string;
  readonly phase: 'input' | 'simulation' | 'network' | 'streaming' | 'animation';
  readonly priority: 0 | 1 | 2 | 3 | 4 | 5;
  readonly estimatedMs: number;
  readonly enabled?: (context: SystemContext) => boolean;
  readonly update: (world: EntityRegistryV3, context: SystemContext) => void;
}

export interface SimulationFrameResult {
  readonly tick: Tick;
  readonly steps: number;
  readonly droppedSeconds: number;
  readonly digest: number;
  readonly systems: readonly SystemMetrics[];
  readonly entityUpdates: number;
}

interface MutableSystemMetrics {
  id: string;
  updates: number;
  skipped: number;
  lastDurationMs: number;
  totalDurationMs: number;
}

export interface CharacterMotion {
  readonly maxSpeed: number;
  readonly acceleration: number;
  readonly friction: number;
  readonly gravity: number;
  readonly jumpVelocity: number;
  readonly terminalVelocity: number;
}

const DEFAULT_MOTION: CharacterMotion = {
  maxSpeed: 5.5,
  acceleration: 28,
  friction: 18,
  gravity: 24,
  jumpVelocity: 8.5,
  terminalVelocity: 30,
};

export const BUTTON_JUMP = 1 << 0;
export const BUTTON_SPRINT = 1 << 1;
export const BUTTON_ATTACK = 1 << 2;
export const BUTTON_DODGE = 1 << 3;

export interface InputState {
  readonly frame: InputFrame;
  readonly jumpPressed: boolean;
  readonly sprintHeld: boolean;
  readonly attackPressed: boolean;
  readonly dodgePressed: boolean;
}

export function decodeInput(input: InputFrame): InputState {
  return {
    frame: input,
    jumpPressed: (input.buttons & BUTTON_JUMP) !== 0,
    sprintHeld: (input.buttons & BUTTON_SPRINT) !== 0,
    attackPressed: (input.buttons & BUTTON_ATTACK) !== 0,
    dodgePressed: (input.buttons & BUTTON_DODGE) !== 0,
  };
}

function approach(current: number, target: number, delta: number): number {
  if (current < target) return Math.min(target, current + delta);
  if (current > target) return Math.max(target, current - delta);
  return target;
}

export function integrateAxis(current: number, target: number, acceleration: number, friction: number, dt: number): number {
  const rate = Math.abs(target) > 0.0001 ? acceleration : friction;
  return approach(current, target, rate * dt);
}

export function integrateCharacterMotion(
  position: Vec3,
  velocity: Vec3,
  input: InputState,
  dt: number,
  grounded: boolean,
  motion: CharacterMotion = DEFAULT_MOTION,
): { position: Vec3; velocity: Vec3; grounded: boolean; jumped: boolean } {
  const sprintMultiplier = input.sprintHeld ? 1.35 : 1;
  const targetX = clampNumber(input.frame.moveX, -1, 1) * motion.maxSpeed * sprintMultiplier;
  const targetZ = clampNumber(input.frame.moveZ, -1, 1) * motion.maxSpeed * sprintMultiplier;
  let vx = integrateAxis(velocity.x, targetX, motion.acceleration, motion.friction, dt);
  let vz = integrateAxis(velocity.z, targetZ, motion.acceleration, motion.friction, dt);
  let vy = velocity.y;
  let nextGrounded = grounded;
  let jumped = false;

  if (grounded) {
    vy = 0;
    if (input.jumpPressed) {
      vy = motion.jumpVelocity;
      nextGrounded = false;
      jumped = true;
    }
  } else {
    vy = Math.max(-motion.terminalVelocity, vy - motion.gravity * dt);
  }

  return {
    position: {
      x: position.x + vx * dt,
      y: position.y + vy * dt,
      z: position.z + vz * dt,
    },
    velocity: { x: vx, y: vy, z: vz },
    grounded: nextGrounded,
    jumped,
  };
}

export interface MotionComponent {
  readonly grounded: boolean;
  readonly coyoteTicks: number;
  readonly jumpBufferTicks: number;
  readonly sprint: number;
}

export const V3_MOTION = 'motion.character' as any;

export function createMotionSystem(options: {
  readonly inputByEntity: (entity: EntityId, context: SystemContext) => InputState | undefined;
  readonly groundedResolver?: (position: Vec3) => boolean;
  readonly motion?: CharacterMotion;
}): SimulationSystem {
  const motion = options.motion ?? DEFAULT_MOTION;
  return {
    id: 'simulation.character-motion',
    phase: 'simulation',
    priority: 1,
    estimatedMs: 0.08,
    update: (world, context) => {
      const query = world.query({ all: [V3_POSITION.type as any, V3_VELOCITY.type as any] });
      for (const entity of query.entities) {
        const position = world.unsafeGet<Vec3>(entity, V3_POSITION.type as any);
        const velocity = world.unsafeGet<Vec3>(entity, V3_VELOCITY.type as any);
        if (!position || !velocity) continue;
        const input = options.inputByEntity(entity, context);
        if (!input) continue;
        const grounded = options.groundedResolver?.(position) ?? position.y <= 0;
        const result = integrateCharacterMotion(position, velocity, input, context.clock.deltaSeconds, grounded, motion);
        world.set(entity, V3_POSITION.type as any, result.position);
        world.set(entity, V3_VELOCITY.type as any, result.velocity);
      }
    },
  };
}

export function createHealthSystem(): SimulationSystem {
  return {
    id: 'simulation.health-clamp',
    phase: 'simulation',
    priority: 0,
    estimatedMs: 0.03,
    update: (world) => {
      for (const entity of world.query({ all: [V3_HEALTH.type] }).entities) {
        const health = world.unsafeGet<{ current: number; max: number }>(entity, V3_HEALTH.type);
        if (!health) continue;
        const max = Math.max(0, health.max);
        const current = clampNumber(health.current, 0, max);
        if (current !== health.current || max !== health.max) world.set(entity, V3_HEALTH.type, { current, max });
        world.enable(entity, current > 0);
      }
    },
  };
}

export class SimulationPipeline {
  readonly world: EntityRegistryV3;
  readonly clock: FixedStepClock;
  #systems: SimulationSystem[] = [];
  #metrics = new Map<string, MutableSystemMetrics>();
  #frameInputs: readonly InputFrame[] = [];
  #lastDigest = 0;
  #entityUpdates = 0;
  #budget: RuntimeBudget;
  #mode: SimulationContext['mode'];

  constructor(options: {
    readonly world?: EntityRegistryV3;
    readonly fixedDeltaSeconds?: number;
    readonly maxCatchUpSteps?: number;
    readonly budget?: RuntimeBudget;
    readonly mode?: SimulationContext['mode'];
  } = {}) {
    this.world = options.world ?? new EntityRegistryV3();
    this.clock = new FixedStepClock({
      fixedDeltaSeconds: options.fixedDeltaSeconds ?? 1 / 60,
      maxCatchUpSteps: options.maxCatchUpSteps ?? 5,
      maxFrameDeltaSeconds: 0.25,
    });
    this.#budget = options.budget ?? {
      simulationMs: 6,
      renderMs: 8,
      streamingMs: 3,
      networkMs: 2,
      persistenceMs: 1,
      maxTasks: 64,
      maxEntityUpdates: 25000,
    };
    this.#mode = options.mode ?? 'local';
    this.ensureDefaultComponents();
  }

  ensureDefaultComponents(): void {
    const definitions = [V3_POSITION, V3_VELOCITY, V3_HEALTH];
    for (const definition of definitions) {
      try {
        this.world.register(definition);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('already registered')) throw error;
      }
    }
  }

  addSystem(system: SimulationSystem): void {
    if (this.#systems.some((entry) => entry.id === system.id)) throw new Error(`Duplicate simulation system: ${system.id}`);
    this.#systems.push(system);
    this.#systems.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    this.#metrics.set(system.id, { id: system.id, updates: 0, skipped: 0, lastDurationMs: 0, totalDurationMs: 0 });
  }

  removeSystem(id: string): boolean {
    const before = this.#systems.length;
    this.#systems = this.#systems.filter((system) => system.id !== id);
    this.#metrics.delete(id);
    return this.#systems.length !== before;
  }

  setInputs(inputs: readonly InputFrame[]): void {
    this.#frameInputs = inputs.map((input) => structuredClone(input));
  }

  step(realDeltaSeconds: number): SimulationFrameResult {
    this.#entityUpdates = 0;
    const result = this.clock.advance(realDeltaSeconds, (clockState) => {
      const context: SystemContext = {
        clock: clockState,
        input: this.#frameInputs,
        budget: this.#budget,
        mode: this.#mode,
        phase: 'simulation',
        lane: this.#mode === 'server' ? 'server' : 'main',
      };
      for (const system of this.#systems) {
        const metrics = this.#metrics.get(system.id)!;
        const start = performance.now();
        if (system.enabled && !system.enabled(context)) {
          metrics.skipped += 1;
          continue;
        }
        if (metrics.totalDurationMs >= this.#budget.simulationMs && system.priority < 4) {
          metrics.skipped += 1;
          continue;
        }
        system.update(this.world, context);
        const duration = performance.now() - start;
        metrics.updates += 1;
        metrics.lastDurationMs = duration;
        metrics.totalDurationMs += duration;
      }
      this.world.flushDeferred();
      this.#entityUpdates += this.world.entityCount();
      const values: number[] = [];
      for (const entity of this.world.query({ all: [V3_POSITION.type] }).entities) {
        const p = this.world.unsafeGet<Vec3>(entity, V3_POSITION.type);
        if (p) values.push(p.x, p.y, p.z);
      }
      this.#lastDigest = tickDigest({ tick: clockState.tick, values, labels: this.#systems.map((system) => system.id) });
    });

    return {
      tick: this.clock.state().tick,
      steps: result.steps,
      droppedSeconds: result.droppedSeconds,
      digest: this.#lastDigest,
      systems: this.systemMetrics(),
      entityUpdates: this.#entityUpdates,
    };
  }

  context(): SimulationContext {
    return {
      clock: this.clock.state(),
      input: this.#frameInputs,
      budget: this.#budget,
      mode: this.#mode,
    };
  }

  digest(): number {
    return this.#lastDigest;
  }

  systemMetrics(): readonly SystemMetrics[] {
    return [...this.#metrics.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((metric) => ({
        id: metric.id,
        updates: metric.updates,
        skipped: metric.skipped,
        lastDurationMs: metric.lastDurationMs,
        totalDurationMs: metric.totalDurationMs,
        avgDurationMs: metric.updates === 0 ? 0 : metric.totalDurationMs / metric.updates,
      }));
  }

  reset(): void {
    this.clock.reset();
    this.#lastDigest = 0;
    this.#frameInputs = [];
    this.world.clear();
    this.ensureDefaultComponents();
    for (const metric of this.#metrics.values()) {
      metric.updates = 0;
      metric.skipped = 0;
      metric.lastDurationMs = 0;
      metric.totalDurationMs = 0;
    }
  }
}

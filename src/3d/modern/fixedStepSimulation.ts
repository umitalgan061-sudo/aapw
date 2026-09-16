import type { FrameId, Vec3 } from './types';
import { FixedStepClock, clamp01, quantize } from './deterministic';

export interface SimulationBody {
  readonly id: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly acceleration: Vec3;
  readonly maxSpeed: number;
  readonly drag: number;
  readonly grounded: boolean;
}

export interface SimulationConfig {
  readonly stepMs: number;
  readonly maxStepsPerFrame: number;
  readonly maxDeltaMs: number;
  readonly positionPrecision: number;
  readonly velocityPrecision: number;
}

export interface SimulationStepResult {
  readonly frame: FrameId;
  readonly simulatedSeconds: number;
  readonly steps: number;
  readonly droppedSeconds: number;
  readonly bodyCount: number;
}

export interface SimulationHooks {
  readonly integrate?: (body: SimulationBody, dtSeconds: number) => SimulationBody;
  readonly collision?: (body: SimulationBody) => SimulationBody;
}

const DEFAULT_CONFIG: SimulationConfig = {
  stepMs: 16.6666666667,
  maxStepsPerFrame: 8,
  maxDeltaMs: 133.3333333336,
  positionPrecision: 1000,
  velocityPrecision: 1000,
};

function boundedVector(value: Vec3): Vec3 {
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    z: Number.isFinite(value.z) ? value.z : 0,
  };
}

function integrateDefault(body: SimulationBody, dtSeconds: number, precision: number): SimulationBody {
  const acceleration = boundedVector(body.acceleration);
  const velocity = boundedVector(body.velocity);
  const nextVelocity = {
    x: velocity.x + acceleration.x * dtSeconds,
    y: velocity.y + acceleration.y * dtSeconds,
    z: velocity.z + acceleration.z * dtSeconds,
  };
  const speed = Math.hypot(nextVelocity.x, nextVelocity.z);
  const maxSpeed = Math.max(0, body.maxSpeed);
  const horizontalScale = speed > maxSpeed && maxSpeed > 0 ? maxSpeed / speed : 1;
  const dragged = Math.max(0, Math.min(1, body.drag));
  const stableVelocity = {
    x: nextVelocity.x * horizontalScale * (1 - dragged * dtSeconds),
    y: nextVelocity.y,
    z: nextVelocity.z * horizontalScale * (1 - dragged * dtSeconds),
  };
  const position = boundedVector(body.position);
  return {
    ...body,
    position: {
      x: quantize(position.x + stableVelocity.x * dtSeconds, 1 / precision),
      y: quantize(position.y + stableVelocity.y * dtSeconds, 1 / precision),
      z: quantize(position.z + stableVelocity.z * dtSeconds, 1 / precision),
    },
    velocity: {
      x: quantize(stableVelocity.x, 1 / precision),
      y: quantize(stableVelocity.y, 1 / precision),
      z: quantize(stableVelocity.z, 1 / precision),
    },
  };
}

/** Fixed-step simulation driver for player/NPC/creature movement with a strict spiral-of-death guard. */
export class FixedStepSimulation {
  readonly config: SimulationConfig;
  readonly clock: FixedStepClock;
  #bodies = new Map<string, SimulationBody>();
  #hooks: SimulationHooks;
  #lastResult: SimulationStepResult = { frame: 0 as FrameId, simulatedSeconds: 0, steps: 0, droppedSeconds: 0, bodyCount: 0 };

  constructor(options: { readonly config?: Partial<SimulationConfig>; readonly hooks?: SimulationHooks } = {}) {
    this.config = Object.freeze({ ...DEFAULT_CONFIG, ...options.config });
    this.clock = new FixedStepClock({ stepMs: this.config.stepMs });
    this.#hooks = options.hooks ?? {};
    this.#validateConfig();
  }

  upsert(body: SimulationBody): boolean {
    if (!body.id || this.#bodies.size > 100_000) return false;
    this.#bodies.set(body.id, structuredClone(body));
    return true;
  }

  remove(id: string): boolean { return this.#bodies.delete(id); }
  get(id: string): SimulationBody | undefined { const body = this.#bodies.get(id); return body ? structuredClone(body) : undefined; }
  bodies(): readonly SimulationBody[] { return [...this.#bodies.values()].sort((a, b) => a.id.localeCompare(b.id)).map((body) => structuredClone(body)); }

  advance(deltaMs: number): SimulationStepResult {
    const clamped = Math.max(0, Math.min(this.config.maxDeltaMs, Number.isFinite(deltaMs) ? deltaMs : 0));
    const droppedSeconds = Math.max(0, ((Number.isFinite(deltaMs) ? deltaMs : 0) - clamped) / 1000);
    const stepSeconds = this.config.stepMs / 1000;
    const targetSteps = Math.min(this.config.maxStepsPerFrame, Math.floor(clamped / this.config.stepMs + 1e-8));
    let simulatedSeconds = 0;
    for (let step = 0; step < targetSteps; step += 1) {
      for (const [id, body] of this.#bodies) {
        const integrated = this.#hooks.integrate?.(body, stepSeconds) ?? integrateDefault(body, stepSeconds, this.config.positionPrecision);
        const collided = this.#hooks.collision?.(integrated) ?? integrated;
        this.#bodies.set(id, {
          ...collided,
          position: boundedVector(collided.position),
          velocity: boundedVector(collided.velocity),
        });
      }
      this.clock.advance(this.config.stepMs);
      simulatedSeconds += stepSeconds;
    }
    const result: SimulationStepResult = Object.freeze({ frame: this.clock.frame(), simulatedSeconds, steps: targetSteps, droppedSeconds, bodyCount: this.#bodies.size });
    this.#lastResult = result;
    return result;
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      frame: Number(this.clock.frame()),
      bodyCount: this.#bodies.size,
      alpha: clamp01(this.clock.alpha()),
      last: this.#lastResult,
      ids: this.bodies().map((body) => body.id),
    });
  }

  clear(): void {
    this.#bodies.clear();
    this.clock.reset();
    this.#lastResult = { frame: 0 as FrameId, simulatedSeconds: 0, steps: 0, droppedSeconds: 0, bodyCount: 0 };
  }

  #validateConfig(): void {
    if (this.config.stepMs <= 0 || this.config.maxStepsPerFrame < 1 || this.config.maxDeltaMs < this.config.stepMs) throw new RangeError('Invalid fixed-step simulation configuration');
    if (this.config.positionPrecision < 1 || this.config.velocityPrecision < 1) throw new RangeError('Invalid simulation precision');
  }
}

export function createSimulation(config?: Partial<SimulationConfig>): FixedStepSimulation {
  return new FixedStepSimulation({ config });
}

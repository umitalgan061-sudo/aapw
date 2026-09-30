import type { FrameId, UnixMillis } from './types';

export interface SimulationObject {
  readonly id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  active: boolean;
}

export interface SimulationStepContext {
  readonly frame: FrameId;
  readonly stepSeconds: number;
  readonly absoluteSeconds: number;
  readonly alpha: number;
}

export interface SimulationStats {
  readonly frame: FrameId;
  readonly fixedSteps: number;
  readonly accumulatorMs: number;
  readonly droppedMs: number;
  readonly entityCount: number;
  readonly activeCount: number;
}

export interface ProductionSimulationOptions {
  readonly fixedStepMs?: number;
  readonly maxStepsPerFrame?: number;
  readonly maxFrameDeltaMs?: number;
  readonly now?: () => UnixMillis;
}

function clean(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }

/** Fixed-step integration for gameplay-critical movement; rendering can interpolate between states. */
export class ProductionSimulation {
  readonly fixedStepMs: number;
  readonly maxStepsPerFrame: number;
  readonly maxFrameDeltaMs: number;
  #now: () => UnixMillis;
  #accumulatorMs = 0;
  #absoluteSeconds = 0;
  #frame = 0 as FrameId;
  #droppedMs = 0;
  #entities = new Map<string, SimulationObject>();
  #activeCount = 0;

  constructor(options: ProductionSimulationOptions = {}) {
    this.fixedStepMs = Math.max(4, Math.min(100, options.fixedStepMs ?? 1000 / 60));
    this.maxStepsPerFrame = Math.max(1, Math.min(32, Math.trunc(options.maxStepsPerFrame ?? 8)));
    this.maxFrameDeltaMs = Math.max(this.fixedStepMs, Math.min(1000, options.maxFrameDeltaMs ?? 250));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
  }

  add(entity: SimulationObject): boolean {
    if (!entity.id || this.#entities.has(entity.id)) return false;
    if (![entity.position.x, entity.position.y, entity.position.z, entity.velocity.x, entity.velocity.y, entity.velocity.z].every(Number.isFinite)) return false;
    entity.position.x = clean(entity.position.x); entity.position.y = clean(entity.position.y); entity.position.z = clean(entity.position.z);
    entity.velocity.x = clean(entity.velocity.x); entity.velocity.y = clean(entity.velocity.y); entity.velocity.z = clean(entity.velocity.z);
    entity.active = Boolean(entity.active);
    this.#entities.set(entity.id, entity);
    if (entity.active) this.#activeCount += 1;
    return true;
  }

  remove(id: string): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    if (entity.active) this.#activeCount = Math.max(0, this.#activeCount - 1);
    return this.#entities.delete(id);
  }

  step(frameDeltaMs: number, update: (entity: SimulationObject, context: SimulationStepContext) => void): SimulationStats {
    const delta = Math.max(0, Math.min(this.maxFrameDeltaMs, Number.isFinite(frameDeltaMs) ? frameDeltaMs : this.fixedStepMs));
    if (frameDeltaMs > this.maxFrameDeltaMs) this.#droppedMs += frameDeltaMs - this.maxFrameDeltaMs;
    this.#accumulatorMs += delta;
    let steps = 0;
    while (this.#accumulatorMs >= this.fixedStepMs && steps < this.maxStepsPerFrame) {
      this.#frame = (Number(this.#frame) + 1) as FrameId;
      const stepSeconds = this.fixedStepMs / 1000;
      this.#absoluteSeconds += stepSeconds;
      const context: SimulationStepContext = { frame: this.#frame, stepSeconds, absoluteSeconds: this.#absoluteSeconds, alpha: 0 };
      for (const entity of this.#entities.values()) if (entity.active) update(entity, context);
      this.#accumulatorMs -= this.fixedStepMs;
      steps += 1;
    }
    if (steps === this.maxStepsPerFrame && this.#accumulatorMs > this.fixedStepMs * 4) {
      this.#droppedMs += this.#accumulatorMs;
      this.#accumulatorMs = 0;
    }
    return this.stats();
  }

  interpolationAlpha(): number { return Math.max(0, Math.min(1, this.#accumulatorMs / this.fixedStepMs)); }
  entity(id: string): SimulationObject | null { return this.#entities.get(id) ?? null; }
  entities(): readonly SimulationObject[] { return Object.freeze([...this.#entities.values()]); }
  stats(): SimulationStats { return Object.freeze({ frame: this.#frame, fixedSteps: Number(this.#frame), accumulatorMs: this.#accumulatorMs, droppedMs: this.#droppedMs, entityCount: this.#entities.size, activeCount: this.#activeCount }); }
  reset(): void { this.#accumulatorMs = 0; this.#absoluteSeconds = 0; this.#frame = 0 as FrameId; this.#droppedMs = 0; }
  now(): UnixMillis { return this.#now(); }
}

export function integrateVelocity(entity: SimulationObject, dtSeconds: number, gravity = -9.81): void {
  const dt = Math.max(0, Math.min(0.1, dtSeconds));
  entity.velocity.y = clean(entity.velocity.y + gravity * dt);
  entity.position.x = clean(entity.position.x + entity.velocity.x * dt);
  entity.position.y = clean(entity.position.y + entity.velocity.y * dt);
  entity.position.z = clean(entity.position.z + entity.velocity.z * dt);
}

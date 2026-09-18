import type { EntityIdV7, TickV7, Vec3V7 } from './types.ts';
import { clampV7, tickV7, vec3V7 } from './types.ts';
import { EntityStoreV7 } from './entityStore.ts';
import { SpatialIndexV7 } from './spatialIndex.ts';
import { FixedClockV7, checksumV7 } from './deterministic.ts';

export interface SimulationConfigV7 {
  readonly fixedHz: number;
  readonly maxCatchUpSteps: number;
  readonly gravity: number;
  readonly groundY: number;
  readonly staminaRegenPerSecond: number;
  readonly spatialRefreshEveryTicks: number;
}

export interface SimulationStepReportV7 {
  readonly tick: TickV7;
  readonly steps: number;
  readonly droppedSeconds: number;
  readonly actorUpdates: number;
  readonly spatialUpdates: number;
  readonly checksum: string;
}

const DEFAULT: SimulationConfigV7 = Object.freeze({
  fixedHz: 60, maxCatchUpSteps: 4, gravity: 24, groundY: 0, staminaRegenPerSecond: 12, spatialRefreshEveryTicks: 2,
});

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class DeterministicWorldSimulationV7 {
  readonly #config: SimulationConfigV7;
  readonly #clock: FixedClockV7;
  readonly #entities: EntityStoreV7;
  readonly #spatial: SpatialIndexV7;
  #lastSpatialTick = -1;

  constructor(entities: EntityStoreV7, spatial: SpatialIndexV7, config: Partial<SimulationConfigV7> = {}) {
    this.#config = Object.freeze({ ...DEFAULT, ...config });
    this.#clock = new FixedClockV7(this.#config.fixedHz);
    this.#entities = entities;
    this.#spatial = spatial;
  }

  get tick(): TickV7 { return this.#clock.tick; }

  advance(deltaSeconds: number, onEvent: (event: SimulationEventV7) => void = () => undefined): SimulationStepReportV7 {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative');
    const stepSeconds = 1 / this.#config.fixedHz;
    const maximum = stepSeconds * this.#config.maxCatchUpSteps;
    const before = this.#clock.accumulatorSeconds;
    const clamped = Math.min(deltaSeconds, maximum);
    const droppedSeconds = Math.max(0, deltaSeconds - clamped);
    const steps = this.#clock.advance(clamped, this.#config.maxCatchUpSteps);
    let actorUpdates = 0; let spatialUpdates = 0;

    for (let index = 0; index < steps; index += 1) {
      const tick = this.#clock.tick;
      const entities = this.#entities.list();
      for (const entity of entities) {
        if (entity.components.vital.health <= 0) continue;
        this.#integrateEntity(entity.id, stepSeconds, tick, onEvent);
        actorUpdates += 1;
      }
      if (Number(tick) - this.#lastSpatialTick >= this.#config.spatialRefreshEveryTicks) {
        this.#refreshSpatial();
        this.#lastSpatialTick = Number(tick);
        spatialUpdates += 1;
      }
    }
    const checksum = checksumV7({ tick: this.#clock.tick, actorUpdates, spatialUpdates, before, droppedSeconds, entities: this.#entities.digestInput() });
    return Object.freeze({ tick: this.#clock.tick, steps, droppedSeconds, actorUpdates, spatialUpdates, checksum });
  }

  reset(): void {
    this.#clock.reset();
    this.#lastSpatialTick = -1;
  }

  #integrateEntity(id: EntityIdV7, dt: number, tick: TickV7, onEvent: (event: SimulationEventV7) => void): void {
    const entity = this.#entities.get(id);
    if (!entity) return;
    const { kinematics, transform, vital } = entity.components;
    const vy = clampV7(finite(kinematics.velocity.y) - this.#config.gravity * dt, -80, 80);
    const nextY = transform.position.y + vy * dt;
    const grounded = nextY <= this.#config.groundY;
    const safeY = grounded ? this.#config.groundY : nextY;
    const nextVelocity: Vec3V7 = { x: kinematics.velocity.x, y: grounded ? 0 : vy, z: kinematics.velocity.z };
    const stamina = Math.min(vital.maxStamina, vital.stamina + this.#config.staminaRegenPerSecond * dt);
    this.#entities.setTransform(id, { ...transform, position: vec3V7(transform.position.x + nextVelocity.x * dt, safeY, transform.position.z + nextVelocity.z * dt) });
    this.#entities.setKinematics(id, { ...kinematics, velocity: nextVelocity, grounded });
    this.#entities.setVital(id, { ...vital, stamina });
    if (grounded && !kinematics.grounded) onEvent(Object.freeze({ type: 'landed', id, tick }));
  }

  #refreshSpatial(): void {
    for (const entity of this.#entities.list()) {
      const p = entity.components.transform.position;
      const radius = entity.components.interest.simulationLod === 0 ? 1.25 : 2;
      this.#spatial.upsert({ id: entity.id, active: entity.components.vital.health > 0, layer: 0, bounds: { min: { x: p.x - radius, y: p.y, z: p.z - radius }, max: { x: p.x + radius, y: p.y + 2, z: p.z + radius } } });
    }
  }
}

export interface SimulationEventV7 {
  readonly type: 'landed' | 'respawned' | 'sleep' | 'wake';
  readonly id: EntityIdV7;
  readonly tick: TickV7;
}

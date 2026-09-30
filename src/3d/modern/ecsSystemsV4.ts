import {
  type EntityIdV4,
  type TickId,
  type TransformV4,
  type Vec3V4,
  entityIdV4,
  vec3V4,
  addV4,
  scaleV4,
  normalizeVectorV4,
  clampV4,
} from './runtimeContractsV4';

export interface MovementStateV4 {
  position: Vec3V4;
  velocity: Vec3V4;
  acceleration: number;
  maxSpeed: number;
  damping: number;
}

export interface StaminaStateV4 {
  current: number;
  maximum: number;
  regeneration: number;
  sprintDrain: number;
  exhausted: boolean;
}

export interface HealthStateV4 {
  current: number;
  maximum: number;
  invulnerableUntilTick: number;
  dead: boolean;
}

export interface CameraIntentV4 {
  yaw: number;
  pitch: number;
  sensitivity: number;
}

export interface MovementCommandV4 {
  readonly direction: Vec3V4;
  readonly sprint: boolean;
  readonly jump: boolean;
}

export interface EcsEntityV4 {
  readonly id: EntityIdV4;
  transform: TransformV4;
  movement: MovementStateV4;
  stamina: StaminaStateV4;
  health: HealthStateV4;
  camera: CameraIntentV4;
}

export interface EcsSystemMetricsV4 {
  readonly ticks: number;
  readonly moved: number;
  readonly sprinted: number;
  readonly jumped: number;
  readonly regenerated: number;
  readonly deaths: number;
  readonly rejected: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export function createEcsEntityV4(id: number, position = vec3V4()): EcsEntityV4 {
  const entity = entityIdV4(Math.max(1, Math.trunc(id)));
  return {
    id: entity,
    transform: { position, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    movement: { position, velocity: vec3V4(), acceleration: 25, maxSpeed: 8, damping: 10 },
    stamina: { current: 100, maximum: 100, regeneration: 18, sprintDrain: 32, exhausted: false },
    health: { current: 100, maximum: 100, invulnerableUntilTick: -1, dead: false },
    camera: { yaw: 0, pitch: 0, sensitivity: 1 },
  };
}

export class MovementSystemV4 {
  #metrics = { ticks: 0, moved: 0, sprinted: 0, jumped: 0, regenerated: 0, deaths: 0, rejected: 0 };

  update(entity: EcsEntityV4, command: MovementCommandV4, deltaSeconds: number, tick: TickId): boolean {
    if (entity.health.dead) {
      this.#metrics.rejected += 1;
      return false;
    }
    const dt = clampV4(finite(deltaSeconds), 0, 0.1);
    const direction = normalizeVectorV4(command.direction);
    const sprintMultiplier = command.sprint && !entity.stamina.exhausted ? 1.5 : 1;
    const target = scaleV4(direction, entity.movement.maxSpeed * sprintMultiplier);
    const blend = clampV4(entity.movement.acceleration * dt, 0, 1);
    const velocity = addV4(entity.movement.velocity, scaleV4(addV4(target, scaleV4(entity.movement.velocity, -1)), blend));
    const damping = Math.max(0, 1 - entity.movement.damping * dt);
    const damped = scaleV4(velocity, damping);
    const position = addV4(entity.movement.position, scaleV4(damped, dt));
    entity.movement.velocity = damped;
    entity.movement.position = position;
    entity.transform = { ...entity.transform, position };
    if (Math.hypot(damped.x, damped.y, damped.z) > 0.01) this.#metrics.moved += 1;
    if (command.sprint && sprintMultiplier > 1) this.#metrics.sprinted += 1;
    if (command.jump) this.#metrics.jumped += 1;
    void tick;
    this.#metrics.ticks += 1;
    return true;
  }

  metrics(): EcsSystemMetricsV4 {
    return Object.freeze({ ...this.#metrics });
  }
}

export class StaminaSystemV4 {
  update(entity: EcsEntityV4, sprinting: boolean, deltaSeconds: number): boolean {
    if (entity.health.dead) return false;
    const dt = clampV4(finite(deltaSeconds), 0, 0.1);
    const before = entity.stamina.current;
    const delta = sprinting && !entity.stamina.exhausted ? -entity.stamina.sprintDrain * dt : entity.stamina.regeneration * dt;
    entity.stamina.current = clampV4(before + delta, 0, entity.stamina.maximum);
    entity.stamina.exhausted = entity.stamina.current <= 0;
    return entity.stamina.current !== before;
  }

  canSprint(entity: EcsEntityV4, costThreshold = 1): boolean {
    return !entity.health.dead && !entity.stamina.exhausted && entity.stamina.current >= costThreshold;
  }
}

export class HealthSystemV4 {
  #deaths = 0;

  damage(entity: EcsEntityV4, amount: number, tick: TickId): number {
    if (entity.health.dead) return 0;
    const currentTick = Number(tick);
    if (currentTick < entity.health.invulnerableUntilTick) return 0;
    const damage = Math.max(0, finite(amount));
    entity.health.current = clampV4(entity.health.current - damage, 0, entity.health.maximum);
    if (entity.health.current <= 0) {
      entity.health.dead = true;
      this.#deaths += 1;
    }
    return damage;
  }

  heal(entity: EcsEntityV4, amount: number): number {
    if (entity.health.dead) return 0;
    const heal = Math.max(0, finite(amount));
    const before = entity.health.current;
    entity.health.current = clampV4(before + heal, 0, entity.health.maximum);
    return entity.health.current - before;
  }

  makeInvulnerable(entity: EcsEntityV4, untilTick: TickId): void {
    entity.health.invulnerableUntilTick = Math.max(entity.health.invulnerableUntilTick, Number(untilTick));
  }

  revive(entity: EcsEntityV4, healthRatio = 1): boolean {
    if (!entity.health.dead) return false;
    entity.health.dead = false;
    entity.health.current = clampV4(entity.health.maximum * clampV4(healthRatio, 0.01, 1), 1, entity.health.maximum);
    return true;
  }

  deaths(): number {
    return this.#deaths;
  }
}

export class CameraSystemV4 {
  update(entity: EcsEntityV4, yawDelta: number, pitchDelta: number): void {
    if (entity.health.dead) return;
    entity.camera.yaw += finite(yawDelta) * entity.camera.sensitivity;
    entity.camera.pitch = clampV4(entity.camera.pitch + finite(pitchDelta) * entity.camera.sensitivity, -1.5, 1.5);
    const halfPi = Math.PI * 2;
    entity.camera.yaw = ((entity.camera.yaw + Math.PI) % halfPi + halfPi) % halfPi - Math.PI;
  }
}

export interface EcsWorldV4 {
  readonly entities: ReadonlyMap<EntityIdV4, EcsEntityV4>;
  readonly movement: MovementSystemV4;
  readonly stamina: StaminaSystemV4;
  readonly health: HealthSystemV4;
  readonly camera: CameraSystemV4;
}

export function createEcsWorldV4(): EcsWorldV4 & { spawn: (id: number, position?: Vec3V4) => EntityIdV4; destroy: (id: EntityIdV4) => boolean } {
  const entities = new Map<EntityIdV4, EcsEntityV4>();
  const movement = new MovementSystemV4();
  const stamina = new StaminaSystemV4();
  const health = new HealthSystemV4();
  const camera = new CameraSystemV4();
  return {
    entities,
    movement,
    stamina,
    health,
    camera,
    spawn(id, position = vec3V4()) {
      const entity = createEcsEntityV4(id, position);
      entities.set(entity.id, entity);
      return entity.id;
    },
    destroy(id) {
      return entities.delete(id);
    },
  };
}

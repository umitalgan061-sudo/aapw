import {
  type EntityIdV4,
  type TransformV4,
  type Vec3V4,
  type TickId,
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  entityIdV4,
  vec3V4,
  quaternionV4,
  transformV4,
  addV4,
  scaleV4,
  normalizeVectorV4,
  clampV4,
} from './runtimeContractsV4';

export interface EntityHandleV5 {
  readonly id: EntityIdV4;
  readonly generation: number;
}

export interface TransformComponentV5 {
  transform: TransformV4;
  previous: TransformV4;
  dirty: boolean;
}

export interface VelocityComponentV5 {
  velocity: Vec3V4;
  acceleration: number;
  maxSpeed: number;
  damping: number;
}

export interface CharacterControllerV5 {
  grounded: boolean;
  jumping: boolean;
  crouched: boolean;
  sprinting: boolean;
  jumpImpulse: number;
  gravity: number;
  slopeLimit: number;
}

export interface HealthComponentV5 {
  current: number;
  maximum: number;
  invulnerableUntil: TickId;
  dead: boolean;
}

export interface StaminaComponentV5 {
  current: number;
  maximum: number;
  regenPerSecond: number;
  sprintCostPerSecond: number;
  exhausted: boolean;
}

export interface CameraComponentV5 {
  yaw: number;
  pitch: number;
  sensitivity: number;
  minPitch: number;
  maxPitch: number;
}

export interface EcsEntityV5 {
  readonly handle: EntityHandleV5;
  readonly transform: TransformComponentV5;
  readonly velocity: VelocityComponentV5;
  readonly controller: CharacterControllerV5;
  readonly health: HealthComponentV5;
  readonly stamina: StaminaComponentV5;
  readonly camera: CameraComponentV5;
}

export interface EcsWorldConfigV5 {
  readonly maxEntities?: number;
  readonly worldBoundary?: number;
  readonly maxDeltaSeconds?: number;
}

export interface EcsWorldMetricsV5 {
  readonly entities: number;
  readonly live: number;
  readonly destroyed: number;
  readonly moved: number;
  readonly grounded: number;
  readonly sprinting: number;
  readonly jumping: number;
  readonly dead: number;
  readonly queries: number;
  readonly queryHits: number;
}

export interface MovementCommandV5 {
  readonly direction: Vec3V4;
  readonly sprint: boolean;
  readonly jumpPressed: boolean;
  readonly crouch: boolean;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class EcsWorldV5 {
  readonly maxEntities: number;
  readonly worldBoundary: number;
  readonly maxDeltaSeconds: number;
  #nextId = 1;
  #freeIds: number[] = [];
  #generations = new Map<number, number>();
  #entities = new Map<number, EcsEntityV5>();
  #destroyed = 0;
  #moved = 0;
  #grounded = 0;
  #sprinting = 0;
  #jumping = 0;
  #dead = 0;
  #queries = 0;
  #queryHits = 0;

  constructor(config: EcsWorldConfigV5 = {}) {
    this.maxEntities = Math.max(16, Math.trunc(config.maxEntities ?? 100_000));
    this.worldBoundary = Math.max(100, finite(config.worldBoundary ?? 1_000_000, 1_000_000));
    this.maxDeltaSeconds = Math.max(0.001, finite(config.maxDeltaSeconds ?? 0.1, 0.1));
  }

  spawn(position: Vec3V4 = vec3V4()): OutcomeV4<EntityHandleV5> {
    if (this.#entities.size >= this.maxEntities) return failV4(createRuntimeErrorV4('ECS_ENTITY_CAP', 'Entity capacity reached', true));
    const numericId = this.#freeIds.pop() ?? this.#nextId++;
    const generation = (this.#generations.get(numericId) ?? 0) + 1;
    this.#generations.set(numericId, generation);
    const handle = Object.freeze({ id: entityIdV4(numericId), generation });
    const transform = transformV4(position, quaternionV4(), vec3V4(1, 1, 1));
    const entity: EcsEntityV5 = {
      handle,
      transform: { transform, previous: transform, dirty: true },
      velocity: { velocity: vec3V4(), acceleration: 30, maxSpeed: 8, damping: 8 },
      controller: { grounded: true, jumping: false, crouched: false, sprinting: false, jumpImpulse: 8.5, gravity: 22, slopeLimit: 0.8 },
      health: { current: 100, maximum: 100, invulnerableUntil: 0 as TickId, dead: false },
      stamina: { current: 100, maximum: 100, regenPerSecond: 20, sprintCostPerSecond: 30, exhausted: false },
      camera: { yaw: 0, pitch: 0, sensitivity: 1, minPitch: -1.5, maxPitch: 1.5 },
    };
    this.#entities.set(numericId, entity);
    return okV4(handle);
  }

  resolve(handle: EntityHandleV5): EcsEntityV5 | undefined {
    const entity = this.#entities.get(Number(handle.id));
    return entity && entity.handle.generation === handle.generation ? entity : undefined;
  }

  destroy(handle: EntityHandleV5): boolean {
    const numericId = Number(handle.id);
    const entity = this.#entities.get(numericId);
    if (!entity || entity.handle.generation !== handle.generation) return false;
    this.#entities.delete(numericId);
    this.#freeIds.push(numericId);
    this.#destroyed += 1;
    return true;
  }

  forEach(callback: (entity: EcsEntityV5) => void): void {
    for (const entity of this.#entities.values()) callback(entity);
  }

  move(handle: EntityHandleV5, command: MovementCommandV5, deltaSeconds: number, tick: TickId): boolean {
    const entity = this.resolve(handle);
    if (!entity || entity.health.dead) return false;
    const dt = Math.min(this.maxDeltaSeconds, Math.max(0, finite(deltaSeconds)));
    const direction = normalizeVectorV4(command.direction);
    entity.controller.crouched = Boolean(command.crouch);
    entity.controller.sprinting = Boolean(command.sprint) && !entity.stamina.exhausted;
    const targetSpeed = entity.velocity.maxSpeed * (entity.controller.sprinting ? 1.5 : 1) * (entity.controller.crouched ? 0.6 : 1);
    const target = scaleV4(direction, targetSpeed);
    const blend = clampV4(entity.velocity.acceleration * dt, 0, 1);
    const difference = addV4(target, scaleV4(entity.velocity.velocity, -1));
    let velocity = addV4(entity.velocity.velocity, scaleV4(difference, blend));
    const horizontal = vec3V4(velocity.x, 0, velocity.z);
    const horizontalMagnitude = Math.hypot(horizontal.x, horizontal.z);
    if (horizontalMagnitude > entity.velocity.maxSpeed * (entity.controller.sprinting ? 1.5 : 1)) {
      const normalized = normalizeVectorV4(horizontal);
      velocity = { ...velocity, x: normalized.x * targetSpeed, z: normalized.z * targetSpeed };
    }
    velocity = { ...velocity, y: velocity.y - entity.controller.gravity * dt };
    const before = entity.transform.transform.position;
    const position = addV4(before, scaleV4(velocity, dt));
    if (position.y <= 0) {
      position.y = 0;
      velocity = { ...velocity, y: 0 };
      entity.controller.grounded = true;
      entity.controller.jumping = false;
    } else {
      entity.controller.grounded = false;
    }
    const bounded = vec3V4(clampV4(position.x, -this.worldBoundary, this.worldBoundary), clampV4(position.y, 0, this.worldBoundary), clampV4(position.z, -this.worldBoundary, this.worldBoundary));
    const current = entity.transform.transform;
    entity.transform.previous = current;
    entity.transform.transform = transformV4(bounded, current.rotation, current.scale);
    entity.transform.dirty = true;
    entity.velocity.velocity = velocity;
    if (command.jumpPressed && entity.controller.grounded && !entity.controller.crouched) this.jump(entity, tick);
    if (Math.hypot(velocity.x, velocity.y, velocity.z) > 0.001) this.#moved += 1;
    if (entity.controller.grounded) this.#grounded += 1;
    if (entity.controller.sprinting) this.#sprinting += 1;
    if (entity.controller.jumping) this.#jumping += 1;
    return true;
  }

  jump(entity: EcsEntityV5, tick: TickId): boolean {
    if (entity.health.dead || !entity.controller.grounded || entity.stamina.exhausted) return false;
    entity.velocity.velocity = { ...entity.velocity.velocity, y: entity.controller.jumpImpulse };
    entity.controller.grounded = false;
    entity.controller.jumping = true;
    entity.health.invulnerableUntil = tick;
    return true;
  }

  tickStamina(handle: EntityHandleV5, sprinting: boolean, deltaSeconds: number): boolean {
    const entity = this.resolve(handle);
    if (!entity || entity.health.dead) return false;
    const dt = Math.min(this.maxDeltaSeconds, Math.max(0, finite(deltaSeconds)));
    const delta = sprinting && !entity.stamina.exhausted ? -entity.stamina.sprintCostPerSecond * dt : entity.stamina.regenPerSecond * dt;
    entity.stamina.current = clampV4(entity.stamina.current + delta, 0, entity.stamina.maximum);
    entity.stamina.exhausted = entity.stamina.current <= 0;
    return true;
  }

  damage(handle: EntityHandleV5, amount: number, tick: TickId): number {
    const entity = this.resolve(handle);
    if (!entity || entity.health.dead || Number(tick) < Number(entity.health.invulnerableUntil)) return 0;
    const damage = Math.max(0, finite(amount));
    entity.health.current = clampV4(entity.health.current - damage, 0, entity.health.maximum);
    if (entity.health.current <= 0) entity.health.dead = true;
    return damage;
  }

  heal(handle: EntityHandleV5, amount: number): number {
    const entity = this.resolve(handle);
    if (!entity || entity.health.dead) return 0;
    const before = entity.health.current;
    entity.health.current = clampV4(before + Math.max(0, finite(amount)), 0, entity.health.maximum);
    return entity.health.current - before;
  }

  updateCamera(handle: EntityHandleV5, yawDelta: number, pitchDelta: number): boolean {
    const entity = this.resolve(handle);
    if (!entity || entity.health.dead) return false;
    entity.camera.yaw += finite(yawDelta) * entity.camera.sensitivity;
    entity.camera.pitch = clampV4(entity.camera.pitch + finite(pitchDelta) * entity.camera.sensitivity, entity.camera.minPitch, entity.camera.maxPitch);
    const period = Math.PI * 2;
    entity.camera.yaw = ((entity.camera.yaw + Math.PI) % period + period) % period - Math.PI;
    return true;
  }

  queryRadius(center: Vec3V4, radius: number, limit = 256): readonly EntityHandleV5[] {
    const squared = Math.max(0, finite(radius)) ** 2;
    const max = Math.max(0, Math.trunc(limit));
    const results: EntityHandleV5[] = [];
    this.#queries += 1;
    for (const entity of this.#entities.values()) {
      const p = entity.transform.transform.position;
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      if (dx * dx + dy * dy + dz * dz <= squared) {
        results.push(entity.handle);
        if (results.length >= max) break;
      }
    }
    results.sort((a, b) => Number(a.id) - Number(b.id));
    this.#queryHits += results.length;
    return Object.freeze(results);
  }

  interpolate(handle: EntityHandleV5, alpha: number): TransformV4 | null {
    const entity = this.resolve(handle);
    if (!entity) return null;
    const t = clampV4(finite(alpha), 0, 1);
    const a = entity.transform.previous;
    const b = entity.transform.transform;
    return transformV4(
      vec3V4(a.position.x + (b.position.x - a.position.x) * t, a.position.y + (b.position.y - a.position.y) * t, a.position.z + (b.position.z - a.position.z) * t),
      b.rotation,
      b.scale,
    );
  }

  metrics(): EcsWorldMetricsV5 {
    let dead = 0;
    for (const entity of this.#entities.values()) if (entity.health.dead) dead += 1;
    return Object.freeze({ entities: this.#entities.size + this.#destroyed, live: this.#entities.size, destroyed: this.#destroyed, moved: this.#moved, grounded: this.#grounded, sprinting: this.#sprinting, jumping: this.#jumping, dead, queries: this.#queries, queryHits: this.#queryHits });
  }

  clear(): void {
    this.#entities.clear();
    this.#freeIds.length = 0;
  }
}

export function createEcsWorldV5(config: EcsWorldConfigV5 = {}): EcsWorldV5 {
  return new EcsWorldV5(config);
}

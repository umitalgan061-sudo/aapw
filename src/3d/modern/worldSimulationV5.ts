import { addV5, clampV5, magnitudeV5, type EntityIdV5, type EntityStateV5, type TickV5, type Vec3V5, vec3V5 } from './runtimeContractV5';

export interface SimulationConfigV5 { readonly fixedDeltaSeconds?: number; readonly maxSubSteps?: number; readonly gravity?: number; readonly terminalVelocity?: number; readonly maxSpeed?: number; readonly worldLimit?: number; readonly drag?: number; readonly groundedY?: number; }
export interface SimulationInputV5 { readonly movement: Vec3V5; readonly sprint: boolean; readonly jump: boolean; readonly jumpImpulse: number; readonly acceleration: number; readonly maxSpeed: number; }
export interface SimulationResultV5 { readonly entity: EntityStateV5; readonly subSteps: number; readonly displaced: number; readonly grounded: boolean; readonly energy: number; }
export interface CollisionPlaneV5 { readonly normal: Vec3V5; readonly distance: number; readonly restitution: number; readonly friction: number; readonly id: string; }
export interface SimulationMetricsV5 { readonly tick: TickV5; readonly entities: number; readonly subSteps: number; readonly collisions: number; readonly outOfBounds: number; readonly avgSpeed: number; }

const normalizedConfig = (config: SimulationConfigV5): Required<SimulationConfigV5> => ({ fixedDeltaSeconds: clampV5(config.fixedDeltaSeconds ?? 1 / 60, 1 / 240, 1 / 20), maxSubSteps: Math.max(1, Math.min(16, Math.floor(config.maxSubSteps ?? 4))), gravity: clampV5(config.gravity ?? -24, -100, 0), terminalVelocity: Math.max(1, config.terminalVelocity ?? 80), maxSpeed: Math.max(0.1, config.maxSpeed ?? 12), worldLimit: Math.max(100, config.worldLimit ?? 100_000), drag: clampV5(config.drag ?? 7, 0, 40), groundedY: config.groundedY ?? 0 });
const valid = (value: number): number => Number.isFinite(value) ? value : 0;
const clampVector = (v: Vec3V5, limit: number): Vec3V5 => vec3V5(clampV5(v.x, -limit, limit), clampV5(v.y, -limit, limit), clampV5(v.z, -limit, limit));

export class WorldSimulationV5 {
  readonly config: Required<SimulationConfigV5>;
  #entities = new Map<EntityIdV5, EntityStateV5>();
  #planes = new Map<string, CollisionPlaneV5>();
  #tick: TickV5 = 0 as TickV5;
  #collisions = 0; #outOfBounds = 0; #subSteps = 0;

  constructor(config: SimulationConfigV5 = {}) { this.config = Object.freeze(normalizedConfig(config)); }
  upsert(entity: EntityStateV5): void { this.#entities.set(entity.id, entity); }
  remove(id: EntityIdV5): boolean { return this.#entities.delete(id); }
  get(id: EntityIdV5): EntityStateV5 | null { return this.#entities.get(id) ?? null; }
  values(): readonly EntityStateV5[] { return Object.freeze([...this.#entities.values()].sort((a, b) => a.id - b.id)); }
  addPlane(plane: CollisionPlaneV5): void { this.#planes.set(plane.id, Object.freeze({ ...plane, restitution: clampV5(plane.restitution, 0, 1), friction: clampV5(plane.friction, 0, 1) })); }
  removePlane(id: string): boolean { return this.#planes.delete(id); }
  setTick(tick: TickV5): void { this.#tick = tick; }

  step(tick: TickV5, inputs: ReadonlyMap<EntityIdV5, SimulationInputV5> = new Map()): SimulationMetricsV5 {
    this.#tick = tick; this.#collisions = 0; this.#outOfBounds = 0; this.#subSteps = 0;
    let speedTotal = 0;
    for (const [id, entity] of this.#entities) {
      const input = inputs.get(id) ?? { movement: vec3V5(), sprint: false, jump: false, jumpImpulse: 9, acceleration: 30, maxSpeed: this.config.maxSpeed };
      const result = this.#integrate(entity, input); this.#entities.set(id, result.entity); speedTotal += magnitudeV5(result.entity.velocity); this.#subSteps += result.subSteps;
    }
    return Object.freeze({ tick, entities: this.#entities.size, subSteps: this.#subSteps, collisions: this.#collisions, outOfBounds: this.#outOfBounds, avgSpeed: this.#entities.size ? speedTotal / this.#entities.size : 0 });
  }

  integrateOne(entity: EntityStateV5, input: SimulationInputV5, deltaSeconds = this.config.fixedDeltaSeconds): SimulationResultV5 { return this.#integrate(entity, input, deltaSeconds); }

  #integrate(entity: EntityStateV5, input: SimulationInputV5, deltaSeconds = this.config.fixedDeltaSeconds): SimulationResultV5 {
    const steps = Math.max(1, Math.min(this.config.maxSubSteps, Math.ceil(deltaSeconds / this.config.fixedDeltaSeconds))); const dt = deltaSeconds / steps; let current = entity; let displaced = 0; let grounded = false; let collisions = 0;
    for (let step = 0; step < steps; step += 1) {
      const movement = clampVector(input.movement, 1); const desired = vec3V5(movement.x * input.maxSpeed * (input.sprint ? 1.35 : 1), movement.y * input.maxSpeed, movement.z * input.maxSpeed * (input.sprint ? 1.35 : 1));
      let velocity = current.velocity;
      const acceleration = Math.max(0, valid(input.acceleration)); const delta = vec3V5(clampV5(desired.x - velocity.x, -acceleration * dt, acceleration * dt), clampV5(desired.y - velocity.y, -acceleration * dt, acceleration * dt), clampV5(desired.z - velocity.z, -acceleration * dt, acceleration * dt));
      velocity = addV5(velocity, delta); velocity = vec3V5(velocity.x, velocity.y + this.config.gravity * dt, velocity.z); if (input.jump && grounded) velocity = vec3V5(velocity.x, Math.max(velocity.y, input.jumpImpulse), velocity.z);
      const speed = magnitudeV5(velocity); const speedLimit = Math.min(this.config.maxSpeed * (input.sprint ? 1.35 : 1), Math.max(input.maxSpeed, this.config.maxSpeed)); if (speed > speedLimit) velocity = { ...velocity, x: velocity.x * speedLimit / speed, y: velocity.y * speedLimit / speed, z: velocity.z * speedLimit / speed };
      const dragFactor = Math.max(0, 1 - this.config.drag * dt); velocity = vec3V5(velocity.x * dragFactor, velocity.y, velocity.z * dragFactor);
      let position = addV5(current.transform.position, { x: velocity.x * dt, y: velocity.y * dt, z: velocity.z * dt });
      const collision = this.#collide(position, velocity); position = collision.position; velocity = collision.velocity; grounded = collision.grounded; collisions += collision.collisions; displaced += Math.sqrt((position.x - current.transform.position.x) ** 2 + (position.y - current.transform.position.y) ** 2 + (position.z - current.transform.position.z) ** 2);
      if (Math.abs(position.x) > this.config.worldLimit || Math.abs(position.y) > this.config.worldLimit || Math.abs(position.z) > this.config.worldLimit) { position = vec3V5(0, this.config.groundedY, 0); velocity = vec3V5(); this.#outOfBounds += 1; }
      current = Object.freeze({ ...current, transform: Object.freeze({ ...current.transform, position }), velocity, revision: current.revision + 1 });
    }
    this.#collisions += collisions; return Object.freeze({ entity: current, subSteps: steps, displaced, grounded, energy: magnitudeV5(current.velocity) ** 2 * 0.5 });
  }

  #collide(position: Vec3V5, velocity: Vec3V5): { position: Vec3V5; velocity: Vec3V5; grounded: boolean; collisions: number } {
    let nextPosition = position; let nextVelocity = velocity; let grounded = false; let collisions = 0;
    for (const plane of this.#planes.values()) {
      const penetration = plane.normal.x * nextPosition.x + plane.normal.y * nextPosition.y + plane.normal.z * nextPosition.z + plane.distance;
      if (penetration < 0) {
        nextPosition = { x: nextPosition.x - plane.normal.x * penetration, y: nextPosition.y - plane.normal.y * penetration, z: nextPosition.z - plane.normal.z * penetration };
        const normalSpeed = nextVelocity.x * plane.normal.x + nextVelocity.y * plane.normal.y + nextVelocity.z * plane.normal.z;
        if (normalSpeed < 0) {
          const normal = { x: plane.normal.x * normalSpeed, y: plane.normal.y * normalSpeed, z: plane.normal.z * normalSpeed }; const tangent = { x: nextVelocity.x - normal.x, y: nextVelocity.y - normal.y, z: nextVelocity.z - normal.z };
          nextVelocity = { x: tangent.x * (1 - plane.friction) - normal.x * plane.restitution, y: tangent.y * (1 - plane.friction) - normal.y * plane.restitution, z: tangent.z * (1 - plane.friction) - normal.z * plane.restitution };
        }
        grounded ||= plane.normal.y > 0.65; collisions += 1;
      }
    }
    if (nextPosition.y <= this.config.groundedY) { nextPosition = { ...nextPosition, y: this.config.groundedY }; if (nextVelocity.y < 0) nextVelocity = { ...nextVelocity, y: 0 }; grounded = true; collisions += 1; }
    return { position: nextPosition, velocity: nextVelocity, grounded, collisions };
  }
}

export function createGroundPlaneV5(id = 'ground', y = 0): CollisionPlaneV5 { return Object.freeze({ id, normal: vec3V5(0, 1, 0), distance: -y, restitution: 0, friction: 0.8 }); }
export function horizontalInputV5(x: number, z: number): Vec3V5 { const length = Math.hypot(x, z) || 1; return vec3V5(x / length, 0, z / length); }

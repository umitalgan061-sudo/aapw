import type { EntityState, Tick, Vec3, Velocity } from './types';
import { clamp, vec3Add, vec3Length, vec3Normalize, vec3Scale } from './deterministic';

export interface PhysicsBody {
  readonly id: string;
  readonly mass: number;
  readonly radius: number;
  readonly gravityScale: number;
  readonly restitution: number;
  readonly friction: number;
  readonly grounded: boolean;
  readonly velocity: Vec3;
}
export interface PhysicsConfig {
  readonly gravity: Vec3;
  readonly maxSpeed: number;
  readonly maxBodies: number;
  readonly fixedDt: number;
}
export interface CollisionResult {
  readonly hit: boolean;
  readonly normal: Vec3;
  readonly penetration: number;
  readonly relativeSpeed: number;
}

export class CharacterPhysics {
  readonly config: PhysicsConfig;
  #bodies = new Map<string, PhysicsBody>();
  constructor(config: Partial<PhysicsConfig> = {}) {
    this.config = Object.freeze({
      gravity: config.gravity ?? Object.freeze({ x: 0, y: -9.81, z: 0 }),
      maxSpeed: config.maxSpeed ?? 32,
      maxBodies: config.maxBodies ?? 4096,
      fixedDt: config.fixedDt ?? 1 / 60,
    });
  }
  register(body: PhysicsBody): boolean {
    if (!body.id || body.mass <= 0 || body.radius <= 0) return false;
    if (!this.#bodies.has(body.id) && this.#bodies.size >= this.config.maxBodies) return false;
    this.#bodies.set(body.id, Object.freeze({ ...body, friction: clamp(body.friction, 0, 1), restitution: clamp(body.restitution, 0, 1) }));
    return true;
  }
  unregister(id: string): boolean { return this.#bodies.delete(id); }
  integrate(entity: EntityState, inputVelocity: Vec3, tick: Tick, groundedOverride?: boolean): EntityState {
    const body = this.#bodies.get(entity.id);
    if (!body) return entity;
    const grounded = groundedOverride ?? body.grounded;
    const gravity = grounded ? { x: 0, y: 0, z: 0 } : vec3Scale(this.config.gravity, body.gravityScale);
    const velocity = vec3Add(inputVelocity, vec3Scale(gravity, this.config.fixedDt));
    const speed = vec3Length(velocity);
    const limited = speed > this.config.maxSpeed ? vec3Scale(vec3Normalize(velocity), this.config.maxSpeed) : velocity;
    const position = vec3Add(entity.transform.position, vec3Scale(limited, this.config.fixedDt));
    const next = Object.freeze({ ...entity, transform: Object.freeze({ ...entity.transform, position: Object.freeze(position) }), velocity: Object.freeze({ ...entity.velocity, linear: Object.freeze(limited) }), revision: (Number(entity.revision) + 1) as never });
    this.#bodies.set(entity.id, Object.freeze({ ...body, grounded }));
    return next;
  }
  resolveSphere(a: Vec3, ar: number, b: Vec3, br: number): CollisionResult {
    const delta = Object.freeze({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const distance = vec3Length(delta);
    const radius = Math.max(0, ar) + Math.max(0, br);
    if (distance >= radius) return Object.freeze({ hit: false, normal: Object.freeze({ x: 0, y: 1, z: 0 }), penetration: 0, relativeSpeed: 0 });
    const normal = distance > 1e-7 ? vec3Scale(delta, 1 / distance) : Object.freeze({ x: 0, y: 1, z: 0 });
    return Object.freeze({ hit: true, normal, penetration: radius - distance, relativeSpeed: radius / Math.max(this.config.fixedDt, 1e-5) });
  }
  applyFriction(velocity: Vec3, coefficient: number, dt = this.config.fixedDt): Vec3 {
    const factor = Math.max(0, 1 - clamp(coefficient, 0, 1) * dt * 8);
    return Object.freeze({ x: velocity.x * factor, y: velocity.y, z: velocity.z * factor });
  }
  stepBodies(callback: (id: string, body: PhysicsBody) => void): void {
    for (const [id, body] of this.#bodies) callback(id, body);
  }
  clear(): void { this.#bodies.clear(); }
}

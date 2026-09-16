import { add, clamp, distanceSq, lengthSq, normalize, scale, stableSort, vec3, type Disposable, type EntityId, type Vec3 } from './primitives.js';

export type BodyType = 'static' | 'dynamic' | 'kinematic';
export type ColliderType = 'sphere' | 'box' | 'capsule';
export interface PhysicsBody {
  readonly id: EntityId;
  readonly type: BodyType;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly halfExtents: Vec3;
  readonly radius: number;
  readonly mass: number;
  readonly gravityScale: number;
  readonly restitution: number;
  readonly friction: number;
  readonly grounded: boolean;
  readonly revision: number;
}
export interface PhysicsImpulse {
  readonly id: EntityId;
  readonly impulse: Vec3;
  readonly point?: Vec3;
}
export interface PhysicsContact {
  readonly a: EntityId;
  readonly b: EntityId;
  readonly normal: Vec3;
  readonly penetration: number;
  readonly relativeSpeed: number;
  readonly tick: number;
}
export interface PhysicsQuery {
  readonly center: Vec3;
  readonly radius: number;
  readonly includeStatic?: boolean;
  readonly limit?: number;
}
export interface PhysicsStats {
  readonly bodies: number;
  readonly dynamicBodies: number;
  readonly contacts: number;
  readonly impulses: number;
  readonly steps: number;
  readonly broadphaseCells: number;
}

function finiteVector(value: Vec3): Vec3 {
  return vec3(
    Number.isFinite(value.x) ? value.x : 0,
    Number.isFinite(value.y) ? value.y : 0,
    Number.isFinite(value.z) ? value.z : 0,
  );
}

function overlapSphere(a: PhysicsBody, b: PhysicsBody): PhysicsContact | null {
  const delta = add(b.position, scale(a.position, -1));
  const radius = Math.max(0, a.radius) + Math.max(0, b.radius);
  const distance = Math.sqrt(Math.max(0, lengthSq(delta)));
  if (distance >= radius) return null;
  const normal = distance > 1e-6 ? scale(delta, 1 / distance) : vec3(0, 1, 0);
  return Object.freeze({
    a: a.id,
    b: b.id,
    normal,
    penetration: radius - distance,
    relativeSpeed: Math.sqrt(lengthSq(add(b.velocity, scale(a.velocity, -1)))),
    tick: 0,
  });
}

export class DeterministicPhysicsRuntime implements Disposable {
  readonly fixedDelta: number;
  readonly gravity: Vec3;
  readonly cellSize: number;
  readonly maxBodies: number;
  readonly maxContacts: number;
  #bodies = new Map<EntityId, PhysicsBody>();
  #cells = new Map<string, Set<EntityId>>();
  #impulses: PhysicsImpulse[] = [];
  #contacts: PhysicsContact[] = [];
  #tick = 0;
  #steps = 0;
  #disposed = false;

  constructor(options: {
    readonly fixedDelta?: number;
    readonly gravity?: Vec3;
    readonly cellSize?: number;
    readonly maxBodies?: number;
    readonly maxContacts?: number;
  } = {}) {
    this.fixedDelta = clamp(options.fixedDelta ?? 1 / 60, 1 / 240, 1 / 15);
    this.gravity = finiteVector(options.gravity ?? vec3(0, -24, 0));
    this.cellSize = clamp(options.cellSize ?? 8, 1, 64);
    this.maxBodies = Math.max(1, Math.min(100_000, Math.trunc(options.maxBodies ?? 4096)));
    this.maxContacts = Math.max(1, Math.min(32_768, Math.trunc(options.maxContacts ?? 8192)));
  }

  addBody(input: Omit<PhysicsBody, 'id' | 'revision' | 'position' | 'velocity' | 'halfExtents'> & {
    readonly id: string;
    readonly position?: Vec3;
    readonly velocity?: Vec3;
    readonly halfExtents?: Vec3;
  }): boolean {
    if (this.#disposed) return false;
    if (!input.id || this.#bodies.size >= this.maxBodies || this.#bodies.has(input.id as EntityId)) return false;
    const body: PhysicsBody = Object.freeze({
      ...input,
      id: input.id as EntityId,
      position: finiteVector(input.position ?? vec3()),
      velocity: finiteVector(input.velocity ?? vec3()),
      halfExtents: finiteVector(input.halfExtents ?? vec3(0.5, 0.5, 0.5)),
      mass: Math.max(0.001, Number(input.mass)),
      radius: Math.max(0.01, Number(input.radius)),
      gravityScale: clamp(Number(input.gravityScale), -10, 10),
      restitution: clamp(Number(input.restitution), 0, 1),
      friction: clamp(Number(input.friction), 0, 2),
      grounded: Boolean(input.grounded),
      revision: 0,
    });
    this.#bodies.set(body.id, body);
    this.#insertCell(body);
    return true;
  }

  removeBody(id: EntityId): boolean {
    const body = this.#bodies.get(id);
    if (!body) return false;
    this.#removeCell(body);
    return this.#bodies.delete(id);
  }

  applyImpulse(impulse: PhysicsImpulse): boolean {
    if (this.#disposed || !this.#bodies.has(impulse.id)) return false;
    this.#impulses.push(Object.freeze({ ...impulse, impulse: finiteVector(impulse.impulse), point: impulse.point ? finiteVector(impulse.point) : undefined }));
    if (this.#impulses.length > 4096) this.#impulses.shift();
    return true;
  }

  step(count = 1): readonly PhysicsContact[] {
    if (this.#disposed) return [];
    const steps = clamp(Math.trunc(count), 1, 8);
    this.#contacts.length = 0;
    for (let index = 0; index < steps; index += 1) this.#stepOnce();
    return Object.freeze([...this.#contacts]);
  }

  query(query: PhysicsQuery): readonly PhysicsBody[] {
    if (this.#disposed) return [];
    const radius = clamp(query.radius, 0, 100_000);
    const range = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(query.center.x / this.cellSize);
    const cz = Math.floor(query.center.z / this.cellSize);
    const result: PhysicsBody[] = [];
    for (let x = cx - range; x <= cx + range; x += 1) {
      for (let z = cz - range; z <= cz + range; z += 1) {
        const bucket = this.#cells.get(`${x},${z}`);
        if (!bucket) continue;
        for (const id of bucket) {
          const body = this.#bodies.get(id);
          if (!body) continue;
          if (!query.includeStatic && body.type === 'static') continue;
          const rr = radius + body.radius;
          if (distanceSq(query.center, body.position) <= rr * rr) result.push(body);
        }
      }
    }
    return Object.freeze(stableSort(result, (a, b) => distanceSq(query.center, a.position) - distanceSq(query.center, b.position) || String(a.id).localeCompare(String(b.id))).slice(0, Math.max(1, Math.min(8192, Math.trunc(query.limit ?? result.length)))));
  }

  body(id: EntityId): PhysicsBody | undefined {
    return this.#bodies.get(id);
  }

  bodies(): readonly PhysicsBody[] {
    return Object.freeze(stableSort([...this.#bodies.values()], (a, b) => String(a.id).localeCompare(String(b.id))));
  }

  contacts(): readonly PhysicsContact[] {
    return Object.freeze([...this.#contacts]);
  }

  stats(): PhysicsStats {
    return Object.freeze({
      bodies: this.#bodies.size,
      dynamicBodies: [...this.#bodies.values()].filter((body) => body.type === 'dynamic').length,
      contacts: this.#contacts.length,
      impulses: this.#impulses.length,
      steps: this.#steps,
      broadphaseCells: this.#cells.size,
    });
  }

  reset(): void {
    this.#bodies.clear();
    this.#cells.clear();
    this.#impulses.length = 0;
    this.#contacts.length = 0;
    this.#tick = 0;
    this.#steps = 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.reset();
  }

  #stepOnce(): void {
    this.#tick += 1;
    this.#steps += 1;
    const impulses = this.#consumeImpulses();
    for (const body of this.bodies()) {
      if (body.type === 'static') continue;
      const applied = impulses.get(body.id) ?? vec3();
      const acceleration = body.type === 'dynamic' ? scale(this.gravity, body.gravityScale) : vec3();
      let velocity = add(body.velocity, scale(add(acceleration, scale(applied, 1 / body.mass)), this.fixedDelta));
      velocity = vec3(clamp(velocity.x, -100, 100), clamp(velocity.y, -100, 100), clamp(velocity.z, -100, 100));
      let position = add(body.position, scale(velocity, this.fixedDelta));
      let grounded = body.grounded;
      if (position.y - body.radius <= 0) {
        position = vec3(position.x, body.radius, position.z);
        grounded = true;
        if (velocity.y < 0) velocity = vec3(velocity.x, -velocity.y * body.restitution, velocity.z);
      } else {
        grounded = false;
      }
      this.#replace(body, { position, velocity, grounded });
    }
    this.#rebuildCells();
    this.#solveContacts();
  }

  #consumeImpulses(): Map<EntityId, Vec3> {
    const merged = new Map<EntityId, Vec3>();
    for (const impulse of this.#impulses) merged.set(impulse.id, add(merged.get(impulse.id) ?? vec3(), impulse.impulse));
    this.#impulses.length = 0;
    return merged;
  }

  #solveContacts(): void {
    const bodies = this.bodies().filter((body) => body.type !== 'static');
    for (let left = 0; left < bodies.length; left += 1) {
      const a = bodies[left]!;
      for (let right = left + 1; right < bodies.length; right += 1) {
        if (this.#contacts.length >= this.maxContacts) return;
        const b = bodies[right]!;
        if (a.type === 'kinematic' && b.type === 'kinematic') continue;
        const contact = overlapSphere(a, b);
        if (!contact) continue;
        const solved = Object.freeze({ ...contact, tick: this.#tick });
        this.#contacts.push(solved);
        const correction = scale(contact.normal, contact.penetration * 0.5);
        this.#replace(a, { position: add(a.position, scale(correction, -1)) });
        this.#replace(b, { position: add(b.position, correction) });
      }
    }
  }

  #replace(body: PhysicsBody, patch: Partial<PhysicsBody>): void {
    this.#bodies.set(body.id, Object.freeze({ ...body, ...patch, position: finiteVector(patch.position ?? body.position), velocity: finiteVector(patch.velocity ?? body.velocity), revision: body.revision + 1 }));
  }

  #insertCell(body: PhysicsBody): void {
    const key = `${Math.floor(body.position.x / this.cellSize)},${Math.floor(body.position.z / this.cellSize)}`;
    const bucket = this.#cells.get(key) ?? new Set<EntityId>();
    bucket.add(body.id);
    this.#cells.set(key, bucket);
  }

  #removeCell(body: PhysicsBody): void {
    const key = `${Math.floor(body.position.x / this.cellSize)},${Math.floor(body.position.z / this.cellSize)}`;
    const bucket = this.#cells.get(key);
    bucket?.delete(body.id);
    if (bucket && bucket.size === 0) this.#cells.delete(key);
  }

  #rebuildCells(): void {
    this.#cells.clear();
    for (const body of this.#bodies.values()) this.#insertCell(body);
  }
}

export function distanceToGround(body: PhysicsBody): number {
  return Math.max(0, body.position.y - body.radius);
}

export function isMoving(body: PhysicsBody, epsilon = 0.01): boolean {
  return lengthSq(body.velocity) > epsilon * epsilon;
}

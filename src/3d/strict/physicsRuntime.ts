import type { Aabb2, Circle2, Collider, EntityId, GroundContact, JumpState, PhysicsBodyState, PhysicsPolicy, Result, Vec3 } from './liveCoreTypes.ts';
import { clamp, err, lengthXZ, normalize3, ok, vec3 } from './liveCoreTypes.ts';export interface GroundSampler {
  sampleHeight(x: number, z: number): number;
  sampleNormal?(x: number, z: number, probeMeters: number): Vec3;
  sampleMaterial?(x: number, z: number): string;
}

export interface PhysicsStepResult {
  readonly body: PhysicsBodyState;
  readonly jump: JumpState;
  readonly contacts: readonly CollisionContact[];
  readonly resolvedCollisions: number;
  readonly saturated: boolean;
}

export interface CollisionContact {
  readonly colliderId: EntityId;
  readonly normal: Vec3;
  readonly penetration: number;
}

export const DEFAULT_PHYSICS_POLICY: PhysicsPolicy = Object.freeze({
  gravity: -26,
  maxFallSpeed: 55,
  jumpSpeed: 9.5,
  maxSlopeDegrees: 54,
  skinWidth: 0.03,
  maxDepenetrationIterations: 6,
  coyoteTimeSeconds: 0.12,
  fixedStepSeconds: 1 / 60,
});

export const circleCollider = (
  id: EntityId,
  x: number,
  z: number,
  radius: number,
  layer = 1,
  mask = 0xffff,
): Collider => Object.freeze({
  id,
  shape: Object.freeze({ type: 'circle', value: Object.freeze({ x, z, radius: Math.max(0, radius) }) }),
  layer,
  mask,
  enabled: true,
});

export const aabbCollider = (
  id: EntityId,
  bounds: Aabb2,
  layer = 1,
  mask = 0xffff,
): Collider => Object.freeze({
  id,
  shape: Object.freeze({
    type: 'aabb',
    value: Object.freeze({
      minX: Math.min(bounds.minX, bounds.maxX),
      maxX: Math.max(bounds.minX, bounds.maxX),
      minZ: Math.min(bounds.minZ, bounds.maxZ),
      maxZ: Math.max(bounds.minZ, bounds.maxZ),
    }),
  }),
  layer,
  mask,
  enabled: true,
});

const finiteVec3 = (value: Vec3): Vec3 => vec3(value.x, value.y, value.z);

const circleContact = (
  x: number,
  z: number,
  radius: number,
  shape: Circle2,
  skinWidth: number,
): { normal: Vec3; penetration: number } | null => {
  const dx = x - shape.x;
  const dz = z - shape.z;
  const distance = Math.hypot(dx, dz);
  const target = radius + shape.radius + skinWidth;
  if (distance >= target) return null;
  if (distance <= 1e-8) return { normal: vec3(1, 0, 0), penetration: target };
  return { normal: vec3(dx / distance, 0, dz / distance), penetration: target - distance };
};

const segmentContact = (
  x: number,
  z: number,
  radius: number,
  segment: { readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number },
  skinWidth: number,
): { normal: Vec3; penetration: number } | null => {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared <= 1e-9
    ? 0
    : clamp((x - segment.ax) * dx + (z - segment.az) * dz, 0, lengthSquared) / lengthSquared;
  const closestX = segment.ax + dx * t;
  const closestZ = segment.az + dz * t;
  const offsetX = x - closestX;
  const offsetZ = z - closestZ;
  const distance = Math.hypot(offsetX, offsetZ);
  const target = radius + skinWidth;
  if (distance >= target) return null;
  if (distance <= 1e-9) {
    const normal = lengthSquared <= 1e-9
      ? vec3(1, 0, 0)
      : vec3(-dz / Math.sqrt(lengthSquared), 0, dx / Math.sqrt(lengthSquared));
    return { normal, penetration: target };
  }
  return {
    normal: vec3(offsetX / distance, 0, offsetZ / distance),
    penetration: target - distance,
  };
};

const aabbContact = (
  x: number,
  z: number,
  radius: number,
  bounds: Aabb2,
  skinWidth: number,
): { normal: Vec3; penetration: number } | null => {
  const closestX = clamp(x, bounds.minX, bounds.maxX);
  const closestZ = clamp(z, bounds.minZ, bounds.maxZ);
  const dx = x - closestX;
  const dz = z - closestZ;
  const distance = Math.hypot(dx, dz);
  if (distance > 1e-8) {
    const target = radius + skinWidth;
    if (distance >= target) return null;
    return { normal: vec3(dx / distance, 0, dz / distance), penetration: target - distance };
  }

  const left = Math.abs(x - bounds.minX);
  const right = Math.abs(bounds.maxX - x);
  const top = Math.abs(z - bounds.minZ);
  const bottom = Math.abs(bounds.maxZ - z);
  const minimum = Math.min(left, right, top, bottom);
  const target = radius + skinWidth;
  if (minimum >= target) return null;
  if (minimum === left) return { normal: vec3(-1, 0, 0), penetration: target - left };
  if (minimum === right) return { normal: vec3(1, 0, 0), penetration: target - right };
  if (minimum === top) return { normal: vec3(0, 0, -1), penetration: target - top };
  return { normal: vec3(0, 0, 1), penetration: target - bottom };
};

export const collideCircleAgainst = (
  position: Vec3,
  radius: number,
  colliders: readonly Collider[],
  policy: PhysicsPolicy = DEFAULT_PHYSICS_POLICY,
): readonly CollisionContact[] => {
  const contacts: CollisionContact[] = [];
  for (const collider of colliders) {
    if (!collider.enabled || collider.layer === 0) continue;
    const hit =
      collider.shape.type === 'circle'
        ? circleContact(position.x, position.z, radius, collider.shape.value, policy.skinWidth)
        : collider.shape.type === 'aabb'
          ? aabbContact(position.x, position.z, radius, collider.shape.value, policy.skinWidth)
          : segmentContact(position.x, position.z, radius, collider.shape.value, policy.skinWidth);
    if (hit) contacts.push(Object.freeze({ colliderId: collider.id, normal: hit.normal, penetration: hit.penetration }));
  }
  contacts.sort((a, b) => a.colliderId.localeCompare(b.colliderId));
  return Object.freeze(contacts);
};

export const depenetrate = (
  position: Vec3,
  contacts: readonly CollisionContact[],
  maxIterations = DEFAULT_PHYSICS_POLICY.maxDepenetrationIterations,
): Vec3 => {
  let next = finiteVec3(position);
  const iterations = Math.max(0, Math.floor(maxIterations));
  for (let i = 0; i < iterations; i += 1) {
    let moved = false;
    for (const contact of contacts) {
      if (contact.penetration <= 0) continue;
      const push = Math.min(contact.penetration, 2);
      next = vec3(
        next.x + contact.normal.x * push,
        next.y,
        next.z + contact.normal.z * push,
      );
      moved = true;
    }
    if (!moved) break;
  }
  return next;
};

export const applyGroundContact = (
  position: Vec3,
  velocity: Vec3,
  ground: GroundContact,
  policy: PhysicsPolicy = DEFAULT_PHYSICS_POLICY,
): { readonly position: Vec3; readonly velocity: Vec3; readonly grounded: boolean } => {
  const slopeTooSteep = ground.slopeDegrees > policy.maxSlopeDegrees;
  if (ground.grounded && !slopeTooSteep) {
    return {
      position: vec3(position.x, ground.groundY, position.z),
      velocity: vec3(velocity.x, 0, velocity.z),
      grounded: true,
    };
  }
  return { position, velocity, grounded: false };
};

export const resolveGroundContact = (
  position: Vec3,
  velocity: Vec3,
  sampler: GroundSampler,
  policy: PhysicsPolicy = DEFAULT_PHYSICS_POLICY,
): GroundContact => {
  const groundY = Number.isFinite(sampler.sampleHeight(position.x, position.z))
    ? sampler.sampleHeight(position.x, position.z)
    : 0;
  const normal = normalize3(
    sampler.sampleNormal?.(position.x, position.z, 0.5) ?? vec3(0, 1, 0),
  );
  const slope = Math.acos(clamp(normal.y, -1, 1)) * 180 / Math.PI;
  const grounded = position.y <= groundY + 0.08 && velocity.y <= 1;
  return Object.freeze({
    grounded,
    groundY,
    normal,
    slopeDegrees: slope,
    material: sampler.sampleMaterial?.(position.x, position.z) ?? 'default-ground',
  });
};

export const integrateJump = (
  jump: JumpState,
  dt: number,
  inputJump: boolean,
  policy: PhysicsPolicy = DEFAULT_PHYSICS_POLICY,
): JumpState => {
  const delta = clamp(dt, 0, 0.1);
  const canJump = jump.grounded || jump.coyoteRemaining > 0;
  const started = inputJump && canJump;
  if (started) {
    return Object.freeze({
      heightAboveGround: Math.max(jump.heightAboveGround, 0) + policy.jumpSpeed * delta,
      verticalVelocity: policy.jumpSpeed + policy.gravity * delta,
      grounded: false,
      coyoteRemaining: 0,
    });
  }

  const verticalVelocity = clamp(
    jump.verticalVelocity + policy.gravity * delta,
    -policy.maxFallSpeed,
    policy.jumpSpeed,
  );
  const height = jump.heightAboveGround + verticalVelocity * delta;
  if (height <= 0) {
    return Object.freeze({
      heightAboveGround: 0,
      verticalVelocity: 0,
      grounded: true,
      coyoteRemaining: policy.coyoteTimeSeconds,
    });
  }

  return Object.freeze({
    heightAboveGround: height,
    verticalVelocity,
    grounded: false,
    coyoteRemaining: Math.max(0, jump.coyoteRemaining - delta),
  });
};

export interface SweepHit {
  readonly colliderId: EntityId;
  readonly fraction: number;
  readonly normal: Vec3;
}

const sweptCircleVsCircle = (
  start: Vec3,
  displacement: Vec3,
  radius: number,
  collider: Collider,
): SweepHit | null => {
  if (collider.shape.type !== 'circle') return null;
  const target = radius + collider.shape.value.radius;
  const ox = start.x - collider.shape.value.x;
  const oz = start.z - collider.shape.value.z;
  const dx = displacement.x;
  const dz = displacement.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - target * target;
  if (c <= 0) return Object.freeze({ colliderId: collider.id, fraction: 0, normal: normalize3(vec3(ox, 0, oz)) });
  if (a <= 1e-12) return null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (root < 0 || root > 1) return null;
  const hitX = start.x + dx * root;
  const hitZ = start.z + dz * root;
  const normal = normalize3(vec3(hitX - collider.shape.value.x, 0, hitZ - collider.shape.value.z));
  return Object.freeze({ colliderId: collider.id, fraction: root, normal });
};

export const sweepCircle = (
  start: Vec3,
  displacement: Vec3,
  radius: number,
  colliders: readonly Collider[],
): SweepHit | null => {
  const hits = colliders
    .filter((collider) => collider.enabled)
    .map((collider) => sweptCircleVsCircle(start, displacement, radius, collider))
    .filter((hit): hit is SweepHit => hit !== null)
    .sort((a, b) => a.fraction - b.fraction || a.colliderId.localeCompare(b.colliderId));
  return hits[0] ?? null;
};

export class StrictPhysicsRuntime {
  #policy: PhysicsPolicy;
  #sampler: GroundSampler;
  #colliders: Collider[] = [];
  #disposed = false;
  #resolvedCollisions = 0;

  constructor(
    sampler: GroundSampler,
    policy: PhysicsPolicy = DEFAULT_PHYSICS_POLICY,
    colliders: readonly Collider[] = [],
  ) {
    this.#sampler = sampler;
    this.#policy = Object.freeze({ ...policy });
    this.#colliders = [...colliders];
  }

  addCollider(collider: Collider): Result<void> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Physics runtime is disposed.');
    if (!collider.id || collider.shape.type === undefined) return err('INVALID_FRAME', 'Invalid collider definition.');
    if (this.#colliders.some((item) => item.id === collider.id)) return err('COLLISION_LIMIT', 'Collider id already exists.', false, { id: collider.id });
    this.#colliders.push(collider);
    this.#colliders.sort((a, b) => a.id.localeCompare(b.id));
    return ok(undefined);
  }

  removeCollider(id: EntityId): void {
    this.#colliders = this.#colliders.filter((collider) => collider.id !== id);
  }

  step(body: PhysicsBodyState, jump: JumpState, input: Vec3, jumpRequested: boolean, dt = this.#policy.fixedStepSeconds): Result<PhysicsStepResult> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Physics runtime is disposed.');
    const delta = clamp(dt, 0, 0.1);
    const normalizedInput = lengthXZ(input) > 1 ? normalize3(vec3(input.x, 0, input.z)) : vec3(input.x, 0, input.z);
    const currentGround = resolveGroundContact(body.position, body.velocity, this.#sampler, this.#policy);
    const nextJump = integrateJump(
      Object.freeze({
        heightAboveGround: Math.max(0, body.position.y - currentGround.groundY),
        verticalVelocity: body.velocity.y,
        grounded: body.onGround || currentGround.grounded,
        coyoteRemaining: jump.coyoteRemaining,
      }),
      delta,
      jumpRequested,
      this.#policy,
    );

    const nextVelocity = vec3(
      normalizedInput.x,
      nextJump.verticalVelocity,
      normalizedInput.z,
    );
    const displacement = mulVelocity(nextVelocity, delta);
    const swept = sweepCircle(body.position, displacement, body.radius, this.#colliders);
    const moved = swept
      ? vec3(
          body.position.x + displacement.x * Math.max(0, swept.fraction - 1e-4),
          body.position.y + displacement.y * Math.max(0, swept.fraction - 1e-4),
          body.position.z + displacement.z * Math.max(0, swept.fraction - 1e-4),
        )
      : vec3(body.position.x + displacement.x, body.position.y + displacement.y, body.position.z + displacement.z);

    const contacts = collideCircleAgainst(moved, body.radius, this.#colliders, this.#policy);
    const resolvedPosition = depenetrate(moved, contacts, this.#policy.maxDepenetrationIterations);
    this.#resolvedCollisions += contacts.length;

    const finalGround = resolveGroundContact(resolvedPosition, nextVelocity, this.#sampler, this.#policy);
    const grounded = applyGroundContact(resolvedPosition, nextVelocity, finalGround, this.#policy);
    const finalPosition = grounded.grounded
      ? vec3(grounded.position.x, grounded.position.y + nextJump.heightAboveGround, grounded.position.z)
      : resolvedPosition;

    return ok(Object.freeze({
      body: Object.freeze({
        ...body,
        position: finalPosition,
        velocity: grounded.grounded ? vec3(nextVelocity.x, 0, nextVelocity.z) : nextVelocity,
        onGround: grounded.grounded,
        groundedMaterial: finalGround.material,
      }),
      jump: Object.freeze({ ...nextJump, grounded: grounded.grounded }),
      contacts,
      resolvedCollisions: this.#resolvedCollisions,
      saturated: Boolean(swept && swept.fraction <= 1e-6),
    }));
  }

  diagnostics(): Readonly<{ colliderCount: number; resolvedCollisions: number; disposed: boolean }> {
    return Object.freeze({
      colliderCount: this.#colliders.length,
      resolvedCollisions: this.#resolvedCollisions,
      disposed: this.#disposed,
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#colliders = [];
  }
}

const mulVelocity = (velocity: Vec3, dt: number): Vec3 =>
  vec3(velocity.x * dt, velocity.y * dt, velocity.z * dt);
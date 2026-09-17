import type { PhysicsBody, PhysicsInput, PhysicsPort, PhysicsSweepResult, Vector3Like, WorldPoint } from './portsR3.ts';

export interface PhysicsConfig {
  readonly gravity: number;
  readonly maxDeltaMs: number;
  readonly maxSpeed: number;
  readonly groundOffset: number;
  readonly slopeLimitDegrees: number;
  readonly skinWidth: number;
  readonly acceleration: number;
  readonly braking: number;
}

export interface Collider {
  readonly id: string;
  readonly contains(x: number, z: number, radius: number): boolean;
  readonly height(x: number, z: number): number;
  readonly normal?(x: number, z: number): Vector3Like;
}

export interface PhysicsWorldOptions {
  readonly sampleHeight: (x: number, z: number) => number;
  readonly waterLevel: number;
  readonly isWalkable?: (x: number, z: number, radius: number) => boolean;
  readonly colliders?: readonly Collider[];
  readonly config?: Partial<PhysicsConfig>;
}

export interface CharacterState extends PhysicsBody {
  readonly grounded: boolean;
  readonly coyoteMs: number;
  readonly jumpConsumed: boolean;
  readonly verticalSpeed: number;
}

export interface PhysicsStepResult {
  readonly state: CharacterState;
  readonly contact: PhysicsSweepResult;
  readonly groundedChanged: boolean;
  readonly blocked: boolean;
}

const DEFAULT_CONFIG: PhysicsConfig = {
  gravity: -24,
  maxDeltaMs: 50,
  maxSpeed: 24,
  groundOffset: 0,
  slopeLimitDegrees: 48,
  skinWidth: 0.04,
  acceleration: 36,
  braking: 44,
};

const EPSILON = 1e-6;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const add = (a: Vector3Like, b: Vector3Like): Vector3Like => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vector3Like, value: number): Vector3Like => ({ x: a.x * value, y: a.y * value, z: a.z * value });
const length = (a: Vector3Like): number => Math.hypot(a.x, a.y, a.z);

function normalize(a: Vector3Like): Vector3Like {
  const len = length(a);
  return len <= EPSILON ? { x: 0, y: 1, z: 0 } : scale(a, 1 / len);
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function horizontalSpeed(velocity: Vector3Like): number {
  return Math.hypot(velocity.x, velocity.z);
}

function horizontalNormal(velocity: Vector3Like): Vector3Like {
  const magnitude = Math.hypot(velocity.x, velocity.z);
  if (magnitude <= EPSILON) return { x: 0, y: 1, z: 0 };
  return { x: -velocity.z / magnitude, y: 0, z: velocity.x / magnitude };
}

export class PhysicsRuntimeR3 implements PhysicsPort {
  readonly #height: (x: number, z: number) => number;
  readonly #waterLevel: number;
  readonly #walkable: (x: number, z: number, radius: number) => boolean;
  readonly #colliders: readonly Collider[];
  readonly #config: PhysicsConfig;

  constructor(options: PhysicsWorldOptions) {
    this.#height = options.sampleHeight;
    this.#waterLevel = Number.isFinite(options.waterLevel) ? options.waterLevel : 0;
    this.#walkable = options.isWalkable ?? (() => true);
    this.#colliders = options.colliders ?? [];
    this.#config = { ...DEFAULT_CONFIG, ...options.config };
  }

  integrate(body: PhysicsBody, input: PhysicsInput, deltaMs: number): PhysicsBody {
    return this.stepCharacter(body as CharacterState, input, deltaMs).state;
  }

  sweep(body: PhysicsBody, from: WorldPoint, to: WorldPoint): PhysicsSweepResult {
    const steps = Math.max(1, Math.min(32, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 2)));
    let previous: WorldPoint = from;
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const candidate = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
        biome: previous.biome,
      };
      const ground = this.#groundHeight(candidate.x, candidate.z);
      const collision = candidate.y - body.radius <= ground + this.#config.skinWidth;
      const blocked = !this.#walkable(candidate.x, candidate.z, body.radius);
      if (collision || blocked) {
        const correctedY = Math.max(candidate.y, ground + body.radius + this.#config.skinWidth);
        return {
          position: { ...candidate, y: correctedY },
          normal: { x: 0, y: 1, z: 0 },
          collided: true,
          toi: t,
        };
      }
      previous = candidate;
    }
    return { position: to, normal: { x: 0, y: 1, z: 0 }, collided: false, toi: 1 };
  }

  stepCharacter(state: CharacterState, input: PhysicsInput, deltaMs: number): PhysicsStepResult {
    const safeDeltaMs = clamp(Number.isFinite(deltaMs) ? deltaMs : 0, 0, this.#config.maxDeltaMs);
    const dt = safeDeltaMs / 1000;
    const desired = this.#clampHorizontalVelocity(input.desiredVelocity);
    const currentHorizontal = { x: state.velocity.x, y: 0, z: state.velocity.z };
    const desiredHorizontal = { x: desired.x, y: 0, z: desired.z };
    const currentSpeed = horizontalSpeed(currentHorizontal);
    const desiredSpeed = horizontalSpeed(desiredHorizontal);
    const response = desiredSpeed > currentSpeed ? this.#config.acceleration : this.#config.braking;
    const blend = clamp(response * dt / Math.max(currentSpeed, desiredSpeed, 1), 0, 1);
    let horizontal = {
      x: currentHorizontal.x + (desiredHorizontal.x - currentHorizontal.x) * blend,
      y: 0,
      z: currentHorizontal.z + (desiredHorizontal.z - currentHorizontal.z) * blend,
    };

    if (input.friction > 0 && desiredSpeed <= EPSILON) {
      const friction = clamp(input.friction, 0, 1) * this.#config.braking * dt;
      horizontal = { x: moveTowards(horizontal.x, 0, friction), y: 0, z: moveTowards(horizontal.z, 0, friction) };
    }

    let verticalVelocity = state.velocity.y;
    const coyoteRemaining = Math.max(0, state.coyoteMs - safeDeltaMs);
    const canJump = input.jump && !state.jumpConsumed && (state.grounded || coyoteRemaining > 0);
    if (canJump) {
      verticalVelocity = Math.sqrt(Math.max(0.1, -2 * this.#config.gravity * 1.15));
    } else if (!state.grounded || verticalVelocity > 0) {
      verticalVelocity += this.#config.gravity * Math.max(0, input.gravityScale) * dt;
    }

    const from = state.position;
    const targetPosition: WorldPoint = {
      x: from.x + horizontal.x * dt,
      y: from.y + verticalVelocity * dt,
      z: from.z + horizontal.z * dt,
      biome: from.biome,
    };
    const contact = this.sweep(state, from, targetPosition);
    const finalPosition = contact.position;
    const ground = this.#groundHeight(finalPosition.x, finalPosition.z);
    const grounded = finalPosition.y <= ground + state.radius + this.#config.skinWidth + 0.01 && verticalVelocity <= 1;
    const groundedChanged = grounded !== state.grounded;
    if (grounded) verticalVelocity = 0;

    const blocked = !this.#walkable(finalPosition.x, finalPosition.z, state.radius);
    const finalVelocity: Vector3Like = {
      x: blocked ? 0 : clamp(horizontal.x, -this.#config.maxSpeed, this.#config.maxSpeed),
      y: clamp(verticalVelocity, -60, 60),
      z: blocked ? 0 : clamp(horizontal.z, -this.#config.maxSpeed, this.#config.maxSpeed),
    };

    const next: CharacterState = {
      ...state,
      position: grounded
        ? { ...finalPosition, y: ground + state.radius + this.#config.groundOffset }
        : finalPosition,
      velocity: finalVelocity,
      acceleration: scale(add(finalVelocity, scale(state.velocity, -1)), dt <= EPSILON ? 0 : 1 / dt),
      grounded,
      coyoteMs: grounded ? 120 : coyoteRemaining,
      jumpConsumed: canJump ? true : grounded ? false : state.jumpConsumed,
      verticalSpeed: finalVelocity.y,
    };
    return { state: next, contact, groundedChanged, blocked };
  }

  constrainSlope(position: WorldPoint, velocity: Vector3Like): Vector3Like {
    const normal = this.#surfaceNormal(position.x, position.z);
    const upDot = clamp(normal.y, -1, 1);
    const slopeDegrees = Math.acos(upDot) * 180 / Math.PI;
    if (slopeDegrees <= this.#config.slopeLimitDegrees) return velocity;
    const tangent = add(velocity, scale(normal, -velocity.x * normal.x - velocity.y * normal.y - velocity.z * normal.z));
    return scale(normalize(tangent), Math.min(horizontalSpeed(velocity), this.#config.maxSpeed));
  }

  waterState(position: WorldPoint): 'dry' | 'shore' | 'shallow' | 'deep' {
    const depth = this.#waterLevel - this.#groundHeight(position.x, position.z);
    if (depth <= 0) return 'dry';
    if (depth < 0.4) return 'shore';
    if (depth < 2.5) return 'shallow';
    return 'deep';
  }

  #clampHorizontalVelocity(velocity: Vector3Like): Vector3Like {
    const max = this.#config.maxSpeed;
    const magnitude = Math.hypot(velocity.x, velocity.z);
    if (magnitude <= max) return { x: velocity.x, y: velocity.y, z: velocity.z };
    const factor = max / magnitude;
    return { x: velocity.x * factor, y: velocity.y, z: velocity.z * factor };
  }

  #groundHeight(x: number, z: number): number {
    let value = this.#height(x, z);
    for (const collider of this.#colliders) {
      if (collider.contains(x, z, 0)) value = Math.max(value, collider.height(x, z));
    }
    return Number.isFinite(value) ? value : this.#waterLevel;
  }

  #surfaceNormal(x: number, z: number): Vector3Like {
    const e = 0.5;
    const center = this.#groundHeight(x, z);
    const dx = this.#groundHeight(x + e, z) - center;
    const dz = this.#groundHeight(x, z + e) - center;
    return normalize({ x: -dx, y: e * 2, z: -dz });
  }
}

export function createDefaultCharacter(id: string, position: WorldPoint, radius = 0.45): CharacterState {
  return {
    id,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    radius,
    grounded: true,
    coyoteMs: 120,
    jumpConsumed: false,
    verticalSpeed: 0,
  };
}

export function resolveFacingFromVelocity(velocity: Vector3Like, fallbackRadians = 0): number {
  const heading = horizontalNormal(velocity);
  if (Math.hypot(heading.x, heading.z) <= EPSILON) return fallbackRadians;
  return Math.atan2(velocity.x, velocity.z);
}

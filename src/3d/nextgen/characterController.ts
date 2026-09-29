import {
  CharacterState,
  InputIntent,
  Outcome,
  Vec3,
  add3,
  asEntityId,
  clamp,
  dampAlpha,
  fault,
  lengthXZ,
  normalize3,
  scale3,
  sub3,
  vec3,
} from './kernelTypes.ts';

export interface GroundQuery {
  readonly sample: (x: number, z: number) => number;
  readonly material?: (x: number, z: number) => string;
  readonly maxSlopeDegrees?: (x: number, z: number) => number;
}

export interface MovementPolicy {
  readonly walkSpeed: number;
  readonly sprintSpeed: number;
  readonly acceleration: number;
  readonly braking: number;
  readonly airControl: number;
  readonly gravity: number;
  readonly terminalFallSpeed: number;
  readonly jumpSpeed: number;
  readonly coyoteSeconds: number;
  readonly jumpBufferSeconds: number;
  readonly dodgeSpeed: number;
  readonly dodgeDurationSeconds: number;
  readonly dodgeCooldownSeconds: number;
  readonly maxStamina: number;
  readonly sprintStaminaPerSecond: number;
  readonly dodgeStamina: number;
  readonly staminaRecoveryPerSecond: number;
  readonly skinWidth: number;
  readonly maxGroundSlopeDegrees: number;
}

export const DEFAULT_MOVEMENT_POLICY: MovementPolicy = Object.freeze({
  walkSpeed: 5.2,
  sprintSpeed: 8.4,
  acceleration: 22,
  braking: 26,
  airControl: 0.35,
  gravity: 24,
  terminalFallSpeed: 55,
  jumpSpeed: 8.5,
  coyoteSeconds: 0.12,
  jumpBufferSeconds: 0.14,
  dodgeSpeed: 11,
  dodgeDurationSeconds: 0.28,
  dodgeCooldownSeconds: 0.45,
  maxStamina: 100,
  sprintStaminaPerSecond: 16,
  dodgeStamina: 24,
  staminaRecoveryPerSecond: 22,
  skinWidth: 0.06,
  maxGroundSlopeDegrees: 42,
});

export interface MovementHooks {
  readonly resolveMove?: (
    from: Vec3,
    desired: Vec3,
    radius: number,
    height: number,
  ) => Vec3;
  readonly isBlocked?: (position: Vec3, radius: number, height: number) => boolean;
}

export interface CharacterControllerInput {
  readonly entity?: string;
  readonly position?: Vec3;
  readonly velocity?: Vec3;
  readonly radius?: number;
  readonly height?: number;
  readonly health?: number;
  readonly heading?: number;
}

export interface MovementResult {
  readonly state: CharacterState;
  readonly jumped: boolean;
  readonly dodged: boolean;
  readonly sprinting: boolean;
  readonly staminaSpent: number;
  readonly displacement: Vec3;
  readonly groundMaterial: string;
}

export class CharacterController {
  readonly policy: MovementPolicy;
  readonly ground: GroundQuery;
  readonly hooks: MovementHooks;

  #state: CharacterState;
  #radius = 0.42;
  #height = 1.8;
  #coyoteRemaining = 0;
  #jumpBufferRemaining = 0;
  #dodgeRemaining = 0;
  #dodgeCooldownRemaining = 0;
  #dodgeDirection = vec3(0, 0, 1);
  #disposed = false;

  constructor(
    ground: GroundQuery,
    input: CharacterControllerInput = {},
    policy: MovementPolicy = DEFAULT_MOVEMENT_POLICY,
    hooks: MovementHooks = {},
  ) {
    this.ground = ground;
    this.policy = Object.freeze({ ...policy });
    this.hooks = hooks;
    const position = input.position ?? vec3(0, ground.sample(0, 0), 8);
    const groundY = ground.sample(position.x, position.z);
    this.#state = Object.freeze({
      entity: asEntityId(input.entity ?? 'player'),
      position: vec3(position.x, Math.max(position.y, groundY), position.z),
      velocity: input.velocity ?? vec3(),
      grounded: true,
      groundY,
      stamina: clamp(input.health ?? policy.maxStamina, 0, policy.maxStamina),
      health: clamp(input.health ?? 100, 0, 100),
      heading: input.heading ?? 0,
    });
  }

  #directionFromIntent(intent: InputIntent): Vec3 {
    const forwardX = Math.sin(this.#state.heading);
    const forwardZ = Math.cos(this.#state.heading);
    const rightX = Math.cos(this.#state.heading);
    const rightZ = -Math.sin(this.#state.heading);
    return normalize3(vec3(
      rightX * intent.move.x + forwardX * intent.move.y,
      0,
      rightZ * intent.move.x + forwardZ * intent.move.y,
    ));
  }

  #approach(current: number, target: number, maxDelta: number): number {
    if (current < target) return Math.min(target, current + maxDelta);
    return Math.max(target, current - maxDelta);
  }

  step(
    dt: number,
    intent: InputIntent | null,
    inputHeading: number = this.#state.heading,
  ): Outcome<MovementResult> {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Character controller is disposed.', false) };
    const delta = clamp(dt, 0, 0.1);
    const activeIntent = intent ?? Object.freeze({
      source: 'synthetic' as const,
      move: { x: 0, y: 0, magnitude: 0 },
      look: { x: 0, y: 0, magnitude: 0 },
      zoom: 0,
      held: new Set<string>(),
      pressed: new Set<string>(),
      released: new Set<string>(),
      sequence: 0,
      sampleTime: 0,
    });

    const previous = this.#state;
    this.#state = Object.freeze({ ...previous, heading: inputHeading });

    const groundY = this.ground.sample(previous.position.x, previous.position.z);
    const slope = this.ground.maxSlopeDegrees?.(previous.position.x, previous.position.z) ?? 0;
    const groundedNow = previous.position.y <= groundY + this.policy.skinWidth && slope <= this.policy.maxGroundSlopeDegrees;
    if (groundedNow) this.#coyoteRemaining = this.policy.coyoteSeconds;
    else this.#coyoteRemaining = Math.max(0, this.#coyoteRemaining - delta);

    if (activeIntent.pressed.has('jump')) this.#jumpBufferRemaining = this.policy.jumpBufferSeconds;
    else this.#jumpBufferRemaining = Math.max(0, this.#jumpBufferRemaining - delta);

    if (this.#dodgeCooldownRemaining > 0) this.#dodgeCooldownRemaining = Math.max(0, this.#dodgeCooldownRemaining - delta);

    let staminaSpent = 0;
    let sprinting = false;
    let jumped = false;
    let dodged = false;

    const moveDirection = this.#directionFromIntent(activeIntent);
    const moving = lengthXZ(moveDirection) > 0.01;
    const sprintRequested = activeIntent.held.has('sprint');
    if (sprintRequested && moving && previous.stamina > 0.1 && groundedNow && this.#dodgeRemaining <= 0) {
      sprinting = true;
      staminaSpent += this.policy.sprintStaminaPerSecond * delta;
    }

    if (activeIntent.pressed.has('dodge') && moving && this.#dodgeCooldownRemaining <= 0 && previous.stamina >= this.policy.dodgeStamina) {
      this.#dodgeRemaining = this.policy.dodgeDurationSeconds;
      this.#dodgeCooldownRemaining = this.policy.dodgeCooldownSeconds;
      this.#dodgeDirection = moveDirection;
      staminaSpent += this.policy.dodgeStamina;
      dodged = true;
    }

    if (this.#jumpBufferRemaining > 0 && this.#coyoteRemaining > 0 && this.#dodgeRemaining <= 0) {
      jumped = true;
      this.#jumpBufferRemaining = 0;
      this.#coyoteRemaining = 0;
    }

    const desiredSpeed = this.#dodgeRemaining > 0
      ? this.policy.dodgeSpeed
      : sprinting
        ? this.policy.sprintSpeed
        : this.policy.walkSpeed;
    const desiredDirection = this.#dodgeRemaining > 0 ? this.#dodgeDirection : moveDirection;
    const control = groundedNow ? 1 : this.policy.airControl;
    const desiredVelocity = scale3(desiredDirection, desiredSpeed);
    const horizontalVelocity = vec3(
      this.#approach(previous.velocity.x, desiredVelocity.x, this.policy.acceleration * control * delta),
      0,
      this.#approach(previous.velocity.z, desiredVelocity.z, this.policy.acceleration * control * delta),
    );

    let verticalVelocity = previous.velocity.y;
    if (jumped) verticalVelocity = this.policy.jumpSpeed;
    else if (!groundedNow) verticalVelocity = Math.max(-this.policy.terminalFallSpeed, verticalVelocity - this.policy.gravity * delta);
    else verticalVelocity = Math.max(0, verticalVelocity);

    const integrated = add3(
      previous.position,
      scale3(vec3(horizontalVelocity.x, verticalVelocity, horizontalVelocity.z), delta),
    );

    const resolved = this.hooks.resolveMove
      ? this.hooks.resolveMove(previous.position, integrated, this.#radius, this.#height)
      : integrated;

    const resolvedGround = this.ground.sample(resolved.x, resolved.z);
    const finalY = Math.max(resolvedGround, resolved.y);
    const finalGrounded = finalY <= resolvedGround + this.policy.skinWidth && verticalVelocity <= 0;
    const recoveredStamina = sprinting || dodged
      ? previous.stamina - staminaSpent
      : previous.stamina + this.policy.staminaRecoveryPerSecond * delta;
    const nextStamina = clamp(recoveredStamina, 0, this.policy.maxStamina);

    if (this.#dodgeRemaining > 0) this.#dodgeRemaining = Math.max(0, this.#dodgeRemaining - delta);

    const displacement = sub3(vec3(resolved.x, finalY, resolved.z), previous.position);
    this.#state = Object.freeze({
      ...previous,
      position: vec3(resolved.x, finalY, resolved.z),
      velocity: vec3(horizontalVelocity.x, finalGrounded ? 0 : verticalVelocity, horizontalVelocity.z),
      grounded: finalGrounded,
      groundY: resolvedGround,
      stamina: nextStamina,
      heading: inputHeading,
    });

    const material = this.ground.material?.(resolved.x, resolved.z) ?? 'default-ground';
    return {
      ok: true,
      value: Object.freeze({
        state: this.#state,
        jumped,
        dodged,
        sprinting,
        staminaSpent,
        displacement,
        groundMaterial: material,
      }),
    };
  }

  state(): CharacterState { return this.#state; }
  radius(): number { return this.#radius; }
  height(): number { return this.#height; }
  coyoteRemaining(): number { return this.#coyoteRemaining; }
  jumpBufferRemaining(): number { return this.#jumpBufferRemaining; }
  dodgeRemaining(): number { return this.#dodgeRemaining; }
  isDodgeActive(): boolean { return this.#dodgeRemaining > 0; }

  damage(amount: number): number {
    const damage = Math.max(0, amount);
    const health = Math.max(0, this.#state.health - damage);
    this.#state = Object.freeze({ ...this.#state, health });
    return health;
  }

  heal(amount: number): number {
    const health = Math.min(100, this.#state.health + Math.max(0, amount));
    this.#state = Object.freeze({ ...this.#state, health });
    return health;
  }

  teleport(position: Vec3): void {
    const groundY = this.ground.sample(position.x, position.z);
    this.#state = Object.freeze({
      ...this.#state,
      position: vec3(position.x, Math.max(position.y, groundY), position.z),
      velocity: vec3(),
      groundY,
      grounded: true,
    });
  }

  respawn(position: Vec3): void {
    this.#coyoteRemaining = this.policy.coyoteSeconds;
    this.#jumpBufferRemaining = 0;
    this.#dodgeRemaining = 0;
    this.#dodgeCooldownRemaining = 0;
    this.teleport(position);
    this.#state = Object.freeze({ ...this.#state, health: 100, stamina: this.policy.maxStamina });
  }

  diagnostics() {
    return Object.freeze({
      entity: this.#state.entity,
      health: this.#state.health,
      stamina: this.#state.stamina,
      grounded: this.#state.grounded,
      dodgeActive: this.#dodgeRemaining > 0,
      coyoteRemaining: this.#coyoteRemaining,
      jumpBufferRemaining: this.#jumpBufferRemaining,
    });
  }

  dispose(): void {
    this.#disposed = true;
  }
}

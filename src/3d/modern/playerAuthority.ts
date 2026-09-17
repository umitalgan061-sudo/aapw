export type PlayerLocomotion = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'dodge' | 'attack' | 'stunned' | 'dead';
export type PlayerStance = 'neutral' | 'combat' | 'stealth' | 'mounted';

export interface PlayerInput {
  readonly moveX: number;
  readonly moveZ: number;
  readonly sprint: boolean;
  readonly jumpPressed: boolean;
  readonly dodgePressed: boolean;
  readonly attackPressed: boolean;
  readonly heavyPressed: boolean;
  readonly block: boolean;
  readonly aimX?: number;
  readonly aimZ?: number;
}

export interface PlayerTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly grounded: boolean;
}

export interface PlayerStats {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly staminaRegen: number;
  readonly moveSpeed: number;
  readonly runMultiplier: number;
  readonly sprintMultiplier: number;
  readonly jumpVelocity: number;
  readonly gravity: number;
  readonly acceleration: number;
  readonly deceleration: number;
  readonly coyoteMs: number;
  readonly inputBufferMs: number;
  readonly dodgeSpeed: number;
  readonly dodgeDurationMs: number;
  readonly dodgeCost: number;
}

export interface PlayerState {
  readonly id: string;
  readonly transform: PlayerTransform;
  readonly velocity: { readonly x: number; readonly y: number; readonly z: number };
  readonly locomotion: PlayerLocomotion;
  readonly stance: PlayerStance;
  readonly stats: PlayerStats;
  readonly invulnerableMs: number;
  readonly stunMs: number;
  readonly jumpBufferMs: number;
  readonly coyoteRemainingMs: number;
  readonly dodgeRemainingMs: number;
  /** Simulation-time timestamp in milliseconds, never a wall-clock timestamp. */
  readonly lastAttackAt: number;
  readonly revision: number;
}

export interface PlayerAuthorityOptions {
  readonly id?: string;
  /** Retained for API compatibility; simulation state does not depend on it. */
  readonly now?: () => number;
  readonly collision?: (x: number, y: number, z: number) => { readonly grounded: boolean; readonly y: number };
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const length = (x: number, z: number): number => Math.hypot(x, z);
const normalize = (x: number, z: number): readonly [number, number] => { const m = length(x, z); return m < 1e-6 ? [0, 0] : [x / m, z / m]; };
const approach = (current: number, target: number, amount: number): number => current < target ? Math.min(target, current + amount) : Math.max(target, current - amount);

const DEFAULT_STATS: PlayerStats = Object.freeze({
  health: 100,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  staminaRegen: 24,
  moveSpeed: 2.8,
  runMultiplier: 1.35,
  sprintMultiplier: 1.85,
  jumpVelocity: 6.2,
  gravity: 18,
  acceleration: 18,
  deceleration: 24,
  coyoteMs: 110,
  inputBufferMs: 120,
  dodgeSpeed: 7.8,
  dodgeDurationMs: 260,
  dodgeCost: 22,
});

export const defaultPlayerState = (id = 'player-1'): PlayerState => Object.freeze({
  id,
  transform: Object.freeze({ x: 0, y: 0, z: 0, yaw: 0, grounded: true }),
  velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
  locomotion: 'idle',
  stance: 'neutral',
  stats: DEFAULT_STATS,
  invulnerableMs: 0,
  stunMs: 0,
  jumpBufferMs: 0,
  coyoteRemainingMs: 0,
  dodgeRemainingMs: 0,
  lastAttackAt: -Infinity,
  revision: 0,
});

export interface PlayerStepResult {
  readonly state: PlayerState;
  readonly events: readonly PlayerEvent[];
}

export type PlayerEvent =
  | { readonly type: 'jump'; readonly id: string }
  | { readonly type: 'dodge'; readonly id: string }
  | { readonly type: 'attack'; readonly id: string; readonly heavy: boolean }
  | { readonly type: 'land'; readonly id: string }
  | { readonly type: 'stamina'; readonly id: string; readonly value: number }
  | { readonly type: 'dead'; readonly id: string };

export class PlayerAuthority {
  readonly #collision: NonNullable<PlayerAuthorityOptions['collision']>;
  #state: PlayerState;
  #elapsedMs = 0;

  constructor(options: PlayerAuthorityOptions = {}) {
    void options.now;
    this.#collision = options.collision ?? ((_x, y, _z) => ({ grounded: y <= 0, y: Math.max(0, y) }));
    this.#state = defaultPlayerState(options.id);
  }

  get state(): PlayerState { return this.#state; }

  reset(state: Partial<PlayerState> = {}): void {
    const base = defaultPlayerState(state.id ?? 'player-1');
    this.#state = Object.freeze({ ...base, ...state, stats: Object.freeze({ ...DEFAULT_STATS, ...(state.stats ?? {}) }) });
    this.#elapsedMs = 0;
  }

  spendStamina(amount: number): boolean {
    const cost = Math.max(0, Number.isFinite(amount) ? amount : 0);
    if (cost > this.#state.stats.stamina) return false;
    this.#state = Object.freeze({
      ...this.#state,
      stats: Object.freeze({ ...this.#state.stats, stamina: Number((this.#state.stats.stamina - cost).toFixed(4)) }),
      revision: this.#state.revision + 1,
    });
    return true;
  }

  restoreStamina(amount: number): number {
    if (this.#state.locomotion === 'dead') return 0;
    const gain = Math.max(0, Number.isFinite(amount) ? amount : 0);
    const next = clamp(this.#state.stats.stamina + gain, 0, this.#state.stats.maxStamina);
    const delta = next - this.#state.stats.stamina;
    if (delta === 0) return 0;
    this.#state = Object.freeze({
      ...this.#state,
      stats: Object.freeze({ ...this.#state.stats, stamina: Number(next.toFixed(4)) }),
      revision: this.#state.revision + 1,
    });
    return delta;
  }

  setStance(stance: PlayerStance): void {
    if (this.#state.locomotion === 'dead') return;
    this.#state = Object.freeze({ ...this.#state, stance, revision: this.#state.revision + 1 });
  }

  step(input: PlayerInput, deltaMs: number): PlayerStepResult {
    const dtMs = clamp(deltaMs, 0, 100);
    const dt = dtMs / 1000;
    this.#elapsedMs += dtMs;
    const current = this.#state;
    const stats = current.stats;
    const events: PlayerEvent[] = [];
    let jumpBuffer = Math.max(0, current.jumpBufferMs - dtMs);
    if (input.jumpPressed) jumpBuffer = stats.inputBufferMs;
    let coyote = current.transform.grounded ? stats.coyoteMs : Math.max(0, current.coyoteRemainingMs - dtMs);
    let invulnerableMs = Math.max(0, current.invulnerableMs - dtMs);
    let stunMs = Math.max(0, current.stunMs - dtMs);
    let dodgeRemainingMs = Math.max(0, current.dodgeRemainingMs - dtMs);
    let stamina = current.stats.stamina;
    let health = current.stats.health;
    let x = current.transform.x;
    let y = current.transform.y;
    let z = current.transform.z;
    let vx = current.velocity.x;
    let vy = current.velocity.y;
    let vz = current.velocity.z;
    let yaw = current.transform.yaw;
    let locomotion = current.locomotion;
    const move = normalize(clamp(input.moveX, -1, 1), clamp(input.moveZ, -1, 1));
    const moveAmount = Math.min(1, Math.hypot(input.moveX, input.moveZ));
    const desiredMultiplier = input.sprint && stamina > 1 ? stats.sprintMultiplier : moveAmount > 0.01 ? stats.runMultiplier : 0;
    const desiredSpeed = stats.moveSpeed * desiredMultiplier * moveAmount;
    const desiredVx = move[0] * desiredSpeed;
    const desiredVz = move[1] * desiredSpeed;

    if (stunMs > 0 || locomotion === 'dead') {
      vx = approach(vx, 0, stats.deceleration * dt);
      vz = approach(vz, 0, stats.deceleration * dt);
      locomotion = health <= 0 ? 'dead' : 'stunned';
    } else if (dodgeRemainingMs > 0) {
      locomotion = 'dodge';
      invulnerableMs = Math.max(invulnerableMs, dodgeRemainingMs);
      vx = approach(vx, desiredVx, stats.acceleration * dt * 0.25);
      vz = approach(vz, desiredVz, stats.acceleration * dt * 0.25);
    } else {
      vx = approach(vx, desiredVx, (moveAmount > 0.01 ? stats.acceleration : stats.deceleration) * dt);
      vz = approach(vz, desiredVz, (moveAmount > 0.01 ? stats.acceleration : stats.deceleration) * dt);
      if (input.attackPressed && stamina >= 12) {
        locomotion = 'attack';
        stamina -= 12;
        events.push({ type: 'attack', id: current.id, heavy: false });
      } else if (input.heavyPressed && stamina >= 26) {
        locomotion = 'attack';
        stamina -= 26;
        events.push({ type: 'attack', id: current.id, heavy: true });
      } else if (input.dodgePressed && stamina >= stats.dodgeCost && moveAmount > 0.05) {
        dodgeRemainingMs = stats.dodgeDurationMs;
        invulnerableMs = stats.dodgeDurationMs;
        stamina -= stats.dodgeCost;
        vx = move[0] * stats.dodgeSpeed;
        vz = move[1] * stats.dodgeSpeed;
        locomotion = 'dodge';
        events.push({ type: 'dodge', id: current.id });
      } else if (jumpBuffer > 0 && coyote > 0) {
        vy = stats.jumpVelocity;
        jumpBuffer = 0;
        coyote = 0;
        locomotion = 'jump';
        events.push({ type: 'jump', id: current.id });
      } else if (!current.transform.grounded) {
        locomotion = vy > 0 ? 'jump' : 'fall';
      } else if (moveAmount > 0.01) {
        locomotion = input.sprint && stamina > 1 ? 'sprint' : 'run';
      } else {
        locomotion = input.block ? 'idle' : 'idle';
      }
    }

    if (input.aimX !== undefined && input.aimZ !== undefined && Math.hypot(input.aimX, input.aimZ) > 0.05) yaw = Math.atan2(input.aimX, input.aimZ);
    else if (moveAmount > 0.01) yaw = Math.atan2(move[0], move[1]);

    const consumesSprint = input.sprint && desiredSpeed > stats.moveSpeed * stats.runMultiplier && moveAmount > 0.05 && stunMs <= 0;
    const regen = consumesSprint ? 0 : stats.staminaRegen;
    stamina = clamp(stamina + regen * dt, 0, stats.maxStamina);
    if (input.block) stamina = clamp(stamina - 8 * dt, 0, stats.maxStamina);

    vy -= stats.gravity * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    const collision = this.#collision(x, y, z);
    const wasGrounded = current.transform.grounded;
    if (collision.grounded) {
      y = collision.y;
      if (!wasGrounded && vy < -0.5) events.push({ type: 'land', id: current.id });
      vy = 0;
      coyote = stats.coyoteMs;
    }
    if (health <= 0 && locomotion !== 'dead') {
      locomotion = 'dead';
      vx = 0;
      vz = 0;
      events.push({ type: 'dead', id: current.id });
    }

    const next: PlayerState = Object.freeze({
      ...current,
      transform: Object.freeze({ x, y, z, yaw, grounded: collision.grounded }),
      velocity: Object.freeze({ x: vx, y: vy, z: vz }),
      locomotion,
      stats: Object.freeze({ ...stats, health, stamina: Number(stamina.toFixed(4)) }),
      invulnerableMs,
      stunMs,
      jumpBufferMs: jumpBuffer,
      coyoteRemainingMs: coyote,
      dodgeRemainingMs,
      lastAttackAt: events.some((event) => event.type === 'attack') ? this.#elapsedMs : current.lastAttackAt,
      revision: current.revision + 1,
    });
    this.#state = next;
    if (Math.abs(current.stats.stamina - stamina) >= 0.25) events.push({ type: 'stamina', id: current.id, value: stamina });
    return Object.freeze({ state: next, events });
  }

  applyDamage(amount: number, stunMs = 0): PlayerEvent | null {
    if (this.#state.invulnerableMs > 0 || this.#state.locomotion === 'dead') return null;
    const damage = Math.max(0, Number.isFinite(amount) ? amount : 0);
    const health = Math.max(0, this.#state.stats.health - damage);
    this.#state = Object.freeze({
      ...this.#state,
      stats: Object.freeze({ ...this.#state.stats, health }),
      stunMs: Math.max(this.#state.stunMs, Math.max(0, stunMs)),
      locomotion: health <= 0 ? 'dead' : 'stunned',
      revision: this.#state.revision + 1,
    });
    return health <= 0 ? { type: 'dead', id: this.#state.id } : null;
  }
}

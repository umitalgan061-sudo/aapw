import {
  checksumV7,
  clampV7,
  entityIdV7,
  tickV7,
  type EntityIdV7,
  type InputIntentV7,
  type TickV7,
  type TransformV7,
  type Vec3V7,
  type VelocityV7,
} from './runtimeContractsV7';

export interface PredictionInputV7 {
  readonly tick: TickV7;
  readonly dtMs: number;
  readonly intent: InputIntentV7;
}

export interface PredictionStateV7 {
  readonly entity: EntityIdV7;
  readonly tick: TickV7;
  readonly transform: TransformV7;
  readonly velocity: VelocityV7;
  readonly grounded: boolean;
  readonly stamina: number;
  readonly checksum: string;
}

export interface AuthoritativeStateV7 {
  readonly entity: EntityIdV7;
  readonly tick: TickV7;
  readonly transform: TransformV7;
  readonly velocity: VelocityV7;
  readonly grounded: boolean;
  readonly stamina: number;
}

export interface PredictionCorrectionV7 {
  readonly corrected: boolean;
  readonly fromTick: TickV7;
  readonly toTick: TickV7;
  readonly positionError: number;
  readonly velocityError: number;
  readonly replayedInputs: number;
}

export interface PredictionOptionsV7 {
  readonly historyTicks?: number;
  readonly maxCorrectionDistance?: number;
  readonly speedMultiplier?: number;
  readonly acceleration?: number;
  readonly gravity?: number;
  readonly maxSpeed?: number;
}

const cloneVec = (value: Vec3V7): Vec3V7 => Object.freeze({ x: value.x, y: value.y, z: value.z });
const cloneTransform = (value: TransformV7): TransformV7 => Object.freeze({
  position: cloneVec(value.position),
  rotation: Object.freeze({ ...value.rotation }),
  scale: cloneVec(value.scale),
});
const cloneVelocity = (value: VelocityV7): VelocityV7 => Object.freeze({
  linear: cloneVec(value.linear),
  angular: cloneVec(value.angular),
  maxSpeed: value.maxSpeed,
});

function magnitude(v: Vec3V7): number { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function horizontalMagnitude(v: Vec3V7): number { return Math.sqrt(v.x * v.x + v.z * v.z); }
function normalizeHorizontal(v: Vec3V7): Vec3V7 {
  const length = Math.sqrt(v.x * v.x + v.z * v.z);
  if (length < 1e-6) return Object.freeze({ x: 0, y: 0, z: 0 });
  return Object.freeze({ x: v.x / length, y: 0, z: v.z / length });
}

export class ClientPredictionV7 {
  readonly entity: EntityIdV7;
  readonly historyTicks: number;
  readonly maxCorrectionDistance: number;
  readonly speedMultiplier: number;
  readonly acceleration: number;
  readonly gravity: number;
  readonly maxSpeed: number;
  #state: PredictionStateV7;
  #inputs = new Map<number, PredictionInputV7>();
  #states = new Map<number, PredictionStateV7>();
  #latestTick: TickV7;

  constructor(entity: EntityIdV7 | number, initial: Omit<PredictionStateV7, 'entity' | 'checksum'>, options: PredictionOptionsV7 = {}) {
    this.entity = entityIdV7(typeof entity === 'number' ? entity : Number(entity));
    this.historyTicks = Math.max(8, Math.trunc(options.historyTicks ?? 180));
    this.maxCorrectionDistance = Math.max(0.01, options.maxCorrectionDistance ?? 1.5);
    this.speedMultiplier = Math.max(0.01, options.speedMultiplier ?? 1);
    this.acceleration = Math.max(0, options.acceleration ?? 22);
    this.gravity = Math.max(0, options.gravity ?? 28);
    this.maxSpeed = Math.max(0.1, options.maxSpeed ?? 9);
    this.#latestTick = tickV7(initial.tick);
    this.#state = this.#withChecksum({ entity: this.entity, ...initial });
    this.#states.set(Number(this.#state.tick), this.#state);
  }

  step(input: PredictionInputV7): PredictionStateV7 {
    const tick = Number(input.tick);
    this.#inputs.set(tick, Object.freeze({ ...input }));
    const state = this.#simulate(this.#state, input);
    this.#state = state;
    this.#latestTick = input.tick;
    this.#states.set(tick, state);
    this.#trim();
    return state;
  }

  reconcile(authority: AuthoritativeStateV7): PredictionCorrectionV7 {
    const authoritative = this.#withChecksum({ entity: this.entity, ...authority });
    const current = this.#state;
    const dx = current.transform.position.x - authority.transform.position.x;
    const dy = current.transform.position.y - authority.transform.position.y;
    const dz = current.transform.position.z - authority.transform.position.z;
    const positionError = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const vx = current.velocity.linear.x - authority.velocity.linear.x;
    const vy = current.velocity.linear.y - authority.velocity.linear.y;
    const vz = current.velocity.linear.z - authority.velocity.linear.z;
    const velocityError = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (positionError <= this.maxCorrectionDistance && velocityError < 0.75) {
      this.#states.set(Number(authority.tick), authoritative);
      return Object.freeze({ corrected: false, fromTick: authority.tick, toTick: this.#latestTick, positionError, velocityError, replayedInputs: 0 });
    }

    let replayedInputs = 0;
    let state = authoritative;
    const fromTick = authority.tick;
    const target = Number(this.#latestTick);
    this.#states.set(Number(authority.tick), authoritative);
    for (let tick = Number(authority.tick) + 1; tick <= target; tick += 1) {
      const input = this.#inputs.get(tick);
      if (!input) continue;
      state = this.#simulate(state, input);
      this.#states.set(tick, state);
      replayedInputs += 1;
    }
    this.#state = state;
    this.#trim();
    return Object.freeze({ corrected: true, fromTick, toTick: this.#latestTick, positionError, velocityError, replayedInputs });
  }

  state(): PredictionStateV7 { return this.#state; }
  stateAt(tick: TickV7 | number): PredictionStateV7 | null { return this.#states.get(Number(tick)) ?? null; }
  inputAt(tick: TickV7 | number): PredictionInputV7 | null { return this.#inputs.get(Number(tick)) ?? null; }
  history(): readonly PredictionStateV7[] { return Object.freeze([...this.#states.values()].sort((a, b) => Number(a.tick) - Number(b.tick))); }

  #simulate(previous: PredictionStateV7, input: PredictionInputV7): PredictionStateV7 {
    const dt = clampV7(input.dtMs / 1000, 0, 0.1);
    const desired = normalizeHorizontal(input.intent.move);
    const sprint = input.intent.actions.includes('sprint');
    const jump = input.intent.actions.includes('jump');
    const speed = this.maxSpeed * (sprint ? 1.35 : 1) * this.speedMultiplier;
    const targetX = desired.x * speed;
    const targetZ = desired.z * speed;
    const blend = Math.min(1, this.acceleration * dt);
    let vx = previous.velocity.linear.x + (targetX - previous.velocity.linear.x) * blend;
    let vz = previous.velocity.linear.z + (targetZ - previous.velocity.linear.z) * blend;
    let vy = previous.velocity.linear.y;
    if (jump && previous.grounded && previous.stamina >= 15) vy = 8.5;
    if (!previous.grounded || vy > 0) vy -= this.gravity * dt;
    if (horizontalMagnitude({ x: vx, y: 0, z: vz }) > speed) {
      const factor = speed / Math.max(0.001, horizontalMagnitude({ x: vx, y: 0, z: vz }));
      vx *= factor;
      vz *= factor;
    }
    let y = previous.transform.position.y + vy * dt;
    let grounded = previous.grounded;
    if (y <= 0) {
      y = 0;
      vy = 0;
      grounded = true;
    } else {
      grounded = false;
    }
    const staminaCost = sprint ? 22 * dt : 0;
    const staminaRecovery = sprint || !grounded ? 0 : 14 * dt;
    const stamina = clampV7(previous.stamina - staminaCost + staminaRecovery, 0, 100);
    const position = Object.freeze({ x: previous.transform.position.x + vx * dt, y, z: previous.transform.position.z + vz * dt });
    const yaw = Math.abs(desired.x) + Math.abs(desired.z) > 0.001
      ? Math.atan2(desired.x, desired.z)
      : previous.transform.rotation.y;
    const transform = Object.freeze({ ...cloneTransform(previous.transform), position, rotation: Object.freeze({ ...previous.transform.rotation, y: previous.transform.rotation.y, z: yaw }) });
    return this.#withChecksum({ entity: this.entity, tick: input.tick, transform, velocity: Object.freeze({ ...cloneVelocity(previous.velocity), linear: Object.freeze({ x: vx, y: vy, z: vz }) }), grounded, stamina });
  }

  #withChecksum(value: Omit<PredictionStateV7, 'checksum'>): PredictionStateV7 {
    return Object.freeze({ ...value, checksum: checksumV7(value) });
  }

  #trim(): void {
    const floor = Number(this.#latestTick) - this.historyTicks;
    for (const key of this.#states.keys()) if (key < floor) this.#states.delete(key);
    for (const key of this.#inputs.keys()) if (key < floor) this.#inputs.delete(key);
  }
}

export function predictionErrorSeverityV7(distance: number, threshold = 1.5): 'none' | 'soft' | 'hard' {
  if (distance <= threshold * 0.25) return 'none';
  if (distance <= threshold) return 'soft';
  return 'hard';
}

export function extrapolatePositionV7(transform: TransformV7, velocity: VelocityV7, milliseconds: number): Vec3V7 {
  const dt = clampV7(milliseconds / 1000, 0, 0.5);
  return Object.freeze({
    x: transform.position.x + velocity.linear.x * dt,
    y: transform.position.y + velocity.linear.y * dt,
    z: transform.position.z + velocity.linear.z * dt,
  });
}

export function predictionStateSummaryV7(state: PredictionStateV7): Readonly<{ entity: EntityIdV7; tick: TickV7; speed: number; grounded: boolean; stamina: number; checksum: string }> {
  return Object.freeze({ entity: state.entity, tick: state.tick, speed: magnitude(state.velocity.linear), grounded: state.grounded, stamina: state.stamina, checksum: state.checksum });
}

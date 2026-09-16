import type { EntityId } from './simulationKernel.ts';
import { digestString, quantizeVector, type FixedPointVector } from './simulationKernel.ts';

export interface InputCommand {
  readonly tick: number;
  readonly sequence: number;
  readonly moveX: number;
  readonly moveZ: number;
  readonly yawDelta: number;
  readonly jump: boolean;
  readonly sprint: boolean;
}

export interface AuthoritativeState {
  readonly tick: number;
  readonly position: FixedPointVector;
  readonly velocity: FixedPointVector;
  readonly yaw: number;
  readonly health: number;
}

export interface PredictedState extends AuthoritativeState {
  readonly lastInputSequence: number;
}

export interface ReconciliationConfig {
  readonly positionToleranceMeters: number;
  readonly velocityToleranceMetersPerSecond: number;
  readonly maxInputHistory: number;
  readonly maxRollbackTicks: number;
}

export interface ReconciliationResult {
  readonly corrected: boolean;
  readonly reason: 'within-tolerance' | 'position-drift' | 'velocity-drift' | 'health-drift' | 'stale-authority' | 'rollback-limit';
  readonly correctionMagnitude: number;
  readonly replayedInputs: number;
  readonly newState: PredictedState;
}

const DEFAULT_CONFIG: ReconciliationConfig = {
  positionToleranceMeters: 0.08,
  velocityToleranceMetersPerSecond: 0.2,
  maxInputHistory: 256,
  maxRollbackTicks: 24,
};

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function validateInput(input: InputCommand): void {
  if (!Number.isInteger(input.tick) || input.tick < 0) throw new RangeError('input tick must be non-negative integer');
  if (!Number.isInteger(input.sequence) || input.sequence < 0) throw new RangeError('input sequence must be non-negative integer');
  [input.moveX, input.moveZ, input.yawDelta].forEach((value) => finite('input axis', value));
  if (Math.abs(input.moveX) > 1.001 || Math.abs(input.moveZ) > 1.001) throw new RangeError('movement axes must be normalized');
}

function distance(a: FixedPointVector, b: FixedPointVector): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

export function normalizeReconciliationConfig(partial: Partial<ReconciliationConfig> = {}): ReconciliationConfig {
  const value = { ...DEFAULT_CONFIG, ...partial };
  if (!Number.isFinite(value.positionToleranceMeters) || value.positionToleranceMeters < 0) throw new RangeError('invalid position tolerance');
  if (!Number.isFinite(value.velocityToleranceMetersPerSecond) || value.velocityToleranceMetersPerSecond < 0) throw new RangeError('invalid velocity tolerance');
  if (!Number.isInteger(value.maxInputHistory) || value.maxInputHistory < 8) throw new RangeError('maxInputHistory too small');
  if (!Number.isInteger(value.maxRollbackTicks) || value.maxRollbackTicks < 1) throw new RangeError('maxRollbackTicks must be positive');
  return Object.freeze(value);
}

export interface PredictionIntegrator {
  readonly apply: (state: AuthoritativeState, input: InputCommand, deltaSeconds: number) => AuthoritativeState;
}

export class PredictionController {
  readonly #entity: EntityId;
  readonly #config: ReconciliationConfig;
  readonly #integrator: PredictionIntegrator;
  readonly #inputs: InputCommand[] = [];
  readonly #snapshots = new Map<number, PredictedState>();
  #state: PredictedState;

  public constructor(
    entity: EntityId,
    initial: AuthoritativeState,
    integrator: PredictionIntegrator,
    config: Partial<ReconciliationConfig> = {},
  ) {
    if (!Number.isInteger(entity) || entity <= 0) throw new RangeError('entity must be positive integer');
    this.#entity = entity;
    this.#config = normalizeReconciliationConfig(config);
    this.#integrator = integrator;
    this.#state = { ...cloneAuthoritative(initial), lastInputSequence: -1 };
    this.#snapshots.set(initial.tick, this.#state);
  }

  public get entity(): EntityId { return this.#entity; }
  public get state(): PredictedState { return { ...this.#state, position: { ...this.#state.position }, velocity: { ...this.#state.velocity } }; }
  public get inputHistory(): readonly InputCommand[] { return this.#inputs; }

  public predict(input: InputCommand, deltaSeconds: number): PredictedState {
    validateInput(input);
    finite('deltaSeconds', deltaSeconds);
    if (deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative');
    const previous = this.#inputs.at(-1);
    if (previous && input.sequence <= previous.sequence) throw new Error('input sequence must increase');
    const next = this.#integrator.apply(this.#state, input, deltaSeconds);
    this.#state = {
      ...cloneAuthoritative(next),
      tick: input.tick,
      lastInputSequence: input.sequence,
    };
    this.#inputs.push(Object.freeze({ ...input }));
    while (this.#inputs.length > this.#config.maxInputHistory) this.#inputs.shift();
    this.#snapshots.set(this.#state.tick, this.state);
    this.#trimSnapshots();
    return this.state;
  }

  public reconcile(authority: AuthoritativeState, deltaSeconds: number): ReconciliationResult {
    if (authority.tick < 0 || !Number.isInteger(authority.tick)) throw new RangeError('invalid authoritative tick');
    const localSnapshot = this.#snapshots.get(authority.tick);
    if (!localSnapshot) {
      return {
        corrected: false,
        reason: authority.tick < this.#state.tick - this.#config.maxRollbackTicks ? 'rollback-limit' : 'stale-authority',
        correctionMagnitude: 0,
        replayedInputs: 0,
        newState: this.state,
      };
    }
    const positionError = distance(localSnapshot.position, authority.position);
    const velocityError = distance(localSnapshot.velocity, authority.velocity);
    const healthError = Math.abs(localSnapshot.health - authority.health);
    if (positionError <= this.#config.positionToleranceMeters &&
        velocityError <= this.#config.velocityToleranceMetersPerSecond &&
        healthError <= Number.EPSILON) {
      return {
        corrected: false,
        reason: 'within-tolerance',
        correctionMagnitude: positionError,
        replayedInputs: 0,
        newState: this.state,
      };
    }

    const rollbackDistance = this.#state.tick - authority.tick;
    if (rollbackDistance > this.#config.maxRollbackTicks) {
      this.#state = { ...cloneAuthoritative(authority), lastInputSequence: this.#state.lastInputSequence };
      this.#inputs.splice(0, this.#inputs.findIndex((input) => input.tick > authority.tick) === -1 ? this.#inputs.length : this.#inputs.findIndex((input) => input.tick > authority.tick));
      this.#snapshots.clear();
      this.#snapshots.set(authority.tick, this.state);
      return {
        corrected: true,
        reason: 'rollback-limit',
        correctionMagnitude: positionError,
        replayedInputs: 0,
        newState: this.state,
      };
    }

    const reason = positionError > this.#config.positionToleranceMeters
      ? 'position-drift'
      : velocityError > this.#config.velocityToleranceMetersPerSecond
        ? 'velocity-drift'
        : 'health-drift';
    const inputsToReplay = this.#inputs.filter((input) => input.tick > authority.tick);
    let reconstructed: PredictedState = { ...cloneAuthoritative(authority), lastInputSequence: authority.tick >= 0 ? this.#findSequenceAtOrBefore(authority.tick) : -1 };
    this.#snapshots.clear();
    this.#snapshots.set(authority.tick, reconstructed);
    for (const input of inputsToReplay) {
      const next = this.#integrator.apply(reconstructed, input, deltaSeconds);
      reconstructed = {
        ...cloneAuthoritative(next),
        tick: input.tick,
        lastInputSequence: input.sequence,
      };
      this.#snapshots.set(input.tick, reconstructed);
    }
    this.#state = reconstructed;
    this.#trimSnapshots();
    return {
      corrected: true,
      reason,
      correctionMagnitude: positionError,
      replayedInputs: inputsToReplay.length,
      newState: this.state,
    };
  }

  public checksum(): string {
    return digestString(`${this.#entity}:${this.#state.tick}:${this.#state.lastInputSequence}:${JSON.stringify(quantizeVector(this.#state.position))}:${JSON.stringify(quantizeVector(this.#state.velocity))}:${this.#state.yaw.toFixed(5)}:${this.#state.health.toFixed(3)}`);
  }

  public reset(state: AuthoritativeState): void {
    this.#state = { ...cloneAuthoritative(state), lastInputSequence: -1 };
    this.#inputs.length = 0;
    this.#snapshots.clear();
    this.#snapshots.set(state.tick, this.state);
  }

  #findSequenceAtOrBefore(tick: number): number {
    let sequence = -1;
    for (const input of this.#inputs) {
      if (input.tick > tick) break;
      sequence = input.sequence;
    }
    return sequence;
  }

  #trimSnapshots(): void {
    const minimumTick = this.#state.tick - this.#config.maxRollbackTicks;
    for (const tick of this.#snapshots.keys()) if (tick < minimumTick) this.#snapshots.delete(tick);
  }
}

function cloneAuthoritative(state: AuthoritativeState): AuthoritativeState {
  return {
    tick: state.tick,
    position: { ...state.position },
    velocity: { ...state.velocity },
    yaw: state.yaw,
    health: state.health,
  };
}

export function createSimpleKinematicIntegrator(speed = 4): PredictionIntegrator {
  if (!Number.isFinite(speed) || speed < 0) throw new RangeError('speed must be non-negative');
  return {
    apply: (state, input, deltaSeconds) => {
      const magnitude = Math.hypot(input.moveX, input.moveZ);
      const scale = magnitude > 1 ? 1 / magnitude : 1;
      const vx = input.moveX * scale * speed;
      const vz = input.moveZ * scale * speed;
      return {
        tick: input.tick,
        position: {
          x: state.position.x + vx * deltaSeconds,
          y: state.position.y,
          z: state.position.z + vz * deltaSeconds,
        },
        velocity: { x: vx, y: state.velocity.y, z: vz },
        yaw: state.yaw + input.yawDelta,
        health: state.health,
      };
    },
  };
}

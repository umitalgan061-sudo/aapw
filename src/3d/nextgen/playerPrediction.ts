/** Deterministic client-side movement prediction with bounded reconciliation. */

import { clamp, DeterministicRng, length2, normalize2, scale2, vec2, type Vec2, type Vec3 } from './deterministicMath';

export interface PlayerInput {
  tick: number;
  sequence: number;
  move: Vec2;
  lookYaw: number;
  jump: boolean;
  sprint: boolean;
  dodge: boolean;
}

export interface PlayerState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  stamina: number;
  grounded: boolean;
  jumpTicks: number;
  lastProcessedInput: number;
}

export interface PredictionConfig {
  fixedDeltaSeconds: number;
  walkSpeed: number;
  sprintSpeed: number;
  acceleration: number;
  braking: number;
  gravity: number;
  jumpVelocity: number;
  maxStamina: number;
  staminaDrainPerSecond: number;
  staminaRegenPerSecond: number;
  dodgeSpeed: number;
  dodgeTicks: number;
  maxBufferedInputs: number;
  maxReconciliationError: number;
  correctionBlendTicks: number;
}

export interface PredictionSample { tick: number; state: PlayerState }
export interface ReconciliationResult { corrected: boolean; errorMeters: number; replayedInputs: number; state: PlayerState }

const DEFAULTS: PredictionConfig = {
  fixedDeltaSeconds: 1 / 60,
  walkSpeed: 4.2,
  sprintSpeed: 6.8,
  acceleration: 18,
  braking: 24,
  gravity: -24,
  jumpVelocity: 8.5,
  maxStamina: 100,
  staminaDrainPerSecond: 18,
  staminaRegenPerSecond: 11,
  dodgeSpeed: 10,
  dodgeTicks: 12,
  maxBufferedInputs: 96,
  maxReconciliationError: 1.25,
  correctionBlendTicks: 6,
};

function copyState(state: PlayerState): PlayerState {
  return {
    position: { ...state.position },
    velocity: { ...state.velocity },
    yaw: state.yaw,
    stamina: state.stamina,
    grounded: state.grounded,
    jumpTicks: state.jumpTicks,
    lastProcessedInput: state.lastProcessedInput,
  };
}

function approach(current: number, target: number, delta: number): number {
  if (current < target) return Math.min(target, current + delta);
  return Math.max(target, current - delta);
}

export function createDefaultPlayerState(): PlayerState {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    stamina: DEFAULTS.maxStamina,
    grounded: true,
    jumpTicks: 0,
    lastProcessedInput: 0,
  };
}

export class PlayerPredictor {
  readonly config: PredictionConfig;
  #state: PlayerState;
  #inputs: PlayerInput[] = [];
  #history: PredictionSample[] = [];
  #reconciliationVelocity = { x: 0, y: 0, z: 0 };

  constructor(initial?: Partial<PlayerState>, config?: Partial<PredictionConfig>) {
    this.config = { ...DEFAULTS, ...config };
    if (this.config.fixedDeltaSeconds <= 0) throw new RangeError('fixedDeltaSeconds must be > 0');
    this.#state = { ...createDefaultPlayerState(), ...initial, position: { ...createDefaultPlayerState().position, ...initial?.position }, velocity: { ...createDefaultPlayerState().velocity, ...initial?.velocity } };
    this.#history.push({ tick: 0, state: copyState(this.#state) });
  }

  get state(): PlayerState { return copyState(this.#state); }

  pushInput(input: PlayerInput): void {
    if (!Number.isInteger(input.tick) || input.tick < 0) throw new RangeError('invalid input tick');
    if (!Number.isInteger(input.sequence) || input.sequence <= 0) throw new RangeError('invalid input sequence');
    const move = normalize2(vec2(clamp(input.move.x, -1, 1), clamp(input.move.y, -1, 1)));
    const normalized: PlayerInput = { ...input, move };
    const existing = this.#inputs.find((candidate) => candidate.sequence === input.sequence);
    if (existing) return;
    this.#inputs.push(normalized);
    this.#inputs.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    while (this.#inputs.length > this.config.maxBufferedInputs) this.#inputs.shift();
  }

  predictThrough(targetTick: number): PlayerState {
    while (this.#history.at(-1)?.tick !== undefined && (this.#history.at(-1)?.tick ?? 0) < targetTick) {
      const nextTick = (this.#history.at(-1)?.tick ?? 0) + 1;
      const input = this.#inputs.find((candidate) => candidate.tick === nextTick);
      this.step(nextTick, input);
    }
    return this.state;
  }

  step(tick: number, input?: PlayerInput): PlayerState {
    const dt = this.config.fixedDeltaSeconds;
    const state = this.#state;
    const direction = input?.move ?? vec2();
    const local = normalize2(direction);
    const forward = { x: Math.sin(input?.lookYaw ?? state.yaw), z: Math.cos(input?.lookYaw ?? state.yaw) };
    const right = { x: Math.cos(input?.lookYaw ?? state.yaw), z: -Math.sin(input?.lookYaw ?? state.yaw) };
    const desiredX = (forward.x * local.y + right.x * local.x) * (input?.sprint && state.stamina > 0 ? this.config.sprintSpeed : this.config.walkSpeed);
    const desiredZ = (forward.z * local.y + right.z * local.x) * (input?.sprint && state.stamina > 0 ? this.config.sprintSpeed : this.config.walkSpeed);
    const accelerating = length2(local) > 0.01;
    const response = (accelerating ? this.config.acceleration : this.config.braking) * dt;
    state.velocity.x = approach(state.velocity.x, desiredX, response);
    state.velocity.z = approach(state.velocity.z, desiredZ, response);
    state.yaw = input?.lookYaw ?? state.yaw;

    if (input?.jump && state.grounded) {
      state.velocity.y = this.config.jumpVelocity;
      state.grounded = false;
      state.jumpTicks = 0;
    }
    if (input?.dodge && !state.grounded) {
      state.velocity.y = Math.max(state.velocity.y, 0);
    }
    if (!state.grounded) {
      state.velocity.y += this.config.gravity * dt;
      state.jumpTicks += 1;
    }
    state.position.x += state.velocity.x * dt;
    state.position.y += state.velocity.y * dt;
    state.position.z += state.velocity.z * dt;

    if (state.position.y <= 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.grounded = true;
      state.jumpTicks = 0;
    }

    const sprinting = Boolean(input?.sprint) && accelerating && state.stamina > 0;
    state.stamina = sprinting ? Math.max(0, state.stamina - this.config.staminaDrainPerSecond * dt) : Math.min(this.config.maxStamina, state.stamina + this.config.staminaRegenPerSecond * dt);
    state.lastProcessedInput = input?.sequence ?? state.lastProcessedInput;

    this.#history.push({ tick, state: copyState(state) });
    while (this.#history.length > this.config.maxBufferedInputs + 8) this.#history.shift();
    return this.state;
  }

  reconcile(authoritative: { tick: number; state: PlayerState }): ReconciliationResult {
    const predicted = this.#history.find((sample) => sample.tick === authoritative.tick)?.state;
    if (!predicted) {
      this.#state = copyState(authoritative.state);
      this.#history = [{ tick: authoritative.tick, state: copyState(this.#state) }];
      return { corrected: true, errorMeters: Infinity, replayedInputs: 0, state: this.state };
    }
    const errorX = authoritative.state.position.x - predicted.position.x;
    const errorY = authoritative.state.position.y - predicted.position.y;
    const errorZ = authoritative.state.position.z - predicted.position.z;
    const errorMeters = Math.hypot(errorX, errorY, errorZ);
    if (errorMeters <= 0.001) return { corrected: false, errorMeters, replayedInputs: 0, state: this.state };

    this.#state = copyState(authoritative.state);
    this.#history = this.#history.filter((sample) => sample.tick <= authoritative.tick);
    const pending = this.#inputs.filter((input) => input.tick > authoritative.tick);
    let replayedInputs = 0;
    for (const input of pending) {
      this.step(input.tick, input);
      replayedInputs += 1;
    }
    if (errorMeters > this.config.maxReconciliationError) {
      this.#state.position = { ...authoritative.state.position };
      this.#reconciliationVelocity = { x: 0, y: 0, z: 0 };
    }
    return { corrected: true, errorMeters, replayedInputs, state: this.state };
  }

  consumeAcknowledgedInputs(sequence: number): void {
    this.#inputs = this.#inputs.filter((input) => input.sequence > sequence);
  }

  clearHistory(): void {
    this.#history = [{ tick: 0, state: copyState(this.#state) }];
  }
}

export interface PredictionDigest { tick: number; inputCount: number; stateHash: number }
export function hashPlayerState(state: PlayerState): number {
  let hash = 2166136261 >>> 0;
  const values = [state.position.x, state.position.y, state.position.z, state.velocity.x, state.velocity.y, state.velocity.z, state.yaw, state.stamina, state.grounded ? 1 : 0, state.jumpTicks, state.lastProcessedInput];
  for (const value of values) { hash ^= Math.round(value * 1000) >>> 0; hash = Math.imul(hash, 16777619) >>> 0; }
  return hash >>> 0;
}

export class InputSequencer {
  #next = 1;
  next(tick: number, partial?: Partial<PlayerInput>): PlayerInput {
    return {
      tick,
      sequence: this.#next++,
      move: partial?.move ?? vec2(),
      lookYaw: partial?.lookYaw ?? 0,
      jump: partial?.jump ?? false,
      sprint: partial?.sprint ?? false,
      dodge: partial?.dodge ?? false,
    };
  }
}

export function buildPredictionScenario(seed = 1337, ticks = 120): PredictionDigest[] {
  const rng = new DeterministicRng(seed);
  const sequencer = new InputSequencer();
  const predictor = new PlayerPredictor();
  const digests: PredictionDigest[] = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    const input = sequencer.next(tick, {
      move: { x: rng.range(-1, 1), y: rng.range(-1, 1) },
      lookYaw: rng.range(-Math.PI, Math.PI),
      sprint: tick % 9 < 4,
      jump: tick % 47 === 0,
    });
    predictor.pushInput(input);
    predictor.step(tick, input);
    digests.push({ tick, inputCount: 1, stateHash: hashPlayerState(predictor.state) });
  }
  return digests;
}

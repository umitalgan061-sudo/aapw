import type { Result, Vec2 } from './contracts.ts';
import { fail, ok, stableHash } from './contracts.ts';

export interface InputCommandR25 {
  readonly sequence: number;
  readonly tick: number;
  readonly move: Vec2;
  readonly look: Vec2;
  readonly actions: readonly string[];
  readonly clientTimeMs: number;
}

export interface AuthoritativeStateR25<T = unknown> {
  readonly tick: number;
  readonly sequence: number;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly stateHash: string;
  readonly payload: T;
}

export interface PredictedStateR25<T = unknown> extends AuthoritativeStateR25<T> {
  readonly predictedFromSequence: number;
}

export interface ReconciliationResultR25<T = unknown> {
  readonly accepted: boolean;
  readonly corrected: boolean;
  readonly authoritativeTick: number;
  readonly lastConfirmedSequence: number;
  readonly replayedCommands: readonly InputCommandR25[];
  readonly state: PredictedStateR25<T>;
  readonly errorMeters: number;
  readonly reason: string;
}

export interface InterpolationSampleR25<T = unknown> {
  readonly state: AuthoritativeStateR25<T>;
  readonly receivedAtMs: number;
}

export interface InterpolatedStateR25<T = unknown> {
  readonly tick: number;
  readonly alpha: number;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly payload: T;
}

export interface NetworkPredictionOptionsR25 {
  readonly historySize?: number;
  readonly commandBufferSize?: number;
  readonly maxCorrectionMeters?: number;
  readonly interpolationDelayTicks?: number;
  readonly clock?: () => number;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function vectorLerp(a: Vec2, b: Vec2, alpha: number): Vec2 {
  const t = clamp(alpha, 0, 1);
  return freeze({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class ClientPredictionR25<TState = unknown> {
  readonly #historySize: number;
  readonly #commandBufferSize: number;
  readonly #maxCorrectionMeters: number;
  readonly #interpolationDelayTicks: number;
  readonly #clock: () => number;
  readonly #commands: InputCommandR25[] = [];
  readonly #predicted: PredictedStateR25<TState>[] = [];
  readonly #authoritative: AuthoritativeStateR25<TState>[] = [];
  readonly #remoteSamples: InterpolationSampleR25<TState>[] = [];

  #sequence = 0;
  #lastConfirmedSequence = 0;
  #disposed = false;

  public constructor(
    options: NetworkPredictionOptionsR25 = {},
  ) {
    this.#historySize = Math.max(16, Math.trunc(options.historySize ?? 256));
    this.#commandBufferSize = Math.max(16, Math.trunc(options.commandBufferSize ?? 256));
    this.#maxCorrectionMeters = Math.max(0.01, finite(options.maxCorrectionMeters, 2));
    this.#interpolationDelayTicks = Math.max(0, Math.trunc(options.interpolationDelayTicks ?? 2));
    this.#clock = options.clock ?? (() => globalThis.performance?.now?.() ?? Date.now());
  }

  public get lastConfirmedSequence(): number {
    return this.#lastConfirmedSequence;
  }

  public get pendingCommandCount(): number {
    return this.#commands.filter((command) => command.sequence > this.#lastConfirmedSequence).length;
  }

  public nextCommand(
    tick: number,
    input: Omit<InputCommandR25, 'sequence' | 'tick' | 'clientTimeMs'>,
  ): InputCommandR25 {
    this.#assertLive();
    const command = freeze({
      ...input,
      sequence: ++this.#sequence,
      tick: Math.max(0, Math.trunc(tick)),
      move: freeze({
        x: clamp(finite(input.move.x, 0), -1, 1),
        y: clamp(finite(input.move.y, 0), -1, 1),
      }),
      look: freeze({
        x: clamp(finite(input.look.x, 0), -8, 8),
        y: clamp(finite(input.look.y, 0), -8, 8),
      }),
      actions: freeze(
        [...new Set(input.actions.map((value) => value.trim()).filter(Boolean))].slice(0, 16),
      ),
      clientTimeMs: this.#clock(),
    });

    this.#commands.push(command);
    this.#trimCommands();
    return command;
  }

  public recordPrediction(
    state: PredictedStateR25<TState>,
  ): void {
    this.#assertLive();
    this.#predicted.push(freeze({
      ...state,
      position: freeze({ ...state.position }),
      velocity: freeze({ ...state.velocity }),
    }));
    this.#trimHistory(this.#predicted);
  }

  public acceptAuthoritative(
    state: AuthoritativeStateR25<TState>,
  ): ReconciliationResultR25<TState> {
    this.#assertLive();

    const normalized = freeze({
      ...state,
      tick: Math.max(0, Math.trunc(state.tick)),
      sequence: Math.max(0, Math.trunc(state.sequence)),
      position: freeze({
        x: finite(state.position.x, 0),
        y: finite(state.position.y, 0),
      }),
      velocity: freeze({
        x: finite(state.velocity.x, 0),
        y: finite(state.velocity.y, 0),
      }),
    });

    if (normalized.sequence < this.#lastConfirmedSequence) {
      const latest = this.latestPrediction() ?? this.#fromAuthoritative(normalized);
      return freeze({
        accepted: false,
        corrected: false,
        authoritativeTick: normalized.tick,
        lastConfirmedSequence: this.#lastConfirmedSequence,
        replayedCommands: freeze([]),
        state: latest,
        errorMeters: distance(latest.position, normalized.position),
        reason: 'stale-authoritative-sequence',
      });
    }

    this.#lastConfirmedSequence = normalized.sequence;
    this.#authoritative.push(normalized);
    this.#trimHistory(this.#authoritative);

    const prediction = this.#predictionAtOrBefore(normalized.sequence);
    const errorMeters = prediction
      ? distance(prediction.position, normalized.position)
      : 0;
    const corrected = errorMeters > this.#maxCorrectionMeters;

    const replay = this.#commands.filter(
      (command) => command.sequence > normalized.sequence,
    );

    const state = corrected
      ? this.#reconcileState(normalized, prediction, replay)
      : this.#fromAuthoritative(normalized);

    return freeze({
      accepted: true,
      corrected,
      authoritativeTick: normalized.tick,
      lastConfirmedSequence: this.#lastConfirmedSequence,
      replayedCommands: freeze(replay),
      state,
      errorMeters,
      reason: corrected ? 'position-correction-applied' : 'within-prediction-tolerance',
    });
  }

  public pushRemoteSample(
    state: AuthoritativeStateR25<TState>,
  ): void {
    this.#assertLive();
    this.#remoteSamples.push(freeze({
      state: freeze({
        ...state,
        position: freeze({ ...state.position }),
        velocity: freeze({ ...state.velocity }),
      }),
      receivedAtMs: this.#clock(),
    }));
    this.#remoteSamples.sort(
      (a, b) => a.state.tick - b.state.tick ||
        a.state.sequence - b.state.sequence,
    );
    this.#trimHistory(this.#remoteSamples);
  }

  public interpolateRemote(
    renderTick: number,
  ): InterpolatedStateR25<TState> | null {
    if (this.#remoteSamples.length === 0) return null;

    const target = Math.max(
      0,
      Math.trunc(renderTick) - this.#interpolationDelayTicks,
    );

    let previous: InterpolationSampleR25<TState> | undefined;
    let next: InterpolationSampleR25<TState> | undefined;

    for (const sample of this.#remoteSamples) {
      if (sample.state.tick <= target) previous = sample;
      if (sample.state.tick >= target) {
        next = sample;
        break;
      }
    }

    previous ??= this.#remoteSamples[0];
    next ??= this.#remoteSamples[this.#remoteSamples.length - 1];

    if (!previous || !next) return null;

    const span = Math.max(1, next.state.tick - previous.state.tick);
    const alpha = clamp(
      (target - previous.state.tick) / span,
      0,
      1,
    );

    return freeze({
      tick: target,
      alpha,
      position: vectorLerp(previous.state.position, next.state.position, alpha),
      velocity: vectorLerp(previous.state.velocity, next.state.velocity, alpha),
      payload: alpha < 0.5 ? previous.state.payload : next.state.payload,
    });
  }

  public latestPrediction(): PredictedStateR25<TState> | null {
    return this.#predicted[this.#predicted.length - 1] ?? null;
  }

  public pendingCommands(): readonly InputCommandR25[] {
    return freeze(
      this.#commands
        .filter((command) => command.sequence > this.#lastConfirmedSequence)
        .map((command) => freeze({ ...command })),
    );
  }

  public historyDigest(): string {
    return stableHash({
      confirmed: this.#lastConfirmedSequence,
      commands: this.#commands,
      predicted: this.#predicted.map((state) => ({
        tick: state.tick,
        sequence: state.sequence,
        position: state.position,
        velocity: state.velocity,
        hash: state.stateHash,
      })),
      authoritative: this.#authoritative.map((state) => ({
        tick: state.tick,
        sequence: state.sequence,
        hash: state.stateHash,
      })),
    });
  }

  public snapshot(): Readonly<{
    sequence: number;
    lastConfirmedSequence: number;
    pendingCommands: number;
    predictionHistory: number;
    authoritativeHistory: number;
    remoteSamples: number;
  }> {
    return freeze({
      sequence: this.#sequence,
      lastConfirmedSequence: this.#lastConfirmedSequence,
      pendingCommands: this.pendingCommandCount,
      predictionHistory: this.#predicted.length,
      authoritativeHistory: this.#authoritative.length,
      remoteSamples: this.#remoteSamples.length,
    });
  }

  public reset(): void {
    this.#commands.length = 0;
    this.#predicted.length = 0;
    this.#authoritative.length = 0;
    this.#remoteSamples.length = 0;
    this.#sequence = 0;
    this.#lastConfirmedSequence = 0;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.reset();
  }

  #predictionAtOrBefore(sequence: number): PredictedStateR25<TState> | null {
    return [...this.#predicted]
      .reverse()
      .find((state) => state.sequence <= sequence) ?? null;
  }

  #fromAuthoritative(
    authoritative: AuthoritativeStateR25<TState>,
  ): PredictedStateR25<TState> {
    return freeze({
      ...authoritative,
      predictedFromSequence: authoritative.sequence,
    });
  }

  #reconcileState(
    authoritative: AuthoritativeStateR25<TState>,
    prediction: PredictedStateR25<TState> | null,
    commands: readonly InputCommandR25[],
  ): PredictedStateR25<TState> {
    const displacement = prediction
      ? vectorLerp(authoritative.position, prediction.position, 0.35)
      : authoritative.position;

    const commandHash = stableHash(commands.map((command) => ({
      sequence: command.sequence,
      tick: command.tick,
      move: command.move,
      actions: command.actions,
    })));

    return freeze({
      ...authoritative,
      position: displacement,
      stateHash: stableHash({
        authoritative: authoritative.stateHash,
        commandHash,
        position: displacement,
      }),
      predictedFromSequence: commands.at(-1)?.sequence ?? authoritative.sequence,
    });
  }

  #trimCommands(): void {
    if (this.#commands.length > this.#commandBufferSize) {
      this.#commands.splice(0, this.#commands.length - this.#commandBufferSize);
    }
  }

  #trimHistory<T>(list: T[]): void {
    if (list.length > this.#historySize) {
      list.splice(0, list.length - this.#historySize);
    }
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_NETWORK_PREDICTION_DISPOSED');
  }
}

export function createInputCommandR25(
  sequence: number,
  tick: number,
  move: Vec2,
  actions: readonly string[] = [],
): InputCommandR25 {
  return freeze({
    sequence: Math.max(0, Math.trunc(sequence)),
    tick: Math.max(0, Math.trunc(tick)),
    move: freeze({
      x: clamp(finite(move.x, 0), -1, 1),
      y: clamp(finite(move.y, 0), -1, 1),
    }),
    look: freeze({ x: 0, y: 0 }),
    actions: freeze([...new Set(actions.map((value) => value.trim()).filter(Boolean))]),
    clientTimeMs: 0,
  });
}

export function validateAuthoritativeStateR25(
  value: unknown,
): Result<AuthoritativeStateR25, string> {
  if (!value || typeof value !== 'object') {
    return fail('R25_NETWORK_STATE_TYPE');
  }

  const state = value as Record<string, unknown>;
  if (!Number.isInteger(state.tick) || Number(state.tick) < 0) {
    return fail('R25_NETWORK_TICK');
  }
  if (!Number.isInteger(state.sequence) || Number(state.sequence) < 0) {
    return fail('R25_NETWORK_SEQUENCE');
  }
  if (!state.position || typeof state.position !== 'object') {
    return fail('R25_NETWORK_POSITION');
  }
  if (!state.velocity || typeof state.velocity !== 'object') {
    return fail('R25_NETWORK_VELOCITY');
  }

  const position = state.position as Record<string, unknown>;
  const velocity = state.velocity as Record<string, unknown>;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return fail('R25_NETWORK_POSITION_NUMBER');
  }
  if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
    return fail('R25_NETWORK_VELOCITY_NUMBER');
  }
  if (typeof state.stateHash !== 'string' || state.stateHash.length < 4) {
    return fail('R25_NETWORK_HASH');
  }

  return ok(freeze({
    tick: Number(state.tick),
    sequence: Number(state.sequence),
    position: freeze({ x: Number(position.x), y: Number(position.y) }),
    velocity: freeze({ x: Number(velocity.x), y: Number(velocity.y) }),
    stateHash: String(state.stateHash),
    payload: state.payload,
  }));
}

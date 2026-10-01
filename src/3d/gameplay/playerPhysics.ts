/** Production TypeScript owner for the player jump arc; legacy world physics remains the ground/collider owner. */

export interface PlayerJumpArcOptions {
  /** Maximum simulation step used to keep large frame gaps from tunnelling through the ground. */
  readonly maxStepSeconds?: number;
  /** Hard downward-speed cap used as a fail-closed guard against unstable input/configuration. */
  readonly maxFallSpeedMps?: number;
}

export interface PlayerJumpArcSnapshot {
  readonly heightAboveGroundMeters: number;
  readonly velocityYMps: number;
  readonly isGrounded: boolean;
  readonly simulationSteps: number;
}

const DEFAULT_JUMP_ARC_OPTIONS = Object.freeze({
  maxStepSeconds: 1 / 60,
  maxFallSpeedMps: 60,
}) satisfies Required<PlayerJumpArcOptions>;

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const normalizeStep = (value: number, fallback: number): number =>
  Math.max(1 / 240, Math.min(0.1, finite(value, fallback)));

const normalizeFallSpeed = (value: number, fallback: number): number =>
  Math.max(1, Math.min(200, finite(value, fallback)));

/**
 * Pure ballistic step for the playable character.
 *
 * The caller remains responsible for sampling the authoritative ground/collider.
 * Integration is internally sub-stepped so a long browser frame cannot jump through
 * the ground plane or create unbounded vertical velocity.
 */
export function integratePlayerJumpArc(
  heightAboveGroundMeters: number,
  velocityYMps: number,
  delta: number,
  gravityMps2: number,
  options: PlayerJumpArcOptions = DEFAULT_JUMP_ARC_OPTIONS,
): PlayerJumpArcSnapshot {
  let height = Math.max(0, finite(heightAboveGroundMeters, 0));
  let velocity = finite(velocityYMps, 0);
  const safeDelta = Math.max(0, finite(delta, 0));
  const gravity = finite(gravityMps2, -20);
  const maxStep = normalizeStep(options.maxStepSeconds ?? DEFAULT_JUMP_ARC_OPTIONS.maxStepSeconds, DEFAULT_JUMP_ARC_OPTIONS.maxStepSeconds);
  const maxFallSpeed = normalizeFallSpeed(options.maxFallSpeedMps ?? DEFAULT_JUMP_ARC_OPTIONS.maxFallSpeedMps, DEFAULT_JUMP_ARC_OPTIONS.maxFallSpeedMps);

  if (height <= 0 && velocity <= 0) {
    return { heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true, simulationSteps: 0 };
  }

  let remaining = safeDelta;
  let steps = 0;
  while (remaining > 0) {
    const step = Math.min(remaining, maxStep);
    velocity = Math.max(-maxFallSpeed, velocity + gravity * step);
    height += velocity * step;
    remaining -= step;
    steps += 1;

    if (height <= 0) {
      return { heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true, simulationSteps: steps };
    }
  }

  return {
    heightAboveGroundMeters: height,
    velocityYMps: velocity,
    isGrounded: false,
    simulationSteps: steps,
  };
}

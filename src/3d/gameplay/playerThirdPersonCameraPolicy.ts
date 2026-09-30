/** Production TypeScript owner for the third-person camera framing policy.
 * Scene mutation, collision sweeps and renderer ownership stay with callers.
 */

export const PLAYER_THIRD_PERSON_CAMERA_VERSION = '2026-09-30-v2' as const;

export type PlayerCameraLocomotion = 'idle' | 'move' | 'sprint';

export interface PlayerThirdPersonCameraInput {
  readonly distance?: unknown;
  readonly shoulderOffset?: unknown;
  readonly heightOffset?: unknown;
  readonly pitchRadians?: unknown;
  readonly yawRadians?: unknown;
  readonly targetY?: unknown;
  readonly movementSpeed?: unknown;
  readonly combatActive?: unknown;
  readonly lockOn?: unknown;
}

export interface PlayerThirdPersonCameraPolicy {
  readonly version: typeof PLAYER_THIRD_PERSON_CAMERA_VERSION;
  readonly distance: number;
  readonly heightOffset: number;
  readonly shoulderOffset: number;
  readonly pitchRadians: number;
  readonly yawRadians: number;
  readonly targetY: number;
  readonly locomotion: PlayerCameraLocomotion;
  readonly combatActive: boolean;
  readonly lockOn: boolean;
  readonly collisionRadius: number;
}

export interface PlayerCameraWorldPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlayerThirdPersonCameraPositionInput {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly z?: unknown;
}

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value: unknown, min: number, max: number): number =>
  Math.max(min, Math.min(max, finite(value, min)));

const wrapRadians = (value: unknown): number => {
  const raw = finite(value, 0);
  const wrapped = ((raw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Number(wrapped.toFixed(4));
};

const round4 = (value: number): number => Number(value.toFixed(4));

export function resolvePlayerThirdPersonCameraPolicy(
  input: PlayerThirdPersonCameraInput = {},
): PlayerThirdPersonCameraPolicy {
  const distance = clamp(input.distance, 2.5, 12);
  const shoulder = clamp(input.shoulderOffset, -1.5, 1.5);
  const height = clamp(input.heightOffset, 0.8, 4.5);
  const pitch = clamp(input.pitchRadians, -1.15, 0.6);
  const yaw = wrapRadians(input.yawRadians);
  const targetY = finite(input.targetY, 1.2);
  const movementSpeed = Math.max(0, finite(input.movementSpeed, 0));
  const combatActive = Boolean(input.combatActive);
  const lockOn = Boolean(input.lockOn);

  const locomotion: PlayerCameraLocomotion =
    movementSpeed > 5.5 ? 'sprint' : movementSpeed > 0.25 ? 'move' : 'idle';

  const combatZoom = combatActive || lockOn ? -0.55 : 0;
  const locomotionZoom = locomotion === 'sprint' ? 0.35 : locomotion === 'move' ? 0.12 : 0;
  const resolvedDistance = clamp(distance + combatZoom + locomotionZoom, 2.5, 12);
  const resolvedHeight = clamp(height + (locomotion === 'sprint' ? 0.08 : 0), 0.8, 4.5);
  const resolvedShoulder = lockOn ? shoulder * 0.55 : shoulder;

  return Object.freeze({
    version: PLAYER_THIRD_PERSON_CAMERA_VERSION,
    distance: round4(resolvedDistance),
    heightOffset: round4(resolvedHeight),
    shoulderOffset: round4(resolvedShoulder),
    pitchRadians: round4(pitch),
    yawRadians: yaw,
    targetY: round4(targetY),
    locomotion,
    combatActive,
    lockOn,
    collisionRadius: round4(clamp(0.22 + (resolvedDistance < 4 ? 0.04 : 0), 0.22, 0.26)),
  });
}

export function resolvePlayerThirdPersonCameraPosition(
  policy: PlayerThirdPersonCameraPolicy | null | undefined,
  player: PlayerThirdPersonCameraPositionInput = {},
): PlayerCameraWorldPosition {
  const snapshot = policy ?? resolvePlayerThirdPersonCameraPolicy();
  const x = finite(player.x, 0);
  const y = finite(player.y, 0);
  const z = finite(player.z, 0);
  const sinYaw = Math.sin(snapshot.yawRadians);
  const cosYaw = Math.cos(snapshot.yawRadians);

  return Object.freeze({
    x: round4(x - sinYaw * snapshot.distance + cosYaw * snapshot.shoulderOffset),
    y: round4(y + snapshot.targetY + snapshot.heightOffset),
    z: round4(z - cosYaw * snapshot.distance - sinYaw * snapshot.shoulderOffset),
  });
}

export function resolvePlayerThirdPersonCameraFrame(
  input: PlayerThirdPersonCameraInput = {},
  player: PlayerThirdPersonCameraPositionInput = {},
) {
  const policy = resolvePlayerThirdPersonCameraPolicy(input);
  const position = resolvePlayerThirdPersonCameraPosition(policy, player);

  return Object.freeze({
    version: PLAYER_THIRD_PERSON_CAMERA_VERSION,
    policy,
    position,
    lookAt: Object.freeze({
      x: finite(player.x, 0),
      y: round4(finite(player.y, 0) + policy.targetY),
      z: finite(player.z, 0),
    }),
  });
}


export interface PlayerThirdPersonCameraCollisionInput {
  readonly requestedDistance?: unknown;
  readonly hitDistance?: unknown;
  readonly collisionMargin?: unknown;
  readonly minimumDistance?: unknown;
}

export interface PlayerThirdPersonCameraCollisionResult {
  readonly requestedDistance: number;
  readonly resolvedDistance: number;
  readonly collided: boolean;
  readonly hitDistance: number | null;
  readonly collisionMargin: number;
  readonly minimumDistance: number;
}

export function resolvePlayerThirdPersonCameraCollision(
  input: PlayerThirdPersonCameraCollisionInput = {},
): PlayerThirdPersonCameraCollisionResult {
  const requestedDistance = clamp(input.requestedDistance, 2.5, 12);
  const minimumDistance = clamp(input.minimumDistance, 1.5, requestedDistance);
  const rawHitDistance = finite(input.hitDistance, Number.POSITIVE_INFINITY);
  const collisionMargin = clamp(input.collisionMargin, 0.05, 0.75);
  const collided = Number.isFinite(rawHitDistance) && rawHitDistance < requestedDistance;
  const resolvedDistance = collided
    ? clamp(rawHitDistance - collisionMargin, minimumDistance, requestedDistance)
    : requestedDistance;
  return Object.freeze({
    requestedDistance: round4(requestedDistance),
    resolvedDistance: round4(resolvedDistance),
    collided,
    hitDistance: Number.isFinite(rawHitDistance) ? round4(Math.max(0, rawHitDistance)) : null,
    collisionMargin: round4(collisionMargin),
    minimumDistance: round4(minimumDistance),
  });
}

/**
 * Deterministic third-person camera projection for the existing player/camera caller.
 * Side-effect free: the caller owns the actual Three.js camera and scene mutation.
 * @module gameplay/playerThirdPersonCameraDirector
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 4) => Number(finite(value).toFixed(digits));

function normalizeVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  const x = finite(vector?.x, fallback.x);
  const y = finite(vector?.y, fallback.y);
  const z = finite(vector?.z, fallback.z);
  const length = Math.hypot(x, y, z);
  return length > 1e-6 ? { x: x / length, y: y / length, z: z / length } : { ...fallback };
}

function normalizeAngle(angle) {
  const value = finite(angle, 0);
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function projectThirdPersonCamera(input = {}) {
  const mode = ['follow', 'combat', 'aim', 'locked'].includes(input.mode) ? input.mode : 'follow';
  const target = {
    x: finite(input.target?.x),
    y: finite(input.target?.y, 1.6),
    z: finite(input.target?.z),
  };
  const facing = normalizeVector(input.facing, { x: 0, y: 0, z: 1 });
  const velocity = normalizeVector(input.velocity, { x: 0, y: 0, z: 0 });
  const speed = clamp(Math.abs(finite(input.speed)), 0, 40);
  const lockOn = Boolean(input.lockOn && input.lockOn.valid !== false);
  const distance = clamp(finite(input.distance, mode === 'aim' ? 2.4 : 4.2), 1.6, 7.5);
  const height = clamp(finite(input.height, mode === 'combat' || mode === 'locked' ? 2.0 : 2.25), 1.1, 4.5);
  const shoulder = clamp(finite(input.shoulder, 0.45), -1.2, 1.2);
  const pitch = clamp(finite(input.pitch, mode === 'aim' ? -0.08 : -0.18), -0.9, 0.45);
  const yaw = normalizeAngle(finite(input.yaw, Math.atan2(facing.x, facing.z)));
  const collisionDistance = clamp(finite(input.collisionDistance, distance), 0.5, distance);
  const speedLag = clamp(speed / 8, 0, 1);
  const lookAhead = {
    x: target.x + velocity.x * (0.08 + speedLag * 0.14),
    y: target.y + clamp(finite(input.lookAtOffsetY, 0.15), -0.5, 1.2),
    z: target.z + velocity.z * (0.08 + speedLag * 0.14),
  };
  const orbit = {
    x: lookAhead.x - Math.sin(yaw) * collisionDistance + Math.cos(yaw) * shoulder,
    y: lookAhead.y + height + Math.sin(pitch) * collisionDistance,
    z: lookAhead.z - Math.cos(yaw) * collisionDistance - Math.sin(yaw) * shoulder,
  };
  const smoothing = clamp(finite(input.smoothing, mode === 'aim' ? 0.22 : 0.14), 0.04, 0.8);
  const fov = clamp(finite(input.fov, mode === 'aim' ? 48 : 58), 35, 78);
  const result = {
    mode,
    target: { x: round(target.x), y: round(target.y), z: round(target.z) },
    lookAt: { x: round(lookAhead.x), y: round(lookAhead.y), z: round(lookAhead.z) },
    camera: { x: round(orbit.x), y: round(orbit.y), z: round(orbit.z) },
    yaw: round(yaw),
    pitch: round(pitch),
    distance: round(collisionDistance),
    targetDistance: round(distance),
    height: round(height),
    shoulder: round(shoulder),
    smoothing: round(smoothing),
    fov: round(fov, 2),
    lockOn,
    collisionClamped: collisionDistance < distance - 1e-4,
    followLeadMeters: round(Math.hypot(lookAhead.x - target.x, lookAhead.z - target.z)),
    facing: { x: round(facing.x), y: round(facing.y), z: round(facing.z) },
    velocityDirection: { x: round(velocity.x), y: round(velocity.y), z: round(velocity.z) },
    finite: true,
  };
  return deepFreeze(result);
}

export function serializeThirdPersonCamera(plan) {
  return JSON.stringify(plan && typeof plan === 'object' ? plan : projectThirdPersonCamera());
}

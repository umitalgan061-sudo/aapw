/**
 * Deterministic ranged/archery aim projection for the existing player runtime.
 * The caller remains authoritative for input, camera, animation, projectile and scene mutation.
 */

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const normalizeVector = (vector = {}) => {
  const x = finite(vector.x);
  const y = finite(vector.y);
  const z = finite(vector.z);
  const length = Math.hypot(x, y, z);
  if (length <= 1e-6) return { x: 0, y: 0, z: -1 };
  return { x: x / length, y: y / length, z: z / length };
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

export const PLAYER_RANGED_AIM_PHASES = Object.freeze({
  idle: 'idle',
  draw: 'draw',
  aim: 'aim',
  release: 'release',
  recover: 'recover',
});

export function createPlayerRangedAimDirector({
  action = 'idle',
  progress = 0,
  charge = 0,
  stamina = 1,
  hasAmmo = true,
  isGrounded = true,
  isStunned = false,
  cameraForward = { x: 0, y: 0, z: -1 },
  targetPoint = null,
  maxRange = 60,
  aimAssist = 0,
} = {}) {
  const normalizedAction = ['draw', 'aim', 'release'].includes(action) ? action : 'idle';
  const boundedProgress = clamp(progress, 0, 1, 0);
  const boundedCharge = clamp(charge, 0, 1, 0);
  const boundedStamina = clamp(stamina, 0, 1, 0);
  const grounded = Boolean(isGrounded);
  const stunned = Boolean(isStunned);
  const ammo = Boolean(hasAmmo);
  const canAct = grounded && !stunned && ammo && boundedStamina > 0.05;
  const phase = !canAct
    ? PLAYER_RANGED_AIM_PHASES.idle
    : normalizedAction === 'draw'
      ? PLAYER_RANGED_AIM_PHASES.draw
      : normalizedAction === 'release'
        ? PLAYER_RANGED_AIM_PHASES.release
        : normalizedAction === 'aim'
          ? PLAYER_RANGED_AIM_PHASES.aim
          : PLAYER_RANGED_AIM_PHASES.idle;

  const forward = normalizeVector(cameraForward);
  const target = targetPoint && typeof targetPoint === 'object'
    ? { x: finite(targetPoint.x), y: finite(targetPoint.y), z: finite(targetPoint.z) }
    : null;
  const assist = clamp(aimAssist, 0, 1, 0);
  const releaseReady = phase === PLAYER_RANGED_AIM_PHASES.release && boundedCharge >= 0.2;
  const staminaCost = clamp((phase === PLAYER_RANGED_AIM_PHASES.release ? 0.08 : 0.015) + boundedCharge * 0.08, 0, 0.2, 0);
  const range = clamp(maxRange, 1, 200, 60);

  return deepFreeze({
    phase,
    canAct,
    releaseReady,
    buffered: canAct && phase === PLAYER_RANGED_AIM_PHASES.draw && boundedProgress >= 0.7,
    charge: boundedCharge,
    progress: boundedProgress,
    staminaCost,
    direction: forward,
    target,
    maxRange: range,
    aimAssist: assist,
    targetLockRequested: Boolean(target && assist > 0),
    failClosedReason: !grounded ? 'airborne' : stunned ? 'stunned' : !ammo ? 'no-ammo' : boundedStamina <= 0.05 ? 'low-stamina' : null,
  });
}

export function serializePlayerRangedAimDirector(value) {
  return JSON.stringify(value);
}

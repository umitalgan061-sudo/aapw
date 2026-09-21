/**
 * Deterministic third-person camera framing policy for the existing player controller.
 * Pure math only: camera ownership, collision sweep and scene mutation stay with callers.
 * @module gameplay/playerThirdPersonCameraPolicy
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function resolvePlayerThirdPersonCameraPolicy(input = {}) {
  const distance = clamp(finite(input.distance, 5.8), 2.5, 12);
  const shoulder = clamp(finite(input.shoulderOffset, 0.85), -1.5, 1.5);
  const height = clamp(finite(input.heightOffset, 2.2), 0.8, 4.5);
  const pitch = clamp(finite(input.pitchRadians, -0.22), -1.15, 0.6);
  const yaw = finite(input.yawRadians, 0);
  const targetY = finite(input.targetY, 1.2);
  const movementSpeed = Math.max(0, finite(input.movementSpeed, 0));
  const combatActive = Boolean(input.combatActive);
  const lockOn = Boolean(input.lockOn);
  const locomotion = movementSpeed > 5.5 ? 'sprint' : movementSpeed > 0.25 ? 'move' : 'idle';

  const combatZoom = combatActive || lockOn ? -0.55 : 0;
  const locomotionZoom = locomotion === 'sprint' ? 0.35 : locomotion === 'move' ? 0.12 : 0;
  const resolvedDistance = clamp(distance + combatZoom + locomotionZoom, 2.5, 12);
  const resolvedHeight = clamp(height + (locomotion === 'sprint' ? 0.08 : 0), 0.8, 4.5);
  const resolvedShoulder = lockOn ? shoulder * 0.55 : shoulder;

  return Object.freeze({
    distance: Number(resolvedDistance.toFixed(4)),
    heightOffset: Number(resolvedHeight.toFixed(4)),
    shoulderOffset: Number(resolvedShoulder.toFixed(4)),
    pitchRadians: Number(pitch.toFixed(4)),
    yawRadians: Number(yaw.toFixed(4)),
    targetY: Number(targetY.toFixed(4)),
    locomotion,
    combatActive,
    lockOn,
    collisionRadius: Number(clamp(0.22 + (resolvedDistance < 4 ? 0.04 : 0), 0.22, 0.26).toFixed(4)),
  });
}

export function resolvePlayerThirdPersonCameraPosition(policy, player = {}) {
  const snapshot = policy && typeof policy === 'object' ? policy : resolvePlayerThirdPersonCameraPolicy();
  const x = finite(player.x, 0);
  const y = finite(player.y, 0);
  const z = finite(player.z, 0);
  const sinYaw = Math.sin(snapshot.yawRadians);
  const cosYaw = Math.cos(snapshot.yawRadians);
  return Object.freeze({
    x: Number((x - sinYaw * snapshot.distance + cosYaw * snapshot.shoulderOffset).toFixed(4)),
    y: Number((y + snapshot.targetY + snapshot.heightOffset).toFixed(4)),
    z: Number((z - cosYaw * snapshot.distance - sinYaw * snapshot.shoulderOffset).toFixed(4)),
  });
}

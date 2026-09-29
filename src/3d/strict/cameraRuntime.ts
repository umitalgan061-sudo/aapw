import type { CameraIntent, CameraLimits, CameraMode, CameraState, CameraTarget, EntityId, Result, Vec3 } from './liveCoreTypes.ts';
import { clamp, clamp01, err, lerp3, lerpNumber, ok, smoothDampAlpha, vec3 } from './liveCoreTypes.ts';

export interface CameraCollisionCandidate { readonly id: EntityId; readonly center: Vec3; readonly radius: number; readonly height?: number; readonly enabled?: boolean; }
export interface CameraRuntimePolicy { readonly responseHz: number; readonly positionResponseHz: number; readonly targetResponseHz: number; readonly maxVelocity: number; readonly collisionMargin: number; readonly minimumLineDistance: number; readonly shoulderOffset: number; readonly combatFov: number; readonly exploreFov: number; readonly lockOnFov: number; readonly dodgeDistance: number; readonly staggerDistance: number; }
export const DEFAULT_CAMERA_POLICY: CameraRuntimePolicy = Object.freeze({ responseHz: 8, positionResponseHz: 12, targetResponseHz: 14, maxVelocity: 40, collisionMargin: 0.18, minimumLineDistance: 1.15, shoulderOffset: 0.45, combatFov: 58, exploreFov: 65, lockOnFov: 56, dodgeDistance: 5.8, staggerDistance: 3.6 });
export const DEFAULT_CAMERA_LIMITS: CameraLimits = Object.freeze({ minDistance: 2.8, maxDistance: 22, minPolar: 0.2, maxPolar: Math.PI / 2 - 0.06, minFov: 45, maxFov: 78 });

const MODES: readonly CameraMode[] = ['explore', 'combat', 'lock-on', 'dodge', 'stagger', 'cinematic'];
const safeMode = (mode: CameraMode): CameraMode => MODES.includes(mode) ? mode : 'explore';
const modeDistance = (mode: CameraMode, limits: CameraLimits, policy: CameraRuntimePolicy): number => mode === 'combat' ? clamp(6.2, limits.minDistance, limits.maxDistance) : mode === 'lock-on' ? clamp(7.2, limits.minDistance, limits.maxDistance) : mode === 'dodge' ? clamp(policy.dodgeDistance, limits.minDistance, limits.maxDistance) : mode === 'stagger' ? clamp(policy.staggerDistance, limits.minDistance, limits.maxDistance) : mode === 'cinematic' ? clamp(10, limits.minDistance, limits.maxDistance) : clamp(9, limits.minDistance, limits.maxDistance);
const modeFov = (mode: CameraMode, policy: CameraRuntimePolicy, limits: CameraLimits): number => clamp(mode === 'combat' ? policy.combatFov : mode === 'lock-on' ? policy.lockOnFov : mode === 'dodge' ? policy.exploreFov + 4 : mode === 'stagger' ? policy.combatFov + 3 : policy.exploreFov, limits.minFov, limits.maxFov);

export const buildCameraIntent = (mode: CameraMode, target: CameraTarget, limits: CameraLimits = DEFAULT_CAMERA_LIMITS, policy: CameraRuntimePolicy = DEFAULT_CAMERA_POLICY, lockOnEntity?: EntityId): CameraIntent => {
  const safe = safeMode(mode);
  return Object.freeze({ mode: safe, distance: modeDistance(safe, limits, policy), height: safe === 'combat' || safe === 'lock-on' ? 2.2 : 2.8, shoulder: safe === 'lock-on' ? 1 : target.yaw >= 0 ? 1 : -1, fov: modeFov(safe, policy, limits), sensitivity: safe === 'combat' || safe === 'lock-on' ? 0.7 : 1, recenter: safe === 'lock-on' || safe === 'stagger', ...(lockOnEntity ? { lockOnEntity } : {}), cameraCut: safe === 'dodge' || safe === 'cinematic' });
};

const lerpAngle = (a: number, b: number, alpha: number): number => { const delta = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; return a + delta * clamp01(alpha); };
const orbitOffset = (distance: number, yaw: number, pitch: number, height: number, shoulder: -1 | 1, shoulderOffset: number): Vec3 => { const cp = Math.cos(pitch), sp = Math.sin(pitch), horizontal = distance * cp; return vec3(-Math.sin(yaw) * horizontal + shoulder * shoulderOffset, height + distance * sp, -Math.cos(yaw) * horizontal); };

export const resolveCameraCollisionPosition = (desired: Vec3, target: Vec3, candidates: readonly CameraCollisionCandidate[], margin = DEFAULT_CAMERA_POLICY.collisionMargin, minimumLineDistance = DEFAULT_CAMERA_POLICY.minimumLineDistance): Vec3 => {
  const rayX = desired.x - target.x, rayY = desired.y - target.y, rayZ = desired.z - target.z;
  const distance = Math.hypot(rayX, rayY, rayZ); if (distance <= 1e-9 || candidates.length === 0) return desired;
  const inv = 1 / distance; const dirX = rayX * inv, dirY = rayY * inv, dirZ = rayZ * inv; let resolvedDistance = distance;
  for (const candidate of candidates) {
    if (candidate.enabled === false) continue;
    const radius = Math.max(0, candidate.radius); const relX = candidate.center.x - target.x; const relY = candidate.center.y - target.y; const relZ = candidate.center.z - target.z; const projection = relX * dirX + relY * dirY + relZ * dirZ;
    if (projection <= 0 || projection >= resolvedDistance) continue;
    const closestX = target.x + dirX * projection, closestY = target.y + dirY * projection, closestZ = target.z + dirZ * projection;
    const clearance = Math.hypot(candidate.center.x - closestX, candidate.center.y - closestY, candidate.center.z - closestZ);
    const verticalRadius = candidate.height === undefined ? radius : Math.max(radius, candidate.height * 0.5);
    if (clearance > verticalRadius) continue;
    resolvedDistance = Math.min(resolvedDistance, Math.max(minimumLineDistance, projection - margin - radius));
  }
  if (resolvedDistance >= distance - 1e-6) return desired;
  return vec3(target.x + dirX * resolvedDistance, target.y + dirY * resolvedDistance, target.z + dirZ * resolvedDistance);
};

export class StrictCameraRuntime {
  #state: CameraState;
  #yaw = 0;
  #pitch = 0.45;
  #limits: CameraLimits;
  #policy: CameraRuntimePolicy;
  #disposed = false;
  constructor(target: CameraTarget, limits: CameraLimits = DEFAULT_CAMERA_LIMITS, policy: CameraRuntimePolicy = DEFAULT_CAMERA_POLICY, initialMode: CameraMode = 'explore') { this.#limits = limits; this.#policy = policy; const intent = buildCameraIntent(initialMode, target, limits, policy); const offset = orbitOffset(intent.distance, target.yaw, this.#pitch, intent.height, intent.shoulder, policy.shoulderOffset); this.#yaw = target.yaw; this.#state = Object.freeze({ ...intent, position: vec3(target.lookAt.x + offset.x, target.lookAt.y + offset.y, target.lookAt.z + offset.z), lookAt: target.lookAt, velocity: vec3() }); }
  #alive(): Result<never> | null { return this.#disposed ? err('RUNTIME_DISPOSED', 'Camera runtime is already disposed.') : null; }
  setOrbit(yaw: number, pitch: number): Result<void> { const failure = this.#alive(); if (failure) return failure; this.#yaw = finiteAngle(yaw); this.#pitch = clamp(pitch, this.#limits.minPolar, this.#limits.maxPolar); return ok(undefined); }
  setMode(mode: CameraMode, target: CameraTarget, lockOnEntity?: EntityId): Result<CameraIntent> { const failure = this.#alive(); if (failure) return failure; const next = buildCameraIntent(mode, target, this.#limits, this.#policy, lockOnEntity); this.#state = Object.freeze({ ...this.#state, ...next }); return ok(next); }
  update(deltaSeconds: number, target: CameraTarget, candidates: readonly CameraCollisionCandidate[] = []): Result<CameraState> {
    const failure = this.#alive(); if (failure) return failure; const dt = clamp(deltaSeconds, 0, 0.1); const current = this.#state; const safeTarget: CameraTarget = Object.freeze({ position: vec3(target.position.x, target.position.y, target.position.z), lookAt: vec3(target.lookAt.x, target.lookAt.y, target.lookAt.z), yaw: finiteAngle(target.yaw), pitch: clamp(target.pitch, this.#limits.minPolar, this.#limits.maxPolar) }); const pAlpha = smoothDampAlpha(dt, this.#policy.positionResponseHz); const lAlpha = smoothDampAlpha(dt, this.#policy.targetResponseHz); const offset = orbitOffset(current.distance, this.#yaw, this.#pitch, current.height, current.shoulder, this.#policy.shoulderOffset); const desired = vec3(safeTarget.lookAt.x + offset.x, safeTarget.lookAt.y + offset.y, safeTarget.lookAt.z + offset.z); const collisionSafe = resolveCameraCollisionPosition(desired, safeTarget.lookAt, candidates); const nextPosition = current.cameraCut ? collisionSafe : lerp3(current.position, collisionSafe, pAlpha); const nextLookAt = lerp3(current.lookAt, safeTarget.lookAt, lAlpha); const divisor = Math.max(dt, 1 / 240); const rawVelocity = vec3((nextPosition.x - current.position.x) / divisor, (nextPosition.y - current.position.y) / divisor, (nextPosition.z - current.position.z) / divisor); const speed = Math.hypot(rawVelocity.x, rawVelocity.y, rawVelocity.z); const velocity = speed <= this.#policy.maxVelocity ? rawVelocity : vec3(rawVelocity.x * this.#policy.maxVelocity / speed, rawVelocity.y * this.#policy.maxVelocity / speed, rawVelocity.z * this.#policy.maxVelocity / speed); const yaw = lerpAngle(this.#yaw, safeTarget.yaw, current.recenter ? lAlpha : 0); this.#yaw = yaw; this.#state = Object.freeze({ ...current, position: nextPosition, lookAt: nextLookAt, velocity, fov: lerpNumber(current.fov, modeFov(current.mode, this.#policy, this.#limits), lAlpha), cameraCut: false }); return ok(this.#state);
  }
  setDistance(distance: number): Result<number> { const failure = this.#alive(); if (failure) return failure; const next = clamp(distance, this.#limits.minDistance, this.#limits.maxDistance); this.#state = Object.freeze({ ...this.#state, distance: next }); return ok(next); }
  setHeight(height: number): Result<number> { const failure = this.#alive(); if (failure) return failure; const next = clamp(height, -2, 12); this.#state = Object.freeze({ ...this.#state, height: next }); return ok(next); }
  snapshot(): CameraState { return this.#state; }
  dispose(): void { this.#disposed = true; }
}

const finiteAngle = (value: number): number => { let angle = Number.isFinite(value) ? value : 0; while (angle > Math.PI) angle -= Math.PI * 2; while (angle < -Math.PI) angle += Math.PI * 2; return angle; };
export const cameraPointToTarget = (state: CameraState): Vec3 => { const dx = state.lookAt.x - state.position.x, dy = state.lookAt.y - state.position.y, dz = state.lookAt.z - state.position.z, length = Math.hypot(dx, dy, dz); return length <= 1e-9 ? vec3(0, 0, -1) : vec3(dx / length, dy / length, dz / length); };
export const validateCameraState = (state: CameraState): Result<CameraState> => { const numbers = [state.distance, state.height, state.fov, state.sensitivity, state.position.x, state.position.y, state.position.z, state.lookAt.x, state.lookAt.y, state.lookAt.z]; if (numbers.some((value) => !Number.isFinite(value))) return err('INVALID_FRAME', 'Camera state contains a non-finite number.'); if (state.distance <= 0 || state.fov <= 0) return err('INVALID_FRAME', 'Camera state violates positive distance/FOV constraints.'); return ok(state); };
export const cameraCollisionDebug = (desired: Vec3, target: Vec3, candidates: readonly CameraCollisionCandidate[]) => { const resolved = resolveCameraCollisionPosition(desired, target, candidates); return Object.freeze({ hit: Math.hypot(resolved.x - desired.x, resolved.y - desired.y, resolved.z - desired.z) > 1e-6, resolved, distanceBefore: Math.hypot(desired.x - target.x, desired.y - target.y, desired.z - target.z), distanceAfter: Math.hypot(resolved.x - target.x, resolved.y - target.y, resolved.z - target.z) }); };
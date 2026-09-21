/** Production TypeScript per-frame helpers for movement, lock-on, streaming and viewport wiring. */
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';
import { CHUNK_CONFIG } from './config.ts';
import { worldToChunkCoord } from './sceneManager.js';

export const PLAYER_LOCK_ON_CONFIG = Object.freeze({
  ACQUIRE_DISTANCE_METERS: 30,
  BREAK_DISTANCE_METERS: 38,
  ACQUIRE_HALF_ANGLE_DEGREES: 68,
  TRACK_HALF_ANGLE_DEGREES: 125,
  DISTANCE_SCORE_WEIGHT: 0.38,
  TURN_RATE_RADIANS_PER_SECOND: 11,
} as const);

const LOCK_ON_EVENT = 'aapw:player-lock-on';
const GAMEPAD_CAMERA_YAW_RADIANS_PER_SECOND = 2.5;
const GAMEPAD_CAMERA_PITCH_RADIANS_PER_SECOND = 1.9;
const GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND = 12;
const GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3;
const CAMERA_POLAR_EPSILON = 0.08;

export interface PlanarPosition { readonly x: number; readonly y: number; readonly z: number; }
export interface LockForward { readonly x: number; readonly z: number; }

export interface LockableObject extends THREE.Object3D {
  userData: Record<string, unknown>;
}

export interface LockableEntity {
  readonly id?: string;
  readonly displayName?: string;
  readonly object3D?: LockableObject;
  readonly model?: LockableObject;
  readonly group?: LockableObject;
}

export interface MovementAxes {
  readonly forward: number;
  readonly strafe: number;
  readonly running: boolean;
  readonly guarding: boolean;
  readonly lockOnRequested: boolean;
  readonly lookX?: number;
  readonly lookY?: number;
  readonly cameraZoom?: number;
  readonly lookDeltaSeconds?: number;
}

export interface MovementVector {
  readonly x: number;
  readonly z: number;
  readonly guarding: boolean;
}

export interface LockTargetEvaluation {
  readonly eligible: boolean;
  readonly reason: 'candidate' | 'unavailable' | 'invalid' | 'range' | 'angle';
  readonly score: number;
  readonly distanceMeters: number;
  readonly angleDegrees: number;
  readonly id: string;
  readonly position?: PlanarPosition | null;
}

export interface SelectedLockTarget extends LockTargetEvaluation {
  readonly eligible: true;
  readonly entity: LockableEntity;
  readonly index: number;
}

export interface LockSnapshot {
  readonly locked: boolean;
  readonly targetId: string | null;
  readonly targetPosition: PlanarPosition | null;
  readonly distanceMeters: number | null;
}

interface PlayerLockOnController {
  readonly update: (options: {
    readonly playerPosition: PlanarPosition;
    readonly forward: LockForward;
    readonly candidates: readonly LockableEntity[];
    readonly toggleRequested: boolean;
  }) => LockSnapshot;
  readonly clear: (reason?: string) => boolean;
  readonly getSnapshot: () => LockSnapshot;
}

export interface CameraLookAxes {
  readonly lookX?: number;
  readonly lookY?: number;
  readonly cameraZoom?: number;
  readonly lookDeltaSeconds?: number;
}

interface LockOnRuntimeState {
  readonly player?: { readonly object3D?: THREE.Object3D };
  readonly camera?: THREE.PerspectiveCamera;
  readonly controls?: OrbitControls;
  readonly keyboardInput?: { readonly consumeLockOnRequested?: () => boolean };
  readonly touchJoystick?: {
    readonly consumeLockOnRequested?: () => boolean;
    readonly setLockOnActive?: (active: boolean) => void;
  };
  readonly npcs?: readonly LockableEntity[];
  readonly paused?: boolean;
  playerLockOn?: PlayerLockOnController;
  playerLockOnLastSeconds?: number;
  lastStreamChunk?: { x: number; z: number };
  readonly chunkManager: {
    readonly getLoadedChunkMesh: (chunkX: number, chunkZ: number) => THREE.Object3D | null | undefined;
    readonly streamTowards: (chunkX: number, chunkZ: number, radius: number) => void;
    readonly everGeneratedCount: number;
    readonly getCumulativeCoveredAreaKm2: () => number;
  };
  readonly settlements: THREE.Object3D;
  readonly realCastles: THREE.Object3D;
  readonly iceLandmarks?: THREE.Object3D;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function entityObject(entity: LockableEntity | null | undefined): LockableObject | null {
  return entity?.object3D ?? entity?.model ?? entity?.group ?? null;
}

function entityStableId(entity: LockableEntity | null | undefined, index: number): string {
  const object = entityObject(entity);
  const objectId = object?.userData?.npcId;
  return String(entity?.id ?? entity?.displayName ?? objectId ?? object?.name ?? `npc-${index}`);
}

function entityLockAvailable(entity: LockableEntity | null | undefined): boolean {
  const object = entityObject(entity);
  return Boolean(object && object.visible !== false && object.userData?.lockOnDisabled !== true);
}

function planarPosition(value: { readonly position?: PlanarPosition } | PlanarPosition | null | undefined): PlanarPosition | null {
  const position = 'position' in (value ?? {}) ? value?.position : value;
  return position && Number.isFinite(position.x) && Number.isFinite(position.z)
    ? Object.freeze({ x: position.x, y: Number.isFinite(position.y) ? position.y : 0, z: position.z })
    : null;
}

function normalizedForward(forward: Partial<LockForward> | null | undefined): LockForward {
  const x = Number.isFinite(forward?.x) ? Number(forward?.x) : 0;
  const z = Number.isFinite(forward?.z) ? Number(forward?.z) : 1;
  const length = Math.hypot(x, z);
  return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
}

export function computePlayerLockViewForward(
  cameraPosition: PlanarPosition | THREE.Vector3 | null | undefined,
  cameraTarget: PlanarPosition | THREE.Vector3 | null | undefined,
): LockForward {
  const camera = planarPosition(cameraPosition);
  const target = planarPosition(cameraTarget);
  return camera && target
    ? normalizedForward({ x: target.x - camera.x, z: target.z - camera.z })
    : { x: 0, z: 1 };
}

export function applyPlayerLockFacing(
  playerObject: THREE.Object3D,
  targetPosition: PlanarPosition | THREE.Vector3,
  delta: number,
  turnRate = PLAYER_LOCK_ON_CONFIG.TURN_RATE_RADIANS_PER_SECOND,
): boolean {
  const player = planarPosition(playerObject);
  const target = planarPosition(targetPosition);
  if (!player || !target || !playerObject.rotation || !(delta > 0) || !(turnRate > 0)) return false;
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  if (Math.hypot(dx, dz) <= 0.05) return false;
  const current = Number.isFinite(playerObject.rotation.y) ? playerObject.rotation.y : 0;
  const targetYaw = Math.atan2(dx, dz);
  const shortest = Math.atan2(Math.sin(targetYaw - current), Math.cos(targetYaw - current));
  playerObject.rotation.y = current + clamp(shortest, -turnRate * Math.min(delta, 0.1), turnRate * Math.min(delta, 0.1));
  return true;
}

export function evaluatePlayerLockTarget({
  playerPosition,
  forward,
  entity,
  index = 0,
  maxDistanceMeters = PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS,
  halfAngleDegrees = PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES,
}: {
  readonly playerPosition?: PlanarPosition;
  readonly forward?: LockForward;
  readonly entity?: LockableEntity | null;
  readonly index?: number;
  readonly maxDistanceMeters?: number;
  readonly halfAngleDegrees?: number;
} = {}): LockTargetEvaluation {
  const object = entityObject(entity);
  const player = playerPosition ? planarPosition(playerPosition) : null;
  const target = planarPosition(object);
  const id = entityStableId(entity, index);
  if (!entityLockAvailable(entity)) return Object.freeze({ eligible: false, reason: 'unavailable', score: Infinity, distanceMeters: Infinity, angleDegrees: 180, id, position: target });
  if (!player || !target || !(maxDistanceMeters > 0)) return Object.freeze({ eligible: false, reason: 'invalid', score: Infinity, distanceMeters: Infinity, angleDegrees: 180, id, position: target });
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const distanceMeters = Math.hypot(dx, dz);
  if (!(distanceMeters > 0.05) || distanceMeters > maxDistanceMeters) {
    return Object.freeze({ eligible: false, reason: 'range', score: Infinity, distanceMeters, angleDegrees: 180, id, position: target });
  }
  const view = normalizedForward(forward);
  const dot = clamp((view.x * dx + view.z * dz) / distanceMeters, -1, 1);
  const angleDegrees = Math.acos(dot) * 180 / Math.PI;
  if (angleDegrees > halfAngleDegrees) {
    return Object.freeze({ eligible: false, reason: 'angle', score: Infinity, distanceMeters, angleDegrees, id, position: target });
  }
  const score =
    (angleDegrees / Math.max(1, halfAngleDegrees)) * (1 - PLAYER_LOCK_ON_CONFIG.DISTANCE_SCORE_WEIGHT)
    + (distanceMeters / maxDistanceMeters) * PLAYER_LOCK_ON_CONFIG.DISTANCE_SCORE_WEIGHT;
  return Object.freeze({ eligible: true, reason: 'candidate', score, distanceMeters, angleDegrees, id, position: target });
}

export function selectPlayerLockTarget({
  playerPosition,
  forward,
  candidates = [],
  maxDistanceMeters = PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS,
  halfAngleDegrees = PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES,
}: {
  readonly playerPosition?: PlanarPosition;
  readonly forward?: LockForward;
  readonly candidates?: readonly LockableEntity[];
  readonly maxDistanceMeters?: number;
  readonly halfAngleDegrees?: number;
} = {}): SelectedLockTarget | null {
  let best: SelectedLockTarget | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const evaluation = evaluatePlayerLockTarget({
      playerPosition,
      forward,
      entity: candidates[index],
      index,
      maxDistanceMeters,
      halfAngleDegrees,
    });
    if (!evaluation.eligible) continue;
    const candidate: SelectedLockTarget = { ...evaluation, entity: candidates[index] as LockableEntity, index };
    if (
      !best
      || candidate.score < best.score - 1e-9
      || (Math.abs(candidate.score - best.score) <= 1e-9 && candidate.id.localeCompare(best.id) < 0)
    ) best = candidate;
  }
  return best;
}

export function findNearestPlayerLockCandidate({
  playerPosition,
  forward,
  candidates = [],
}: {
  readonly playerPosition?: PlanarPosition;
  readonly forward?: LockForward;
  readonly candidates?: readonly LockableEntity[];
} = {}) {
  const player = playerPosition ? planarPosition(playerPosition) : null;
  const view = normalizedForward(forward);
  if (!player) return null;
  let best: { id: string; position: PlanarPosition; distanceMeters: number; angleDegrees: number } | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const entity = candidates[index];
    const target = planarPosition(entityObject(entity));
    if (!entityLockAvailable(entity) || !target) continue;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const distanceMeters = Math.hypot(dx, dz);
    if (!(distanceMeters > 0.05)) continue;
    const dot = clamp((view.x * dx + view.z * dz) / distanceMeters, -1, 1);
    const angleDegrees = Math.acos(dot) * 180 / Math.PI;
    const id = entityStableId(entity, index);
    const candidate = { id, position: target, distanceMeters, angleDegrees };
    if (!best || distanceMeters < best.distanceMeters - 1e-9 || (Math.abs(distanceMeters - best.distanceMeters) <= 1e-9 && id.localeCompare(best.id) < 0)) best = candidate;
  }
  return best;
}

function dispatchLockOn(detail: Readonly<Record<string, unknown>>): void {
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(LOCK_ON_EVENT, { detail: Object.freeze(detail) }));
  }
}

export function createPlayerLockOnController(config: {
  readonly acquireDistanceMeters?: number;
  readonly breakDistanceMeters?: number;
  readonly halfAngleDegrees?: number;
  readonly trackHalfAngleDegrees?: number;
} = {}): PlayerLockOnController {
  const acquireDistanceMeters = config.acquireDistanceMeters ?? PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS;
  const breakDistanceMeters = Math.max(acquireDistanceMeters, config.breakDistanceMeters ?? PLAYER_LOCK_ON_CONFIG.BREAK_DISTANCE_METERS);
  const halfAngleDegrees = config.halfAngleDegrees ?? PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES;
  const trackHalfAngleDegrees = Math.max(halfAngleDegrees, config.trackHalfAngleDegrees ?? PLAYER_LOCK_ON_CONFIG.TRACK_HALF_ANGLE_DEGREES);
  let lockedEntity: LockableEntity | null = null;
  let lockedId: string | null = null;
  let lastDistanceMeters = Infinity;

  const snapshot = (): LockSnapshot => {
    const position = planarPosition(entityObject(lockedEntity));
    return Object.freeze({
      locked: Boolean(lockedEntity && position),
      targetId: lockedId,
      targetPosition: position ? Object.freeze({ ...position }) : null,
      distanceMeters: Number.isFinite(lastDistanceMeters) ? Number(lastDistanceMeters.toFixed(3)) : null,
    });
  };

  const clear = (reason = 'released'): boolean => {
    if (!lockedEntity) return false;
    const previousId = lockedId;
    lockedEntity = null;
    lockedId = null;
    lastDistanceMeters = Infinity;
    dispatchLockOn({ locked: false, targetId: previousId, reason });
    return true;
  };

  return {
    update({ playerPosition, forward, candidates, toggleRequested }): LockSnapshot {
      if (toggleRequested && lockedEntity) {
        clear('toggle-release');
        return snapshot();
      }
      if (lockedEntity) {
        if (!candidates.includes(lockedEntity)) {
          clear('target-removed');
          return snapshot();
        }
        if (!entityLockAvailable(lockedEntity)) {
          clear('target-unavailable');
          return snapshot();
        }
        const target = planarPosition(entityObject(lockedEntity));
        lastDistanceMeters = target ? Math.hypot(target.x - playerPosition.x, target.z - playerPosition.z) : Infinity;
        if (!target || lastDistanceMeters > breakDistanceMeters) {
          clear('range-break');
          return snapshot();
        }
        const tracking = evaluatePlayerLockTarget({
          playerPosition,
          forward,
          entity: lockedEntity,
          maxDistanceMeters: breakDistanceMeters,
          halfAngleDegrees: trackHalfAngleDegrees,
        });
        if (!tracking.eligible && tracking.reason === 'angle') {
          clear('view-break');
          return snapshot();
        }
        return snapshot();
      }
      if (!toggleRequested) return snapshot();
      const selected = selectPlayerLockTarget({
        playerPosition,
        forward,
        candidates,
        maxDistanceMeters: acquireDistanceMeters,
        halfAngleDegrees,
      });
      if (!selected) {
        const nearest = findNearestPlayerLockCandidate({ playerPosition, forward, candidates });
        dispatchLockOn({
          locked: false,
          targetId: null,
          reason: 'no-target',
          nearestTargetId: nearest?.id ?? null,
          nearestTargetPosition: nearest?.position ? Object.freeze({ ...nearest.position }) : null,
          nearestDistanceMeters: nearest ? Number(nearest.distanceMeters.toFixed(3)) : null,
          nearestAngleDegrees: nearest ? Number(nearest.angleDegrees.toFixed(2)) : null,
        });
        return snapshot();
      }
      lockedEntity = selected.entity;
      lockedId = selected.id;
      lastDistanceMeters = selected.distanceMeters;
      dispatchLockOn({
        locked: true,
        targetId: lockedId,
        reason: 'acquired',
        distanceMeters: Number(lastDistanceMeters.toFixed(3)),
        angleDegrees: Number(selected.angleDegrees.toFixed(2)),
        targetPosition: Object.freeze({ ...selected.position }),
      });
      return snapshot();
    },
    clear,
    getSnapshot: snapshot,
  };
}

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const cameraOffset = new THREE.Vector3();
const cameraSpherical = new THREE.Spherical();

export function applyGamepadCameraLook(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  axes: CameraLookAxes | null | undefined,
): boolean {
  const lookX = Number.isFinite(axes?.lookX) ? Number(axes?.lookX) : 0;
  const lookY = Number.isFinite(axes?.lookY) ? Number(axes?.lookY) : 0;
  const cameraZoom = Number.isFinite(axes?.cameraZoom) ? THREE.MathUtils.clamp(Number(axes?.cameraZoom), -1, 1) : 0;
  const dt = Math.max(0, Math.min(
    GAMEPAD_CAMERA_MAX_FRAME_SECONDS,
    Number.isFinite(axes?.lookDeltaSeconds) ? Number(axes?.lookDeltaSeconds) : 0,
  ));
  if (dt === 0 || (lookX === 0 && lookY === 0 && cameraZoom === 0)) return false;
  cameraOffset.subVectors(camera.position, controls.target);
  if (cameraOffset.lengthSq() < 1e-6) return false;
  cameraSpherical.setFromVector3(cameraOffset);
  cameraSpherical.theta -= lookX * GAMEPAD_CAMERA_YAW_RADIANS_PER_SECOND * dt;
  const minPolar = Math.max(CAMERA_POLAR_EPSILON, Number.isFinite(controls.minPolarAngle) ? controls.minPolarAngle : CAMERA_POLAR_EPSILON);
  const maxPolar = Math.min(Math.PI - CAMERA_POLAR_EPSILON, Number.isFinite(controls.maxPolarAngle) ? controls.maxPolarAngle : Math.PI - CAMERA_POLAR_EPSILON);
  cameraSpherical.phi = THREE.MathUtils.clamp(
    cameraSpherical.phi + lookY * GAMEPAD_CAMERA_PITCH_RADIANS_PER_SECOND * dt,
    minPolar,
    Math.max(minPolar, maxPolar),
  );
  const minDistance = Math.max(0.1, Number.isFinite(controls.minDistance) ? controls.minDistance : 0.1);
  const maxDistance = Math.max(minDistance, Number.isFinite(controls.maxDistance) ? controls.maxDistance : Infinity);
  cameraSpherical.radius = THREE.MathUtils.clamp(
    cameraSpherical.radius - cameraZoom * GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND * dt,
    minDistance,
    maxDistance,
  );
  camera.position.copy(cameraOffset.setFromSpherical(cameraSpherical).add(controls.target));
  return true;
}

export function computeCameraRelativeMove(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  axes: MovementAxes,
): MovementVector {
  applyGamepadCameraLook(camera, controls, axes);
  const guarding = Boolean(axes.guarding);
  const inputMagnitude = Math.min(1, Math.hypot(axes.forward, axes.strafe));
  if (inputMagnitude === 0) return { x: 0, z: 0, guarding };
  forward.subVectors(controls.target, camera.position);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  else forward.normalize();
  right.crossVectors(forward, worldUp).normalize();
  move.set(0, 0, 0).addScaledVector(forward, axes.forward).addScaledVector(right, axes.strafe);
  if (move.lengthSq() < 1e-6) return { x: 0, z: 0, guarding };
  move.normalize().multiplyScalar(inputMagnitude);
  return { x: move.x, z: move.z, guarding };
}

export function combineAxes(
  keyboardAxes: MovementAxes,
  joystickAxes: MovementAxes | null | undefined,
): MovementAxes {
  if (!joystickAxes) return keyboardAxes;
  return Object.freeze({
    forward: clamp(keyboardAxes.forward + joystickAxes.forward, -1, 1),
    strafe: clamp(keyboardAxes.strafe + joystickAxes.strafe, -1, 1),
    running: keyboardAxes.running || joystickAxes.running,
    guarding: Boolean(keyboardAxes.guarding || joystickAxes.guarding),
    lockOnRequested: Boolean(keyboardAxes.lockOnRequested),
    lookX: keyboardAxes.lookX ?? 0,
    lookY: keyboardAxes.lookY ?? 0,
    cameraZoom: keyboardAxes.cameraZoom ?? 0,
    lookDeltaSeconds: keyboardAxes.lookDeltaSeconds ?? 0,
  });
}

export function updatePlayerLockOn(state: LockOnRuntimeState): LockSnapshot | null {
  if (!state.player?.object3D || !state.camera || !state.controls || !state.keyboardInput) return null;
  state.playerLockOn ??= createPlayerLockOnController();
  const nowSeconds = (globalThis.performance?.now?.() ?? Date.now()) / 1000;
  const previousSeconds = Number.isFinite(state.playerLockOnLastSeconds) ? Number(state.playerLockOnLastSeconds) : nowSeconds;
  state.playerLockOnLastSeconds = nowSeconds;
  const delta = state.paused ? 0 : Math.max(0, Math.min(0.1, nowSeconds - previousSeconds));
  const keyboardToggle = Boolean(state.keyboardInput.consumeLockOnRequested?.());
  const touchToggle = Boolean(state.touchJoystick?.consumeLockOnRequested?.());
  const snapshot = state.playerLockOn.update({
    playerPosition: planarPosition(state.player.object3D.position) ?? { x: 0, y: 0, z: 0 },
    forward: computePlayerLockViewForward(state.camera.position, state.controls.target),
    candidates: state.npcs ?? [],
    toggleRequested: !state.paused && (keyboardToggle || touchToggle),
  });
  if (snapshot.targetPosition && delta > 0) applyPlayerLockFacing(state.player.object3D, snapshot.targetPosition, delta);
  state.touchJoystick?.setLockOnActive?.(snapshot.locked);
  state.player.object3D.userData.playerLockOn = snapshot;
  return snapshot;
}

const cameraCollidables: THREE.Object3D[] = [];

export function collectCameraCollidables(
  state: Pick<LockOnRuntimeState, 'chunkManager' | 'settlements' | 'realCastles' | 'iceLandmarks'>,
  worldX: number,
  worldZ: number,
): readonly THREE.Object3D[] {
  cameraCollidables.length = 0;
  const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
  const centerChunkX = worldToChunkCoord(worldX, chunkSize);
  const centerChunkZ = worldToChunkCoord(worldZ, chunkSize);
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const mesh = state.chunkManager.getLoadedChunkMesh(centerChunkX + dx, centerChunkZ + dz);
      if (mesh) cameraCollidables.push(mesh);
    }
  }
  for (const part of state.settlements.children) cameraCollidables.push(part);
  for (const realCastle of state.realCastles.children) cameraCollidables.push(realCastle);
  for (const icePart of state.iceLandmarks?.children ?? []) cameraCollidables.push(icePart);
  return cameraCollidables;
}

export function streamAroundOrbitTarget(state: LockOnRuntimeState): void {
  updatePlayerLockOn(state);
  const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
  const targetChunkX = worldToChunkCoord(state.controls?.target.x ?? 0, chunkSize);
  const targetChunkZ = worldToChunkCoord(state.controls?.target.z ?? 0, chunkSize);
  if (state.lastStreamChunk && state.lastStreamChunk.x === targetChunkX && state.lastStreamChunk.z === targetChunkZ) return;
  state.lastStreamChunk = { x: targetChunkX, z: targetChunkZ };
  const beforeCount = state.chunkManager.everGeneratedCount;
  state.chunkManager.streamTowards(targetChunkX, targetChunkZ, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS);
  const newlyGenerated = state.chunkManager.everGeneratedCount - beforeCount;
  if (newlyGenerated > 0) {
    console.info(`[game3d] Streamed in ${newlyGenerated} new chunk(s) near (${targetChunkX}, ${targetChunkZ}) — cumulative World Coverage now ${state.chunkManager.getCumulativeCoveredAreaKm2().toFixed(2)} km².`);
  }
}

export function bindResize(state: { readonly camera: THREE.PerspectiveCamera; readonly renderer: THREE.WebGLRenderer }): () => void {
  const onResize = (): void => {
    const width = Math.max(1, globalThis.innerWidth);
    const height = Math.max(1, globalThis.innerHeight);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(width, height);
  };
  globalThis.addEventListener('resize', onResize);
  return () => globalThis.removeEventListener('resize', onResize);
}

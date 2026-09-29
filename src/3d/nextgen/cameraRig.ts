import type { CameraState, Vec3 } from './kernelTypes.ts';
import { clamp, dampAlpha, fault, length3, scale3, sub3, vec3 } from './kernelTypes.ts';

export interface CameraPolicy {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minPitch: number;
  readonly maxPitch: number;
  readonly minFov: number;
  readonly maxFov: number;
  readonly followResponseHz: number;
  readonly collisionMargin: number;
  readonly collisionMinDistance: number;
  readonly fovResponseHz: number;
  readonly maxAngularVelocity: number;
}

export const DEFAULT_CAMERA_POLICY: CameraPolicy = Object.freeze({
  minDistance: 2.5,
  maxDistance: 16,
  minPitch: 0.08,
  maxPitch: 1.35,
  minFov: 48,
  maxFov: 78,
  followResponseHz: 9,
  collisionMargin: 0.25,
  collisionMinDistance: 1.5,
  fovResponseHz: 6,
  maxAngularVelocity: 8,
});

export interface CameraCollision {
  readonly distance: number;
  readonly normal: Vec3;
}

export interface CameraTarget {
  readonly position: Vec3;
  readonly lookAt?: Vec3;
  readonly velocity?: Vec3;
  readonly combat?: boolean;
  readonly lockOn?: Vec3;
}

export interface CameraUpdate {
  readonly state: CameraState;
  readonly desiredPosition: Vec3;
  readonly collisionDistance: number | null;
  readonly cameraCut: boolean;
}

export interface CameraHooks {
  readonly sweep?: (
    from: Vec3,
    to: Vec3,
    radius: number,
  ) => CameraCollision | null;
}

export class CameraRig {
  readonly policy: CameraPolicy;
  readonly hooks: CameraHooks;
  #state: CameraState;
  #disposed = false;
  #lastTarget = vec3();

  constructor(policy: CameraPolicy = DEFAULT_CAMERA_POLICY, hooks: CameraHooks = {}) {
    this.policy = Object.freeze({ ...policy });
    this.hooks = hooks;
    this.#state = Object.freeze({
      position: vec3(0, 4, 10),
      target: vec3(),
      distance: 10,
      pitch: 0.45,
      yaw: 0,
      fov: 64,
      mode: 'follow' as const,
    });
  }

  update(
    dt: number,
    target: CameraTarget,
    yawDelta = 0,
    pitchDelta = 0,
    distanceDelta = 0,
  ): { ok: true; value: CameraUpdate } | { ok: false; error: ReturnType<typeof fault> } {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Camera rig is disposed.', false) };
    const delta = clamp(dt, 0, 0.1);
    const currentTarget = target.position;
    const targetVelocity = target.velocity ?? vec3();
    const mode = target.lockOn ? 'lock-on' : target.combat ? 'combat' : 'follow';

    let yaw = this.#state.yaw + clamp(yawDelta, -this.policy.maxAngularVelocity * delta, this.policy.maxAngularVelocity * delta);
    let pitch = clamp(
      this.#state.pitch + clamp(pitchDelta, -this.policy.maxAngularVelocity * delta, this.policy.maxAngularVelocity * delta),
      this.policy.minPitch,
      this.policy.maxPitch,
    );

    const desiredDistance = clamp(
      this.#state.distance + distanceDelta,
      this.policy.minDistance,
      this.policy.maxDistance,
    );

    const focus = target.lockOn
      ? scale3(add3Safe(currentTarget, target.lockOn), 0.5)
      : target.lookAt ?? currentTarget;

    const forward = vec3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );
    let desiredPosition = {
      x: focus.x - forward.x * desiredDistance,
      y: focus.y - forward.y * desiredDistance + 0.15,
      z: focus.z - forward.z * desiredDistance,
    };

    const collision = this.hooks.sweep?.(focus, desiredPosition, this.policy.collisionMargin) ?? null;
    let resolvedDistance = desiredDistance;
    if (collision) {
      resolvedDistance = clamp(
        collision.distance - this.policy.collisionMargin,
        this.policy.collisionMinDistance,
        desiredDistance,
      );
      desiredPosition = {
        x: focus.x - forward.x * resolvedDistance,
        y: focus.y - forward.y * resolvedDistance + 0.15,
        z: focus.z - forward.z * resolvedDistance,
      };
    }

    const response = dampAlpha(delta, this.policy.followResponseHz);
    const nextPosition = vec3(
      this.#state.position.x + (desiredPosition.x - this.#state.position.x) * response,
      this.#state.position.y + (desiredPosition.y - this.#state.position.y) * response,
      this.#state.position.z + (desiredPosition.z - this.#state.position.z) * response,
    );

    const velocityMagnitude = length3(targetVelocity);
    const desiredFov = clamp(
      this.policy.minFov + (this.policy.maxFov - this.policy.minFov) * Math.min(1, velocityMagnitude / 10),
      this.policy.minFov,
      this.policy.maxFov,
    );
    const fovAlpha = dampAlpha(delta, this.policy.fovResponseHz);

    const cameraCut = length3(sub3(currentTarget, this.#lastTarget)) > this.policy.maxDistance * 1.5;
    this.#lastTarget = currentTarget;

    this.#state = Object.freeze({
      position: nextPosition,
      target: vec3(focus.x, focus.y, focus.z),
      distance: resolvedDistance,
      pitch,
      yaw,
      fov: this.#state.fov + (desiredFov - this.#state.fov) * fovAlpha,
      mode,
    });

    return {
      ok: true,
      value: Object.freeze({
        state: this.#state,
        desiredPosition: vec3(desiredPosition.x, desiredPosition.y, desiredPosition.z),
        collisionDistance: collision?.distance ?? null,
        cameraCut,
      }),
    };
  }

  state(): CameraState { return this.#state; }

  recenter(): void {
    this.#state = Object.freeze({ ...this.#state, yaw: 0, pitch: 0.45, mode: 'follow' });
  }

  setDistance(distance: number): void {
    this.#state = Object.freeze({
      ...this.#state,
      distance: clamp(distance, this.policy.minDistance, this.policy.maxDistance),
    });
  }

  setPose(position: Vec3, target: Vec3): void {
    this.#state = Object.freeze({
      ...this.#state,
      position,
      target,
      distance: clamp(length3(sub3(position, target)), this.policy.minDistance, this.policy.maxDistance),
    });
  }

  diagnostics() {
    return Object.freeze({
      mode: this.#state.mode,
      distance: this.#state.distance,
      pitch: this.#state.pitch,
      yaw: this.#state.yaw,
      fov: this.#state.fov,
    });
  }

  dispose(): void { this.#disposed = true; }
}

const add3Safe = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

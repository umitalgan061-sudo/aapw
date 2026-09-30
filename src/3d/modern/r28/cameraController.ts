import type { CameraVolume, Vec3 } from '../r27/contracts.ts';
import { normalize, add, scale } from '../r27/physics.ts';

export type CameraMode = 'orbit' | 'follow' | 'free' | 'cinematic';

export interface CameraTarget {
  readonly position: Vec3;
  readonly velocity?: Vec3;
  readonly radius?: number;
}

export interface CameraPolicy {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly damping: number;
  readonly pitchMin: number;
  readonly pitchMax: number;
  readonly lookAhead: number;
}

export interface CameraState {
  readonly mode: CameraMode;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly distance: number;
  readonly yaw: number;
  readonly pitch: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class RuntimeCameraController {
  readonly policy: CameraPolicy;
  #state: CameraState;

  constructor(policy: Partial<CameraPolicy> = {}) {
    this.policy = Object.freeze({
      minDistance: Math.max(0.1, policy.minDistance ?? 2),
      maxDistance: Math.max(policy.minDistance ?? 2, policy.maxDistance ?? 50),
      damping: clamp(policy.damping ?? 12, 0.1, 100),
      pitchMin: clamp(policy.pitchMin ?? -1.2, -1.55, 0),
      pitchMax: clamp(policy.pitchMax ?? 1.1, 0.1, 1.55),
      lookAhead: Math.max(0, policy.lookAhead ?? 1),
    });
    this.#state = {
      mode: 'orbit',
      position: { x: 0, y: 4, z: 8 },
      target: { x: 0, y: 0, z: 0 },
      distance: 8,
      yaw: 0,
      pitch: -0.35,
    };
  }

  setMode(mode: CameraMode): void {
    this.#state = { ...this.#state, mode };
  }

  setAngles(yaw: number, pitch: number): void {
    this.#state = {
      ...this.#state,
      yaw: Number.isFinite(yaw) ? yaw : this.#state.yaw,
      pitch: clamp(Number.isFinite(pitch) ? pitch : this.#state.pitch, this.policy.pitchMin, this.policy.pitchMax),
    };
  }

  zoom(delta: number): void {
    const distance = clamp(this.#state.distance + delta, this.policy.minDistance, this.policy.maxDistance);
    this.#state = { ...this.#state, distance };
  }

  update(target: CameraTarget, dtSeconds: number): CameraState {
    const dt = clamp(dtSeconds, 0, 0.1);
    const velocity = target.velocity ?? { x: 0, y: 0, z: 0 };
    const desiredTarget = add(target.position, scale(velocity, this.policy.lookAhead));
    const blend = 1 - Math.exp(-this.policy.damping * dt);
    const nextTarget = {
      x: lerp(this.#state.target.x, desiredTarget.x, blend),
      y: lerp(this.#state.target.y, desiredTarget.y, blend),
      z: lerp(this.#state.target.z, desiredTarget.z, blend),
    };
    const horizontal = Math.cos(this.#state.pitch) * this.#state.distance;
    const desiredPosition = {
      x: nextTarget.x + Math.sin(this.#state.yaw) * horizontal,
      y: nextTarget.y - Math.sin(this.#state.pitch) * this.#state.distance + (target.radius ?? 0),
      z: nextTarget.z + Math.cos(this.#state.yaw) * horizontal,
    };
    const position = {
      x: lerp(this.#state.position.x, desiredPosition.x, blend),
      y: lerp(this.#state.position.y, desiredPosition.y, blend),
      z: lerp(this.#state.position.z, desiredPosition.z, blend),
    };
    this.#state = { ...this.#state, position, target: nextTarget };
    return this.#state;
  }

  volume(fovYRadians: number, aspect: number, near = 0.1, far = 1000): CameraVolume {
    return {
      position: this.#state.position,
      forward: normalize({
        x: this.#state.target.x - this.#state.position.x,
        y: this.#state.target.y - this.#state.position.y,
        z: this.#state.target.z - this.#state.position.z,
      }, { x: 0, y: 0, z: -1 }),
      up: { x: 0, y: 1, z: 0 },
      fovYRadians: clamp(fovYRadians, 0.1, 3),
      aspect: Math.max(0.1, aspect),
      near: Math.max(0.001, near),
      far: Math.max(near + 0.1, far),
    };
  }

  state(): CameraState {
    return Object.freeze({ ...this.#state });
  }
}

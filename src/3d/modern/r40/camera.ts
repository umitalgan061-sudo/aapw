import type { Transform, Vec3 } from './types';
import { clamp, criticallyDamped, vec3Distance, vec3Lerp } from './deterministic';

export interface CameraTarget { readonly position: Vec3; readonly focus: Vec3; readonly radius: number; readonly minRadius: number; readonly maxRadius: number; }
export interface CameraState { readonly position: Vec3; readonly focus: Vec3; readonly yaw: number; readonly pitch: number; readonly distance: number; readonly fov: number; }
export interface CameraConstraints { readonly minPitch: number; readonly maxPitch: number; readonly minFov: number; readonly maxFov: number; }

export class ThirdPersonCamera {
  readonly constraints: CameraConstraints;
  #state: CameraState = Object.freeze({ position: { x: 0, y: 2, z: 6 }, focus: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: -0.2, distance: 6, fov: 60 });
  #distanceVelocity = 0;
  #pitchVelocity = 0;
  constructor(constraints: Partial<CameraConstraints> = {}) { this.constraints = Object.freeze({ minPitch: -1.2, maxPitch: 0.9, minFov: 45, maxFov: 80, ...constraints }); }
  update(target: CameraTarget, inputYaw: number, inputPitch: number, zoomDelta: number, dt: number): CameraState {
    const yaw = this.#state.yaw + clamp(inputYaw, -0.2, 0.2);
    const pitch = clamp(this.#state.pitch + clamp(inputPitch, -0.15, 0.15), this.constraints.minPitch, this.constraints.maxPitch);
    const desiredDistance = clamp(this.#state.distance + clamp(zoomDelta, -2, 2), target.minRadius, target.maxRadius);
    const damped = criticallyDamped(this.#state.distance, desiredDistance, this.#distanceVelocity, Math.max(0, dt), 6);
    this.#distanceVelocity = damped.velocity;
    const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
    const offset = { x: Math.sin(yaw) * cosPitch * damped.value, y: -sinPitch * damped.value, z: Math.cos(yaw) * cosPitch * damped.value };
    const position = vec3Lerp(this.#state.position, { x: target.focus.x + offset.x, y: target.focus.y + offset.y, z: target.focus.z + offset.z }, clamp(dt * 10, 0, 1));
    this.#state = Object.freeze({ position, focus: target.focus, yaw, pitch, distance: clamp(damped.value, target.minRadius, target.maxRadius), fov: this.#state.fov });
    return this.#state;
  }
  avoidObstacle(position: Vec3, obstacleDistance: number): Vec3 {
    const safe = Math.max(0.2, obstacleDistance - 0.35);
    const direction = { x: position.x - this.#state.focus.x, y: position.y - this.#state.focus.y, z: position.z - this.#state.focus.z };
    const length = vec3Distance(position, this.#state.focus) || 1;
    return { x: this.#state.focus.x + direction.x / length * Math.min(safe, this.#state.distance), y: this.#state.focus.y + direction.y / length * Math.min(safe, this.#state.distance), z: this.#state.focus.z + direction.z / length * Math.min(safe, this.#state.distance) };
  }
  setFov(fov: number): void { this.#state = Object.freeze({ ...this.#state, fov: clamp(fov, this.constraints.minFov, this.constraints.maxFov) }); }
  state(): CameraState { return this.#state; }
  reset(): void { this.#state = Object.freeze({ position: { x: 0, y: 2, z: 6 }, focus: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: -0.2, distance: 6, fov: 60 }); this.#distanceVelocity = 0; this.#pitchVelocity = 0; }
  targetTransform(): Transform { return Object.freeze({ position: this.#state.position, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }); }
}

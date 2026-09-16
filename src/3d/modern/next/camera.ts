import { clamp, damp, lerp3, normalize3, subtract3, type Vec3 } from './math.ts';

export interface CameraTarget { readonly position: Vec3; readonly yawRadians: number; readonly velocity: Vec3; }
export interface CameraObstruction { readonly distance: number; readonly radius: number; }
export interface CameraState { position: Vec3; lookAt: Vec3; distance: number; yaw: number; pitch: number; shake: number; }

export interface CameraConfig { readonly minDistance: number; readonly maxDistance: number; readonly shoulderOffset: number; readonly heightOffset: number; readonly smoothing: number; readonly collisionPadding: number; readonly minPitch: number; readonly maxPitch: number; }

const DEFAULT_CONFIG: CameraConfig = { minDistance: 2.5, maxDistance: 14, shoulderOffset: 0.7, heightOffset: 1.5, smoothing: 14, collisionPadding: 0.25, minPitch: -0.25, maxPitch: 1.15 };

export class ThirdPersonCameraSolver {
  readonly config: CameraConfig;
  readonly state: CameraState;
  constructor(config: Partial<CameraConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = { position: { x: 0, y: 2, z: 6 }, lookAt: { x: 0, y: 1, z: 0 }, distance: this.config.maxDistance, yaw: 0, pitch: 0.3, shake: 0 };
  }

  update(target: CameraTarget, dtSeconds: number, input: { yawDelta?: number; pitchDelta?: number; zoomDelta?: number } = {}, obstruction?: CameraObstruction): CameraState {
    const dt = Math.max(0, dtSeconds);
    this.state.yaw += input.yawDelta ?? 0;
    this.state.pitch = clamp(this.state.pitch + (input.pitchDelta ?? 0), this.config.minPitch, this.config.maxPitch);
    const requestedDistance = clamp(this.state.distance + (input.zoomDelta ?? 0), this.config.minDistance, this.config.maxDistance);
    const obstructionDistance = obstruction ? Math.max(this.config.minDistance, obstruction.distance - obstruction.radius - this.config.collisionPadding) : this.config.maxDistance;
    const targetDistance = Math.min(requestedDistance, obstructionDistance);
    this.state.distance = damp(this.state.distance, targetDistance, this.config.smoothing, dt);

    const yaw = target.yawRadians + this.state.yaw;
    const cosPitch = Math.cos(this.state.pitch);
    const direction = { x: Math.sin(yaw) * cosPitch, y: Math.sin(this.state.pitch), z: Math.cos(yaw) * cosPitch };
    const shoulder = { x: Math.cos(yaw) * this.config.shoulderOffset, y: 0, z: -Math.sin(yaw) * this.config.shoulderOffset };
    const anchor = { x: target.position.x + shoulder.x, y: target.position.y + this.config.heightOffset + shoulder.y, z: target.position.z + shoulder.z };
    const desiredPosition = { x: anchor.x + direction.x * this.state.distance, y: anchor.y + direction.y * this.state.distance, z: anchor.z + direction.z * this.state.distance };
    this.state.position = lerp3(this.state.position, desiredPosition, 1 - Math.exp(-this.config.smoothing * dt));
    const lookAhead = normalize3(target.velocity);
    this.state.lookAt = lerp3(this.state.lookAt, { x: anchor.x + lookAhead.x * 0.75, y: anchor.y + lookAhead.y * 0.75, z: anchor.z + lookAhead.z * 0.75 }, 1 - Math.exp(-10 * dt));
    this.state.shake = damp(this.state.shake, 0, 9, dt);
    return { ...this.state, position: { ...this.state.position }, lookAt: { ...this.state.lookAt } };
  }

  kickShake(amount: number): void { this.state.shake = clamp(this.state.shake + Math.max(0, amount), 0, 1); }

  applyShake(randomX: number, randomY: number): Vec3 {
    const amplitude = this.state.shake * 0.2;
    return { x: randomX * amplitude, y: randomY * amplitude, z: 0 };
  }
}

export function orbitDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return normalize3({ x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c });
}

export function followVelocityLookAt(target: CameraTarget, leadSeconds = 0.4): Vec3 {
  return { x: target.position.x + target.velocity.x * leadSeconds, y: target.position.y + target.velocity.y * leadSeconds, z: target.position.z + target.velocity.z * leadSeconds };
}

export function cameraDistance(a: Vec3, b: Vec3): number { return Math.hypot(...Object.values(subtract3(a, b))); }

/**
 * Renderer-agnostic camera authority for the TypeScript-first runtime.
 * The browser adapter owns the actual Three.js camera; this module owns only
 * deterministic camera intent, smoothing and safety policy.
 */

import { clamp, criticallyDamped, lerp, normalize3, sub3, type Vec3 } from './deterministicMath';

export type CameraMode = 'follow' | 'combat' | 'aim' | 'cinematic' | 'free';
export type CameraSpace = 'world' | 'target';

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  roll: number;
}

export interface CameraInput {
  lookX: number;
  lookY: number;
  zoom: number;
  orbit: boolean;
  reset: boolean;
}

export interface CameraObstacle {
  /** Closest safe distance from the camera pivot along the pivot-to-camera ray. */
  maxDistance: number;
  /** Optional wall-normal hint used to bias recovery away from the obstacle. */
  normal?: Vec3;
}

export interface CameraTarget {
  position: Vec3;
  velocity?: Vec3;
  forward?: Vec3;
  radius?: number;
}

export interface CameraConfig {
  minDistance: number;
  maxDistance: number;
  pitchMin: number;
  pitchMax: number;
  yawSpeed: number;
  pitchSpeed: number;
  zoomSpeed: number;
  positionStiffness: number;
  targetStiffness: number;
  maxFrameDelta: number;
  collisionPadding: number;
  shakeAmplitude: number;
  shakeFrequency: number;
  cinematicBlendSeconds: number;
}

export interface CameraSnapshot {
  version: 3;
  tick: number;
  mode: CameraMode;
  pose: CameraPose;
  desired: CameraPose;
  targetEntity: number | null;
  collisionLimited: boolean;
  shakeScale: number;
  cinematicWeight: number;
}

export interface CinematicKeyframe {
  at: number;
  pose: CameraPose;
  weight?: number;
}

export interface CameraTransition {
  from: CameraPose;
  to: CameraPose;
  elapsed: number;
  duration: number;
  active: boolean;
}

const DEFAULT_CONFIG: CameraConfig = {
  minDistance: 1.2,
  maxDistance: 18,
  pitchMin: -1.35,
  pitchMax: 1.25,
  yawSpeed: 2.8,
  pitchSpeed: 2.2,
  zoomSpeed: 7,
  positionStiffness: 18,
  targetStiffness: 22,
  maxFrameDelta: 0.1,
  collisionPadding: 0.18,
  shakeAmplitude: 0.08,
  shakeFrequency: 12,
  cinematicBlendSeconds: 0.35,
};

const zero = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;

function sanitizePose(pose: CameraPose, fallbackDistance: number): CameraPose {
  const normalizedForward = normalize3(sub3(pose.target, pose.position));
  const safeForward = normalizedForward.x === 0 && normalizedForward.y === 0 && normalizedForward.z === 0
    ? { x: 0, y: 0, z: 1 }
    : normalizedForward;
  const distance = Math.max(0.01, finite(pose.distance, fallbackDistance));
  return {
    position: copy(pose.position),
    target: copy(pose.target),
    yaw: finite(pose.yaw, 0),
    pitch: finite(pose.pitch, 0),
    distance,
    roll: finite(pose.roll, 0),
  };
}

function blendPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const weight = clamp(t, 0, 1);
  return {
    position: {
      x: lerp(a.position.x, b.position.x, weight),
      y: lerp(a.position.y, b.position.y, weight),
      z: lerp(a.position.z, b.position.z, weight),
    },
    target: {
      x: lerp(a.target.x, b.target.x, weight),
      y: lerp(a.target.y, b.target.y, weight),
      z: lerp(a.target.z, b.target.z, weight),
    },
    yaw: lerp(a.yaw, b.yaw, weight),
    pitch: lerp(a.pitch, b.pitch, weight),
    distance: lerp(a.distance, b.distance, weight),
    roll: lerp(a.roll, b.roll, weight),
  };
}

function sampleCinematic(keyframes: readonly CinematicKeyframe[], time: number): CameraPose | null {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  if (time <= sorted[0].at) return sanitizePose(sorted[0].pose, sorted[0].pose.distance);
  const last = sorted[sorted.length - 1];
  if (time >= last.at) return sanitizePose(last.pose, last.pose.distance);
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (time <= next.at) {
      const previous = sorted[i - 1];
      const span = Math.max(0.0001, next.at - previous.at);
      return blendPose(previous.pose, next.pose, (time - previous.at) / span);
    }
  }
  return sanitizePose(last.pose, last.pose.distance);
}

export class CameraRuntimeV3 {
  readonly config: CameraConfig;
  #mode: CameraMode = 'follow';
  #tick = 0;
  #targetEntity: number | null = null;
  #target: CameraTarget = { position: zero() };
  #pose: CameraPose;
  #desired: CameraPose;
  #positionVelocity = zero();
  #targetVelocity = zero();
  #input: CameraInput = { lookX: 0, lookY: 0, zoom: 0, orbit: false, reset: false };
  #reducedMotion = false;
  #shakeIntensity = 0;
  #shakeSeed = 1;
  #cinematicTime = 0;
  #cinematicKeyframes: CinematicKeyframe[] = [];
  #cinematicWeight = 0;
  #transition: CameraTransition | null = null;
  #disposed = false;

  constructor(config?: Partial<CameraConfig>, initial?: Partial<CameraPose>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const baseTarget = initial?.target ?? { x: 0, y: 1.6, z: 0 };
    const distance = clamp(finite(initial?.distance ?? 5, 5), this.config.minDistance, this.config.maxDistance);
    const base: CameraPose = {
      position: copy(initial?.position ?? { x: 0, y: 3, z: -distance }),
      target: copy(baseTarget),
      yaw: finite(initial?.yaw ?? 0, 0),
      pitch: clamp(finite(initial?.pitch ?? 0.18, 0.18), this.config.pitchMin, this.config.pitchMax),
      distance,
      roll: finite(initial?.roll ?? 0, 0),
    };
    this.#pose = sanitizePose(base, distance);
    this.#desired = sanitizePose(base, distance);
  }

  setMode(mode: CameraMode): void { if (!this.#disposed) this.#mode = mode; }
  get mode(): CameraMode { return this.#mode; }
  setTarget(entityId: number | null, target?: CameraTarget): void {
    if (this.#disposed) return;
    this.#targetEntity = entityId;
    if (target) this.#target = { position: copy(target.position), velocity: target.velocity ? copy(target.velocity) : undefined, forward: target.forward ? copy(target.forward) : undefined, radius: finite(target.radius ?? 0.5, 0.5) };
  }
  setTargetTransform(target: CameraTarget): void { if (!this.#disposed) this.#target = { position: copy(target.position), velocity: target.velocity ? copy(target.velocity) : undefined, forward: target.forward ? copy(target.forward) : undefined, radius: finite(target.radius ?? 0.5, 0.5) }; }
  setInput(input: Partial<CameraInput>): void { if (!this.#disposed) this.#input = { ...this.#input, ...input }; }
  setReducedMotion(enabled: boolean): void { if (!this.#disposed) this.#reducedMotion = Boolean(enabled); }
  setShake(seed: number, intensity: number): void { if (!this.#disposed) { this.#shakeSeed = seed >>> 0; this.#shakeIntensity = clamp(finite(intensity, 0), 0, 1); } }
  setCinematic(keyframes: readonly CinematicKeyframe[], time = 0): void { if (!this.#disposed) { this.#cinematicKeyframes = [...keyframes].slice(0, 64); this.#cinematicTime = Math.max(0, finite(time, 0)); this.#mode = 'cinematic'; } }
  clearCinematic(): void { this.#cinematicKeyframes = []; this.#cinematicTime = 0; this.#cinematicWeight = 0; if (this.#mode === 'cinematic') this.#mode = 'follow'; }

  beginTransition(to: CameraPose, duration = this.config.cinematicBlendSeconds): void {
    if (this.#disposed) return;
    this.#transition = { from: sanitizePose(this.#pose, this.#pose.distance), to: sanitizePose(to, this.#pose.distance), elapsed: 0, duration: clamp(finite(duration, this.config.cinematicBlendSeconds), 0.01, 30), active: true };
  }

  update(deltaSeconds: number, obstacle?: CameraObstacle): CameraSnapshot {
    if (this.#disposed) return this.snapshot();
    const dt = clamp(finite(deltaSeconds, 0), 0, this.config.maxFrameDelta);
    this.#tick += 1;
    this.#applyInput(dt);
    this.#desired = this.#composeDesired(obstacle);
    const position = criticallyDamped(this.#pose.position, this.#desired.position, this.#positionVelocity, this.config.positionStiffness, dt);
    this.#positionVelocity = { x: position.velocity.x, y: position.velocity.y, z: position.velocity.z };
    const target = criticallyDamped(this.#pose.target, this.#desired.target, this.#targetVelocity, this.config.targetStiffness, dt);
    this.#targetVelocity = { x: target.velocity.x, y: target.velocity.y, z: target.velocity.z };
    this.#pose = {
      position: copy(position.value),
      target: copy(target.value),
      yaw: lerp(this.#pose.yaw, this.#desired.yaw, clamp(dt * this.config.positionStiffness, 0, 1)),
      pitch: lerp(this.#pose.pitch, this.#desired.pitch, clamp(dt * this.config.positionStiffness, 0, 1)),
      distance: lerp(this.#pose.distance, this.#desired.distance, clamp(dt * this.config.positionStiffness, 0, 1)),
      roll: lerp(this.#pose.roll, this.#desired.roll, clamp(dt * this.config.positionStiffness, 0, 1)),
    };
    return this.snapshot();
  }

  snapshot(): CameraSnapshot {
    return Object.freeze({
      version: 3,
      tick: this.#tick,
      mode: this.#mode,
      pose: Object.freeze({ ...this.#pose, position: copy(this.#pose.position), target: copy(this.#pose.target) }),
      desired: Object.freeze({ ...this.#desired, position: copy(this.#desired.position), target: copy(this.#desired.target) }),
      targetEntity: this.#targetEntity,
      collisionLimited: this.#desired.distance < this.config.maxDistance - 0.001,
      shakeScale: this.#reducedMotion ? 0 : this.#shakeIntensity,
      cinematicWeight: this.#cinematicWeight,
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#targetEntity = null;
    this.#cinematicKeyframes = [];
    this.#transition = null;
    this.#input = { lookX: 0, lookY: 0, zoom: 0, orbit: false, reset: false };
    this.#positionVelocity = zero();
    this.#targetVelocity = zero();
  }

  get disposed(): boolean { return this.#disposed; }

  #applyInput(dt: number): void {
    if (this.#input.reset) {
      this.#desired.yaw = 0;
      this.#desired.pitch = 0.18;
      this.#input = { ...this.#input, reset: false };
    }
    if (!this.#input.orbit && this.#mode === 'follow') return;
    this.#desired.yaw += finite(this.#input.lookX, 0) * this.config.yawSpeed * dt;
    this.#desired.pitch = clamp(this.#desired.pitch + finite(this.#input.lookY, 0) * this.config.pitchSpeed * dt, this.config.pitchMin, this.config.pitchMax);
    this.#desired.distance = clamp(this.#desired.distance - finite(this.#input.zoom, 0) * this.config.zoomSpeed * dt, this.config.minDistance, this.config.maxDistance);
    this.#input = { ...this.#input, lookX: 0, lookY: 0, zoom: 0 };
  }

  #composeDesired(obstacle?: CameraObstacle): CameraPose {
    const targetPosition = copy(this.#target.position);
    const radius = Math.max(0.05, this.#target.radius ?? 0.5);
    const horizontalForward = { x: Math.sin(this.#desired.yaw), y: 0, z: Math.cos(this.#desired.yaw) };
    const pitchCos = Math.cos(this.#desired.pitch);
    const offset = { x: -horizontalForward.x * pitchCos * this.#desired.distance, y: Math.sin(this.#desired.pitch) * this.#desired.distance + radius + 0.35, z: -horizontalForward.z * pitchCos * this.#desired.distance };
    let distance = this.#desired.distance;
    if (obstacle) distance = clamp(Math.min(distance, finite(obstacle.maxDistance, distance) - this.config.collisionPadding), this.config.minDistance, this.config.maxDistance);
    let position = { x: targetPosition.x + offset.x * (distance / Math.max(0.001, this.#desired.distance)), y: targetPosition.y + offset.y * (distance / Math.max(0.001, this.#desired.distance)), z: targetPosition.z + offset.z * (distance / Math.max(0.001, this.#desired.distance)) };
    if (obstacle?.normal) {
      const n = normalize3(obstacle.normal);
      const bias = Math.max(0, 1 - distance / Math.max(this.config.maxDistance, 0.001)) * 0.25;
      position = { x: position.x + n.x * bias, y: position.y + n.y * bias, z: position.z + n.z * bias };
    }

    let pose: CameraPose = { position, target: targetPosition, yaw: this.#desired.yaw, pitch: this.#desired.pitch, distance, roll: 0 };
    this.#cinematicWeight = 0;
    if (this.#mode === 'cinematic') {
      this.#cinematicTime += 1 / 60;
      const cinematic = sampleCinematic(this.#cinematicKeyframes, this.#cinematicTime);
      if (cinematic) { pose = blendPose(pose, cinematic, 1); this.#cinematicWeight = 1; }
    }
    if (this.#transition?.active) {
      this.#transition.elapsed += 1 / 60;
      const ratio = clamp(this.#transition.elapsed / this.#transition.duration, 0, 1);
      pose = blendPose(this.#transition.from, this.#transition.to, ratio);
      if (ratio >= 1) this.#transition.active = false;
    }
    if (!this.#reducedMotion && this.#shakeIntensity > 0) pose.position = this.#applyShake(pose.position, this.#tick);
    return sanitizePose(pose, distance);
  }

  #applyShake(position: Vec3, tick: number): Vec3 {
    let seed = (this.#shakeSeed ^ Math.imul(tick, 0x45d9f3b)) >>> 0;
    const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 0xffffffff; };
    const amplitude = this.config.shakeAmplitude * this.#shakeIntensity;
    const phase = tick * this.config.shakeFrequency / 60;
    return { x: position.x + (next() * 2 - 1) * amplitude * Math.sin(phase), y: position.y + (next() * 2 - 1) * amplitude * Math.cos(phase), z: position.z + (next() * 2 - 1) * amplitude * Math.sin(phase * 0.7) };
  }
}

export function createDefaultCameraConfig(): CameraConfig { return { ...DEFAULT_CONFIG }; }

export function cameraForward(pose: CameraPose): Vec3 { return normalize3(sub3(pose.target, pose.position)); }

export function validateCameraPose(pose: CameraPose, config: CameraConfig = DEFAULT_CONFIG): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const values = [...Object.values(pose.position), ...Object.values(pose.target), pose.yaw, pose.pitch, pose.distance, pose.roll];
  if (values.some((value) => !Number.isFinite(value))) errors.push('non-finite camera pose');
  if (pose.distance < config.minDistance || pose.distance > config.maxDistance) errors.push('distance-out-of-bounds');
  if (pose.pitch < config.pitchMin || pose.pitch > config.pitchMax) errors.push('pitch-out-of-bounds');
  return { valid: errors.length === 0, errors };
}

export function interpolateCameraPose(a: CameraPose, b: CameraPose, alpha: number): CameraPose { return blendPose(a, b, alpha); }

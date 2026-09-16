/** Deterministic, renderer-agnostic camera authority for the TypeScript-first runtime. */
import { clamp, criticallyDamped, lerp, normalize3, sub3, type Vec3 } from './deterministicMath';

export type CameraMode = 'follow' | 'combat' | 'aim' | 'cinematic' | 'free';
export interface CameraPose { position: Vec3; target: Vec3; yaw: number; pitch: number; distance: number; roll: number }
export interface CameraInput { lookX: number; lookY: number; zoom: number; orbit: boolean; reset: boolean }
export interface CameraObstacle { maxDistance: number; normal?: Vec3 }
export interface CameraTarget { position: Vec3; velocity?: Vec3; forward?: Vec3; radius?: number }
export interface CameraConfig { minDistance: number; maxDistance: number; pitchMin: number; pitchMax: number; yawSpeed: number; pitchSpeed: number; zoomSpeed: number; positionStiffness: number; targetStiffness: number; maxFrameDelta: number; collisionPadding: number; shakeAmplitude: number; shakeFrequency: number; cinematicBlendSeconds: number }
export interface CameraSnapshot { version: 3; tick: number; mode: CameraMode; pose: CameraPose; desired: CameraPose; targetEntity: number | null; collisionLimited: boolean; shakeScale: number; cinematicWeight: number }
export interface CinematicKeyframe { at: number; pose: CameraPose; weight?: number }
export interface CameraTransition { from: CameraPose; to: CameraPose; elapsed: number; duration: number; active: boolean }

const DEFAULT_CONFIG: CameraConfig = {
  minDistance: 1.2, maxDistance: 18, pitchMin: -1.35, pitchMax: 1.25,
  yawSpeed: 2.8, pitchSpeed: 2.2, zoomSpeed: 7, positionStiffness: 18,
  targetStiffness: 22, maxFrameDelta: 0.1, collisionPadding: 0.18,
  shakeAmplitude: 0.08, shakeFrequency: 12, cinematicBlendSeconds: 0.35,
};
const zero = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const smoothVec3 = (current: Vec3, target: Vec3, velocity: Vec3, stiffness: number, dt: number) => {
  const x = criticallyDamped(current.x, target.x, velocity.x, stiffness, dt);
  const y = criticallyDamped(current.y, target.y, velocity.y, stiffness, dt);
  const z = criticallyDamped(current.z, target.z, velocity.z, stiffness, dt);
  return { value: { x: x.value, y: y.value, z: z.value }, velocity: { x: x.velocity, y: y.velocity, z: z.velocity } };
};

function sanitizePose(pose: CameraPose, fallbackDistance: number): CameraPose {
  return {
    position: copy(pose.position), target: copy(pose.target), yaw: finite(pose.yaw, 0),
    pitch: finite(pose.pitch, 0), distance: Math.max(0.01, finite(pose.distance, fallbackDistance)), roll: finite(pose.roll, 0),
  };
}
function blendPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const w = clamp(t, 0, 1);
  return {
    position: { x: lerp(a.position.x, b.position.x, w), y: lerp(a.position.y, b.position.y, w), z: lerp(a.position.z, b.position.z, w) },
    target: { x: lerp(a.target.x, b.target.x, w), y: lerp(a.target.y, b.target.y, w), z: lerp(a.target.z, b.target.z, w) },
    yaw: lerp(a.yaw, b.yaw, w), pitch: lerp(a.pitch, b.pitch, w), distance: lerp(a.distance, b.distance, w), roll: lerp(a.roll, b.roll, w),
  };
}
function sampleCinematic(keyframes: readonly CinematicKeyframe[], time: number): CameraPose | null {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (time <= first.at) return sanitizePose(first.pose, first.pose.distance);
  if (time >= last.at) return sanitizePose(last.pose, last.pose.distance);
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    const previous = sorted[i - 1]!;
    if (time <= next.at) return blendPose(previous.pose, next.pose, (time - previous.at) / Math.max(0.0001, next.at - previous.at));
  }
  return sanitizePose(last.pose, last.pose.distance);
}

export class CameraRuntimeV3 {
  readonly config: CameraConfig;
  #mode: CameraMode = 'follow'; #tick = 0; #targetEntity: number | null = null;
  #target: CameraTarget = { position: zero() }; #pose: CameraPose; #desired: CameraPose;
  #positionVelocity = zero(); #targetVelocity = zero();
  #input: CameraInput = { lookX: 0, lookY: 0, zoom: 0, orbit: false, reset: false };
  #reducedMotion = false; #shakeIntensity = 0; #shakeSeed = 1;
  #cinematicTime = 0; #cinematicKeyframes: CinematicKeyframe[] = []; #cinematicWeight = 0;
  #transition: CameraTransition | null = null; #disposed = false;

  constructor(config?: Partial<CameraConfig>, initial?: Partial<CameraPose>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const target = initial?.target ?? { x: 0, y: 1.6, z: 0 };
    const distance = clamp(finite(initial?.distance ?? 5, 5), this.config.minDistance, this.config.maxDistance);
    const base: CameraPose = { position: copy(initial?.position ?? { x: 0, y: 3, z: -distance }), target: copy(target), yaw: finite(initial?.yaw ?? 0, 0), pitch: clamp(finite(initial?.pitch ?? 0.18, 0.18), this.config.pitchMin, this.config.pitchMax), distance, roll: finite(initial?.roll ?? 0, 0) };
    this.#pose = sanitizePose(base, distance); this.#desired = sanitizePose(base, distance);
  }

  setMode(mode: CameraMode): void { if (!this.#disposed) this.#mode = mode; }
  get mode(): CameraMode { return this.#mode; }
  setTarget(entityId: number | null, target?: CameraTarget): void {
    if (this.#disposed) return;
    this.#targetEntity = entityId;
    if (!target) return;
    const next: CameraTarget = { position: copy(target.position) };
    if (target.velocity) next.velocity = copy(target.velocity);
    if (target.forward) next.forward = copy(target.forward);
    next.radius = finite(target.radius ?? 0.5, 0.5);
    this.#target = next;
  }
  setTargetTransform(target: CameraTarget): void { this.setTarget(this.#targetEntity, target); }
  setInput(input: Partial<CameraInput>): void { if (!this.#disposed) this.#input = { ...this.#input, ...input }; }
  setReducedMotion(enabled: boolean): void { if (!this.#disposed) this.#reducedMotion = Boolean(enabled); }
  setShake(seed: number, intensity: number): void { if (!this.#disposed) { this.#shakeSeed = seed >>> 0; this.#shakeIntensity = clamp(finite(intensity, 0), 0, 1); } }
  setCinematic(keyframes: readonly CinematicKeyframe[], time = 0): void { if (!this.#disposed) { this.#cinematicKeyframes = [...keyframes].slice(0, 64); this.#cinematicTime = Math.max(0, finite(time, 0)); this.#mode = 'cinematic'; } }
  clearCinematic(): void { this.#cinematicKeyframes = []; this.#cinematicTime = 0; this.#cinematicWeight = 0; if (this.#mode === 'cinematic') this.#mode = 'follow'; }
  beginTransition(to: CameraPose, duration = this.config.cinematicBlendSeconds): void { if (!this.#disposed) this.#transition = { from: sanitizePose(this.#pose, this.#pose.distance), to: sanitizePose(to, this.#pose.distance), elapsed: 0, duration: clamp(finite(duration, this.config.cinematicBlendSeconds), 0.01, 30), active: true }; }

  update(deltaSeconds: number, obstacle?: CameraObstacle): CameraSnapshot {
    if (this.#disposed) return this.snapshot();
    const dt = clamp(finite(deltaSeconds, 0), 0, this.config.maxFrameDelta);
    this.#tick += 1; this.#applyInput(dt); this.#desired = this.#composeDesired(obstacle);
    const position = smoothVec3(this.#pose.position, this.#desired.position, this.#positionVelocity, this.config.positionStiffness, dt);
    const target = smoothVec3(this.#pose.target, this.#desired.target, this.#targetVelocity, this.config.targetStiffness, dt);
    this.#positionVelocity = position.velocity; this.#targetVelocity = target.velocity;
    const blend = clamp(dt * this.config.positionStiffness, 0, 1);
    this.#pose = { position: position.value, target: target.value, yaw: lerp(this.#pose.yaw, this.#desired.yaw, blend), pitch: lerp(this.#pose.pitch, this.#desired.pitch, blend), distance: lerp(this.#pose.distance, this.#desired.distance, blend), roll: lerp(this.#pose.roll, this.#desired.roll, blend) };
    return this.snapshot();
  }

  snapshot(): CameraSnapshot {
    return Object.freeze({ version: 3, tick: this.#tick, mode: this.#mode,
      pose: Object.freeze({ ...this.#pose, position: copy(this.#pose.position), target: copy(this.#pose.target) }),
      desired: Object.freeze({ ...this.#desired, position: copy(this.#desired.position), target: copy(this.#desired.target) }),
      targetEntity: this.#targetEntity, collisionLimited: this.#desired.distance < this.config.maxDistance - 0.001,
      shakeScale: this.#reducedMotion ? 0 : this.#shakeIntensity, cinematicWeight: this.#cinematicWeight });
  }

  dispose(): void { this.#disposed = true; this.#targetEntity = null; this.#cinematicKeyframes = []; this.#transition = null; this.#input = { lookX: 0, lookY: 0, zoom: 0, orbit: false, reset: false }; this.#positionVelocity = zero(); this.#targetVelocity = zero(); }
  get disposed(): boolean { return this.#disposed; }

  #applyInput(dt: number): void {
    if (this.#input.reset) { this.#desired.yaw = 0; this.#desired.pitch = 0.18; this.#input = { ...this.#input, reset: false }; }
    if (!this.#input.orbit && this.#mode === 'follow') return;
    this.#desired.yaw += finite(this.#input.lookX, 0) * this.config.yawSpeed * dt;
    this.#desired.pitch = clamp(this.#desired.pitch + finite(this.#input.lookY, 0) * this.config.pitchSpeed * dt, this.config.pitchMin, this.config.pitchMax);
    this.#desired.distance = clamp(this.#desired.distance - finite(this.#input.zoom, 0) * this.config.zoomSpeed * dt, this.config.minDistance, this.config.maxDistance);
    this.#input = { ...this.#input, lookX: 0, lookY: 0, zoom: 0 };
  }

  #composeDesired(obstacle?: CameraObstacle): CameraPose {
    const target = copy(this.#target.position); const radius = Math.max(0.05, this.#target.radius ?? 0.5);
    const forward = { x: Math.sin(this.#desired.yaw), y: 0, z: Math.cos(this.#desired.yaw) }; const c = Math.cos(this.#desired.pitch);
    const rawOffset = { x: -forward.x * c * this.#desired.distance, y: Math.sin(this.#desired.pitch) * this.#desired.distance + radius + 0.35, z: -forward.z * c * this.#desired.distance };
    const safeObstacleDistance = obstacle ? Math.max(this.config.minDistance, finite(obstacle.maxDistance, this.#desired.distance) - this.config.collisionPadding) : this.#desired.distance;
    const distance = clamp(Math.min(this.#desired.distance, safeObstacleDistance), this.config.minDistance, this.config.maxDistance);
    const ratio = distance / Math.max(0.001, this.#desired.distance);
    let position = { x: target.x + rawOffset.x * ratio, y: target.y + rawOffset.y * ratio, z: target.z + rawOffset.z * ratio };
    if (obstacle?.normal) { const n = normalize3(obstacle.normal); const bias = Math.max(0, 1 - distance / this.config.maxDistance) * 0.25; position = { x: position.x + n.x * bias, y: position.y + n.y * bias, z: position.z + n.z * bias }; }
    let pose: CameraPose = { position, target, yaw: this.#desired.yaw, pitch: this.#desired.pitch, distance, roll: 0 };
    this.#cinematicWeight = 0;
    if (this.#mode === 'cinematic') { this.#cinematicTime += 1 / 60; const cinematic = sampleCinematic(this.#cinematicKeyframes, this.#cinematicTime); if (cinematic) { pose = blendPose(pose, cinematic, 1); this.#cinematicWeight = 1; } }
    if (this.#transition?.active) { this.#transition.elapsed += 1 / 60; const ratio = clamp(this.#transition.elapsed / this.#transition.duration, 0, 1); pose = blendPose(this.#transition.from, this.#transition.to, ratio); if (ratio >= 1) this.#transition.active = false; }
    if (!this.#reducedMotion && this.#shakeIntensity > 0) pose.position = this.#applyShake(pose.position, this.#tick);
    return sanitizePose(pose, distance);
  }

  #applyShake(position: Vec3, tick: number): Vec3 {
    let seed = (this.#shakeSeed ^ Math.imul(tick, 0x45d9f3b)) >>> 0;
    const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 0xffffffff; };
    const amplitude = this.config.shakeAmplitude * this.#shakeIntensity; const phase = tick * this.config.shakeFrequency / 60;
    return { x: position.x + (next() * 2 - 1) * amplitude * Math.sin(phase), y: position.y + (next() * 2 - 1) * amplitude * Math.cos(phase), z: position.z + (next() * 2 - 1) * amplitude * Math.sin(phase * 0.7) };
  }
}

export function createDefaultCameraConfig(): CameraConfig { return { ...DEFAULT_CONFIG }; }
export function cameraForward(pose: CameraPose): Vec3 { return normalize3(sub3(pose.target, pose.position)); }
export function validateCameraPose(pose: CameraPose, config: CameraConfig = DEFAULT_CONFIG): { valid: boolean; errors: string[] } {
  const errors: string[] = []; const values = [...Object.values(pose.position), ...Object.values(pose.target), pose.yaw, pose.pitch, pose.distance, pose.roll];
  if (values.some((value) => !Number.isFinite(value))) errors.push('non-finite camera pose');
  if (pose.distance < config.minDistance || pose.distance > config.maxDistance) errors.push('distance-out-of-bounds');
  if (pose.pitch < config.pitchMin || pose.pitch > config.pitchMax) errors.push('pitch-out-of-bounds');
  return { valid: errors.length === 0, errors };
}
export function interpolateCameraPose(a: CameraPose, b: CameraPose, alpha: number): CameraPose { return blendPose(a, b, alpha); }

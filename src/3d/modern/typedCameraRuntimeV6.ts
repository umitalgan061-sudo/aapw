import { clampV4, vec3V4, type Vec3V4 } from './runtimeContractsV4';
import { type CameraIntentV6, type CameraStateV6, finiteOrV6, validateCameraV6 } from './typedSceneContractsV6';

export interface CameraRuntimeOptionsV6 {
  readonly minDistance?: number;
  readonly maxDistance?: number;
  readonly minPitch?: number;
  readonly maxPitch?: number;
  readonly orbitSensitivity?: number;
  readonly zoomSensitivity?: number;
  readonly damping?: number;
  readonly collisionPadding?: number;
  readonly maxCollisionDistance?: number;
}

export interface CameraCollisionProbeV6 {
  readonly distance: (origin: Vec3V4, target: Vec3V4, maxDistance: number) => number;
}

export interface CameraFocusV6 {
  readonly target: Vec3V4;
  readonly distance?: number;
  readonly yaw?: number;
  readonly pitch?: number;
}

export interface CameraMetricsV6 {
  readonly updates: number;
  readonly collisions: number;
  readonly collisionPullbacks: number;
  readonly resets: number;
  readonly clampedInputs: number;
  readonly maxDistanceObserved: number;
  readonly minDistanceObserved: number;
}

const DEFAULTS: Required<CameraRuntimeOptionsV6> = Object.freeze({
  minDistance: 4,
  maxDistance: 45,
  minPitch: -0.15,
  maxPitch: 1.15,
  orbitSensitivity: 0.004,
  zoomSensitivity: 0.12,
  damping: 14,
  collisionPadding: 0.35,
  maxCollisionDistance: 40,
});

const distance3 = (a: Vec3V4, b: Vec3V4): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lerp = (from: number, to: number, factor: number): number => from + (to - from) * factor;
const dampingFactor = (damping: number, deltaMs: number): number => 1 - Math.exp(-Math.max(0, damping) * Math.max(0, deltaMs) / 1000);

function direction(yaw: number, pitch: number): Vec3V4 {
  const cosPitch = Math.cos(pitch);
  return Object.freeze({
    x: Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  });
}

function sanitizeState(state: CameraStateV6): CameraStateV6 {
  const sanitized: CameraStateV6 = Object.freeze({
    ...state,
    position: vec3V4(finiteOrV6(state.position.x), finiteOrV6(state.position.y), finiteOrV6(state.position.z)),
    target: vec3V4(finiteOrV6(state.target.x), finiteOrV6(state.target.y), finiteOrV6(state.target.z)),
    yaw: finiteOrV6(state.yaw),
    pitch: finiteOrV6(state.pitch),
    distance: Math.max(state.minDistance, Math.min(state.maxDistance, finiteOrV6(state.distance, state.minDistance))),
    collisionDistance: Math.max(state.minDistance, finiteOrV6(state.collisionDistance, state.distance)),
  });
  validateCameraV6(sanitized);
  return sanitized;
}

export class TypedCameraRuntimeV6 {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minPitch: number;
  readonly maxPitch: number;
  readonly orbitSensitivity: number;
  readonly zoomSensitivity: number;
  readonly damping: number;
  readonly collisionPadding: number;
  readonly maxCollisionDistance: number;
  #state: CameraStateV6;
  #desired: CameraStateV6;
  #metrics: CameraMetricsV6 = Object.freeze({ updates: 0, collisions: 0, collisionPullbacks: 0, resets: 0, clampedInputs: 0, maxDistanceObserved: 0, minDistanceObserved: Number.POSITIVE_INFINITY });

  constructor(initial?: Partial<CameraStateV6>, options: CameraRuntimeOptionsV6 = {}) {
    const config = { ...DEFAULTS, ...options };
    this.minDistance = Math.max(0.5, Number.isFinite(config.minDistance) ? config.minDistance : DEFAULTS.minDistance);
    this.maxDistance = Math.max(this.minDistance + 0.5, Number.isFinite(config.maxDistance) ? config.maxDistance : DEFAULTS.maxDistance);
    this.minPitch = finiteOrV6(config.minPitch, DEFAULTS.minPitch);
    this.maxPitch = Math.max(this.minPitch + 0.05, finiteOrV6(config.maxPitch, DEFAULTS.maxPitch));
    this.orbitSensitivity = Math.max(0.0001, finiteOrV6(config.orbitSensitivity, DEFAULTS.orbitSensitivity));
    this.zoomSensitivity = Math.max(0.001, finiteOrV6(config.zoomSensitivity, DEFAULTS.zoomSensitivity));
    this.damping = Math.max(0, finiteOrV6(config.damping, DEFAULTS.damping));
    this.collisionPadding = Math.max(0, finiteOrV6(config.collisionPadding, DEFAULTS.collisionPadding));
    this.maxCollisionDistance = Math.max(this.minDistance, finiteOrV6(config.maxCollisionDistance, DEFAULTS.maxCollisionDistance));
    const target = initial?.target ?? vec3V4(0, 1.5, 0);
    const position = initial?.position ?? vec3V4(0, 6, 12);
    const distance = Math.max(this.minDistance, Math.min(this.maxDistance, initial?.distance ?? distance3(position, target)));
    const yaw = finiteOrV6(initial?.yaw, Math.atan2(position.x - target.x, position.z - target.z));
    const pitch = clampV4(finiteOrV6(initial?.pitch, Math.atan2(position.y - target.y, Math.max(0.001, Math.hypot(position.x - target.x, position.z - target.z)))), this.minPitch, this.maxPitch);
    this.#state = sanitizeState(Object.freeze({ position, target, yaw, pitch, distance, minDistance: this.minDistance, maxDistance: this.maxDistance, enablePan: initial?.enablePan ?? false, collisionDistance: distance }));
    this.#desired = this.#state;
  }

  state(): CameraStateV6 { return Object.freeze({ ...this.#state, position: Object.freeze({ ...this.#state.position }), target: Object.freeze({ ...this.#state.target }) }); }

  focus(focus: CameraFocusV6): void {
    const target = vec3V4(finiteOrV6(focus.target.x), finiteOrV6(focus.target.y), finiteOrV6(focus.target.z));
    const distance = Math.max(this.minDistance, Math.min(this.maxDistance, focus.distance ?? this.#state.distance));
    const yaw = finiteOrV6(focus.yaw, this.#state.yaw);
    const pitch = clampV4(finiteOrV6(focus.pitch, this.#state.pitch), this.minPitch, this.maxPitch);
    this.#desired = sanitizeState({ ...this.#desired, target, distance, yaw, pitch, collisionDistance: distance });
  }

  reset(target = vec3V4(0, 1.5, 0)): void {
    const next: CameraStateV6 = {
      ...this.#state,
      target,
      yaw: 0,
      pitch: 0.35,
      distance: Math.min(this.maxDistance, Math.max(this.minDistance, 12)),
      collisionDistance: Math.min(this.maxDistance, Math.max(this.minDistance, 12)),
    };
    this.#desired = sanitizeState(next);
    this.#metrics = Object.freeze({ ...this.#metrics, resets: this.#metrics.resets + 1 });
  }

  applyIntent(intent: CameraIntentV6): void {
    const orbitX = finiteOrV6(intent.orbitX);
    const orbitY = finiteOrV6(intent.orbitY);
    const zoom = finiteOrV6(intent.zoom);
    const panX = finiteOrV6(intent.panX);
    const panY = finiteOrV6(intent.panY);
    let yaw = this.#desired.yaw - orbitX * this.orbitSensitivity;
    let pitch = this.#desired.pitch - orbitY * this.orbitSensitivity;
    const rawDistance = this.#desired.distance * (1 - zoom * this.zoomSensitivity);
    const distance = Math.max(this.minDistance, Math.min(this.maxDistance, rawDistance));
    let clamped = 0;
    const clampedPitch = clampV4(pitch, this.minPitch, this.maxPitch);
    if (clampedPitch !== pitch) clamped += 1;
    pitch = clampedPitch;
    const clampedDistance = distance !== rawDistance;
    if (clampedDistance) clamped += 1;
    const enablePan = this.#desired.enablePan;
    const target = enablePan ? this.#panTarget(this.#desired, panX, panY, distance) : this.#desired.target;
    if (clamped > 0) this.#metrics = Object.freeze({ ...this.#metrics, clampedInputs: this.#metrics.clampedInputs + clamped });
    if (intent.reset) {
      this.reset(this.#desired.target);
      return;
    }
    this.#desired = sanitizeState({ ...this.#desired, yaw, pitch, distance, target, collisionDistance: distance });
  }

  update(deltaMs: number, collisionProbe?: CameraCollisionProbeV6): CameraStateV6 {
    const factor = dampingFactor(this.damping, deltaMs);
    const position = this.#orbitPosition(this.#desired.target, this.#desired.yaw, this.#desired.pitch, this.#desired.distance);
    const desiredPosition = position;
    let collisionDistance = this.#desired.distance;
    if (collisionProbe) {
      const hit = Math.max(this.minDistance, Math.min(this.maxCollisionDistance, collisionProbe.distance(this.#desired.target, desiredPosition, this.#desired.distance)));
      if (hit < this.#desired.distance - this.collisionPadding) {
        collisionDistance = Math.max(this.minDistance, hit - this.collisionPadding);
        this.#metrics = Object.freeze({ ...this.#metrics, collisions: this.#metrics.collisions + 1, collisionPullbacks: this.#metrics.collisionPullbacks + 1 });
      }
    }
    const resolvedPosition = this.#orbitPosition(this.#desired.target, this.#desired.yaw, this.#desired.pitch, collisionDistance);
    this.#state = sanitizeState({
      ...this.#state,
      target: this.#lerpVec(this.#state.target, this.#desired.target, factor),
      position: this.#lerpVec(this.#state.position, resolvedPosition, factor),
      yaw: lerp(this.#state.yaw, this.#desired.yaw, factor),
      pitch: lerp(this.#state.pitch, this.#desired.pitch, factor),
      distance: lerp(this.#state.distance, collisionDistance, factor),
      collisionDistance,
    });
    this.#metrics = Object.freeze({ ...this.#metrics, updates: this.#metrics.updates + 1, maxDistanceObserved: Math.max(this.#metrics.maxDistanceObserved, this.#state.distance), minDistanceObserved: Math.min(this.#metrics.minDistanceObserved, this.#state.distance) });
    return this.state();
  }

  setPanEnabled(enabled: boolean): void { this.#state = sanitizeState({ ...this.#state, enablePan: Boolean(enabled) }); this.#desired = sanitizeState({ ...this.#desired, enablePan: Boolean(enabled) }); }
  setDistance(distance: number): void { const safe = Math.max(this.minDistance, Math.min(this.maxDistance, finiteOrV6(distance, this.#state.distance))); this.#desired = sanitizeState({ ...this.#desired, distance: safe }); }
  setTarget(target: Vec3V4): void { this.#desired = sanitizeState({ ...this.#desired, target: vec3V4(target.x, target.y, target.z) }); }
  metrics(): CameraMetricsV6 { return this.#metrics; }

  private #orbitPosition(target: Vec3V4, yaw: number, pitch: number, distance: number): Vec3V4 {
    const dir = direction(yaw, pitch);
    return vec3V4(target.x + dir.x * distance, target.y + dir.y * distance, target.z + dir.z * distance);
  }

  private #lerpVec(from: Vec3V4, to: Vec3V4, factor: number): Vec3V4 { return vec3V4(lerp(from.x, to.x, factor), lerp(from.y, to.y, factor), lerp(from.z, to.z, factor)); }
  private #panTarget(state: CameraStateV6, panX: number, panY: number, distance: number): Vec3V4 { const scale = Math.max(0.01, distance * 0.002); const right = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) }; return vec3V4(state.target.x + right.x * panX * scale, state.target.y + panY * scale, state.target.z + right.z * panX * scale); }
}

export class DefaultCameraCollisionProbeV6 implements CameraCollisionProbeV6 {
  readonly sample: (origin: Vec3V4, target: Vec3V4, maxDistance: number) => number;
  constructor(sample?: (origin: Vec3V4, target: Vec3V4, maxDistance: number) => number) { this.sample = sample ?? (() => Number.POSITIVE_INFINITY); }
  distance(origin: Vec3V4, target: Vec3V4, maxDistance: number): number { const value = finiteOrV6(this.sample(origin, target, maxDistance), maxDistance); return Math.max(0, Math.min(maxDistance, value)); }
}

export function projectCameraDirectionV6(camera: CameraStateV6): Vec3V4 {
  const dx = camera.target.x - camera.position.x;
  const dy = camera.target.y - camera.position.y;
  const dz = camera.target.z - camera.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  return vec3V4(dx / length, dy / length, dz / length);
}

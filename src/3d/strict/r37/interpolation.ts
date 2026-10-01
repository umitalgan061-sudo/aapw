import type { NetworkEntityState, Vec3 } from './types.ts';
import { clamp, finite, lerp, vec3 } from './math.ts';

export interface InterpolationSample<T> {
  readonly previous: T;
  readonly current: T;
  readonly alpha: number;
}

export function interpolateScalar(previous: number, current: number, alpha: number): number {
  return lerp(finite(previous), finite(current), clamp(finite(alpha), 0, 1));
}

export function interpolateVec3(previous: Vec3, current: Vec3, alpha: number): Vec3 {
  const t = clamp(finite(alpha), 0, 1);
  return vec3(lerp(previous.x, current.x, t), lerp(previous.y, current.y, t), lerp(previous.z, current.z, t));
}

export function interpolateAngle(previous: number, current: number, alpha: number): number {
  let delta = ((current - previous + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return previous + delta * clamp(finite(alpha), 0, 1);
}

export function interpolateNetworkState(previous: NetworkEntityState, current: NetworkEntityState, alpha: number): NetworkEntityState {
  return Object.freeze({
    id: current.id,
    tick: Math.max(previous.tick, current.tick),
    position: interpolateVec3(previous.position, current.position, alpha),
    velocity: interpolateVec3(previous.velocity, current.velocity, alpha),
    rotationY: interpolateAngle(previous.rotationY, current.rotationY, alpha),
    flags: alpha >= 0.5 ? current.flags : previous.flags,
  });
}

export function sampleByTimestamp<T extends { readonly sentAtMs: number }>(samples: readonly T[], targetMs: number): InterpolationSample<T> | null {
  if (samples.length === 0) return null;
  const target = finite(targetMs);
  const right = samples.findIndex((sample) => sample.sentAtMs >= target);
  if (right <= 0) return Object.freeze({ previous: samples[0]!, current: samples[0]!, alpha: 0 });
  if (right < 0) {
    const latest = samples.at(-1)!;
    return Object.freeze({ previous: latest, current: latest, alpha: 1 });
  }
  const previous = samples[right - 1]!;
  const current = samples[right]!;
  const span = Math.max(1, current.sentAtMs - previous.sentAtMs);
  return Object.freeze({ previous, current, alpha: clamp((target - previous.sentAtMs) / span, 0, 1) });
}

export function extrapolateVec3(position: Vec3, velocity: Vec3, seconds: number, maxSeconds = 0.12): Vec3 {
  const dt = clamp(finite(seconds), 0, Math.max(0, maxSeconds));
  return vec3(position.x + velocity.x * dt, position.y + velocity.y * dt, position.z + velocity.z * dt);
}

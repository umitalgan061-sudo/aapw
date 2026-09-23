/**
 * Buzul Muhafızı — runtime safety boundary for live photorealism application.
 *
 * Keeps P0/P5 guard decisions explicit at the last mutation boundary. This is
 * deliberately a small predicate layer: it does not create terrain, assets,
 * materials, water meshes, or placement state.
 */
import type { CanonicalEnvironmentObservation } from './photorealismEnvironmentPass.ts';

export interface RuntimeSafetyDecision {
  readonly safeToApply: boolean;
  readonly reason: string | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function evaluatePhotorealismRuntimeSafety(
  observation: CanonicalEnvironmentObservation,
): RuntimeSafetyDecision {
  const failure = observation.visibleFailures;
  if (!failure || typeof failure !== 'object') {
    return Object.freeze({ safeToApply: false, reason: 'missing-visible-failure-set' });
  }
  if (failure.rectangularWater || failure.gridSeam || failure.waterMoire || failure.blackSky) {
    return Object.freeze({ safeToApply: false, reason: 'visible-p0-p5-failure' });
  }
  if (!finite(observation.renderedColliderParityMeters) || observation.renderedColliderParityMeters > 0.35) {
    return Object.freeze({ safeToApply: false, reason: 'terrain-collider-parity-out-of-bounds' });
  }
  return Object.freeze({ safeToApply: true, reason: null });
}
